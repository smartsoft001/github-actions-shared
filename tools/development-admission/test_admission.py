import contextlib
import importlib.util
import io
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
ACTION = ROOT / '.github/actions/development-admission'
spec = importlib.util.spec_from_file_location('admission_guard', ACTION / 'guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
NORMAL_ID = '11111111-1111-4111-8111-111111111111'
LABEL_ID = '22222222-2222-4222-8222-222222222222'


def page(*, names=(), more=False, cursor=None, identity=NORMAL_ID, key='GAL-9999'):
    return {'data': {'issue': {'id': identity, 'identifier': key, 'labels': {
        'nodes': [{'id': LABEL_ID, 'name': name} for name in names],
        'pageInfo': {'hasNextPage': more, 'endCursor': cursor}}}}}


class AdmissionTests(unittest.TestCase):
    def run_guard(self, read, key='GAL-9999', repo='smartsoft001/galena-tele'):
        return guard.admit(key, repo, 'fixture-secret', ACTION / 'ownership.json', read=read)


    def test_model_jobs_require_admission_and_pin_tested_action(self):
        pins = set()
        for filename, job in [('ai-plan.yml', 'plan'), ('ai-impl.yml', 'impl')]:
            source = (ROOT / '.github/workflows' / filename).read_text()
            sections = dict(re.findall(r'^  (\w+):\n(.*?)(?=^  \w+:\n|\Z)', source.split('jobs:\n', 1)[1], re.M | re.S))
            self.assertIn('admission', sections)
            self.assertIn('needs: admission', sections[job])
            self.assertIn("if: ${{ needs.admission.outputs.allowed == 'true' }}", sections[job])
            self.assertNotIn('claude', sections['admission'].lower())
            pin = re.search(r'uses: smartsoft001/github-actions-shared/\.github/actions/development-admission@([a-f0-9]{40})\b', sections['admission']).group(1)
            pins.add(pin)
            for name in ('action.yml', 'guard.py', 'ownership.json'):
                pinned = subprocess.check_output(['git', 'show', f'{pin}:.github/actions/development-admission/{name}'], cwd=ROOT)
                self.assertEqual(pinned, (ACTION / name).read_bytes())
            for name, body in sections.items():
                if 'claude --print' in body or 'Install Claude' in body:
                    self.assertEqual(name, job)
        self.assertEqual(len(pins), 1)

    def test_ordinary_issue_is_admitted_only_after_complete_read(self):
        calls = []
        def read(token, variables):
            calls.append((token, variables))
            return page(names=['AI Plan'])
        self.assertTrue(self.run_guard(read)['allowed'])
        self.assertEqual(calls, [('fixture-secret', {'id': 'GAL-9999', 'after': None})])

    def test_enrolled_keys_are_blocked_even_in_wrong_repository_without_api(self):
        for key in ('GAL-1858', 'GAL-1881'):
            with self.assertRaisesRegex(guard.Denied, 'coordinator-owned'):
                self.run_guard(lambda *_: self.fail('network call'), key=key, repo='other/repository')

    def test_known_uuid_cannot_escape_by_identifier_change(self):
        with self.assertRaisesRegex(guard.Denied, 'coordinator-owned'):
            self.run_guard(lambda *_: page(identity='9022fa28-08d3-4291-bd99-dbcc1345abcb'))

    def test_skip_label_on_later_page_blocks(self):
        calls = []
        def read(_token, variables):
            calls.append(variables['after'])
            return page(names=['AI Skip CI']) if variables['after'] else page(more=True, cursor='next')
        with self.assertRaisesRegex(guard.Denied, 'ai-skip-ci'):
            self.run_guard(read)
        self.assertEqual(calls, [None, 'next'])

    def test_unavailable_partial_and_ambiguous_inventory_do_not_admit(self):
        bad = [ {'errors': [{'message': 'private upstream details'}], **page()},
                {'data': {'issue': None}}, page(identity='not-uuid'), page(key='GAL-1'),
                page(more=True), {'data': {'issue': {'id': NORMAL_ID, 'identifier': 'GAL-9999'}}} ]
        for response in bad:
            with self.subTest(response=response), self.assertRaises(guard.Denied):
                self.run_guard(lambda *_: response)

    def test_repeated_cursor_and_label_identity_block(self):
        with self.assertRaisesRegex(guard.Denied, 'incomplete-label-inventory'):
            self.run_guard(lambda *_: page(more=True, cursor='same'))
        with self.assertRaisesRegex(guard.Denied, 'incomplete-label-inventory'):
            self.run_guard(lambda *_: page(names=['ordinary'], more=True, cursor='same'))

    def test_invalid_identifier_never_reaches_network_or_shell(self):
        for key in ('GAL-1;echo secret', 'GAL-1\n', '${{ secrets.X }}', '', None):
            with self.assertRaisesRegex(guard.Denied, 'invalid-identity'):
                self.run_guard(lambda *_: self.fail('network'), key=key)

    def test_missing_credential_and_registry_corruption_fail_closed(self):
        with self.assertRaisesRegex(guard.Denied, 'missing-read-credential'):
            guard.admit('GAL-9999', 'owner/repo', '', ACTION / 'ownership.json', read=lambda *_: self.fail('network'))
        with tempfile.TemporaryDirectory() as temp:
            registry = Path(temp) / 'registry.json'
            registry.write_text('{"schema_version":2,"entries":[]}')
            with self.assertRaises(guard.Denied):
                guard.admit('GAL-9999', 'owner/repo', 'key', registry, read=lambda *_: self.fail('network'))
            with self.assertRaises(FileNotFoundError):
                guard.admit('GAL-9999', 'owner/repo', 'key', registry.with_name('missing.json'))

    def test_main_reports_only_safe_denial_and_false_output(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'output'
            stdout = io.StringIO()
            with patch.dict(os.environ, {'GITHUB_OUTPUT': str(output)}, clear=True), \
                 patch.object(guard, 'admit', side_effect=RuntimeError('secret response body')), \
                 contextlib.redirect_stdout(stdout):
                guard.main()
            self.assertEqual(output.read_text(), 'allowed=false\nreason=admission-unavailable\n')
            self.assertNotIn('secret', stdout.getvalue())
            self.assertFalse(json.loads(stdout.getvalue())['allowed'])

    def test_main_exposes_exact_safe_reason_for_scenario_checks(self):
        scenarios = [
            ({'allowed': True, 'reason': 'linear-readback-verified', 'model_calls': 0}, None),
            (None, guard.Denied('ai-skip-ci')),
            (None, guard.Denied('missing-read-credential')),
            (None, guard.Denied('coordinator-owned')),
        ]
        for result, error in scenarios:
            with tempfile.TemporaryDirectory() as temp:
                output = Path(temp) / 'output'
                with patch.dict(os.environ, {'GITHUB_OUTPUT': str(output)}, clear=True), \
                     patch.object(guard, 'admit', return_value=result, side_effect=error), \
                     contextlib.redirect_stdout(io.StringIO()):
                    guard.main()
                reason = str(error) if error else result['reason']
                allowed = 'false' if error else 'true'
                self.assertEqual(output.read_text(), f'allowed={allowed}\nreason={reason}\n')

    def test_http_read_is_fixed_origin_bounded_and_has_no_redirect_handler(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, limit):
                self.limit = limit
                return json.dumps(page()).encode()
        response = Response()
        class Opener:
            def open(inner, request, timeout):
                self.assertEqual(request.full_url, 'https://api.linear.app/graphql')
                self.assertEqual(request.method, 'POST')
                self.assertEqual(timeout, 10)
                self.assertEqual(json.loads(request.data)['query'], guard.QUERY)
                return response
        with patch.object(guard.urllib.request, 'build_opener', return_value=Opener()) as build:
            self.assertEqual(guard.linear_read('secret', {'id': 'GAL-9999'}), page())
            handler, = build.call_args.args
            self.assertIsNone(handler.redirect_request(None, None, None, None, None, 'https://foreign.invalid'))
            self.assertEqual(response.limit, 1048577)


if __name__ == '__main__':
    unittest.main()
