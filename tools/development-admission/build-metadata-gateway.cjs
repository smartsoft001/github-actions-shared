'use strict';
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('./metadata-gateway.cjs'),'utf8').replace('module.exports={validateRequest,normalizePages};','');
const authName='Development Producer Metadata Gateway';
const definitions=[
  ['entry','trigger','n8n-nodes-base.webhook',2.1,{name:'Authenticated metadata request',disabled:true,parameters:{httpMethod:'GET',path:'development-producer-metadata-v1',authentication:'headerAuth',responseMode:'responseNode',options:{}},credentials:{httpHeaderAuth:{name:authName}}}],
  ['guard','node','n8n-nodes-base.code',2,{name:'Validate metadata scope',parameters:{mode:'runOnceForAllItems',jsCode:'throw new Error("Dedicated Header Auth setup incomplete");\n'+source+'\nreturn [{json:validateRequest($json, Date.now())}];'}}],
  ['read','node','n8n-nodes-base.httpRequest',4.5,{name:'Read bounded execution metadata',parameters:{method:'GET',url:'https://n8n.smartsoft.biz.pl/api/v1/executions',authentication:'predefinedCredentialType',nodeCredentialType:'n8nApi',sendQuery:true,queryParameters:{parameters:[{name:'workflowId',value:'EXPR:{{ $json.workflowId }}'},{name:'status',value:'EXPR:{{ $json.status }}'},{name:'startedAfter',value:'EXPR:{{ $json.startedAfter }}'},{name:'startedBefore',value:'EXPR:{{ $json.startedBefore }}'},{name:'includeData',value:'false'},{name:'limit',value:'100'}]},options:{timeout:10000,redirect:{redirect:{followRedirects:false}},sendCredentialsOnCrossOriginRedirect:false,response:{response:{responseFormat:'json'}},pagination:{pagination:{paginationMode:'updateAParameterInEachRequest',parameters:{parameters:[{type:'qs',name:'cursor',value:'EXPR:{{ $response.body.nextCursor }}'}]},paginationCompleteWhen:'other',completeExpression:'EXPR:{{ $response.body.nextCursor === null }}',limitPagesFetched:true,maxRequests:20,requestInterval:0}}}},credentials:{n8nApi:{id:'a9ODOIqSIyJWUvRK',name:'n8n internal'}},retryOnFail:false,onError:'stopWorkflow'}],
  ['project','node','n8n-nodes-base.code',2,{name:'Return complete safe metadata',parameters:{mode:'runOnceForAllItems',jsCode:source+'\nconst query=$("Validate metadata scope").first().json;\nreturn [{json:normalizePages($input.all().map(i=>i.json), query, Date.now())}];'}}],
  ['reply','node','n8n-nodes-base.respondToWebhook',1.5,{name:'Metadata JSON response',parameters:{respondWith:'json',responseBody:'EXPR:{{ $json }}',options:{responseCode:200,responseHeaders:{entries:[{name:'Cache-Control',value:'no-store'}]}}}}],
];
function literal(value) {
  if (typeof value==='string' && value.startsWith('EXPR:')) return 'expr('+JSON.stringify(value.slice(5))+')';
  if (Array.isArray(value)) return '['+value.map(literal).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+':'+literal(v)).join(',')+'}';
  return JSON.stringify(value);
}
function build() {
  let code="import { workflow,node,trigger,expr,newCredential } from '@n8n/workflow-sdk';\n";
  for (const [id,method,type,version,config] of definitions) {
    let c=literal(config);
    if(id==='entry') c=c.replace(literal({name:authName}),'newCredential('+JSON.stringify(authName)+')');
    const sample=id==='guard'?{workflowId:'Kj0Bm4Q2XnRtKsn1',status:'error',startedAfter:'2026-11-09T09:00:00Z',startedBefore:'2026-11-09T10:00:00Z',observed_at:1794218400}:id==='read'?{data:[],nextCursor:null}:{};
    code+='const '+id+'='+method+'({type:'+JSON.stringify(type)+',version:'+version+',config:'+c+',output:[{json:'+literal(sample)+'}]});\n';
  }
  return code+"export default workflow('development-producer-metadata-gateway','Development — Producer metadata gateway (unpublished)').add(entry).to(guard).to(read).to(project).to(reply);\n";
}
if(require.main===module) process.stdout.write(build());
module.exports={build,definitions};
