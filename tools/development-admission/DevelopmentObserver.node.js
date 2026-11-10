'use strict';
const {executeObserver}=require('./mongodb-observer-node-runtime.cjs');
class DevelopmentObserver {
  description={displayName:'AI OS Development Observer',name:'developmentObserver',group:['transform'],version:1,
    description:'Bounded heartbeat ingress or durable observer; prepared mode does not read credentials or connect',
    defaults:{name:'AI OS Development Observer'},inputs:['main'],outputs:['main'],usableAsTool:false,
    credentials:[{name:'mongoDb',required:false},{name:'pushoverApi',required:false,displayOptions:{show:{mode:['observe']}}}],
    properties:[
      {displayName:'Prepared Only',name:'preparedOnly',type:'boolean',default:true},
      {displayName:'Mode',name:'mode',type:'options',options:[{name:'Heartbeat Ingress',value:'ingress'},{name:'Observe',value:'observe'}],default:'ingress'},
      {displayName:'Approved Mongo Credential ID',name:'approvedMongoCredentialId',type:'string',default:''},
      {displayName:'Owner Recipient',name:'recipient',type:'string',typeOptions:{password:true},default:'',displayOptions:{show:{mode:['observe']}}},
    ]};
  async execute(){return executeObserver(this);}
}
module.exports={DevelopmentObserver};
