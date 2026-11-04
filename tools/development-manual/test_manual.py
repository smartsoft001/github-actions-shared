import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('manual', Path(__file__).with_name('manual.py'))
manual = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manual)
E, H, B, W, S, A = [x * 40 for x in 'abcdef']
NOW = '2026-11-04T14:00:00Z'


def fixture():
    approval = {'schema_version': 1, 'contract': 'trusted-manual-v1', 'enabled': True,
                'repository': 'smartsoft001/galena-mvno', 'repository_id': 567923474,
                'execution_sha': E, 'wrapper_blob_sha': W, 'shared_sha': S, 'helper_sha': A,
                'actor_id': 6243316, 'workflow_id': 100, 'expected_run_number': 3, 'profile_id': 'mvno-v1',
                'mandate': {'id': 'fixture-only', 'pr_number': 99, 'head_sha': H, 'base_sha': B,
                            'pr_updated_at': '2026-11-04T13:00:00Z', 'requirements_sha256': 'a' * 64,
                            'valid_from': '2026-11-04T13:30:00Z', 'expires_at': '2026-11-04T15:00:00Z',
                            'max_budget_usd': 5, 'cost_acceptance': 'cli-estimate-plus-runner-usage'}}
    context = {'event': 'workflow_dispatch', 'ref': 'refs/heads/master', 'sha': E, 'workflow_sha': E,
               'run_id': 101, 'run_number': 3, 'run_attempt': 1, 'actor_id': 6243316,
               'triggering_actor': 'emiljuchnikowski', 'shared_sha': S, 'helper_sha': A,
               'pr_number': 99, 'head_sha': H, 'base_sha': B, 'mandate_id': 'fixture-only'}
    repo = {'id': 567923474, 'full_name': approval['repository'], 'default_branch': 'master'}
    actor = {'id': 6243316, 'login': 'emiljuchnikowski'}
    snapshot = {'repo': repo, 'master': {'name': 'master', 'protected': True, 'commit': {'sha': E}},
                'workflow': {'id': 100, 'path': '.github/workflows/development-tester-manual.yml', 'state': 'active'},
                'run': {'id': 101, 'workflow_id': 100, 'run_number': 3, 'run_attempt': 1,
                        'status': 'in_progress', 'conclusion': None,
                        'referenced_workflows': [{'path': 'smartsoft001/github-actions-shared/.github/workflows/development-tester-manual.yml@' + S, 'sha': S}],
                        'event': 'workflow_dispatch', 'head_branch': 'master', 'head_sha': E,
                        'path': '.github/workflows/development-tester-manual.yml', 'repository': repo,
                        'head_repository': repo, 'actor': actor, 'triggering_actor': actor},
                'wrapper_blob': W, 'wrapper_mode': '100644',
                'environment': {'name': 'development-manual-review',
                                'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}},
                'branches': {'total_count': 1, 'branch_policies': [{'name': 'master', 'type': 'branch'}]}}
    pr = {'number': 99, 'state': 'open', 'merged': False, 'draft': True, 'title': 'Fixture',
          'body': '## Acceptance criteria\nFixture', 'updated_at': approval['mandate']['pr_updated_at'],
          'changed_files': 1, 'html_url': 'https://github.com/smartsoft001/galena-mvno/pull/99',
          'head': {'sha': H, 'repo': repo}, 'base': {'sha': B, 'ref': 'development', 'repo': repo}}
    return approval, context, snapshot, pr


class ManualTests(unittest.TestCase):
    def test_paid_model_and_final_success_stay_blocked_without_real_langfuse_adapter(self):
        with self.assertRaisesRegex(ValueError, 'Langfuse'):
            manual.require_paid_telemetry()

    def test_report_is_report_only_and_never_claims_actual_billing(self):
        a, c, snap, pr = fixture()
        a['mandate']['requirements_sha256'] = manual.core.digest(manual.core.requirements(pr))
        subject = manual.freeze_subject(a, pr, B, B, ['libs/documents/shell/nestjs/src/example.ts'])
        subject['producer'] = {'run_id': '101', 'run_attempt': '1'}
        execution = manual.validate_context(a, c, snap, NOW)
        checks = {'head_sha': H, 'base_sha': B, 'run_id': '101', 'run_attempt': '1',
                  'results': {k: {'status': 'passed', 'exit_code': 0, 'log_sha256': 'a' * 64} for k in manual.core.CHECKS},
                  'tests': {'passed': 10, 'failed': 0, 'skipped': 0},
                  'coverage': {k: 90 for k in ['statements', 'branches', 'functions', 'lines']}}
        session = '7d926dba-a359-4ec2-a7e4-5a56c0dd57a1'
        review = {'execution': execution, 'subject_sha256': manual.core.digest(subject), 'requested_session_id': session,
                  'telemetry_receipt': {'provider': 'langfuse', 'acknowledged': True, 'trace_id': 'fixture', 'observation_id': 'fixture',
                                        'run_id': 101, 'run_attempt': 1, 'subject_sha256': manual.core.digest(subject),
                                        'review_session_id': session, 'model_usage_sha256': manual.core.digest({'fixture-model': {'inputTokens': 10}})},
                  'cli_result': {'type': 'result', 'subtype': 'success', 'is_error': False, 'session_id': session,
                                 'modelUsage': {'fixture-model': {'inputTokens': 10}}, 'total_cost_usd': 0.1,
                                 'structured_output': {'verdict': 'passed', 'summary': 'Synthetic fixture.', 'findings': [], 'unverified': []}}}
        receipt = manual.make_receipt(a, execution, subject, checks, review)
        self.assertFalse(receipt['merge_eligible']); self.assertTrue(receipt['report_only'])
        self.assertEqual(receipt['contract'], 'trusted-manual-v1'); self.assertFalse(receipt['cost']['billing_verified'])
        for mutate in [lambda ch,rev: ch['tests'].update(passed=0), lambda ch,rev: ch['tests'].update(skipped=1),
                       lambda ch,rev: ch.update(run_attempt='2'), lambda ch,rev: rev.pop('telemetry_receipt'),
                       lambda ch,rev: rev['telemetry_receipt'].update(run_id=102),
                       lambda ch,rev: rev['telemetry_receipt'].update(review_session_id='other'),
                       lambda ch,rev: rev.update(requested_session_id='other'),
                       lambda ch,rev: rev['cli_result'].update(total_cost_usd=float('nan'))]:
            ch, rev = copy.deepcopy(checks), copy.deepcopy(review); mutate(ch, rev)
            with self.assertRaises(ValueError): manual.make_receipt(a, execution, subject, ch, rev)

    def test_trusted_execution_is_separate_from_the_reviewed_head(self):
        a, c, s, _ = fixture()
        result = manual.validate_context(a, c, s, NOW)
        self.assertEqual(result['execution_sha'], E)
        self.assertNotEqual(result['execution_sha'], H)

    def test_wrong_event_ref_execution_actor_or_rerun_blocks(self):
        for key, value in [('event', 'pull_request'), ('ref', 'refs/tags/master'), ('ref', 'refs/heads/feature'),
                           ('sha', H), ('workflow_sha', H), ('actor_id', 42), ('run_attempt', 2),
                           ('run_number', 4), ('mandate_id', 'another'), ('head_sha', E)]:
            a, c, s, _ = fixture(); c[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                manual.validate_context(a, c, s, NOW)

    def test_live_run_identity_catches_replay_and_different_triggering_actor(self):
        for key, value in [('id', 102), ('workflow_id', 101), ('run_number', 4), ('run_attempt', 2),
                           ('event', 'push'), ('head_sha', H), ('head_branch', 'other'),
                           ('triggering_actor', {'id': 42, 'login': 'other'})]:
            a, c, s, _ = fixture(); s['run'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): manual.validate_context(a, c, s, NOW)

    def test_exact_environment_branch_policy_is_required(self):
        mutations = [lambda s: s['environment'].update(deployment_branch_policy=None),
                     lambda s: s['branches'].update(total_count=2),
                     lambda s: s['branches']['branch_policies'][0].update(type='tag'),
                     lambda s: s['branches']['branch_policies'][0].update(name='*'),
                     lambda s: s['environment']['deployment_branch_policy'].update(protected_branches=True)]
        for mutate in mutations:
            a, c, s, _ = fixture(); mutate(s)
            with self.assertRaises(ValueError): manual.validate_context(a, c, s, NOW)

    def test_stale_pins_master_and_expired_estimate_mandate_block(self):
        mutations = [lambda a,c,s: a.update(enabled=False), lambda a,c,s: a.update(shared_sha=E),
                     lambda a,c,s: s['master']['commit'].update(sha=H),
                     lambda a,c,s: s.update(wrapper_mode='120000'),
                     lambda a,c,s: a['mandate'].update(expires_at=NOW),
                     lambda a,c,s: a['mandate'].update(valid_from='2026-02-30T13:00:00Z'),
                     lambda a,c,s: a['mandate'].update(max_budget_usd=6),
                     lambda a,c,s: a['mandate'].update(cost_acceptance='hard-billing-limit')]
        for mutate in mutations:
            a, c, s, _ = fixture(); mutate(a,c,s)
            with self.assertRaises(ValueError): manual.validate_context(a, c, s, NOW)

    def test_subject_never_requires_the_manual_wrapper_on_pr_head(self):
        a, c, s, pr = fixture()
        a['mandate']['requirements_sha256'] = manual.core.digest(manual.core.requirements(pr))
        result = manual.freeze_subject(a, pr, B, B, ['libs/documents/shell/nestjs/src/example.ts'])
        self.assertEqual(result['head_sha'], H)
        self.assertEqual(result['execution_sha'], E)
        self.assertEqual(result['contract'], 'trusted-manual-v1')

    def test_closed_history_and_outside_scope_cannot_be_operational_manual_subjects(self):
        for change in ['closed', 'head', 'base', 'scope']:
            a, c, s, pr = fixture(); a['mandate']['requirements_sha256'] = manual.core.digest(manual.core.requirements(pr))
            paths = ['libs/documents/shell/nestjs/src/example.ts']
            if change == 'closed': pr['state'] = 'closed'; pr['merged'] = True
            if change == 'head': pr['head']['sha'] = E
            if change == 'base': pr['base']['sha'] = E
            if change == 'scope': paths = ['package.json']
            with self.assertRaises(ValueError): manual.freeze_subject(a, pr, B, B, paths)


if __name__ == '__main__': unittest.main()
