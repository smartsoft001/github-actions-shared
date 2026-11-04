"""Closed MVNO Documents pilot. Broader changes need a reviewed profile revision."""
import math

SOURCE_ROOTS = ('libs/documents/shell/app-services/src/', 'libs/documents/shell/nestjs/src/')
TEST_CONFIGS = (
    'libs/documents/shell/app-services/jest.config.ts',
    'libs/documents/shell/nestjs/jest.config.ts',
    'libs/trans/domain/jest.config.ts',
    'libs/mnps/shell/app-services/jest.config.ts',
)
TYPE_CONFIGS = ('apps/api/tsconfig.app.json',
                'libs/documents/shell/app-services/tsconfig.lib.json',
                'libs/documents/shell/nestjs/tsconfig.lib.json')


def check_scope(paths):
    if not paths or any(not p.startswith(SOURCE_ROOTS) or not p.endswith('.ts') or
                        '..' in p.split('/') or '\x00' in p for p in paths):
        raise ValueError('outside mvno-v1 Documents source scope; supervised profile revision required')


def commands(paths):
    check_scope(paths)
    node = ['node']
    return {
        'install': [node + ['/trusted/checks.cjs', 'install']],
        'build': [node + ['/trusted/checks.cjs', 'build']],
        'lint': [node + ['/deps/node_modules/eslint/bin/eslint.js',
                        'libs/documents/shell/app-services/**/*.ts', 'libs/documents/shell/nestjs/**/*.ts']],
        'regression': [node + ['/deps/node_modules/jest/bin/jest.js', '--config', config,
                              '--runInBand', '--coverage', '--coverageReporters=json-summary',
                              '--coverageDirectory=/result/coverage', '--json', '--outputFile=/result/jest.json',
                              '--cacheDirectory=/tmp/jest-cache', '--passWithNoTests=false'] for config in TEST_CONFIGS],
        'typecheck': [node + ['/deps/node_modules/typescript/bin/tsc', '-p', config, '--noEmit', '--incremental', 'false'] for config in TYPE_CONFIGS],
        'format': [node + ['/deps/node_modules/prettier/bin-prettier.js', '--check', *paths]],
    }


def test_summary(result, coverage):
    keys = ('numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests')
    if any(type(result.get(k)) is not int for k in keys) or result['numPassedTests'] < 1 or \
            any(result[k] != 0 for k in keys[1:]) or result.get('success') is not True:
        raise ValueError('zero/skipped/failed/incomplete tests')
    percentages = {}
    for metric, minimum in {'statements': 80, 'branches': 75, 'functions': 80, 'lines': 80}.items():
        score = coverage.get('total', {}).get(metric, {}).get('pct')
        if type(score) not in (int, float) or not math.isfinite(score) or not minimum <= score <= 100:
            raise ValueError('missing or low coverage: ' + metric)
        percentages[metric] = score
    return {'tests': {'passed': result['numPassedTests'], 'failed': 0, 'skipped': 0}, 'coverage': percentages}
