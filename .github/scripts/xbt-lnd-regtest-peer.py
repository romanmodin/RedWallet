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

class Fixture(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= length <= 8192:
                raise ValueError()
            value = self.rfile.read(length).decode("ascii")
            if self.path == "/peer":
                result = json.loads(call(lightning, "getinfo"))["identity_pubkey"]
            elif self.path == "/fund" and re.fullmatch(r"bcrt1[a-z0-9]{20,90}", value):
                result = call(chain, "sendtoaddress", value, "0.005")
                call(chain, "generatetoaddress", "6", miner)
            elif self.path == "/confirm" and re.fullmatch(r"[a-f0-9]{64}:[0-9]+", value):
                for _ in range(30):
                    if value.split(":")[0] in json.loads(call(chain, "getrawmempool")):
                        break
                    time.sleep(1)
                else:
                    raise ValueError("channel funding transaction missing")
                call(chain, "generatetoaddress", "8", miner)
                result = "mined"
            elif self.path == "/invoice":
                result = json.loads(call(lightning, "addinvoice", "--amt=20000"))["payment_request"]
            elif self.path == "/pay" and re.fullmatch(r"lnbcrt[a-z0-9]{60,4096}", value):
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
        except (ValueError, KeyError, UnicodeError, subprocess.SubprocessError) as error:
            # Include the fixture step, never the invoice, macaroon or seed.
            print("Fixture failed:", self.path, type(error).__name__, flush=True)
            self.send_error(500)

HTTPServer(("127.0.0.1", 18149), Fixture).serve_forever()
