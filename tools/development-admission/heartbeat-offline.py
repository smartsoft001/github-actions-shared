#!/usr/bin/env python3
"""Synthetic bridge fixture. Does not accept runtime paths, keys or activation."""
import json
from pathlib import Path
import sys
import tempfile
import time

import producer_monitor as core
import producer_monitor_health as health
from producer_monitor_heartbeat import export_heartbeat


def fixture():
    with tempfile.TemporaryDirectory(prefix='heartbeat-offline-') as directory:
        root = Path(directory)
        root.chmod(0o700)
        now = time.time()
        profile = core.make_profile('manual-test', ['ExternalHeartbeat1'], now - 10)
        policy = health.make_policy(profile)
        beat, primary = root / 'heartbeat.db', root / 'primary.db'
        health.initialize(beat, policy, 'heartbeat')
        core.Reservations.initialize(primary, profile)
        run = health.start_cycle(beat, policy, now)
        health.finish_cycle(beat, policy, run, time.time(), 'completed')
        return {'synthetic': True, 'scope': 'manual-test', 'runtime_activated': False,
                'real_provider_calls': 0, 'packet': export_heartbeat(policy, beat, primary, time.time())}


if __name__ == '__main__':
    if len(sys.argv) != 1:
        raise SystemExit('No runtime options are accepted')
    print(json.dumps(fixture()))
