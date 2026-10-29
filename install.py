"""Install the original images when Manager installs the smaller Registry package."""

import hashlib
import json
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent
ASSET_URL = 'https://github.com/Stone-dielianhua/ComfyUI_Costume-Gallery_ZH/releases/download/v1.0.0/costume-assets-v1.0.0.zip'
ASSET_SHA256 = 'db1e494f36b18253f2fddb7baa9453afb565ff591352a4160c230e2ae78c69b5'


def install_assets(root):
    root = Path(root).resolve()
    manifest = json.loads((root / 'data' / 'assets-manifest.json').read_text(encoding='utf-8'))
    missing = []
    for name, details in manifest['files'].items():
        relative = PurePosixPath(name)
        target = (root / name).resolve()
        if (relative.is_absolute() or '\\' in name or '..' in relative.parts
                or relative.parts[0] not in ('png', 'img', 'thumbs')
                or not target.is_relative_to(root)):
            raise ValueError(f'Invalid asset path: {name}')
        if (not target.is_file() or target.stat().st_size != details['bytes']
                or hashlib.sha256(target.read_bytes()).hexdigest() != details['sha256']):
            missing.append(name)
    if not missing:
        print('Costume gallery assets are already complete; no download needed.')
        return

    print('Downloading original costume gallery assets (about 1.42 GiB)...', flush=True)
    with tempfile.TemporaryDirectory(prefix='costume-gallery-', dir=root) as temporary:
        archive_path = Path(temporary) / 'assets.zip'
        digest = hashlib.sha256()
        downloaded = 0
        reported = 0
        request = urllib.request.Request(ASSET_URL, headers={'User-Agent': 'costume-gallery-installer'})
        with urllib.request.urlopen(request, timeout=120) as response, archive_path.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
                downloaded += len(chunk)
                if downloaded - reported >= 128 * 1024 * 1024:
                    print(f'Downloaded {downloaded // (1024 * 1024)} MiB.', flush=True)
                    reported = downloaded
        if digest.hexdigest() != ASSET_SHA256:
            raise ValueError('Asset download checksum mismatch; retry the installation.')

        with zipfile.ZipFile(archive_path) as archive:
            if set(archive.namelist()) != set(manifest['files']):
                raise ValueError('Asset archive does not match the bundled manifest.')
            for name in missing:
                content = archive.read(name)
                details = manifest['files'][name]
                if len(content) != details['bytes'] or hashlib.sha256(content).hexdigest() != details['sha256']:
                    raise ValueError(f'Asset checksum mismatch: {name}')
                target = (root / name).resolve()
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
    print(f'Installed {len(missing)} original images. Costume gallery is ready for offline use.')


if __name__ == '__main__':
    install_assets(ROOT)
