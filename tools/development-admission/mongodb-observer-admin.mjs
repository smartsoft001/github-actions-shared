// Explicit one-shot administrative entry; never obtains credentials from n8n.
import {readFile,lstat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {isAbsolute} from 'node:path';
const require=createRequire(import.meta.url);
const {plan,prepare,initialize}=require('./mongodb-observer-initialize.cjs');
const {DATABASE}=require('./mongodb-observer.cjs');
export function validateRequest(args,proposal){
  const [mode,configPath,approval]=args;
  if(!['--check','--inspect','--initialize'].includes(mode)||!isAbsolute(configPath||'')||args.length!==(mode==='--initialize'?3:2))throw Error('Invalid admin request');
  const exact=plan(proposal.binding_sha256,new Date(proposal.baseline));
  if(JSON.stringify(exact)!==JSON.stringify(proposal))throw Error('Plan mismatch');
  if(mode==='--initialize'&&approval!==proposal.plan_sha256)throw Error('Explicit approved plan SHA required');
  return {mode,configPath};
}
async function privateJson(path){
  if(!isAbsolute(path))throw Error('Absolute private path required');
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.uid!==process.getuid())throw Error('Private owner file required');
  return JSON.parse(await readFile(path,'utf8'));
}
export async function run(args){
  const proposal=JSON.parse(await readFile(new URL('./observer-production-initialization-plan.json',import.meta.url),'utf8'));
  // Approval gate happens before config/secret/driver access, even before connection.
  const {mode,configPath}=validateRequest(args,proposal);
  const config=await privateJson(configPath);
  if(config.schema_version!==1||config.database!==DATABASE||config.enabled!==false
      ||!isAbsolute(config.driver_path||'')||!isAbsolute(config.uri_file||'')||config.plan_sha256!==proposal.plan_sha256)throw Error('Unreviewed admin config');
  if(mode==='--check')return {action:'admin-config-checked',database:DATABASE,plan_sha256:proposal.plan_sha256,connected:false,write_attempted:false};
  const secret=await privateJson(config.uri_file);
  if(typeof secret.uri!=='string'||!/^mongodb(?:\+srv)?:\/\//.test(secret.uri))throw Error('Mongo URI required');
  const {MongoClient}=require(config.driver_path);
  const client=new MongoClient(secret.uri,{tls:true,tlsAllowInvalidCertificates:false,tlsAllowInvalidHostnames:false,
    retryWrites:false,retryReads:false,serverSelectionTimeoutMS:3000,socketTimeoutMS:5000});
  try{
    await client.connect();const db=client.db(DATABASE);
    if(mode==='--inspect'){
      const actual=await prepare(db,{binding:proposal.binding_sha256,baseline:new Date(proposal.baseline)});
      if(actual.plan_sha256!==proposal.plan_sha256)throw Error('Plan changed');
      return {action:'admin-preflight-passed',database:DATABASE,plan_sha256:proposal.plan_sha256,write_attempted:false};
    }
    return await initialize(db,proposal,{approved:true,planSha256:proposal.plan_sha256});
  }finally{await client.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await run(process.argv.slice(2))));}
  catch{console.log(JSON.stringify({action:'admin-request-blocked',healthy:false,automatic_retry:false,details_redacted:true}));process.exitCode=1;}
}
