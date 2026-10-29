"""Shared asset paths and dependency-free image integrity checks."""

import hashlib
import json
import struct
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'data' / 'assets-manifest.json'
FIELDS = ('缩略图', '大图', '原图')


def asset_paths():
    records = json.loads((ROOT / 'data' / 'costume-zh.json').read_text(encoding='utf-8'))
    paths = []
    for record in records:
        for field in FIELDS:
            value = record[field]
            path = PurePosixPath(value)
            if path.is_absolute() or '..' in path.parts or path.parts[0] not in ('thumbs', 'img', 'png'):
                raise ValueError(f'Invalid asset path: {value}')
            paths.append(value)
    if len(paths) != len(set(paths)):
        raise ValueError('The dataset contains duplicate asset paths')
    return sorted(paths)


def inspect_image(path):
    """Check signatures, encoded length/end marker, dimensions, and SHA-256."""
    content = path.read_bytes()
    size = len(content)
    if path.suffix == '.png':
        if size < 45 or content[:8] != bytes((137, 80, 78, 71, 13, 10, 26, 10)):
            raise ValueError(f'Invalid PNG: {path.name}')
        if content[-12:] != bytes((0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130)):
            raise ValueError(f'Incomplete PNG: {path.name}')
        width, height = struct.unpack('>II', content[16:24])
    else:
        if size < 30 or content[:4] != b'RIFF' or content[8:12] != b'WEBP':
            raise ValueError(f'Invalid WebP: {path.name}')
        if struct.unpack('<I', content[4:8])[0] + 8 != size:
            raise ValueError(f'Incomplete WebP: {path.name}')
        encoding = content[12:16]
        if encoding == b'VP8X':
            width = int.from_bytes(content[24:27], 'little') + 1
            height = int.from_bytes(content[27:30], 'little') + 1
        elif encoding == b'VP8 ' and content[23:26] == bytes((157, 1, 42)):
            width, height = (value & 16383 for value in struct.unpack('<HH', content[26:30]))
        elif encoding == b'VP8L' and content[20] == 47:
            bits = int.from_bytes(content[21:25], 'little')
            width, height = (bits & 16383) + 1, ((bits >> 14) & 16383) + 1
        else:
            raise ValueError(f'Unsupported WebP header: {path.name}')
    if width < 1 or height < 1:
        raise ValueError(f'Invalid image dimensions: {path.name}')
    return {'bytes': size, 'width': width, 'height': height, 'sha256': hashlib.sha256(content).hexdigest()}
