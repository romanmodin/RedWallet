"""Recover an exact missing Xcode profile using Apple's read-only API, then stop."""
import base64, json, os, plistlib, re, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.parse import urlencode, quote
from urllib.request import Request, build_opener, HTTPRedirectHandler

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*a,**k): raise RuntimeError('Apple API redirect refused')
def b64(x): return base64.urlsafe_b64encode(x).rstrip(b'=').decode()
def token():
    now=int(time.time())
    header=b64(json.dumps({'alg':'ES256','kid':os.environ['APPLE_API_KEY_ID'],'typ':'JWT'},separators=(',',':')).encode())
    payload=b64(json.dumps({'iss':os.environ['APPLE_API_ISSUER_ID'],'iat':now,'exp':now+300,'aud':'appstoreconnect-v1'},separators=(',',':')).encode())
    data=(header+'.'+payload).encode()
    sig=subprocess.run(['openssl','dgst','-sha256','-sign',os.environ['APPLE_API_KEY_PATH']],input=data,capture_output=True,check=True).stdout
    # OpenSSL's short P-256 ASN.1 sequence contains two INTEGERs.
    if len(sig)<8 or sig[0]!=48 or sig[1]!=len(sig)-2: raise RuntimeError('Invalid signing result')
    offset=2;parts=[]
    for _ in range(2):
        if sig[offset]!=2: raise RuntimeError('Invalid signature integer')
        n=sig[offset+1];part=sig[offset+2:offset+2+n];offset+=2+n
        part=part.lstrip(b'\0')
        if len(part)>32: raise RuntimeError('Signature integer overflow')
        parts.append(part.rjust(32,b'\0'))
    if offset!=len(sig): raise RuntimeError('Invalid signature trailing bytes')
    return data.decode()+'.'+b64(b''.join(parts))
def get(path):
    if not path.startswith('/v1/'): raise RuntimeError('Invalid Apple API route')
    req=Request('https://api.appstoreconnect.apple.com'+path,headers={'Authorization':'Bearer '+token()})
    with build_opener(NoRedirect()).open(req,timeout=30) as r: return json.load(r)
