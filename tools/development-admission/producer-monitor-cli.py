#!/usr/bin/env python3
"""Manual prepared monitor entry point. No network, sender or scheduling."""
import json
from pathlib import Path
import sys
import time
from producer_monitor import inspect, private, Reservations, validate_profile

def read(file):
    return json.loads(private(Path(file)).read_text())

def main(argv):
    mode = argv[0] if argv else ''
    if mode == '--check' and len(argv) == 3:
        profile = read(argv[1]); validate_profile(profile)
        Reservations(Path(argv[2]), profile)
        return {'valid': True, 'scope': profile['scope'], 'enabled': profile['enabled'], 'runtime_activated': False}
    if mode == '--inspect' and len(argv) == 3:
        return inspect(read(argv[1]), read(argv[2]), time.time())
    if mode == '--reserve' and len(argv) in (4, 5):
        if len(argv) == 5 and argv[4] != '--manual-test':
            raise ValueError('Unknown manual mode')
        profile = read(argv[1]); now = time.time()
        result = inspect(profile, read(argv[3]), now)
        store = Reservations(Path(argv[2]), profile)
        return {'scope': profile['scope'], 'healthy': result['healthy'], 'runtime_activated': False,
                'deliveries': [store.reserve(p, now, allow_manual_test=len(argv) == 5) for p in result['events']]}
    raise ValueError('Use --check, --inspect or --reserve with private local paths')

if __name__ == '__main__':
    try:
        print(json.dumps(main(sys.argv[1:])))
    except Exception:
        print('Monitor refused configuration, metadata or state; no sender was called', file=sys.stderr)
        raise SystemExit(1)
