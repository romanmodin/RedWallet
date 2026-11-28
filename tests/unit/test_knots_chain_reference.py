"""Exercise the optional independent reference using synthetic RPC responses."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

script = Path(__file__).resolve().parents[2] / 'scripts' / 'knots-chain-reference.py'
spec = importlib.util.spec_from_file_location('chain_reference', script)
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)


class ExactTipTests(unittest.TestCase):
    def setUp(self):
        self.now = 1800000000
        self.snapshot = dict(chain='main', blocks=980000, headers=980000,
                             bestblockhash='a' * 64, initialblockdownload=False, time=self.now)
        self.checkpoint = reference.FORK_HASH
        self.calls = []
        self.enterContext(patch.object(reference.time, 'time', return_value=self.now))
        self.enterContext(patch.object(reference, 'rpc', side_effect=self.read))

    def read(self, method, *args):
        self.calls.append((method, args))
        if method == 'getblockhash' and args == (reference.FORK,):
            return self.checkpoint
        if method == 'getblockchaininfo' and not args:
            return json.dumps(self.snapshot)
        self.fail(f'Unexpected RPC: {method}')

    def test_same_height_replacement_is_visible_on_next_read(self):
        for block_hash in ['a' * 64, 'b' * 64]:
            self.snapshot['bestblockhash'] = block_hash
            self.assertEqual(reference.current_tip(), {'height': 980000, 'hash': block_hash})
        self.assertEqual(self.calls, [('getblockhash', (reference.FORK,)), ('getblockchaininfo', ())] * 2)

    def test_wrong_fork_is_rejected_before_tip_read(self):
        self.checkpoint = 'f' * 64
        with self.assertRaises(ValueError):
            reference.current_tip()
        self.assertEqual(len(self.calls), 1)

    def test_unsynced_wrong_network_stale_and_malformed_snapshots_are_rejected(self):
        for key, value in [('blocks', 1), ('headers', 980001), ('headers', 980000.0),
                           ('initialblockdownload', True), ('chain', 'regtest'),
                           ('time', self.now - 10801), ('time', self.now + 7201),
                           ('bestblockhash', 'zz'), ('bestblockhash', None)]:
            with self.subTest(key=key, value=value), patch.dict(self.snapshot, {key: value}):
                with self.assertRaises(ValueError):
                    reference.current_tip()


if __name__ == '__main__':
    unittest.main()
