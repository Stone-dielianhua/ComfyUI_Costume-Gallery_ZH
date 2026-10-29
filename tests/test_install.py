import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('costume_installer', Path(__file__).resolve().parents[1] / 'install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class AssetInstallationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'data').mkdir()
        self.images = {'png/test.png': b'original-image', 'thumbs/test.webp': b'thumbnail'}
        self.manifest = {'files': {name: {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
                                   for name, content in self.images.items()}}
        self.write_manifest()

    def write_manifest(self):
        (self.root / 'data/assets-manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')

    def archive(self, images=None):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            for name, content in (self.images if images is None else images).items():
                archive.writestr(name, content)
        return output.getvalue()

    def test_complete_installation_never_connects(self):
        for name, content in self.images.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        with patch.object(installer.urllib.request, 'urlopen') as request:
            installer.install_assets(self.root)
        request.assert_not_called()

    def test_download_restores_missing_and_corrupted_images(self):
        path = self.root / 'png/test.png'
        path.parent.mkdir()
        path.write_bytes(b'damaged')
        archive = self.archive()
        with patch.object(installer, 'ASSET_SHA256', hashlib.sha256(archive).hexdigest()), \
                patch.object(installer.urllib.request, 'urlopen', return_value=io.BytesIO(archive)):
            installer.install_assets(self.root)
        for name, content in self.images.items():
            self.assertEqual((self.root / name).read_bytes(), content)
        self.assertFalse(list(self.root.glob('costume-gallery-*')))

    def test_failed_download_checksum_writes_no_images(self):
        with patch.object(installer.urllib.request, 'urlopen', return_value=io.BytesIO(self.archive())):
            with self.assertRaisesRegex(ValueError, 'download checksum mismatch'):
                installer.install_assets(self.root)
        self.assertFalse((self.root / 'png').exists())
        self.assertFalse(list(self.root.glob('costume-gallery-*')))

    def test_manifest_path_cannot_escape_plugin(self):
        self.manifest['files']['../outside.png'] = self.manifest['files']['png/test.png']
        self.write_manifest()
        with patch.object(installer.urllib.request, 'urlopen') as request:
            with self.assertRaisesRegex(ValueError, 'Invalid asset path'):
                installer.install_assets(self.root)
        request.assert_not_called()

    def test_archive_with_unlisted_files_is_rejected(self):
        archive = self.archive({**self.images, '../outside.py': b'unlisted'})
        with patch.object(installer, 'ASSET_SHA256', hashlib.sha256(archive).hexdigest()), \
                patch.object(installer.urllib.request, 'urlopen', return_value=io.BytesIO(archive)):
            with self.assertRaisesRegex(ValueError, 'does not match'):
                installer.install_assets(self.root)
        self.assertFalse((self.root / 'png').exists())


if __name__ == '__main__':
    unittest.main()
