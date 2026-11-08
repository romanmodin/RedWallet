"""Loopback-only test peer for the iOS simulator. All keys and coins are disposable."""
import json
import re
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

root = Path(sys.argv[1])
chain = [str(root / "tools/bin/bitcoin-cli"), "-regtest", "-datadir=" + str(root / "data")]
lightning = [str(root / "ln-bin/lncli"), "--network=regtest", "--rpcserver=127.0.0.1:11009", "--lnddir=" + str(root / "ln-peer")]

def call(command, *args):
    result = subprocess.run([*command, *args], check=True, capture_output=True, text=True, timeout=90)
    return result.stdout.strip()

miner = call(chain, "getnewaddress")
# Knots' XBT wallet defaults to legacy addresses even after activation.
# The current iPhone withdrawal UI supports native SegWit/Taproot destinations.
withdrawal_target = call(chain, "getnewaddress", "withdrawal-fixture", "bech32")
assert withdrawal_target.startswith("bcrt1q"), "Expected native SegWit fixture destination"

def wait_for_peer_sync():
    expected_height = int(call(chain, "getblockcount"))
    for _ in range(90):
        info = json.loads(call(lightning, "getinfo"))
        if info.get("synced_to_chain") and info.get("block_height", 0) >= expected_height:
            return
        time.sleep(1)
    raise ValueError("routing peer has not synced to the funded chain")


def wait_for_payment_route(invoice):
    # The first payment may settle before the peer's router sees its new
    # outbound balance. Query readiness; never retry a submitted payment.
    decoded = json.loads(call(lightning, "decodepayreq", invoice))
    destination = decoded["destination"]
    amount = int(decoded["num_satoshis"])
    if not re.fullmatch(r"0[23][a-f0-9]{64}", destination) or not 1 <= amount <= 2_100_000_000_000_000:
        raise ValueError("invalid fixture invoice")
    for _ in range(60):
        try:
            routes = json.loads(call(lightning, "queryroutes", "--dest=" + destination,
                                     "--amt=" + str(amount), "--fee_limit=10"))
            if routes.get("routes"):
                return
        except subprocess.CalledProcessError:
            pass
        time.sleep(1)
    raise ValueError("return-payment route did not become ready")


class Fixture(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= length <= 8192:
                raise ValueError()
            value = self.rfile.read(length).decode("ascii")
            if self.path == "/height":
                result = call(chain, "getblockcount")
            elif self.path == "/peer":
                result = json.loads(call(lightning, "getinfo"))["identity_pubkey"]
            elif self.path == "/tower":
                result = json.loads(call(lightning, "tower", "info"))["pubkey"] + "@127.0.0.1:19911"
            elif self.path in ("/fund", "/fund-large") and re.fullmatch(r"bcrt1[a-z0-9]{20,90}", value):
                result = call(chain, "sendtoaddress", value, "2" if self.path == "/fund-large" else "0.005")
                call(chain, "generatetoaddress", "6", miner)
                wait_for_peer_sync()
            elif self.path == "/confirm" and re.fullmatch(r"[a-f0-9]{64}:[0-9]+", value):
                for _ in range(30):
                    if value.split(":")[0] in json.loads(call(chain, "getrawmempool")):
                        break
                    time.sleep(1)
                else:
                    raise ValueError("channel funding transaction missing")
                call(chain, "generatetoaddress", "8", miner)
                result = "mined"
            elif self.path == "/mempool":
                result = json.dumps(sorted(json.loads(call(chain, "getrawmempool"))))
            elif self.path == "/confirm-splice" and re.fullmatch(r"[a-f0-9]{64}:[0-9]+", value):
                txid, depth = value.split(":")
                assert 1 <= int(depth) <= 146
                for _ in range(60):
                    if txid in json.loads(call(chain, "getrawmempool")):
                        break
                    time.sleep(1)
                else:
                    raise ValueError("splice transaction missing")
                call(chain, "generatetoaddress", depth, miner)
                result = "mined-splice"
            elif self.path == "/withdraw-address":
                result = withdrawal_target
            elif self.path in ("/verify-withdraw", "/verify-withdraw-large") and re.fullmatch(r"[a-f0-9]{64}", value):
                for _ in range(30):
                    if value in json.loads(call(chain, "getrawmempool")):
                        break
                    time.sleep(1)
                else:
                    raise ValueError("withdrawal transaction missing")
                call(chain, "generatetoaddress", "6", miner)
                tx = json.loads(call(chain, "gettransaction", value))
                assert any(d.get("category") == "receive" and d.get("address") == withdrawal_target and
                           abs(d.get("amount", 0) - (0.02 if self.path == "/verify-withdraw-large" else 0.00001)) < 0.000000001 for d in tx["details"])
                result = "received-2000000" if self.path == "/verify-withdraw-large" else "received-1000"
            elif self.path in ("/invoice", "/invoice-large"):
                result = json.loads(call(lightning, "addinvoice", "--amt=2000000" if self.path == "/invoice-large" else "--amt=20000"))["payment_request"]
            elif self.path == "/pay" and re.fullmatch(r"lnbcrt[a-z0-9]{60,4096}", value):
                wait_for_payment_route(value)
                response = call(lightning, "payinvoice", "--force", "--json", "--fee_limit=10", value)
                # lncli can print more than one JSON update. Find the terminal status.
                decoder = json.JSONDecoder()
                status = ""
                while response.strip():
                    msg, offset = decoder.raw_decode(response.lstrip())
                    response = response.lstrip()[offset:]
                    status = msg.get("status", "")
                if status != "SUCCEEDED":
                    raise ValueError("peer payment did not settle")
                result = "settled"
            else:
                self.send_error(400)
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(result.encode("ascii"))
        except (ValueError, KeyError, UnicodeError, AssertionError, subprocess.SubprocessError) as error:
            # Include the fixture step, never the invoice, macaroon or seed.
            print("Fixture failed:", self.path, type(error).__name__, flush=True)
            self.send_error(500)

HTTPServer(("127.0.0.1", 18149), Fixture).serve_forever()
