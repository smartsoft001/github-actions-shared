const test=require('node:test');
const assert=require('node:assert/strict');
const {shellPort,inspectCompass,initializeCompass}=require('./mongodb-observer-compass.cjs');
const proposal=require('./observer-production-initialization-plan.json');
test('Compass preflight issues only filtered metadata read and refuses wrong DB/partial cursor',async()=>{
  const calls=[];
  const shell={getName:()=> 'ai-os',runCommand:async c=>{calls.push(c);return {ok:1,cursor:{id:0,ns:'ai-os.$cmd.listCollections',firstBatch:[]}};}};
  const r=await inspectCompass(shell,proposal);assert.equal(r.write_attempted,false);assert.equal(calls.length,5);
  assert.equal(calls[0].listCollections,1);assert.equal(calls[0].authorizedCollections,false);
  assert.deepEqual(calls.map(c=>c.filter.name),['registry','heartbeats','reservations','notices','receipts']);
  assert.throws(()=>shellPort({...shell,getName:()=> 'galena-tele'}));
  await assert.rejects(()=>inspectCompass({...shell,runCommand:async()=>({ok:1,cursor:{id:1,ns:'ai-os.$cmd.listCollections',firstBatch:[]}})},proposal));
});
test('Compass explicit gate precedes shell access and unknown writes never acknowledge',async()=>{
  const shell=new Proxy({},{get:()=>assert.fail('Shell accessed')});
  assert.equal((await initializeCompass(shell,proposal)).write_attempted,false);
  assert.equal((await initializeCompass(shell,proposal,{approved:true,planSha256:'wrong'})).write_attempted,false);
  for(const response of [{ok:1,n:1,writeConcernError:{code:64}},{ok:1,n:1,writeErrors:[{code:11000}]},{ok:1,n:0}]){
    const p=shellPort({getName:()=> 'ai-os',runCommand:async()=>response});
    await assert.rejects(()=>p.collection('registry').insertOne({_id:'development-producers'},{writeConcern:{w:'majority',j:true,wtimeoutMS:3000}}));
    assert.throws(()=>p.collection('test'));
  }
});
