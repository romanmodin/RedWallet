import hashlib
import io
import unittest
import zipfile
from verify_visual import JOINBLAKET_FRAMES, png_dimensions, verify_images

def png(width=1290, height=2796, tail=b""):
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\rIHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + tail
    )

def fixture(duplicate_pair=None):
    names = [f"{i:02d}-frame.png" for i in range(1, 69)] + JOINBLAKET_FRAMES
    out = io.BytesIO()
    expected = {}
    duplicate_pair = set(duplicate_pair or [])
    shared = png(tail=b"intentional duplicate")
    with zipfile.ZipFile(out, "w") as archive:
        for name in sorted(names):
            data = shared if name in duplicate_pair else png(tail=name.encode())
            archive.writestr(name, data)
            expected[name] = hashlib.sha256(data).hexdigest()
    return out.getvalue(), expected

class PngAudit(unittest.TestCase):
    def test_expected_dimensions(self):
        self.assertEqual((1290, 2796), png_dimensions(png()))

    def test_non_png_and_missing_ihdr_rejected(self):
        for data in [
            b"",
            b"not png",
            b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rNOPE" + b"\0" * 8,
        ]:
            with self.assertRaises(AssertionError):
                png_dimensions(data)

    def test_exact_unique_zip_qualified(self):
        data, expected = fixture()
        self.assertEqual(expected, verify_images(data, expected, set()))

    def test_duplicate_rejected_without_allowlist(self):
        pair = frozenset(["01-frame.png", "02-frame.png"])
        data, expected = fixture(pair)
        with self.assertRaises(AssertionError):
            verify_images(data, expected, set())

    def test_exact_allowlisted_duplicate_qualified(self):
        pair = frozenset(["01-frame.png", "02-frame.png"])
        data, expected = fixture(pair)
        self.assertEqual(expected, verify_images(data, expected, {pair}))

    def test_missing_file_changed_pixel_and_wrong_dimension_rejected(self):
        data, expected = fixture()
        changed_sets = [
            {k: v for i, (k, v) in enumerate(expected.items()) if i},
            dict(expected, **{next(iter(expected)): "f" * 64}),
        ]
        for changed in changed_sets:
            with self.assertRaises(AssertionError):
                verify_images(data, changed, set())

        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            for name in expected:
                archive.writestr(name, png(width=1, tail=name.encode()))
        bad_hashes = {
            name: hashlib.sha256(png(width=1, tail=name.encode())).hexdigest()
            for name in expected
        }
        with self.assertRaises(AssertionError):
            verify_images(out.getvalue(), bad_hashes, set())

if __name__ == "__main__":
    unittest.main()
