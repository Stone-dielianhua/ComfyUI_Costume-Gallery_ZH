"""Serve catalogue and local images through ComfyUI's existing HTTP service."""

import asyncio
from urllib.parse import urlsplit

from aiohttp import web

from .gallery import GalleryError, catalogue, read_settings, save_settings, source_key


def register_routes():
    from server import PromptServer

    routes = PromptServer.instance.routes

    @routes.get("/costume_gallery/catalogue")
    async def get_catalogue(request):
        try:
            source = source_key(request.query.get("source", "builtin"))
            cat = await asyncio.to_thread(catalogue, source)
            return web.json_response({"source": source, "items": cat.items, "count": len(cat.items),
                                      "categories": cat.categories, "aliases": cat.aliases},
                                     headers={"Cache-Control": "no-cache"})
        except (GalleryError, OSError) as exc:
            return web.json_response({"error": str(exc)}, status=400)

    @routes.get("/costume_gallery/image")
    async def get_image(request):
        try:
            def resolve():
                cat = catalogue(request.query.get("source", "builtin"))
                return cat.path(cat.item(request.query.get("id", "")),
                                thumbnail=request.query.get("kind") == "thumb",
                                preview=request.query.get("kind") == "preview")
            path = await asyncio.to_thread(resolve)
            return web.FileResponse(path, headers={"Cache-Control": "no-cache",
                                                   "X-Content-Type-Options": "nosniff"})
        except (GalleryError, OSError) as exc:
            return web.json_response({"error": str(exc)}, status=404)

    @routes.get("/costume_gallery/settings")
    async def get_settings(request):
        try:
            return web.json_response(await asyncio.to_thread(read_settings),
                                     headers={"Cache-Control": "no-store"})
        except (GalleryError, OSError) as exc:
            return web.json_response({"error": str(exc)}, status=400)

    @routes.post("/costume_gallery/settings")
    async def put_settings(request):
        origin = request.headers.get("Origin")
        if origin and urlsplit(origin).netloc != request.host:
            return web.json_response({"error": "素材设置仅接受同站请求。"}, status=403)
        if request.content_type != "application/json":
            return web.json_response({"error": "请使用 JSON 保存素材设置。"}, status=415)
        try:
            data = await request.json()
            if not isinstance(data, dict) or "custom_directory" not in data:
                raise GalleryError("请提交自定义素材目录。")
            result = await asyncio.to_thread(save_settings, data["custom_directory"])
            return web.json_response(result, headers={"Cache-Control": "no-store"})
        except (ValueError, OSError) as exc:
            return web.json_response({"error": str(exc)}, status=400)
