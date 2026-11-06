import copy
import contextlib
import io
import json
import os
import unittest
from unittest.mock import patch

import langfuse_transport as lf

PROJECT = 'approved-fixture-project'


def event():
    return {'schema_version': 1, 'repository': 'smartsoft001/galena-tele', 'repository_id': 123,
            'execution_sha': 'a' * 40, 'run_id': 456, 'run_attempt': 1,
            'subject_head_sha': 'b' * 40, 'subject_base_sha': 'c' * 40, 'subject_sha256': 'd' * 64,
            'session_id': '7d926dba-a359-4ec2-a7e4-5a56c0dd57a1',
            'started_at': '2026-11-05T12:00:00.000Z', 'ended_at': '2026-11-05T12:00:10.000Z',
            'result_code': 'passed', 'cli_total_cost_usd_estimate': 0.03,
            'model_usage': {'fixture-model': {'inputTokens': 10, 'outputTokens': 20,
                             'cacheReadInputTokens': 30, 'cacheCreationInputTokens': 40, 'costUSD': 0.03}}}


def page(plan):
    return {'data': copy.deepcopy(plan['expected']), 'meta': {'cursor': None}}


EMPTY = {'data': [], 'meta': {}}


class MemoryHTTP:
    def __init__(self, replies):
        self.replies = list(replies); self.calls = []

    def request(self, method, path, body=None):
        self.calls.append((method, path, body))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception): raise reply
        return copy.deepcopy(reply)


class LangfuseTests(unittest.TestCase):
    def test_multiple_models_have_one_root_and_no_duplicated_aggregate_cost(self):
        value = event(); value['model_usage']['other-model'] = dict(value['model_usage']['fixture-model'], costUSD=0.02)
        value['cli_total_cost_usd_estimate'] = 0.05
        plan = lf.prepare(PROJECT, value)
        self.assertEqual(len(plan['expected']), 3)
        self.assertEqual(sum(row['totalCost'] for row in plan['expected']), 0.05)
        self.assertEqual(plan['expected'][0]['metadata']['cli_total_cost_usd_estimate'], '0.05')
        self.assertEqual(len(set(row['id'] for row in plan['expected'])), 3)
        value['model_usage'] = dict(reversed(list(value['model_usage'].items())))
        self.assertEqual(plan, lf.prepare(PROJECT, value))

    def test_deterministic_ids_and_exclusive_cache_buckets(self):
        plan = lf.prepare(PROJECT, event())
        self.assertEqual(plan, lf.prepare(PROJECT, event()))
        self.assertEqual(len(plan['trace_id']), 32); self.assertEqual(len(plan['root_id']), 16)
        root, generation = plan['expected']
        self.assertEqual(root['type'], 'SPAN'); self.assertEqual(generation['type'], 'GENERATION')
        self.assertEqual(generation['parentObservationId'], root['id'])
        self.assertEqual(generation['usageDetails'], {'input': 10, 'output': 20, 'cache_read_input_tokens': 30,
                         'cache_creation_input_tokens': 40, 'total': 100})
        self.assertEqual(generation['costDetails'], {'total': 0.03})
        self.assertEqual(root['costDetails'], {}); self.assertEqual(root['usageDetails'], {})
        spans = plan['payload']['resourceSpans'][0]['scopeSpans'][0]['spans']
        attributes = [{a['key']: a['value']['stringValue'] for a in span['attributes']} for span in spans]
        self.assertEqual(attributes[0]['langfuse.observation.type'], 'span')
        self.assertEqual(attributes[1]['langfuse.observation.type'], 'generation')
        self.assertNotIn('langfuse.observation.cost_details', attributes[0])
        self.assertNotIn('langfuse.observation.input', attributes[1])
        self.assertEqual(generation['metadata']['billing_verified'], 'false')
        changed = event(); changed['run_id'] += 1
        self.assertNotEqual(plan['trace_id'], lf.prepare(PROJECT, changed)['trace_id'])
        changed = event(); changed['model_usage']['fixture-model']['outputTokens'] += 1
        other = lf.prepare(PROJECT, changed)
        self.assertEqual(plan['trace_id'], other['trace_id'])
        self.assertNotEqual(plan['binding_sha256'], other['binding_sha256'])

    def test_unknown_fields_invalid_numeric_usage_and_missing_project_block_before_http(self):
        mutations = [lambda e: e.update(secret='fake-secret'), lambda e: e.update(prompt='private'),
                     lambda e: e.update(schema_version=True), lambda e: e.update(run_id=True),
                     lambda e: e.update(result_code='raw private error'), lambda e: e.update(ended_at='2026-02-30T00:00:00Z'),
                     lambda e: e.update(cli_total_cost_usd_estimate=float('nan')),
                     lambda e: e['model_usage']['fixture-model'].update(inputTokens=True),
                     lambda e: e['model_usage']['fixture-model'].update(costUSD=float('inf')),
                     lambda e: e['model_usage']['fixture-model'].update(secret='fake-secret'),
                     lambda e: e['model_usage']['fixture-model'].update(newUsageMetric=123),
                     lambda e: e['model_usage']['fixture-model'].pop('cacheReadInputTokens'),
                     lambda e: e.update(model_usage={'bad\nmodel': e['model_usage']['fixture-model']})]
        for mutate in mutations:
            e = event(); mutate(e); transport = MemoryHTTP([])
            with self.subTest(event=e):
                result = lf.Publisher(transport).publish(PROJECT, e)
                self.assertFalse(result['acknowledged']); self.assertEqual(transport.calls, [])
                self.assertNotIn('fake-secret', str(result))
        for project in (None, '', '../other'):
            transport = MemoryHTTP([])
            self.assertFalse(lf.Publisher(transport).publish(project, event())['acknowledged'])
            self.assertEqual(transport.calls, [])

    def test_one_post_then_verified_readback_only(self):
        plan = lf.prepare(PROJECT, event())
        transport = MemoryHTTP([{'data': [{'id': PROJECT}]}, EMPTY, {}, EMPTY, page(plan)])
        with patch.object(lf.time, 'sleep'):
            receipt = lf.Publisher(transport).publish(PROJECT, event())
        self.assertTrue(receipt['acknowledged']); self.assertTrue(receipt['readback_verified'])
        self.assertFalse(receipt['merge_eligible']); self.assertFalse(receipt['billing_verified'])
        self.assertEqual(receipt['observation_id'], plan['root_id'])
        self.assertEqual(receipt['run_id'], 456); self.assertEqual(receipt['review_session_id'], event()['session_id'])
        posts = [call for call in transport.calls if call[0] == 'POST']
        self.assertEqual(len(posts), 1); self.assertEqual(posts[0][1], '/api/public/otel/v1/traces')
        self.assertIn('fields=core%2Cbasic%2Cmetadata%2Cmodel%2Cusage', transport.calls[1][1])
        self.assertNotIn('io', transport.calls[1][1].split('fields=')[1].split('&')[0])

    def test_existing_exact_trace_verifies_without_post(self):
        plan = lf.prepare(PROJECT, event())
        transport = MemoryHTTP([{'data': [{'id': PROJECT}]}, page(plan)])
        result = lf.Publisher(transport).publish(PROJECT, event())
        self.assertTrue(result['acknowledged']); self.assertFalse(result['post_attempted'])
        self.assertEqual([m for m, _, _ in transport.calls], ['GET', 'GET'])

    def test_langfuse_queue_job_requires_complete_readback(self):
        plan = lf.prepare(PROJECT, event())
        projects = {'data': [{'id': PROJECT}]}
        job = {'id': '42', 'name': 'otel-ingestion-job', 'data': {}}
        for readbacks, verified in (([page(plan)], True), ([EMPTY] * 3, False)):
            with self.subTest(verified=verified), patch.object(lf.time, 'sleep'):
                transport = MemoryHTTP([projects, EMPTY, job, *readbacks])
                result = lf.Publisher(transport).publish(PROJECT, event())
                self.assertEqual(result['readback_verified'], verified)
                self.assertEqual([m for m, _, _ in transport.calls], ['GET', 'GET', 'POST'] + ['GET'] * len(readbacks))
                if not verified:
                    self.assertEqual(result['reason_code'], 'readback_missing')

    def test_partial_success_timeout_and_corrupt_post_never_trigger_second_post(self):
        for reply in ({'partialSuccess': {'rejectedSpans': '1', 'errorMessage': 'fake-secret'}},
                      {'partialSuccess': {}}, {'unexpected': 'fake-secret'},
                      {'id': '42', 'name': 'otel-ingestion-job', 'data': {}, 'error': 'fake-secret'},
                      {'id': '42', 'name': 'otel-ingestion-job', 'data': {}, 'partialSuccess': {'rejectedSpans': 1}},
                      {'id': '', 'name': 'otel-ingestion-job', 'data': {}},
                      TimeoutError('fake-secret'), lf.TelemetryError('fake-secret')):
            transport = MemoryHTTP([{'data': [{'id': PROJECT}]}, EMPTY, reply,
                                    {'data': [{'id': PROJECT}]}, EMPTY])
            client = lf.Publisher(transport)
            first = client.publish(PROJECT, event()); second = client.publish(PROJECT, event())
            self.assertFalse(first['acknowledged']); self.assertFalse(second['acknowledged'])
            self.assertNotIn('fake-secret', str(first)); self.assertNotIn('fake-secret', str(second))
            self.assertEqual(len([c for c in transport.calls if c[0] == 'POST']), 1)

    def test_langfuse_normalized_observations_verify_without_post(self):
        value = event()
        value['cli_total_cost_usd_estimate'] = 0
        value['model_usage']['fixture-model']['costUSD'] = 0
        plan = lf.prepare(PROJECT, value)
        observed = page(plan)
        span, generation = observed['data']
        for row in observed['data']:
            row['metadata'].update(repository_id=123, run_id=456, run_attempt=1,
                                   billing_verified=False, **{'scope.version': '1'})
        span.update(model='', totalCost=None)
        span['metadata']['cli_total_cost_usd_estimate'] = 0
        generation['metadata']['input_total_including_cache'] = 80
        transport = MemoryHTTP([{'data': [{'id': PROJECT}]}, observed])
        result = lf.Publisher(transport).publish(PROJECT, value)
        self.assertTrue(result['readback_verified'])
        self.assertEqual([method for method, _, _ in transport.calls], ['GET', 'GET'])

        for index, key, wrong in ((0, 'run_attempt', True), (0, 'billing_verified', True),
                                  (0, 'cli_total_cost_usd_estimate', False),
                                  (1, 'input_total_including_cache', 81)):
            with self.subTest(key=key):
                mismatch = copy.deepcopy(observed)
                mismatch['data'][index]['metadata'][key] = wrong
                with self.assertRaisesRegex(lf.TelemetryError, 'readback_mismatch'):
                    lf.readback(plan, mismatch)
        span['model'] = 'unexpected-model'
        with self.assertRaisesRegex(lf.TelemetryError, 'readback_mismatch'):
            lf.readback(plan, observed)

    def test_wrong_project_and_organization_inventory_never_write(self):
        for projects in ({'data': [{'id': 'other'}]}, {'data': [{'id': PROJECT}, {'id': 'other'}]}, {'data': []}):
            transport = MemoryHTTP([projects])
            self.assertFalse(lf.Publisher(transport).publish(PROJECT, event())['acknowledged'])
            self.assertEqual(len(transport.calls), 1)

    def test_spoofed_stale_or_incomplete_readback_is_not_acknowledged(self):
        mutations = [lambda p: p['data'][1].update(projectId='other'),
                     lambda p: p['data'][1].update(traceId='f' * 32),
                     lambda p: p['data'][1].update(parentObservationId=None),
                     lambda p: p['data'][0].update(isRootObservation=False),
                     lambda p: p['data'][0].pop('parentObservationId'),
                     lambda p: p['data'][1].update(type='SPAN'),
                     lambda p: p['data'][1].update(sessionId='other'),
                     lambda p: p['data'][1].update(model='other'),
                     lambda p: p['data'][1].update(startTime='2026-11-04T12:00:00Z'),
                     lambda p: p['data'][1]['metadata'].update(binding_sha256='f' * 64),
                     lambda p: p['data'][1]['usageDetails'].update(total=99),
                     lambda p: p['data'][1]['costDetails'].update(total=123),
                     lambda p: p['data'][0].update(totalCost=0.03),
                     lambda p: p['data'].append(copy.deepcopy(p['data'][0])),
                     lambda p: p['meta'].update(cursor='next-page'),
                     lambda p: p.pop('meta'), lambda p: p['data'].pop()]
        plan = lf.prepare(PROJECT, event())
        for mutate in mutations:
            wrong = page(plan); mutate(wrong)
            transport = MemoryHTTP([{'data': [{'id': PROJECT}]}, wrong])
            result = lf.Publisher(transport).publish(PROJECT, event())
            self.assertFalse(result['acknowledged'])
            self.assertFalse(any(m == 'POST' for m, _, _ in transport.calls))

    def test_empty_readback_exhausts_bounded_gets_without_success(self):
        transport = MemoryHTTP([{'data': [{'id': PROJECT}]}, EMPTY, {}, EMPTY, EMPTY, EMPTY])
        with patch.object(lf.time, 'sleep'):
            result = lf.Publisher(transport).publish(PROJECT, event())
        self.assertFalse(result['acknowledged']); self.assertEqual(len(transport.calls), 6)
        self.assertEqual(result['write_status'], 'accepted_unverified')


class HTTPTests(unittest.TestCase):
    def transport(self):
        return lf.HTTPTransport('pk-lf-fixture-public', 'sk-lf-fixture-secret')

    def connection(self, raw=b'{}', status=200, headers=None):
        class Response:
            def __init__(self): self.status = status
            def getheader(self, key, default=None):
                return {'Content-Type': 'application/json', **(headers or {})}.get(key, default)
            def read(self, size):
                self.requested_size = size
                return raw[:size]
        class Connection:
            sock = None
            def __init__(self): self.calls = []; self.closed = False
            def connect(self): pass
            def request(self, *args, **kwargs): self.calls.append((args, kwargs))
            def getresponse(self): return Response()
            def close(self): self.closed = True
        return Connection()

    def test_fixed_https_origin_ignores_proxy_environment_and_sets_otlp_version(self):
        connection = self.connection()
        with patch.dict(os.environ, {'HTTPS_PROXY': 'https://attacker.invalid', 'HTTP_PROXY': 'http://attacker.invalid'}), \
                patch.object(lf.http.client, 'HTTPSConnection', return_value=connection) as create:
            result = self.transport().request('POST', lf.TRACES, lf.prepare(PROJECT, event())['payload'])
        self.assertEqual(result, {}); self.assertTrue(connection.closed)
        self.assertEqual(create.call_args.args, ('langfuse.smartsoft.biz.pl',))
        self.assertEqual(create.call_args.kwargs['port'], 443)
        self.assertEqual(create.call_args.kwargs['timeout'], 8)
        self.assertEqual(len(connection.calls), 1)
        headers = connection.calls[0][1]['headers']
        self.assertEqual(headers['x-langfuse-ingestion-version'], '4')
        self.assertEqual(headers['Content-Type'], 'application/json')
        self.assertTrue(headers['Authorization'].startswith('Basic '))

    def test_redirect_never_follows_location_or_prints_credentials(self):
        for location in ('https://attacker.invalid', 'http://langfuse.smartsoft.biz.pl/api/public/projects', '/api/public/projects'):
            connection = self.connection(status=302, headers={'Location': location})
            output = io.StringIO()
            with patch.object(lf.http.client, 'HTTPSConnection', return_value=connection) as create, \
                    contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                with self.assertRaisesRegex(lf.TelemetryError, '^http_redirect$'):
                    self.transport().request('GET', lf.PROJECTS)
            self.assertEqual(create.call_count, 1); self.assertEqual(output.getvalue(), '')

    def test_invalid_paths_queries_methods_and_large_requests_fail_before_connect(self):
        plan = lf.prepare(PROJECT, event())
        invalid = [('GET', 'https://attacker.invalid/api/public/projects', None),
                   ('GET', '//attacker.invalid/api/public/projects', None),
                   ('POST', '/api/public/ingestion', {}), ('DELETE', lf.PROJECTS, None),
                   ('GET', lf.PROJECTS + '?secret=fixture', None),
                   ('GET', plan['query_path'] + '&traceId=' + 'a' * 32, None),
                   ('GET', plan['query_path'].replace('limit=9', 'limit=1000'), None),
                   ('GET', plan['query_path'].replace('metadata%2Cmodel', 'io%2Cmodel'), None),
                   ('POST', lf.TRACES, {'large': 'x' * (lf.MAX_BYTES + 1)})]
        with patch.object(lf.http.client, 'HTTPSConnection') as create:
            for method, path, body in invalid:
                with self.subTest(path=path), self.assertRaises(lf.TelemetryError):
                    self.transport().request(method, path, body)
            create.assert_not_called()

    def test_invalid_or_oversized_responses_fail_closed(self):
        cases = [(b'', 200, None), (b'{"a":1,"a":2}', 200, None), (b'{"cost":NaN}', 200, None),
                 (b'{"cost":1e999}', 200, None),
                 (b'{}', 401, None), (b'{}', 500, None), (b'{}', 200, {'Content-Type': 'text/html'}),
                 (b'{}', 200, {'Content-Encoding': 'gzip'}),
                 (b'{}', 200, {'Content-Length': str(lf.MAX_BYTES + 1)}),
                 (b'x' * (lf.MAX_BYTES + 1), 200, None)]
        for raw, status, headers in cases:
            connection = self.connection(raw, status, headers)
            with patch.object(lf.http.client, 'HTTPSConnection', return_value=connection):
                with self.assertRaises(lf.TelemetryError): self.transport().request('GET', lf.PROJECTS)
            self.assertTrue(connection.closed)

    def test_timeout_errors_are_sanitized_and_credentials_never_discovered(self):
        connection = self.connection()
        def fail(*args, **kwargs): raise TimeoutError('sk-lf-fixture-secret and server raw body')
        connection.getresponse = fail
        with patch.object(lf.http.client, 'HTTPSConnection', return_value=connection):
            with self.assertRaises(lf.TelemetryError) as caught: self.transport().request('GET', lf.PROJECTS)
        self.assertEqual(str(caught.exception), 'transport_failed'); self.assertTrue(caught.exception.__suppress_context__)
        with patch.dict(os.environ, {'LANGFUSE_PUBLIC_KEY': 'pk-lf-fixture-public', 'LANGFUSE_SECRET_KEY': 'sk-lf-fixture-secret'}):
            with self.assertRaises(lf.TelemetryError): lf.HTTPTransport(None, None)
        self.assertNotIn('fixture-secret', repr(self.transport()))

    def test_expired_inflight_socket_is_closed_and_cannot_acknowledge(self):
        connection = self.connection()
        released = lf.threading.Event()
        def close(): connection.closed = True; released.set()
        connection.close = close
        original = connection.getresponse
        def delayed_response():
            self.assertTrue(released.wait(1), 'request deadline did not close the connection')
            return original()
        connection.getresponse = delayed_response
        with patch.object(lf, 'TIMEOUT_SECONDS', 0.01), \
                patch.object(lf.http.client, 'HTTPSConnection', return_value=connection):
            with self.assertRaises(lf.TelemetryError): self.transport().request('GET', lf.PROJECTS)
        self.assertTrue(connection.closed)

    def test_deadline_between_check_and_send_cannot_automatically_reconnect(self):
        timer_callbacks = []
        connection = self.connection()
        connection.auto_open = True
        counts = {'connect': 0, 'sent': 0}
        class Socket:
            def shutdown(self, how): pass
        def connect(): counts['connect'] += 1; connection.sock = Socket()
        def close(): connection.sock = None
        def request(*args, **kwargs):
            timer_callbacks[0]()  # Deadline fires after the guard, immediately before send.
            if connection.sock is None:
                if connection.auto_open: connect()
                else: raise lf.http.client.NotConnected()
            counts['sent'] += 1
        connection.connect = connect; connection.close = close; connection.request = request
        class Timer:
            daemon = False
            def __init__(self, timeout, callback): timer_callbacks.append(callback)
            def start(self): pass
            def cancel(self): pass
        with patch.object(lf.threading, 'Timer', Timer), \
                patch.object(lf.http.client, 'HTTPSConnection', return_value=connection):
            with self.assertRaises(lf.TelemetryError):
                self.transport().request('POST', lf.TRACES, lf.prepare(PROJECT, event())['payload'])
        self.assertEqual(counts, {'connect': 1, 'sent': 0})


if __name__ == '__main__': unittest.main()
