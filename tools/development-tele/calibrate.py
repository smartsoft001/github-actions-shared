#!/usr/bin/env python3
"""Fixed Tele snapshot, sanitized export, local checks only; never merge evidence."""
import argparse
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import time
import uuid
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'development-tester'))
import tester as core

Blocked = core.Blocked
require = core.require
SHA = 'ff998b6ab97fd2c18486a8eb8a1833b75eb2654c'
REPO = 'smartsoft001/galena-tele'
IMAGE = 'node:18.20.8-bookworm@sha256:c6ae79e38498325db67193d391e6ec1d224d96c693a8a4d943498556716d3783'
ROOTS = ('libs/files/shell/app-services', 'libs/files/shell/nestjs')
MINIMUMS = {'statements': 80, 'branches': 75, 'functions': 80, 'lines': 80}
MAX_FILE = 32 * 1024 * 1024
MAX_EXPORT = 256 * 1024 * 1024


def excluded(name):
    parts = PurePosixPath(name).parts
    return any(p.startswith('.env') or p in {'.git', '.claude', '.agents', '.mcp.json', 'node_modules'} for p in parts) or \
        (parts[:2] == ('tools', 'mongo')) or PurePosixPath(name).name.lower() in {'secrets.yaml', 'secrets.yml', 'credentials.json', 'id_rsa', 'id_ed25519'}


def export_archive(stream, destination):
    require(not destination.exists(), 'export destination already exists')
    destination.mkdir(parents=True)
    manifest = {'excluded': [], 'rewritten': [], 'files_sha256': {}}
    seen, size = set(), 0
    with tarfile.open(fileobj=stream, mode='r|') as archive:
        for member in archive:
            name = member.name.rstrip('/')
            path = PurePosixPath(name)
            require(name and not path.is_absolute() and '..' not in path.parts and
                    '\\' not in name and '\x00' not in name, 'unsafe archive path')
            require(name not in seen, 'duplicate archive entry')
            seen.add(name)
            require(len(seen) <= 10000, 'oversized archive')
            if excluded(name):
                if not member.isdir(): manifest['excluded'].append(name)
                continue
            require(member.isfile() or member.isdir(), 'archive link or special file rejected')
            target = destination / name
            require(target.resolve().is_relative_to(destination.resolve()), 'archive escaped export')
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            size += member.size
            require(0 <= member.size <= MAX_FILE and size <= MAX_EXPORT and len(seen) <= 10000,
                    'oversized archive')
            data = archive.extractfile(member).read(MAX_FILE + 1)
            require(len(data) == member.size, 'incomplete archive file')
            if name == 'nx.json':
                nx = json.loads(data)
                nx['tasksRunnerOptions'] = {'default': {'runner': 'nx/tasks-runners/default', 'options': {}}}
                def safe_keys(value):
                    if isinstance(value, dict):
                        require(not any(re.search(r'token|password|secret|credential|api.?key', k, re.I)
                                        for k in value), 'unhandled credential field in nx configuration')
                        for child in value.values(): safe_keys(child)
                    elif isinstance(value, list):
                        for child in value: safe_keys(child)
                safe_keys(nx)
                data = (json.dumps(nx, indent=2) + '\n').encode()
                manifest['rewritten'].append(name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
            manifest['files_sha256'][name] = hashlib.sha256(data).hexdigest()
    manifest['excluded'].sort()
    manifest['material_sha256'] = core.digest(manifest['files_sha256'])
    return manifest


def commands():
    return {
        'install': [['node', '/trusted/checks.cjs', 'install']],
        'build': [['node', '/trusted/checks.cjs', 'build']],
        'lint': [['node', '/trusted/checks.cjs', 'lint']],
        'regression': [['node', '/deps/node_modules/jest/bin/jest.js', '--config', p + '/jest.config.ts',
                        '--runInBand', '--coverage', '--coverageReporters=json-summary',
                        '--coverageDirectory=/result/coverage', '--json', '--outputFile=/result/jest.json',
                        '--cacheDirectory=/tmp/jest-cache', '--passWithNoTests=false'] for p in ROOTS],
        'typecheck': [['node', '/deps/node_modules/typescript/bin/tsc', '-p', p, '--noEmit', '--incremental', 'false']
                      for p in ['apps/api2/tsconfig.app.json', *[root + '/' + cfg for root in ROOTS
                                for cfg in ('tsconfig.lib.json', 'tsconfig.spec.json')]]],
        'format': [['node', '/deps/node_modules/prettier/bin-prettier.js', '--check',
                    *[p + '/src/**/*.ts' for p in ROOTS]]],
    }


def container_command(root, phase, command, result=None, name=None):
    require(phase in commands(), 'unknown calibration phase')
    trusted = Path(__file__).resolve().parent
    args = ['docker', 'run', '--rm', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--pids-limit=512', '--memory=6g', '--cpus=2', '--read-only', '--tmpfs', '/tmp:rw,size=2g',
            '--network=' + ('bridge' if phase == 'install' else 'none')]
    if name:
        require(re.fullmatch(r'tele-cal-[a-f0-9]{12}-[a-z]+-[0-9]+', name), 'invalid private container name')
        args += ['--name', name]
    if phase == 'install':
        for part in ('package.json', 'package-lock.json', 'tools/packages'):
            args += ['-v', str(root / 'candidate' / part) + ':/work/' + part + ':ro']
    else:
        args += ['-v', str(root / 'candidate') + ':/work:ro']
    args += ['-v', str(trusted) + ':/trusted:ro',
             '-v', str(root / 'dependencies') + ':/deps:' + ('rw' if phase == 'install' else 'ro'),
             '-v', str(result or root / 'result') + ':/result:rw',
             '-v', str(root / 'dist') + ':/work/dist:rw',
             '-v', str(root / 'angular-cache') + ':/work/.angular:rw',
             '-v', str(root / 'coverage') + ':/work/coverage:rw',
             '-w', '/work', '-e', 'NX_DAEMON=false', '-e', 'NX_NO_CLOUD=true',
             '-e', 'NX_SKIP_REMOTE_CACHE=true', '-e', 'NX_CACHE_DIRECTORY=/tmp/nx-cache',
             '-e', 'NX_WORKSPACE_DATA_DIRECTORY=/tmp/nx-workspace',
             '-e', 'NX_PROJECT_GRAPH_CACHE_DIRECTORY=/tmp/nx-project-graph',
             '-e', 'NODE_OPTIONS=--max-old-space-size=4096', IMAGE, *command]
    return args


def summarize_tests(result, coverage):
    names = ('numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests')
    valid = all(type(result.get(k)) is int and result[k] >= 0 for k in names)
    percentages = {key: coverage.get('total', {}).get(key, {}).get('pct') for key in MINIMUMS}
    coverage_ok = all(type(value) in (int, float) and math.isfinite(value) and MINIMUMS[key] <= value <= 100
                      for key, value in percentages.items())
    percentages = {key: value if type(value) in (int, float) and math.isfinite(value) else None
                   for key, value in percentages.items()}
    return {'qualified': bool(valid and result.get('success') is True and result['numPassedTests'] > 0 and
                              all(result[k] == 0 for k in names[1:]) and coverage_ok),
            'passed': result.get('numPassedTests'), 'failed': result.get('numFailedTests'),
            'skipped': result.get('numPendingTests'), 'todo': result.get('numTodoTests'),
            'coverage': percentages, 'coverage_qualified': coverage_ok}


def read_test_output(directory):
    for path in (directory / 'jest.json', directory / 'coverage/coverage-summary.json'):
        core.require_regular_result(path, directory)
    return summarize_tests(core.read(directory / 'jest.json'), core.read(directory / 'coverage/coverage-summary.json'))


def run_container(root, phase, command, directory, log, name, timeout):
    args = container_command(root, phase, command, directory, name)
    try:
        return core.run_logged(args, log, timeout=timeout)
    finally:
        # Only the generated private container, also on KeyboardInterrupt.
        subprocess.run(['docker', 'rm', '--force', name], capture_output=True, timeout=10)


def run(source, output):
    require(not output.resolve().is_relative_to(source.resolve()), 'output must be outside read-only source')
    require(not output.exists(), 'output must be a new directory')
    output = output.resolve(); output.mkdir(parents=True); output.chmod(0o700)
    receipt = {'kind': 'tele-sanitized-calibration-only', 'contract': None, 'operational_pilot': False,
               'merge_eligible': False, 'paid_ai_started': False, 'github_dispatch_performed': False,
               'repository': REPO, 'source_sha': SHA, 'profile': 'tele-files-v1',
               'image': IMAGE, 'result': 'blocked', 'phases': {}, 'tests': {}, 'coverage_minimums': MINIMUMS}
    archive_process = None
    try:
        probe = subprocess.run(['docker', 'info', '--format', '{{.OSType}} {{.Architecture}}'],
                               capture_output=True, text=True, timeout=5)
        require(probe.returncode == 0 and probe.stdout.startswith('linux '), 'Docker Linux engine unavailable')
        receipt['engine'] = probe.stdout.strip()
        require(subprocess.check_output(['git', '-C', str(source), 'rev-parse', SHA + '^{commit}'], text=True).strip() == SHA,
                'fixed calibration commit unavailable')
        archive_process = subprocess.Popen(['git', '-C', str(source), 'archive', '--format=tar', SHA],
                                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        manifest = export_archive(archive_process.stdout, output / 'candidate')
        require(archive_process.wait(timeout=30) == 0, 'source archive failed')
        require('nx.json' in manifest['rewritten'], 'missing local Nx overlay')
        receipt['export'] = {k: v for k, v in manifest.items() if k != 'files_sha256'}
        receipt['export']['file_count'] = len(manifest['files_sha256'])
        core.write(output / 'source-manifest.json', manifest)
        receipt['source_manifest_sha256'] = hashlib.sha256((output / 'source-manifest.json').read_bytes()).hexdigest()
        receipt['helper_files_sha256'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                         for p in (Path(__file__), Path(__file__).with_name('checks.cjs'), Path(core.__file__))}
        candidate = output / 'candidate'
        for name in ('node_modules', 'dist', '.angular', 'coverage'):
            require(not (candidate / name).exists() and not (candidate / name).is_symlink(), 'output mount hides source')
        (candidate / 'node_modules').symlink_to('/deps/node_modules')
        for name in ('dependencies', 'dist', 'angular-cache', 'coverage'): (output / name).mkdir()
        for name in ('dist', '.angular', 'coverage'): (candidate / name).mkdir()
        session = uuid.uuid4().hex[:12]; deadline = time.monotonic() + 1200
        failed = False
        for phase, command_list in commands().items():
            records = []
            for index, command in enumerate(command_list):
                require(time.monotonic() < deadline, 'calibration time budget exhausted')
                directory = output / 'results' / f'{phase}-{index}'; directory.mkdir(parents=True)
                log = output / f'{phase}-{index}.log'
                name = f'tele-cal-{session}-{phase}-{index}'
                try:
                    record = run_container(output, phase, command, directory, log, name,
                                             timeout=min(600 if phase == 'install' else 300, deadline - time.monotonic()))
                except Exception:
                    record = {'status': 'blocked', 'exit_code': None, 'reason': 'command timeout or output bound exceeded'}
                    if log.exists(): record['log_sha256'] = hashlib.sha256(log.read_bytes()).hexdigest()
                record['argv'] = command
                if phase == 'regression':
                    try:
                        summary = read_test_output(directory)
                        receipt['tests'][ROOTS[index]] = summary
                        if not summary['qualified']: record['status'] = 'failed'
                    except Exception:
                        record['status'] = 'failed'; record['reason'] = 'missing or invalid fresh Jest results'
                if phase == 'build' and record.get('exit_code') == 0:
                    built = output / 'dist/apps/api2/main.js'
                    try:
                        core.require_regular_result(built, output / 'dist')
                        require(built.stat().st_size > 0, 'empty API bundle')
                        record['bundle_sha256'] = hashlib.sha256(built.read_bytes()).hexdigest()
                    except Exception:
                        record['status'] = 'failed'; record['reason'] = 'API bundle missing or invalid'
                records.append(record)
                failed = failed or record['status'] != 'passed'
            receipt['phases'][phase] = records
            if phase == 'install': require(not failed, 'locked dependency installation failed; checks not started')
        receipt['result'] = 'failed' if failed else 'passed'
    except Exception as error:
        receipt['reason'] = str(error) if isinstance(error, Blocked) else type(error).__name__
    finally:
        if archive_process is not None and archive_process.poll() is None:
            archive_process.kill(); archive_process.wait()
        receipt['completed_at'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        core.write(output / 'calibration.json', receipt)
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = run(args.source, args.output)
        print(json.dumps({'result': result['result'], 'receipt': str((args.output / 'calibration.json').resolve())}))
        sys.exit(0 if result['result'] == 'passed' else 2)
    except Exception as error:
        print('Tele calibration blocked: ' + (str(error) if isinstance(error, Blocked) else type(error).__name__), file=sys.stderr)
        sys.exit(2)
