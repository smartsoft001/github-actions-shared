"""Standalone metadata-only OTLP export/readback. No environment discovery or CLI.

This is transport, not authority to run a model. The paid manual gate stays closed.
"""
import base64
import hashlib
import http.client
import json
import math
import re
import socket
import ssl
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlencode, urlsplit

HOST = 'langfuse.smartsoft.biz.pl'
ORIGIN = 'https://' + HOST
PROJECTS = '/api/public/projects'
TRACES = '/api/public/otel/v1/traces'
OBSERVATIONS = '/api/public/v2/observations'
FIELDS = 'core,basic,metadata,model,usage'
MAX_BYTES = 131072
TIMEOUT_SECONDS = 8
MAX_MODELS = 8
MAX_INTEGER = 9007199254740991
EVENT_KEYS = set('schema_version repository repository_id execution_sha run_id run_attempt subject_head_sha subject_base_sha subject_sha256 session_id started_at ended_at result_code cli_total_cost_usd_estimate model_usage'.split())
TOKEN_KEYS = {'inputTokens': 'input', 'outputTokens': 'output', 'cacheReadInputTokens': 'cache_read_input_tokens',
              'cacheCreationInputTokens': 'cache_creation_input_tokens'}
OPTIONAL_USAGE = {'webSearchRequests', 'contextWindow', 'maxOutputTokens'}


class TelemetryError(ValueError):
    """Never includes remote bodies, URLs, credentials or nested exception text."""
    def __init__(self, code='transport_failed'):
        allowed = {'invalid_input', 'unsafe_endpoint', 'invalid_credentials', 'transport_failed',
                   'http_redirect', 'http_status', 'response_invalid', 'response_oversized',
                   'project_mismatch', 'readback_invalid', 'readback_mismatch', 'readback_incomplete',
                   'post_not_fully_accepted', 'post_outcome_unknown', 'already_attempted', 'readback_missing'}
        self.code = code if code in allowed else 'transport_failed'
        super().__init__(self.code)


def require(condition, code='invalid_input'):
    if not condition: raise TelemetryError(code)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1000000


def integer(value, minimum=0):
    return type(value) is int and minimum <= value <= MAX_INTEGER


def instant(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z', value))
    try:
        result = datetime.fromisoformat(value[:-1] + '+00:00')
    except ValueError:
        raise TelemetryError('invalid_input') from None
    require(2000 <= result.year <= 2100)
    return result


def iso(value):
    return value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def nano(value):
    delta = value - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return str((delta.days * 86400 + delta.seconds) * 1000000000 + delta.microseconds * 1000)


def prepare(project_id, event):
    require(isinstance(project_id, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', project_id))
    require(isinstance(event, dict) and set(event) == EVENT_KEYS)
    require(type(event['schema_version']) is int and event['schema_version'] == 1)
    require(isinstance(event['repository'], str) and len(event['repository']) <= 150 and
            re.fullmatch(r'[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+', event['repository']))
    require(all(integer(event[k], 1) for k in ('repository_id', 'run_id', 'run_attempt')))
    require(all(isinstance(event[k], str) and re.fullmatch(r'[a-f0-9]{40}', event[k])
                for k in ('execution_sha', 'subject_head_sha', 'subject_base_sha')))
    require(isinstance(event['subject_sha256'], str) and re.fullmatch(r'[a-f0-9]{64}', event['subject_sha256']))
    try:
        require(isinstance(event['session_id'], str) and str(uuid.UUID(event['session_id'])) == event['session_id'])
    except (ValueError, AttributeError):
        raise TelemetryError('invalid_input') from None
    start, end = instant(event['started_at']), instant(event['ended_at'])
    require(start <= end <= start + timedelta(hours=1))
    require(event['result_code'] in ('passed', 'findings', 'error', 'timeout', 'canceled'))
    require(number(event['cli_total_cost_usd_estimate']))
    models = event['model_usage']
    require(isinstance(models, dict) and 1 <= len(models) <= MAX_MODELS)
    for model, usage in models.items():
        require(isinstance(model, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}', model))
        require(isinstance(usage, dict) and set(TOKEN_KEYS) | {'costUSD'} <= set(usage) <= set(TOKEN_KEYS) | {'costUSD'} | OPTIONAL_USAGE)
        require(all(integer(v) for k, v in usage.items() if k != 'costUSD') and number(usage['costUSD']))
        require(sum(usage[k] for k in TOKEN_KEYS) <= MAX_INTEGER)
    # Roundtrip copies the allowlisted input; later caller mutations cannot alter the plan.
    event = json.loads(encoded(event)); models = event['model_usage']
    identity = {key: event[key] for key in ('repository', 'repository_id', 'execution_sha', 'run_id', 'run_attempt',
                'subject_head_sha', 'subject_base_sha', 'subject_sha256', 'session_id')}
    trace_id = digest(['development-manual-telemetry-v1', project_id, identity])[:32]
    root_id = digest([trace_id, 'root'])[:16]
    binding = digest([project_id, event])
    usage_hash = digest(models)
    common = {k: str(event[k]) for k in ('repository', 'repository_id', 'execution_sha', 'run_id', 'run_attempt',
              'subject_head_sha', 'subject_base_sha', 'subject_sha256', 'session_id', 'result_code')}
    common.update(schema='development-manual-telemetry-v1', binding_sha256=binding, model_usage_sha256=usage_hash,
                  billing_verified='false', cost_source='claude-cli-estimate',
                  subject_head_base_sha256=digest({'head_sha': event['subject_head_sha'], 'base_sha': event['subject_base_sha']}))
    spans, expected, generation_ids = [], [], {}

    def add_span(span_id, model=None):
        metadata = dict(common)
        usage, cost = {}, {}
        if model is None:
            metadata['cli_total_cost_usd_estimate'] = encoded(event['cli_total_cost_usd_estimate']).decode()
        else:
            values = models[model]
            usage = {target: values[source] for source, target in TOKEN_KEYS.items()}
            usage['total'] = sum(usage.values())
            cost = {'total': values['costUSD']}
            metadata['input_total_including_cache'] = str(values['inputTokens'] + values['cacheReadInputTokens'] + values['cacheCreationInputTokens'])
            for key in OPTIONAL_USAGE & set(values): metadata[key] = str(values[key])
        attributes = {'langfuse.observation.type': 'generation' if model else 'span',
                      'langfuse.session.id': event['session_id'], 'langfuse.environment': 'development-manual',
                      **{'langfuse.observation.metadata.' + k: v for k, v in metadata.items()}}
        if model:
            attributes.update({'langfuse.observation.model.name': model,
                               'langfuse.observation.usage_details': encoded(usage).decode(),
                               'langfuse.observation.cost_details': encoded(cost).decode()})
        name = 'development-review-generation' if model else 'development-review'
        span = {'traceId': trace_id, 'spanId': span_id, 'name': name, 'kind': 1,
                'startTimeUnixNano': nano(start), 'endTimeUnixNano': nano(end),
                'attributes': [{'key': k, 'value': {'stringValue': v}} for k, v in sorted(attributes.items())]}
        if model: span['parentSpanId'] = root_id
        spans.append(span)
        expected.append({'id': span_id, 'traceId': trace_id, 'projectId': project_id,
                         'parentObservationId': root_id if model else None, 'type': 'GENERATION' if model else 'SPAN',
                         'isRootObservation': model is None,
                         'name': name, 'sessionId': event['session_id'], 'startTime': iso(start), 'endTime': iso(end),
                         'metadata': metadata, 'model': model, 'usageDetails': usage, 'costDetails': cost,
                         'totalCost': models[model]['costUSD'] if model else 0})
    add_span(root_id)
    for model in sorted(models):
        span_id = digest([trace_id, 'generation', model])[:16]
        generation_ids[model] = span_id; add_span(span_id, model)
    payload = {'resourceSpans': [{'resource': {'attributes': [{'key': 'service.name', 'value': {'stringValue': 'development-manual-review'}}]},
                'scopeSpans': [{'scope': {'name': 'development-manual-telemetry', 'version': '1'}, 'spans': spans}]}]}
    require(len(encoded(payload)) <= MAX_BYTES)
    query = urlencode({'traceId': trace_id, 'fields': FIELDS, 'fromStartTime': iso(start - timedelta(seconds=1)),
                       'toStartTime': iso(end + timedelta(seconds=1)), 'limit': str(MAX_MODELS + 1)})
    return {'project_id': project_id, 'event': event, 'trace_id': trace_id, 'root_id': root_id,
            'generation_ids': generation_ids, 'binding_sha256': binding, 'model_usage_sha256': usage_hash,
            'payload': payload, 'expected': expected, 'query_path': OBSERVATIONS + '?' + query}


def metadata_matches(key, value, expected):
    if value == expected:
        return True
    if key in {'repository_id', 'run_id', 'run_attempt', 'input_total_including_cache'} | OPTIONAL_USAGE:
        return type(value) is int and str(value) == expected
    if key == 'billing_verified':
        return value is False and expected == 'false'
    if key == 'cli_total_cost_usd_estimate':
        return number(value) and value == json.loads(expected)
    return False


def readback(plan, response):
    require(isinstance(response, dict) and isinstance(response.get('data'), list) and
            isinstance(response.get('meta'), dict), 'readback_invalid')
    require(response['meta'].get('cursor') in (None, ''), 'readback_incomplete')
    rows = response['data']; require(len(rows) <= MAX_MODELS + 1, 'readback_invalid')
    expected = {row['id']: row for row in plan['expected']}; seen = set()
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get('id'), str) and row['id'] in expected and row['id'] not in seen,
                'readback_mismatch')
        seen.add(row['id']); target = expected[row['id']]
        require(set(target) <= set(row), 'readback_incomplete')
        require(all(row.get(k) == target[k] for k in ('traceId', 'projectId', 'parentObservationId', 'type', 'name', 'sessionId')), 'readback_mismatch')
        require(row['model'] == target['model'] or
                (target['type'] == 'SPAN' and target['model'] is None and row['model'] == ''), 'readback_mismatch')
        require(type(row.get('isRootObservation')) is bool and row['isRootObservation'] == target['isRootObservation'], 'readback_mismatch')
        require(instant(row.get('startTime')) == instant(target['startTime']) and
                instant(row.get('endTime')) == instant(target['endTime']), 'readback_mismatch')
        metadata = row.get('metadata')
        require(isinstance(metadata, dict) and
                all(metadata_matches(k, metadata.get(k), v) for k, v in target['metadata'].items()), 'readback_mismatch')
        require(row.get('input') is None and row.get('output') is None, 'readback_mismatch')
        for key in ('usageDetails', 'costDetails'):
            value = row.get(key)
            if target['type'] == 'SPAN' and value is None: value = {}
            require(isinstance(value, dict) and value == target[key], 'readback_mismatch')
            require(all((integer(v) if key == 'usageDetails' else number(v)) for v in value.values()), 'readback_mismatch')
        total = row.get('totalCost')
        require((target['type'] == 'SPAN' and total is None) or
                (number(total) and total == target['totalCost']), 'readback_mismatch')
    return 'complete' if seen == set(expected) else ('empty' if not rows else 'partial')


def receipt(plan, attempted):
    event = plan['event']
    return {'schema_version': 1, 'provider': 'langfuse', 'origin': ORIGIN, 'acknowledged': True, 'readback_verified': True,
            'merge_eligible': False, 'billing_verified': False, 'project_id': plan['project_id'],
            'trace_id': plan['trace_id'], 'observation_id': plan['root_id'], 'generation_ids': plan['generation_ids'],
            'run_id': event['run_id'], 'run_attempt': event['run_attempt'], 'execution_sha': event['execution_sha'],
            'subject_sha256': event['subject_sha256'], 'review_session_id': event['session_id'],
            'model_usage_sha256': plan['model_usage_sha256'], 'binding_sha256': plan['binding_sha256'],
            'post_attempted': attempted, 'write_status': 'verified', 'result': 'acknowledged'}


def accepted_post(response):
    if not isinstance(response, dict):
        return False
    if not response:
        return True
    # Langfuse can return the serialized queue job after enqueueing the batch.
    job_id = response.get('id')
    return (response.get('name') == 'otel-ingestion-job'
            and isinstance(job_id, str) and bool(job_id.strip())
            and isinstance(response.get('data'), dict)
            and not {'partialSuccess', 'error', 'errors'}.intersection(response))


class Publisher:
    """One object per approved execution; never retries writes, including after timeout.

    A local lock/set prevents duplicate POST from this object, not across processes.
    Existing fully matched readback can be verified without POST after a restart.
    """
    def __init__(self, transport):
        self.transport = transport
        self._attempted = set()
        self._lock = threading.Lock()

    def publish(self, project_id, event):
        with self._lock:
            return self._publish(project_id, event)

    def _publish(self, project_id, event):
        attempted = False; state = 'not_started'; code = 'invalid_input'
        try:
            plan = prepare(project_id, event)
            projects = self.transport.request('GET', PROJECTS)
            require(isinstance(projects, dict) and isinstance(projects.get('data'), list) and
                    len(projects['data']) == 1 and isinstance(projects['data'][0], dict) and
                    projects['data'][0].get('id') == project_id, 'project_mismatch')
            existing = readback(plan, self.transport.request('GET', plan['query_path']))
            if existing == 'complete': return receipt(plan, False)
            require(existing == 'empty', 'readback_incomplete')
            require(plan['trace_id'] not in self._attempted, 'already_attempted')
            self._attempted.add(plan['trace_id']); attempted = True; state = 'unknown'
            try:
                accepted = self.transport.request('POST', TRACES, plan['payload'])
            except Exception:
                raise TelemetryError('post_outcome_unknown') from None
            if isinstance(accepted, dict) and 'partialSuccess' in accepted: state = 'partial'
            require(accepted_post(accepted), 'post_not_fully_accepted')
            state = 'accepted_unverified'
            for attempt in range(3):
                if attempt: time.sleep(0.2)
                result = readback(plan, self.transport.request('GET', plan['query_path']))
                if result == 'complete': return receipt(plan, True)
            raise TelemetryError('readback_missing')
        except TelemetryError as error:
            code = error.code
        except Exception:
            code = 'transport_failed'
        return {'schema_version': 1, 'provider': 'langfuse', 'result': 'blocked', 'acknowledged': False,
                'readback_verified': False, 'merge_eligible': False, 'post_attempted': attempted,
                'write_status': state, 'reason_code': code}


def validate_endpoint(method, path, body):
    require(isinstance(path, str) and len(path) < 1000, 'unsafe_endpoint')
    parsed = urlsplit(path)
    require(not parsed.scheme and not parsed.netloc and not parsed.fragment, 'unsafe_endpoint')
    if method == 'POST':
        require(path == TRACES and isinstance(body, dict), 'unsafe_endpoint')
    elif method == 'GET':
        require(body is None, 'unsafe_endpoint')
        if path == PROJECTS: return
        require(parsed.path == OBSERVATIONS, 'unsafe_endpoint')
        query = parse_qs(parsed.query, strict_parsing=True, keep_blank_values=True)
        require(set(query) == {'traceId', 'fields', 'fromStartTime', 'toStartTime', 'limit'} and
                all(len(v) == 1 for v in query.values()), 'unsafe_endpoint')
        require(re.fullmatch(r'[a-f0-9]{32}', query['traceId'][0]) and query['fields'] == [FIELDS] and
                query['limit'] == [str(MAX_MODELS + 1)], 'unsafe_endpoint')
        start, end = instant(query['fromStartTime'][0]), instant(query['toStartTime'][0])
        require(start < end <= start + timedelta(seconds=3602), 'unsafe_endpoint')
    else:
        raise TelemetryError('unsafe_endpoint')


def decode_response(raw):
    require(isinstance(raw, bytes) and len(raw) <= MAX_BYTES, 'response_oversized')
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, 'response_invalid'); value[key] = item
        return value
    def finite_float(value):
        result = float(value)
        require(math.isfinite(result), 'response_invalid')
        return result
    try:
        result = json.loads(raw, object_pairs_hook=unique, parse_float=finite_float,
                            parse_constant=lambda _: (_ for _ in ()).throw(TelemetryError('response_invalid')))
    except (ValueError, UnicodeError):
        raise TelemetryError('response_invalid') from None
    require(isinstance(result, dict), 'response_invalid')
    return result


class HTTPTransport:
    """Fixed-origin HTTPS only. http.client has no redirect or proxy-env machinery."""
    def __init__(self, public_key, secret_key):
        require(isinstance(public_key, str) and re.fullmatch(r'pk-lf-[A-Za-z0-9-]{8,128}', public_key) and
                isinstance(secret_key, str) and re.fullmatch(r'sk-lf-[A-Za-z0-9-]{8,128}', secret_key), 'invalid_credentials')
        self._authorization = 'Basic ' + base64.b64encode((public_key + ':' + secret_key).encode('ascii')).decode('ascii')

    def request(self, method, path, body=None):
        connection = None; timer = None
        try:
            validate_endpoint(method, path, body)
            payload = None if body is None else encoded(body)
            require(payload is None or len(payload) <= MAX_BYTES, 'invalid_input')
            connection = http.client.HTTPSConnection(HOST, port=443, timeout=TIMEOUT_SECONDS, context=ssl.create_default_context())
            # Only the explicit connect below may open a socket. A deadline close
            # between the guard and send must not trigger http.client's reconnect.
            connection.auto_open = False
            expired = threading.Event()
            def expire():
                expired.set()
                try:
                    if connection.sock: connection.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                try: connection.close()
                except Exception: pass
            timer = threading.Timer(TIMEOUT_SECONDS, expire); timer.daemon = True; timer.start()
            connection.connect()
            require(not expired.is_set(), 'transport_failed')
            headers = {'Authorization': self._authorization, 'Accept': 'application/json'}
            if method == 'POST': headers.update({'Content-Type': 'application/json', 'x-langfuse-ingestion-version': '4'})
            connection.request(method, path, body=payload, headers=headers)
            response = connection.getresponse()
            require(not 300 <= response.status < 400, 'http_redirect')
            require(response.status == 200, 'http_status')
            require(response.getheader('Content-Type', '').split(';')[0].strip().lower() == 'application/json', 'response_invalid')
            length = response.getheader('Content-Length')
            require(length is None or (length.isdigit() and int(length) <= MAX_BYTES), 'response_oversized')
            require(response.getheader('Content-Encoding', 'identity') == 'identity', 'response_invalid')
            raw = response.read(MAX_BYTES + 1)
            require(not expired.is_set(), 'transport_failed')
            return decode_response(raw)
        except TelemetryError:
            raise
        except Exception:
            raise TelemetryError('transport_failed') from None
        finally:
            if timer: timer.cancel()
            if connection:
                try: connection.close()
                except Exception: pass
