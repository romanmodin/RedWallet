"""Read only: verify Apple's processing of this exact Kilowallet upload."""
import json,os,time
from pathlib import Path
from urllib.parse import urlencode
from recover_profile import get
APP='6824331953'
assert get('/v1/apps/'+APP)['data']['attributes']['bundleId']=='com.kilombino.kilowallet'
version=os.environ['GITHUB_RUN_NUMBER']
query=urlencode({'filter[app]':APP,'filter[version]':version,'limit':5})
for attempt in range(30):
    builds=get('/v1/builds?'+query)['data']
    assert len(builds)<=1
    if builds:
        b=builds[0];state=b['attributes']['processingState']
        if state in ('INVALID','FAILED'): raise RuntimeError('Apple processing: '+state)
        if state=='VALID':
            assert not b['attributes']['expired']
            detail=get('/v1/builds/'+b['id']+'/buildBetaDetail')['data']['attributes']
            pv=get('/v1/builds/'+b['id']+'/preReleaseVersion')['data']['attributes']['version']
            assert pv==os.environ['KILOWALLET_MARKETING_VERSION']
            package=json.loads(Path('kilowallet-package-verification.json').read_text())
            assert package['build']==version and package['sourceCommit']==os.environ['KILOWALLET_SOURCE_COMMIT']
            receipt={'app':APP,'appleBuildId':b['id'],'build':version,'marketingVersion':pv,
                     'processing':state,'internalBuildState':detail.get('internalBuildState'),
                     'externalBuildState':detail.get('externalBuildState'),
                     'usesNonExemptEncryption':b['attributes'].get('usesNonExemptEncryption'),
                     'sourceCommit':package['sourceCommit'],'ipaSha256':package['ipaSha256'],
                     'runId':os.environ['GITHUB_RUN_ID'],'runAttempt':os.environ['GITHUB_RUN_ATTEMPT'],
                     'testerMembershipVerified':False,'exportComplianceDeterminationVerified':False}
            Path('kilowallet-apple-processing.json').write_text(json.dumps(receipt,indent=2)+'\n')
            print(json.dumps(receipt,indent=2))
            break
    print('Waiting for Apple processing of Kilowallet build '+version,flush=True)
    time.sleep(20)
else: raise RuntimeError('Processing pending; upload is not yet TestFlight-ready')
