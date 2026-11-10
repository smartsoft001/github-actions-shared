import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

import producer_monitor as core
import producer_monitor_health as health


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.root.chmod(0o700)
        self.profile = core.make_profile('manual-test', ['SyntheticFixture1'], 900)
        self.policy = health.make_policy(self.profile)
        self.primary = self.root / 'primary.db'
        self.beats = self.root / 'heartbeat.db'
        self.outbox = self.root / 'watchdog.db'
        core.Reservations.initialize(self.primary, self.profile)
        health.initialize(self.beats, self.policy, 'heartbeat')
        health.initialize(self.outbox, self.policy, 'watchdog')
        self.now = 1000
        self.sends = []

    def tearDown(self):
        self.tmp.cleanup()

    def finish(self, at=1000, outcome='completed'):
        run = health.start_cycle(self.beats, self.policy, at)
        health.finish_cycle(self.beats, self.policy, run, at, outcome)
        return run

    def reader(self, target, status, cursor):
        return {'data': [], 'next_cursor': None}

    def secondary(self, packet):
        self.sends.append(packet)
        return {'status': 1, 'request': 'actual-provider-id'}

    def watch(self, at=None, sender=None):
        return health.watchdog_once(self.policy, self.beats, self.primary, self.outbox,
                                    sender or self.secondary, self.now if at is None else at,
                                    allow_manual_test=True)

    def test_production_disabled_has_no_reads_sends_or_new_state(self):
        p = core.make_profile('production', list(core.TARGETS), 900)
        policy = health.make_policy(p)
        bomb = lambda *a: self.fail('disabled port called')
        missing = self.root / 'absent.db'
        result = health.observed_cycle(p, missing, missing, policy, bomb, bomb, bomb,
                                       allow_manual_test=True)
        self.assertEqual(result['action'], 'monitor-disabled')
        self.assertEqual(health.watchdog_once(policy, missing, missing, missing, bomb, 1000,
                                             allow_manual_test=True)['action'], 'watchdog-disabled')
        self.assertFalse(missing.exists())

    def test_completed_empty_cycle_is_alive_but_delivery_unverified(self):
        result = health.observed_cycle(self.profile, self.primary, self.beats, self.policy,
                                       self.reader, self.secondary, lambda: self.now,
                                       allow_manual_test=True)
        self.assertEqual(result['action'], 'cycle-complete')
        report = health.assess(self.policy, self.beats, self.primary, self.now)
        self.assertEqual((report['monitor'], report['delivery']), ('alive', 'idle-unverified'))
        self.assertFalse(report['human_receipt_verified'])
        self.assertFalse(report['production_acceptance'])
        self.assertEqual(self.watch()['action'], 'no-health-alert')
        self.assertEqual(self.sends, [])

    def test_never_started_and_expired_completed_heartbeat(self):
        self.assertIn('monitor-never-started', health.assess(self.policy, self.beats, self.primary, 1000)['issues'])
        self.finish()
        self.assertEqual(health.assess(self.policy, self.beats, self.primary, 1180)['issues'], [])
        self.assertIn('heartbeat-stale', health.assess(self.policy, self.beats, self.primary, 1181)['issues'])

    def test_unfinished_cycle_survives_restart_and_prevents_duplicate_work(self):
        health.start_cycle(self.beats, self.policy, 1000)
        bomb = lambda *a: self.fail('second cycle called port')
        result = health.observed_cycle(self.profile, self.primary, self.beats, self.policy,
                                       bomb, bomb, lambda: 1061, allow_manual_test=True)
        self.assertEqual(result['action'], 'cycle-already-open')
        self.assertIn('cycle-overdue', self.watch(1061)['report']['issues'])
        self.assertEqual(len(self.sends), 1)

    def test_failed_cycle_and_conflicting_completion_cannot_refresh_heartbeat(self):
        run = self.finish(outcome='failed')
        health.finish_cycle(self.beats, self.policy, run, 1000, 'failed')
        with self.assertRaises(ValueError):
            health.finish_cycle(self.beats, self.policy, run, 1100, 'completed')
        self.assertIn('cycle-failed', health.assess(self.policy, self.beats, self.primary, 1001)['issues'])

    def test_cycle_exception_recorded_without_raw_exception(self):
        self.primary.unlink()
        result = health.observed_cycle(self.profile, self.primary, self.beats, self.policy,
                                       self.reader, self.secondary, lambda: 1000, allow_manual_test=True)
        self.assertEqual(result['action'], 'cycle-failed')
        self.assertIn('cycle-failed', health.assess(self.policy, self.beats, self.primary, 1001)['issues'])
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_lost_primary_delivery_detected_and_not_resent(self):
        packet = core.event(self.profile, self.profile['targets'][0], 'error', '123', 1000)
        store = core.Reservations(self.primary, self.profile)
        store.reserve(packet, 1000, allow_manual_test=True)
        self.finish()
        self.assertNotIn('delivery-unconfirmed', health.assess(self.policy, self.beats, self.primary, 1060)['issues'])
        self.assertIn('delivery-unconfirmed', self.watch(1061)['report']['issues'])
        self.assertEqual(store.reserve(packet, 1001, allow_manual_test=True)['action'], 'already-attempted')
        self.assertEqual(len(self.sends), 1)

    def test_provider_acceptance_is_history_not_phone_confirmation(self):
        packet = core.event(self.profile, self.profile['targets'][0], 'error', '123', 1000)
        store = core.Reservations(self.primary, self.profile)
        store.reserve(packet, 1000, allow_manual_test=True)
        store.acknowledge(packet['event_id'], 'actual-provider-id')
        self.finish()
        report = health.assess(self.policy, self.beats, self.primary, 1001)
        self.assertEqual(report['delivery'], 'provider-accepted-history')
        self.assertFalse(report['human_receipt_verified'])

    def test_credential_failure_in_composed_cycle_becomes_unconfirmed_delivery(self):
        calls = []
        def reader(target, status, cursor):
            row = {'id': '123', 'workflowId': target, 'status': 'error',
                   'startedAt': '1970-01-01T00:16:00Z'}
            return {'data': [row] if status == 'error' else [], 'next_cursor': None}
        def unavailable(packet):
            calls.append(packet)
            raise RuntimeError('PRIVATE_KEYCHAIN_DIAGNOSTIC')
        result = health.observed_cycle(self.profile, self.primary, self.beats, self.policy,
                                       reader, unavailable, lambda: self.now, allow_manual_test=True)
        self.assertEqual(result['deliveries'][0]['delivery'], 'unknown')
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.now = 1001
        health.observed_cycle(self.profile, self.primary, self.beats, self.policy,
                              reader, unavailable, lambda: self.now, allow_manual_test=True)
        self.assertEqual(len(calls), 1)
        report = health.assess(self.policy, self.beats, self.primary, 1061)
        self.assertEqual(report['monitor'], 'alive')
        self.assertIn('delivery-unconfirmed', report['issues'])

    def test_newer_accepted_receipt_does_not_hide_older_uncertain_attempt(self):
        store = core.Reservations(self.primary, self.profile)
        first = core.event(self.profile, self.profile['targets'][0], 'error', '123', 1000)
        store.reserve(first, 1000, allow_manual_test=True)
        second = core.event(self.profile, self.profile['targets'][0], 'error', '124', 2800)
        store.reserve(second, 2800, allow_manual_test=True)
        store.acknowledge(second['event_id'], 'new-accepted-receipt')
        self.finish(2800)
        report = health.assess(self.policy, self.beats, self.primary, 2801)
        self.assertEqual(report['delivery'], 'pending')
        self.assertIn('delivery-unconfirmed', report['issues'])

    def test_missing_primary_or_heartbeat_uses_separate_watchdog_outbox(self):
        self.primary.unlink()
        self.beats.unlink()
        result = self.watch()
        self.assertEqual(result['action'], 'attempted-once')
        self.assertEqual(set(result['report']['issues']), {'health-state-unavailable', 'delivery-state-unavailable'})
        self.assertFalse(self.primary.exists())
        self.assertFalse(self.beats.exists())
        self.assertEqual(len(self.sends), 1)

    def test_missing_watchdog_outbox_is_never_recreated(self):
        self.outbox.unlink()
        self.assertEqual(self.watch()['action'], 'outbox-unavailable-no-send')
        self.assertFalse(self.outbox.exists())
        self.assertEqual(self.sends, [])

    def test_provider_receipt_without_durable_ack_stays_unknown(self):
        def lose_state_after_send(packet):
            self.sends.append(packet)
            self.outbox.rename(self.root / 'quarantined-outbox.db')
            return {'status': 1, 'request': 'actual-provider-id'}
        result = self.watch(sender=lose_state_after_send)
        self.assertEqual(result['delivery'], 'unknown')
        self.assertEqual(self.watch(1001)['action'], 'outbox-unavailable-no-send')
        self.assertEqual(len(self.sends), 1)
        self.assertFalse(self.outbox.exists())

    def test_insecure_primary_is_not_read_or_claimed_healthy(self):
        self.finish()
        self.primary.chmod(0o644)
        result = self.watch()
        self.assertIn('delivery-state-unavailable', result['report']['issues'])
        self.assertEqual(len(self.sends), 1)

    def test_six_competing_primary_starts_get_only_one_open_cycle(self):
        fixture = self.root / 'fixture.json'
        fixture.write_text(json.dumps(self.policy))
        script = '''import json,sys,pathlib
sys.path.insert(0,sys.argv[1]);import producer_monitor_health as h
r=pathlib.Path(sys.argv[2]);p=json.loads((r/'fixture.json').read_text())
print(json.dumps(h.start_cycle(r/'heartbeat.db',p,1000)))
'''
        procs = [subprocess.Popen([sys.executable, '-c', script, str(Path(health.__file__).parent), str(self.root)],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(6)]
        runs = []
        for proc in procs:
            out, err = proc.communicate(timeout=20)
            self.assertEqual(proc.returncode, 0, err)
            runs.append(json.loads(out))
        self.assertEqual(sum(run is not None for run in runs), 1)

    def test_unknown_secondary_delivery_persists_without_retry_and_has_cooldown(self):
        def lost(packet):
            self.sends.append(packet)
            raise RuntimeError('PRIVATE_TRANSPORT_BODY')
        result = self.watch(sender=lost)
        self.assertEqual(result['delivery'], 'unknown')
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertEqual(self.watch(1001)['action'], 'already-attempted')
        # Changed incident and time bucket cannot bypass the global30min cooldown.
        self.primary.unlink()
        self.assertEqual(self.watch(1801)['action'], 'cooldown')
        self.assertEqual(self.watch(2800)['action'], 'attempted-once')
        self.assertEqual(len(self.sends), 2)

    def test_invalid_receipt_boolean_or_raw_text_remains_unknown(self):
        result = self.watch(sender=lambda packet: {'status': True, 'request': 'PRIVATE'})
        self.assertEqual(result['delivery'], 'unknown')
        with sqlite3.connect(self.outbox) as db:
            self.assertEqual(db.execute('SELECT status,request_id FROM notices').fetchall(), [('intent', None)])

    def test_clock_regression_or_future_primary_attempt_does_not_send(self):
        self.finish(1000)
        self.assertEqual(self.watch(999)['action'], 'clock-untrusted-no-send')
        with self.assertRaises(ValueError):
            health.start_cycle(self.beats, self.policy, 999)
        packet = core.event(self.profile, self.profile['targets'][0], 'error', '123', 1100)
        core.Reservations(self.primary, self.profile).reserve(packet, 1100, allow_manual_test=True)
        self.assertEqual(self.watch(1001)['action'], 'clock-untrusted-no-send')
        self.assertEqual(self.sends, [])

    def test_read_only_assessment_and_binding_refuse_wrong_or_corrupt_state(self):
        before = hashlib.sha256(self.primary.read_bytes()).hexdigest()
        health.assess(self.policy, self.beats, self.primary, 1000)
        self.assertEqual(hashlib.sha256(self.primary.read_bytes()).hexdigest(), before)
        changed = {**self.policy, 'heartbeat_seconds': 181}
        report = health.assess(changed, self.beats, self.primary, 1000)
        self.assertIn('health-state-unavailable', report['issues'])
        self.beats.write_bytes(b'not SQLite')
        self.assertIn('health-state-unavailable', self.watch()['report']['issues'])

    def test_six_competing_observers_reserve_only_one_secondary_attempt(self):
        fixture = self.root / 'fixture.json'
        fixture.write_text(json.dumps(self.policy))
        script = '''import json,sys,pathlib
sys.path.insert(0,sys.argv[1]);import producer_monitor_health as h
r=pathlib.Path(sys.argv[2]);p=json.loads((r/'fixture.json').read_text())
def send(packet):
 with (r/'sent').open('a') as f:f.write('sent\\n')
 return {'status':1,'request':'actual-provider-id'}
print(json.dumps(h.watchdog_once(p,r/'heartbeat.db',r/'primary.db',r/'watchdog.db',send,1000,allow_manual_test=True)))
'''
        procs = [subprocess.Popen([sys.executable, '-c', script, str(Path(health.__file__).parent), str(self.root)],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(6)]
        results = []
        for proc in procs:
            out, err = proc.communicate(timeout=20)
            self.assertEqual(proc.returncode, 0, err)
            results.append(json.loads(out))
        self.assertEqual(sum(r['action'] == 'attempted-once' for r in results), 1)
        self.assertEqual((self.root / 'sent').read_text().splitlines(), ['sent'])


if __name__ == '__main__':
    unittest.main()
