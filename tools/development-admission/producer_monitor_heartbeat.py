"""Read-only export for a future outbound heartbeat. No HTTP or credential access."""
import json
import re

import producer_monitor as core
import producer_monitor_health as health


def export_heartbeat(policy, health_path, monitor_path, now):
    health.validate(policy)
    if policy['monitor_profile']['scope'] == 'production' and not policy['monitor_profile']['enabled']:
        raise ValueError('Disabled production cannot publish a heartbeat')
    with health.database(health_path, policy, 'heartbeat') as db:
        row = db.execute('SELECT rowid,id,finished,outcome FROM cycles '
                         'ORDER BY started DESC,rowid DESC LIMIT 1').fetchone()
    # An in-progress cycle cannot publish old completion as a new heartbeat.
    if (row is None or row[2] is None or not core.finite(now) or not core.finite(row[2])
            or not 0 <= now - row[2] <= 180 or type(row[0]) is not int
            or not 0 < row[0] <= 9007199254740991 or not re.fullmatch(r'[a-f0-9]{32}', row[1])):
        raise ValueError('No fresh completed cycle for heartbeat')
    report = health.assess(policy, health_path, monitor_path, now)
    if ('clock-invalid' in report['issues'] or report['monitor'] not in ('alive', 'unknown')
            or report['delivery'] not in ('unknown', 'pending', 'idle-unverified', 'provider-accepted-history')):
        raise ValueError('Untrusted heartbeat assessment')
    packet = {'schema_version': 1, 'monitor_id': 'development-producers',
              'binding_sha256': health.binding(policy), 'sequence': row[0],
              'cycle_id': row[1], 'cycle_finished_at': row[2], 'sent_at': now,
              'monitor': report['monitor'], 'delivery': report['delivery'], 'issues': report['issues']}
    if len(json.dumps(packet).encode()) > 2048:
        raise ValueError('Heartbeat size exceeded')
    return packet
