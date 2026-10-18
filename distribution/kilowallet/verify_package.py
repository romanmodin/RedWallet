"""Fail closed on a mismatched or development-signed Kilowallet archive/IPA."""
import hashlib, json, os, plistlib, subprocess, sys, tempfile
from pathlib import Path
TEAM='PPG9C98EY9'
BUNDLE='com.kilombino.kilowallet'
def verify(app):
    p=plistlib.loads((app/'Info.plist').read_bytes())
    assert p['CFBundleIdentifier']==BUNDLE
    assert p['CFBundleVersion']==os.environ['GITHUB_RUN_NUMBER']
    assert p['CFBundleShortVersionString']=='0.1.0'
    assert p['CFBundleExecutable']=='Kilowallet'
    assert (app/'Kilowallet').is_file()
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
    identity=subprocess.run(['codesign','-dv','--verbose=4',str(app)],check=True,capture_output=True).stderr.decode()
    assert 'TeamIdentifier='+TEAM in identity
    e=plistlib.loads(subprocess.run(['codesign','-d','--entitlements',':-',str(app)],check=True,capture_output=True).stdout)
    assert e['application-identifier']==TEAM+'.'+BUNDLE
    assert not e.get('get-task-allow',False)
    profile=plistlib.loads(subprocess.run(['security','cms','-D','-i',str(app/'embedded.mobileprovision')],check=True,capture_output=True).stdout)
    assert profile['TeamIdentifier']==[TEAM]
    assert profile['Entitlements']['application-identifier']==TEAM+'.'+BUNDLE
    assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices')
    print(json.dumps({'bundle':BUNDLE,'build':p['CFBundleVersion'],'version':p['CFBundleShortVersionString'],'team':TEAM,'signature':'verified'}))
path=Path(sys.argv[1])
assert os.environ['TEAM_ID']==TEAM
if path.suffix=='.ipa':
    with tempfile.TemporaryDirectory() as t:
        subprocess.run(['ditto','-x','-k',str(path),t],check=True)
        apps=list((Path(t)/'Payload').glob('*.app'))
        assert len(apps)==1
        verify(apps[0])
    print('IPA SHA256 '+hashlib.sha256(path.read_bytes()).hexdigest())
else: verify(path)
