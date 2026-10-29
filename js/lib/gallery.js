import { COLORS, TYPES, MAX_BATCH, filterItems, readLocal, titleOf, writeLocal } from "./store.js";

function el(tag, cls = "", text = "") {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
}
function button(text, action, cls = "") {
    const node = el("button", `cg-button ${cls}`, text);
    node.type = "button"; node.addEventListener("click", action);
    return node;
}
function field(label, input) {
    const node = el("label", "cg-field");
    node.append(el("span", "cg-label", label), input); return node;
}
function options(select, values, allLabel) {
    select.replaceChildren();
    if (allLabel) select.add(new Option(allLabel, ""));
    for (const value of values) select.add(typeof value === "string" ? new Option(value, value) : new Option(value.label, value.value));
}
function imageNode(url, alt, cls = "") {
    const image = el("img", cls);
    image.src = url; image.alt = alt; image.loading = "lazy"; image.decoding = "async";
    image.addEventListener("error", () => { image.classList.add("cg-image-missing"); image.alt = "图片缺失，请检查素材目录"; });
    return image;
}
function dialogShell(title, cls = "") {
    const dialog = el("dialog", `cg-dialog ${cls}`);
    dialog.setAttribute("aria-label", title);
    const header = el("header", "cg-dialog-header");
    header.append(el("h2", "", title), button("关闭 ×", () => dialog.close(), "cg-quiet"));
    dialog.append(header);
    dialog.addEventListener("click", event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog); return dialog;
}

export class Gallery {
    constructor(container, adapter, initial = {}) {
        this.host = container; this.adapter = adapter;
        this.state = { query: "", category: "", type: "", color: "", collection: "all", view: "comfortable", shown: 48, source: "builtin", targetId: "", ...initial };
        this.state.targetId = String(this.state.targetId);
        this.items = []; this.byId = new Map(); this.aliases = {}; this.selected = new Map();
        this.ownedDialogs = new Set(); this.abort = new AbortController(); this.loadSerial = 0;
        this.build(); this.load();
    }
    build() {
        this.root = el("section", "cg-app"); this.root.setAttribute("aria-label", "中文服装图库");
        const header = el("header", "cg-header"), brand = el("div", "cg-brand"), title = el("div");
        title.append(el("div", "cg-eyebrow", "COSTUME GALLERY · 中文服装图库"), el("h2", "cg-title", "选一套新搭配"));
        this.stats = el("p", "cg-muted", "正在读取本地素材…"); title.append(this.stats);
        brand.append(el("span", "cg-brand-symbol", "衣"), title);
        const actions = el("div", "cg-header-actions");
        actions.append(button("素材设置", () => this.settings(), "cg-quiet"));
        if (!this.state.expanded) actions.append(button("展开 ↗", () => {
            const picker = this.adapter.expand({ ...this.state, selectedIds: [...this.selected.keys()] });
            picker?.root.closest("dialog")?.addEventListener("close", () => {
                if (!this.abort.signal.aborted && this.state.source === picker.state.source) { this.selected = new Map(picker.selected); this.render(false); }
            }, { once: true });
        }, "cg-quiet"));
        header.append(brand, actions);
        const controls = el("div", "cg-controls");
        this.sourceSelect = el("select");
        options(this.sourceSelect, [{ value: "builtin", label: "本项目素材" }, { value: "custom", label: "自定义素材目录" }]);
        this.sourceSelect.value = this.state.source;
        this.sourceSelect.addEventListener("change", () => this.changeSource(this.sourceSelect.value));
        this.search = el("input", "cg-search"); this.search.type = "search"; this.search.maxLength = 200;
        this.search.placeholder = "搜索服装、颜色或编号…"; this.search.setAttribute("aria-label", "搜索服装"); this.search.value = this.state.query;
        this.search.addEventListener("input", () => { this.state.query = this.search.value; this.render(); });
        controls.append(field("素材库", this.sourceSelect), this.search);
        const filters = el("div", "cg-filters");
        for (const [name, label, values] of [["category", "季节 / 场景", []], ["type", "服装类型", TYPES], ["color", "搭配颜色", COLORS]]) {
            const select = el("select"); this[`${name}Select`] = select; options(select, values, "全部");
            select.value = this.state[name]; select.addEventListener("change", () => { this.state[name] = select.value; this.render(); });
            filters.append(field(label, select));
        }
        this.viewSelect = el("select"); options(this.viewSelect, [{ value: "comfortable", label: "舒适视图" }, { value: "compact", label: "紧凑视图" }]);
        this.viewSelect.value = this.state.view; this.viewSelect.addEventListener("change", () => { this.state.view = this.viewSelect.value; this.render(false); });
        filters.append(field("浏览方式", this.viewSelect)); controls.append(filters);
        const collection = el("div", "cg-collections"); this.collectionButtons = [];
        for (const [key, label] of [["all", "全部服装"], ["favorites", "♡ 收藏"], ["recent", "最近使用"]]) {
            const tab = button(label, () => { this.state.collection = key; this.render(); }, "cg-tab");
            tab.dataset.collection = key; this.collectionButtons.push(tab); collection.append(tab);
        }
        collection.append(button("重置筛选", () => this.resetFilters(), "cg-reset cg-quiet"));
        this.summary = el("div", "cg-summary"); this.message = el("div", "cg-message");
        this.message.setAttribute("role", "status"); this.message.setAttribute("aria-live", "polite"); this.message.hidden = true;
        this.scroller = el("div", "cg-scroll"); this.grid = el("div", "cg-grid");
        this.more = button("加载更多", () => { this.state.shown += 48; this.render(false); }, "cg-more");
        this.scroller.append(this.grid, this.more);
        this.target = el("select"); this.target.setAttribute("aria-label", "接收服装的图库节点");
        this.target.addEventListener("change", () => { this.state.targetId = this.target.value; });
        this.target.addEventListener("focus", () => this.refreshTargets());
        const targetRow = el("div", "cg-target-row"); targetRow.append(field("发送到", this.target));
        this.selectionLabel = el("strong", "cg-selection-label");
        this.reviewButton = button("查看已选", () => this.reviewSelection(), "cg-quiet");
        this.clearButton = button("清空", () => { this.selected.clear(); this.render(false); }, "cg-quiet");
        this.sendButton = button("发送所选图片", () => this.send([...this.selected.keys()], "batch"), "cg-primary");
        const selectionActions = el("div", "cg-selection-actions"); selectionActions.append(this.reviewButton, this.clearButton, this.sendButton);
        const selectedRow = el("div", "cg-selection-row"); selectedRow.append(this.selectionLabel, selectionActions);
        const bottom = el("footer", "cg-bottom"), credit = el("div", "cg-credit", "图片：ギア · 中文服装图库");
        credit.append(button("使用说明", () => this.help(), "cg-link")); bottom.append(targetRow, selectedRow, credit);
        this.root.append(header, controls, collection, this.summary, this.message, this.scroller, bottom); this.host.replaceChildren(this.root);
        this.root.addEventListener("keydown", event => {
            if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) { event.preventDefault(); event.stopPropagation(); this.search.focus(); }
        }, { signal: this.abort.signal });
        window.addEventListener("costume-gallery-nodes-changed", () => this.refreshTargets(), { signal: this.abort.signal });
        window.addEventListener("costume-gallery-storage-changed", () => this.render(false), { signal: this.abort.signal });
        window.addEventListener("costume-gallery-directory-changed", () => { if (this.state.source === "custom") { this.selected.clear(); this.load(); } }, { signal: this.abort.signal });
        this.refreshTargets(); this.updateSelection();
    }
    favorites() { return readLocal(`favorites.${this.state.source}`, []); }
    recent() { return readLocal(`recent.${this.state.source}`, []); }
    async load() {
        const serial = ++this.loadSerial; this.items = []; this.byId.clear(); this.grid.replaceChildren();
        this.more.hidden = true; this.notice("正在读取本地素材…");
        try {
            const data = await this.adapter.request("/catalogue?" + new URLSearchParams({ source: this.state.source }));
            if (serial !== this.loadSerial) return;
            this.items = data.items; this.aliases = data.aliases || {}; this.byId = new Map(this.items.map(item => [item.id, item]));
            options(this.categorySelect, data.categories, "全部季节 / 场景"); this.categorySelect.value = this.state.category;
            if (!this.categorySelect.value) this.state.category = "";
            for (const id of this.state.selectedIds || []) if (this.byId.has(id) && this.selected.size < MAX_BATCH) this.selected.set(id, this.byId.get(id));
            delete this.state.selectedIds;
            this.stats.textContent = `${data.count.toLocaleString("zh-CN")} 套服装 · ${data.categories.length} 个分类 · 离线使用`;
            this.notice(""); this.render(false);
        } catch (error) {
            if (serial !== this.loadSerial) return;
            this.items = []; this.byId.clear(); this.stats.textContent = "素材暂不可用"; this.summary.textContent = "";
            this.notice(error.message, true); this.grid.replaceChildren(button("重新加载", () => this.load()));
        }
    }
    changeSource(source) {
        this.state.source = source; this.sourceSelect.value = source; this.selected.clear(); delete this.state.selectedIds;
        this.resetFilters(false); this.updateSelection(); this.load();
    }
    resetFilters(render = true) {
        Object.assign(this.state, { query: "", category: "", type: "", color: "", collection: "all" });
        this.search.value = this.categorySelect.value = this.typeSelect.value = this.colorSelect.value = "";
        if (render) this.render();
    }
    render(reset = true) {
        if (reset) { this.state.shown = 48; this.scroller.scrollTop = 0; }
        const favorites = this.favorites();
        this.filtered = filterItems(this.items, this.state, favorites, this.recent(), this.aliases);
        this.root.classList.toggle("cg-compact", this.state.view === "compact");
        this.summary.textContent = `找到 ${this.filtered.length.toLocaleString("zh-CN")} 套服装 · 颜色匹配整套搭配`;
        for (const tab of this.collectionButtons) { const active = tab.dataset.collection === this.state.collection; tab.classList.toggle("cg-active", active); tab.setAttribute("aria-pressed", String(active)); }
        this.grid.replaceChildren(...this.filtered.slice(0, this.state.shown).map(item => this.card(item, favorites)));
        if (!this.filtered.length) this.grid.append(el("p", "cg-empty", this.state.collection === "favorites" ? "还没有匹配的收藏，试试调整筛选或收藏喜欢的搭配。" : "没有找到匹配的服装，试试减少筛选条件。"));
        this.more.hidden = this.filtered.length <= this.state.shown; this.updateSelection();
    }
    card(item, favorites) {
        const card = el("article", "cg-card"); card.dataset.id = item.id;
        card.classList.toggle("cg-selected", this.selected.has(item.id));
        const media = el("div", "cg-card-media");
        const open = button("", () => this.view(item), "cg-image-button"); open.setAttribute("aria-label", `预览 ${item.id} ${titleOf(item)}`);
        open.append(imageNode(this.adapter.image(this.state.source, item.id, true), titleOf(item)));
        const check = el("input", "cg-check"); check.type = "checkbox"; check.checked = this.selected.has(item.id); check.setAttribute("aria-label", `选择 ${item.id}`);
        check.addEventListener("change", () => { this.toggleSelection(item); check.checked = this.selected.has(item.id); card.classList.toggle("cg-selected", check.checked); });
        const favorite = button(favorites.includes(item.id) ? "♥" : "♡", () => this.toggleFavorite(item), "cg-favorite");
        favorite.setAttribute("aria-label", `收藏 ${item.id}`); favorite.setAttribute("aria-pressed", String(favorites.includes(item.id)));
        media.append(open, check, favorite);
        const caption = button("", () => this.view(item), "cg-card-caption");
        caption.append(el("strong", "", titleOf(item)), el("p", "cg-card-meta cg-muted", `${item.分类} · ${item.id}`));
        card.append(media, caption); return card;
    }
    toggleFavorite(item) {
        const values = this.favorites();
        writeLocal(`favorites.${this.state.source}`, values.includes(item.id) ? values.filter(id => id !== item.id) : [...values, item.id]);
        window.dispatchEvent(new Event("costume-gallery-storage-changed"));
    }
    toggleSelection(item) {
        if (this.selected.has(item.id)) this.selected.delete(item.id);
        else if (this.selected.size >= MAX_BATCH) this.notice(`单批最多 ${MAX_BATCH} 张。`, true);
        else { this.selected.set(item.id, item); this.notice(""); }
        this.updateSelection();
    }
    updateSelection() {
        this.selectionLabel.textContent = `已选 ${this.selected.size} / ${MAX_BATCH} 张`;
        this.sendButton.disabled = this.reviewButton.disabled = this.clearButton.disabled = !this.selected.size;
    }
    refreshTargets() {
        const current = this.state.targetId; this.target.replaceChildren(new Option("新建图库节点", ""));
        for (const node of this.adapter.targets()) this.target.add(new Option(`#${node.displayId ?? node.id} ${node.title}`, String(node.id)));
        this.target.value = [...this.target.options].some(option => option.value === current) ? current : ""; this.state.targetId = this.target.value;
    }
    async send(ids, mode, dialog = null) {
        if (!ids.length) return;
        try {
            this.adapter.apply({ ids, mode, source: this.state.source, targetId: this.state.targetId });
            writeLocal(`recent.${this.state.source}`, [...ids, ...this.recent().filter(id => !ids.includes(id))].slice(0, 80));
            this.notice(`已发送 ${ids.length} 张图片到服装图库节点。`); dialog?.close();
            window.dispatchEvent(new Event("costume-gallery-storage-changed"));
        } catch (error) { this.notice(error.message, true); if (dialog) this.dialogNotice(dialog, error.message, true); }
    }
    notice(message, error = false) { this.message.textContent = message; this.message.hidden = !message; this.message.classList.toggle("cg-error", error); }
    own(dialog) { this.ownedDialogs.add(dialog); dialog.addEventListener("close", () => this.ownedDialogs.delete(dialog), { once: true }); return dialog; }
    dialogNotice(dialog, message, error = false) {
        let notice = dialog.querySelector(".cg-dialog-notice");
        if (!notice) { notice = el("p", "cg-dialog-notice"); dialog.append(notice); }
        notice.classList.toggle("cg-error", error); notice.textContent = message;
    }
    view(initial) {
        let current = initial; const source = this.state.source; const list = [...this.filtered];
        if (!list.includes(initial)) list.push(initial);
        const dialog = this.own(dialogShell("服装预览", "cg-viewer")), content = el("div", "cg-viewer-content"), stage = el("div", "cg-stage");
        const image = imageNode(this.adapter.image(source, current.id), titleOf(current)); image.loading = "eager"; stage.append(image);
        const details = el("div", "cg-details"), category = el("div", "cg-eyebrow"), title = el("h3", "cg-viewer-title"), id = el("code", "cg-id");
        const tags = el("div", "cg-tags"), english = el("p", "cg-keywords");
        const nav = el("div", "cg-viewer-nav");
        const prev = button("← 上一套", () => step(-1)), next = button("下一套 →", () => step(1)); nav.append(prev, next);
        const choose = button("加入批量选择", () => { this.toggleSelection(current); update(); this.render(false); });
        const favorite = button("收藏这套搭配", () => { this.toggleFavorite(current); update(); });
        const use = button("使用此服装", () => this.send([current.id], "single", dialog), "cg-primary");
        const download = el("a", "cg-button cg-download", "下载原尺寸图片");
        const copy = (label, value) => button(label, async () => {
            try { await navigator.clipboard.writeText(value()); this.dialogNotice(dialog, "已复制。"); }
            catch { this.dialogNotice(dialog, `请手动复制：${value()}`); }
        }, "cg-quiet");
        const copies = el("div", "cg-copy-actions");
        copies.append(copy("复制英文关键词", () => current.关键词), copy("复制中文说明", () => current.关键词中文), copy("复制服装 ID", () => current.id));
        details.append(category, title, id, tags, english, nav, choose, favorite, use, download, copies, el("p", "cg-hint", "← → 切换服装 · Esc 关闭 · 点击标签搜索相似搭配"));
        content.append(stage, details); dialog.append(content);
        const update = () => {
            category.textContent = current.分类; title.textContent = titleOf(current); id.textContent = current.id; english.textContent = current.关键词;
            image.classList.remove("cg-image-missing"); image.src = this.adapter.image(source, current.id); image.alt = titleOf(current);
            download.href = this.adapter.original(source, current.id); download.download = current.id + "." + current.原图.split(".").pop();
            choose.textContent = this.selected.has(current.id) ? "✓ 已加入批量 · 点击取消" : "加入批量选择";
            favorite.textContent = this.favorites().includes(current.id) ? "♥ 已收藏 · 点击取消" : "♡ 收藏这套搭配";
            tags.replaceChildren(...current.标签.map(tag => button(tag, () => { this.state.query = tag; this.search.value = tag; this.render(); dialog.close(); }, "cg-tag")));
            prev.disabled = list.indexOf(current) <= 0; next.disabled = list.indexOf(current) >= list.length - 1;
        };
        const step = direction => { const item = list[list.indexOf(current) + direction]; if (item) { current = item; update(); } };
        dialog.addEventListener("keydown", event => {
            if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
            if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); step(event.key === "ArrowLeft" ? -1 : 1); }
        });
        let startX = null;
        stage.addEventListener("touchstart", event => { if (event.touches.length === 1) startX = event.touches[0].clientX; }, { passive: true });
        stage.addEventListener("touchend", event => { if (startX !== null && Math.abs(event.changedTouches[0].clientX - startX) > 60) step(event.changedTouches[0].clientX < startX ? 1 : -1); startX = null; }, { passive: true });
        update(); dialog.showModal();
    }
    reviewSelection() {
        const dialog = this.own(dialogShell("已选服装 · 按选择顺序输出", "cg-review")), list = el("div", "cg-review-list");
        const send = button("发送所选图片", () => this.send([...this.selected.keys()], "batch", dialog), "cg-primary cg-dialog-action");
        const update = () => {
            list.replaceChildren();
            for (const [id, item] of this.selected) {
                const row = el("div", "cg-review-row"), text = el("div"); text.append(el("strong", "", titleOf(item)), el("p", "cg-muted", `${item.分类} · ${id}`));
                row.append(imageNode(this.adapter.image(this.state.source, id, true), titleOf(item)), text, button("移除", () => { this.selected.delete(id); update(); this.render(false); })); list.append(row);
            }
            send.disabled = !this.selected.size; if (!this.selected.size) list.append(el("p", "cg-muted", "已清空选择。"));
        };
        dialog.append(list, send); update(); dialog.showModal();
    }
    async settings() {
        const dialog = this.own(dialogShell("素材设置", "cg-settings")), content = el("div", "cg-settings-content");
        content.append(el("h3", "", "直接使用本项目的本地素材"), el("p", "cg-muted", "默认读取插件所在目录的 data、thumbs、img 和 png。图库与图片输出无需联网，也无需额外模型。"));
        const input = el("input"); input.type = "text"; input.placeholder = "留空使用本项目素材"; input.autocomplete = "off"; input.disabled = true;
        content.append(field("自定义素材目录（可选）", input), el("p", "cg-muted", "填写 ComfyUI 所在电脑上的绝对路径。目录须含 data/costume-zh.json 和清单引用的原图。"));
        const status = el("p", "cg-settings-status"); status.setAttribute("role", "status");
        const save = button("检查并保存", async () => {
            save.disabled = true; status.textContent = "正在检查素材目录…";
            try {
                const result = await this.adapter.request("/settings", { method: "POST", body: { custom_directory: input.value } });
                if (!dialog.isConnected) return;
                input.value = result.custom_directory; status.textContent = "已保存。可在图库顶部切换素材库。"; status.classList.remove("cg-error");
                if (this.state.source === "custom" && !result.custom_directory) this.changeSource("builtin");
                window.dispatchEvent(new Event("costume-gallery-directory-changed"));
            } catch (error) { status.textContent = error.message; status.classList.add("cg-error"); }
            finally { save.disabled = false; }
        }, "cg-primary");
        save.disabled = true; content.append(status, save, button("清空目录输入", () => { input.value = ""; status.textContent = "点击保存后生效。"; }, "cg-quiet"), el("p", "cg-hint", "目录设置保存在 ComfyUI 用户目录中。切换浏览素材库不会修改已有节点的选择。"));
        dialog.append(content); dialog.showModal();
        try {
            const result = await this.adapter.request("/settings"); if (!dialog.isConnected) return;
            input.value = result.custom_directory; input.disabled = save.disabled = false;
        } catch (error) { status.textContent = error.message; status.classList.add("cg-error"); }
    }
    help() {
        const dialog = this.own(dialogShell("使用说明与素材来源", "cg-settings")), content = el("div", "cg-settings-content");
        for (const [title, text] of [
            ["单张使用", "筛选服装并打开预览，点击「使用此服装」新建单图节点；也可先在底部指定已有节点。节点输出图片、服装 ID、原始英文关键词和中文说明。"],
            ["批量使用", "勾选图片后发送到批量节点，最多32张。节点默认按选择顺序输出，可统一尺寸；JSON 清单记录每张图片的中英文关键词和处理参数。"],
            ["服装参考", "素材是不含人物的服装搭配参考图。可连接支持参考图的图像编辑或生成工作流；实际换装效果取决于后续模型与工作流。英文关键词是原始索引，可按需要整理后接入文本编码节点。"],
            ["收藏与工作流", "收藏和最近使用保存在当前浏览器。服装 ID、素材库、尺寸和翻转参数随工作流保存；接收者也需要安装插件和对应素材。"],
            ["素材来源", "图片与原始数据：ギア（giaaibusi）。中文索引来自原中文服装站，界面参考 Anhao 的中文姿势图库。代码使用 MIT；图片和数据的使用范围见仓库 LICENSE 与原作者条款。"],
        ]) content.append(el("h3", "", title), el("p", "cg-muted", text));
        const link = el("a", "cg-source-link", "项目与使用说明 ↗"); link.href = "https://github.com/Stone-dielianhua/ComfyUI_Costume-Gallery_ZH"; link.target = "_blank"; link.rel = "noopener noreferrer";
        content.append(link); dialog.append(content); dialog.showModal();
    }
    destroy() {
        this.abort.abort(); this.loadSerial++;
        for (const dialog of this.ownedDialogs) dialog.close(); this.host.replaceChildren();
    }
}
