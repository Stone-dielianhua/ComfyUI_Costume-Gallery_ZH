import importlib
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from test_gallery import gallery, make_library


class GalleryRoutes(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.library = self.root / "library"
        self.library.mkdir()
        make_library(self.library)
        self.config = patch.object(gallery, "config_path", return_value=self.root / "settings.json")
        self.config.start()
        routes = web.RouteTableDef()
        server = types.ModuleType("server")
        server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes))
        with patch.dict(sys.modules, {"server": server}):
            importlib.import_module("costume_gallery_test.routes").register_routes()
        app = web.Application()
        app.add_routes(routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.config.stop()
        self.temp.cleanup()

    async def test_bundled_catalogue_and_all_image_variants(self):
        response = await self.client.get("/costume_gallery/catalogue")
        data = await response.json()
        self.assertEqual(response.status, 200)
        self.assertEqual(data["count"], 1407)
        self.assertEqual(len(data["categories"]), 8)
        for kind, magic in [("thumb", b"RIFF"), ("preview", b"RIFF"), ("original", b"\x89PNG")]:
            response = await self.client.get(f"/costume_gallery/image?id=SPR-0001&kind={kind}")
            self.assertEqual(response.status, 200)
            self.assertTrue((await response.read()).startswith(magic))

    async def test_custom_settings_and_thumbnail_fallback(self):
        response = await self.client.post("/costume_gallery/settings", json={"custom_directory": str(self.library)})
        self.assertEqual(response.status, 200)
        response = await self.client.get("/costume_gallery/catalogue?source=custom")
        self.assertEqual((await response.json())["count"], 2)
        response = await self.client.get("/costume_gallery/image?source=custom&id=c0&kind=thumb")
        self.assertTrue((await response.read()).startswith(b"\x89PNG"))
        response = await self.client.post("/costume_gallery/settings", json={"custom_directory": "relative"})
        self.assertEqual(response.status, 400)
        response = await self.client.get("/costume_gallery/settings")
        self.assertEqual((await response.json())["custom_directory"], str(self.library.resolve()))

    async def test_invalid_requests_and_cross_origin(self):
        for path, status in [("/catalogue?source=unknown", 400), ("/image?id=../../secret", 404)]:
            response = await self.client.get("/costume_gallery" + path)
            self.assertEqual(response.status, status)
        response = await self.client.post("/costume_gallery/settings", json={}, headers={"Origin": "https://unrelated.example"})
        self.assertEqual(response.status, 403)
        response = await self.client.post("/costume_gallery/settings", data="{}")
        self.assertEqual(response.status, 415)
        for body in [[], {}, {"custom_directory": 123}]:
            response = await self.client.post("/costume_gallery/settings", json=body)
            self.assertEqual(response.status, 400)
        response = await self.client.post("/costume_gallery/settings", data="{broken", headers={"Content-Type": "application/json"})
        self.assertEqual(response.status, 400)
