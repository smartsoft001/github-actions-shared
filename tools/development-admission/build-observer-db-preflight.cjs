'use strict';
const {readiness,INGRESS,WATCH}=require('./observer-provisioning.cjs');
const GUARD='throw new Error("Observer database/access approval and bindings incomplete");';
function assertion(role) {
  const expected=[...readiness(role).matchAll(/\bAS\s+(\w+)/gi)].map(m=>m[1]);
  return `const expected=${JSON.stringify(expected)};const rows=$input.all();
if(rows.length!==1 || Object.keys(rows[0].json).length!==expected.length || expected.some(k=>rows[0].json[k]!==true)) throw new Error('Observer credential scope refused');
return [{json:{scope_verified:true,write_operations:0}}];`;
}
const definitions=[
  ['start','trigger','n8n-nodes-base.manualTrigger',1,{name:'Manual observer DB preflight',disabled:true,parameters:{}}],
  ['guard','node','n8n-nodes-base.code',2,{name:'Require approved access bindings',parameters:{mode:'runOnceForAllItems',jsCode:GUARD}}],
  ['ingress','node','n8n-nodes-base.postgres',2.7,{name:'Inspect ingress privileges',parameters:{operation:'executeQuery',query:readiness(INGRESS),options:{connectionTimeout:3,queryBatching:'single'}},retryOnFail:false}],
  ['assertIngress','node','n8n-nodes-base.code',2,{name:'Assert ingress scope',parameters:{mode:'runOnceForAllItems',jsCode:assertion(INGRESS)}}],
  ['watch','node','n8n-nodes-base.postgres',2.7,{name:'Inspect observer privileges',parameters:{operation:'executeQuery',query:readiness(WATCH),options:{connectionTimeout:3,queryBatching:'single'}},retryOnFail:false}],
  ['assertWatch','node','n8n-nodes-base.code',2,{name:'Assert observer scope',parameters:{mode:'runOnceForAllItems',jsCode:assertion(WATCH)}}],
  ['summary','node','n8n-nodes-base.code',2,{name:'Observer DB readiness receipt',parameters:{mode:'runOnceForAllItems',jsCode:'return [{json:{schema_version:1,ingress_verified:$("Assert ingress scope").first().json.scope_verified,observer_verified:$("Assert observer scope").first().json.scope_verified,write_operations:0,activated:false}}];'}}],
];
function build() {
  let code="import {workflow,node,trigger,newCredential} from '@n8n/workflow-sdk';\n";
  for(const [id,method,type,version,config] of definitions) {
    const credentials=id==='ingress'?"postgres:newCredential('Development Observer Ingress — UNBOUND')":id==='watch'?"postgres:newCredential('Development Observer Watch — UNBOUND')":null;
    let literal=JSON.stringify(config);
    if(credentials)literal=literal.slice(0,-1)+',credentials:{'+credentials+'}}';
    code+=`const ${id}=${method}({type:${JSON.stringify(type)},version:${version},config:${literal},output:[{json:{scope_verified:true}}]});\n`;
  }
  return code+"export default workflow('development-observer-db-preflight','Development — Observer DB preflight (unbound)').add(start).to(guard).to(ingress).to(assertIngress).to(watch).to(assertWatch).to(summary);\n";
}
if(require.main===module)process.stdout.write(build());
module.exports={build,definitions,GUARD};
