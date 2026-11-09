import json
import unittest

import producer_monitor as core
from producer_monitor_cycle import collect
from producer_monitor_mcp import MetadataReader

NOW = 1800000000
TARGET = 'ControlledTest001'


def row(rid='123', status='error'):
    return {'id':rid,'workflowId':TARGET,'status':status,
            'startedAt':'2027-01-15T07:59:55Z','input':'PRIVATE-PROMPT'}


class MetadataReaderTests(unittest.TestCase):
    def setUp(self):
        self.p = core.make_profile('manual-test',[TARGET],NOW-100)

    def test_exact_empty_streams_match_actual_mcp_shape(self):
        queries=[]
        def search(**q): queries.append(q);return {'data':[],'count':0,'estimated':False}
        snapshot=collect(self.p,MetadataReader(self.p,NOW,search),lambda:NOW)
        self.assertTrue(core.inspect(self.p,snapshot,NOW)['healthy'])
        self.assertEqual(len(queries),3)
        self.assertEqual({tuple(q['status']) for q in queries},{(s,) for s in core.FAILURES})
        self.assertTrue(all(q['workflowId']==TARGET and q['startedBefore'] for q in queries))
        self.assertTrue(all('includeData' not in q for q in queries))

    def test_multiple_pages_follow_last_execution_id_and_strip_payload(self):
        queries=[]
        def search(**q):
            queries.append(q)
            return {'data':[row('124' if 'lastId' not in q else '123')], 'count':2,'estimated':False}
        reader=MetadataReader(self.p,NOW,search,limit=1)
        first=reader(TARGET,'error',None);second=reader(TARGET,'error',first['next_cursor'])
        self.assertEqual(queries[1]['lastId'],'124');self.assertIsNone(second['next_cursor'])
        self.assertNotIn('PRIVATE',json.dumps([first,second]))
        with self.assertRaises(ValueError):reader(TARGET,'error',None)

    def test_estimated_unknown_count_and_api_errors_are_unavailable(self):
        for mutation in [{'estimated':True},{'count':-1},{'count':True},{'error':'PRIVATE-ERROR'},{'data':None}]:
            response={'data':[],'count':0,'estimated':False};response.update(mutation)
            reader=MetadataReader(self.p,NOW,lambda **_:response)
            with self.assertRaisesRegex(ValueError,'^Metadata search unavailable or incomplete$'):
                reader(TARGET,'error',None)

    def test_partial_stream_count_drift_duplicate_or_empty_page_refused(self):
        for second in [{'data':[row('122')],'count':1,'estimated':False},
                       {'data':[row()],'count':2,'estimated':False},
                       {'data':[],'count':2,'estimated':False}]:
            def search(**q):return second if 'lastId' in q else {'data':[row()],'count':2,'estimated':False}
            reader=MetadataReader(self.p,NOW,search,limit=1)
            reader(TARGET,'error',None)
            with self.assertRaises(ValueError):reader(TARGET,'error','123')

    def test_foreign_status_target_time_and_naive_timezone_refused(self):
        for changes in [{'workflowId':'AnotherTarget01'},{'status':'success'},
                        {'startedAt':'2027-01-15T07:59:55'}, {'startedAt':'2027-01-15T08:00:01Z'},
                        {'id':'../bad'},{'startedAt':'2026-01-01T00:00:00Z'}]:
            r=row();r.update(changes)
            reader=MetadataReader(self.p,NOW,lambda **_:{'data':[r],'count':1,'estimated':False})
            with self.assertRaises(ValueError):reader(TARGET,'error',None)

    def test_unexpected_cursor_or_target_never_calls_source(self):
        def forbidden(**_): self.fail('No remote call allowed')
        for args in [(TARGET,'error','123'),('ForeignTarget001','error',None),(TARGET,'success',None)]:
            with self.assertRaises(ValueError):MetadataReader(self.p,NOW,forbidden)(*args)

    def test_raw_callback_exception_is_redacted(self):
        def bad(**_):raise RuntimeError('PRIVATE-CREDENTIAL')
        with self.assertRaisesRegex(ValueError,'^Metadata search unavailable or incomplete$'):
            MetadataReader(self.p,NOW,bad)(TARGET,'error',None)

    def test_invalid_config_and_oversized_page_fail(self):
        for limit in [0,201,True]:
            with self.assertRaises(ValueError):MetadataReader(self.p,NOW,lambda **_:None,limit=limit)
        with self.assertRaises(ValueError):MetadataReader(self.p,float('nan'),lambda **_:None)
        reader=MetadataReader(self.p,NOW,lambda **_:{'data':[row(),row('124')],'count':2,'estimated':False},limit=1)
        with self.assertRaises(ValueError):reader(TARGET,'error',None)

    def test_source_failure_becomes_generic_unavailable_for_each_target(self):
        p=core.make_profile('production',list(core.TARGETS),NOW-100)
        snapshot=collect(p,MetadataReader(p,NOW,lambda **_:{'data':[],'count':-1,'estimated':True}),lambda:NOW)
        result=core.inspect(p,snapshot,NOW)
        self.assertEqual(len(result['events']),2)
        self.assertEqual({e['reason'] for e in result['events']},{'metadata-read-unavailable'})


if __name__=='__main__': unittest.main()
