#!/usr/bin/env python3
"""Offline integrity only. Never authorizes Apple writes or attests privacy."""
import hashlib
import json
import struct
from pathlib import Path

PINS = {
 'appId': '6824331953',
 'versionId': '1ca23695-4563-4a0e-b20e-d1a6457f4f8b',
 'reviewDetailId': '6446acd7-d950-4856-a412-0ba44fef5dfb',
 'reviewNotesFile': 'review-notes.txt',
 'reviewNotesSha256': '0b0aaae264366327c383a0d8f667fdb0fd9c3b5eaf610e8a476f52e0bb443446',
}
CANDIDATE = {
 'version':'1.0.0','build':'15',
 'appleBuildId':'964f117a-f5e1-400f-9aac-d3145407560a',
 'sourceCommit':'68148c8c5741c7b84b37f33322e67273f7208a19',
 'ipaSha256':'b09b7c9eab7c63a7697d5604b91ab82d83e60ff55c03d54e6d9acdc9ab12f7de',
}
IMAGE = '0365fed04c568d4294c419ba858277d8d65cc6c489174e80f305a86f3e11a829'
def require(condition, message):
 if not condition: raise ValueError(message)
def verify(root):
 m=json.loads((root/'manifest.json').read_text())
 require(all(m.get(k)==v for k,v in PINS.items()),'Package identity or notes pin changed')
 require(m.get('candidate')==CANDIDATE,'Candidate differs from qualified release')
 require(m.get('status')=='PREPARED_NOT_APPLIED','Unexpected application claim')
 require(m.get('listingChanges')=={},'Unexpected listing edits')
 require(m['privacyPolicy']['questionnaireVerified'] is False,'Offline package cannot attest privacy')
 require(m['privacyPolicy']['url']==f"https://github.com/romanmodin/kilowallet-ios/blob/{CANDIDATE['sourceCommit']}/PRIVACY.md",'Wrong policy source')
 require(m['expectedCurrentBuild']['id']=='bccd1b6c-e89b-45e9-909e-0936bd558994','Unexpected predecessor')
 notes=(root/PINS['reviewNotesFile']).read_bytes()
 require(hashlib.sha256(notes).hexdigest()==PINS['reviewNotesSha256'],'Notes bytes changed')
 require(len(notes.decode('utf8'))<=4000,'Review notes too long')
 s=m['screenshot']
 require(s['file']=='kilowallet-rc5-store-receive.png','Unexpected screenshot path')
 require(s['uploadPngSha256']==IMAGE,'Screenshot pin changed')
 image=(root/s['file']).read_bytes()
 require(hashlib.sha256(image).hexdigest()==IMAGE,'Screenshot bytes changed')
 require(image[:8]==b'\x89PNG\r\n\x1a\n' and struct.unpack('>IIBB',image[16:26])==(1170,2532,8,2),'Unexpected PNG dimensions or format')
 return {'packageIntegrityVerified':True,'appleWriteAuthorized':False,'privacyQuestionnaireVerified':False,'candidate':CANDIDATE,'next':'Authenticate privacy inspection, revalidate live review/build/groups, then use a separately guarded replacement path.'}
if __name__=='__main__': print(json.dumps(verify(Path(__file__).parent),indent=2))
