"""Exercise the fixture without starting a chain or moving any funds."""
import ast
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock

source = Path(__file__).with_name('xbt-lnd-regtest-peer.py')
tree = ast.parse(source.read_text())
# Import only definitions; the server's top-level chain startup must not run.
tree.body = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef))]
ns = {}
exec(compile(tree, str(source), 'exec'), ns)


class Request:
    path = '/pay'
    def __init__(self):
        value = b'lnbcrt' + b'a' * 70
        self.headers = {'Content-Length': str(len(value))}
        self.rfile = io.BytesIO(value)
        self.wfile = io.BytesIO()
        self.status = None
    def send_error(self, code): self.status = code
    def send_response(self, code): self.status = code
    def end_headers(self): pass


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        ns['lightning'] = ['disposable-lncli']
        ns['time'] = Mock()
        self.commands = []

    def dispatch(self, route_responses):
        outcomes = iter(route_responses)
        def call(command, action, *args):
            self.commands.append(action)
            if action == 'decodepayreq':
                return json.dumps({'destination': '02' + 'a' * 64, 'num_satoshis': '2000'})
            if action == 'queryroutes':
                self.assertIn('--amt=2000', args)
                result = next(outcomes)
                if isinstance(result, Exception): raise result
                return json.dumps(result)
            if action == 'payinvoice':
                return '{"status":"IN_FLIGHT"}\n{"status":"SUCCEEDED"}'
            self.fail('Unexpected fixture command: ' + action)
        ns['call'] = call
        request = Request()
        ns['Fixture'].do_POST(request)
        return request

    def test_waits_for_route_then_submits_exactly_once(self):
        request = self.dispatch([subprocess.CalledProcessError(1, 'queryroutes'), {'routes': []}, {'routes': [{}]}])
        self.assertEqual(request.status, 200)
        self.assertEqual(request.wfile.getvalue(), b'settled')
        self.assertEqual(self.commands, ['decodepayreq', 'queryroutes', 'queryroutes', 'queryroutes', 'payinvoice'])

    def test_no_payment_if_readiness_times_out(self):
        request = self.dispatch([{'routes': []}] * 60)
        self.assertEqual(request.status, 500)
        self.assertNotIn('payinvoice', self.commands)

    def test_invalid_invoice_does_not_query_or_pay(self):
        ns['call'] = Mock(return_value=json.dumps({'destination': 'invalid', 'num_satoshis': '2000'}))
        request = Request()
        ns['Fixture'].do_POST(request)
        self.assertEqual(request.status, 500)
        self.assertEqual(ns['call'].call_count, 1)


class SpliceConfirmationTests(unittest.TestCase):
    def setUp(self):
        ns['lightning'] = ['disposable-lncli']
        ns['time'] = Mock()
        self.txid = 'a' * 64

    def response(self, depth, txid=None):
        return json.dumps({'channels': [{'pending_splice': {'txid': txid or self.txid, 'lock_depth': depth}}]})

    def test_large_peer_input_requires_its_full_144_confirmations(self):
        ns['call'] = Mock(return_value=self.response(144))
        self.assertEqual(ns['splice_confirmation_depth'](self.txid, 8), 146)

    def test_never_reduces_the_initiators_requirement(self):
        ns['call'] = Mock(return_value=self.response(6))
        self.assertEqual(ns['splice_confirmation_depth'](self.txid, 40), 40)

    def test_missing_or_previous_attempt_is_not_authoritative(self):
        ns['call'] = Mock(return_value=self.response(144, 'b' * 64))
        with self.assertRaises(ValueError): ns['splice_confirmation_depth'](self.txid, 8)
        self.assertEqual(ns['call'].call_count, 60)

    def test_invalid_peer_depth_fails_closed(self):
        for depth in [0, -1, 145]:
            ns['call'] = Mock(return_value=self.response(depth))
            with self.assertRaises(ValueError): ns['splice_confirmation_depth'](self.txid, 8)


if __name__ == '__main__': unittest.main()
