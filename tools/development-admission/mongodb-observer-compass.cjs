'use strict';
// Uses an already connected Compass/mongosh Db. No URI/password or new connection.
const {DATABASE,COLLECTIONS}=require('./mongodb-observer.cjs');
const {prepare,initialize}=require('./mongodb-observer-initialize.cjs');
const names=Object.values(COLLECTIONS);
const writeConcern=options=>{
  if(options?.w!=='majority'||options.j!==true||options.wtimeoutMS!==3000)throw Error('Reviewed write concern required');
  return {w:'majority',j:true,wtimeout:3000};
};
function shellPort(shellDb){
  if(shellDb.getName()!==DATABASE)throw Error('Expected ai-os shell context');
  const command=async input=>{
    let r;try{r=await shellDb.runCommand(input);}catch{throw Error('Compass command unavailable');}
    if(r?.ok!==1||r.writeConcernError||r.writeErrors?.length)throw Error('Compass command unconfirmed');
    return r;
  };
  const batch=(r,ns)=>{
    if(!r.cursor||String(r.cursor.id)!=='0'||r.cursor.ns!==ns||!Array.isArray(r.cursor.firstBatch))throw Error('Incomplete Compass cursor');
    return r.cursor.firstBatch;
  };
  const allowed=name=>{if(!names.includes(name))throw Error('Observer collection only');};
  return {databaseName:DATABASE,
    listCollections:filter=>{allowed(filter.name);return {toArray:async()=>batch(await command({listCollections:1,filter:{name:filter.name},nameOnly:true,
      authorizedCollections:false,cursor:{batchSize:100},maxTimeMS:3000}),DATABASE+'.$cmd.listCollections')};},
    createCollection:async(name,options)=>{allowed(name);return command({create:name,validator:options.validator,validationLevel:options.validationLevel,validationAction:options.validationAction,writeConcern:writeConcern(options.writeConcern),maxTimeMS:3000});},
    collection:name=>{allowed(name);return {
      insertOne:async(doc,options)=>{
        const r=await command({insert:name,documents:[doc],ordered:true,writeConcern:writeConcern(options.writeConcern),maxTimeMS:3000});
        if(r.n!==1)throw Error('Seed insert unconfirmed');return {acknowledged:true};
      },
      findOne:async(filter)=>{
        const r=await command({find:name,filter,limit:1,singleBatch:true,readConcern:{level:'majority'},maxTimeMS:3000});
        const rows=batch(r,DATABASE+'.'+name);if(rows.length>1)throw Error('Unexpected seed count');return rows[0]??null;
      },
    };},
  };
}
async function inspectCompass(shellDb,proposal){
  const exact=await prepare(shellPort(shellDb),{binding:proposal.binding_sha256,baseline:new Date(proposal.baseline)});
  if(JSON.stringify(exact)!==JSON.stringify(proposal))throw Error('Compass plan mismatch');
  return {action:'compass-preflight-passed',database:DATABASE,plan_sha256:exact.plan_sha256,existing_observer_collections:0,write_attempted:false};
}
async function initializeCompass(shellDb,proposal,{approved=false,planSha256}={}){
  if(approved!==true||planSha256!==proposal?.plan_sha256)return {action:'initialization-not-authorized',write_attempted:false};
  return initialize(shellPort(shellDb),proposal,{approved,planSha256});
}
module.exports={shellPort,inspectCompass,initializeCompass};
