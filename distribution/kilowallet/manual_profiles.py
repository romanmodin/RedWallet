"""Create only Kilowallet store profiles bound to the existing distribution cert."""
import datetime, base64, hashlib, json, os, plistlib, subprocess, sys, tempfile
from pathlib import Path
from urllib.parse import urlencode, quote
from urllib.request import Request, build_opener
from recover_profile import token, NoRedirect
ALLOWED = {'iosApp': 'com.kilombino.kilowallet'}
def api(path, data=None):
    if not path.startswith('/v1/'): raise RuntimeError('Invalid Apple route')
    request = Request('https://api.appstoreconnect.apple.com'+path, headers={'Authorization':'Bearer '+token(), 'Content-Type':'application/json'}, data=None if data is None else json.dumps(data).encode())
    with build_opener(NoRedirect()).open(request, timeout=30) as response: return json.load(response)
def validate_profile(data, identifier, certificate, team):
    with tempfile.NamedTemporaryFile() as tmp:
        tmp.write(data); tmp.flush()
        p = plistlib.loads(subprocess.run(['security','cms','-D','-i',tmp.name], check=True, capture_output=True).stdout)
    if p['TeamIdentifier'] != [team] or p['Entitlements']['application-identifier'] != team+'.'+identifier: raise RuntimeError('Wrong profile identity')
    if p['Entitlements'].get('get-task-allow') or p.get('ProvisionedDevices') or p.get('ProvisionsAllDevices'): raise RuntimeError('Not a store distribution profile')
    if certificate not in p['DeveloperCertificates']: raise RuntimeError('Wrong profile certificate')
    if p['ExpirationDate']<=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None): raise RuntimeError('Expired profile')
    return p

def main():
    certificate=Path(os.environ['RUNNER_TEMP']+'/Kilowallet-signing/distribution.cer').read_bytes()
    team=os.environ['TEAM_ID']
    matches=[c for c in api('/v1/certificates?limit=200')['data'] if c['attributes']['certificateType'] in ('DISTRIBUTION','IOS_DISTRIBUTION') and base64.b64decode(c['attributes']['certificateContent'])==certificate]
    if len(matches)!=1: raise RuntimeError('Existing distribution certificate not registered with this API account')
    cid=matches[0]['id']; mapping={}; settings={}
    for target, identifier in ALLOWED.items():
        ids=api('/v1/bundleIds?'+urlencode({'filter[identifier]':identifier,'limit':5}))['data']
        ids=[b for b in ids if b['attributes']['identifier']==identifier]
        if len(ids)!=1: raise RuntimeError('Dedicated Kilowallet bundle ID not registered')
        bid=ids[0]['id']; selected=None
        for profile in api('/v1/bundleIds/'+quote(bid,safe='')+'/profiles?limit=200')['data']:
            a=profile['attributes']
            if a['profileType']!='IOS_APP_STORE' or a['profileState']!='ACTIVE': continue
            content=base64.b64decode(a['profileContent'])
            try: p=validate_profile(content,identifier,certificate,team)
            except RuntimeError: continue
            selected=(content,p);break
        if selected is None:
            result=api('/v1/profiles', {'data':{'type':'profiles','attributes':{'name':'Kilowallet App Store '+target,'profileType':'IOS_APP_STORE'},'relationships':{'bundleId':{'data':{'type':'bundleIds','id':bid}},'certificates':{'data':[{'type':'certificates','id':cid}]}}}})['data']
            content=base64.b64decode(result['attributes']['profileContent']);selected=(content,validate_profile(content,identifier,certificate,team))
        content,p=selected
        for folder in [Path.home()/'Library/Developer/Xcode/UserData/Provisioning Profiles',Path.home()/'Library/MobileDevice/Provisioning Profiles']:
            folder.mkdir(parents=True,exist_ok=True); f=folder/(p['UUID']+'.mobileprovision'); f.write_bytes(content); f.chmod(0o600)
        mapping[identifier]=p['UUID']
        settings[target]={'settings':{'base':{'CODE_SIGN_STYLE':'Manual','DEVELOPMENT_TEAM':team,'CODE_SIGN_IDENTITY':'Apple Distribution','PROVISIONING_PROFILE_SPECIFIER':p['UUID']}}}
    with open(os.environ['GITHUB_ENV'],'a') as out: out.write('KILOWALLET_PROFILE='+mapping['com.kilombino.kilowallet']+'\n')
    options={'method':'app-store-connect','destination':'export','teamID':team,'signingStyle':'manual','signingCertificate':hashlib.sha1(certificate).hexdigest().upper(),'provisioningProfiles':mapping,'manageAppVersionAndBuildNumber':False,'uploadSymbols':True,'generateAppStoreInformation':True}
    Path(os.environ['APPLE_EXPORT_OPTIONS']).write_bytes(plistlib.dumps(options))
    print('Verified dedicated Kilowallet store profile against the existing distribution certificate.')
if __name__=='__main__': main()
