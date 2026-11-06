"""Read-only qualification of the existing, immutable Kilowallet upload."""
import hashlib, io, json, os, subprocess, sys, zipfile
from pathlib import Path
REPO="romanmodin/RedWallet"
RUN=42137139153
HEAD='2688a5270838c6f6a73023974f0a2c9c6b290790'
SOURCE='68461ec5b6d5bde5a92533a78b15a6594605cb2f'
IPA='afb6ddb5f9685eacb0256c62cdeea76731739f823c43fa34a1c8eef596ae582d'
BUILD='efc0adfd-12df-4c95-8fa5-479b1e516563'
ARTIFACT=13466843473
ZIP_SHA='b8eb96610d84e3d6f56f444c14b2458f1e51ad952745fb00038a577cc48e9572'
MEMBERS={
 "kilowallet-archive-verification.json": "1be36972daeed46e17e6ad4485f38a79a8f342da5370e56d5160b0d773c86d3c",
 "kilowallet-apple-processing.json": "6941566b0374bbd41f7b63f02bc16a53236aedf16bd3f4c7f75c5b46ca6d6b6d",
 "kilowallet-package-verification.json": "950144d9de8ac2650f3e0351db1048f592fd081e7d40e872a461143390b6d0be",
 "kilowallet-source-gates.json": "9ccce8e726cbceaabce5c5eb341233fc0517b5ecde4bb6fc04d87bd4d983d843",
 "kilowallet-territory-preflight.json": "c2bea217efbf5705853fe50c8317a8ac45b92bfb6ed81cffea0597a99ad25d28"
}
# Pins may change only after the corresponding signed package and Apple receipts exist.
VERSION='1.0.0'
BUILD_NUMBER='8'
SDK='iphoneos26.2'
IOS_RUN=42112589802
SCREEN_RUN=42112589904
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
 env=gate_environment()
 subprocess.run([sys.executable,"-I",str(root/"distribution/kilowallet/verify_gates.py")],env=env,check=True)
 gates=json.loads(Path("kilowallet-source-gates.json").read_text())
 result=validate_receipts(receipts["kilowallet-package-verification.json"],receipts["kilowallet-apple-processing.json"],gates,receipts["kilowallet-archive-verification.json"],receipts["kilowallet-territory-preflight.json"])
 Path("kilowallet-upload-qualification.json").write_text(json.dumps(result,indent=2)+"\n")
 print(json.dumps(result,indent=2))
if __name__=="__main__":main()
