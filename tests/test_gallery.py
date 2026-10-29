import importlib
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
package = types.ModuleType("costume_gallery_test")
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
gallery = importlib.import_module("costume_gallery_test.gallery")
nodes = importlib.import_module("costume_gallery_test.nodes")


def make_library(root):
    (root / "data").mkdir()
    rows = []
    for index, size in enumerate([(80, 120), (100, 80)]):
        pixels = np.zeros((size[1], size[0], 4), dtype=np.uint8)
        pixels[:, :size[0] // 2] = [255, 0, 0, 255]
        pixels[:, size[0] // 2:] = [0, 0, 255, 128]
        Image.fromarray(pixels).save(root / f"{index}.png")
        rows.append({"id": f"c{index}", "分类": "春季" if index == 0 else "夏季",
                     "关键词": "red blue dress", "关键词中文": "红色 · 蓝色 · 连衣裙",
                     "标签": ["红色", "蓝色", "连衣裙"], "原图": f"{index}.png",
                     "缩略图": "missing.webp"})
    (root / "data/costume-zh.json").write_text(json.dumps(rows), encoding="utf-8")
    return rows


class CostumeGalleryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.rows = make_library(self.root)
        self.config = patch.object(gallery, "config_path", return_value=self.root / "settings.json")
        self.config.start()
        gallery.save_settings(str(self.root))

    def tearDown(self):
        self.config.stop()
        self.temp.cleanup()

    def test_full_bundled_library(self):
        cat = gallery.catalogue()
        self.assertEqual(len(cat.items), 1407)
        self.assertEqual(len(cat.categories), 8)
        for item in cat.items:
            self.assertTrue(cat.path(item).is_file())
            self.assertTrue(cat.path(item, thumbnail=True).is_file())

    def test_single_outputs_original_keywords(self):
        image, ident, english, chinese = nodes.CostumeGalleryImage().execute("c0", "自定义素材库")
        self.assertEqual(tuple(image.shape), (1, 120, 80, 3))
        self.assertEqual((ident, english, chinese), ("c0", self.rows[0]["关键词"], self.rows[0]["关键词中文"]))
        self.assertAlmostEqual(image[0, 0, -1, 0].item(), 127 / 255, places=5)
        self.assertEqual(image.dtype, nodes.torch.float32)

    def test_flip_and_resize_modes(self):
        node = nodes.CostumeGalleryImage()
        original = node.execute("c0", "custom")[0]
        flipped = node.execute("c0", "custom", flip_horizontal=True)[0]
        self.assertTrue(nodes.torch.equal(flipped, original.flip(2)))
        for mode in nodes.RESIZE_MODES[1:]:
            image = node.execute("c0", "custom", mode, 128, 64)[0]
            self.assertEqual(tuple(image.shape), (1, 64, 128, 3))
            self.assertTrue(bool((image >= 0).all() and (image <= 1).all()))
        padded = node.execute("c0", "custom", "等比留边", 128, 64)[0]
        self.assertTrue(bool((padded[0, :, 0] == 1).all()))

    def test_batch_order_and_metadata_correspond(self):
        image, raw = nodes.CostumeGalleryBatch().execute("c1，c0\nc1", asset_source="custom", width=64, height=80)
        records = json.loads(raw)
        self.assertEqual(tuple(image.shape), (2, 80, 64, 3))
        self.assertEqual([r["id"] for r in records], ["c1", "c0"])
        self.assertEqual([r["index"] for r in records], [0, 1])
        for i, record in enumerate(records):
            expected = nodes.CostumeGalleryImage().execute(record["id"], "custom", "等比留边", 64, 80)[0][0]
            self.assertTrue(nodes.torch.equal(image[i], expected))
            self.assertEqual(record["关键词"], self.rows[0]["关键词"])
        cat = gallery.catalogue("custom")
        self.assertEqual([r["id"] for r in gallery.batch_items(cat, "c1 c0", "分类顺序")], ["c0", "c1"])
        self.assertEqual([r["id"] for r in gallery.batch_items(cat, "c1 c0", "编号顺序")], ["c0", "c1"])

    def test_batch_rejects_incompatible_sizes_and_limits(self):
        node = nodes.CostumeGalleryBatch()
        with self.assertRaisesRegex(gallery.GalleryError, "尺寸不一致"):
            node.execute("c0 c1", asset_source="custom", resize_mode="原始尺寸")
        with self.assertRaisesRegex(gallery.GalleryError, "3200万"):
            node.execute("c0 c1", asset_source="custom", width=4096, height=4096)
        with self.assertRaisesRegex(gallery.GalleryError, "32"):
            gallery.parse_ids(" ".join(f"c{i}" for i in range(33)))
        with self.assertRaises(gallery.GalleryError):
            gallery.parse_ids(" ")

    def test_missing_assets_and_safe_paths(self):
        for value in ["../secret.png", "/secret.png", "C:/secret.png", "png\\secret.png", "data/costume-zh.json"]:
            with self.subTest(value=value), self.assertRaises(gallery.GalleryError):
                gallery.safe_image_path(self.root, value)
        cat = gallery.catalogue("custom")
        self.assertEqual(cat.path(cat.items[0], thumbnail=True), self.root / "0.png")
        (self.root / "0.png").unlink()
        with self.assertRaisesRegex(gallery.GalleryError, "缺失"):
            nodes.CostumeGalleryImage().execute("c0", "custom")

    def test_settings_preserve_last_valid_directory(self):
        for value in ["relative", str(self.root / "missing"), None]:
            with self.assertRaises(gallery.GalleryError):
                gallery.save_settings(value)
        self.assertEqual(gallery.read_settings()["custom_directory"], str(self.root.resolve()))
        gallery.save_settings("")
        with self.assertRaisesRegex(gallery.GalleryError, "尚未设置"):
            gallery.catalogue("custom")

    def test_cache_invalidation_on_catalogue_and_image(self):
        cat = gallery.catalogue("custom")
        before = cat.fingerprint(cat.items)
        Image.new("RGB", (64, 64), "green").save(self.root / "0.png")
        self.assertNotEqual(before, cat.fingerprint(cat.items))
        self.rows[0]["关键词"] = "updated dress"
        (self.root / "data/costume-zh.json").write_text(json.dumps(self.rows), encoding="utf-8")
        updated = gallery.catalogue("custom")
        self.assertIsNot(updated, cat)
        self.assertEqual(updated.items[0]["关键词"], "updated dress")


if __name__ == "__main__":
    unittest.main()
