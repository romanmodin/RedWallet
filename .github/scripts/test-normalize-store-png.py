import importlib.util
import struct
import unittest
import zlib
from pathlib import Path
spec = importlib.util.spec_from_file_location('png_normalizer', Path(__file__).with_name('normalize-store-png.py'))
png = importlib.util.module_from_spec(spec)
spec.loader.exec_module(png)

def image(pixels, color=6):
    channels = 4 if color == 6 else 3
    header = struct.pack('>IIBBBBB', len(pixels)//channels, 1, 8, color, 0, 0, 0)
    return png.SIGNATURE + png.chunk(b'IHDR',header) + png.chunk(b'sRGB',b'\x00') + png.chunk(b'IDAT',zlib.compress(b'\x00'+pixels)) + png.chunk(b'IEND',b'')

class NativePNGTests(unittest.TestCase):
    def test_opaque_pixels_and_color_profile_are_preserved(self):
        result=png.normalize_png(image(bytes([10,20,30,255,70,80,90,255])))
        w,h,rows,parts=png.decode(result)
        self.assertEqual((w,h,rows),(2,1,[bytes([10,20,30,70,80,90])]))
        self.assertEqual(parts[0][1][9],2)
        self.assertIn((b'sRGB',b'\x00'),parts)

    def test_transparent_or_corrupted_input_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'transparency'):
            png.normalize_png(image(bytes([10,20,30,254])))
        bad=bytearray(image(bytes([10,20,30,255])));bad[-1]^=1
        with self.assertRaisesRegex(ValueError,'checksum'):
            png.normalize_png(bytes(bad))

    def test_all_standard_filter_types_decode_identical_pixels(self):
        pixels=bytes([10,20,30,255,70,80,90,255])
        for kind in range(5):
            filtered=[]
            for i,value in enumerate(pixels):
                a=pixels[i-4] if i>=4 else 0
                prediction=a if kind in (1,4) else a//2 if kind==3 else 0
                filtered.append((value-prediction)&255)
            header=struct.pack('>IIBBBBB',2,1,8,6,0,0,0)
            data=png.SIGNATURE+png.chunk(b'IHDR',header)+png.chunk(b'IDAT',zlib.compress(bytes([kind])+bytes(filtered)))+png.chunk(b'IEND',b'')
            self.assertEqual(png.decode(png.normalize_png(data))[2],[bytes([10,20,30,70,80,90])])

if __name__=='__main__':unittest.main()
