"""Identify and verify exactly the IPA supplied to Apple's uploader."""
import hashlib, json, os, plistlib, stat, subprocess, sys, tempfile, zipfile
from pathlib import Path
from sign_archive import BUNDLE, VERSION, BUILD, TEAM, check_app
from fetch_archive import RUN, COMMIT, INNER_DIGEST, OUTER_DIGEST, ARTIFACT_ID
from external_candidate import NATIVE, HEAD, PROJECT_RUN, PROJECT_HEAD, PROJECT_SHA256

def package(path):
    prefix = 'Payload/Kilowallet.app/'
    with zipfile.ZipFile(path) as z:
        names=z.namelist()
        apps={n.split('/')[1] for n in names if n.startswith('Payload/') and len(n.split('/'))>1 and n.split('/')[1]}
        if (apps != {'Kilowallet.app'} or len(names)!=len(set(names))
                or any('/../' in '/'+n+'/' or n.startswith('/') or '\\' in n for n in names)
                or any(stat.S_ISLNK(x.external_attr >> 16) for x in z.infolist())
                or any(n.startswith(prefix) and any(s.endswith(('.app','.appex')) for s in n[len(prefix):].split('/')) for n in names)):
            raise ValueError('Unexpected exported payload')
        check_app(plistlib.loads(z.read(prefix+'Info.plist')))
        for name in ('embedded.mobileprovision','_CodeSignature/CodeResources','Kilowallet','Frameworks/KilombinoTor.framework/KilombinoTor'):
            if not z.getinfo(prefix+name).file_size:
                raise ValueError('Missing signed component: '+name)
        if z.testzip() is not None:
            raise ValueError('Corrupt exported IPA')
    with tempfile.TemporaryDirectory() as temp:
        subprocess.run(['ditto','-x','-k',str(path),temp],check=True)
        app=Path(temp)/prefix
        subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
        ent=plistlib.loads(subprocess.check_output(['codesign','-d','--entitlements',':-',str(app)]))
        expected={'application-identifier':TEAM+'.'+BUNDLE,'keychain-access-groups':[TEAM+'.'+BUNDLE],
                  'com.apple.developer.team-identifier':TEAM,'get-task-allow':False,'beta-reports-active':True}
        if ent != expected:
            raise ValueError('Exported IPA entitlements differ from verified QA identity')
    return {'bundle':BUNDLE,'version':VERSION,'build':BUILD,'team':TEAM,'publisherRun':RUN,
            'archiveWorkflowCommit':COMMIT,'unsignedArtifact':ARTIFACT_ID,'outerSha256':OUTER_DIGEST,
            'archiveSha256':INNER_DIGEST,'projectSource':'1c4e029b38dab8aa791c267663f9001b3f60e917',
            'projectRun':PROJECT_RUN,'projectWorkflowCommit':PROJECT_HEAD,'projectZipSha256':PROJECT_SHA256,
            'nativeRun':NATIVE,'nativeHead':HEAD,'ipaSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'coordinatorCommit':os.environ['GITHUB_SHA'],'coordinatorRun':os.environ['GITHUB_RUN_ID'],
            'attempt':os.environ['GITHUB_RUN_ATTEMPT']}

if __name__=='__main__':
    expected=Path('kilobot-build6-package.json')
    result=package(Path(sys.argv[1]))
    if sys.argv[2]=='record' and not expected.exists():
        expected.write_text(json.dumps(result,indent=2)+'\n')
    elif sys.argv[2]!='check' or json.loads(expected.read_text())!=result:
        raise SystemExit('Package receipt mismatch')
