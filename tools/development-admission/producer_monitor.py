"""Prepared metadata-only monitor. No API client, model, sender or scheduler."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
from contextlib import closing
from datetime import datetime

TARGETS = {'Kj0Bm4Q2XnRtKsn1': 'Plan Poller', 'YfyZaVDeZspB8VgK': 'Implementation Dispatcher'}
FAILURES = {'error': 'wykonanie zakończone błędem', 'crashed': 'wykonanie przerwane', 'unknown': 'niepotwierdzony stan wykonania'}
ORIGIN = 'https://n8n.smartsoft.biz.pl'
ID = re.compile(r'[A-Za-z0-9]{8,64}')
RUN = re.compile(r'[1-9][0-9]{0,31}')
IMPLEMENTATION_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

def make_profile(scope, targets, since):
    profile = {'schema_version': 1, 'scope': scope, 'enabled': False, 'since': since,
               'targets': targets, 'cooldown_seconds': 1800, 'implementation_sha256': IMPLEMENTATION_SHA256}
    validate_profile(profile)
    return profile

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()

def finite(value):
    return type(value) in (int, float) and math.isfinite(value)

def validate_profile(profile):
    if (profile.get('implementation_sha256') != IMPLEMENTATION_SHA256 or profile.get('schema_version') != 1 or profile.get('scope') not in ('production', 'manual-test')
            or type(profile.get('enabled')) is not bool or not finite(profile.get('since'))
            or type(profile.get('cooldown_seconds')) is not int or profile.get('cooldown_seconds') != 1800 or not isinstance(profile.get('targets'), list)):
        raise ValueError('Invalid reviewed monitor profile')
    ids = profile['targets']
    if any(not isinstance(x, str) or not ID.fullmatch(x) for x in ids) or len(ids) != len(set(ids)):
        raise ValueError('Invalid monitor targets')
    if profile['scope'] == 'production' and set(ids) != set(TARGETS):
        raise ValueError('Production target scope mismatch')
    if profile['scope'] == 'manual-test' and (len(ids) != 1 or ids[0] in TARGETS):
        raise ValueError('Isolated test target required')

def profile_digest(profile):
    validate_profile(profile)
    return digest({k: v for k, v in profile.items() if k != 'enabled'})

def event(profile, target, reason, execution_id, now):
    if (target not in profile['targets'] or reason not in (*FAILURES, 'metadata-read-unavailable')
            or (reason == 'metadata-read-unavailable') != (execution_id is None)
            or (execution_id is not None and (not isinstance(execution_id, str) or not RUN.fullmatch(execution_id)))):
        raise ValueError('Invalid normalized incident')
    test = profile['scope'] == 'manual-test'
    label = 'kontrolowany test' if test else TARGETS[target]
    status_text = FAILURES.get(reason, 'nie można potwierdzić kompletnego odczytu metadanych')
    suffix = f' #{execution_id}' if execution_id else ''
    url = f'{ORIGIN}/workflow/{target}' + (f'/executions/{execution_id}' if execution_id else '')
    identity = {'profile_sha256': profile_digest(profile), 'target': target, 'reason': reason,
                'execution_id': execution_id, 'read_failure_window': int(now // 1800) if not execution_id else None}
    return {'event_id': digest(identity), **identity, 'scope': profile['scope'],
            'message': ('TEST monitoringu producentów n8n — ' if test else 'Producent n8n — ')
                       + label + suffix + ': ' + status_text + '. Sprawdź wykonanie przed ponowieniem.',
            'url': url, 'observed_at': now}

def inspect(profile, snapshot, now):
    validate_profile(profile)
    if (not finite(now) or profile['since'] > now or not finite(snapshot.get('observed_at'))
            or not 0 <= now - snapshot['observed_at'] <= 30):
        raise ValueError('Stale monitor snapshot or invalid clock')
    sources = snapshot.get('sources')
    if not isinstance(sources, list) or len(sources) != len(profile['targets']):
        raise ValueError('Complete target-source inventory required')
    results = []
    for target in profile['targets']:
        matches = [s for s in sources if s.get('workflow_id') == target]
        if len(matches) != 1:
            raise ValueError('Missing or duplicate monitor source')
        source = matches[0]
        rows = source.get('data')
        valid = (source.get('ok') is True and source.get('complete') is True
                 and source.get('estimated') is False and isinstance(rows, list)
                 and type(source.get('count')) is int and source['count'] == len(rows))
        normalized, seen = [], set()
        if valid:
            for row in rows:
                try:
                    started = datetime.fromisoformat(row['startedAt'].replace('Z', '+00:00'))
                    if started.utcoffset() is None:
                        raise ValueError('Timezone required')
                    timestamp = started.timestamp()
                    rid = row['id']
                    if (not isinstance(rid, str) or not RUN.fullmatch(rid) or rid in seen
                            or row.get('workflowId') != target or row.get('status') not in FAILURES
                            or timestamp > now):
                        raise ValueError('Invalid execution metadata')
                    seen.add(rid)
                    if timestamp >= profile['since']:
                        normalized.append((timestamp, rid, row['status']))
                except (KeyError, ValueError, TypeError, AttributeError):
                    valid = False
                    break
        if not valid:
            results.append(event(profile, target, 'metadata-read-unavailable', None, now))
            continue
        for _, rid, status in sorted(normalized):
            results.append(event(profile, target, status, rid, now))
    return {'healthy': not results, 'events': results, 'model_calls': 0, 'runtime_activated': False}

def private(path, directory=False):
    path = Path(path)
    info = path.lstat()
    if (not path.is_absolute() or info.st_uid != os.getuid() or info.st_mode & 0o077
            or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))):
        raise ValueError('Private nonsymlink monitor state required')
    return path

class Reservations:
    @staticmethod
    def initialize(path, profile):
        path = Path(path)
        private(path.parent, True)
        key = profile_digest(profile)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.close(fd)
        with closing(sqlite3.connect(path)) as db, db:
            db.execute('CREATE TABLE meta (profile_sha256 TEXT NOT NULL)')
            db.execute('INSERT INTO meta VALUES (?)', (key,))
            db.execute('CREATE TABLE attempts (event_id TEXT PRIMARY KEY, target TEXT NOT NULL, attempted_at REAL NOT NULL, status TEXT NOT NULL, packet TEXT NOT NULL, request_id TEXT)')

    def __init__(self, path, profile):
        self.path = private(path)
        validate_profile(profile)
        self.profile = json.loads(json.dumps(profile))
        with closing(self.connect()) as db:
            rows = db.execute('SELECT profile_sha256 FROM meta').fetchall()
            if rows != [(profile_digest(profile),)]:
                raise ValueError('Monitor state/profile mismatch')

    def connect(self):
        private(self.path.parent, True)
        private(self.path)
        return sqlite3.connect(self.path.as_uri() + '?mode=rw', uri=True, timeout=3)

    def reserve(self, packet, now, *, allow_manual_test=False):
        if not finite(now) or not 0 <= now - packet.get('observed_at', math.inf) <= 30:
            raise ValueError('Stale packet')
        if (packet.get('profile_sha256') != profile_digest(self.profile) or packet.get('scope') != self.profile['scope']
                or packet.get('target') not in self.profile['targets']):
            raise ValueError('Packet outside monitor profile')
        expected = event(self.profile, packet['target'], packet.get('reason'), packet.get('execution_id'), packet['observed_at'])
        if digest(packet) != digest(expected):
            raise ValueError('Packet identity or message mismatch')
        if not self.profile['enabled'] and not (self.profile['scope'] == 'manual-test' and allow_manual_test):
            return {'action': 'monitor-disabled'}
        with closing(self.connect()) as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT status FROM attempts WHERE event_id=?', (packet['event_id'],)).fetchone()
            if existing:
                db.rollback()
                return {'action': 'already-attempted', 'status': existing[0]}
            previous = db.execute('SELECT MAX(attempted_at) FROM attempts WHERE target=?', (packet['target'],)).fetchone()[0]
            if previous is not None and now - previous < 1800:
                db.rollback()
                return {'action': 'cooldown', 'retry_after': previous + 1800}
            db.execute('INSERT INTO attempts VALUES (?,?,?,?,?,NULL)',
                       (packet['event_id'], packet['target'], now, 'intent', json.dumps(packet)))
            db.commit()
        return {'action': 'send-once', 'event_id': packet['event_id'], 'message': packet['message'], 'url': packet['url'], 'automatic_retry': False}

    def acknowledge(self, event_id, request_id):
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9-]{8,100}', request_id):
            raise ValueError('Actual provider receipt required')
        with closing(self.connect()) as db, db:
            row = db.execute('SELECT status,request_id FROM attempts WHERE event_id=?', (event_id,)).fetchone()
            if row is None or (row[0] != 'intent' and row != ('accepted', request_id)):
                raise ValueError('Unrecognized or conflicting provider receipt')
            db.execute('UPDATE attempts SET status=?,request_id=? WHERE event_id=?', ('accepted', request_id, event_id))

def production_acceptance(receipt):
    # Isolated manual tests never satisfy the production rollout monitor gate.
    return (receipt.get('scope') == 'production' and receipt.get('runtime_active') is True
            and set(receipt.get('target_ids', [])) == set(TARGETS)
            and receipt.get('provider_accepted') is True and receipt.get('human_phone_received') is True
            and receipt.get('readback_verified') is True)
