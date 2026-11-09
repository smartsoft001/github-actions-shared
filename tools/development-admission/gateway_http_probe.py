"""Prepared one-request HTTP probe. CLI only prints a plan; never opens a URL.

perform_one is for a future explicitly authorized supervised test-listener window.
No workflow mutation, listener creation, activation, retry, model or alert sender.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from producer_monitor import TARGETS, FAILURES, RUN, private

URL = 'https://n8n.smartsoft.biz.pl/webhook-test/development-producer-metadata-v1'
HEADER = 'X-Development-Metadata-Key'
MAX_BODY = 524288


def iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec='milliseconds')


def cases(now):
    base = {'workflowId':next(iter(TARGETS)), 'status':'error',
            'startedAfter':iso(now-3600), 'startedBefore':iso(now-1)}
    result = [{'name':'missing-auth','auth':'missing','query':dict(base),'expect':'auth-refusal'},
              {'name':'wrong-auth','auth':'wrong','query':dict(base),'expect':'auth-refusal'}]
    for name, change in [('foreign-workflow', {'workflowId':'ForeignWorkflow001'}),
                         ('success-status', {'status':'success'}),
                         ('extra-field', {'includeData':'true'}),
                         ('wide-window', {'startedAfter':iso(now-86402)}),
                         ('stale-window', {'startedBefore':iso(now-31)})]:
        result.append({'name':name,'auth':'valid','query':{**base,**change},'expect':'scope-refusal'})
    for target in TARGETS:
        for status in FAILURES:
            result.append({'name':target+'-'+status,'auth':'valid',
                           'query':{**base,'workflowId':target,'status':status},'expect':'metadata'})
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def assess(case, status, payload, now):
    if case['expect']!='metadata':
        try:
            body=json.loads(payload)
            if isinstance(body,list) or isinstance(body,dict) and ('data' in body or 'workflow_id' in body):
                return 'failed'
        except Exception:
            pass
    if case['expect'] == 'auth-refusal':
        return 'candidate-auth-refusal' if status in (401,403) else 'failed'
    if case['expect'] == 'scope-refusal':
        # A500 alone does not prove the guard stopped access: check n8n readback.
        return 'candidate-scope-refusal' if status in (400,422,500) else 'failed'
    try:
        d=json.loads(payload)
        expected={'schema_version','workflow_id','status','observed_at','started_after',
                  'started_before','complete','estimated','count','data'}
        if (status!=200 or set(d)!=expected or type(d['schema_version']) is not int or d['schema_version']!=1
                or d['workflow_id']!=case['query']['workflowId'] or d['status']!=case['query']['status']
                or d['complete'] is not True or d['estimated'] is not False or type(d['count']) is not int
                or not isinstance(d['data'],list) or not 0<=d['count']<=2000 or len(d['data'])!=d['count']
                or type(d['observed_at']) not in (int,float) or not 0<=now-d['observed_at']<=30):
            return 'failed'
        def epoch(value):
            stamp=datetime.fromisoformat(value)
            if stamp.utcoffset() is None: raise ValueError('Timezone required')
            return stamp.timestamp()
        lo=epoch(d['started_after']);hi=epoch(d['started_before'])
        if lo!=datetime.fromisoformat(case['query']['startedAfter']).timestamp() or hi!=datetime.fromisoformat(case['query']['startedBefore']).timestamp():
            return 'failed'
        ids=set()
        for r in d['data']:
            stamp=epoch(r['startedAt'])
            if (set(r)!={'id','workflowId','status','startedAt'} or r['workflowId']!=d['workflow_id']
                    or r['status']!=d['status'] or not isinstance(r['id'],str) or not RUN.fullmatch(r['id'])
                    or r['id'] in ids or not lo<stamp<hi):
                return 'failed'
            ids.add(r['id'])
        return 'candidate-valid-metadata'
    except Exception:
        return 'failed'


def perform_one(name, token_path, *, clock=time.time, opener=None):
    """Explicit one-shot port; caller must first obtain listener-window approval.

    Never call it against an unregistered test listener or with the draft locks on.
    A candidate result is not a complete acceptance or proof of source non-access.
    """
    selected=[c for c in cases(clock()) if c['name']==name]
    if len(selected)!=1:
        raise ValueError('Unknown prepared HTTP case')
    case=selected[0];headers={'Accept':'application/json'}
    if case['auth']=='wrong': headers[HEADER]='invalid-test-token-not-a-real-credential'
    elif case['auth']=='valid':
        path=private(Path(token_path));private(path.parent,True)
        token=path.read_text()
        if not 32<=len(token)<=256 or any(c.isspace() for c in token):
            raise ValueError('Invalid private gateway token')
        headers[HEADER]=token
    request=urllib.request.Request(URL+'?'+urllib.parse.urlencode(case['query']),headers=headers,method='GET')
    result={'case':name,'outcome':'unknown','http_attempts':1,'automatic_retry':False,
            'source_access_verified':False,'production_acceptance':False}
    try:
        client=opener if opener is not None else urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
        try: response=client.open(request,timeout=10)
        except urllib.error.HTTPError as e: response=e
        with response:
            body=response.read(MAX_BODY+1);status=response.code
        if len(body)>MAX_BODY: return result
        result.update(http_status=status,outcome=assess(case,status,body,clock()))
    except Exception:
        # No URLs with credentials, raw remote messages, headers or bodies in logs.
        pass
    return result


if __name__=='__main__':
    if sys.argv[1:] not in ([],['--plan']):
        raise SystemExit('Preparation only: use --plan; no HTTP was attempted')
    print(json.dumps({'schema_version':1,'mode':'preparation-only','http_attempts':0,
                      'url':URL,'cases':cases(time.time()),'runtime_activated':False}))
