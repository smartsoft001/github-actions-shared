'use strict';
// Private pipe-only payload for kubectl. Never run this helper into a log/file.
// No credential table or execution data is read. Graphs travel only to parent RAM.
const {DatabaseSync}=require('node:sqlite');
const ids=['Kj0Bm4Q2XnRtKsn1','YfyZaVDeZspB8VgK'];
const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});
const decode=(row,key,fallback)=>row[key]==null?fallback:JSON.parse(row[key]);
try{
 const observed_at=Date.now()/1000;
 db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN;');
 const entity=db.prepare('SELECT id,name,nodes,connections,settings,nodeGroups,versionId,activeVersionId,active FROM workflow_entity WHERE id=?');
 const history=db.prepare('SELECT nodes,connections,nodeGroups FROM workflow_history WHERE workflowId=? AND versionId=?');
 const workflows=ids.map(id=>{
  const row=entity.get(id);if(!row)throw Error();
  const w={id,name:row.name,nodes:decode(row,'nodes',[]),connections:decode(row,'connections',{}),settings:decode(row,'settings',{}),nodeGroups:decode(row,'nodeGroups',[]),versionId:row.versionId,activeVersionId:row.activeVersionId,active:row.active===1,activeVersion:null};
  if(w.active){
   const h=history.get(id,w.activeVersionId);if(!h)throw Error();
   // Normalize historical display-name differences to entity name; executable
   // history is still read independently, never inferred from version IDs.
   w.activeVersion={sameAsDraft:false,nodes:decode(h,'nodes',[]),connections:decode(h,'connections',{}),nodeGroups:decode(h,'nodeGroups',[])};
  }
  return w;
 });
 const executions=db.prepare("SELECT id,workflowId,status FROM execution_entity WHERE workflowId IN (?,?) AND (status IS NULL OR status NOT IN ('success','error','canceled','crashed'))").all(...ids);
 db.exec('COMMIT;');
 process.stdout.write(JSON.stringify({observed_at,workflows,execution_scope:ids,executions,total_count:executions.length}));
}catch{
 process.stderr.write('Scoped read-only n8n snapshot unavailable\n');process.exitCode=1;
}finally{db.close();}
