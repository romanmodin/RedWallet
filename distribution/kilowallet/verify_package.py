"""Fail closed on a mismatched or development-signed Kilowallet archive/IPA."""
import hashlib, json, os, plistlib, re, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path
TEAM='PPG9C98EY9'
BUNDLE='com.kilombino.kilowallet'
def verify(app):
    p=plistlib.loads((app/'Info.plist').read_bytes())
    assert p['CFBundleIdentifier']==BUNDLE
    assert p['CFBundleVersion']==os.environ['GITHUB_RUN_NUMBER']
    assert p['CFBundleShortVersionString']==os.environ['KILOWALLET_MARKETING_VERSION']
    sdk=re.fullmatch(r'iphoneos(\d+)(?:\.\d+)*',p.get('DTSDKName',''))
    assert sdk and int(sdk[1])>=26, 'iPhoneOS SDK 26 or newer required'
    assert p['CFBundleExecutable']=='Kilowallet'
    assert (app/'Kilowallet').is_file()
    arches=subprocess.run(['lipo','-archs',str(app/'Kilowallet')],check=True,capture_output=True).stdout.decode().split()
    assert arches==['arm64'], 'Expected arm64 device executable'
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
    identity=subprocess.run(['codesign','-dv','--verbose=4',str(app)],check=True,capture_output=True).stderr.decode()
    assert 'TeamIdentifier='+TEAM in identity
    assert 'Authority=Apple Distribution:' in identity
    e=plistlib.loads(subprocess.run(['codesign','-d','--entitlements',':-',str(app)],check=True,capture_output=True).stdout)
    assert e['application-identifier']==TEAM+'.'+BUNDLE
    assert not e.get('get-task-allow',False)
    profile=plistlib.loads(subprocess.run(['security','cms','-D','-i',str(app/'embedded.mobileprovision')],check=True,capture_output=True).stdout)
    assert profile['TeamIdentifier']==[TEAM]
    assert profile['Entitlements']['application-identifier']==TEAM+'.'+BUNDLE
    assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices')
    assert profile['ExpirationDate'].replace(tzinfo=timezone.utc)>datetime.now(timezone.utc)
    gates=json.loads(Path('kilowallet-source-gates.json').read_text())
    assert gates['sourceCommit']==os.environ['KILOWALLET_SOURCE_COMMIT']
    return {'bundle':BUNDLE,'build':p['CFBundleVersion'],'version':p['CFBundleShortVersionString'],
            'team':TEAM,'signature':'verified','sdk':p['DTSDKName'],
            'executableSha256':hashlib.sha256((app/'Kilowallet').read_bytes()).hexdigest(),
            'profileUuid':profile['UUID'],'usesNonExemptEncryption':p.get('ITSAppUsesNonExemptEncryption'),
            'sourceCommit':gates['sourceCommit'],'qualification':gates,
            'orchestrationCommit':os.environ['GITHUB_SHA'],'runId':os.environ['GITHUB_RUN_ID'],
            'runAttempt':os.environ['GITHUB_RUN_ATTEMPT']}
def main():
    path=Path(sys.argv[1])
    assert os.environ['TEAM_ID']==TEAM
    if path.suffix=='.ipa':
        with tempfile.TemporaryDirectory() as t:
            subprocess.run(['ditto','-x','-k',str(path),t],check=True)
            apps=list((Path(t)/'Payload').glob('*.app'))
            assert len(apps)==1
            receipt=verify(apps[0])
        receipt['ipaSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        Path('kilowallet-package-verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
    else:
        receipt=verify(path)
        Path('kilowallet-archive-verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))

if __name__ == "__main__": main()
