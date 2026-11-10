import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

import producer_monitor as core
import producer_monitor_health as health
from producer_monitor_heartbeat import export_heartbeat


class HeartbeatTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.root.chmod(0o700)
        self.profile = core.make_profile('manual-test', ['HeartbeatFixture1'], 900)
        self.policy = health.make_policy(self.profile)
        self.beats, self.primary = self.root / 'beat.db', self.root / 'primary.db'
        health.initialize(self.beats, self.policy, 'heartbeat')
        core.Reservations.initialize(self.primary, self.profile)

    def tearDown(self):
        self.tmp.cleanup()

    def complete(self, at=1000, outcome='completed'):
        run = health.start_cycle(self.beats, self.policy, at)
        health.finish_cycle(self.beats, self.policy, run, at, outcome)
        return run

    def test_safe_read_only_export_contains_no_delivery_packets_or_credentials(self):
        run = self.complete()
        before = [hashlib.sha256(p.read_bytes()).hexdigest() for p in (self.beats, self.primary)]
        packet = export_heartbeat(self.policy, self.beats, self.primary, 1001)
        self.assertEqual(packet['cycle_id'], run)
        self.assertEqual(packet['sequence'], 1)
        self.assertEqual(packet['monitor'], 'alive')
        self.assertEqual(packet['delivery'], 'idle-unverified')
        self.assertEqual(set(packet), {'schema_version', 'monitor_id', 'binding_sha256', 'sequence',
                                      'cycle_id', 'cycle_finished_at', 'sent_at', 'monitor', 'delivery', 'issues'})
        self.assertLess(len(json.dumps(packet)), 2048)
        self.assertEqual(before, [hashlib.sha256(p.read_bytes()).hexdigest() for p in (self.beats, self.primary)])

    def test_disabled_production_refuses_before_any_state_read(self):
        policy = health.make_policy(core.make_profile('production', list(core.TARGETS), 900))
        with self.assertRaisesRegex(ValueError, 'Disabled production'):
            export_heartbeat(policy, self.root / 'missing-health', self.root / 'missing-primary', 1000)

    def test_no_cycle_or_latest_open_cycle_cannot_export_old_completion(self):
        with self.assertRaises(ValueError):
            export_heartbeat(self.policy, self.beats, self.primary, 1000)
        self.complete()
        health.start_cycle(self.beats, self.policy, 1001)
        with self.assertRaises(ValueError):
            export_heartbeat(self.policy, self.beats, self.primary, 1002)

    def test_reexport_same_cycle_retains_id_sequence_and_finish_time(self):
        self.complete()
        a = export_heartbeat(self.policy, self.beats, self.primary, 1000)
        b = export_heartbeat(self.policy, self.beats, self.primary, 1001)
        for field in ('sequence', 'cycle_id', 'cycle_finished_at'):
            self.assertEqual(a[field], b[field])
        self.complete(1002)
        self.assertEqual(export_heartbeat(self.policy, self.beats, self.primary, 1003)['sequence'], 2)

    def test_stale_future_and_untrusted_clocks_refuse(self):
        self.complete()
        for now in (1181, 999, float('nan'), True):
            with self.assertRaises(ValueError):
                export_heartbeat(self.policy, self.beats, self.primary, now)

    def test_failed_cycle_is_exported_as_failure_not_alive(self):
        self.complete(outcome='failed')
        packet = export_heartbeat(self.policy, self.beats, self.primary, 1001)
        self.assertEqual(packet['monitor'], 'unknown')
        self.assertIn('cycle-failed', packet['issues'])

    def test_missing_primary_reports_unavailable_without_recreation(self):
        self.complete()
        self.primary.unlink()
        packet = export_heartbeat(self.policy, self.beats, self.primary, 1001)
        self.assertEqual(packet['delivery'], 'unknown')
        self.assertIn('delivery-state-unavailable', packet['issues'])
        self.assertFalse(self.primary.exists())

    def test_missing_or_mismatched_heartbeat_journal_refuses(self):
        self.complete()
        with self.assertRaises(ValueError):
            export_heartbeat({**self.policy, 'heartbeat_seconds': 181}, self.beats, self.primary, 1001)
        self.beats.unlink()
        with self.assertRaises(FileNotFoundError):
            export_heartbeat(self.policy, self.beats, self.primary, 1001)
        self.assertFalse(self.beats.exists())

    def test_unconfirmed_delivery_is_bounded_enum_not_error_body(self):
        self.complete()
        packet = core.event(self.profile, self.profile['targets'][0], 'error', '123', 1000)
        core.Reservations(self.primary, self.profile).reserve(packet, 1000, allow_manual_test=True)
        result = export_heartbeat(self.policy, self.beats, self.primary, 1061)
        self.assertEqual(result['delivery'], 'pending')
        self.assertIn('delivery-unconfirmed', result['issues'])
        self.assertNotIn('execution_id', result)
        self.assertNotIn('message', result)


if __name__ == '__main__':
    unittest.main()
