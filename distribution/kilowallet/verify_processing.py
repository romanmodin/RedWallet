"""Read only: verify Apple's processing of this exact Kilowallet upload."""
import json,os,time
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
            print(json.dumps({'app':APP,'build':version,'processing':state,'internalBuildState':detail.get('internalBuildState'),'encryption':b['attributes'].get('usesNonExemptEncryption')}))
            break
    print('Waiting for Apple processing of Kilowallet build '+version,flush=True)
    time.sleep(20)
else: raise RuntimeError('Processing pending; upload is not yet TestFlight-ready')
