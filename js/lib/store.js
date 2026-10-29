export const MAX_BATCH = 32;
const PREFIX = "costume-gallery-zh.v1.";

export const TYPES = [
    { value: "dress", label: "连衣裙", words: ["dress"] },
    { value: "skirt", label: "半身裙", words: ["skirt"] },
    { value: "top", label: "上衣 / 针织", words: ["shirt", "blouse", "camisole", "knit", "sweater", "hoodie", "vest", "turtleneck"] },
    { value: "outerwear", label: "外套 / 开衫", words: ["coat", "jacket", "cardigan"] },
    { value: "pants", label: "长裤 / 短裤", words: ["pants", "jeans", "shorts"] },
    { value: "lingerie", label: "内衣 / 束身衣", words: ["bra", "briefs", "corset", "robe"] },
    { value: "swimwear", label: "泳衣", words: ["swimsuit"] },
];
export const COLORS = [
    { value: "white", label: "白色 / 象牙白", words: ["white", "ivory", "cream"] },
    { value: "black", label: "黑色", words: ["black"] },
    { value: "grey", label: "灰色 / 银色", words: ["grey", "gray", "silver"] },
    { value: "beige", label: "米色 / 棕色", words: ["beige", "brown", "khaki"] },
    { value: "blue", label: "蓝色 / 藏蓝", words: ["blue", "navy"] },
    { value: "green", label: "绿色 / 薄荷绿", words: ["green", "mint", "olive"] },
    { value: "pink", label: "粉色", words: ["pink"] },
    { value: "red", label: "红色 / 酒红", words: ["red", "burgundy"] },
    { value: "yellow", label: "黄色 / 金色", words: ["yellow", "gold"] },
    { value: "purple", label: "紫色", words: ["purple", "lavender"] },
    { value: "orange", label: "橙色", words: ["orange"] },
];

export function readLocal(name, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(PREFIX + name));
        return Array.isArray(fallback) ? (Array.isArray(value) ? value.filter(item => typeof item === "string") : fallback) : (value ?? fallback);
    } catch { return fallback; }
}
export function writeLocal(name, value) {
    try { localStorage.setItem(PREFIX + name, JSON.stringify(value)); }
    catch { /* Browser storage can be unavailable; browsing and node outputs still work. */ }
}
export function wordsOf(item) {
    return new Set(String(item.关键词 || "").toLowerCase().match(/[a-z0-9]+/g) || []);
}
export function titleOf(item) {
    const words = wordsOf(item);
    const color = item.标签?.find(tag => /白|黑|灰|米色|棕|蓝|绿|粉|红|黄色|橙|紫/.test(tag));
    const detail = item.标签?.find(tag => ["蕾丝", "碎花", "针织", "牛仔", "百褶", "缎面", "丝绒", "褶边", "皮革"].includes(tag));
    const garment = words.has("dress") ? "连衣裙" : words.has("skirt") ? "半身裙" : words.has("jeans") ? "牛仔裤" : words.has("pants") ? "长裤" : words.has("shorts") ? "短裤" : words.has("swimsuit") ? "泳衣" : words.has("bra") ? "内衣" : words.has("corset") ? "束身衣" : words.has("coat") ? "大衣" : words.has("jacket") ? "夹克" : words.has("camisole") ? "吊带衫" : "服装";
    return [...new Set([color, detail, garment].filter(Boolean))].join(" · ") + "搭配";
}
export function filterItems(items, state, favorites = [], recent = [], aliases = {}) {
    const terms = String(state.query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const favoriteSet = new Set(favorites), recentSet = new Set(recent);
    const type = TYPES.find(value => value.value === state.type);
    const color = COLORS.find(value => value.value === state.color);
    const results = items.filter(item => {
        if (state.category && item.分类 !== state.category) return false;
        if (state.collection === "favorites" && !favoriteSet.has(item.id)) return false;
        if (state.collection === "recent" && !recentSet.has(item.id)) return false;
        const words = wordsOf(item);
        if (type && !type.words.some(word => words.has(word))) return false;
        if (color && !color.words.some(word => words.has(word))) return false;
        const text = String(item.检索 || [item.id, item.分类, item.关键词, item.关键词中文, ...(item.标签 || [])].join(" ")).toLowerCase();
        return terms.every(term => {
            if (/^[a-z0-9-]+$/.test(term)) return item.id.toLowerCase().includes(term) || [...words].some(word => word.startsWith(term));
            return text.includes(term) || (aliases[term] || []).some(word => words.has(word.toLowerCase()));
        });
    });
    if (state.collection === "recent") {
        const ranks = new Map(recent.map((id, index) => [id, index]));
        results.sort((a, b) => ranks.get(a.id) - ranks.get(b.id));
    }
    return results;
}
