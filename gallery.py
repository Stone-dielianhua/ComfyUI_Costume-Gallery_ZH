"""Validated costume catalogue shared by ComfyUI nodes and gallery routes."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCES = ("内置素材库", "自定义素材库")
SOURCE_KEYS = {SOURCES[0]: "builtin", SOURCES[1]: "custom",
               "builtin": "builtin", "custom": "custom"}
DEFAULT_ID = "SPR-0001"
MAX_BATCH = 32
MAX_BATCH_PIXELS = 32_000_000
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


class GalleryError(ValueError):
    """An actionable error suitable for the gallery UI."""


def config_path() -> Path:
    try:
        import folder_paths
        return Path(folder_paths.get_user_directory()) / "costume_gallery" / "settings.json"
    except (ImportError, AttributeError):
        return ROOT / ".costume-gallery.settings.json"


def read_settings() -> dict:
    path = config_path()
    if not path.is_file():
        return {"custom_directory": ""}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        directory = data.get("custom_directory", "")
        if not isinstance(directory, str):
            raise ValueError("目录须为文本")
        return {"custom_directory": directory}
    except (OSError, ValueError, AttributeError) as exc:
        raise GalleryError("无法读取服装图库设置，请检查 ComfyUI 用户目录中的 costume_gallery/settings.json。") from exc


def save_settings(directory: str) -> dict:
    if not isinstance(directory, str):
        raise GalleryError("自定义素材目录须为文本。")
    directory = directory.strip()
    if directory:
        root = Path(directory).expanduser()
        if not root.is_absolute():
            raise GalleryError("请填写 ComfyUI 所在电脑上的绝对路径。")
        root = root.resolve()
        cat = catalogue_at(root)
        for item in cat.items:
            cat.path(item)
        directory = str(root)
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    settings = {"custom_directory": directory}
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix="costume-gallery-", suffix=".tmp", delete=False) as stream:
            temporary = stream.name
            json.dump(settings, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return settings


def source_key(source: str) -> str:
    try:
        return SOURCE_KEYS[source]
    except (KeyError, TypeError) as exc:
        raise GalleryError("未知素材库，请选择内置素材库或自定义素材库。") from exc


def asset_root(source: str) -> Path:
    if source_key(source) == "builtin":
        return ROOT
    directory = read_settings()["custom_directory"]
    if not directory:
        raise GalleryError("尚未设置自定义素材目录，请在服装图库的「素材设置」中填写目录。")
    return Path(directory).resolve()


def safe_image_path(root: Path, value: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise GalleryError("素材路径不能为空。")
    if "\\" in value or value.startswith("/") or re.match(r"^[a-zA-Z]:", value):
        raise GalleryError(f"素材须使用库内的相对路径：{value}")
    path = (root / value).resolve()
    if not path.is_relative_to(root.resolve()) or path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise GalleryError(f"素材路径不合法：{value}")
    return path


class Catalogue:
    def __init__(self, root: Path, signature: tuple):
        self.root = root.resolve()
        self.signature = signature
        try:
            rows = json.loads((self.root / "data" / "costume-zh.json").read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as exc:
            raise GalleryError("无法读取 data/costume-zh.json，请检查素材目录结构和 JSON 格式。") from exc
        if not isinstance(rows, list) or not rows:
            raise GalleryError("data/costume-zh.json 须为非空的图片记录数组。")
        self.items, self.by_id = [], {}
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise GalleryError(f"第 {index + 1} 条素材须为对象。")
            required = ("id", "分类", "关键词", "关键词中文", "原图")
            for key in required:
                if not isinstance(row.get(key), str) or not row[key].strip():
                    raise GalleryError(f"第 {index + 1} 条素材缺少文本字段：{key}")
            if row["id"] in self.by_id:
                raise GalleryError(f"素材 ID 重复：{row['id']}")
            tags = row.get("标签", [word.strip() for word in row["关键词中文"].split("·") if word.strip()])
            if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
                raise GalleryError(f"第 {index + 1} 条素材的标签须为文本数组。")
            item = {key: row[key] for key in required}
            item.update({"标签": tags, "缩略图": row.get("缩略图") or item["原图"],
                         "大图": row.get("大图") or item["原图"]})
            for key in ("原图", "缩略图", "大图"):
                safe_image_path(self.root, item[key])
            item["检索"] = " ".join([item["id"], item["分类"], item["关键词"], item["关键词中文"], *tags]).lower()
            self.items.append(item)
            self.by_id[item["id"]] = item
        self.categories = list(dict.fromkeys(item["分类"] for item in self.items))
        self.aliases = {}
        meta_path = self.root / "data" / "meta-zh.json"
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8-sig"))
                aliases = meta.get("同义词", {})
                if not isinstance(aliases, dict) or not all(
                    isinstance(key, str) and isinstance(values, list)
                    and all(isinstance(value, str) for value in values) for key, values in aliases.items()
                ):
                    raise ValueError("同义词须为文本数组映射")
                self.aliases = aliases
            except (OSError, ValueError, AttributeError) as exc:
                raise GalleryError("无法读取 data/meta-zh.json 中的同义词。") from exc

    def item(self, costume_id: str) -> dict:
        try:
            return self.by_id[costume_id]
        except (KeyError, TypeError) as exc:
            raise GalleryError(f"素材库中找不到服装 ID「{costume_id}」。请重新选图或检查所选素材库。") from exc

    def path(self, item: dict, thumbnail: bool = False, preview: bool = False) -> Path:
        key = "缩略图" if thumbnail else "大图" if preview else "原图"
        path = safe_image_path(self.root, item[key])
        if key != "原图" and not path.is_file():
            path = safe_image_path(self.root, item["原图"])
        if not path.is_file():
            raise GalleryError(f"图片文件缺失：{path.name}。请检查素材是否完整。")
        return path

    def fingerprint(self, items: list[dict]) -> str:
        parts = [str(self.root), repr(self.signature)]
        for item in items:
            stat = self.path(item).stat()
            parts.extend((item["id"], str(stat.st_mtime_ns), str(stat.st_size)))
        return hashlib.sha256("|".join(parts).encode()).hexdigest()


@lru_cache(maxsize=8)
def _catalogue_cached(root: str, signature: tuple) -> Catalogue:
    return Catalogue(Path(root), signature)


def catalogue_at(root: Path) -> Catalogue:
    root = root.resolve()
    try:
        stat = (root / "data" / "costume-zh.json").stat()
        meta = root / "data" / "meta-zh.json"
        meta_stat = meta.stat() if meta.is_file() else None
    except OSError as exc:
        raise GalleryError("素材目录中找不到 data/costume-zh.json。请填写包含 data 和清单所引用图片的目录。") from exc
    signature = (stat.st_mtime_ns, stat.st_size,
                 (meta_stat.st_mtime_ns, meta_stat.st_size) if meta_stat else None)
    return _catalogue_cached(str(root), signature)


def catalogue(source: str = "builtin") -> Catalogue:
    return catalogue_at(asset_root(source))


def parse_ids(value: str) -> list[str]:
    if not isinstance(value, str):
        raise GalleryError("服装 ID 清单须为文本。")
    ids = list(dict.fromkeys(part for part in re.split(r"[\s,，;；]+", value.strip()) if part))
    if not ids:
        raise GalleryError("请先在图库中选择至少一张图片。")
    if len(ids) > MAX_BATCH:
        raise GalleryError(f"单批最多 {MAX_BATCH} 张，请减少所选图片。")
    return ids


def batch_items(cat: Catalogue, costume_ids: str, order: str) -> list[dict]:
    items = [cat.item(value) for value in parse_ids(costume_ids)]
    if order == "编号顺序":
        items.sort(key=lambda item: item["id"])
    elif order == "分类顺序":
        ranks = {value: index for index, value in enumerate(cat.categories)}
        items.sort(key=lambda item: (ranks[item["分类"]], item["id"]))
    elif order != "选择顺序":
        raise GalleryError("未知图片排列方式。")
    return items
