'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const files=['DevelopmentObserver.node.js','mongodb-observer-node-runtime.cjs','mongodb-observer-access.cjs','mongodb-observer.cjs','mongodb-observer-schema.cjs','external-observer-protocol.cjs'];
function stage(destination){
  if(!path.isAbsolute(destination))throw Error('Absolute fresh staging directory required');
  fs.mkdirSync(destination,{mode:0o700});
  const hashes={};
  for(const file of files){const bytes=fs.readFileSync(path.join(__dirname,file));fs.writeFileSync(path.join(destination,file),bytes,{flag:'wx'});hashes[file]=crypto.createHash('sha256').update(bytes).digest('hex');}
  fs.writeFileSync(path.join(destination,'package.json'),JSON.stringify({name:'n8n-nodes-ai-os-observer',version:'0.1.0',private:true,engines:{node:'>=24'},dependencies:{mongodb:'6.22.0'},n8n:{n8nNodesApiVersion:1,nodes:['DevelopmentObserver.node.js']}},null,2)+'\n',{flag:'wx'});
  const receipt={schema_version:1,prepared_only_default:true,installed:false,files_sha256:hashes};
  fs.writeFileSync(path.join(destination,'stage-manifest.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});return receipt;
}
function fixture(mode){
  if(!['ingress','observe'].includes(mode))throw Error('Unknown prepared mode');
  return {id:mode==='ingress'?'ObserverPreparedIngress':'ObserverPreparedWatch',name:'[PREPARED ONLY] AI OS Observer '+mode,active:false,
    nodes:[{id:'manual',name:'Manual prepared probe',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{},disabled:true},
      {id:'observer',name:'Prepared observer',type:'CUSTOM.developmentObserver',typeVersion:1,position:[240,0],parameters:{mode,preparedOnly:true,approvedMongoCredentialId:'',recipient:''},retryOnFail:false}],
    connections:{'Manual prepared probe':{main:[[{node:'Prepared observer',type:'main',index:0}]]}},settings:{executionTimeout:30,saveManualExecutions:true,saveDataSuccessExecution:'all',saveDataErrorExecution:'all'}};
}
if(require.main===module){if(process.argv.length!==3)throw Error('Staging directory argument required');console.log(JSON.stringify(stage(process.argv[2])));}
module.exports={stage,fixture};
