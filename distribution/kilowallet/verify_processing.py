"""Read only: bind Apple's processing result to this exact signed iOS package."""
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlencode
from recover_profile import get

APP = '6824331953'
BUNDLE = 'com.kilombino.kilowallet'


def check_build(read, package):
    number, version = package['build'], package['version']
    query = urlencode({'filter[app]': APP, 'filter[version]': number,
                       'filter[preReleaseVersion.version]': version,
                       'filter[preReleaseVersion.platform]': 'IOS', 'limit': 2})
    page = read('/v1/builds?' + query)
    builds = page['data']
    if not isinstance(builds, list) or len(builds) > 1 or page.get('links', {}).get('next'):
        raise ValueError('Ambiguous Apple build response')
    if not builds:
        return None
    build = builds[0]
    if build['type'] != 'builds' or build['attributes']['version'] != number:
        raise ValueError('Mismatched Apple build')
    url = '/v1/builds/' + build['id']
    train = read(url + '/preReleaseVersion')['data']
    if (train['type'] != 'preReleaseVersions' or train['attributes']['version'] != version
            or train['attributes']['platform'] != 'IOS'):
        raise ValueError('Mismatched Apple version or platform')
    state = build['attributes']['processingState']
    if state == 'PROCESSING':
        return None
    if state != 'VALID' or build['attributes']['expired'] is not False:
        raise ValueError('Apple build unavailable: ' + state)
    detail = read(url + '/buildBetaDetail')['data']['attributes']
    return {'app': APP, 'appleBuildId': build['id'], 'build': number,
            'marketingVersion': version, 'platform': 'IOS', 'processing': state,
            'internalBuildState': detail.get('internalBuildState'),
            'externalBuildState': detail.get('externalBuildState'),
            'usesNonExemptEncryption': build['attributes'].get('usesNonExemptEncryption'),
            'sourceCommit': package['sourceCommit'], 'ipaSha256': package['ipaSha256'],
            'runId': package['runId'], 'runAttempt': package['runAttempt'],
            'testerMembershipVerified': False, 'exportComplianceDeterminationVerified': False}


def verify_identity(package, env):
    expected = {'sourceCommit': env['KILOWALLET_SOURCE_COMMIT'], 'build': env['GITHUB_RUN_NUMBER'],
                'version': env['KILOWALLET_MARKETING_VERSION'], 'bundle': BUNDLE, 'signature': 'verified',
                'runId': env['GITHUB_RUN_ID'], 'runAttempt': env['GITHUB_RUN_ATTEMPT'],
                'orchestrationCommit': env['GITHUB_SHA']}
    if any(package.get(k) != v for k, v in expected.items()) or not re.fullmatch('[0-9a-f]{64}', package.get('ipaSha256', '')):
        raise ValueError('Package receipt does not match this signed release')


def main():
    package = json.loads(Path('kilowallet-package-verification.json').read_text())
    verify_identity(package, os.environ)
    app = get('/v1/apps/' + APP)['data']
    if app['id'] != APP or app['attributes']['bundleId'] != BUNDLE:
        raise ValueError('Wrong Apple app')
    for _ in range(30):
        receipt = check_build(get, package)
        if receipt is not None:
            Path('kilowallet-apple-processing.json').write_text(json.dumps(receipt, indent=2) + '\n')
            print(json.dumps(receipt, indent=2))
            return
        print('Waiting for Apple processing of Kilowallet ' + package['version'] + ' (' + package['build'] + ')', flush=True)
        time.sleep(20)
    raise RuntimeError('Processing pending; upload is not yet TestFlight-ready')


if __name__ == '__main__':
    main()
