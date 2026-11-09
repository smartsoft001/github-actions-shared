"""Read-only mapping for the authorized n8n MCP metadata search port.

No MCP session, credentials, HTTP client, scheduling or sender is implemented.
The caller supplies search_workflow_executions(**query) returning structuredContent.
"""
from datetime import datetime, timezone
from producer_monitor import FAILURES, RUN, finite, validate_profile


def iso(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


class MetadataReader:
    """One fixed-window reader instance per cycle, never a persistent page cache.

    A count must remain exact and stable across a status stream. If an endpoint
    counts only remaining rows after lastId, refuses or changes its count, this
    adapter refuses completeness rather than interpreting a partial read as clean.
    Real multi-page count semantics still require live acceptance.
    """
    def __init__(self, profile, upper_bound, search, *, limit=200):
        validate_profile(profile)
        if not finite(upper_bound) or upper_bound < profile['since'] or type(limit) is not int or not 1 <= limit <= 200:
            raise ValueError('Invalid fixed metadata window')
        self.targets = tuple(profile['targets'])
        self.since, self.upper, self.search, self.limit = profile['since'], upper_bound, search, limit
        self.streams = {}

    def __call__(self, target, status, cursor):
        if target not in self.targets or status not in FAILURES:
            raise ValueError('Metadata query outside reviewed scope')
        key = (target, status)
        state = self.streams.get(key)
        if state is None:
            if cursor is not None:
                raise ValueError('Unrecognized first cursor')
            state = {'count': None, 'seen': set(), 'next': None, 'done': False}
            self.streams[key] = state
        elif state['done'] or cursor != state['next']:
            raise ValueError('Replayed or out-of-order metadata page')
        query = {'workflowId': target, 'status': [status], 'limit': self.limit,
                 # MCP uses strict after/before. Include the lower boundary then
                 # let the core filter timestamps >= profile.since.
                 'startedAfter': iso(self.since-1), 'startedBefore': iso(self.upper)}
        if cursor is not None:
            query['lastId'] = cursor
        try:
            response = self.search(**query)
            if (not isinstance(response, dict) or response.get('error')
                    or response.get('estimated') is not False or type(response.get('count')) is not int
                    or response['count'] < 0 or not isinstance(response.get('data'), list)
                    or len(response['data']) > self.limit):
                raise ValueError('Incomplete metadata response')
            if state['count'] is None:
                state['count'] = response['count']
            elif state['count'] != response['count']:
                raise ValueError('Metadata count drift')
            rows = []
            for raw in response['data']:
                rid = raw['id']
                stamp = datetime.fromisoformat(raw['startedAt'].replace('Z', '+00:00'))
                if (not isinstance(rid, str) or not RUN.fullmatch(rid) or rid in state['seen']
                        or raw['workflowId'] != target or raw['status'] != status
                        or stamp.utcoffset() is None or not self.since-1 < stamp.timestamp() < self.upper):
                    raise ValueError('Metadata row outside fixed query')
                state['seen'].add(rid)
                rows.append({key: raw[key] for key in ('id','workflowId','status','startedAt')})
            if len(state['seen']) > state['count'] or (not rows and len(state['seen']) < state['count']):
                raise ValueError('Metadata count mismatch')
            state['done'] = len(state['seen']) == state['count']
            state['next'] = None if state['done'] else rows[-1]['id']
            return {'data': rows, 'next_cursor': state['next']}
        except Exception:
            # Do not forward raw API errors, payloads or credential-bearing URLs.
            state['done'] = True
            raise ValueError('Metadata search unavailable or incomplete') from None
