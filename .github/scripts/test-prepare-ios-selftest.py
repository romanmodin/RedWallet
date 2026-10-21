import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare-ios-selftest.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ID = '11111111-2222-3333-4444-555555555555'
OLD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

class PreparationTests(unittest.TestCase):
    def scenario(self, failure=None):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        config = Path(tmp.name) / 'detox.json'
        config.write_text(json.dumps({'devices': {'simulator': {'device': {'type': 'iPhone 17'}}}}))
        replies = [json.dumps({'devicetypes': [{'name': 'iPhone 17', 'identifier': 'phone17'}]}),
                   json.dumps({'devices': {'com.apple.iOS-26-5': [{'udid': OLD, 'state': 'Booted', 'deviceTypeIdentifier': 'phone17'}]}}), '', ID, '', failure or '']
        return config, Mock(side_effect=replies)

    def test_exact_fresh_device_selected_only_after_boot_ready(self):
        config, run = self.scenario()
        self.assertEqual(module.prepare(run, config, OLD), ID)
        self.assertEqual(json.loads(config.read_text())['devices']['simulator']['device'], {'id': ID})
        self.assertEqual(run.call_args_list[-1].args[0], ['xcrun', 'simctl', 'bootstatus', ID, '-b'])
        self.assertEqual(run.call_args_list[-1].kwargs['timeout'], 300)
        self.assertEqual(run.call_count, 6)
        self.assertEqual(run.call_args_list[2].args[0], ['xcrun', 'simctl', 'shutdown', OLD])
        self.assertEqual(run.call_args_list[3].args[0][-1], 'com.apple.iOS-26-5')

    def test_failed_boot_does_not_publish_device_config_or_retry(self):
        config, run = self.scenario(subprocess.TimeoutExpired('bootstatus', 300))
        before = config.read_text()
        with self.assertRaises(subprocess.TimeoutExpired):
            module.prepare(run, config, OLD)
        self.assertEqual(config.read_text(), before)
        self.assertEqual(run.call_count, 6)

    def test_invalid_created_id_never_boots_or_changes_config(self):
        config, run = self.scenario()
        replies = list(run.side_effect)
        replies[3] = 'booted'
        run.side_effect = replies
        before = config.read_text()
        with self.assertRaises(ValueError):
            module.prepare(run, config, OLD)
        self.assertEqual(run.call_count, 4)
        self.assertEqual(config.read_text(), before)

    def test_shutdown_failure_never_creates_or_boots_replacement(self):
        config, run = self.scenario()
        replies = list(run.side_effect)
        replies[2] = subprocess.TimeoutExpired('shutdown', 30)
        run.side_effect = replies
        before = config.read_text()
        with self.assertRaises(subprocess.TimeoutExpired):
            module.prepare(run, config, OLD)
        self.assertEqual(run.call_count, 3)
        self.assertEqual(config.read_text(), before)

    def test_wrong_prototype_type_is_rejected_before_shutdown(self):
        config, run = self.scenario()
        replies = list(run.side_effect)
        replies[1] = json.dumps({'devices': {'com.apple.iOS-26-5': [
            {'udid': OLD, 'state': 'Booted', 'deviceTypeIdentifier': 'different'}]}})
        run.side_effect = replies
        with self.assertRaises(ValueError):
            module.prepare(run, config, OLD)
        self.assertEqual(run.call_count, 2)

if __name__ == '__main__':
    unittest.main()
