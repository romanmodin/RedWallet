import copy
import plistlib
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
import external_candidate as ec
import fetch_archive as fa
import package_receipt as pkg
import sign_archive as sign

class BuildSixTests(unittest.TestCase):
    def native(self):
        repo={'full_name':ec.REPO}
        run={'repository':repo,'head_repository':repo, 'id':ec.NATIVE,'workflow_id':381250877,
             'path':'.github/workflows/ios.yml','head_sha':ec.HEAD,'head_branch':ec.BRANCH,
             'event':'pull_request','run_attempt':1,'status':'completed','conclusion':'success',
             'pull_requests':[{'number':30,'head':{'sha':ec.HEAD},'base':{'sha':'b6277dd26e163183e4c45378ca832f77d32d7dc7'}}]}
        artifacts=[{'name':name,'id':v[0],'digest':v[1],'expired':False,
                    'workflow_run':{'id':ec.NATIVE,'head_sha':ec.HEAD}} for name,v in ec.PINS.items()]
        return run, {'total_count':len(artifacts),'artifacts':artifacts}

    def test_native_requires_finished_same_attempt_same_repository(self):
        r,a=self.native()
        ec.check_native(r,a)
        for changes in [{'status':'in_progress'}, {'conclusion':'failure'}, {'event':'push'}, {'run_attempt':2},
                        {'head_sha':'bad'},{'head_repository':{'full_name':'other/fork'}},{'pull_requests':[]}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                ec.check_native(dict(r,**changes),a)

    def test_native_receipts_cannot_be_replaced_or_omitted(self):
        r,a=self.native()
        for delta in [{'expired':True}, {'digest':'sha256:'+'0'*64}, {'id':1},{'workflow_run':{'id':1,'head_sha':ec.HEAD}}]:
            b=copy.deepcopy(a);b['artifacts'][0].update(delta)
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                ec.check_native(r,b)
        for b in [dict(a,total_count=3),{'total_count':1,'artifacts':a['artifacts'][:1]},
                  {'total_count':3,'artifacts':a['artifacts']+[a['artifacts'][0]]}]:
            with self.assertRaises(ValueError): ec.check_native(r,b)

    def test_archive_rejects_a_valid_looking_but_unpinned_digest_or_old_build(self):
        repo={'full_name':fa.REPO}
        r={'id':fa.RUN,'run_attempt':1,'head_sha':fa.COMMIT,'repository':repo,'head_repository':repo,
           'event':'workflow_dispatch','workflow_id':429494744,'path':fa.WORKFLOW,'head_branch':ec.BRANCH,
           'status':'completed','conclusion':'success'}
        a={'name':fa.NAME,'id':fa.ARTIFACT_ID,'digest':fa.OUTER_DIGEST,'expired':False,
           'workflow_run':{'id':fa.RUN,'head_sha':fa.COMMIT}}
        for rr,aa in [(r,dict(a,digest='sha256:'+'0'*64)),(dict(r,id=45475792490),a),(r,dict(a,id=123))]:
            with self.assertRaises(ValueError): fa.artifact(rr,{'total_count':1,'artifacts':[aa]})

    def test_build5_can_remain_but_build6_and_incomplete_apple_records_block(self):
        app={'data':{'id':sign.APP_ID,'attributes':{'bundleId':sign.BUNDLE}}}
        rows=lambda n:[{'attributes':{'version':str(n)}}]
        with patch('sign_archive.get', side_effect=[app,{'data':rows(5)}]): sign.check_apple()
        for result in [{'data':rows(6)}, {'data':rows(7)}, {'data':rows(5),'links':{'next':'more'}}]:
            with patch('sign_archive.get',side_effect=[app,result]),self.assertRaises(ValueError):
                sign.check_apple()

    def test_export_rejects_another_app_old_build_and_nested_target_before_codesign(self):
        for app,ver,extra in [('Other','6',False),('Kilowallet','5',False),('Kilowallet','6',True)]:
            with tempfile.TemporaryDirectory() as d:
                p=Path(d)/'fixture.ipa'
                with zipfile.ZipFile(p,'w') as w:
                    w.writestr('Payload/'+app+'.app/Info.plist',plistlib.dumps({'CFBundleVersion':ver}))
                    if extra: w.writestr('Payload/Kilowallet.app/PlugIns/Bad.appex/Info.plist',b'x')
                with self.assertRaises(ValueError): pkg.package(p)

    def test_shared_profile_cannot_enable_qa_export_for_regular_wallet(self):
        from manual_profiles import main
        with self.assertRaises(ValueError): main(kilobot_build6=True)
