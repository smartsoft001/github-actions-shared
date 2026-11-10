'use strict';
// Shared bounded protocol; no database or network dependency.
const crypto=require('node:crypto');
const MONITOR='development-producers';
const ISSUES={
  'health-state-unavailable':'brak rejestru pracy monitora',
  'monitor-never-started':'brak zakończonego cyklu',
  'cycle-overdue':'przekroczony czas cyklu',
  'cycle-failed':'nieudany cykl',
  'heartbeat-stale':'brak świeżego potwierdzenia cyklu',
  'delivery-state-unavailable':'brak wiarygodnego rejestru wysyłek',
  'delivery-unconfirmed':'niepotwierdzona wysyłka',
  'clock-invalid':'niewiarygodny czas',
  'heartbeat-missing':'brak potwierdzenia z ai-os-server',
};
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function packet(input,now,binding) {
  const keys=['schema_version','monitor_id','binding_sha256','sequence','cycle_id','cycle_finished_at','sent_at','monitor','delivery','issues'];
  if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>2048
      ||Object.keys(input).length!==keys.length||!keys.every(k=>Object.hasOwn(input,k))
      ||input.schema_version!==1||input.monitor_id!==MONITOR||input.binding_sha256!==binding
      ||!/^[a-f0-9]{64}$/.test(binding)||!Number.isSafeInteger(input.sequence)||input.sequence<1
      ||typeof input.cycle_id!=='string'||!/^[a-f0-9]{32}$/.test(input.cycle_id)
      ||!finite(now)||!finite(input.sent_at)||!finite(input.cycle_finished_at)
      ||input.cycle_finished_at>input.sent_at||input.sent_at>now+5||now-input.sent_at>30
      ||now-input.cycle_finished_at>180||!['alive','unknown'].includes(input.monitor)
      ||!['unknown','pending','idle-unverified','provider-accepted-history'].includes(input.delivery)
      ||!Array.isArray(input.issues)||input.issues.length>8||new Set(input.issues).size!==input.issues.length
      ||input.issues.some(x=>typeof x!=='string'||!Object.hasOwn(ISSUES,x)||x==='clock-invalid'||x==='heartbeat-missing')
      ||(input.monitor==='unknown'&&!input.issues.some(x=>['health-state-unavailable','monitor-never-started','cycle-overdue','cycle-failed','heartbeat-stale'].includes(x)))
      ||(input.monitor==='alive'&&input.issues.some(x=>['health-state-unavailable','monitor-never-started','cycle-overdue','cycle-failed','heartbeat-stale'].includes(x))))throw Error('Invalid bounded heartbeat');
  return Object.fromEntries(keys.map(k=>[k,k==='issues'?[...input[k]].sort():input[k]]));
}
async function boundedSend(send,payload,timeoutMs) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid sender timeout');
  const controller=new AbortController();let timer;
  try{return await Promise.race([
    Promise.resolve().then(()=>send(payload,{signal:controller.signal})),
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Delivery deadline'));},timeoutMs);}),
  ]);}finally{clearTimeout(timer);}
}

module.exports={MONITOR,ISSUES,packet,hash,boundedSend};
