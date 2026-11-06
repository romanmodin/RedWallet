"""Read-only qualification of the existing, immutable Kilowallet upload."""
import hashlib, io, json, os, subprocess, sys, zipfile
from pathlib import Path
REPO="romanmodin/RedWallet"
RUN=42253151290
HEAD='3fe9280ee0a6dd06e623dc57d8fc1a1610fe4f3a'
SOURCE='5ac15b5eeb26296d69008a39e7ff1b4e23d4f8c5'
IPA='df8e64471039b6964e45347b16e41371ed99da69e312c3d544b95d2b5b147830'
BUILD='bccd1b6c-e89b-45e9-909e-0936bd558994'
ARTIFACT=13524776804
ZIP_SHA='bff4e54bb855d9ad08affb191d696e62ee194f4b9e0ad255f366204fabeb3fce'
MEMBERS={'kilowallet-source-gates.json': '2e376e1195211f7168bc3fb432e1914e39b083d28caa867ae257798ccd975ec6', 'kilowallet-visual-qualification.json': '4502ca027c547efc15109218f82f86f196daf3ed347001f4c008a9f008370d91', 'kilowallet-archive-verification.json': '1b413afaca050ea59e79c4f5a59fc70cb2ec75843487d1d10c96eaf6f666609c', 'kilowallet-package-verification.json': '5a81ac15b12e063e70f64a9c6091639d169a8a5c5aa85898090611cdbf381935', 'kilowallet-apple-processing.json': 'f6d63c1703a8ba6d6b20b8c3b8ffb863884485c10e5093a67ebc2e6592f684eb', 'kilowallet-territory-preflight.json': 'a261c8816a33b6060471aa808675d6f6fd7a93af23a58ad58e369ff3f4588eb2'}
# Pins may change only after the corresponding signed package and Apple receipts exist.
VERSION='1.0.0'
BUILD_NUMBER='10'
SDK='iphoneos26.2'
IOS_RUN=42182220263
SCREEN_RUN=42188560912
def gate_environment():
 return {**os.environ,"KILOWALLET_MARKETING_VERSION":VERSION,"KILOWALLET_SOURCE_COMMIT":SOURCE,
         "KILOWALLET_IOS_RUN_ID":str(IOS_RUN),"KILOWALLET_SCREENSHOT_RUN_ID":str(SCREEN_RUN)}
def require(ok,message):
 if not ok: raise RuntimeError(message)
def validate_run(run,jobs):
 require(all(run[k]["full_name"]==REPO for k in ("repository","head_repository")),"Wrong repository")
 require(run["id"]==RUN and run["head_sha"]==HEAD and run["head_branch"]=="main","Wrong upload source")
 require(run["event"]=="workflow_dispatch" and run["path"]==".github/workflows/build-kilowallet.yml","Wrong upload workflow/event")
 require(run["status"]=="completed" and run["conclusion"]=="success" and run["run_attempt"]==1,"Upload is not qualified")
 required={"verify","qualify","certificate","sign"}
 require(len({j["name"] for j in jobs})==len(jobs),"Ambiguous jobs")
 for name in required:
  found=[j for j in jobs if j["name"]==name]
  require(len(found)==1 and found[0]["status"]=="completed" and found[0]["conclusion"]=="success" and found[0]["run_attempt"]==1,"Required upload job did not pass")
def validate_artifact(meta,raw):
 require(meta["id"]==ARTIFACT and not meta["expired"],"Wrong or expired artifact")
 require(meta["workflow_run"]["id"]==RUN and meta["workflow_run"]["head_sha"]==HEAD,"Wrong artifact provenance")
 require(hashlib.sha256(raw).hexdigest()==ZIP_SHA and meta["digest"]=="sha256:"+ZIP_SHA,"Artifact hash mismatch")
 z=zipfile.ZipFile(io.BytesIO(raw))
 require(z.testzip() is None,"Invalid ZIP CRC")
 require(len(z.namelist())==len(set(z.namelist())),"Duplicate ZIP members")
 result={}
 for name,expected in MEMBERS.items():
  b=z.read(name)
  require(hashlib.sha256(b).hexdigest()==expected,"Receipt member hash mismatch")
  result[name]=json.loads(b)
 return result
def validate_receipts(package,processing,current_gates,archive,territory):
 for d in (package,processing):
  require(d["sourceCommit"]==SOURCE and d["ipaSha256"]==IPA and str(d["runId"])==str(RUN) and str(d["runAttempt"])=="1" and d["build"]==BUILD_NUMBER,"Wrong package/upload receipt")
 require(package["bundle"]=="com.kilombino.kilowallet" and package["team"]=="PPG9C98EY9" and package["version"]==VERSION,"Wrong package identity")
 require(package["signature"]=="verified" and package["sdk"]==SDK and package["orchestrationCommit"]==HEAD,"Package signature/SDK/source not verified")
 require(processing["app"]=="6824331953" and processing["appleBuildId"]==BUILD and processing["marketingVersion"]==VERSION and processing["processing"]=="VALID","Wrong Apple processing receipt")
 require(current_gates["sourceCommit"]==SOURCE,"Wrong native source")
 prior={g["id"]:g for g in package["qualification"]["gates"]}
 require(len(package["qualification"]["gates"])==2 and set(prior)=={IOS_RUN,SCREEN_RUN},"Unexpected native gates")
 require(len(current_gates["gates"])==2,"Duplicate or missing current native gate")
 for g in current_gates["gates"]:
  require(g["id"] in prior and g["sourceCommit"]==SOURCE and prior[g["id"]]["sourceCommit"]==SOURCE and g["runAttempt"]==prior[g["id"]]["runAttempt"] and g["jobs"]==prior[g["id"]]["jobs"],"Stale/replaced native evidence")
  if not VERSION.startswith("1."):
   require(g["runAttempt"]==1,"Unexpected historical gate attempt")
  if VERSION.startswith("1."):
   recorded=prior[g["id"]]
   require(bool(g["jobs"]) and set(g.get("checkouts",{}))==set(g["jobs"]) and g["checkouts"]==recorded.get("checkouts"),"Checkout evidence mismatch")
   if g["id"]==IOS_RUN:
    require(bool(g.get("requiredSteps")) and g["requiredSteps"]==recorded.get("requiredSteps"),"Native step evidence mismatch")
 if VERSION.startswith("1."):
  require(processing.get("platform")=="IOS" and package.get("usesNonExemptEncryption") is False,"Wrong iOS platform or signed encryption flag")
 require({g["id"] for g in current_gates["gates"]}==set(prior),"Missing current native gate")
 for k in ("bundle","build","version","team","signature","sdk","sourceCommit","qualification","orchestrationCommit","runId","runAttempt","usesNonExemptEncryption"):
  require(archive.get(k)==package.get(k),"Archive/package mismatch")
 require(archive.get("usesNonExemptEncryption") is False and processing.get("usesNonExemptEncryption") is False,"Unsupported archive/Apple encryption flag")
 require(territory.get("mode")=="GET-only" and territory.get("territories")==["USA"] and territory.get("availableInNewTerritories") is False,"USA-only upload scope not verified")
 for k in ("sourceCommit","runId","runAttempt","ipaSha256"):
  require(territory.get(k)==package.get(k),"Territory receipt package mismatch")
 require(territory.get("app")=="6824331953" and territory.get("bundle")==package["bundle"],"Wrong territory app")
 return {"uploadVerified":True,"currentNativeGatesVerified":True,"app":"6824331953","appleBuildId":BUILD,"sourceCommit":SOURCE,"ipaSha256":IPA,"runId":RUN,"runAttempt":1,"marketingVersion":VERSION,"build":BUILD_NUMBER,"signature":"verified","usesNonExemptEncryption":package.get("usesNonExemptEncryption"),"artifactId":ARTIFACT,"artifactSha256":ZIP_SHA}
def api(path,raw=False):
 b=subprocess.check_output(["gh","api",path]+(["--allow-escape-sequences"] if raw else []))
 return b if raw else json.loads(b)
def main():
 root=Path(__file__).resolve().parents[2]
 run=api(f"repos/{REPO}/actions/runs/{RUN}")
 jobs=api(f"repos/{REPO}/actions/runs/{RUN}/attempts/1/jobs?per_page=100")["jobs"]
 validate_run(run,jobs)
 meta=api(f"repos/{REPO}/actions/artifacts/{ARTIFACT}")
 receipts=validate_artifact(meta,api(f"repos/{REPO}/actions/artifacts/{ARTIFACT}/zip",True))
 visual=receipts["kilowallet-visual-qualification.json"]
 require(visual.get("sourceCommit")==SOURCE and visual.get("run")==42234792388 and visual.get("visualEvidenceQualified") is True,"Unqualified rendering evidence")
 env=gate_environment()
 subprocess.run([sys.executable,"-I",str(root/"distribution/kilowallet/verify_gates.py")],env=env,check=True)
 gates=json.loads(Path("kilowallet-source-gates.json").read_text())
 result=validate_receipts(receipts["kilowallet-package-verification.json"],receipts["kilowallet-apple-processing.json"],gates,receipts["kilowallet-archive-verification.json"],receipts["kilowallet-territory-preflight.json"])
 Path("kilowallet-upload-qualification.json").write_text(json.dumps(result,indent=2)+"\n")
 print(json.dumps(result,indent=2))
if __name__=="__main__":main()
