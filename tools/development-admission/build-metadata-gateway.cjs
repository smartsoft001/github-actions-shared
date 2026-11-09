'use strict';
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('./metadata-gateway.cjs'),'utf8').replace(/module\.exports=[^\n]+;\s*$/,'');
const authName='Development Producer Metadata Gateway';
const definitions=[
  ['entry','trigger','n8n-nodes-base.webhook',2.1,{name:'Authenticated metadata request',disabled:true,parameters:{httpMethod:'GET',path:'development-producer-metadata-v1',authentication:'headerAuth',responseMode:'responseNode',options:{}},credentials:{httpHeaderAuth:{id:'0tGUT0V8GTxSHYch',name:authName}}}],
  ['guard','node','n8n-nodes-base.code',2,{name:'Validate metadata scope',parameters:{mode:'runOnceForAllItems',jsCode:'throw new Error("Dedicated Header Auth setup incomplete");\n'+source+'\nreturn [{json:requestEnvelope($json, Date.now())}];'}}],
  ['route','ifElse','n8n-nodes-base.if',2.2,{name:'Allowed metadata scope?',parameters:{conditions:{options:{caseSensitive:true,typeValidation:'strict'},conditions:[{leftValue:'EXPR:{{ $json.allowed }}',operator:{type:'boolean',operation:'true'}}],combinator:'and'},looseTypeValidation:false}}],
  ['read','node','n8n-nodes-base.httpRequest',4.5,{name:'Read bounded execution metadata',parameters:{method:'GET',url:'https://n8n.smartsoft.biz.pl/api/v1/executions',authentication:'predefinedCredentialType',nodeCredentialType:'n8nApi',sendQuery:true,queryParameters:{parameters:[{name:'workflowId',value:'EXPR:{{ $json.workflowId }}'},{name:'status',value:'EXPR:{{ $json.status }}'},{name:'startedAfter',value:'EXPR:{{ $json.startedAfter }}'},{name:'startedBefore',value:'EXPR:{{ $json.startedBefore }}'},{name:'includeData',value:'false'},{name:'limit',value:'100'}]},options:{timeout:10000,redirect:{redirect:{followRedirects:false}},sendCredentialsOnCrossOriginRedirect:false,response:{response:{responseFormat:'json'}},pagination:{pagination:{paginationMode:'updateAParameterInEachRequest',parameters:{parameters:[{type:'qs',name:'cursor',value:'EXPR:{{ $response.body.nextCursor }}'}]},paginationCompleteWhen:'other',completeExpression:'EXPR:{{ $response.body.nextCursor === null }}',limitPagesFetched:true,maxRequests:20,requestInterval:0}}}},credentials:{n8nApi:{id:'a9ODOIqSIyJWUvRK',name:'n8n internal'}},retryOnFail:false,onError:'continueRegularOutput'}],
  ['project','node','n8n-nodes-base.code',2,{name:'Return complete safe metadata',parameters:{mode:'runOnceForAllItems',jsCode:source+'\nconst query=$("Validate metadata scope").first().json;\nreturn [{json:responseEnvelope($input.all().map(i=>i.json), query, Date.now())}];'}}],
  ['reply','node','n8n-nodes-base.respondToWebhook',1.5,{name:'Metadata JSON response',parameters:{respondWith:'json',responseBody:'EXPR:{{ $json.reply_body }}',options:{responseCode:'EXPR:{{ $json.reply_code }}',responseHeaders:{entries:[{name:'Cache-Control',value:'no-store'}]}}}}],
];
function literal(value) {
  if (typeof value==='string' && value.startsWith('EXPR:')) return 'expr('+JSON.stringify(value.slice(5))+')';
  if (Array.isArray(value)) return '['+value.map(literal).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+':'+literal(v)).join(',')+'}';
  return JSON.stringify(value);
}
function build() {
  let code="import { workflow,node,trigger,ifElse,expr } from '@n8n/workflow-sdk';\n";
  for (const [id,method,type,version,config] of definitions) {
    let c=literal(config);
    const sample=id==='guard'?{allowed:true,workflowId:'Kj0Bm4Q2XnRtKsn1',status:'error',startedAfter:'2026-11-09T09:00:00Z',startedBefore:'2026-11-09T10:00:00Z',observed_at:1794218400}:id==='read'?{data:[],nextCursor:null}:id==='project'?{reply_code:200,reply_body:{schema_version:1,complete:true,count:0,data:[]}}:{};
    code+='const '+id+'='+method+'({type:'+JSON.stringify(type)+',version:'+version+',config:'+c+',output:[{json:'+literal(sample)+'}]});\n';
  }
  return code+"export default workflow('development-producer-metadata-gateway','Development — Producer metadata gateway (unpublished)').add(entry).to(guard).to(route.onTrue(read.to(project.to(reply))).onFalse(reply));\n";
}
if(require.main===module) process.stdout.write(build());
module.exports={build,definitions};
