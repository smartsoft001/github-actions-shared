#!/usr/bin/env python3
"""Local fixed-history, checks-only calibration. Cannot emit an operational manual receipt."""
import argparse
import hashlib
import json
import subprocess
import sys
import uuid
from pathlib import Path

import manual

HEAD = 'e65cbf9f4dde571b5b05ddde833450551ada5490'
BASE = '8a8a801dbf5cb4deeb3e43ff9ffa9bb35760934e'


def probe_engine():
    try:
        result = subprocess.run(['docker', 'info', '--format', '{{.OSType}} {{.Architecture}}'],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, text=True)
        if result.returncode != 0 or not result.stdout.startswith('linux '):
            return {'ready': False, 'reason': 'Docker Linux engine unavailable or access denied'}
        return {'ready': True, 'platform': result.stdout.strip()}
    except (OSError, subprocess.TimeoutExpired):
        return {'ready': False, 'reason': 'Docker engine missing or probe timed out after 5 seconds'}


def calibration_identity(paths):
    included = [p for p in paths if p.startswith(manual.mvno_profile.SOURCE_ROOTS) and p.endswith('.ts')]
    manual.mvno_profile.check_scope(included)
    return {'kind': 'calibration-only', 'contract': None, 'report_only': True, 'merge_eligible': False,
            'operational_pilot': False, 'paid_ai_started': False,
            'historical': {'repository': manual.REPO, 'closed_merged_pr': 83, 'head_sha': HEAD, 'base_sha': BASE},
            'all_changed_paths': paths, 'profile_source_paths': included,
            'outside_operational_profile': [p for p in paths if p not in included]}


def run(source, output):
    manual.require(not output.resolve().is_relative_to(source.resolve()), 'calibration output must be outside the read-only source')
    manual.require(not output.exists(), 'calibration output must be a new directory')
    output.mkdir(parents=True)
    receipt = {'kind': 'calibration-only', 'contract': None, 'operational_pilot': False,
               'merge_eligible': False, 'paid_ai_started': False, 'result': 'blocked', 'checks': None}
    try:
        engine = probe_engine(); receipt['engine'] = engine
        manual.require(engine['ready'], engine.get('reason', 'engine unavailable'))
        manual.require(source.is_dir(), 'source checkout missing')
        paths = subprocess.check_output(['git', '-C', str(source), 'diff', '--name-only', '-z', BASE, HEAD], text=True).split('\0')
        paths = list(filter(None, paths)); receipt.update(calibration_identity(paths))
        candidate = output / 'candidate'
        subprocess.run(['git', 'clone', '--no-hardlinks', '--no-checkout', str(source.resolve()), str(candidate)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        subprocess.run(['git', '-C', str(candidate), 'checkout', '--detach', HEAD], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        manual.require(subprocess.check_output(['git', '-C', str(candidate), 'rev-parse', 'HEAD'], text=True).strip() == HEAD, 'calibration checkout mismatch')
        tracked = subprocess.check_output(['git', '-C', str(candidate), 'ls-files', '-z'], text=True).split('\0')
        for name in ('node_modules', 'dist', '.angular', 'coverage'):
            manual.require(not any(p == name or p.startswith(name + '/') for p in tracked), 'output mount hides historical source')
            manual.require(not (candidate / name).exists() and not (candidate / name).is_symlink(), 'historical output path is not fresh')
        (candidate / 'node_modules').symlink_to('/deps/node_modules')
        for name in ('dependencies', 'dist', 'angular-cache', 'coverage'): (output / name).mkdir()
        for name in ('dist', '.angular', 'coverage'): (candidate / name).mkdir()
        subject = {'head_sha': HEAD, 'base_sha': BASE, 'paths': receipt['profile_source_paths'],
                   'producer': {'run_id': 'local-calibration-' + str(uuid.uuid4()), 'run_attempt': '1'}}
        manual.core.write(output / 'subject.json', subject)
        receipt['helper_files_sha256'] = {str(p.relative_to(Path(__file__).resolve().parents[1])): hashlib.sha256(p.read_bytes()).hexdigest()
                                         for p in [Path(__file__).resolve(), Path(manual.__file__), Path(manual.core.__file__),
                                                   Path(manual.mvno_profile.__file__), Path(manual.core.__file__).with_name('checks.cjs')]}
        receipt['checks'] = manual.core.execute_checks(candidate, output, subject)
        receipt['result'] = 'passed'
    except Exception as error:
        receipt['reason'] = str(error)
    receipt['completed_at'] = manual.utc_now()
    manual.core.write(output / 'calibration.json', receipt)
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Existing local MVNO clone; read-only input')
    parser.add_argument('--output', type=Path, required=True, help='New isolated directory; never an existing checkout')
    args = parser.parse_args()
    try:
        result = run(args.source, args.output)
        print(json.dumps({'kind': result['kind'], 'result': result['result'], 'receipt': str((args.output / 'calibration.json').resolve())}))
        sys.exit(0 if result['result'] == 'passed' else 2)
    except Exception as error:
        print('Calibration blocked: ' + str(error), file=sys.stderr); sys.exit(2)
