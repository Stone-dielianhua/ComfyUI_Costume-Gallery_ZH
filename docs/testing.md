# ComfyUI_Costume-Gallery_ZH 测试

验证日期：2026-10-29。使用 ComfyUI 0.43.0、前端 1.57.6、Python 3.12.10、PyTorch 2.10.0、Pillow 11.0.0、aiohttp 3.12.13；真实浏览器为 Windows Chrome。

测试在独立的 CPU ComfyUI 实例上运行，仅加载服装与姿势图库，输入、输出、临时文件与用户设置放在忽略的 `.test-output/` 下。未重启或修改主服务工作流，也未加载生成模型。

## 已通过的验证

- **11 项 Python 测试：** 全部 1,407 条记录与原图 / 缩略图路径、单图中英文输出、RGB 数值与透明底、尺寸处理与翻转、批量顺序和元数据对应、混合尺寸与总像素限制、目录验证、缓存更新、图片接口与无效请求。
- **6 项前端逻辑测试：** 记录统计、中英文组合搜索与英文前缀、类型 / 颜色筛选、同义词、收藏 / 最近顺序、与姿势图库的存储隔离及损坏存储容错。
- **真实 ComfyUI 浏览器联调：** 侧栏双列与底部控件位置、筛选、收藏、切换侧栏保留选择、原图下载、指定已有节点换图保留连线与尺寸 / 翻转参数、受连线控制的输入拒绝覆盖、多选与已选检查、单图拒收多图、批量选择顺序、工作流保存恢复、自定义素材目录、与姿势图库同时加载及使用。
- **实际执行：** 保存恢复后的单图 + 两张批量图运行成功，读取返回 PNG，确认一张 128 × 160、两张 64 × 80，并检查英文关键词与元数据。随附两个 JSON 示例重新载入后均运行成功，分别产生一张和三张预览图。
- **素材完整性：** 插件使用自身文件夹内的索引与 4,221 张图片，素材清单、大小、尺寸和 SHA-256 校验全部通过。

界面截图为联调时拍摄的 [comfyui-preview.png](comfyui-preview.png)。本次测试覆盖参考图和关键词输出；后续换装或图像生成效果取决于所连接的模型和工作流。

## 复现

在 `ComfyUI_Costume-Gallery_ZH` 插件文件夹内执行。Python 需使用 ComfyUI 所用的环境；前端测试需先安装此插件项目的开发依赖。

```powershell
npm ci
python scripts/verify.py
python -m unittest discover -s tests -p 'test_*.py' -v
npm test
```

浏览器联调会清空目标实例当前工作流，应另开专用实例。先安装插件，建立 `.test-output/user`、`input`、`output`、`temp` 四个目录，然后用 ComfyUI 的 Python 从其核心目录启动：

```powershell
python main.py --cpu --listen 127.0.0.1 --port 8198 --disable-all-custom-nodes --whitelist-custom-nodes ComfyUI_Costume-Gallery_ZH ComfyUI_Pose-Gallery_ZH --user-directory <本项目绝对路径>/.test-output/user --input-directory <本项目绝对路径>/.test-output/input --output-directory <本项目绝对路径>/.test-output/output --temp-directory <本项目绝对路径>/.test-output/temp --disable-auto-launch
```

上述目录参数需替换为实际绝对路径，含空格时加引号；共存检查需要此前的姿势插件也已安装。在另一个 PowerShell 窗口回到本项目运行：

```powershell
$env:COSTUME_GALLERY_TEST_URL = 'http://127.0.0.1:8198'
npm run test:browser
```

默认使用 Windows Chrome；可用 `CHROME_PATH` 指定浏览器可执行文件。没有本机 Chrome 时可安装 Playwright Chromium。测试拒绝默认主服务端口 8188，失败截图与工作流快照保存在 `.test-output/`。
