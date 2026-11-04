import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import subprocess

import calibration


class CalibrationTests(unittest.TestCase):
    def test_history_outside_scope_is_named_without_becoming_an_operational_pilot(self):
        paths = ['libs/documents/shell/nestjs/src/example.ts', 'package.json', '.eslintrc.json']
        result = calibration.calibration_identity(paths)
        self.assertFalse(result['operational_pilot']); self.assertFalse(result['merge_eligible'])
        self.assertIsNone(result['contract']); self.assertEqual(result['outside_operational_profile'], paths[1:])

    def test_unavailable_engine_writes_blocked_receipt_without_claimed_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'new'
            with patch.object(calibration, 'probe_engine', return_value={'ready': False, 'reason': 'fixture engine timeout'}), \
                    patch.object(calibration.subprocess, 'check_output', side_effect=AssertionError('source must not execute')):
                result = calibration.run(Path('/nonexistent-source'), output)
            self.assertEqual(result['result'], 'blocked'); self.assertIsNone(result['checks'])
            self.assertFalse(result['paid_ai_started']); self.assertTrue((output / 'calibration.json').is_file())

    def test_probe_is_bounded_and_never_restarts_or_installs_engine(self):
        with patch.object(calibration.subprocess, 'run', side_effect=subprocess.TimeoutExpired('docker info', 5)) as execute:
            self.assertFalse(calibration.probe_engine()['ready'])
        self.assertEqual(execute.call_args.args[0][:2], ['docker', 'info'])
        self.assertEqual(execute.call_args.kwargs['timeout'], 5)

    def test_existing_output_cannot_reuse_a_previous_calibration(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError): calibration.run(Path('/source'), Path(directory))

    def test_output_inside_source_is_rejected_before_writing_even_through_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source'; source.mkdir()
            alias = Path(directory) / 'alias'; alias.symlink_to(source, target_is_directory=True)
            for output in (source / 'new', alias / 'new'):
                with self.subTest(output=output), self.assertRaises(ValueError), \
                        patch.object(calibration, 'probe_engine', side_effect=AssertionError('must reject before engine probe')):
                    calibration.run(source, output)
                self.assertFalse(output.exists())


if __name__ == '__main__': unittest.main()
