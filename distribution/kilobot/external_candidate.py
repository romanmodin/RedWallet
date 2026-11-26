"""Fixed publisher inputs; imported from the protected coordinator checkout only."""
from fetch_archive import RUN, artifact, github

NATIVE = 45713149826
HEAD = '6a4ea5cabb7d39b7fbb95917f89bc1e12f882708'
REPO = 'romanmodin/kilowallet-ios'
BRANCH = 'qa/kilobot-external-build-6'
PINS = {
    'reports': (15074360339, 'sha256:dc6a92cc9739309096f05c580586a7054f44655e0c6c5934484c2795d916bfd4'),
    'screenshots': (15073008592, 'sha256:29acac4a495ea3a91ce13e61d00a929df14c586e800e86031cbe46110666a6da'),
}

def check_native(run, listing):
    expected = {'id': NATIVE, 'head_sha': HEAD, 'head_branch': BRANCH, 'workflow_id': 381250877,
                'event': 'pull_request', 'path': '.github/workflows/ios.yml', 'run_attempt': 1,
                'status': 'completed', 'conclusion': 'success'}
    if any(run.get(k) != v for k, v in expected.items()) or any(
            run[k]['full_name'] != REPO for k in ('repository','head_repository')):
        raise ValueError('Native candidate did not pass on the pinned publisher run')
    prs = run['pull_requests']
    if (len(prs) != 1 or prs[0]['number'] != 30 or prs[0]['head']['sha'] != HEAD
            or prs[0]['base']['sha'] != 'b6277dd26e163183e4c45378ca832f77d32d7dc7'):
        raise ValueError('Unexpected native PR provenance')
    items = listing['artifacts']
    if len(items) != listing['total_count']:
        raise ValueError('Incomplete native artifact list')
    for name, pin in PINS.items():
        matches = [x for x in items if x['name'] == name]
        if len(matches) != 1:
            raise ValueError('Missing or ambiguous native receipt: ' + name)
        x = matches[0]
        if (x['expired'] or pin != (x['id'],x['digest']) or x['workflow_run']['id'] != NATIVE
                or x['workflow_run']['head_sha'] != HEAD):
            raise ValueError('Unexpected native receipt: ' + name)

PROJECT_RUN = 45469611452
PROJECT_HEAD = '0d43cbc23b011a09851de9dbf7798fe46a115928'
PROJECT_SHA256 = '73f181c7197ef1225024a64749c5b06ea819aad28f6fd881ec5d9a8989866d03'

def check_project(run, listing):
    expected={'id':PROJECT_RUN,'head_sha':PROJECT_HEAD,'head_branch':'qa/kilobot-iphone-project',
              'workflow_id':429447562,'path':'.github/workflows/kilobot-iphone-project.yml',
              'event':'push','run_attempt':1,'status':'completed','conclusion':'success'}
    if any(run.get(k) != v for k,v in expected.items()) or any(
            run[k]['full_name'] != REPO for k in ('repository','head_repository')):
        raise ValueError('Unexpected QA source project run')
    items=listing['artifacts']
    matches=[x for x in items if x['name']=='Kilobot-iPhone-test-project']
    if len(items)!=listing['total_count'] or len(matches)!=1:
        raise ValueError('Missing or ambiguous QA source')
    x=matches[0]
    if (x['id']!=14955758829 or x['expired'] or x['workflow_run']['id']!=PROJECT_RUN
            or x['workflow_run']['head_sha']!=PROJECT_HEAD
            or x['digest']!='sha256:713c5e4e58a96fae6a283390d5a65dede20cc0ceb9a87d50f78bb9e42e7010de'):
        raise ValueError('Source project receipt changed')

def qualify():
    check_project(github(f'actions/runs/{PROJECT_RUN}'), github(f'actions/runs/{PROJECT_RUN}/artifacts'))
    check_native(github(f'actions/runs/{NATIVE}'), github(f'actions/runs/{NATIVE}/artifacts'))
    result = artifact(github(f'actions/runs/{RUN}'), github(f'actions/runs/{RUN}/artifacts'))
    print('Verified build 6 native evidence and unsigned archive', result['id'],result['digest'])

if __name__ == '__main__':
    qualify()
