"""Read-only qualification of the existing, immutable Kilowallet upload."""
import hashlib, io, json, os, subprocess, sys, zipfile
from pathlib import Path
REPO="romanmodin/RedWallet"
RUN=40218593516
HEAD="280025e5bbf595af50545a45c81ef0b27bf24aad"
SOURCE="7c38da214682544e13ba81f472a0d1038a4d4426"
IPA="022d7f55a7e24607ab4ff0e84af43b5d20f23ccc789d700e2acc6c6504b2b2fd"
BUILD="19c6e86c-079e-4022-9a11-a9ab4f23c3ba"
ARTIFACT=12608731782
ZIP_SHA="afb6b3d3cf3ed4490e1940e15d357b105874c12d3c287ca476cfd6e65d52503e"
MEMBERS={
 "kilowallet-package-verification.json":"c016cbed0acba12d49886dba8371567090903a4f121d3a918581a43fc05a980e",
 "kilowallet-apple-processing.json":"4fde854127fce8bc10fdf12a99d8d0800892366d1bdeb354ff2bdfd50b1d52b8"
}
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
def validate_receipts(package,processing,current_gates):
 for d in (package,processing):
  require(d["sourceCommit"]==SOURCE and d["ipaSha256"]==IPA and str(d["runId"])==str(RUN) and str(d["runAttempt"])=="1" and d["build"]=="3","Wrong package/upload receipt")
 require(package["bundle"]=="com.kilombino.kilowallet" and package["team"]=="PPG9C98EY9" and package["version"]=="0.4.0","Wrong package identity")
 require(package["signature"]=="verified" and package["sdk"]=="iphoneos26.5" and package["orchestrationCommit"]==HEAD,"Package signature/SDK/source not verified")
 require(processing["app"]=="6824331953" and processing["appleBuildId"]==BUILD and processing["marketingVersion"]=="0.4.0" and processing["processing"]=="VALID","Wrong Apple processing receipt")
 require(current_gates["sourceCommit"]==SOURCE,"Wrong native source")
 prior={g["id"]:g for g in package["qualification"]["gates"]}
 require(set(prior)=={40211577658,40211577657},"Unexpected native gates")
 for g in current_gates["gates"]:
  require(g["id"] in prior and g["sourceCommit"]==SOURCE and g["runAttempt"]==1 and g["jobs"]==prior[g["id"]]["jobs"],"Stale/replaced native evidence")
 require({g["id"] for g in current_gates["gates"]}==set(prior),"Missing current native gate")
 return {"uploadVerified":True,"currentNativeGatesVerified":True,"app":"6824331953","appleBuildId":BUILD,"sourceCommit":SOURCE,"ipaSha256":IPA,"runId":RUN,"runAttempt":1,"marketingVersion":"0.4.0","build":"3","signature":"verified","artifactId":ARTIFACT,"artifactSha256":ZIP_SHA}
def api(path,raw=False):
 b=subprocess.check_output(["gh","api",path])
 return b if raw else json.loads(b)
def main():
 root=Path(__file__).resolve().parents[2]
 run=api(f"repos/{REPO}/actions/runs/{RUN}")
 jobs=api(f"repos/{REPO}/actions/runs/{RUN}/attempts/1/jobs?per_page=100")["jobs"]
 validate_run(run,jobs)
 meta=api(f"repos/{REPO}/actions/artifacts/{ARTIFACT}")
 receipts=validate_artifact(meta,api(f"repos/{REPO}/actions/artifacts/{ARTIFACT}/zip",True))
 env={**os.environ,"KILOWALLET_SOURCE_COMMIT":SOURCE,"KILOWALLET_IOS_RUN_ID":"40211577658","KILOWALLET_SCREENSHOT_RUN_ID":"40211577657"}
 subprocess.run([sys.executable,"-I",str(root/"distribution/kilowallet/verify_gates.py")],env=env,check=True)
 gates=json.loads(Path("kilowallet-source-gates.json").read_text())
 result=validate_receipts(receipts["kilowallet-package-verification.json"],receipts["kilowallet-apple-processing.json"],gates)
 Path("kilowallet-upload-qualification.json").write_text(json.dumps(result,indent=2)+"\n")
 print(json.dumps(result,indent=2))
if __name__=="__main__":main()
