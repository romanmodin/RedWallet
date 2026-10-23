import importlib.util
import json
import plistlib
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
        binary = Path(tmp.name) / 'BlueWallet.app'
        binary.mkdir()
        (binary / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'com.romanmodin.redwallet'}))
        config.write_text(json.dumps({
            'apps': {'ios.release': {'binaryPath': 'BlueWallet.app'}},
            'devices': {'simulator': {'device': {'type': 'iPhone 17'}}},
        }))
        replies = [json.dumps({'devicetypes': [{'name': 'iPhone 17', 'identifier': 'phone17'}]}),
                   json.dumps({'devices': {'com.apple.iOS-26-5': [{'udid': OLD, 'state': 'Booted', 'deviceTypeIdentifier': 'phone17'}]}}), '', ID, '', failure or '', '', '/simulator/Applications/BlueWallet.app']
        return config, Mock(side_effect=replies)

    def test_exact_fresh_device_selected_only_after_boot_ready(self):
        config, run = self.scenario()
        receipt = module.prepare(run, config, OLD)
        self.assertEqual(receipt['deviceId'], ID)
        self.assertTrue(receipt['appInstalled'])
        self.assertFalse(receipt['appLaunched'])
        self.assertEqual(receipt['bundleId'], 'com.romanmodin.redwallet')
        self.assertEqual(json.loads(config.read_text())['devices']['simulator']['device'], {'id': ID})
        self.assertEqual(run.call_args_list[5].args[0], ['xcrun', 'simctl', 'bootstatus', ID, '-b'])
        self.assertEqual(run.call_args_list[5].kwargs['timeout'], 300)
        self.assertEqual(run.call_count, 8)
        self.assertEqual(run.call_args_list[6].args[0], [
            'xcrun', 'simctl', 'install', ID, str(config.parent / 'BlueWallet.app')])
        self.assertEqual(run.call_args_list[6].kwargs['timeout'], 120)
        self.assertEqual(run.call_args_list[7].args[0], [
            'xcrun', 'simctl', 'get_app_container', ID, 'com.romanmodin.redwallet', 'app'])
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


    def test_failed_install_never_publishes_device_or_retries(self):
        for error in [subprocess.TimeoutExpired('install', 120),
                      subprocess.CalledProcessError(1, 'install')]:
            with self.subTest(error=type(error).__name__):
                config, run = self.scenario()
                replies = list(run.side_effect)
                replies[6] = error
                run.side_effect = replies
                before = config.read_text()
                with self.assertRaises(type(error)):
                    module.prepare(run, config, OLD)
                self.assertEqual(config.read_text(), before)
                self.assertEqual(run.call_count, 7)

    def test_unverified_install_never_publishes_device(self):
        for container in ['', 'relative/BlueWallet.app', '/simulator/Other.app']:
            with self.subTest(container=container):
                config, run = self.scenario()
                replies = list(run.side_effect)
                replies[7] = container
                run.side_effect = replies
                before = config.read_text()
                with self.assertRaisesRegex(ValueError, 'installation could not be verified'):
                    module.prepare(run, config, OLD)
                self.assertEqual(config.read_text(), before)
                self.assertEqual(run.call_count, 8)

    def test_wrong_bundle_fails_before_any_simulator_command(self):
        config, run = self.scenario()
        (config.parent / 'BlueWallet.app/Info.plist').write_bytes(
            plistlib.dumps({'CFBundleIdentifier': 'other.app'}))
        with self.assertRaisesRegex(ValueError, 'Unexpected self-test app bundle'):
            module.prepare(run, config, OLD)
        run.assert_not_called()

    def test_receipt_uses_checked_out_head(self):
        head = 'dc86a9e6bb34bea62f17c06711b4f305885d502a'
        run = Mock(return_value=head + '\n')
        self.assertEqual(module.checked_out_source(run), head)
        run.assert_called_once_with(['git', 'rev-parse', 'HEAD'], text=True, timeout=30)

    def test_invalid_source_is_not_accepted(self):
        with self.assertRaisesRegex(ValueError, 'Invalid checked-out'):
            module.checked_out_source(Mock(return_value='HEAD'))

if __name__ == '__main__':
    unittest.main()
