"""Offline final visual evidence gate. Does not sign, upload, or alter a wallet."""
import hashlib,json,sys,zipfile
from pathlib import Path
from visual_evidence_audit import validate,FRAMES,SOURCE
RUN=42234792388
HARNESS="8314fe533d246b73f20c46f77a9a28b4ae2fa927"
def validate_manual(manual,hashes):
    assert manual["sourceCommit"]==SOURCE and manual["run"]==RUN and manual["attempt"]==1
    assert manual["harnessCommit"]==HARNESS
    assert manual["imageHashes"]==hashes and hashes
    assert manual["allImagesReviewed"] is True
    assert manual["glyphsComplete"] is True and manual["sameProcessReentryReviewed"] is True
    assert manual["approvedForSigning"] is True
    assert isinstance(manual["reviewedAt"],str) and manual["reviewedAt"]
def main():
    root=Path(sys.argv[1]);receipt=json.loads((root/"receipt.json").read_text())
    assert receipt["run"]==RUN and receipt["attempt"]==1 and receipt["orchestration"]==HARNESS
    assert receipt["expectedAppSource"]==SOURCE and receipt["status"]=="completed" and receipt["conclusion"]=="success"
    assert receipt["compilePassed"] and receipt["capturePassed"] and receipt["nativeQualificationPassed"]
    artifact=receipt["artifact"];assert artifact["apiDigestVerified"] and artifact["zipCrcVerified"]
    data=(root/"evidence.zip").read_bytes();assert hashlib.sha256(data).hexdigest()==artifact["sha256"]
    import io
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert z.testzip() is None
        assert len(z.namelist())==len(set(z.namelist()))
        runtime=json.loads(z.read("screenshots-logs/lnd-focused-result.json"))
        assert runtime==receipt["focusedRuntime"]
        validate(runtime)
        hashes={n:hashlib.sha256(z.read("screenshots/"+n)).hexdigest() for n in ["03-create.png","55-background-settings.png",*FRAMES]}
    manual=json.loads(Path(sys.argv[2]).read_text());validate_manual(manual,hashes)
    result={"sourceCommit":SOURCE,"run":RUN,"attempt":1,"harnessCommit":HARNESS,"artifactSha256":artifact["sha256"],"imageHashes":hashes,"manualReviewedAt":manual["reviewedAt"],"visualEvidenceQualified":True,"physicalPhoneQualified":False,"fundedRecoveryQualified":False}
    Path(sys.argv[3]).write_text(json.dumps(result,indent=2)+"\n")
if __name__=="__main__":main()
