'use strict';
const {specification}=require('./mongodb-observer-schema.cjs');
const {DATABASE}=require('./mongodb-observer.cjs');
const spec=()=>specification('b'.repeat(64),new Date(0));
const identities={ingress:{username:'ai_os_observer_ingress',role:'development_observer_ingress'},observe:{username:'ai_os_observer_watch',role:'development_observer_watch'}};
function roleFor(mode){const identity=identities[mode];if(!identity)throw Error('Unknown observer mode');return spec().roles.find(r=>r.role===identity.role);}
function atlasRoles(){
  return Object.keys(identities).map(mode=>{
    const r=roleFor(mode),grouped=new Map();
    for(const p of r.privileges)for(const action of p.actions){
      const key=action.toUpperCase();if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push({cluster:false,db:DATABASE,collection:p.resource.collection});
    }
    return {roleName:r.role,actions:[...grouped].map(([action,resources])=>({action,resources})),inheritedRoles:[]};
  });
}
function accessPlan(){return {schema_version:1,database:DATABASE,project_id:null,cluster_name:null,apply:false,
  atlas_roles:atlasRoles(),users:Object.values(identities).map(x=>({username:x.username,databaseName:'admin',roles:[{databaseName:'admin',roleName:x.role}],cluster_scope:null,password_present:false,created:false})),
  credential_bindings:{ingress:null,observe:null},runtime_enabled:false};}
function verifyIdentity(status,mode){
  try{
    const expected=identities[mode],auth=status.authInfo;
    if(status.ok!==1||!expected||auth.authenticatedUsers.length!==1||auth.authenticatedUserRoles.length!==1)return false;
    const user=auth.authenticatedUsers[0],role=auth.authenticatedUserRoles[0];
    if(user.user!==expected.username||!['admin',DATABASE].includes(user.db)||role.role!==expected.role||!['admin',DATABASE].includes(role.db))return false;
    const actual=[];
    for(const p of auth.authenticatedUserPrivileges){
      if(p.resource.anyResource||p.resource.cluster||p.resource.db!==DATABASE||!p.resource.collection)return false;
      for(const action of p.actions)actual.push(p.resource.collection+':'+action);
    }
    const wanted=roleFor(mode).privileges.flatMap(p=>p.actions.map(a=>p.resource.collection+':'+a));
    return JSON.stringify([...new Set(actual)].sort())===JSON.stringify(wanted.sort());
  }catch{return false;}
}
module.exports={identities,roleFor,atlasRoles,accessPlan,verifyIdentity};
