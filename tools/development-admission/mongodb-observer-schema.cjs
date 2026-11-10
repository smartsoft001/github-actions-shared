'use strict';
// Reviewable admin specification only. No client, user, password or apply action.
const {MONITOR,ISSUES}=require('./external-observer-protocol.cjs');
const {DATABASE}=require('./mongodb-observer.cjs');
const hex={bsonType:'string',pattern:'^[a-f0-9]{64}$'};
const monitor={bsonType:'string',enum:[MONITOR]};
const date={bsonType:'date'};
const integer={bsonType:['int','long','double'],minimum:0,maximum:9007199254740991};
function object(properties,required=Object.keys(properties)){return {bsonType:'object',additionalProperties:false,required,properties};}
const reasons={bsonType:'array',maxItems:9,uniqueItems:true,items:{bsonType:'string',enum:Object.keys(ISSUES)}};
const packet=object({schema_version:{enum:[1]},monitor_id:monitor,binding_sha256:hex,
  sequence:{...integer,minimum:1},cycle_id:{bsonType:'string',pattern:'^[a-f0-9]{32}$'},
  cycle_finished_at:{bsonType:['int','long','double'],minimum:0},sent_at:{bsonType:['int','long','double'],minimum:0},
  monitor:{enum:['alive','unknown']},delivery:{enum:['unknown','pending','idle-unverified','provider-accepted-history']},issues:reasons});
const registry=object({_id:monitor,scope:{enum:['production','manual-test']},binding_sha256:hex,
  enabled:{bsonType:'bool'},ingress_verified:{bsonType:'bool'},external_host_verified:{bsonType:'bool'},
  fallback_verified:{bsonType:'bool'},observe_since:date});
const nullable=spec=>({oneOf:[{bsonType:'null'},spec]});
const definitions={
  registry:{$and:[{$jsonSchema:registry},{$or:[{enabled:false},{ingress_verified:true,external_host_verified:true,fallback_verified:true}]}]},
  heartbeats:{$jsonSchema:object({_id:monitor,binding_sha256:hex,revision:integer,
    heartbeat:nullable(object({packet,packet_sha256:hex,received_at:date}))})},
  reservations:{$jsonSchema:object({_id:monitor,binding_sha256:hex,revision:integer,
    last_attempt:nullable(object({notice_id:hex,at:date}))})},
  notices:{$jsonSchema:object({_id:hex,monitor_id:monitor,binding_sha256:hex,attempted_at:date,issues:reasons})},
  receipts:{$jsonSchema:object({_id:hex,provider_status:{enum:[1]},request:{bsonType:'string',pattern:'^[A-Za-z0-9-]{8,100}$'},acknowledged_at:date})},
};
const privilege=(collection,actions)=>({resource:{db:DATABASE,collection},actions});
const roles=[
  {role:'development_observer_ingress',privileges:[privilege('registry',['find']),privilege('heartbeats',['find','update'])],roles:[]},
  {role:'development_observer_watch',privileges:[privilege('registry',['find']),privilege('heartbeats',['find']),
    privilege('reservations',['find','update']),privilege('notices',['find','insert']),privilege('receipts',['find','insert'])],roles:[]},
];
function specification(binding,baseline,scope='production'){
  if(!/^[a-f0-9]{64}$/.test(binding)||!(baseline instanceof Date)||!Number.isFinite(baseline.getTime())
      ||!['production','manual-test'].includes(scope))throw Error('Reviewed Mongo bootstrap required');
  return {database:DATABASE,collections:definitions,roles,
    seeds:{registry:{_id:MONITOR,scope,binding_sha256:binding,enabled:false,ingress_verified:false,
      external_host_verified:false,fallback_verified:false,observe_since:baseline},
    heartbeats:{_id:MONITOR,binding_sha256:binding,revision:0,heartbeat:null},
    reservations:{_id:MONITOR,binding_sha256:binding,revision:0,last_attempt:null}},
    users_created:0,apply:false};
}
module.exports={specification};
