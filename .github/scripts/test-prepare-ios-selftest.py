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

    def test_empty_timeout_output_still_retains_command_deadline_and_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            command = ['xcrun', 'simctl', 'list', 'devicetypes', '-j']
            error = subprocess.TimeoutExpired(command, 30)
            module.record_failure(error, 'a' * 40, Path(tmp))
            receipt = json.loads((Path(tmp) / 'selftest-provision-failure.json').read_text())
            self.assertEqual(receipt['sourceCommit'], 'a' * 40)
            self.assertEqual(receipt['command'], command)
            self.assertEqual(receipt['timeoutSeconds'], 30)
            self.assertEqual(receipt['output'], '')
            self.assertIn('timed out after 30 seconds',
                          (Path(tmp) / 'selftest-provision-failure.log').read_text())

    def test_failed_command_output_and_exit_code_are_retained(self):
        with tempfile.TemporaryDirectory() as tmp:
            error = subprocess.CalledProcessError(1, ['xcrun', 'simctl', 'boot', ID], output=b'boot failed')
            module.record_failure(error, 'a' * 40, Path(tmp))
            receipt = json.loads((Path(tmp) / 'selftest-provision-failure.json').read_text())
            self.assertEqual(receipt['returnCode'], 1)
            self.assertEqual(receipt['output'], 'boot failed')
            self.assertIsNone(receipt['timeoutSeconds'])

    def test_invalid_source_is_not_accepted(self):
        with self.assertRaisesRegex(ValueError, 'Invalid checked-out'):
            module.checked_out_source(Mock(return_value='HEAD'))

class ParkedPreparationTests(unittest.TestCase):
    scenario = PreparationTests.scenario

    def prepared(self):
        config, run = self.scenario()
        before = config.read_text()
        run.side_effect = list(run.side_effect) + ['', '', '']
        receipt = module.prepare(run, config, OLD, park=True)
        self.assertEqual(json.loads(config.read_text())['devices']['simulator']['device'], {'id': OLD})
        self.assertTrue(receipt['parked'])
        self.assertFalse(receipt['appLaunched'])
        self.assertEqual([c.args[0][2:] for c in run.call_args_list[-3:]], [
            ['shutdown', ID], ['boot', OLD], ['bootstatus', OLD, '-b']])
        receipt['sourceCommit'] = 'a' * 40
        replies = [json.dumps({'devices': {'com.apple.iOS-26-5': [
            {'udid': ID, 'state': 'Shutdown', 'deviceTypeIdentifier': 'phone17'}]}}),
            '', '', '', '/simulator/Applications/BlueWallet.app']
        return config, receipt, Mock(side_effect=replies)

    def test_cold_original_is_not_booted_before_pristine_simulator_is_prepared(self):
        config, run = self.scenario()
        replies = list(run.side_effect)
        devices = json.loads(replies[1])
        devices['devices']['com.apple.iOS-26-5'][0]['state'] = 'Shutdown'
        replies[1] = json.dumps(devices)
        del replies[2]  # A shutdown original does not need another shutdown.
        run.side_effect = replies + ['', '', '']
        receipt = module.prepare(run, config, OLD, park=True)
        calls = [c.args[0][2:] for c in run.call_args_list]
        self.assertEqual([c for c in calls if c[0] == 'boot'], [['boot', ID], ['boot', OLD]])
        self.assertNotIn(['shutdown', OLD], calls)
        self.assertLess(next(i for i, c in enumerate(calls) if c[0] == 'install'),
                        calls.index(['boot', OLD]))
        self.assertEqual(calls[-1], ['bootstatus', OLD, '-b'])
        self.assertEqual(json.loads(config.read_text())['devices']['simulator']['device'], {'id': OLD})
        self.assertTrue(receipt['parked'])
        self.assertFalse(receipt['appLaunched'])

    def test_incomplete_original_state_is_rejected_before_any_mutation(self):
        for state in ['Booting', 'Shutting Down', None]:
            config, run = self.scenario()
            replies = list(run.side_effect)
            devices = json.loads(replies[1])
            devices['devices']['com.apple.iOS-26-5'][0]['state'] = state
            replies[1] = json.dumps(devices)
            run.side_effect = replies
            with self.assertRaises(ValueError):
                module.prepare(run, config, OLD, park=True)
            self.assertEqual(run.call_count, 2)

    def test_inventory_timeout_never_boots_or_changes_config(self):
        config, run = self.scenario()
        before = config.read_text()
        run.side_effect = subprocess.TimeoutExpired(['xcrun', 'simctl', 'list', 'devicetypes', '-j'], 30)
        with self.assertRaises(subprocess.TimeoutExpired):
            module.prepare(run, config, OLD, park=True)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(config.read_text(), before)

    def test_park_pins_warm_original_and_cannot_select_parked_twin_by_type(self):
        config, run = self.scenario()
        run.side_effect = list(run.side_effect) + ['', '', '']
        receipt = module.prepare(run, config, OLD, park=True)
        self.assertEqual(json.loads(config.read_text())['devices']['simulator']['device'], {'id': OLD})
        self.assertNotEqual(OLD, receipt['deviceId'])

    def test_parked_simulator_activates_without_create_erase_reinstall_or_launch(self):
        config, receipt, run = self.prepared()
        result = module.activate(receipt, 'a' * 40, run, config)
        self.assertTrue(result['activated'])
        self.assertFalse(result['parked'])
        self.assertEqual(json.loads(config.read_text())['devices']['simulator']['device'], {'id': ID})
        self.assertEqual([c.args[0][2] for c in run.call_args_list],
                         ['list', 'shutdown', 'boot', 'bootstatus', 'get_app_container'])
        self.assertEqual(run.call_args_list[3].kwargs['timeout'], 300)

    def test_stale_source_or_unverified_park_never_mutates_simulator(self):
        for field, value in [('sourceCommit', 'b' * 40), ('parked', False),
                             ('appLaunched', True), ('deviceId', OLD), ('binaryPath', '/wrong.app')]:
            with self.subTest(field=field):
                config, receipt, run = self.prepared()
                receipt[field] = value
                with self.assertRaises(ValueError):
                    module.activate(receipt, 'a' * 40, run, config)
                run.assert_not_called()

    def test_changed_runtime_type_or_state_never_boots(self):
        for field, value in [('state', 'Booted'), ('deviceTypeIdentifier', 'other')]:
            config, receipt, run = self.prepared()
            replies = list(run.side_effect)
            devices = json.loads(replies[0])
            devices['devices']['com.apple.iOS-26-5'][0][field] = value
            replies[0] = json.dumps(devices)
            run.side_effect = replies
            with self.assertRaises(ValueError):
                module.activate(receipt, 'a' * 40, run, config)
            self.assertEqual(run.call_count, 1)

    def test_activation_boot_timeout_or_changed_container_never_publishes(self):
        for index, value in [(3, subprocess.TimeoutExpired('bootstatus', 300)), (4, '/wrong/BlueWallet.app')]:
            config, receipt, run = self.prepared()
            before = config.read_text()
            replies = list(run.side_effect)
            replies[index] = value
            run.side_effect = replies
            with self.assertRaises((ValueError, subprocess.TimeoutExpired)):
                module.activate(receipt, 'a' * 40, run, config)
            self.assertEqual(config.read_text(), before)
            self.assertEqual(run.call_count, index + 1)

    def test_changed_original_selection_stops_before_any_simulator_mutation(self):
        for device in [{'type': 'iPhone 17'}, {'id': ID}]:
            config, receipt, run = self.prepared()
            content = json.loads(config.read_text())
            content['devices']['simulator']['device'] = device
            config.write_text(json.dumps(content))
            with self.assertRaisesRegex(ValueError, 'Original simulator selection changed'):
                module.activate(receipt, 'a' * 40, run, config)
            run.assert_not_called()

    def test_failed_original_reboot_does_not_publish_selection(self):
        config, run = self.scenario()
        before = config.read_text()
        run.side_effect = list(run.side_effect) + ['', '', subprocess.TimeoutExpired('bootstatus', 300)]
        with self.assertRaises(subprocess.TimeoutExpired):
            module.prepare(run, config, OLD, park=True)
        self.assertEqual(config.read_text(), before)

    def test_parking_failure_never_selects_replacement(self):
        config, run = self.scenario()
        before = config.read_text()
        run.side_effect = list(run.side_effect) + [subprocess.TimeoutExpired('shutdown', 30)]
        with self.assertRaises(subprocess.TimeoutExpired):
            module.prepare(run, config, OLD, park=True)
        self.assertEqual(config.read_text(), before)

class CommandTraceTests(unittest.TestCase):
    def test_success_output_and_deadline_are_retained(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            trace = Path(tmp) / 'trace.jsonl'
            with patch.dict(module.os.environ, {'REDWALLET_SIMULATOR_TRACE': str(trace)}):
                run = Mock(return_value='Boot finished\n')
                self.assertEqual(module.traced_command(run, ['xcrun', 'simctl', 'bootstatus', ID, '-b'], 300), 'Boot finished')
            row = json.loads(trace.read_text())
            self.assertEqual(row['output'], 'Boot finished\n')
            self.assertEqual(row['timeoutSeconds'], 300)
            self.assertEqual(row['status'], 'success')
            run.assert_called_once()

    def test_timeout_preserves_partial_output_and_original_error_without_retry(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            trace = Path(tmp) / 'trace.jsonl'
            error = subprocess.TimeoutExpired(['container'], 30, output=b'partial')
            run = Mock(side_effect=error)
            with patch.dict(module.os.environ, {'REDWALLET_SIMULATOR_TRACE': str(trace)}):
                with self.assertRaises(subprocess.TimeoutExpired) as caught:
                    module.traced_command(run, ['container'], 30)
            self.assertIs(caught.exception, error)
            self.assertEqual(json.loads(trace.read_text())['output'], 'partial')
            run.assert_called_once()

if __name__ == '__main__':
    unittest.main()
