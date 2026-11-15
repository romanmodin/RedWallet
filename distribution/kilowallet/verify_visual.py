"""Offline RC6 visual gate. It binds manual review to the exact public screenshot ZIP."""
import hashlib
import io
import json
import struct
import sys
import zipfile
from pathlib import Path

SOURCE = "9dfdcf864e92bde8a1c04485ff93294d2b731965"
RUN = 43697661614
ATTEMPT = 1
ARTIFACT = 14160198887
ARTIFACT_SHA256 = "0ffe2ef90d0cd1af0fdf274ab41daa6f5c85720cf91949f43ad3892db24280c6"
JOINBLAKET_FRAMES = [
    "69-jb-send.png", "70-jb-plan.png", "71-jb-progress.png", "72-jb-sent.png",
    "73-jb-failed.png", "74-jb-send-es.png", "75-jb-plan-es.png", "76-jb-sent-zh.png",
]
KNOWN_DUPLICATES = [
    {
        "files": ["01-welcome.png", "12-ark.png"],
        "reason": "12-ark is a known failed early synthetic capture and is not Ark evidence; Ark is covered by reviewed frames 45, 46, 47 and 52.",
    },
    {
        "files": ["22-pool-create.png", "68-pool-create-v6.png"],
        "reason": "The pool-create form is intentionally shared and unchanged; v6-specific terms are covered by reviewed frames 66 and 67.",
    },
]

def png_dimensions(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR"
    return struct.unpack(">II", data[16:24])

def duplicate_groups(hashes):
    by_hash = {}
    for name, digest in hashes.items():
        by_hash.setdefault(digest, set()).add(name)
    return {frozenset(names) for names in by_hash.values() if len(names) > 1}

def validate_allowlist(manual):
    assert manual["duplicateImageAllowlist"] == KNOWN_DUPLICATES
    return {frozenset(item["files"]) for item in KNOWN_DUPLICATES}

def validate_manual(manual, hashes):
    assert manual["sourceCommit"] == SOURCE and manual["run"] == RUN and manual["attempt"] == ATTEMPT
    assert manual["artifactId"] == ARTIFACT and manual["artifactSha256"] == ARTIFACT_SHA256
    assert manual["imageHashes"] == hashes and len(hashes) == 76
    assert list(hashes) == sorted(hashes)
    assert duplicate_groups(hashes) == validate_allowlist(manual)
    assert manual["allImagesReviewed"] is True and manual["glyphsComplete"] is True
    assert manual["layoutOrClippingBlockers"] == []
    assert manual["joinBlaketFrames"] == JOINBLAKET_FRAMES
    assert manual["approvedForSigning"] is True
    assert manual["syntheticOnly"] is True and manual["realTransaction"] is False
    assert manual["physicalPhoneTested"] is False
    assert isinstance(manual["reviewedAt"], str) and manual["reviewedAt"]
    assert isinstance(manual["reviewer"], str) and manual["reviewer"]
    assert isinstance(manual["notes"], str) and manual["notes"]

def verify_images(data, expected, allowed_duplicates):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        assert archive.testzip() is None and len(names) == len(set(names))
        assert set(names) == set(expected) and len(names) == 76
        hashes = {}
        for name in sorted(names):
            image = archive.read(name)
            assert png_dimensions(image) == (1290, 2796)
            hashes[name] = hashlib.sha256(image).hexdigest()
    assert hashes == expected
    assert duplicate_groups(hashes) == set(allowed_duplicates)
    return hashes

def main():
    root = Path(sys.argv[1])
    receipt = json.loads((root / "receipt.json").read_text())
    assert receipt["run"] == RUN and receipt["attempt"] == ATTEMPT
    assert receipt["sourceCommit"] == SOURCE
    assert receipt["status"] == "completed" and receipt["conclusion"] == "success"
    artifact = receipt["artifact"]
    assert artifact["id"] == ARTIFACT and artifact["sha256"] == ARTIFACT_SHA256
    assert artifact["apiDigestVerified"] is True and artifact["zipCrcVerified"] is True
    data = (root / "evidence.zip").read_bytes()
    assert hashlib.sha256(data).hexdigest() == ARTIFACT_SHA256
    manual = json.loads(Path(sys.argv[2]).read_text())
    expected = manual["imageHashes"]
    hashes = verify_images(data, expected, validate_allowlist(manual))
    validate_manual(manual, hashes)
    result = {
        "sourceCommit": SOURCE,
        "run": RUN,
        "attempt": ATTEMPT,
        "artifactId": ARTIFACT,
        "artifactSha256": ARTIFACT_SHA256,
        "imageHashes": hashes,
        "duplicateImageAllowlist": KNOWN_DUPLICATES,
        "manualReviewedAt": manual["reviewedAt"],
        "visualEvidenceQualified": True,
        "syntheticOnly": True,
        "realTransaction": False,
        "physicalPhoneQualified": False,
    }
    Path(sys.argv[3]).write_text(json.dumps(result, indent=2) + "\n")

if __name__ == "__main__":
    main()
