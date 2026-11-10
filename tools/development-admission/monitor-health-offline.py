#!/usr/bin/env python3
"""Synthetic composition demo only. No runtime options, network or provider calls."""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

import producer_monitor as core
import producer_monitor_health as health


def demonstrate():
    with tempfile.TemporaryDirectory(prefix='monitor-health-offline-') as directory:
        root = Path(directory)
        root.chmod(0o700)
        primary, beats, outbox = [root / name for name in ('primary.db', 'heartbeat.db', 'watchdog.db')]
        profile = core.make_profile('manual-test', ['HealthFixture123'], 900)
        policy = health.make_policy(profile)
        core.Reservations.initialize(primary, profile)
        health.initialize(beats, policy, 'heartbeat')
        health.initialize(outbox, policy, 'watchdog')
        calls = {'primary': 0, 'secondary': 0}

        def reader(target, status, cursor):
            row = {'id': '123', 'workflowId': target, 'status': 'error',
                   'startedAt': '1970-01-01T00:16:00Z'}
            return {'data': [row] if status == 'error' else [], 'next_cursor': None}

        def primary_unavailable(packet):
            calls['primary'] += 1
            raise RuntimeError('synthetic credential failure')

        def secondary(packet):
            calls['secondary'] += 1
            return {'status': 1, 'request': 'synthetic-receipt-' + str(calls['secondary'])}

        cycle = health.observed_cycle(profile, primary, beats, policy, reader,
                                      primary_unavailable, lambda: 1000, allow_manual_test=True)
        assert cycle['deliveries'][0]['delivery'] == 'unknown'
        watch = lambda at: health.watchdog_once(policy, beats, primary, outbox, secondary,
                                                at, allow_manual_test=True)
        first, repeat = watch(1061), watch(1062)
        assert first['delivery'] == 'provider-accepted'
        assert repeat['action'] == 'already-attempted'
        assert calls == {'primary': 1, 'secondary': 1}
        health.start_cycle(beats, policy, 1070)
        stalled = watch(1131)
        assert 'cycle-overdue' in stalled['report']['issues']
        assert stalled['action'] == 'cooldown'
        primary.unlink()
        beats.unlink()
        missing = watch(1150)
        assert set(missing['report']['issues']) == {'health-state-unavailable', 'delivery-state-unavailable'}
        assert missing['action'] == 'cooldown'
        reminder = watch(2861)
        assert reminder['delivery'] == 'provider-accepted'
        with sqlite3.connect(outbox) as db:
            assert db.execute('SELECT COUNT(*) FROM notices').fetchone()[0] == 2
        return {'schema_version': 1, 'synthetic': True, 'offline_only': True,
                'core_sha256': core.IMPLEMENTATION_SHA256, 'cycle_sha256': health.CYCLE_SHA,
                'health_sha256': health.SELF_SHA, 'primary_fake_calls': calls['primary'],
                'secondary_fake_calls': calls['secondary'], 'real_provider_calls': 0,
                'cycle_delivery': 'unknown', 'first_watchdog_alert': first['action'],
                'duplicate': repeat['action'], 'stalled_cycle': stalled['report']['issues'],
                'changed_incident': stalled['action'], 'missing_primary_files': missing['action'],
                'reminder_after_1800_seconds': reminder['action'],
                'human_receipt_verified': False, 'production_acceptance': False,
                'model_calls': 0, 'runtime_activated': False}


if __name__ == '__main__':
    if len(sys.argv) != 1:
        raise SystemExit('Offline demo accepts no runtime profile, path or activation options')
    print(json.dumps(demonstrate(), indent=2))
