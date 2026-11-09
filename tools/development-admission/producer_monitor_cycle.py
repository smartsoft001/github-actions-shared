"""Prepared single-cycle orchestration through injected ports; no network or timer.

Reader contract is normalized, not the raw n8n REST response. A future authorized
adapter must prove complete metadata coverage and enforce its own request timeout.
"""
import re
from producer_monitor import FAILURES, Reservations, inspect, validate_profile


def collect(profile, read_page, clock, *, max_pages=20, max_rows=2000):
    """Read every failure status; discard partial data on any failure.

    read_page(target, status, cursor) returns {data: list, next_cursor: str|None}.
    It must use an authorized metadata-only source, with no execution payloads.
    Limits are per target across all statuses; overflow is unavailable, not healthy.
    """
    validate_profile(profile)
    if type(max_pages) is not int or type(max_rows) is not int or not 1 <= max_pages <= 100 or not 1 <= max_rows <= 10000:
        raise ValueError('Invalid read limits')
    started = clock()
    sources = []
    for target in profile['targets']:
        rows, identities, pages, valid = [], set(), 0, True
        try:
            for status in FAILURES:
                cursor, seen = None, set()
                while True:
                    pages += 1
                    if pages > max_pages or not 0 <= clock() - started <= 30:
                        raise ValueError('Read budget exhausted')
                    page = read_page(target, status, cursor)
                    if not isinstance(page, dict) or set(page) != {'data', 'next_cursor'} or not isinstance(page['data'], list):
                        raise ValueError('Invalid normalized page')
                    for row in page['data']:
                        if row['workflowId'] != target or row['status'] != status or row['id'] in identities:
                            raise ValueError('Unstable metadata page')
                        identities.add(row['id'])
                        rows.append({key: row[key] for key in ('id', 'workflowId', 'status', 'startedAt')})
                        if len(rows) > max_rows:
                            raise ValueError('Row limit exceeded')
                    cursor = page['next_cursor']
                    if cursor is None:
                        break
                    if not isinstance(cursor, str) or not re.fullmatch(r'[A-Za-z0-9_+=/.-]{1,1024}', cursor) or cursor in seen:
                        raise ValueError('Invalid or repeated cursor')
                    seen.add(cursor)
        except Exception:
            # Do not expose raw remote exceptions, response bodies or partial data.
            valid, rows = False, []
        sources.append({'workflow_id': target, 'ok': valid, 'complete': valid,
                        'estimated': False, 'count': len(rows), 'data': rows})
    # Timestamp the start: a slow read cannot pretend the entire batch is fresh.
    return {'observed_at': started, 'sources': sources}


def run_cycle(profile, state_path, read_page, deliver, clock, *, allow_manual_test=False):
    """One explicit cycle. No retries; caller owns scheduling and port timeouts.

    deliver receives only a reserved safe grant; returns actual Pushover-normalized
    {status: 1, request: str}. Unknown results remain durable intents, never retried.
    Production requires a separately enabled reviewed profile. This is not a CLI
    activating a service, nor proof of a functioning production adapter.
    """
    validate_profile(profile)
    store = Reservations(state_path, profile)
    if not profile['enabled'] and not (profile['scope'] == 'manual-test' and allow_manual_test):
        return {'action': 'monitor-disabled', 'deliveries': [], 'model_calls': 0}
    snapshot = collect(profile, read_page, clock)
    result = inspect(profile, snapshot, clock())
    deliveries = []
    for packet in result['events']:
        grant = store.reserve(packet, clock(), allow_manual_test=allow_manual_test)
        outcome = {'event_id': packet['event_id'], 'action': grant['action']}
        if grant['action'] == 'send-once':
            outcome['delivery'] = 'unknown'
            try:
                receipt = deliver(dict(grant))
                if isinstance(receipt, dict) and type(receipt.get('status')) is int and receipt['status'] == 1:
                    store.acknowledge(grant['event_id'], receipt.get('request'))
                    outcome['delivery'] = 'accepted'
            except Exception:
                # Reservation remains committed even if delivery/ack raises.
                pass
        deliveries.append(outcome)
    return {'action': 'cycle-complete', 'healthy': result['healthy'],
            'deliveries': deliveries, 'model_calls': 0}
