import { app } from "../../scripts/app.js";
import { bindLoraContextMenu, fetchLoraTriggers } from "./lora_info.js";
import { bindPreviewImage, replaceWithPreviewPlaceholder } from "./lora_preview_cache.js";

const NODE_NAME = "ListLoraLoader";
const API_BASE = "/crashutils/loras";
const THUMB_DEFAULT = 56;
const THUMB_MIN = 40;
const THUMB_MAX = 96;
const THUMB_STEP = 4;
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 480;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 240;
const PANEL_HEADER_HEIGHT = 26;
const PANEL_GAP = 6;
const BROWSE_PANEL_RATIO = 0.6;
const OPTIONAL_INPUT_SLOTS = 2;
const INPUT_SLOT_HEIGHT = 20;
const DEFAULT_CONTENT_HEIGHT = 240;
const NODE_BOTTOM_PAD = 18;
const TITLE_BAR_FALLBACK = 30;
const WIDGET_ROW_FALLBACK = 20;
const WIDGET_ROW_GAP = 4;
const STORAGE_KEY = "Comfy.ListLoraLoader.defaults";

function readGlobalDefaults() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
        return {};
    }
}

function writeGlobalDefaults(props) {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                sfw: props.sfw,
                browsePath: props.browsePath,
                thumbSize: props.thumbSize,
            })
        );
    } catch {
        // ignore
    }
}

function applyGlobalDefaults(properties) {
    const globals = readGlobalDefaults();
    if (properties.sfw === undefined && globals.sfw !== undefined) {
        properties.sfw = globals.sfw;
    }
    if (properties.thumbSize === undefined && globals.thumbSize !== undefined) {
        properties.thumbSize = globals.thumbSize;
    }
    if (properties.browsePath === undefined && globals.browsePath !== undefined) {
        properties.browsePath = globals.browsePath;
    }
}

function clampThumbSize(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return THUMB_DEFAULT;
    return Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(num / THUMB_STEP) * THUMB_STEP));
}

function formatTriggers(triggers) {
    if (!triggers?.length) return "";
    return triggers.join(", ");
}

function isNsfwBrowsePath(path) {
    return String(path || "")
        .split(/[/\\]/)
        .some((part) => part.toLowerCase() === "nsfw");
}

function trimNsfwBrowsePath(path) {
    const parts = String(path || "")
        .split(/[/\\]/)
        .filter(Boolean);
    const nsfwIndex = parts.findIndex((part) => part.toLowerCase() === "nsfw");
    if (nsfwIndex === -1) {
        return parts.join("/");
    }
    return parts.slice(0, nsfwIndex).join("/");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatStrength(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return "?";
    if (Number.isInteger(num)) return String(num);
    return num.toFixed(2).replace(/\.?0+$/, "");
}

function getWidgetTop(node) {
    const domWidget = node.listLoraWidget;
    if (domWidget?.last_y != null && domWidget.last_y > 0) {
        return domWidget.last_y;
    }

    let yOffset = TITLE_BAR_FALLBACK + OPTIONAL_INPUT_SLOTS * INPUT_SLOT_HEIGHT;
    for (const widget of node.widgets || []) {
        if (widget === domWidget) break;
        if (widget.computeSize) {
            const [, h] = widget.computeSize();
            yOffset += Math.max(h, 0) + WIDGET_ROW_GAP;
        } else {
            yOffset += WIDGET_ROW_FALLBACK + WIDGET_ROW_GAP;
        }
    }
    return yOffset;
}

function getContentArea(node, nodeHeight) {
    const widgetY = getWidgetTop(node);
    const totalH = nodeHeight ?? node.size?.[1] ?? DEFAULT_HEIGHT;
    return {
        w: Math.max(MIN_WIDTH, (node.size?.[0] || DEFAULT_WIDTH) - 20),
        h: Math.max(MIN_HEIGHT, totalH - widgetY - NODE_BOTTOM_PAD),
    };
}

function syncLayoutToNode(node, nodeHeight) {
    if (!node?.listLoraUI) return;
    const { w, h } = getContentArea(node, nodeHeight);
    if (node._listLoraLayoutW === w && node._listLoraLayoutH === h) return;
    node._listLoraLayoutW = w;
    node._listLoraLayoutH = h;
    node.listLoraUI.layoutPanels(w, h);
}

function applyDefaultNodeSize(node) {
    if (!node.size) {
        node.size = [DEFAULT_WIDTH, DEFAULT_HEIGHT];
    }
    if (node.size[0] < DEFAULT_WIDTH) {
        node.size[0] = DEFAULT_WIDTH;
    }
    if (node.size[1] < DEFAULT_HEIGHT) {
        node.size[1] = DEFAULT_HEIGHT;
    }
    syncLayoutToNode(node, node.size[1]);
    node.setDirtyCanvas(true, true);
}

const STYLES = `
.crash-list-lora {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 11px;
    color: #ccc;
    user-select: none;
    box-sizing: border-box;
    overflow: hidden;
    position: relative;
}
.crash-list-lora * { box-sizing: border-box; }
.crash-list-lora .panel {
    border: 1px solid #555;
    border-radius: 4px;
    background: #2a2a2a;
    overflow: hidden;
    position: absolute;
    left: 0;
    right: 0;
}
.crash-list-lora .panel-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    background: #333;
    border-bottom: 1px solid #555;
    height: ${PANEL_HEADER_HEIGHT}px;
}
.crash-list-lora .breadcrumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    flex: 1;
    min-width: 0;
}
.crash-list-lora .crumb {
    color: #8af;
    cursor: pointer;
    white-space: nowrap;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
}
.crash-list-lora .crumb:hover { text-decoration: underline; }
.crash-list-lora .crumb-sep { color: #666; margin: 0 1px; }
.crash-list-lora .search-box {
    width: 72px;
    min-width: 60px;
    padding: 2px 6px;
    border: 1px solid #555;
    border-radius: 3px;
    background: #1a1a1a;
    color: #ddd;
    font-size: 11px;
    outline: none;
}
.crash-list-lora .search-box:focus { border-color: #8af; }
.crash-list-lora .header-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}
.crash-list-lora .sfw-switch {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    flex-shrink: 0;
}
.crash-list-lora .sfw-label {
    color: #aaa;
    font-size: 10px;
    white-space: nowrap;
}
.crash-list-lora .switch-track {
    position: relative;
    width: 32px;
    height: 16px;
    flex-shrink: 0;
}
.crash-list-lora .switch-track input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    margin: 0;
}
.crash-list-lora .switch-thumb {
    position: absolute;
    inset: 0;
    background: #555;
    border-radius: 999px;
    transition: background 0.15s;
}
.crash-list-lora .switch-thumb::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    background: #ddd;
    border-radius: 50%;
    transition: transform 0.15s;
}
.crash-list-lora .switch-track input:checked + .switch-thumb {
    background: #4a9;
}
.crash-list-lora .switch-track input:checked + .switch-thumb::after {
    transform: translateX(16px);
}
.crash-list-lora .size-control {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
}
.crash-list-lora .size-label {
    color: #aaa;
    font-size: 10px;
    white-space: nowrap;
}
.crash-list-lora .size-slider {
    width: 56px;
    height: 14px;
    margin: 0;
    accent-color: #8af;
    cursor: pointer;
}
.crash-list-lora .list-scroll {
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px;
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
}
.crash-list-lora .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.crash-list-lora .list-row {
    display: flex;
    align-items: stretch;
    gap: 8px;
    padding: 4px;
    border: 1px solid #444;
    border-radius: 4px;
    background: #1e1e1e;
    cursor: pointer;
    position: relative;
    min-height: calc(var(--thumb-size, 56px) + 8px);
    transition: border-color 0.15s, opacity 0.15s;
}
.crash-list-lora .list-row:hover { border-color: #8af; }
.crash-list-lora .list-row.selected { border-color: #6c6; }
.crash-list-lora .list-row.disabled { opacity: 0.35; }
.crash-list-lora .list-row.folder-row {
    align-items: center;
    min-height: calc(var(--thumb-size, 56px) + 8px);
}
.crash-list-lora .row-thumb {
    width: var(--thumb-size, 56px);
    height: var(--thumb-size, 56px);
    flex-shrink: 0;
    border-radius: 4px;
    overflow: hidden;
    background: #141414;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
}
.crash-list-lora .row-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.crash-list-lora .row-thumb .placeholder,
.crash-list-lora .row-thumb .folder-icon {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: calc(var(--thumb-size, 56px) * 0.42);
}
.crash-list-lora .row-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 2px 0;
}
.crash-list-lora .row-name {
    font-weight: 600;
    color: #ddd;
    font-size: 11px;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.crash-list-lora .row-tags {
    font-size: 9px;
    color: #888;
    line-height: 1.3;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
.crash-list-lora .row-tags.empty { display: none; }
.crash-list-lora .row-subpath {
    font-size: 9px;
    color: #777;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.crash-list-lora .cog-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 3px;
    background: rgba(0,0,0,0.7);
    color: #ccc;
    font-size: 11px;
    line-height: 18px;
    text-align: center;
    cursor: pointer;
    padding: 0;
    z-index: 2;
}
.crash-list-lora .cog-btn:hover { background: rgba(50,50,50,0.95); color: #fff; }
.crash-list-lora .strength-badge {
    position: absolute;
    bottom: 2px;
    left: 2px;
    padding: 1px 4px;
    background: rgba(0,0,0,0.8);
    color: #ffd866;
    font-size: 9px;
    font-weight: 700;
    border-radius: 3px;
    line-height: 1.2;
    z-index: 2;
    pointer-events: none;
}
.crash-list-lora .empty-msg {
    color: #666;
    text-align: center;
    padding: 20px 10px;
    font-style: italic;
}
.crash-list-lora .panel-label {
    font-weight: 600;
    color: #aaa;
    white-space: nowrap;
}
`;

class HiddenLoraWidget {
    constructor(name, value) {
        this.name = name;
        this.type = "custom";
        this.value = value || { on: true, lora: null, strength: 1.0 };
    }

    draw() {}

    computeSize() {
        return [0, -4];
    }

    serializeValue() {
        return { ...this.value };
    }
}

class ListLoraLoaderUI {
    constructor(node) {
        this.node = node;
        node.properties = node.properties || {};

        this.currentPath = node.properties.browsePath || "";
        this.searchQuery = node.properties.searchQuery || "";
        this.searchTimer = null;
        this.selected = new Map();
        this.sfw = node.properties.sfw !== false;
        this.thumbSize = clampThumbSize(node.properties.thumbSize ?? THUMB_DEFAULT);

        this.root = document.createElement("div");
        this.root.className = "crash-list-lora";
        this.applyThumbSize(this.thumbSize);

        const style = document.createElement("style");
        style.textContent = STYLES;
        this.root.appendChild(style);

        const shell = document.createElement("div");
        shell.innerHTML = `
            <div class="panel browse-panel">
                <div class="panel-header">
                    <span class="panel-label">Browse</span>
                    <div class="breadcrumbs"></div>
                    <div class="header-controls">
                        <label class="sfw-switch" title="Hide NSFW folders and their contents at any level">
                            <span class="sfw-label">SFW</span>
                            <span class="switch-track">
                                <input type="checkbox" class="sfw-checkbox" />
                                <span class="switch-thumb"></span>
                            </span>
                        </label>
                        <div class="size-control" title="Thumbnail size">
                            <span class="size-label">Size</span>
                            <input type="range" class="size-slider"
                                min="${THUMB_MIN}" max="${THUMB_MAX}" step="${THUMB_STEP}" />
                        </div>
                        <input class="search-box" type="text" placeholder="Search..." />
                    </div>
                </div>
                <div class="list-scroll browse">
                    <div class="list browse-list"></div>
                </div>
            </div>
            <div class="panel selected-panel">
                <div class="panel-header">
                    <span class="panel-label">Selected LoRAs</span>
                </div>
                <div class="list-scroll selected">
                    <div class="list selected-list"></div>
                </div>
            </div>
        `;
        this.root.appendChild(shell);

        this.browsePanel = this.root.querySelector(".browse-panel");
        this.selectedPanel = this.root.querySelector(".selected-panel");
        this.browseScroll = this.root.querySelector(".list-scroll.browse");
        this.selectedScroll = this.root.querySelector(".list-scroll.selected");
        this.breadcrumbsEl = this.root.querySelector(".breadcrumbs");
        this.searchEl = this.root.querySelector(".search-box");
        this.sfwEl = this.root.querySelector(".sfw-checkbox");
        this.sizeSliderEl = this.root.querySelector(".size-slider");
        this.browseListEl = this.root.querySelector(".browse-list");
        this.selectedListEl = this.root.querySelector(".selected-list");

        this.sfwEl.checked = this.sfw;
        this.sizeSliderEl.value = String(this.thumbSize);
        this.searchEl.value = this.searchQuery;

        this.sfwEl.addEventListener("change", () => {
            this.sfw = this.sfwEl.checked;
            if (this.sfw && isNsfwBrowsePath(this.currentPath)) {
                this.currentPath = trimNsfwBrowsePath(this.currentPath);
            }
            this.saveProperties();
            this.refreshBrowse();
        });
        this.bindPointerBlock(this.root.querySelector(".sfw-switch"));

        this.sizeSliderEl.addEventListener("input", () => {
            this.applyThumbSize(Number(this.sizeSliderEl.value));
            this.saveProperties();
        });
        this.bindPointerBlock(this.sizeSliderEl);
        this.bindPointerBlock(this.root.querySelector(".size-control"));

        this.searchEl.addEventListener("input", () => {
            clearTimeout(this.searchTimer);
            this.searchTimer = setTimeout(() => {
                this.searchQuery = this.searchEl.value.trim();
                this.saveProperties();
                this.refreshBrowse();
            }, 250);
        });
        this.bindPointerBlock(this.searchEl);
    }

    bindPointerBlock(el) {
        if (!el) return;
        el.addEventListener("pointerdown", (e) => e.stopPropagation());
        el.addEventListener("click", (e) => e.stopPropagation());
    }

    applyThumbSize(size) {
        this.thumbSize = clampThumbSize(size);
        this.root.style.setProperty("--thumb-size", `${this.thumbSize}px`);
        if (this.sizeSliderEl && this.sizeSliderEl.value !== String(this.thumbSize)) {
            this.sizeSliderEl.value = String(this.thumbSize);
        }
    }

    saveProperties() {
        const props = this.node.properties || {};
        props.sfw = this.sfw;
        props.browsePath = this.currentPath;
        props.thumbSize = this.thumbSize;
        props.searchQuery = this.searchQuery;
        this.node.properties = props;
        writeGlobalDefaults(props);
        this.node.setDirtyCanvas(true, true);
    }

    loadFromProperties(props = {}) {
        if (props.sfw !== undefined) {
            this.sfw = props.sfw !== false;
            if (this.sfwEl) this.sfwEl.checked = this.sfw;
        }
        if (props.browsePath !== undefined) {
            this.currentPath = props.browsePath || "";
        }
        if (this.sfw && isNsfwBrowsePath(this.currentPath)) {
            this.currentPath = trimNsfwBrowsePath(this.currentPath);
        }
        if (props.thumbSize !== undefined) {
            this.applyThumbSize(props.thumbSize);
        }
        if (props.searchQuery !== undefined) {
            this.searchQuery = props.searchQuery || "";
            if (this.searchEl) this.searchEl.value = this.searchQuery;
        }
    }

    setBrowsePath(path) {
        this.currentPath = path || "";
        this.searchEl.value = "";
        this.searchQuery = "";
        this.node.properties.searchQuery = "";
        this.saveProperties();
        this.refreshBrowse();
    }

    sfwParam() {
        return this.sfw ? "1" : "0";
    }

    layoutPanels(width, height) {
        const w = Math.max(width, MIN_WIDTH);
        const h = Math.max(height, MIN_HEIGHT);

        this.root.style.width = `${w}px`;
        this.root.style.height = `${h}px`;

        const browsePanelHeight = Math.floor(h * BROWSE_PANEL_RATIO);
        const selectedPanelHeight = h - browsePanelHeight - PANEL_GAP;
        const scrollHeight = (panelHeight) => Math.max(panelHeight - PANEL_HEADER_HEIGHT, 40);

        this.browsePanel.style.top = "0";
        this.browsePanel.style.height = `${browsePanelHeight}px`;
        this.browseScroll.style.top = `${PANEL_HEADER_HEIGHT}px`;
        this.browseScroll.style.height = `${scrollHeight(browsePanelHeight)}px`;

        this.selectedPanel.style.top = `${browsePanelHeight + PANEL_GAP}px`;
        this.selectedPanel.style.height = `${selectedPanelHeight}px`;
        this.selectedScroll.style.top = `${PANEL_HEADER_HEIGHT}px`;
        this.selectedScroll.style.height = `${scrollHeight(selectedPanelHeight)}px`;
    }

    async refreshBrowse() {
        if (this.searchQuery) {
            await this.renderSearch();
        } else {
            await this.renderFolder();
        }
    }

    async renderFolder() {
        try {
            const res = await fetch(
                `${API_BASE}/browse?path=${encodeURIComponent(this.currentPath)}&sfw=${this.sfwParam()}`
            );
            const data = await res.json();
            this.renderBreadcrumbs(data.breadcrumbs || []);
            this.browseListEl.innerHTML = "";

            const items = [];
            for (const folder of data.folders || []) {
                items.push({ type: "folder", ...folder });
            }
            for (const lora of data.loras || []) {
                items.push({ type: "lora", ...lora });
            }

            if (items.length === 0) {
                this.browseListEl.innerHTML = `<div class="empty-msg">No LoRAs in this folder</div>`;
                return;
            }

            for (const item of items) {
                this.browseListEl.appendChild(this.createBrowseRow(item));
            }
        } catch (err) {
            this.browseListEl.innerHTML = `<div class="empty-msg">Failed to load folder</div>`;
            console.error("[ListLoraLoader]", err);
        }
    }

    async renderSearch() {
        this.breadcrumbsEl.innerHTML = `<span style="color:#888">Search results</span>`;
        this.browseListEl.innerHTML = `<div class="empty-msg">Searching...</div>`;

        try {
            const res = await fetch(
                `${API_BASE}/search?path=${encodeURIComponent(this.currentPath)}&q=${encodeURIComponent(this.searchQuery)}&sfw=${this.sfwParam()}`
            );
            const data = await res.json();
            this.browseListEl.innerHTML = "";

            const loras = data.loras || [];
            if (loras.length === 0) {
                this.browseListEl.innerHTML = `<div class="empty-msg">No matches found</div>`;
                return;
            }

            for (const lora of loras) {
                this.browseListEl.appendChild(
                    this.createBrowseRow({ type: "lora", ...lora, showFolder: true })
                );
            }
        } catch (err) {
            this.browseListEl.innerHTML = `<div class="empty-msg">Search failed</div>`;
            console.error("[ListLoraLoader]", err);
        }
    }

    renderBreadcrumbs(crumbs) {
        this.breadcrumbsEl.innerHTML = "";
        crumbs.forEach((crumb, index) => {
            if (index > 0) {
                const sep = document.createElement("span");
                sep.className = "crumb-sep";
                sep.textContent = "/";
                this.breadcrumbsEl.appendChild(sep);
            }
            const el = document.createElement("span");
            el.className = "crumb";
            el.textContent = crumb.name;
            el.title = crumb.path || "loras";
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                this.setBrowsePath(crumb.path || "");
            });
            el.addEventListener("pointerdown", (e) => e.stopPropagation());
            this.breadcrumbsEl.appendChild(el);
        });
    }

    createThumbHtml(item) {
        if (item.type === "folder") {
            return `<div class="folder-icon">📁</div>`;
        }
        if (item.hasPreview) {
            return `<img alt="" loading="lazy" />`;
        }
        return `<div class="placeholder">🎨</div>`;
    }

    createInfoHtml(item) {
        if (item.type === "folder") {
            return `<div class="row-name" title="${item.name}">${item.name}</div>`;
        }

        const tags = formatTriggers(item.triggers);
        const tagsHtml = tags
            ? `<div class="row-tags" title="${escapeHtml(tags)}">${escapeHtml(tags)}</div>`
            : `<div class="row-tags empty"></div>`;
        const subpathHtml =
            item.showFolder && item.folder
                ? `<div class="row-subpath" title="${escapeHtml(item.folder)}">${escapeHtml(item.folder)}</div>`
                : "";

        return `
            <div class="row-name" title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</div>
            ${subpathHtml}
            ${tagsHtml}
        `;
    }

    createBrowseRow(item) {
        const el = document.createElement("div");
        el.className = `list-row${item.type === "folder" ? " folder-row" : ""}`;
        if (item.type === "lora" && this.selected.has(item.path)) {
            el.classList.add("selected");
        }

        el.innerHTML = `
            <div class="row-thumb">${this.createThumbHtml(item)}</div>
            <div class="row-info">${this.createInfoHtml(item)}</div>
        `;

        if (item.type === "folder") {
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                this.setBrowsePath(item.path);
            });
        } else {
            el.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                if (this.selected.has(item.path)) {
                    this.removeSelection(item.path);
                } else {
                    this.addSelection(item);
                }
            });
            bindLoraContextMenu(el, item.path);
            this.ensureBrowseTriggers(item, el.querySelector(".row-tags"));
            if (item.hasPreview) {
                bindPreviewImage(el.querySelector(".row-thumb img"), item.path, replaceWithPreviewPlaceholder);
            }
        }

        el.addEventListener("pointerdown", (e) => e.stopPropagation());
        return el;
    }

    async ensureBrowseTriggers(item, tagsEl) {
        if (!item?.path || !tagsEl || (item.triggers && item.triggers.length)) {
            return;
        }
        const triggers = await fetchLoraTriggers(item.path);
        if (!triggers.length) {
            return;
        }
        item.triggers = triggers;
        const tags = formatTriggers(triggers);
        tagsEl.classList.remove("empty");
        tagsEl.textContent = tags;
        tagsEl.title = tags;
    }

    addSelection(item) {
        const loraPath = item.path;
        if (this.selected.has(loraPath)) {
            return;
        }

        this.selected.set(loraPath, {
            on: true,
            lora: loraPath,
            name: item.name,
            strength: 1.0,
            triggers: item.triggers || [],
        });
        if (!item.triggers?.length) {
            fetchLoraTriggers(loraPath).then((triggers) => {
                const entry = this.selected.get(loraPath);
                if (!entry || !triggers.length) return;
                entry.triggers = triggers;
                this.renderSelected();
            });
        }

        this.syncWidgets();
        this.renderSelected();
        this.refreshBrowse();
        this.node.setDirtyCanvas(true, true);
    }

    removeSelection(loraPath) {
        if (!this.selected.has(loraPath)) return;
        this.selected.delete(loraPath);
        this.syncWidgets();
        this.renderSelected();
        this.refreshBrowse();
        this.node.setDirtyCanvas(true, true);
    }

    renderSelected() {
        this.selectedListEl.innerHTML = "";
        const entries = [...this.selected.values()];

        if (entries.length === 0) {
            this.selectedListEl.innerHTML = `<div class="empty-msg">Double-click LoRAs above to add them</div>`;
            return;
        }

        for (const entry of entries) {
            this.selectedListEl.appendChild(this.createSelectedRow(entry));
        }
    }

    createSelectedRow(entry) {
        const el = document.createElement("div");
        el.className = "list-row";
        if (!entry.on) {
            el.classList.add("disabled");
        }

        const tags = formatTriggers(entry.triggers);
        const tagsHtml = tags
            ? `<div class="row-tags" title="${escapeHtml(tags)}">${escapeHtml(tags)}</div>`
            : `<div class="row-tags empty"></div>`;

        el.innerHTML = `
            <div class="row-thumb">
                <img alt="" loading="lazy" />
                <span class="strength-badge" title="LoRA strength">${formatStrength(entry.strength)}</span>
            </div>
            <div class="row-info">
                <div class="row-name" title="${escapeHtml(entry.lora)}">${escapeHtml(entry.name || entry.lora.split("/").pop())}</div>
                ${tagsHtml}
            </div>
            <button class="cog-btn" title="Set strength">⚙</button>
        `;

        el.querySelector(".cog-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            this.promptStrength(entry, e);
        });
        el.querySelector(".cog-btn").addEventListener("pointerdown", (e) => e.stopPropagation());

        bindPreviewImage(el.querySelector(".row-thumb img"), entry.lora, replaceWithPreviewPlaceholder);

        let clickTimer = null;
        el.addEventListener("click", (e) => {
            if (e.target.classList.contains("cog-btn")) return;
            e.stopPropagation();
            if (clickTimer) clearTimeout(clickTimer);
            clickTimer = setTimeout(() => {
                clickTimer = null;
                entry.on = !entry.on;
                this.syncWidgets();
                this.renderSelected();
                this.node.setDirtyCanvas(true, true);
            }, 250);
        });
        el.addEventListener("dblclick", (e) => {
            if (e.target.classList.contains("cog-btn")) return;
            e.stopPropagation();
            if (clickTimer) {
                clearTimeout(clickTimer);
                clickTimer = null;
            }
            this.removeSelection(entry.lora);
        });

        bindLoraContextMenu(el, entry.lora, [
            null,
            {
                content: entry.on ? "⚫ Disable" : "🟢 Enable",
                callback: () => {
                    entry.on = !entry.on;
                    this.syncWidgets();
                    this.renderSelected();
                    this.node.setDirtyCanvas(true, true);
                },
            },
            {
                content: "🗑️ Remove",
                callback: () => this.removeSelection(entry.lora),
            },
        ]);

        el.addEventListener("pointerdown", (e) => e.stopPropagation());
        return el;
    }

    promptStrength(entry, event) {
        app.canvas.prompt(
            "LoRA Strength",
            entry.strength,
            (value) => {
                const num = Number(value);
                if (!Number.isNaN(num)) {
                    entry.strength = num;
                    this.syncWidgets();
                    this.renderSelected();
                    this.node.setDirtyCanvas(true, true);
                }
            },
            event
        );
    }

    syncWidgets() {
        const node = this.node;
        const domWidget = node.widgets?.find((w) => w.name === "list_lora_ui");
        const others = (node.widgets || []).filter(
            (w) => w !== domWidget && (!w.name || !w.name.startsWith("lora_"))
        );

        const loraWidgets = [];
        let counter = 0;
        for (const entry of this.selected.values()) {
            counter++;
            loraWidgets.push(
                new HiddenLoraWidget(`lora_${counter}`, {
                    on: entry.on,
                    lora: entry.lora,
                    strength: entry.strength,
                })
            );
        }

        node.widgets = domWidget ? [domWidget, ...loraWidgets, ...others] : [...loraWidgets, ...others];
    }

    async refreshSelectedTriggers() {
        const tasks = [...this.selected.values()].map(async (entry) => {
            entry.triggers = await fetchLoraTriggers(entry.lora);
        });
        await Promise.all(tasks);
        this.renderSelected();
    }

    loadFromWidgetValues(widgetValues, properties) {
        this.selected.clear();
        for (const value of widgetValues || []) {
            if (value && typeof value === "object" && value.lora) {
                const name = value.lora.split("/").pop().replace(/\.[^.]+$/, "");
                this.selected.set(value.lora, {
                    on: value.on !== false,
                    lora: value.lora,
                    name,
                    strength: value.strength ?? 1.0,
                    triggers: [],
                });
            }
        }
        this.loadFromProperties(properties ?? this.node.properties);
        this.syncWidgets();
        this.renderSelected();
        this.refreshBrowse();
        this.refreshSelectedTriggers();
    }
}

app.registerExtension({
    name: "Comfy.ListLoraLoader",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

            if (this.listLoraInitialized) return result;
            this.listLoraInitialized = true;

            this.properties = this.properties || {};
            applyGlobalDefaults(this.properties);
            if (this.properties.sfw === undefined) {
                this.properties.sfw = true;
            }
            if (this.properties.thumbSize === undefined) {
                this.properties.thumbSize = THUMB_DEFAULT;
            }
            if (this.properties.browsePath === undefined) {
                this.properties.browsePath = "";
            }
            if (this.properties.searchQuery === undefined) {
                this.properties.searchQuery = "";
            }

            this.serialize_widgets = true;
            this.widgets = this.widgets || [];
            this.resizable = true;

            const ui = new ListLoraLoaderUI(this);
            this.listLoraUI = ui;

            const nodeRef = this;
            const widget = this.addDOMWidget("list_lora_ui", "ListLoraLoader", ui.root, {
                serialize: false,
                hideOnZoom: false,
            });
            this.listLoraWidget = widget;

            widget.computeSize = function (width) {
                const nodeWidth = nodeRef.size?.[0] || width || DEFAULT_WIDTH;
                return [Math.max(MIN_WIDTH, nodeWidth - 20), DEFAULT_CONTENT_HEIGHT];
            };

            ui.refreshBrowse();
            ui.renderSelected();

            if (this._pendingLoraValues) {
                ui.loadFromWidgetValues(this._pendingLoraValues, this._pendingProperties);
                this._pendingLoraValues = null;
                this._pendingProperties = null;
            }

            requestAnimationFrame(() => {
                applyDefaultNodeSize(this);
                if (!this.listLoraWidget?.last_y) {
                    requestAnimationFrame(() => applyDefaultNodeSize(this));
                }
            });

            return result;
        };

        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size) {
            if (onResize) {
                onResize.apply(this, arguments);
            }
            syncLayoutToNode(this, size?.[1]);
        };

        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            if (onDrawForeground) {
                onDrawForeground.apply(this, arguments);
            }
            syncLayoutToNode(this);
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            const result = onConfigure ? onConfigure.apply(this, arguments) : undefined;
            const loraValues = (info.widgets_values || []).filter(
                (v) => v && typeof v === "object" && v.lora !== undefined
            );
            if (this.listLoraUI) {
                this.listLoraUI.loadFromWidgetValues(loraValues, info.properties);
                requestAnimationFrame(() => applyDefaultNodeSize(this));
            } else {
                this._pendingLoraValues = loraValues;
                this._pendingProperties = info.properties;
            }
            return result;
        };

        const origConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            if (origConfigure) {
                origConfigure.apply(this, arguments);
            }
            const loraValues = (info.widgets_values || []).filter(
                (v) => v && typeof v === "object" && v.lora !== undefined
            );
            if (this.listLoraUI) {
                this.listLoraUI.loadFromWidgetValues(loraValues, info.properties);
                requestAnimationFrame(() => applyDefaultNodeSize(this));
            } else {
                this._pendingLoraValues = loraValues;
                this._pendingProperties = info.properties;
            }
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (onRemoved) onRemoved.apply(this, arguments);
        };
    },
});
