// Uses a dedicated ComfyUI test instance; clears its graph and runs image previews.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.COSTUME_GALLERY_TEST_URL;
if (!base || new URL(base).port === '8188') throw new Error('Set COSTUME_GALLERY_TEST_URL to a dedicated test instance, e.g. port 8198.');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output');
fs.mkdirSync(output, {recursive:true});
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
    const browser = await chromium.launch({headless:true, ...(fs.existsSync(chrome) ? {executablePath:chrome} : {})});
    const page = await browser.newPage({viewport:{width:1450,height:1000},locale:'zh-CN',reducedMotion:'reduce'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(base);
        await page.waitForFunction(() => window.app?.graph && window.LiteGraph?.registered_node_types.CostumeGalleryBatch);
        await page.waitForTimeout(700);
        await page.keyboard.press('Escape');
        await page.evaluate(() => app.graph.clear());
        const tab = page.getByRole('button',{name:'ComfyUI_Costume-Gallery_ZH · 中文服装图库',exact:true});
        await tab.click();
        const side = page.locator('.cg-app').first();
        await side.locator('.cg-card').first().waitFor();
        assert.equal(await side.locator('.cg-card').count(),48);
        const bottom = await side.locator('.cg-bottom').boundingBox();
        assert.ok(bottom.y+bottom.height<=1001,'sidebar controls stay inside viewport');
        const boxes = await side.locator('.cg-card').evaluateAll(cards=>cards.slice(0,2).map(card=>card.getBoundingClientRect().toJSON()));
        assert.equal(boxes[0].y,boxes[1].y,'sidebar shows two columns');
        await side.locator('.cg-filters select').nth(0).selectOption('春季');
        await side.getByRole('searchbox').fill('SPR-0001 ivory');
        assert.equal(await side.locator('.cg-card').count(),1);
        await side.locator('.cg-favorite').click();
        await side.getByRole('button',{name:'♡ 收藏',exact:true}).click();
        assert.equal(await side.locator('.cg-card').count(),1);
        await side.getByRole('button',{name:'全部服装',exact:true}).click();
        await side.locator('.cg-check').check();
        await tab.click(); await tab.click();
        await side.locator('.cg-card').first().waitFor();
        assert.equal(await side.getByRole('searchbox').inputValue(),'SPR-0001 ivory');
        assert.match(await side.locator('.cg-selection-label').textContent(),/1 \/ 32/);
        await side.getByRole('button',{name:'清空',exact:true}).click();
        await side.locator('.cg-image-button').click();
        const viewer = page.locator('.cg-viewer');
        const downloadEvent = page.waitForEvent('download');
        await viewer.getByRole('link',{name:'下载原尺寸图片',exact:true}).click();
        assert.equal((await downloadEvent).suggestedFilename(),'SPR-0001.png');
        await viewer.getByRole('button',{name:'使用此服装',exact:true}).click();
        assert.equal(await page.evaluate(()=>app.graph._nodes.length),1);
        await page.evaluate(() => {
            const node = app.graph._nodes[0];
            for (const [name,value] of Object.entries({resize_mode:'等比留边',width:128,height:160,flip_horizontal:true})) node.widgets.find(w=>w.name===name).value=value;
            const preview = LiteGraph.createNode('PreviewImage'); preview.pos=[540,80]; app.graph.add(preview); node.connect(0,preview,0);
            const text = LiteGraph.createNode('PreviewAny'); text.pos=[540,460]; app.graph.add(text); node.connect(2,text,0);
            node.widgets.find(w=>w.name==='打开服装图库').callback();
        });
        const expanded = page.locator('.cg-expanded .cg-app');
        await expanded.locator('.cg-card').first().waitFor();
        assert.notEqual(await expanded.locator('.cg-target-row select').inputValue(),'');
        await expanded.getByRole('searchbox').fill('SPR-0002');
        await expanded.locator('.cg-image-button').click();
        await page.locator('.cg-viewer').getByRole('button',{name:'使用此服装',exact:true}).click();
        let saved=await page.evaluate(()=>app.graph.serialize());
        assert.equal(saved.nodes.length,3);
        assert.equal(saved.links.length,2);
        assert.deepEqual(saved.nodes[0].widgets_values.slice(0,6),['SPR-0002','内置素材库','等比留边',128,160,true]);
        const linkedSource = await page.evaluate(() => {
            const source=LiteGraph.createNode('PreviewAny'); app.graph.add(source);
            source.connect(0,app.graph._nodes[0],0); return source.id;
        });
        await expanded.locator('.cg-image-button').click();
        await page.locator('.cg-viewer').getByRole('button',{name:'使用此服装',exact:true}).click();
        await page.locator('.cg-viewer .cg-dialog-notice').filter({hasText:'由连线输入控制'}).waitFor();
        await page.locator('.cg-viewer').getByRole('button',{name:'关闭 ×',exact:true}).click();
        await page.evaluate(id=>app.graph.remove(app.graph.getNodeById(id)),linkedSource);
        await expanded.getByRole('searchbox').fill('SPR-000');
        await expanded.locator('.cg-card[data-id="SPR-0002"] .cg-check').check();
        await expanded.locator('.cg-card[data-id="SPR-0001"] .cg-check').check();
        await expanded.getByRole('button',{name:'查看已选',exact:true}).click();
        assert.equal(await page.locator('.cg-review-row').count(),2);
        await page.locator('.cg-review').getByRole('button',{name:'关闭 ×',exact:true}).click();
        await expanded.getByRole('button',{name:'发送所选图片',exact:true}).click();
        await expanded.locator('.cg-message').filter({hasText:'单图节点只能接收一张图片'}).waitFor();
        assert.equal(await page.evaluate(()=>app.graph._nodes.length),3);
        await expanded.locator('.cg-target-row select').selectOption('');
        await expanded.getByRole('button',{name:'发送所选图片',exact:true}).click();
        assert.equal(await page.evaluate(()=>app.graph._nodes.length),4);
        await page.evaluate(() => {
            const batch=app.graph._nodes.find(n=>n.type==='CostumeGalleryBatch');
            for (const [name,value] of Object.entries({width:64,height:80})) batch.widgets.find(w=>w.name===name).value=value;
            const preview=LiteGraph.createNode('PreviewImage'); preview.pos=[1020,80]; app.graph.add(preview); batch.connect(0,preview,0);
            const metadata=LiteGraph.createNode('PreviewAny'); metadata.pos=[1020,460]; app.graph.add(metadata); batch.connect(1,metadata,0);
        });
        assert.equal(await page.evaluate(()=>app.graph._nodes.find(n=>n.type==='CostumeGalleryBatch').widgets.find(w=>w.name==='costume_ids').value),'SPR-0002\nSPR-0001');
        await expanded.getByRole('button',{name:'重置筛选',exact:true}).click();
        await expanded.getByRole('button',{name:'清空',exact:true}).click();
        await expanded.locator('.cg-filters select').nth(0).selectOption('春季');
        await expanded.locator('.cg-card img').first().waitFor();
        await page.waitForFunction(()=>[...document.querySelectorAll('.cg-expanded .cg-card img')].filter(i=>i.getBoundingClientRect().top<900).every(i=>i.complete&&i.naturalWidth>0));
        await page.locator('.cg-expanded').screenshot({path:path.join(root,'docs/comfyui-preview.png')});
        await page.getByRole('button',{name:'返回工作流 ×',exact:true}).click();
        saved=await page.evaluate(()=>app.graph.serialize());
        fs.writeFileSync(path.join(output,'roundtrip.json'),JSON.stringify(saved,null,2));
        await page.evaluate(async workflow=>{await app.loadGraphData(workflow);},saved);
        const prompt=await page.evaluate(async()=> (await app.graphToPrompt()).output);
        const pluginPrompts=Object.values(prompt).filter(n=>n.class_type.startsWith('CostumeGallery'));
        assert.equal(pluginPrompts.length,2);
        assert.ok(pluginPrompts.every(n=>!('costume_gallery_preview' in n.inputs)&&!('打开服装图库' in n.inputs)));
        const queued=await page.request.post(base+'/prompt',{data:{prompt}});
        assert.equal(queued.status(),200,await queued.text());
        const {prompt_id}=await queued.json();
        let history;
        for(let i=0;i<120;i++) {
            const response=await page.request.get(base+'/history/'+prompt_id);
            history=(await response.json())[prompt_id];
            if(history) break;
            await page.waitForTimeout(250);
        }
        assert.equal(history?.status.status_str,'success',JSON.stringify(history?.status));
        const dimensions=[];
        for(const file of Object.values(history.outputs).flatMap(o=>o.images||[])) {
            const response=await page.request.get(base+'/view?'+new URLSearchParams(file));
            const bytes=await response.body();
            assert.equal(bytes.subarray(1,4).toString(),'PNG');
            dimensions.push([bytes.readUInt32BE(16),bytes.readUInt32BE(20)]);
        }
        assert.equal(dimensions.length,3);
        assert.equal(dimensions.filter(([w,h])=>w===128&&h===160).length,1);
        assert.equal(dimensions.filter(([w,h])=>w===64&&h===80).length,2);
        const outputText=JSON.stringify(history.outputs);
        const rows=JSON.parse(fs.readFileSync(path.join(root,'data/costume-zh.json'),'utf8'));
        assert.ok(outputText.includes(rows.find(i=>i.id==='SPR-0002').关键词));
        assert.ok(outputText.includes('SPR-0001'));
        // Verify the two galleries can be opened and add nodes in this instance.
        await tab.click();
        await page.getByRole('button',{name:'ComfyUI_Pose-Gallery_ZH · 中文姿势图库',exact:true}).click();
        await page.locator('.pg-card').first().waitFor();
        await page.locator('.pg-app .pg-image-button').first().click();
        await page.locator('.pg-viewer').getByRole('button',{name:'使用此姿势',exact:true}).click();
        assert.equal(await page.evaluate(()=>app.graph._nodes.filter(n=>n.type==='PoseGalleryImage').length),1);
        await tab.click();
        await side.locator('.cg-card').first().waitFor();
        await side.getByRole('button',{name:'素材设置',exact:true}).click();
        const settings=page.locator('.cg-settings');
        await settings.locator('input').fill(root);
        await settings.getByRole('button',{name:'检查并保存',exact:true}).click();
        await settings.locator('.cg-settings-status').filter({hasText:'已保存'}).waitFor();
        await settings.getByRole('button',{name:'关闭 ×',exact:true}).click();
        await side.locator('.cg-controls > .cg-field select').selectOption('custom');
        await side.locator('.cg-card').first().waitFor();
        assert.match(await side.locator('.cg-brand p').textContent(),/1,407/);
        const reset=await page.request.post(base+'/costume_gallery/settings',{data:{custom_directory:''}});
        assert.equal(reset.status(),200);
        // Load and execute the shipped workflows without changing their files.
        for(const [kind,filename] of [['CostumeGalleryImage','01_single_image.json'],['CostumeGalleryBatch','02_batch_images.json']]) {
            const example=JSON.parse(fs.readFileSync(path.join(root,'examples',filename),'utf8'));
            assert.ok(example.nodes.some(n=>n.type===kind));
            await page.evaluate(async workflow=>{await app.loadGraphData(workflow);},example);
            const p=await page.evaluate(async()=> (await app.graphToPrompt()).output);
            const response=await page.request.post(base+'/prompt',{data:{prompt:p}});
            assert.equal(response.status(),200,await response.text());
            const {prompt_id:id}=await response.json();
            let done;
            for(let i=0;i<120;i++) {
                done=(await (await page.request.get(base+'/history/'+id)).json())[id];
                if(done) break;
                await page.waitForTimeout(250);
            }
            assert.equal(done?.status.status_str,'success',filename+JSON.stringify(done?.status));
            assert.equal(Object.values(done.outputs).flatMap(o=>o.images||[]).length,kind==='CostumeGalleryImage'?1:3);
        }
        assert.deepEqual(errors,[]);
        console.log('Passed: sidebar, search, favorites, selection, download, targeted updates, batch order, workflow roundtrip, 3 output PNGs, custom directory, pose coexistence, both executable examples.');
    } catch(error) {
        await page.screenshot({path:path.join(output,'browser-failure.png')});
        throw error;
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
