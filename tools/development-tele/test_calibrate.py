import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
import subprocess
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import calibrate


def archive(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as out:
        for name, value in entries.items():
            info = tarfile.TarInfo(name)
            data = value.encode()
            info.size = len(data)
            out.addfile(info, io.BytesIO(data))
    stream.seek(0)
    return stream


class CalibrationTests(unittest.TestCase):
    def test_export_excludes_environment_and_history_and_removes_cloud_token(self):
        values = {'package.json': '{}', '.env': 'SECRET=sentinel-secret',
                  '.env.production': 'SECRET=sentinel-secret',
                  'tools/mongo/config.json': '{"password":"sentinel-secret"}',
                  '.mcp.json': '{"token":"sentinel-secret"}', '.git/config': 'sentinel-secret',
                  'nx.json': json.dumps({'npmScope': 'tele', 'tasksRunnerOptions': {
                      'default': {'runner': '@nrwl/nx-cloud', 'options': {'accessToken': 'sentinel-secret'}}}}),
                  'libs/files/shell/nestjs/src/test.ts': 'export const value = 1;'}
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / 'candidate'
            manifest = calibrate.export_archive(archive(values), destination)
            text = ''.join(p.read_text() for p in destination.rglob('*') if p.is_file())
            self.assertNotIn('sentinel-secret', text)
            self.assertFalse((destination / '.env').exists())
            self.assertFalse((destination / '.git').exists())
            nx = json.loads((destination / 'nx.json').read_text())
            self.assertEqual(nx['npmScope'], 'tele')
            self.assertEqual(nx['tasksRunnerOptions']['default']['runner'], 'nx/tasks-runners/default')
            self.assertEqual(nx['tasksRunnerOptions']['default']['options'], {})
            self.assertEqual(manifest['rewritten'], ['nx.json'])
            self.assertEqual(set(manifest['excluded']), {'.env', '.env.production', '.git/config', '.mcp.json', 'tools/mongo/config.json'})
            self.assertNotIn('.env', manifest['files_sha256'])

    def test_unsafe_archive_never_writes_outside_export(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(calibrate.Blocked):
                calibrate.export_archive(archive({'../escaped': 'x'}), Path(temp) / 'candidate')
            self.assertFalse((Path(temp) / 'escaped').exists())

    def test_archive_symlink_and_duplicate_are_rejected(self):
        for kind in ['symlink', 'duplicate']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temp:
                stream = io.BytesIO()
                with tarfile.open(fileobj=stream, mode='w') as out:
                    item = tarfile.TarInfo('link')
                    if kind == 'symlink':
                        item.type = tarfile.SYMTYPE; item.linkname = '/etc/passwd'; out.addfile(item)
                    else:
                        item.size = 1; out.addfile(item, io.BytesIO(b'a')); out.addfile(item, io.BytesIO(b'b'))
                stream.seek(0)
                with self.assertRaises(calibrate.Blocked):
                    calibrate.export_archive(stream, Path(temp) / 'candidate')

    def test_no_host_credentials_network_or_history_in_checks_container(self):
        command = calibrate.container_command(Path('/tmp/calibration'), 'build', ['node', '/trusted/checks.cjs', 'build'])
        self.assertIn('--network=none', command)
        self.assertIn('--read-only', command)
        self.assertIn('/tmp/calibration/candidate:/work:ro', command)
        self.assertIn('/tmp/calibration/dependencies:/deps:ro', command)
        self.assertIn('NX_NO_CLOUD=true', command)
        self.assertIn('NX_PROJECT_GRAPH_CACHE_DIRECTORY=/tmp/nx-project-graph', command)
        self.assertIn(calibrate.IMAGE, command)
        self.assertFalse(any('TOKEN' in x or 'SECRET' in x or '.git:' in x for x in command))
        install = calibrate.container_command(Path('/tmp/calibration'), 'install', ['node', '/trusted/checks.cjs', 'install'])
        self.assertIn('--network=bridge', install)
        self.assertIn('/tmp/calibration/dependencies:/deps:rw', install)
        self.assertNotIn('/tmp/calibration/candidate:/work:ro', install)
        self.assertIn('/tmp/calibration/candidate/package.json:/work/package.json:ro', install)
        self.assertIn('/tmp/calibration/candidate/tools/packages:/work/tools/packages:ro', install)

    def test_interrupt_always_removes_only_own_container(self):
        with patch.object(calibrate.core, 'run_logged', side_effect=KeyboardInterrupt), \
                patch.object(calibrate.subprocess, 'run') as cleanup:
            with self.assertRaises(KeyboardInterrupt):
                calibrate.run_container(Path('/tmp/calibration'), 'build', ['node'],
                                        Path('/tmp/result'), Path('/tmp/log'),
                                        'tele-cal-123456789abc-build-0', 5)
            self.assertEqual(cleanup.call_args.args[0],
                             ['docker', 'rm', '--force', 'tele-cal-123456789abc-build-0'])

    def test_lint_creates_graph_before_running_rules_and_preserves_failures(self):
        script = r"""
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert');
const source = fs.readFileSync(process.argv[1], 'utf8');
(async () => {
 for (const mode of ['pass', 'lint-fail', 'cache-miss', 'missing-project']) {
  const status = mode === 'pass' ? 0 : 1;
  let events = [], proc = { argv: ['node', 'checks.cjs', 'lint'] };
  const context = { process: proc, console: { error() {} }, require(id) {
   if (id === 'node:fs') return {};
   if (id === 'node:child_process') return { spawnSync(command, args, opts) {
    assert.deepEqual(events, ['graph', 'read-cache']); events.push('lint');
    assert.equal(command, 'node'); assert.equal(args[0], '/deps/node_modules/eslint/bin/eslint.js');
    assert.equal(opts.cwd, '/work'); return { status };
   }};
   if (id === 'node:module') return { createRequire() { return name => {
    if (name.endsWith('project-graph')) return {
     async createProjectGraphAsync() { events.push('graph'); return {}; },
     readCachedProjectGraph() {
      events.push('read-cache');
      if (mode === 'cache-miss') throw Error('No graph');
      return { nodes: mode === 'missing-project' ? {} : {
       a: { data: { root: 'libs/files/shell/app-services' } },
       b: { data: { root: 'libs/files/shell/nestjs' } }
      }};
     }
    };
    if (name.endsWith('/run')) return {};
    throw Error(name);
   }; }};
   throw Error(id);
  }};
  await vm.runInNewContext(source, context);
  assert.deepEqual(events, ['graph', 'read-cache', ...(['pass', 'lint-fail'].includes(mode) ? ['lint'] : [])]);
  assert.equal(proc.exitCode || 0, status);
 }
})().catch(e => { console.error(e); process.exitCode = 1; });
"""
        result = subprocess.run(['node', '-e', script, str(Path(__file__).with_name('checks.cjs'))],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_fixed_profile_requires_real_tests_and_keeps_failed_diagnostics(self):
        self.assertEqual(len(calibrate.commands()['regression']), 2)
        self.assertEqual(len(calibrate.commands()['typecheck']), 5)
        for command in calibrate.commands()['regression']:
            self.assertIn('--passWithNoTests=false', command)
        result = calibrate.summarize_tests({'success': True, 'numPassedTests': 0,
            'numFailedTests': 0, 'numPendingTests': 0, 'numTodoTests': 0}, {'total': {}})
        self.assertFalse(result['qualified'])
        self.assertEqual(result['passed'], 0)

    def test_malformed_counts_or_coverage_cannot_pass(self):
        good = {'success': True, 'numPassedTests': 5, 'numFailedTests': 0, 'numPendingTests': 0, 'numTodoTests': 0}
        coverage = {'total': {key: {'pct': 99} for key in calibrate.MINIMUMS}}
        self.assertTrue(calibrate.summarize_tests(good, coverage)['qualified'])
        for key, value in [('numPassedTests', True), ('numFailedTests', -1), ('numPendingTests', 1), ('numTodoTests', 1)]:
            changed = {**good, key: value}
            self.assertFalse(calibrate.summarize_tests(changed, coverage)['qualified'])
        coverage['total']['branches']['pct'] = float('nan')
        self.assertFalse(calibrate.summarize_tests(good, coverage)['qualified'])


if __name__ == '__main__':
    unittest.main()
