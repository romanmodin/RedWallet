"""Fetch only the pinned public CI evidence before visual qualification."""
import json,subprocess,sys,os
from pathlib import Path
from verify_visual import RUN,HARNESS,SOURCE
ROOT=Path(__file__).resolve().parent
REPO="romanmodin/kilowallet-ios"
def api(path):return json.loads(subprocess.check_output(["gh","api",f"repos/{REPO}/{path}"]))
def validate_remote(run,artifact,receipt):
 assert run["id"]==RUN and run["run_attempt"]==1 and run["head_sha"]==HARNESS
 assert run["repository"]["full_name"]==REPO and run["head_repository"]["full_name"]==REPO
 assert run["path"]==".github/workflows/ios.yml" and run["event"]=="workflow_dispatch"
 assert run["status"]=="completed" and run["conclusion"]=="success"
 assert artifact["id"]==receipt["artifact"]["id"] and artifact["name"]=="candidate-lnd-frame-evidence" and not artifact["expired"]
 assert artifact["digest"]=="sha256:"+receipt["artifact"]["sha256"]
 assert artifact["workflow_run"]["id"]==RUN and artifact["workflow_run"]["head_sha"]==HARNESS
 assert receipt["expectedAppSource"]==SOURCE
 return True
def main():
 assert os.environ["KILOWALLET_SOURCE_COMMIT"]==SOURCE
 receipt=json.loads((ROOT/"visual-receipt.json").read_text())
 run=api(f"actions/runs/{RUN}");artifact=api(f"actions/artifacts/{receipt['artifact']['id']}")
 validate_remote(run,artifact,receipt)
 root=Path("visual-evidence");root.mkdir(exist_ok=True)
 (root/"receipt.json").write_text(json.dumps(receipt))
 with (root/"evidence.zip").open("wb") as f:
  subprocess.run(["gh","api",f"repos/{REPO}/actions/artifacts/{artifact['id']}/zip","--allow-escape-sequences"],stdout=f,check=True)
 subprocess.run([sys.executable,str(ROOT/"verify_visual.py"),str(root),str(ROOT/"visual-review.json"),"kilowallet-visual-qualification.json"],check=True)
if __name__=="__main__":main()
