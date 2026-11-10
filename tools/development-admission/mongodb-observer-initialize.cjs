'use strict';
// Explicit injected administrative DB only. No connection, CLI, credential or scheduler.
const {specification}=require('./mongodb-observer-schema.cjs');
const {DATABASE,COLLECTIONS}=require('./mongodb-observer.cjs');
const {hash}=require('./external-observer-protocol.cjs');
const concern={w:'majority',j:true,wtimeoutMS:3000};
function plan(binding,baseline){
  const spec=specification(binding,baseline,'production');
  const content={schema_version:1,database:DATABASE,binding_sha256:binding,baseline:baseline.toISOString(),
    collections:spec.collections,collection_names:spec.collection_names,seeds:spec.seeds,
    users_created:0,roles_created:0,enabled:false};
  return {...content,plan_sha256:hash(content)};
}
async function vacant(db){
  if(db.databaseName!==DATABASE)throw Error('Wrong database');
  // Atlas rejected the aggregate $in name filter in a real read-only preflight.
  // Five exact-name reads also work there; never enumerate unrelated collections.
  for(const name of Object.values(COLLECTIONS)){
    const existing=await db.listCollections({name},{nameOnly:true,maxTimeMS:3000}).toArray();
    if(existing.length)throw Error('Observer namespace already exists; manual review required');
  }
}
async function prepare(db,{binding,baseline}){
  const proposal=plan(binding,baseline);await vacant(db);return proposal;
}
async function initialize(db,proposal,{approved=false,planSha256}={}){
  // A reviewed plan is not authorization by itself. No operation before this gate.
  if(approved!==true)return {action:'initialization-not-authorized',write_attempted:false};
  let attempted=false;
  try{
    const exact=plan(proposal.binding_sha256,new Date(proposal.baseline));
    if(planSha256!==exact.plan_sha256||JSON.stringify(proposal)!==JSON.stringify(exact))throw Error('Plan mismatch');
    await vacant(db);
    for(const name of Object.keys(exact.collections)){
      attempted=true;
      await db.createCollection(COLLECTIONS[name],{validator:exact.collections[name],validationLevel:'strict',
        validationAction:'error',writeConcern:concern,maxTimeMS:3000});
      if(exact.seeds[name]){
        // Registry is first. Its unique disabled insert arbitrates concurrent initializers.
        // Never upsert, reset, roll back by dropping, or resume after an uncertain result.
        const result=await db.collection(COLLECTIONS[name]).insertOne(exact.seeds[name],{writeConcern:concern,maxTimeMS:3000});
        if(result.acknowledged!==true)throw Error('Unknown seed result');
      }
    }
    for(const [name,seed] of Object.entries(exact.seeds)){
      const actual=await db.collection(COLLECTIONS[name]).findOne({_id:seed._id},{readConcern:{level:'majority'},maxTimeMS:3000});
      if(JSON.stringify(actual)!==JSON.stringify(seed))throw Error('Seed readback mismatch');
    }
    return {action:'initialized-disabled',write_attempted:true,plan_sha256:exact.plan_sha256,
      collections:5,seeds:3,users_created:0,roles_created:0,enabled:false};
  }catch{
    return {action:attempted?'initialization-uncertain-manual-review':'initialization-refused',
      write_attempted:attempted,automatic_retry:false,cleanup_attempted:false,enabled:false};
  }
}
module.exports={plan,prepare,initialize};
