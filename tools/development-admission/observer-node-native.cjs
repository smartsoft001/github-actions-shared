// Opt-in native n8n loader/guard test; no package installation or external network.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {stage,fixture}=require('./stage-observer-node.cjs');
async function run(installation){
  assert.equal(process.platform,'darwin');assert.equal(Number(process.versions.node.split('.')[0]),24);
  assert.equal(JSON.parse(fs.readFileSync(path.join(installation,'node_modules/n8n/package.json'))).version,'2.46.6');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'observer-n8n-native-')),extensions=path.join(root,'extensions');
  const manifest=stage(extensions),policy=path.join(root,'network.sb');
  fs.writeFileSync(policy,'(version 1) (allow default) (deny network*) (allow network-inbound (local ip "localhost:*")) (allow network-outbound (remote ip "localhost:*"))');
  const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',N8N_USER_FOLDER:path.join(root,'state'),N8N_CUSTOM_EXTENSIONS:extensions,
    DB_TYPE:'sqlite',N8N_DIAGNOSTICS_ENABLED:'false',N8N_VERSION_NOTIFICATIONS_ENABLED:'false',N8N_TEMPLATES_ENABLED:'false',N8N_LICENSE_AUTO_RENEW_ENABLED:'false',
    N8N_RUNNERS_MODE:'internal',N8N_RUNNERS_BROKER_LISTEN_ADDRESS:'127.0.0.1',N8N_RUNNERS_BROKER_PORT:'15787',N8N_LOG_LEVEL:'info',N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS:'true'};
  const cli=args=>new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/sandbox-exec',['-f',policy,process.execPath,path.join(installation,'node_modules/n8n/bin/n8n'),...args],{env,stdio:['ignore','pipe','pipe']});
    let out='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Native fixture deadline'));},60000);
    child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error('Native fixture failed: '+out.slice(-1800)));});
  });
  const results=[];
  try{
    const isolation=spawnSync('/usr/bin/sandbox-exec',['-f',policy,process.execPath,'-e','const s=require("net").connect({host:"192.0.2.1",port:9});s.on("connect",()=>process.exit(2));s.on("error",e=>process.exit(e.code==="EPERM"?0:3));setTimeout(()=>process.exit(4),1000);'],{env,timeout:2000});assert.equal(isolation.status,0);
    for(const mode of ['ingress','observe']){
      const w=fixture(mode);w.nodes[0].disabled=false;const file=path.join(root,mode+'.json');fs.writeFileSync(file,JSON.stringify(w));
      await cli(['import:workflow','--input='+file]);const raw=await cli(['execute','--id='+w.id,'--rawOutput']);const offset=raw.indexOf('{\n  "data":');assert.ok(offset>=0,raw.slice(-1800));
      const result=JSON.parse(raw.slice(offset));assert.equal(result.data.resultData.error,undefined);
      const output=result.data.resultData.runData['Prepared observer'][0].data.main[0][0].json;assert.equal(output.action,'observer-node-prepared-disabled');
      results.push({mode,custom_node_loaded:true,prepared_guard_verified:true,credentials_attached:0});
    }
    return {schema_version:1,n8n:'2.46.6',node:process.versions.node,results,stage_manifest:manifest,external_network_blocked:true,live_workflows_changed:0,model_calls:0,real_provider_calls:0,installed_on_production:false};
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
if(require.main===module){if(process.argv.length!==3)throw Error('Existing n8n installation path required');run(process.argv[2]).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={run};
