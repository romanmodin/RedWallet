import unittest
from urllib.parse import parse_qs, urlsplit
from verify_processing import APP, BUNDLE, check_build, verify_identity


class ProcessingTest(unittest.TestCase):
    def setUp(self):
        self.package = dict(build='3', version='1.0.0', bundle=BUNDLE, sourceCommit='b'*40,
                            orchestrationCommit='a'*40, runId='555', runAttempt='1',
                            ipaSha256='c'*64, signature='verified')
        self.build = dict(type='builds', id='new', attributes=dict(version='3', processingState='VALID', expired=False))
        self.page = dict(data=[self.build])
        self.train = dict(type='preReleaseVersions', attributes=dict(version='1.0.0', platform='IOS'))
        self.details = []

    def read(self, url):
        if url.startswith('/v1/builds?'):
            q = parse_qs(urlsplit(url).query)
            self.assertEqual(q['filter[app]'], [APP])
            self.assertEqual(q['filter[version]'], ['3'])
            self.assertEqual(q['filter[preReleaseVersion.version]'], ['1.0.0'])
            self.assertEqual(q['filter[preReleaseVersion.platform]'], ['IOS'])
            return self.page
        if url == '/v1/builds/new/preReleaseVersion':
            return {'data': self.train}
        self.assertEqual(url, '/v1/builds/new/buildBetaDetail')
        self.details.append(url)
        return {'data': {'attributes': {'externalBuildState': 'READY_FOR_BETA_SUBMISSION'}}}

    def test_valid_is_processing_proof_only(self):
        receipt = check_build(self.read, self.package)
        self.assertEqual((receipt['appleBuildId'], receipt['ipaSha256']), ('new', self.package['ipaSha256']))
        self.assertFalse(receipt['testerMembershipVerified'])

    def test_previous_train_or_non_ios_cannot_certify_same_number(self):
        for version, platform in [('0.4.0','IOS'), ('1.0.0','MAC_OS')]:
            self.train['attributes'].update(version=version, platform=platform)
            with self.assertRaisesRegex(ValueError, 'version or platform'):
                check_build(self.read, self.package)
        self.assertFalse(self.details)

    def test_ambiguous_or_paginated_response_cannot_certify(self):
        for page in [{'data':[self.build, self.build]}, {'data':[self.build], 'links':{'next':'next'}}]:
            self.page = page
            with self.assertRaisesRegex(ValueError, 'Ambiguous'):
                check_build(self.read, self.package)

    def test_missing_or_processing_waits(self):
        self.page = {'data':[]}
        self.assertIsNone(check_build(self.read, self.package))
        self.page['data'].append(self.build)
        self.build['attributes']['processingState'] = 'PROCESSING'
        self.assertIsNone(check_build(self.read, self.package))
        self.assertFalse(self.details)

    def test_invalid_expired_or_wrong_number_refused(self):
        for key, value in [('processingState','INVALID'), ('expired',True), ('version','4')]:
            attrs = self.build['attributes']; old = attrs[key]; attrs[key] = value
            with self.assertRaises(ValueError): check_build(self.read, self.package)
            attrs[key] = old
        self.assertFalse(self.details)

    def test_wrong_package_or_run_does_not_bind(self):
        env = dict(GITHUB_SHA='a'*40, KILOWALLET_SOURCE_COMMIT='b'*40, GITHUB_RUN_ID='555',
                   GITHUB_RUN_ATTEMPT='1', GITHUB_RUN_NUMBER='3', KILOWALLET_MARKETING_VERSION='1.0.0')
        verify_identity(self.package, env)
        for key in ('bundle','build','version','signature','ipaSha256','sourceCommit','runAttempt','runId','orchestrationCommit'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                verify_identity(dict(self.package, **{key: 'wrong'}), env)
