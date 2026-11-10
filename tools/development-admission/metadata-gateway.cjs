'use strict';
const TARGETS = ['Kj0Bm4Q2XnRtKsn1', 'YfyZaVDeZspB8VgK'];
const STATUSES = ['error', 'crashed', 'unknown'];

function validateRequest(request, now) {
  const q = request.query;
  const keys = ['workflowId', 'status', 'startedAfter', 'startedBefore'];
  if (!Number.isFinite(now) || !q || typeof q !== 'object' || Array.isArray(q)
      || Object.keys(q).length !== keys.length || !Object.keys(q).every(k=>keys.includes(k)) || !keys.every(k => typeof q[k] === 'string')
      || !TARGETS.includes(q.workflowId) || !STATUSES.includes(q.status)
      || (request.body && Object.keys(request.body).length)) throw Error('Invalid metadata request');
  const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  const start = Date.parse(q.startedAfter), end = Date.parse(q.startedBefore);
  if (!zoned.test(q.startedAfter) || !zoned.test(q.startedBefore) || !Number.isFinite(start)
      || !Number.isFinite(end) || start >= end || end - start > 86400000
      || end > now || now - end > 30000) throw Error('Invalid metadata window');
  return { workflowId:q.workflowId, status:q.status, startedAfter:new Date(start).toISOString(),
    startedBefore:new Date(end).toISOString(), observed_at:now/1000 };
}

function normalizePages(pages, query, now) {
  if (!Number.isFinite(now) || now/1000-query.observed_at < 0 || now/1000-query.observed_at > 30
      || !Array.isArray(pages) || !pages.length || pages.length > 20) throw Error('Incomplete metadata read');
  const rows = [], ids = new Set(), cursors = new Set();
  for (let i=0;i<pages.length;i++) {
    const p=pages[i];
    if (!p || !Array.isArray(p.data) || p.data.length > 100 || !Object.hasOwn(p,'nextCursor')
        || (p.nextCursor !== null && (typeof p.nextCursor !== 'string' || !/^[A-Za-z0-9_+=/.-]{1,1024}$/.test(p.nextCursor)))
        || (i===pages.length-1 ? p.nextCursor !== null : p.nextCursor === null)
        || (p.nextCursor && cursors.has(p.nextCursor))) throw Error('Incomplete metadata pagination');
    if (p.nextCursor) cursors.add(p.nextCursor);
    if (!p.data.length && p.nextCursor !== null) throw Error('Empty partial page');
    for (const r of p.data) {
      const stamp=Date.parse(r.startedAt);
      if (typeof r.id !== 'string' || !/^[1-9][0-9]{0,31}$/.test(r.id) || ids.has(r.id)
          || r.workflowId !== query.workflowId || r.status !== query.status
          || typeof r.startedAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(r.startedAt)
          || !Number.isFinite(stamp) || stamp <= Date.parse(query.startedAfter)
          || stamp >= Date.parse(query.startedBefore)) throw Error('Invalid metadata row');
      ids.add(r.id); rows.push({id:r.id,workflowId:r.workflowId,status:r.status,startedAt:r.startedAt});
      if (rows.length>2000) throw Error('Metadata limit exceeded');
    }
  }
  return {schema_version:1,workflow_id:query.workflowId,status:query.status,
    observed_at:query.observed_at,started_after:query.startedAfter,started_before:query.startedBefore,
    complete:true,estimated:false,count:rows.length,data:rows};
}
function requestEnvelope(request, now) {
  try { return {allowed:true,...validateRequest(request,now)}; }
  catch { return {allowed:false,reply_code:400,reply_body:{schema_version:1,error:'invalid_metadata_request'}}; }
}

function responseEnvelope(pages, query, now) {
  try { return {reply_code:200,reply_body:normalizePages(pages,query,now)}; }
  catch { return {reply_code:503,reply_body:{schema_version:1,error:'metadata_unavailable'}}; }
}
module.exports={validateRequest,normalizePages,requestEnvelope,responseEnvelope};
