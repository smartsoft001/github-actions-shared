"""Prepared heartbeat/watchdog ports. No network, credentials, service or timer.

The observer must eventually run independently with a separately accepted sender.
Provider acceptance below never means human receipt or production acceptance.
"""
from contextlib import closing, contextmanager
import hashlib
import json
from pathlib import Path
import os
import re
import sqlite3
import uuid

import producer_monitor as core
import producer_monitor_cycle as cycle

SELF_SHA = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
CYCLE_SHA = hashlib.sha256(Path(cycle.__file__).read_bytes()).hexdigest()
ISSUES = {
    'health-state-unavailable': 'brak wiarygodnego rejestru pracy monitora',
    'monitor-never-started': 'brak zakończonego cyklu monitora',
    'cycle-overdue': 'cykl monitora przekroczył limit czasu',
    'cycle-failed': 'cykl monitora nie zakończył się poprawnie',
    'heartbeat-stale': 'brak świeżego potwierdzenia pracy monitora',
    'delivery-state-unavailable': 'brak wiarygodnego rejestru wysyłek',
    'delivery-unconfirmed': 'próba wysyłki nie ma potwierdzenia Pushover',
    'clock-invalid': 'niespójny czas uniemożliwia ocenę stanu',
}


def make_policy(profile):
    core.validate_profile(profile)
    return {'schema_version': 1, 'enabled': False, 'monitor_profile': json.loads(json.dumps(profile)),
            'health_sha256': SELF_SHA, 'cycle_sha256': CYCLE_SHA,
            'heartbeat_seconds': 180, 'cycle_seconds': 60,
            'delivery_seconds': 60, 'cooldown_seconds': 1800}


def validate(policy):
    keys = {'schema_version', 'enabled', 'monitor_profile', 'health_sha256',
            'cycle_sha256', 'heartbeat_seconds', 'cycle_seconds',
            'delivery_seconds', 'cooldown_seconds'}
    if (set(policy) != keys or type(policy['schema_version']) is not int or policy['schema_version'] != 1
            or type(policy['enabled']) is not bool or policy['health_sha256'] != SELF_SHA
            or policy['cycle_sha256'] != CYCLE_SHA):
        raise ValueError('Invalid reviewed health policy')
    core.validate_profile(policy['monitor_profile'])
    for key in ('heartbeat_seconds', 'cycle_seconds', 'delivery_seconds'):
        if type(policy[key]) is not int or not 1 <= policy[key] <= 86400:
            raise ValueError('Invalid health deadline')
    if type(policy['cooldown_seconds']) is not int or policy['cooldown_seconds'] != 1800:
        raise ValueError('Invalid watchdog cooldown')


def binding(policy):
    validate(policy)
    return core.digest({**{k: v for k, v in policy.items()
                          if k not in ('enabled', 'monitor_profile')},
                        'monitor_profile': core.profile_digest(policy['monitor_profile'])})


def initialize(path, policy, kind):
    """Explicit one-time provision, never recovery during a runtime check."""
    key = binding(policy)
    if kind not in ('heartbeat', 'watchdog'):
        raise ValueError('Invalid journal kind')
    path = Path(path)
    core.private(path.parent, True)
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    with closing(sqlite3.connect(path)) as db, db:
        db.execute('CREATE TABLE meta (kind TEXT NOT NULL, policy_sha256 TEXT NOT NULL)')
        db.execute('INSERT INTO meta VALUES (?,?)', (kind, key))
        if kind == 'heartbeat':
            db.execute('CREATE TABLE cycles (id TEXT PRIMARY KEY, started REAL NOT NULL, '
                       'finished REAL, outcome TEXT)')
            db.execute('CREATE UNIQUE INDEX one_open_cycle ON cycles ((1)) WHERE finished IS NULL')
        else:
            db.execute('CREATE TABLE notices (id TEXT PRIMARY KEY, attempted REAL NOT NULL, '
                       'status TEXT NOT NULL, request_id TEXT)')


@contextmanager
def database(path, policy, kind, *, write=False):
    path = core.private(path)
    core.private(path.parent, True)
    with closing(sqlite3.connect(path.as_uri() + ('?mode=rw' if write else '?mode=ro'),
                                uri=True, timeout=3)) as db:
        if not write:
            db.execute('BEGIN')  # One consistent read-only snapshot for all checks.
        if db.execute('SELECT kind,policy_sha256 FROM meta').fetchall() != [(kind, binding(policy))]:
            raise ValueError('Health journal identity mismatch')
        yield db


def start_cycle(path, policy, now):
    validate(policy)
    if not core.finite(now) or now < policy['monitor_profile']['since']:
        raise ValueError('Invalid clock')
    with database(path, policy, 'heartbeat', write=True) as db, db:
        db.execute('BEGIN IMMEDIATE')
        if db.execute('SELECT 1 FROM cycles WHERE finished IS NULL').fetchone():
            return None  # Never steal or silently replace an unfinished cycle.
        last = db.execute('SELECT MAX(finished) FROM cycles').fetchone()[0]
        if last is not None and now < last:
            raise ValueError('Clock moved backwards')
        run = uuid.uuid4().hex
        db.execute('INSERT INTO cycles VALUES (?,?,NULL,NULL)', (run, now))
        return run


def finish_cycle(path, policy, run, now, outcome):
    if not core.finite(now) or outcome not in ('completed', 'failed'):
        raise ValueError('Invalid cycle completion')
    with database(path, policy, 'heartbeat', write=True) as db, db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT started,finished,outcome FROM cycles WHERE id=?', (run,)).fetchone()
        if row is None or now < row[0] or (row[1] is not None and row[1:] != (now, outcome)):
            raise ValueError('Unknown or conflicting cycle completion')
        db.execute('UPDATE cycles SET finished=?,outcome=? WHERE id=?', (now, outcome, run))


def observed_cycle(profile, monitor_path, health_path, policy, read_page, deliver, clock,
                   *, allow_manual_test=False):
    """Optional wrapper; existing core/cycle and reservation history stay unchanged."""
    if core.profile_digest(profile) != core.profile_digest(policy['monitor_profile']):
        raise ValueError('Observed profile mismatch')
    validate(policy)
    if not profile['enabled'] and not (profile['scope'] == 'manual-test' and allow_manual_test):
        return {'action': 'monitor-disabled', 'model_calls': 0}
    run = start_cycle(health_path, policy, clock())
    if run is None:
        return {'action': 'cycle-already-open', 'model_calls': 0}
    try:
        result = cycle.run_cycle(profile, monitor_path, read_page, deliver, clock,
                                 allow_manual_test=allow_manual_test)
    except Exception:
        finish_cycle(health_path, policy, run, clock(), 'failed')
        return {'action': 'cycle-failed', 'model_calls': 0}
    finish_cycle(health_path, policy, run, clock(), 'completed')
    return result


def assess(policy, health_path, monitor_path, now):
    """Independent read-only inspection, including missing/corrupt primary state."""
    validate(policy)
    issues = set()
    result = {'monitor': 'unknown', 'delivery': 'unknown', 'human_receipt_verified': False,
              'production_acceptance': False, 'model_calls': 0}
    if not core.finite(now) or now < policy['monitor_profile']['since']:
        return {**result, 'issues': ['clock-invalid']}
    try:
        with database(health_path, policy, 'heartbeat') as db:
            latest = db.execute('SELECT started,finished,outcome FROM cycles ORDER BY started DESC,rowid DESC LIMIT 1').fetchone()
            completed = db.execute('SELECT MAX(finished) FROM cycles').fetchone()[0]
        if latest is None:
            issues.add('monitor-never-started')
        elif (not core.finite(latest[0]) or latest[0] > now
              or (latest[1] is not None and (not core.finite(latest[1]) or latest[1] > now
                                           or latest[1] < latest[0]))):
            issues.add('clock-invalid')
        elif latest[1] is None:
            result['monitor'] = 'cycle-in-progress'
            if now - latest[0] > policy['cycle_seconds']:
                issues.add('cycle-overdue')
            if completed is not None and now - completed > policy['heartbeat_seconds']:
                issues.add('heartbeat-stale')
        elif latest[2] != 'completed':
            issues.add('cycle-failed')
        elif now - latest[1] > policy['heartbeat_seconds']:
            issues.add('heartbeat-stale')
        else:
            result['monitor'] = 'alive'
    except Exception:
        issues.add('health-state-unavailable')
    try:
        path = core.private(monitor_path)
        core.private(path.parent, True)
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=3)) as db:
            db.execute('BEGIN')
            if db.execute('SELECT profile_sha256 FROM meta').fetchall() != [(core.profile_digest(policy['monitor_profile']),)]:
                raise ValueError('Primary state identity mismatch')
            pending, oldest, accepted = 0, None, False
            # Bounded constant-memory inspection; oversized history fails closed.
            for i, (event, target, at, status, request) in enumerate(db.execute(
                    'SELECT event_id,target,attempted_at,status,request_id FROM attempts')):
                if (i >= 100000 or not isinstance(event, str) or not re.fullmatch(r'[a-f0-9]{64}', event)
                        or target not in policy['monitor_profile']['targets'] or not core.finite(at)
                        or status not in ('intent', 'accepted')):
                    raise ValueError('Invalid primary delivery record')
                if at > now:
                    issues.add('clock-invalid')
                if status == 'intent':
                    if request is not None:
                        raise ValueError('Conflicting pending receipt')
                    pending += 1
                    oldest = at if oldest is None else min(oldest, at)
                else:
                    if not isinstance(request, str) or not re.fullmatch(r'[A-Za-z0-9-]{8,100}', request):
                        raise ValueError('Invalid provider receipt')
                    accepted = True
            result['delivery'] = 'pending' if pending else ('provider-accepted-history' if accepted else 'idle-unverified')
            if pending and now - oldest > policy['delivery_seconds']:
                issues.add('delivery-unconfirmed')
    except Exception:
        issues.add('delivery-state-unavailable')
    return {**result, 'issues': sorted(issues)}


def watchdog_once(policy, health_path, monitor_path, outbox_path, deliver_secondary, now,
                  *, allow_manual_test=False):
    """Prepared independent observer. One reserved attempt; never retry an intent.

    The future runtime must bind a separately accepted secondary transport and
    scheduler. This injected function does not establish their independence.
    """
    validate(policy)
    if not policy['enabled'] and not (policy['monitor_profile']['scope'] == 'manual-test'
                                      and allow_manual_test):
        return {'action': 'watchdog-disabled', 'model_calls': 0}
    report = assess(policy, health_path, monitor_path, now)
    if not report['issues']:
        return {'action': 'no-health-alert', 'report': report}
    if not core.finite(now) or 'clock-invalid' in report['issues']:
        return {'action': 'clock-untrusted-no-send', 'report': report}
    notice = core.digest({'policy': binding(policy), 'issues': report['issues'], 'window': int(now // 1800)})
    try:
        with database(outbox_path, policy, 'watchdog', write=True) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM notices WHERE id=?', (notice,)).fetchone():
                return {'action': 'already-attempted', 'report': report}
            last = db.execute('SELECT MAX(attempted) FROM notices').fetchone()[0]
            if last is not None and (not core.finite(last) or now < last):
                return {'action': 'clock-untrusted-no-send', 'report': report}
            if last is not None and now - last < 1800:
                return {'action': 'cooldown', 'report': report}
            db.execute('INSERT INTO notices VALUES (?,?,?,NULL)', (notice, now, 'intent'))
    except Exception:
        return {'action': 'outbox-unavailable-no-send', 'report': report}
    packet = {'notice_id': notice, 'message': 'Kontrola monitora producentów n8n: '
              + '; '.join(ISSUES[x] for x in report['issues']) + '.',
              'url': core.ORIGIN, 'automatic_retry': False}
    outcome = 'unknown'
    try:
        receipt = deliver_secondary(packet)
        if (isinstance(receipt, dict) and type(receipt.get('status')) is int and receipt['status'] == 1
                and isinstance(receipt.get('request'), str)
                and re.fullmatch(r'[A-Za-z0-9-]{8,100}', receipt['request'])):
            with database(outbox_path, policy, 'watchdog', write=True) as db, db:
                changed = db.execute('UPDATE notices SET status=?,request_id=? WHERE id=? AND status=?',
                                     ('accepted', receipt['request'], notice, 'intent'))
                if changed.rowcount != 1:
                    raise ValueError('Watchdog acknowledgement did not match its intent')
            outcome = 'provider-accepted'
    except Exception:
        pass  # The committed intent survives all transport/ack uncertainty.
    return {'action': 'attempted-once', 'delivery': outcome, 'report': report,
            'human_receipt_verified': False, 'production_acceptance': False}
