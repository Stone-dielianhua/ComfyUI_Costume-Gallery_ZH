"""Image and bilingual keyword outputs; no inference models required."""

from __future__ import annotations

import json

import numpy as np
import torch
from PIL import Image, ImageOps

from .gallery import DEFAULT_ID, MAX_BATCH_PIXELS, SOURCES, GalleryError, batch_items, catalogue, source_key

RESIZE_MODES = ["原始尺寸", "等比留边", "居中裁剪", "拉伸"]


def image_inputs(batch=False):
    return {
        "asset_source": (list(SOURCES), {"default": SOURCES[0], "tooltip": "默认读取插件所在目录的素材；自定义目录在图库的素材设置中配置。"}),
        "resize_mode": (RESIZE_MODES, {"default": "等比留边" if batch else "原始尺寸"}),
        "width": ("INT", {"default": 768, "min": 64, "max": 4096, "step": 8}),
        "height": ("INT", {"default": 1152, "min": 64, "max": 4096, "step": 8}),
        "flip_horizontal": ("BOOLEAN", {"default": False, "label_on": "翻转", "label_off": "不翻转"}),
    }


def load_image(cat, item, resize_mode, width, height, flip_horizontal):
    if resize_mode not in RESIZE_MODES:
        raise GalleryError("未知图片尺寸处理方式。")
    if not isinstance(width, int) or not isinstance(height, int) or not 64 <= width <= 4096 or not 64 <= height <= 4096:
        raise GalleryError("输出宽高须为 64 至 4096 之间的整数。")
    try:
        with Image.open(cat.path(item)) as opened:
            if opened.width * opened.height > MAX_BATCH_PIXELS:
                raise GalleryError("单张原图超过3200万像素，请先缩小原图。")
            image = ImageOps.exif_transpose(opened).convert("RGBA")
            background = Image.new("RGBA", image.size, "white")
            background.alpha_composite(image)
            image = background.convert("RGB")
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        if isinstance(exc, GalleryError):
            raise
        raise GalleryError(f"图片无法读取或已损坏：{item['id']}") from exc
    if flip_horizontal:
        image = ImageOps.mirror(image)
    size = (width, height)
    if resize_mode == "等比留边":
        image = ImageOps.pad(image, size, method=Image.Resampling.LANCZOS, color="white")
    elif resize_mode == "居中裁剪":
        image = ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)
    elif resize_mode == "拉伸":
        image = image.resize(size, Image.Resampling.LANCZOS)
    return torch.from_numpy(np.asarray(image, dtype=np.float32) / 255.0)


class CostumeGalleryImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "costume_id": ("STRING", {"default": DEFAULT_ID, "tooltip": "点击「打开服装图库」选择服装，无需手动输入。"}),
            **image_inputs(),
        }}

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("图片", "服装ID", "英文关键词", "中文说明")
    FUNCTION = "execute"
    CATEGORY = "ComfyUI_Costume-Gallery_ZH/服装图库"
    DESCRIPTION = "从本地服装图库输出参考图和原始中英文关键词。可用于服装参考、图像编辑和提示词辅助；不执行自动换装。"

    def execute(self, costume_id=DEFAULT_ID, asset_source=SOURCES[0], resize_mode="原始尺寸",
                width=768, height=1152, flip_horizontal=False):
        cat = catalogue(asset_source)
        item = cat.item(costume_id)
        image = load_image(cat, item, resize_mode, width, height, flip_horizontal)
        return image.unsqueeze(0), item["id"], item["关键词"], item["关键词中文"]

    @classmethod
    def IS_CHANGED(cls, costume_id=DEFAULT_ID, asset_source=SOURCES[0], **kwargs):
        cat = catalogue(asset_source)
        return cat.fingerprint([cat.item(costume_id)])


class CostumeGalleryBatch:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "costume_ids": ("STRING", {"multiline": True, "default": DEFAULT_ID, "tooltip": "在图库中勾选后发送到此节点，最多32张。支持换行、空格和中英文逗号或分号。"}),
            "order": (["选择顺序", "编号顺序", "分类顺序"],),
            **image_inputs(batch=True),
        }}

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("图片批次", "信息清单JSON")
    FUNCTION = "execute"
    CATEGORY = "ComfyUI_Costume-Gallery_ZH/服装图库"
    DESCRIPTION = "按选择顺序批量输出服装参考图和对应的中英文关键词清单。默认等比留边，最多32张，总像素最多3200万。"

    def execute(self, costume_ids=DEFAULT_ID, order="选择顺序", asset_source=SOURCES[0],
                resize_mode="等比留边", width=768, height=1152, flip_horizontal=False):
        cat = catalogue(asset_source)
        items = batch_items(cat, costume_ids, order)
        if resize_mode != "原始尺寸" and len(items) * width * height > MAX_BATCH_PIXELS:
            raise GalleryError("单批图片总像素超过3200万，请减少图片数量或输出尺寸。")
        images, records = [], []
        shape, total_pixels = None, 0
        for index, item in enumerate(items):
            if resize_mode == "原始尺寸":
                try:
                    with Image.open(cat.path(item)) as probe:
                        pixels = probe.width * probe.height
                except (OSError, ValueError, Image.DecompressionBombError) as exc:
                    raise GalleryError(f"图片无法读取或已损坏：{item['id']}") from exc
                if total_pixels + pixels > MAX_BATCH_PIXELS:
                    raise GalleryError("单批图片总像素超过3200万，请减少图片数量或输出尺寸。")
            image = load_image(cat, item, resize_mode, width, height, flip_horizontal)
            if shape is not None and tuple(image.shape) != shape:
                raise GalleryError("原始图片尺寸不一致，请改用等比留边、居中裁剪或拉伸来统一尺寸。")
            shape = tuple(image.shape)
            total_pixels += shape[0] * shape[1]
            if total_pixels > MAX_BATCH_PIXELS:
                raise GalleryError("单批图片总像素超过3200万，请减少图片数量或输出尺寸。")
            images.append(image)
            records.append({"index": index, "id": item["id"], "分类": item["分类"],
                            "关键词": item["关键词"], "关键词中文": item["关键词中文"], "标签": item["标签"],
                            "asset_source": source_key(asset_source), "width": shape[1], "height": shape[0],
                            "resize_mode": resize_mode, "flip_horizontal": flip_horizontal})
        return torch.stack(images), json.dumps(records, ensure_ascii=False, indent=2)

    @classmethod
    def IS_CHANGED(cls, costume_ids=DEFAULT_ID, order="选择顺序", asset_source=SOURCES[0], **kwargs):
        cat = catalogue(asset_source)
        return cat.fingerprint(batch_items(cat, costume_ids, order))


NODE_CLASS_MAPPINGS = {"CostumeGalleryImage": CostumeGalleryImage, "CostumeGalleryBatch": CostumeGalleryBatch}
NODE_DISPLAY_NAME_MAPPINGS = {"CostumeGalleryImage": "服装图库 · 单图", "CostumeGalleryBatch": "服装图库 · 批量"}
