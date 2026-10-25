import json
import os
import plistlib
import subprocess
import tempfile
import unittest
from datetime import datetime,timedelta
from pathlib import Path
from unittest.mock import patch
from verify_package import BUNDLE,TEAM,verify

class PackageTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.app=self.root/"Kilowallet.app";self.app.mkdir()
        (self.app/"Kilowallet").write_bytes(b"synthetic-executable")
        self.info={"CFBundleIdentifier":BUNDLE,"CFBundleVersion":"5","CFBundleShortVersionString":"0.4.0",
                   "CFBundleExecutable":"Kilowallet","DTSDKName":"iphoneos26.5"}
        self.profile={"TeamIdentifier":[TEAM],"UUID":"fake-profile",
                      "ExpirationDate":datetime.now()+timedelta(days=1),
                      "Entitlements":{"application-identifier":TEAM+"."+BUNDLE}}
        self.entitlements={"application-identifier":TEAM+"."+BUNDLE}
        self.arches=b"arm64"
        self.identity="TeamIdentifier="+TEAM+"\nAuthority=Apple Distribution: Synthetic"
        self.oldcwd=os.getcwd();os.chdir(self.root);self.addCleanup(os.chdir,self.oldcwd)
        Path("kilowallet-source-gates.json").write_text(json.dumps({"sourceCommit":"a"*40}))
        self.env=patch.dict(os.environ,{"GITHUB_RUN_NUMBER":"5","KILOWALLET_MARKETING_VERSION":"0.4.0",
            "KILOWALLET_SOURCE_COMMIT":"a"*40,"GITHUB_SHA":"b"*40,"GITHUB_RUN_ID":"100","GITHUB_RUN_ATTEMPT":"1"})
        self.env.start();self.addCleanup(self.env.stop)
        self.mock=patch("verify_package.subprocess.run",side_effect=self.command);self.mock.start();self.addCleanup(self.mock.stop)
    def command(self,args,**kwargs):
        if args[0]=="lipo": return subprocess.CompletedProcess(args,0,stdout=self.arches)
        if args[0]=="security": return subprocess.CompletedProcess(args,0,stdout=plistlib.dumps(self.profile))
        if "--entitlements" in args: return subprocess.CompletedProcess(args,0,stdout=plistlib.dumps(self.entitlements))
        return subprocess.CompletedProcess(args,0,stdout=b"",stderr=self.identity.encode())
    def call(self):
        (self.app/"Info.plist").write_bytes(plistlib.dumps(self.info))
        return verify(self.app)
    def test_exact_package_and_omitted_encryption_assertion(self):
        receipt=self.call()
        self.assertEqual("0.4.0",receipt["version"])
        self.assertEqual("a"*40,receipt["sourceCommit"])
        self.assertIsNone(receipt["usesNonExemptEncryption"])
        self.assertEqual(64,len(receipt["executableSha256"]))
    def test_wrong_version_bundle_build_or_sdk(self):
        for key,value in [("CFBundleIdentifier","other"),("CFBundleVersion","4"),
                          ("CFBundleShortVersionString","0.1.0"),("DTSDKName","iphoneos25.1"),
                          ("DTSDKName","iphonesimulator26.5")]:
            original=self.info[key];self.info[key]=value
            with self.subTest(key=key), self.assertRaises(AssertionError): self.call()
            self.info[key]=original
    def test_development_or_wrong_identity(self):
        for identity in ["TeamIdentifier=OTHER\nAuthority=Apple Distribution: Synthetic",
                         "TeamIdentifier="+TEAM+"\nAuthority=Apple Development: Synthetic"]:
            self.identity=identity
            with self.assertRaises(AssertionError): self.call()
        self.identity="TeamIdentifier="+TEAM+"\nAuthority=Apple Distribution: Synthetic"
        self.entitlements["get-task-allow"]=True
        with self.assertRaises(AssertionError): self.call()
    def test_expired_or_device_profile(self):
        self.profile["ExpirationDate"]=datetime.now()-timedelta(days=1)
        with self.assertRaises(AssertionError): self.call()
        self.profile["ExpirationDate"]=datetime.now()+timedelta(days=1)
        self.profile["ProvisionedDevices"]=["fake-device"]
        with self.assertRaises(AssertionError): self.call()
    def test_wrong_architecture(self):
        self.arches=b"x86_64"
        with self.assertRaises(AssertionError): self.call()
    def test_mismatched_source_receipt(self):
        Path("kilowallet-source-gates.json").write_text(json.dumps({"sourceCommit":"c"*40}))
        with self.assertRaises(AssertionError): self.call()
if __name__=="__main__": unittest.main()
