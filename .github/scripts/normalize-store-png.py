#!/usr/bin/env python3
"""Losslessly encode fully opaque native PNG screenshots as RGB for Apple."""
import struct
import sys
import zlib
from pathlib import Path

SIGNATURE = b'\x89PNG\r\n\x1a\n'


def chunks(data):
    if not data.startswith(SIGNATURE):
        raise ValueError('Not a PNG')
    offset = 8
    result = []
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError('Truncated PNG')
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + size
        if end > len(data):
            raise ValueError('Truncated PNG chunk')
        payload = data[offset + 8:offset + 8 + size]
        crc = struct.unpack('>I', data[end - 4:end])[0]
        if zlib.crc32(kind + payload) & 0xffffffff != crc:
            raise ValueError('Invalid PNG checksum')
        result.append((kind, payload))
        offset = end
        if kind == b'IEND':
            if offset != len(data):
                raise ValueError('Data after PNG end')
            break
    if not result or result[0][0] != b'IHDR' or result[-1] != (b'IEND', b''):
        raise ValueError('Invalid PNG structure')
    return result


def decode(data):
    parts = chunks(data)
    if len(parts[0][1]) != 13:
        raise ValueError('Invalid PNG header')
    w, h, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', parts[0][1])
    if not (0 < w <= 5000 and 0 < h <= 5000 and depth == 8 and color in (2, 6) and compression == filtering == interlace == 0):
        raise ValueError('Unsupported native PNG format')
    channels = 4 if color == 6 else 3
    stride = w * channels
    compressed = b''.join(p for k, p in parts if k == b'IDAT')
    expected = h * (stride + 1)
    inflater = zlib.decompressobj()
    raw = inflater.decompress(compressed, expected + 1)
    if len(raw) != expected or not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
        raise ValueError('Invalid PNG pixel stream')
    rows = []
    prior = bytearray(stride)
    for y in range(h):
        position = y * (stride + 1)
        kind = raw[position]
        row = bytearray(raw[position + 1:position + 1 + stride])
        if kind not in range(5):
            raise ValueError('Unsupported PNG filter')
        for i in range(stride):
            a = row[i - channels] if i >= channels else 0
            b = prior[i]
            c = prior[i - channels] if i >= channels else 0
            if kind == 1:
                prediction = a
            elif kind == 2:
                prediction = b
            elif kind == 3:
                prediction = (a + b) // 2
            elif kind == 4:
                estimate = a + b - c
                da, db, dc = abs(estimate - a), abs(estimate - b), abs(estimate - c)
                prediction = a if da <= db and da <= dc else b if db <= dc else c
            else:
                prediction = 0
            row[i] = (row[i] + prediction) & 255
        if color == 6:
            if any(alpha != 255 for alpha in row[3::4]):
                raise ValueError('Screenshot contains transparency; preserve for review')
            rgb = bytearray()
            for x in range(0, stride, 4):
                rgb.extend(row[x:x + 3])
            rows.append(bytes(rgb))
        else:
            rows.append(bytes(row))
        prior = row
    return w, h, rows, parts


def chunk(kind, payload):
    return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)


def normalize_png(data):
    w, h, rows, parts = decode(data)
    if any(k in (b'tRNS', b'CgBI', b'acTL', b'fcTL', b'fdAT') for k, _ in parts):
        raise ValueError('Unexpected transparency, Apple optimization, or animation')
    allowed = {b'IHDR', b'IDAT', b'IEND', b'sRGB', b'iCCP', b'gAMA', b'cHRM', b'cICP', b'pHYs', b'tEXt', b'iTXt', b'zTXt', b'eXIf', b'bKGD', b'sBIT'}
    if any(k not in allowed for k, _ in parts):
        raise ValueError('Unexpected PNG metadata; preserve for review')
    # Preserve color profiles and other native metadata. sBIT changes from four
    # channels to three; the alpha channel was independently verified opaque.
    metadata = []
    for kind, payload in parts[1:-1]:
        if kind == b'IDAT':
            continue
        if kind == b'sBIT' and len(payload) == 4:
            payload = payload[:3]
        metadata.append(chunk(kind, payload))
    header = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    output = SIGNATURE + chunk(b'IHDR', header) + b''.join(metadata) + chunk(b'IDAT', zlib.compress(b''.join(b'\x00' + row for row in rows), 9)) + chunk(b'IEND', b'')
    ow, oh, verified, _ = decode(output)
    if (ow, oh, verified) != (w, h, rows):
        raise ValueError('Pixel identity verification failed')
    return output


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: normalize-store-png.py INPUT.png OUTPUT.png')
    source, target = map(Path, sys.argv[1:])
    output = normalize_png(source.read_bytes())
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(output)
