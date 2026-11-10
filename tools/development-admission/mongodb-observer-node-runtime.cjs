'use strict';
const {DATABASE,mongoPort,ingest,observe}=require('./mongodb-observer.cjs');
const {verifyIdentity}=require('./mongodb-observer-access.cjs');
const blockedIds=new Set(['18','bKjCNekrlGKLq8C2']);
function driver(){if(require('mongodb/package.json').version!=='6.22.0')throw Error('Pinned Mongo driver required');return require('mongodb').MongoClient;}
async function executeObserver(context,{loadDriver=driver}={}){
  if(context.getNodeParameter('preparedOnly',0)!==false)return [[{json:{action:'observer-node-prepared-disabled',runtime_activated:false,model_calls:0}}]];
  let client;
  try{
    const mode=context.getNodeParameter('mode',0),expected=context.getNodeParameter('approvedMongoCredentialId',0),node=context.getNode(),id=node.credentials?.mongoDb?.id;
    if(!['ingress','observe'].includes(mode)||typeof expected!=='string'||!expected||id!==expected||blockedIds.has(id)||node.retryOnFail===true)throw Error('Unreviewed runtime binding');
    const verifyOnly=context.getNodeParameter('verifyOnly',0,false)===true;
    let input,recipient;
    if(!verifyOnly){
      const items=context.getInputData();
      if(items.length!==1||!items[0].json||JSON.stringify(items[0].json).length>4096)throw Error('One bounded input required');
      input=items[0].json;
      if(mode==='ingress'&&(Object.keys(input).length!==1||!input.packet))throw Error('Heartbeat packet required');
      if(mode==='observe'){
        if(Object.keys(input).length)throw Error('Observer accepts no external payload');
        recipient=context.getNodeParameter('recipient',0);
        if(typeof recipient!=='string'||!/^[A-Za-z0-9]{30}$/.test(recipient)||!node.credentials?.pushoverApi?.id)throw Error('Reviewed owner route required');
      }
    }
    const credentials=await context.getCredentials('mongoDb');
    if(credentials.configurationType!=='connectionString'||credentials.database!==DATABASE||typeof credentials.connectionString!=='string'||!/^mongodb(?:\+srv)?:\/\//.test(credentials.connectionString)||credentials.ca||credentials.cert||credentials.key)throw Error('Scoped Atlas connection-string credential required');
    const MongoClient=loadDriver();
    client=new MongoClient(credentials.connectionString,{tls:true,tlsAllowInvalidCertificates:false,tlsAllowInvalidHostnames:false,
      retryWrites:false,retryReads:false,serverSelectionTimeoutMS:3000,socketTimeoutMS:5000});
    await client.connect();
    const status=await client.db(DATABASE).command({connectionStatus:1,showPrivileges:true,maxTimeMS:3000});
    if(!verifyIdentity(status,mode))throw Error('Runtime identity/privileges mismatch');
    if(verifyOnly)return [[{json:{action:'observer-mongo-access-verified',mode,database:DATABASE,tls_verified:true,privileges_verified:true}}]];
    const store=mongoPort(client);
    const send=async(grant,{signal})=>context.helpers.httpRequestWithAuthentication.call(context,'pushoverApi',{
      method:'POST',url:'https://api.pushover.net/1/messages.json',body:{user:recipient,message:grant.message,url:grant.url,priority:0},json:true,
      timeout:10000,maxResponseBodyBytes:8192,disableFollowRedirect:true,maxRedirects:0,skipSslCertificateValidation:false,
      sendCredentialsOnCrossOriginRedirect:false,allowedDomains:'api.pushover.net',abortSignal:signal});
    const result=mode==='ingress'?await ingest(store,input.packet):await observe(store,send);
    const refusals=['heartbeat-refused','heartbeat-conflict','ingress-disabled','observer-state-unavailable','observer-disabled','observer-clock-untrusted'];
    if(refusals.includes(result.action)||(result.action==='attempted-once'&&result.delivery!=='provider-accepted'))throw Error('Observer result requires attention');
    return [[{json:{...result,runtime_acceptance:false,model_calls:0}}]];
  }catch{throw Error('AI OS observer blocked; inspect state before any retry');}
  finally{if(client)await client.close().catch(()=>{});}
}
module.exports={executeObserver};
