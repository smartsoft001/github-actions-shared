// Offline compiler only. No API, model, process launch or workflow publication.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const baselines = require('./producer-baselines.json').snapshots;
const registryFile = path.join(__dirname, '../../.github/actions/development-admission/ownership.json');
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
const digest = value => createHash('sha256').update(stable(value)).digest('hex');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const KEY = /^[A-Z][A-Z0-9]{1,15}-[1-9][0-9]{0,8}$/;
function validateRegistry(registry) {
  if (!registry || stable(Object.keys(registry).sort()) !== stable(['entries','schema_version']) ||
      registry.schema_version !== 1 || !Array.isArray(registry.entries)) throw Error('Invalid ownership registry');
  const ids = new Set(), keys = new Set();
  for (const r of registry.entries) {
    if (!r || stable(Object.keys(r).sort()) !== stable(['issue_id','issue_key','reason','repository']) ||
        typeof r.issue_id !== 'string' || !UUID.test(r.issue_id) || typeof r.issue_key !== 'string' || !KEY.test(r.issue_key) ||
        typeof r.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r.repository) ||
        typeof r.reason !== 'string' || !r.reason || ids.has(r.issue_id) || keys.has(r.issue_key)) throw Error('Invalid ownership registry');
    ids.add(r.issue_id); keys.add(r.issue_key);
  }
}
function guardSource(registry) {
  validateRegistry(registry);
  return `const DEV_OWNERSHIP = ${JSON.stringify(registry.entries.map(({issue_id,issue_key})=>({issue_id,issue_key})))};
const DEV_UUID = ${UUID};
const DEV_KEY = ${KEY};
function devAdmission(issue) {
  if (DEV_OWNERSHIP.some(r => r.issue_id === issue?.id || r.issue_key === issue?.identifier)) return 'coordinator-owned';
  if (!issue || typeof issue.id !== 'string' || !DEV_UUID.test(issue.id) || typeof issue.identifier !== 'string' || !DEV_KEY.test(issue.identifier)) throw Error('Development producer: invalid issue identity');
  const labels = issue.labels;
  if (!labels || !Array.isArray(labels.nodes) || labels.pageInfo?.hasNextPage !== false) throw Error('Development producer: incomplete label inventory');
  const seen = new Set();
  for (const label of labels.nodes) {
    if (!label || typeof label.id !== 'string' || !DEV_UUID.test(label.id) || typeof label.name !== 'string' || seen.has(label.id)) throw Error('Development producer: invalid label inventory');
    seen.add(label.id);
  }
  return labels.nodes.some(l => l.name === 'AI Skip CI') ? 'ai-skip-ci' : null;
}
`;
}
function snapshotFromMcp(w) {
  if (!w || w.active!==true || w.activeVersion?.sameAsDraft!==true ||
      !Array.isArray(w.nodes) || !w.connections || typeof w.versionId!=='string' ||
      typeof w.activeVersionId!=='string') throw Error('Full published graph without draft drift required');
  const snapshot={id:w.id,active:w.active,activeVersionId:w.activeVersionId,draftVersionId:w.versionId,
    nodes:w.nodes.map(n=>({name:n.name,type:n.type,
      ...(n.name==='Filter & Enrich'?{parameters:{mode:n.parameters?.mode,jsCode:n.parameters?.jsCode}}
        :/^Linear: Fetch/.test(n.name)?{parameters:{method:n.parameters?.method,url:n.parameters?.url,jsonBody:n.parameters?.jsonBody}}:{})})),
    connections:w.connections};
  return JSON.parse(JSON.stringify(snapshot));
}
function fenced(workflow) {
  const risky = new Set(workflow.nodes.filter(n => /openAi|anthropic|langchain.*agent/.test(n.type) || /^GitHub: dispatch/.test(n.name)).map(n=>n.name));
  const starts = workflow.nodes.filter(n=>/Trigger$/.test(n.type)).map(n=>n.name);
  if (!starts.length || !risky.size) throw Error('Unrecognized producer topology');
  const queue = [...starts], seen = new Set();
  while(queue.length) {
    const name=queue.shift();
    if (name === 'Filter & Enrich' || seen.has(name)) continue;
    if (risky.has(name)) throw Error('Producer can bypass admission');
    seen.add(name);
    for (const ports of Object.values(workflow.connections[name] || {}))
      for (const edges of ports) for(const edge of edges) queue.push(edge.node);
  }
}
function once(source, old, replacement) {
  if (typeof source !== 'string' || source.split(old).length !== 2) throw Error('Unrecognized source shape');
  return source.replace(old, replacement);
}
function compile(snapshots, registry=JSON.parse(fs.readFileSync(registryFile,'utf8'))) {
  validateRegistry(registry);
  if (digest(registry)!==digest(JSON.parse(fs.readFileSync(registryFile,'utf8')))) throw Error('Ownership registry must match reviewed source');
  if (!Array.isArray(snapshots) || snapshots.length !== baselines.length) throw Error('Complete two-producer inventory required');
  const changes=[];
  for(const baseline of baselines) {
    const hits=snapshots.filter(w=>w.id===baseline.id);
    if (hits.length!==1 || hits[0].active!==true || digest(hits[0])!==digest(baseline)) throw Error('Producer version, code or topology drift');
    const w=hits[0]; fenced(w);
    const filter=w.nodes.find(n=>n.name==='Filter & Enrich');
    const query=w.nodes.find(n=>/^Linear: Fetch/.test(n.name));
    if (query?.parameters.method!=='POST' || query.parameters.url!=='https://api.linear.app/graphql') throw Error('Unrecognized source endpoint');
    let code=once(filter?.parameters.jsCode, 'const resp = $input.first().json;',
      "const resp = $input.first().json;\nif (!resp || !Array.isArray(resp.data?.projects?.nodes) || (resp.errors != null && (!Array.isArray(resp.errors) || resp.errors.length))) throw Error('Development producer: source read failed');");
    code=guardSource(registry)+once(code,'for (const issue of issues) {','for (const issue of issues) {\n    if (devAdmission(issue)) continue;');
    const body=once(query.parameters.jsonBody,'labels(first: 20) { nodes { name } }',
      'labels(first: 100) { nodes { id name } pageInfo { hasNextPage endCursor } }');
    changes.push({workflowId:w.id,expectedActiveVersionId:w.activeVersionId,expectedDraftVersionId:w.draftVersionId,expectedFingerprint:digest(w),operations:[
      {type:'setNodeParameter',nodeName:query.name,path:'jsonBody',value:body},
      {type:'setNodeParameter',nodeName:filter.name,path:'jsCode',value:code}
    ]});
  }
  return {schema_version:1,apply:false,model_calls:0,source_writes:0,registry_sha256:digest(registry),changes};
}
module.exports={compile,digest,baselines,fenced,snapshotFromMcp};
