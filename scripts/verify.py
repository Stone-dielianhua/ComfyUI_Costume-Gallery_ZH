"""Verify every indexed image, size, dimensions and SHA-256 against the manifest."""

import json
from collections import Counter

from asset_utils import MANIFEST, ROOT, asset_paths, inspect_image


def main():
    paths = asset_paths()
    if not MANIFEST.exists():
        print('Missing data/assets-manifest.json; restore the complete ComfyUI_Costume-Gallery_ZH asset files.')
        raise SystemExit(1)
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    expected = manifest['files']
    errors = []
    if set(paths) != set(expected) or manifest['count'] != len(paths):
        errors.append('Manifest paths or count do not match the dataset')
    actual_paths = {path.relative_to(ROOT).as_posix() for directory in ('thumbs', 'img', 'png') for path in (ROOT / directory).rglob('*') if path.is_file()}
    if actual_paths != set(paths):
        errors.append(f'Unexpected or missing files: {sorted(actual_paths.symmetric_difference(paths))[:20]}')
    total = 0
    counts = Counter()
    for relative in paths:
        try:
            details = inspect_image(ROOT / relative)
            if details != expected.get(relative):
                errors.append(f'Manifest mismatch: {relative}')
            total += details['bytes']
            counts[relative.split('/')[0]] += 1
        except (OSError, ValueError) as error:
            errors.append(f'{relative}: {error}')
    if total != manifest['total_bytes']:
        errors.append('Total byte count does not match the manifest')
    if errors:
        print(chr(10).join(errors))
        raise SystemExit(1)
    print(json.dumps({'verified': len(paths), 'directories': counts, 'bytes': total, 'MiB': round(total / 1024 ** 2, 2)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
