import copy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

import producer_monitor as monitor
import producer_monitor_cycle as cycle


NOW = 1800000000
TARGET = 'ControlledTest001'


def row(rid='123', status='error'):
    return {'id': rid, 'workflowId': TARGET, 'status': status,
            'startedAt': '2027-01-15T07:59:55Z', 'input': 'PRIVATE-PROMPT'}


class CycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'state.sqlite'
        self.profile = monitor.make_profile('manual-test', [TARGET], NOW-100)
        monitor.Reservations.initialize(self.path, self.profile)
        self.calls, self.sent = [], []

    def reader(self, target, status, cursor):
        self.calls.append((target, status, cursor))
        return {'data': [row()] if status == 'error' else [], 'next_cursor': None}

    def sender(self, grant):
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT status FROM attempts').fetchall(), [('intent',)])
        self.sent.append(grant)
        return {'status': 1, 'request': 'actual-request-123'}

    def run_cycle(self, reader=None, sender=None, now=NOW):
        return cycle.run_cycle(self.profile, self.path, reader or self.reader,
                               sender or self.sender, lambda: now, allow_manual_test=True)

    def test_complete_cycle_reserves_before_send_and_restart_does_not_repeat(self):
        first = self.run_cycle()
        self.assertEqual(first['deliveries'][0]['delivery'], 'accepted')
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.run_cycle()['deliveries'][0]['action'], 'already-attempted')
        self.assertEqual(len(self.sent), 1)
        self.assertNotIn('PRIVATE', json.dumps(self.sent))

    def test_timeout_after_provider_acceptance_stays_intent_without_retry(self):
        def lost(grant):
            self.sent.append(grant)
            raise TimeoutError('SECRET-RESPONSE')
        result = self.run_cycle(sender=lost)
        self.assertEqual(result['deliveries'][0]['delivery'], 'unknown')
        self.assertNotIn('SECRET', json.dumps(result))
        self.run_cycle(now=NOW+1900)
        self.assertEqual(len(self.sent), 1)

    def test_rejected_malformed_or_ambiguous_receipts_never_acknowledge(self):
        for receipt in [None, {}, {'status': True, 'request': 'actual-request-123'},
                        {'status': 0, 'request': 'actual-request-123'}, {'status': 1, 'request': None}]:
            with self.subTest(receipt=receipt):
                other = Path(self.tmp.name)/('receipt'+str(len(list(Path(self.tmp.name).iterdir())))+'.sqlite')
                monitor.Reservations.initialize(other, self.profile)
                result = cycle.run_cycle(self.profile, other, self.reader, lambda _: receipt, lambda: NOW, allow_manual_test=True)
                self.assertEqual(result['deliveries'][0]['delivery'], 'unknown')
                with sqlite3.connect(other) as db:
                    self.assertEqual(db.execute('SELECT status FROM attempts').fetchall(), [('intent',)])

    def test_disabled_production_performs_no_reads_or_sends_even_with_manual_flag(self):
        p = monitor.make_profile('production', list(monitor.TARGETS), NOW-100)
        db = Path(self.tmp.name)/'production.sqlite'; monitor.Reservations.initialize(db,p)
        result = cycle.run_cycle(p,db,self.reader,self.sender,lambda:NOW,allow_manual_test=True)
        self.assertEqual(result['action'],'monitor-disabled');self.assertEqual(self.calls,[]);self.assertEqual(self.sent,[])

    def test_all_pages_collected_and_payload_stripped(self):
        def pages(target,status,cursor):
            if status != 'error': return {'data': [], 'next_cursor': None}
            return {'data':[row('123' if cursor is None else '124')], 'next_cursor':'second' if cursor is None else None}
        snapshot = cycle.collect(self.profile,pages,lambda:NOW)
        self.assertEqual(snapshot['sources'][0]['count'],2)
        self.assertNotIn('PRIVATE',json.dumps(snapshot))
        result=self.run_cycle(reader=pages)
        self.assertEqual([d['action'] for d in result['deliveries']],['send-once','cooldown'])

    def test_page_failure_discards_partial_data_and_sends_generic_unavailable(self):
        def pages(target,status,cursor):
            if cursor: raise RuntimeError('SECRET-BODY')
            return {'data':[row()], 'next_cursor':'next'}
        result=self.run_cycle(reader=pages)
        self.assertEqual(len(self.sent),1)
        self.assertIn('kompletnego odczytu',self.sent[0]['message'])
        self.assertNotIn('SECRET',json.dumps(result))

    def test_duplicate_id_cursor_loop_wrong_target_and_invalid_page_refused(self):
        def repeated(target,status,cursor): return {'data':[row()], 'next_cursor':'loop'}
        def wrong(target,status,cursor):
            r=row(status=status);r['workflowId']='AnotherTarget01';return {'data':[r],'next_cursor':None}
        for reader in [repeated,wrong,lambda *args:{'data':[]},lambda *args:{'data':[],'next_cursor':'https://private.invalid'}]:
            source=cycle.collect(self.profile,reader,lambda:NOW)['sources'][0]
            self.assertFalse(source['complete']);self.assertEqual(source['data'],[])

    def test_page_and_row_limits_never_claim_clean_partial_read(self):
        source=cycle.collect(self.profile,self.reader,lambda:NOW,max_pages=1)['sources'][0]
        self.assertFalse(source['ok'])
        def large(target,status,cursor): return {'data':[row('123',status),row('124',status)],'next_cursor':None}
        self.assertFalse(cycle.collect(self.profile,large,lambda:NOW,max_rows=1)['sources'][0]['ok'])

    def test_slow_collection_cannot_refresh_its_timestamp_or_send(self):
        current=[NOW]
        def slow(*args): current[0]+=31;return {'data':[],'next_cursor':None}
        with self.assertRaises(ValueError):
            cycle.run_cycle(self.profile,self.path,slow,self.sender,lambda:current[0],allow_manual_test=True)
        self.assertEqual(self.sent,[])

    def test_missing_state_fails_before_reader_and_never_creates_recovery_db(self):
        missing=Path(self.tmp.name)/'missing.sqlite'
        with self.assertRaises(FileNotFoundError):
            cycle.run_cycle(self.profile,missing,self.reader,self.sender,lambda:NOW,allow_manual_test=True)
        self.assertFalse(missing.exists());self.assertEqual(self.calls,[])

    def test_second_target_is_still_checked_when_first_read_fails(self):
        p=monitor.make_profile('production',list(monitor.TARGETS),NOW-100)
        seen=[]
        def read(target,status,cursor):
            seen.append(target)
            if target==p['targets'][0]: raise RuntimeError('unavailable')
            return {'data':[],'next_cursor':None}
        sources=cycle.collect(p,read,lambda:NOW)['sources']
        self.assertEqual([s['ok'] for s in sources],[False,True])
        self.assertEqual(set(seen),set(p['targets']))


if __name__ == '__main__':
    unittest.main()
