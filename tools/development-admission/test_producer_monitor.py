import copy
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
import os
import tempfile
import unittest
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location('producer_monitor', Path(__file__).with_name('producer_monitor.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NOW = 1800000000
TEST_ID = 'ControlledTest001'

def profile(scope='manual-test'):
    return m.make_profile(scope, [TEST_ID] if scope == 'manual-test' else list(m.TARGETS), NOW-100)

def row(target=TEST_ID, rid='123', status='error', at=NOW-5):
    return {'id': rid, 'workflowId': target, 'status': status, 'startedAt': datetime.fromtimestamp(at, timezone.utc).isoformat()}

def snapshot(p, rows=None):
    return {'observed_at': NOW, 'sources': [{'workflow_id': target, 'ok': True, 'complete': True,
            'count': len(rows or []), 'estimated': False, 'data': copy.deepcopy(rows or [])} for target in p['targets']]}


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='monitor-offline-')
        self.db = Path(self.tmp.name)/'state.sqlite'
        self.p = profile()
        m.Reservations.initialize(self.db, self.p)
        self.store = m.Reservations(self.db, self.p)
        self.packet = m.inspect(self.p, snapshot(self.p, [row()]), NOW)['events'][0]
    def tearDown(self): self.tmp.cleanup()
    def test_clean_complete_two_producer_reads_are_healthy_without_packet(self):
        p=profile('production');r=m.inspect(p,snapshot(p),NOW)
        self.assertTrue(r['healthy']);self.assertEqual(r['events'],[])
    def test_failure_statuses_have_correct_safe_reason_and_test_label(self):
        for status in m.FAILURES:
            packet=m.inspect(self.p,snapshot(self.p,[row(status=status)]),NOW)['events'][0]
            self.assertIn(m.FAILURES[status],packet['message']);self.assertTrue(packet['message'].startswith('TEST '))
            self.assertTrue(packet['url'].startswith(m.ORIGIN+'/workflow/'+TEST_ID))
    def test_metadata_only_never_echoes_private_error_or_input(self):
        r=row();r.update(error={'message':'PRIVATE-SECRET'},input={'prompt':'CUSTOMER-PROMPT'})
        result=m.inspect(self.p,snapshot(self.p,[r]),NOW)
        self.assertNotIn('PRIVATE',json.dumps(result));self.assertNotIn('CUSTOMER',json.dumps(result))
    def test_unavailable_incomplete_or_estimated_read_is_not_healthy(self):
        for key,value in [('ok',False),('complete',False),('count',2),('estimated',True),('data',None)]:
            s=snapshot(self.p);s['sources'][0][key]=value;r=m.inspect(self.p,s,NOW)
            self.assertFalse(r['healthy']);self.assertEqual(r['events'][0]['reason'],'metadata-read-unavailable')
    def test_foreign_duplicate_bad_id_or_invalid_time_cannot_be_accepted_as_clean(self):
        for mutate in [lambda r:r.update(workflowId='ForeignWorkflow1'),lambda r:r.update(id='../../evil'),lambda r:r.update(startedAt='not-time'),lambda r:r.update(status='success'),lambda r:r.update(startedAt='2027-01-15T08:00:00')]:
            r=row();mutate(r)
            self.assertEqual(m.inspect(self.p,snapshot(self.p,[r]),NOW)['events'][0]['reason'],'metadata-read-unavailable')
        self.assertFalse(m.inspect(self.p,snapshot(self.p,[row(),row()]),NOW)['healthy'])
    def test_stale_clock_and_incomplete_target_inventory_raise_before_reservation(self):
        for now in [float('nan'),NOW-1,NOW+31]:
            with self.assertRaises(ValueError):m.inspect(self.p,snapshot(self.p),now)
        with self.assertRaises(ValueError):m.inspect(self.p,{'observed_at':NOW,'sources':[]},NOW)
    def test_baseline_prevents_historical_error_flood(self):
        self.assertEqual(m.inspect(self.p,snapshot(self.p,[row(at=NOW-200)]),NOW)['events'],[])
    def test_disabled_production_cannot_use_manual_test_override(self):
        p=profile('production');db=Path(self.tmp.name)/'production.sqlite';m.Reservations.initialize(db,p)
        s=snapshot(p);s['sources'][0].update(count=1,data=[row(target=p['targets'][0])])
        event=m.inspect(p,s,NOW)['events'][0]
        self.assertEqual(m.Reservations(db,p).reserve(event,NOW,allow_manual_test=True)['action'],'monitor-disabled')
    def test_first_attempt_commits_intent_and_restart_never_repeats_it(self):
        self.assertEqual(self.store.reserve(self.packet,NOW,allow_manual_test=True)['action'],'send-once')
        self.assertEqual(m.Reservations(self.db,self.p).reserve(self.packet,NOW,allow_manual_test=True)['action'],'already-attempted')
    def test_acceptance_readback_and_duplicate_provider_receipt_are_idempotent(self):
        self.store.reserve(self.packet,NOW,allow_manual_test=True)
        self.store.acknowledge(self.packet['event_id'],'actual-request-123')
        self.store.acknowledge(self.packet['event_id'],'actual-request-123')
        self.assertEqual(self.store.reserve(self.packet,NOW,allow_manual_test=True)['status'],'accepted')
        with self.assertRaises(ValueError):self.store.acknowledge(self.packet['event_id'],'other-request-999')
    def test_different_error_does_not_bypass_30_minute_cooldown(self):
        self.store.reserve(self.packet,NOW,allow_manual_test=True)
        p2=m.event(self.p,TEST_ID,'error','124',NOW+1799)
        self.assertEqual(self.store.reserve(p2,NOW+1799,allow_manual_test=True)['action'],'cooldown')
        p3=m.event(self.p,TEST_ID,'error','124',NOW+1800)
        self.assertEqual(self.store.reserve(p3,NOW+1800,allow_manual_test=True)['action'],'send-once')
    def test_unknown_provider_outcome_never_retries_same_execution_after_cooldown(self):
        self.store.reserve(self.packet,NOW,allow_manual_test=True)
        later=m.event(self.p,TEST_ID,'error','123',NOW+1900)
        self.assertEqual(self.store.reserve(later,NOW+1900,allow_manual_test=True)['action'],'already-attempted')
    def test_message_url_or_profile_tampering_is_rejected(self):
        for key,value in [('message','arbitrary'),('url','https://evil.invalid'),('scope','production'),('profile_sha256','0'*64)]:
            packet=copy.deepcopy(self.packet);packet[key]=value
            with self.assertRaises(ValueError):self.store.reserve(packet,NOW,allow_manual_test=True)
    def test_private_state_cannot_be_reset_rebound_or_replaced_with_symlink(self):
        with self.assertRaises(FileExistsError):m.Reservations.initialize(self.db,self.p)
        p=copy.deepcopy(self.p);p['since']-=1
        with self.assertRaises(ValueError):m.Reservations(self.db,p)
        os.chmod(self.db,0o644)
        with self.assertRaises(ValueError):m.Reservations(self.db,self.p)
        os.chmod(self.db,0o600);link=Path(self.tmp.name)/'link';link.symlink_to(self.db)
        with self.assertRaises(ValueError):m.Reservations(link,self.p)
    def test_profiles_reject_foreign_production_targets_and_different_code(self):
        for mutate in [lambda p:p.update(scope='production'),lambda p:p.update(implementation_sha256='0'*64),lambda p:p.update(cooldown_seconds=1)]:
            p=copy.deepcopy(self.p);mutate(p)
            with self.assertRaises(ValueError):m.validate_profile(p)
    def test_manual_phone_delivery_never_satisfies_production_rollout_gate(self):
        receipt={'scope':'manual-test','runtime_active':False,'target_ids':list(m.TARGETS),'provider_accepted':True,'human_phone_received':True,'readback_verified':True}
        self.assertFalse(m.production_acceptance(receipt))
    def test_competing_processes_reserve_only_one_delivery(self):
        fixture=Path(self.tmp.name)/'fixture.json';fixture.write_text(json.dumps({'profile':self.p,'packet':self.packet}))
        gate=Path(self.tmp.name)/'gate'
        script = """import importlib.util,json,sys,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('monitor',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
f=json.loads(Path(sys.argv[3]).read_text())
while not Path(sys.argv[4]).exists():time.sleep(0.005)
print(m.Reservations(Path(sys.argv[2]),f['profile']).reserve(f['packet'],1800000000,allow_manual_test=True)['action'])
"""
        processes=[subprocess.Popen([sys.executable,'-c',script,str(Path(__file__).with_name('producer_monitor.py')),str(self.db),str(fixture),str(gate)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(6)]
        gate.write_text('ready')
        actions=[]
        for process in processes:
            stdout,stderr=process.communicate(timeout=10)
            self.assertEqual(process.returncode,0,stderr);actions.append(stdout.strip())
        self.assertEqual(actions.count('send-once'),1)
        self.assertEqual(actions.count('already-attempted'),5)


class CliTests(unittest.TestCase):
    def test_private_manual_entrypoint_reserves_once_without_sender(self):
        import time
        with tempfile.TemporaryDirectory() as root:
            now=time.time();p=m.make_profile('manual-test',[TEST_ID],now-10)
            db=Path(root)/'state.sqlite';m.Reservations.initialize(db,p)
            profile_file=Path(root)/'profile.json';source=Path(root)/'source.json'
            data={'observed_at':now,'sources':[{'workflow_id':TEST_ID,'ok':True,'complete':True,'count':1,'estimated':False,'data':[row(at=now-1)]}]}
            for file,value in ((profile_file,p),(source,data)):
                file.write_text(json.dumps(value));file.chmod(0o600)
            command=[sys.executable,str(Path(__file__).with_name('producer-monitor-cli.py')),'--reserve',str(profile_file),str(db),str(source),'--manual-test']
            first=subprocess.run(command,capture_output=True,text=True);self.assertEqual(first.returncode,0,first.stderr)
            self.assertEqual(json.loads(first.stdout)['deliveries'][0]['action'],'send-once')
            second=subprocess.run(command,capture_output=True,text=True);self.assertEqual(second.returncode,0,second.stderr)
            self.assertEqual(json.loads(second.stdout)['deliveries'][0]['action'],'already-attempted')
    def test_bad_file_reports_only_safe_error(self):
        r=subprocess.run([sys.executable,str(Path(__file__).with_name('producer-monitor-cli.py')),'--inspect','/not-a-monitor-profile','/not-a-source'],capture_output=True,text=True)
        self.assertNotEqual(r.returncode,0);self.assertNotIn('Traceback',r.stderr);self.assertEqual(r.stdout,'')

if __name__=="__main__":unittest.main()
