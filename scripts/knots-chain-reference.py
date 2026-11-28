"""Read-only XBT height/header reference. No wallet RPC or secret responses."""
import json
import re
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

NODE = 'paulscode-knots-blake2b_app_1'
FORK = 961640
FORK_HASH = "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb"
LOCK = threading.Lock()
CACHE = {}
SLOTS = threading.BoundedSemaphore(4)


def rpc(method, *args):
    command = ['docker', 'exec', NODE, 'bitcoin-cli', '-datadir=/data', '-rpcport=18443', method, *map(str, args)]
    return subprocess.check_output(command, stderr=subprocess.DEVNULL, timeout=8, text=True).strip()


def reference(height):
    with LOCK:
        cached = CACHE.get(height)
        if cached and time.monotonic() - cached[0] < 30:
            return cached[1]
        tip = int(rpc('getblockcount'))
        if height != FORK and not max(FORK, tip - 4096) <= height <= tip:
            raise ValueError('Out of range')
        block_hash = rpc('getblockhash', height)
        header = rpc('getblockheader', block_hash, 'false')
        if not re.fullmatch('[0-9a-fA-F]{328}', header):
            raise ValueError('Invalid XBT header')
        result = {'height': tip, 'comparisonHeight': height, 'header': header}
        if len(CACHE) > 256:
            CACHE.clear()
        CACHE[height] = (time.monotonic(), result)
        return result


def current_tip():
    # The operator and transport must be trusted independently of the proof source.
    # Read height and hash together. Historical header cache entries can survive a reorg.
    if rpc('getblockhash', FORK) != FORK_HASH:
        raise ValueError('Wrong XBT chain')
    info = json.loads(rpc('getblockchaininfo'))
    height = info.get('blocks')
    block_hash = info.get('bestblockhash')
    tip_time = info.get('time')
    now = time.time()
    if (info.get('chain') != 'main' or info.get('initialblockdownload') is not False
            or type(height) is not int or not FORK <= height <= 0x7fffffff
            or type(info.get('headers')) is not int or height != info['headers']
            or type(tip_time) is not int or not now - 10800 <= tip_time <= now + 7200
            or not isinstance(block_hash, str) or not re.fullmatch('[a-f0-9]{64}', block_hash)):
        raise ValueError('Current XBT tip unavailable')
    return {'height': height, 'hash': block_hash}


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query, keep_blank_values=True)
        tip_requested = query == {'tip': ['1']}
        heights = query.get('height', [])
        height_requested = (set(query) == {'height'} and len(heights) == 1
                            and re.fullmatch('[0-9]{1,9}', heights[0]))
        if parsed.path not in ['/', '/chain-reference'] or not (tip_requested or height_requested):
            self.send_error(400)
            return
        if not SLOTS.acquire(blocking=False):
            self.send_error(429)
            return
        try:
            try:
                body = json.dumps(current_tip() if tip_requested else reference(int(heights[0]))).encode()
            except ValueError:
                self.send_error(400)
                return
            except Exception:
                self.send_error(503)
                return
        finally:
            SLOTS.release()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8098), Handler).serve_forever()
