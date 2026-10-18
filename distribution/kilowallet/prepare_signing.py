"""Prepare credentials without printing secrets or publishing them as artifacts."""
import base64, json, os, plistlib, re
from pathlib import Path
team=os.environ.get('TEAM_ID','')
assert team == 'PPG9C98EY9', 'Unexpected Apple team'
if not re.fullmatch(r'[A-Z0-9]{10}',team): raise SystemExit('Configure TEAM_ID in the protected apple-signing environment')
try: credential=json.loads(os.environ['APP_STORE_CONNECT_API_KEY_CONTENT'])
except (KeyError,json.JSONDecodeError): raise SystemExit('Configure APP_STORE_CONNECT_API_KEY_CONTENT in apple-signing')
key_id=credential.get('key_id','');issuer=credential.get('issuer_id','')
if not re.fullmatch(r'[A-Z0-9]{10}',key_id): raise SystemExit('Invalid Apple API key ID')
if not re.fullmatch(r'[a-fA-F0-9-]{36}',issuer): raise SystemExit('Invalid Apple API issuer ID')
key=credential.get('key','')
if credential.get('is_key_content_base64'): key=base64.b64decode(key,validate=True).decode()
if not key.startswith('-----BEGIN PRIVATE KEY-----') or '-----END PRIVATE KEY-----' not in key: raise SystemExit('Invalid Apple signing key')
root=Path(os.environ['RUNNER_TEMP']);key_path=root/'Kilowallet-AuthKey.p8';options=root/'Kilowallet-ExportOptions.plist'
key_path.write_text(key);key_path.chmod(0o600)
options.write_bytes(plistlib.dumps({'method':'app-store-connect','destination':'upload' if os.environ.get('APPLE_UPLOAD')=='1' else 'export','teamID':team,'signingStyle':'automatic','manageAppVersionAndBuildNumber':False,'uploadSymbols':True}))
options.chmod(0o600)
with open(os.environ['GITHUB_ENV'],'a') as out:
    for name,value in [('APPLE_API_KEY_PATH',str(key_path)),('APPLE_API_KEY_ID',key_id),('APPLE_API_ISSUER_ID',issuer),('APPLE_EXPORT_OPTIONS',str(options))]: out.write(name+'='+value+'\n')
print('Temporary Apple signing inputs prepared; no credentials will be uploaded as artifacts.')
