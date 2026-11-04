import copy
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('tester', Path(__file__).with_name('tester.py'))
tester = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tester)
H, B, W = 'a' * 40, 'b' * 40, 'c' * 40


def source():
    return {'number': 99, 'state': 'open', 'draft': False,
            'updated_at': '2026-11-04T09:00:00Z',
            'head': {'sha': H, 'repo': {'full_name': tester.REPO}},
            'base': {'sha': B, 'ref': 'development', 'repo': {'full_name': tester.REPO}},
            'labels': [{'name': tester.LABEL}], 'changed_files': 1,
            'body': '## Acceptance criteria\nPolskie znaki są zachowane.', 'title': 'GAL-1231 fixture'}


def subject():
    return tester.freeze(source(), B, H, B, W, W, B,
                         {'run_id': '123', 'run_attempt': '1', 'workflow_sha': 'd' * 40,
                          'shared_sha': 'e' * 40, 'helper_sha': 'f' * 40})


def checks():
    return {'head_sha': H, 'base_sha': B, 'run_id': '123', 'run_attempt': '1',
            'results': {k: {'status': 'passed', 'exit_code': 0, 'log_sha256': 'a' * 64}
                        for k in tester.CHECKS},
            'tests': {'passed': 8, 'failed': 0, 'skipped': 0},
            'coverage': {k: 90 for k in ['statements', 'branches', 'functions', 'lines']}}


def review():
    return {'type': 'result', 'subtype': 'success', 'is_error': False,
            'session_id': '7d926dba-a359-4ec2-a7e4-5a56c0dd57a1',
            'modelUsage': {'claude-opus-5': {}},
            'structured_output': {'verdict': 'passed', 'summary': 'Reviewed fixture.',
                                  'findings': [], 'unverified': []}}


class ContractTests(unittest.TestCase):
    def test_result_parent_symlink_cannot_reuse_another_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); result = root / 'result'; result.mkdir()
            previous = root / 'previous'; previous.mkdir(); (previous / 'coverage-summary.json').write_text('{}')
            (result / 'coverage').symlink_to(previous, target_is_directory=True)
            with self.assertRaises(tester.Blocked):
                tester.require_regular_result(result / 'coverage' / 'coverage-summary.json', result)

    def test_fixed_profile_rejects_config_dependency_and_other_source_changes(self):
        valid = 'libs/documents/shell/nestjs/src/a.ts'
        tester.mvno_profile.check_scope([valid])
        for invalid in ['package-lock.json', 'angular.json', 'libs/documents/shell/nestjs/jest.config.ts',
                        'libs/users/src/a.ts', 'libs/documents/shell/nestjs/src/../../jest.config.ts']:
            with self.assertRaises(ValueError): tester.mvno_profile.check_scope([valid, invalid])
        plan = tester.mvno_profile.commands([valid])
        self.assertEqual(len(plan['regression']), 4)
        self.assertEqual(len(plan['typecheck']), 3)

    def test_fake_nx_marker_and_exit_zero_do_not_supply_a_test_result(self):
        # Exact early-review exploit: arbitrary module exits 0 and prints the former trusted marker.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = 'DEVELOPMENT_RESULT=' + json.dumps({'tests': {'passed': 1, 'failed': 0, 'skipped': 0},
                                                       'coverage': {k: 100 for k in ['statements', 'branches', 'functions', 'lines']}})
            result = tester.run_logged([sys.executable, '-c', 'print(' + repr(marker) + ')'], root / 'log')
            self.assertEqual(result['exit_code'], 0)
            with self.assertRaises(tester.Blocked): tester.result_summary(root)

    def test_host_never_skips_missing_build_output_after_early_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); candidate = root / 'candidate'; candidate.mkdir()
            filename = 'libs/documents/shell/nestjs/src/a.ts'
            file = candidate / filename; file.parent.mkdir(parents=True); file.write_text('export {};')
            s = {**subject(), 'paths': [filename]}; executed = []
            def fake_command(args, log, **kwargs):
                executed.append(args)
                return {'exit_code': 0, 'status': 'passed', 'log_sha256': 'a' * 64}
            with patch.object(tester, 'run_logged', side_effect=fake_command), self.assertRaises(tester.Blocked):
                tester.execute_checks(candidate, root, s)
            self.assertEqual(len(executed), 2)  # install and build really attempted; no success receipt

    def test_symlink_and_submodule_source_are_not_reviewed_as_plain_text(self):
        for mode, kind in [('120000', 'blob'), ('160000', 'commit')]:
            with self.assertRaises(tester.Blocked):
                tester.tree_content('file', H, {'file': {'mode': mode, 'type': kind}})

    def test_fresh_test_reports_require_real_counts_and_coverage(self):
        result = {'success': True, 'numPassedTests': 4, 'numFailedTests': 0, 'numPendingTests': 0, 'numTodoTests': 0}
        coverage = {'total': {k: {'pct': 90} for k in ['statements', 'branches', 'functions', 'lines']}}
        self.assertEqual(tester.mvno_profile.test_summary(result, coverage)['tests']['passed'], 4)
        for bad in [{'numPassedTests': 0}, {'numPendingTests': 1}, {'numTodoTests': 1}, {'numFailedTests': 1}, {'success': False}]:
            with self.assertRaises(ValueError): tester.mvno_profile.test_summary({**result, **bad}, coverage)
        coverage['total']['lines']['pct'] = float('nan')
        with self.assertRaises(ValueError): tester.mvno_profile.test_summary(result, coverage)

    def test_real_subprocess_has_clean_environment_and_separate_stderr(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / 'fake-cli.py'
            script.write_text('import os,sys,json\nprint("warning", file=sys.stderr)\n'
                              'print(json.dumps({"env":dict(os.environ),"input":sys.stdin.read(),"cwd":os.getcwd()}))\n')
            result = tester.run_logged([sys.executable, str(script)], root / 'out.json', cwd=root,
                       env={'PATH': os.environ['PATH'], 'CI': 'true'}, stdin='untrusted ::set-output name=x::data',
                       stderr=root / 'stderr.log', timeout=2)
            output = tester.read(root / 'out.json')
            self.assertEqual(result['status'], 'passed')
            self.assertNotIn('GITHUB_OUTPUT', output['env'])
            self.assertNotIn('GH_TOKEN', output['env'])
            self.assertEqual(output['input'], 'untrusted ::set-output name=x::data')
            self.assertEqual((root / 'stderr.log').read_text(), 'warning\n')

    def test_timeout_includes_process_which_never_reads_stdin(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(tester.Blocked):
                tester.run_logged([sys.executable, '-c', 'import time; time.sleep(30)'],
                                  Path(directory) / 'log', timeout=0.1, stdin='x' * 200000)

    def test_duplicate_json_and_nonfinite_numbers_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'report.json'
            for value in ['{"result":"failed","result":"passed"}', '{"coverage":NaN}']:
                file.write_text(value)
                with self.assertRaises(tester.Blocked): tester.read(file)

    def test_replayed_artifact_identity_fails(self):
        s = subject(); env = {'DT_' + k.upper(): v for k, v in s['producer'].items()}
        tester.bind_subject(s, env)
        for key in env:
            with self.assertRaises(tester.Blocked): tester.bind_subject(s, {**env, key: 'other'})

    def test_valid_subject_and_final_report(self):
        s = subject()
        r = tester.final_report(s, checks(), review(), source(), B, W, W)
        self.assertEqual(r['result'], 'passed')
        self.assertEqual(r['subject']['head_sha'], H)
        self.assertIsNone(r['implementation']['run_id'])
        self.assertEqual(r['independence'], 'fresh-review-job-and-session')

    def test_subject_rejects_scope_and_races(self):
        cases = [lambda p: p['head']['repo'].update(full_name='attacker/fork'),
                 lambda p: p['base'].update(ref='master'),
                 lambda p: p.update(state='closed'), lambda p: p.update(labels=[]),
                 lambda p: p['head'].update(sha='f' * 40), lambda p: p['base'].update(sha='f' * 40)]
        for mutate in cases:
            p = source(); mutate(p)
            with self.subTest(p=p), self.assertRaises(tester.Blocked):
                tester.freeze(p, B, H, B, W, W, B, subject()['producer'])

    def test_wrong_base_wrapper_and_ancestry_fail(self):
        for values in [('f' * 40, W, W, B), (B, 'f' * 40, W, B), (B, W, W, 'f' * 40)]:
            live, head_blob, execution_blob, ancestor = values
            with self.subTest(values=values), self.assertRaises(tester.Blocked):
                tester.freeze(source(), live, H, B, head_blob, execution_blob, ancestor, subject()['producer'])

    def test_missing_checks_zero_tests_skips_and_nonzero_exit_fail(self):
        mutations = [lambda x: x['results'].pop('build'),
                     lambda x: x['results']['lint'].update(status='skipped'),
                     lambda x: x['results']['build'].update(exit_code=1),
                     lambda x: x['tests'].update(passed=0),
                     lambda x: x['tests'].update(skipped=1),
                     lambda x: x['tests'].update(failed=1),
                     lambda x: x['coverage'].update(branches=74),
                     lambda x: x.update(head_sha='f' * 40),
                     lambda x: x.update(run_attempt='2')]
        for mutate in mutations:
            c = checks(); mutate(c)
            with self.subTest(c=c), self.assertRaises(tester.Blocked):
                tester.final_report(subject(), c, review(), source(), B, W, W)

    def test_model_cannot_claim_tests_or_control_subject(self):
        r = review(); r['structured_output']['checks'] = {'build': 'passed'}
        with self.assertRaises(tester.Blocked):
            tester.final_report(subject(), checks(), r, source(), B, W, W)

    def test_review_missing_invalid_findings_and_unverified_fail(self):
        mutations = [lambda x: x.update(is_error=True), lambda x: x.update(subtype='error_max_turns'),
                     lambda x: x.update(session_id=''), lambda x: x.update(modelUsage={}),
                     lambda x: x.pop('structured_output'),
                     lambda x: x['structured_output'].update(verdict='blocked'),
                     lambda x: x['structured_output'].update(findings=[{'priority': 'P2'}]),
                     lambda x: x['structured_output'].update(unverified=['missing context'])]
        for mutate in mutations:
            r = review(); mutate(r)
            with self.subTest(r=r), self.assertRaises(tester.Blocked):
                tester.final_report(subject(), checks(), r, source(), B, W, W)

    def test_final_live_base_or_head_change_blocks(self):
        p = source(); p['head']['sha'] = 'f' * 40
        with self.assertRaises(tester.Blocked):
            tester.final_report(subject(), checks(), review(), p, B, W, W)
        with self.assertRaises(tester.Blocked):
            tester.final_report(subject(), checks(), review(), source(), 'f' * 40, W, W)
        for field, value in [('body', 'changed DoD'), ('updated_at', '2026-11-04T10:00:00Z'), ('number', 100)]:
            p = source(); p[field] = value
            with self.assertRaises(tester.Blocked):
                tester.final_report(subject(), checks(), review(), p, B, W, W)

    def test_bounded_complete_bundle(self):
        entries = [{'path': 'file.ts', 'status': 'modified', 'before': 'old', 'after': 'new'}]
        self.assertIn('file.ts', tester.bundle(subject(), source(), entries))
        for entries in [[], [{'path': 'a', 'status': 'modified', 'before': '', 'after': 'x' * 200001}],
                        [{'path': '../escape', 'status': 'modified', 'before': '', 'after': 'new'}]]:
            with self.assertRaises(tester.Blocked): tester.bundle(subject(), source(), entries)

    def test_container_has_no_host_authority(self):
        args = tester.container_command(Path('/tmp/candidate'), Path('/tmp/trusted'), 'build')
        joined = ' '.join(args)
        for prohibited in ['GITHUB_TOKEN', 'GITHUB_OUTPUT', 'GITHUB_ENV', 'docker.sock', '/Users/', 'CLAUDE']:
            self.assertNotIn(prohibited, joined)
        self.assertIn('--cap-drop=ALL', args)
        self.assertIn('--network=none', args)
        self.assertIn('/trusted:ro', joined)
        self.assertIn(':/work:ro', joined)
        self.assertNotIn(':/work:rw', joined)
        self.assertIn(':/deps:ro', joined)

    def test_review_cli_has_no_tools_hooks_or_resume(self):
        args = tester.review_command('claude', 'claude-opus-5', '7d926dba-a359-4ec2-a7e4-5a56c0dd57a1')
        self.assertEqual(args[args.index('--tools') + 1], '')
        self.assertEqual(args[args.index('--setting-sources') + 1], '')
        self.assertIn('--strict-mcp-config', args)
        self.assertNotIn('--resume', args)
        self.assertNotIn('--dangerously-skip-permissions', args)

    def test_activation_is_fail_closed(self):
        with self.assertRaises(tester.Blocked): tester.require_activation({})
        with self.assertRaises(tester.Blocked): tester.require_activation({'DT_PLATFORM_APPROVAL': 'true'})


if __name__ == '__main__': unittest.main()
