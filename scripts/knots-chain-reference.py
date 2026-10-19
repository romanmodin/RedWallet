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


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query, keep_blank_values=True)
        if parsed.path not in ['/', '/chain-reference'] or set(query) != {'height'} or len(query['height']) != 1:
            self.send_error(400)
            return
        value = query['height'][0]
        if not re.fullmatch('[0-9]{1,9}', value):
            self.send_error(400)
            return
        if not SLOTS.acquire(blocking=False):
            self.send_error(429)
            return
        try:
            try:
                body = json.dumps(reference(int(value))).encode()
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
