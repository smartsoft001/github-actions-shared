import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import urllib.error

import gateway_http_probe as p

NOW=1800000000
VALID=next(c for c in p.cases(NOW) if c['expect']=='metadata')


def payload(case=VALID):
    return {'schema_version':1,'workflow_id':case['query']['workflowId'],'status':case['query']['status'],
            'observed_at':NOW,'started_after':case['query']['startedAfter'],'started_before':case['query']['startedBefore'],
            'complete':True,'estimated':False,'count':0,'data':[]}


class Response(io.BytesIO):
    code=200


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'token';self.path.write_text('private-test-token-'+'x'*48);os.chmod(self.path,0o600)

    def test_cli_default_is_plan_only_and_run_is_refused(self):
        script=Path(p.__file__)
        out=subprocess.run([sys.executable,str(script),'--plan'],capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(out.stdout)['http_attempts'],0)
        self.assertNotEqual(subprocess.run([sys.executable,str(script),'--run'],capture_output=True).returncode,0)

    def test_plan_has13_cases_and_covers_both_targets_three_statuses(self):
        cases=p.cases(NOW);self.assertEqual(len(cases),13)
        self.assertEqual(len({c['name'] for c in cases}),13)
        self.assertEqual({(c['query']['workflowId'],c['query']['status']) for c in cases if c['expect']=='metadata'},
                         {(t,s) for t in p.TARGETS for s in p.FAILURES})

    def test_transport_uses_fixed_test_url_get_timeout_and_does_not_echo_token(self):
        calls=[]
        class Client:
            def open(_,req,timeout):
                calls.append((req,timeout));return Response(json.dumps(payload()).encode())
        result=p.perform_one(VALID['name'],self.path,clock=lambda:NOW,opener=Client())
        req,timeout=calls[0];self.assertTrue(req.full_url.startswith(p.URL+'?'));self.assertEqual(req.method,'GET');self.assertEqual(timeout,10)
        self.assertEqual(len(calls),1);self.assertEqual(result['outcome'],'candidate-valid-metadata')
        self.assertNotIn('private-test-token',json.dumps(result));self.assertFalse(result['production_acceptance'])

    def test_missing_and_wrong_auth_need_no_private_file(self):
        calls=[]
        class Client:
            def open(_,req,timeout):
                calls.append(req);raise urllib.error.HTTPError(req.full_url,401,'Unauthorized',{},io.BytesIO(b'{}'))
        for name in ['missing-auth','wrong-auth']:
            r=p.perform_one(name,'/not-present',clock=lambda:NOW,opener=Client());self.assertEqual(r['outcome'],'candidate-auth-refusal')
        self.assertIsNone(calls[0].get_header(p.HEADER.capitalize()))

    def test404_is_not_a_successful_rejection_and500_is_only_candidate(self):
        for case in p.cases(NOW):
            self.assertEqual(p.assess(case,404,b'{}',NOW),'failed')
        case=next(c for c in p.cases(NOW) if c['expect']=='scope-refusal')
        self.assertEqual(p.assess(case,500,b'{}',NOW),'candidate-scope-refusal')
        self.assertEqual(p.assess(case,500,b'{"data":[]}',NOW),'failed')

    def test_redirects_have_no_follow_request(self):
        self.assertIsNone(p.NoRedirect().redirect_request(None,None,302,'',{},'https://evil.invalid'))

    def test_lost_response_is_unknown_and_never_retried_or_logged(self):
        calls=[]
        class Client:
            def open(_,req,timeout):calls.append(req);raise TimeoutError('SECRET-REMOTE-ERROR')
        result=p.perform_one(VALID['name'],self.path,clock=lambda:NOW,opener=Client())
        self.assertEqual(len(calls),1);self.assertEqual(result['outcome'],'unknown');self.assertNotIn('SECRET',json.dumps(result))

    def test_wrong_scope_partial_stale_or_extra_payload_refused(self):
        for changes in [{'complete':False},{'estimated':True},{'count':1},{'workflow_id':'ForeignWorkflow001'},
                        {'observed_at':NOW-31},{'data':[],'prompt':'PRIVATE'},{'count':True},{'started_after':'2027-01-15T07:00:00'}]:
            d=payload();d.update(changes);self.assertEqual(p.assess(VALID,200,json.dumps(d),NOW),'failed')

    def test_rows_require_exact_fields_scope_timezone_and_unique_ids(self):
        r={'id':'123','workflowId':VALID['query']['workflowId'],'status':VALID['query']['status'],'startedAt':p.iso(NOW-60)}
        d=payload();d.update(count=1,data=[r]);self.assertEqual(p.assess(VALID,200,json.dumps(d),NOW),'candidate-valid-metadata')
        for changes in [{'id':'١٢٣'},{'startedAt':'2027-01-15T07:59:00'},{'prompt':'PRIVATE'},{'status':'success'}]:
            d['data']=[{**r,**changes}];self.assertEqual(p.assess(VALID,200,json.dumps(d),NOW),'failed')
        d.update(count=2,data=[r,r]);self.assertEqual(p.assess(VALID,200,json.dumps(d),NOW),'failed')

    def test_insecure_token_and_unknown_case_refused_before_transport(self):
        os.chmod(self.path,0o644)
        with self.assertRaises(ValueError):p.perform_one(VALID['name'],self.path,clock=lambda:NOW)
        with self.assertRaises(ValueError):p.perform_one('arbitrary-url',self.path,clock=lambda:NOW)

    def test_body_size_is_bounded_and_not_reported(self):
        class Client:
            def open(_,req,timeout):return Response(b'x'*(p.MAX_BODY+1))
        result=p.perform_one(VALID['name'],self.path,clock=lambda:NOW,opener=Client())
        self.assertEqual(result['outcome'],'unknown');self.assertNotIn('body',result)


if __name__=='__main__':unittest.main()
