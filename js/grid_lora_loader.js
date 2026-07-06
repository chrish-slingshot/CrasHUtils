import { app } from "../../scripts/app.js";
import { bindLoraContextMenu, fetchLoraTriggers } from "./lora_info.js";
import { bindPreviewImage, replaceWithPreviewPlaceholder } from "./lora_preview_cache.js";

const NODE_NAME = "GridLoraLoader";
const API_BASE = "/crashutils/loras";
const GRID_CELL_DEFAULT = 72;
const GRID_CELL_MIN = 48;
const GRID_CELL_MAX = 120;
const GRID_CELL_STEP = 4;
const GRID_GAP = 6;
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 540;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 300;
const PANEL_HEADER_HEIGHT = 26;
const PANEL_MIN_HEIGHT = 56;
const RESIZER_HEIGHT = 6;
const BROWSE_PANEL_RATIO = 0.5;
const SELECTED_PANEL_RATIO = 0.25;
const OPTIONAL_INPUT_SLOTS = 2;
const INPUT_SLOT_HEIGHT = 20;
const DEFAULT_CONTENT_WIDTH = DEFAULT_WIDTH - 20;
const DEFAULT_CONTENT_HEIGHT = 300;
const NODE_BOTTOM_PAD = 18;
const TITLE_BAR_FALLBACK = 30;
const WIDGET_ROW_FALLBACK = 20;
const WIDGET_ROW_GAP = 4;
const LOG_PREFIX = "[GridLoraLoader]";
const LOG_VERBOSE = false;
const STORAGE_KEY = "Comfy.GridLoraLoader.defaults";

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
                gridCellSize: props.gridCellSize,
                browsePanelRatio: props.browsePanelRatio,
                selectedPanelRatio: props.selectedPanelRatio,
            })
        );
    } catch {
        // ignore quota / private mode errors
    }
}

function applyGlobalDefaults(properties) {
    const globals = readGlobalDefaults();
    if (properties.sfw === undefined && globals.sfw !== undefined) {
        properties.sfw = globals.sfw;
    }
    if (properties.gridCellSize === undefined && globals.gridCellSize !== undefined) {
        properties.gridCellSize = globals.gridCellSize;
    }
    if (properties.browsePath === undefined && globals.browsePath !== undefined) {
        properties.browsePath = globals.browsePath;
    }
    if (properties.browsePanelRatio === undefined && globals.browsePanelRatio !== undefined) {
        properties.browsePanelRatio = globals.browsePanelRatio;
    }
    if (properties.selectedPanelRatio === undefined && globals.selectedPanelRatio !== undefined) {
        properties.selectedPanelRatio = globals.selectedPanelRatio;
    }
}

function getWidgetTop(node) {
    const domWidget = node.gridLoraWidget;
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
    if (!node?.gridLoraUI) return;
    const { w, h } = getContentArea(node, nodeHeight);
    if (node._gridLoraLayoutW === w && node._gridLoraLayoutH === h) return;
    node._gridLoraLayoutW = w;
    node._gridLoraLayoutH = h;
    node.gridLoraUI.layoutPanels(w, h);
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

const _logCounts = new Map();

function gridLog(node, event, details = {}) {
    const nodeId = node?.id ?? "new";
    const key = `${nodeId}:${event}`;
    const count = (_logCounts.get(key) || 0) + 1;
    _logCounts.set(key, count);

    const root = node?.gridLoraUI?.root;
    const payload = {
        count,
        nodeId,
        nodeSize: node?.size ? [node.size[0], node.size[1]] : null,
        layoutW: node?._gridLoraLayoutW,
        layoutH: node?._gridLoraLayoutH,
        widgetTop: getWidgetTop(node),
        widgetCount: node?.widgets?.length ?? 0,
        widgetNames: node?.widgets?.map((w) => w.name),
        ...details,
    };

    if (root) {
        payload.dom = {
            styleWidth: root.style.width,
            styleHeight: root.style.height,
            offsetWidth: root.offsetWidth,
            offsetHeight: root.offsetHeight,
            scrollWidth: root.scrollWidth,
            scrollHeight: root.scrollHeight,
            clientHeight: root.clientHeight,
        };
        if (node.gridLoraUI.browseScroll) {
            payload.browseScrollH = node.gridLoraUI.browseScroll.scrollHeight;
        }
    }

    console.log(LOG_PREFIX, event, payload);

    if (!LOG_VERBOSE && count > 3) {
        return;
    }
}

function gridLogSizeDelta(node, event, before, after) {
    if (!LOG_VERBOSE || !before || !after) return;
    if (after[0] > before[0] + 2 || after[1] > before[1] + 2) {
        console.warn(LOG_PREFIX, "SIZE INCREASED", event, {
            nodeId: node?.id,
            before: [...before],
            after: [...after],
            delta: [after[0] - before[0], after[1] - before[1]],
        });
    }
}

const STYLES = `
.crash-grid-lora {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 11px;
    color: #ccc;
    user-select: none;
    box-sizing: border-box;
    overflow: hidden;
    position: relative;
}
.crash-grid-lora * { box-sizing: border-box; }
.crash-grid-lora .panel {
    border: 1px solid #555;
    border-radius: 4px;
    background: #2a2a2a;
    overflow: hidden;
    position: absolute;
    left: 0;
    right: 0;
}
.crash-grid-lora .panel-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    background: #333;
    border-bottom: 1px solid #555;
    height: ${PANEL_HEADER_HEIGHT}px;
}
.crash-grid-lora .breadcrumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    flex: 1;
    min-width: 0;
}
.crash-grid-lora .crumb {
    color: #8af;
    cursor: pointer;
    white-space: nowrap;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
}
.crash-grid-lora .crumb:hover { text-decoration: underline; }
.crash-grid-lora .crumb-sep { color: #666; margin: 0 1px; }
.crash-grid-lora .search-box {
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
.crash-grid-lora .search-box:focus { border-color: #8af; }
.crash-grid-lora .header-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}
.crash-grid-lora .sfw-switch {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    flex-shrink: 0;
}
.crash-grid-lora .sfw-label {
    color: #aaa;
    font-size: 10px;
    white-space: nowrap;
}
.crash-grid-lora .switch-track {
    position: relative;
    width: 32px;
    height: 16px;
    flex-shrink: 0;
}
.crash-grid-lora .switch-track input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    margin: 0;
}
.crash-grid-lora .switch-thumb {
    position: absolute;
    inset: 0;
    background: #555;
    border-radius: 999px;
    transition: background 0.15s;
}
.crash-grid-lora .switch-thumb::after {
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
.crash-grid-lora .switch-track input:checked + .switch-thumb {
    background: #4a9;
}
.crash-grid-lora .switch-track input:checked + .switch-thumb::after {
    transform: translateX(16px);
}
.crash-grid-lora .size-control {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
}
.crash-grid-lora .size-label {
    color: #aaa;
    font-size: 10px;
    white-space: nowrap;
}
.crash-grid-lora .size-slider {
    width: 56px;
    height: 14px;
    margin: 0;
    accent-color: #8af;
    cursor: pointer;
}
.crash-grid-lora .grid-scroll {
    overflow-y: auto;
    overflow-x: hidden;
    padding: 6px;
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
}
.crash-grid-lora .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--grid-cell-size, 72px), 1fr));
    gap: ${GRID_GAP}px;
}
.crash-grid-lora .grid-item {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border: 2px solid #444;
    border-radius: 4px;
    background: #1e1e1e;
    cursor: pointer;
    overflow: hidden;
    transition: border-color 0.15s, opacity 0.15s;
}
.crash-grid-lora .grid-item:hover { border-color: #8af; }
.crash-grid-lora .grid-item.selected { border-color: #6c6; }
.crash-grid-lora .grid-item.disabled { opacity: 0.35; }
.crash-grid-lora .grid-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.crash-grid-lora .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: calc(var(--grid-cell-size, 72px) * 0.39);
}
.crash-grid-lora .folder-icon {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: calc(var(--grid-cell-size, 72px) * 0.44);
}
.crash-grid-lora .item-label {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 3px;
    background: rgba(0,0,0,0.75);
    font-size: 9px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.crash-grid-lora .cog-btn {
    position: absolute;
    top: 2px;
    right: 2px;
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
.crash-grid-lora .cog-btn:hover { background: rgba(50,50,50,0.95); color: #fff; }
.crash-grid-lora .strength-badge {
    position: absolute;
    top: 2px;
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
.crash-grid-lora .empty-msg {
    color: #666;
    text-align: center;
    padding: 20px 10px;
    font-style: italic;
}
.crash-grid-lora .panel-label {
    font-weight: 600;
    color: #aaa;
    white-space: nowrap;
}
.crash-grid-lora .search-folder {
    font-size: 9px;
    color: #888;
    margin-top: 1px;
}
.crash-grid-lora .tags-scroll {
    overflow-y: auto;
    overflow-x: hidden;
    padding: 6px;
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
}
.crash-grid-lora .tags-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-content: flex-start;
}
.crash-grid-lora .tag-chip {
    border: 1px solid #555;
    border-radius: 999px;
    background: #1f1f1f;
    color: #aaa;
    font-size: 10px;
    line-height: 1.2;
    padding: 3px 8px;
    cursor: pointer;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: border-color 0.15s, background 0.15s, color 0.15s, opacity 0.15s;
}
.crash-grid-lora .tag-chip.on {
    border-color: #6c6;
    background: #243024;
    color: #cfc;
}
.crash-grid-lora .tag-chip.off {
    opacity: 0.45;
}
.crash-grid-lora .tag-chip:hover {
    border-color: #8af;
}
.crash-grid-lora .panel-resizer {
    position: absolute;
    left: 0;
    right: 0;
    height: ${RESIZER_HEIGHT}px;
    cursor: ns-resize;
    z-index: 6;
    touch-action: none;
    background: transparent;
}
.crash-grid-lora .panel-resizer::after {
    content: "";
    position: absolute;
    left: 20%;
    right: 20%;
    top: 50%;
    height: 2px;
    transform: translateY(-50%);
    border-radius: 999px;
    background: #555;
    opacity: 0.6;
    transition: background 0.15s, opacity 0.15s;
}
.crash-grid-lora .panel-resizer:hover::after,
.crash-grid-lora .panel-resizer.dragging::after {
    background: #8af;
    opacity: 1;
}
`;

function formatStrength(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return "?";
    if (Number.isInteger(num)) return String(num);
    return num.toFixed(2).replace(/\.?0+$/, "");
}

function formatTriggers(triggers) {
    if (!triggers?.length) return "";
    return triggers.join(", ");
}

function triggerTitle(item) {
    const tags = formatTriggers(item.triggers);
    if (!tags) return item.path || item.name || "";
    return `${item.name || item.path}\n${tags}`;
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

function initEntryTriggers(entry, triggers) {
    entry.triggers = [...(triggers || [])];
    entry.triggerOn = entry.triggerOn || {};
    for (const word of entry.triggers) {
        if (entry.triggerOn[word] === undefined) {
            entry.triggerOn[word] = true;
        }
    }
    for (const word of Object.keys(entry.triggerOn)) {
        if (!entry.triggers.includes(word)) {
            delete entry.triggerOn[word];
        }
    }
}

function entryTriggerStates(entry) {
    return (entry.triggers || []).map((word) => ({
        word,
        on: entry.triggerOn?.[word] !== false,
    }));
}

function isTagEnabledForEntry(entry, word) {
    return entry.triggerOn?.[word] !== false;
}

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

function clampPanelRatio(value, fallback) {
    const num = Number(value);
    if (Number.isNaN(num)) {
        return fallback;
    }
    return Math.min(0.85, Math.max(0.1, num));
}

function normalizePanelRatios(browseRatio, selectedRatio) {
    let browse = clampPanelRatio(browseRatio, BROWSE_PANEL_RATIO);
    let selected = clampPanelRatio(selectedRatio, SELECTED_PANEL_RATIO);
    const minThird = 0.1;

    if (browse + selected > 1 - minThird) {
        const scale = (1 - minThird) / (browse + selected);
        browse *= scale;
        selected *= scale;
    }

    return { browse, selected };
}

function computePanelHeights(totalHeight) {
    return Math.max(totalHeight - RESIZER_HEIGHT * 2, PANEL_MIN_HEIGHT * 3);
}

function clampGridCellSize(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return GRID_CELL_DEFAULT;
    return Math.min(GRID_CELL_MAX, Math.max(GRID_CELL_MIN, Math.round(num / GRID_CELL_STEP) * GRID_CELL_STEP));
}

class GridLoraLoaderUI {
    constructor(node) {
        this.node = node;
        node.properties = node.properties || {};

        this.currentPath = node.properties.browsePath || "";
        this.searchQuery = node.properties.searchQuery || "";
        this.searchTimer = null;
        this.selected = new Map();
        this.sfw = node.properties.sfw !== false;
        this.gridCellSize = clampGridCellSize(node.properties.gridCellSize ?? GRID_CELL_DEFAULT);
        const ratios = normalizePanelRatios(
            node.properties.browsePanelRatio ?? BROWSE_PANEL_RATIO,
            node.properties.selectedPanelRatio ?? SELECTED_PANEL_RATIO
        );
        this.browseRatio = ratios.browse;
        this.selectedRatio = ratios.selected;

        this.root = document.createElement("div");
        this.root.className = "crash-grid-lora";
        this.applyGridCellSize(this.gridCellSize);

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
                                min="${GRID_CELL_MIN}" max="${GRID_CELL_MAX}" step="${GRID_CELL_STEP}" />
                        </div>
                        <input class="search-box" type="text" placeholder="Search..." />
                    </div>
                </div>
                <div class="grid-scroll browse">
                    <div class="grid browse-grid"></div>
                </div>
            </div>
            <div class="panel selected-panel">
                <div class="panel-header">
                    <span class="panel-label">Selected LoRAs</span>
                </div>
                <div class="grid-scroll selected">
                    <div class="grid selected-grid"></div>
                </div>
            </div>
            <div class="panel tags-panel">
                <div class="panel-header">
                    <span class="panel-label">Trigger Tags</span>
                </div>
                <div class="tags-scroll">
                    <div class="tags-list"></div>
                </div>
            </div>
        `;
        this.root.appendChild(shell);

        this.resizerBrowseSelected = document.createElement("div");
        this.resizerBrowseSelected.className = "panel-resizer";
        this.resizerBrowseSelected.title = "Drag to resize panels";
        this.resizerSelectedTags = document.createElement("div");
        this.resizerSelectedTags.className = "panel-resizer";
        this.resizerSelectedTags.title = "Drag to resize panels";
        this.root.appendChild(this.resizerBrowseSelected);
        this.root.appendChild(this.resizerSelectedTags);

        this.browsePanel = this.root.querySelector(".browse-panel");
        this.selectedPanel = this.root.querySelector(".selected-panel");
        this.tagsPanel = this.root.querySelector(".tags-panel");
        this.browseScroll = this.root.querySelector(".grid-scroll.browse");
        this.selectedScroll = this.root.querySelector(".grid-scroll.selected");
        this.tagsScroll = this.root.querySelector(".tags-scroll");
        this.breadcrumbsEl = this.root.querySelector(".breadcrumbs");
        this.searchEl = this.root.querySelector(".search-box");
        this.sfwEl = this.root.querySelector(".sfw-checkbox");
        this.sizeSliderEl = this.root.querySelector(".size-slider");
        this.browseGridEl = this.root.querySelector(".browse-grid");
        this.selectedGridEl = this.root.querySelector(".selected-grid");
        this.tagsListEl = this.root.querySelector(".tags-list");

        this.sfwEl.checked = this.sfw;
        this.sizeSliderEl.value = String(this.gridCellSize);
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
            this.applyGridCellSize(Number(this.sizeSliderEl.value));
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

        this.setupPanelResizers();
    }

    setupPanelResizers() {
        this.bindPanelResizer(this.resizerBrowseSelected, "browse-selected");
        this.bindPanelResizer(this.resizerSelectedTags, "selected-tags");
    }

    bindPanelResizer(handle, mode) {
        handle.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            handle.setPointerCapture(e.pointerId);
            handle.classList.add("dragging");

            const totalH = this.root.clientHeight;
            const available = computePanelHeights(totalH);
            const startY = e.clientY;
            const startBrowse = this.browseRatio * available;
            const startSelected = this.selectedRatio * available;
            const startTags = available - startBrowse - startSelected;

            const onMove = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const delta = ev.clientY - startY;
                let browse = startBrowse;
                let selected = startSelected;
                let tags = startTags;

                if (mode === "browse-selected") {
                    browse = Math.max(
                        PANEL_MIN_HEIGHT,
                        Math.min(startBrowse + delta, available - startTags - PANEL_MIN_HEIGHT)
                    );
                    selected = available - startTags - browse;
                } else {
                    selected = Math.max(
                        PANEL_MIN_HEIGHT,
                        Math.min(startSelected + delta, available - startBrowse - PANEL_MIN_HEIGHT)
                    );
                    tags = available - startBrowse - selected;
                }

                this.browseRatio = browse / available;
                this.selectedRatio = selected / available;
                this.applyPanelSizes(
                    Math.max(this.root.clientWidth, MIN_WIDTH),
                    totalH,
                    browse,
                    selected,
                    tags
                );
            };

            const onUp = (ev) => {
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onUp);
                handle.removeEventListener("pointercancel", onUp);
                handle.classList.remove("dragging");
                try {
                    handle.releasePointerCapture(ev.pointerId);
                } catch {
                    // ignore
                }
                this.saveProperties();
            };

            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onUp);
            handle.addEventListener("pointercancel", onUp);
        });
    }

    bindPointerBlock(el) {
        if (!el) return;
        el.addEventListener("pointerdown", (e) => e.stopPropagation());
        el.addEventListener("click", (e) => e.stopPropagation());
    }

    applyGridCellSize(size) {
        this.gridCellSize = clampGridCellSize(size);
        this.root.style.setProperty("--grid-cell-size", `${this.gridCellSize}px`);
        if (this.sizeSliderEl && this.sizeSliderEl.value !== String(this.gridCellSize)) {
            this.sizeSliderEl.value = String(this.gridCellSize);
        }
    }

    saveProperties() {
        const props = this.node.properties || {};
        props.sfw = this.sfw;
        props.browsePath = this.currentPath;
        props.gridCellSize = this.gridCellSize;
        props.searchQuery = this.searchQuery;
        props.browsePanelRatio = this.browseRatio;
        props.selectedPanelRatio = this.selectedRatio;
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
        if (props.gridCellSize !== undefined) {
            this.applyGridCellSize(props.gridCellSize);
        }
        if (props.searchQuery !== undefined) {
            this.searchQuery = props.searchQuery || "";
            if (this.searchEl) this.searchEl.value = this.searchQuery;
        }
        if (props.browsePanelRatio !== undefined || props.selectedPanelRatio !== undefined) {
            const ratios = normalizePanelRatios(
                props.browsePanelRatio ?? this.browseRatio,
                props.selectedPanelRatio ?? this.selectedRatio
            );
            this.browseRatio = ratios.browse;
            this.selectedRatio = ratios.selected;
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
        gridLog(this.node, "layoutPanels", { width, height, appliedW: w, appliedH: h });

        this.root.style.width = `${w}px`;
        this.root.style.height = `${h}px`;

        const available = computePanelHeights(h);
        let browse = Math.floor(available * this.browseRatio);
        let selected = Math.floor(available * this.selectedRatio);
        let tags = available - browse - selected;

        browse = Math.max(PANEL_MIN_HEIGHT, browse);
        selected = Math.max(PANEL_MIN_HEIGHT, selected);
        tags = Math.max(PANEL_MIN_HEIGHT, tags);

        const overflow = browse + selected + tags - available;
        if (overflow > 0) {
            tags = Math.max(PANEL_MIN_HEIGHT, tags - overflow);
        }

        this.applyPanelSizes(w, h, browse, selected, tags);
    }

    applyPanelSizes(width, height, browseHeight, selectedHeight, tagsHeight) {
        const scrollHeight = (panelHeight) => Math.max(panelHeight - PANEL_HEADER_HEIGHT, 40);

        this.browsePanel.style.top = "0";
        this.browsePanel.style.height = `${browseHeight}px`;
        this.browseScroll.style.top = `${PANEL_HEADER_HEIGHT}px`;
        this.browseScroll.style.height = `${scrollHeight(browseHeight)}px`;

        const selectedTop = browseHeight + RESIZER_HEIGHT;
        this.resizerBrowseSelected.style.top = `${browseHeight}px`;
        this.resizerBrowseSelected.style.height = `${RESIZER_HEIGHT}px`;

        this.selectedPanel.style.top = `${selectedTop}px`;
        this.selectedPanel.style.height = `${selectedHeight}px`;
        this.selectedScroll.style.top = `${PANEL_HEADER_HEIGHT}px`;
        this.selectedScroll.style.height = `${scrollHeight(selectedHeight)}px`;

        const tagsTop = selectedTop + selectedHeight + RESIZER_HEIGHT;
        this.resizerSelectedTags.style.top = `${selectedTop + selectedHeight}px`;
        this.resizerSelectedTags.style.height = `${RESIZER_HEIGHT}px`;

        this.tagsPanel.style.top = `${tagsTop}px`;
        this.tagsPanel.style.height = `${tagsHeight}px`;
        this.tagsScroll.style.top = `${PANEL_HEADER_HEIGHT}px`;
        this.tagsScroll.style.height = `${scrollHeight(tagsHeight)}px`;
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
            this.browseGridEl.innerHTML = "";

            const items = [];
            for (const folder of data.folders || []) {
                items.push({ type: "folder", ...folder });
            }
            for (const lora of data.loras || []) {
                items.push({ type: "lora", ...lora });
            }

            if (items.length === 0) {
                this.browseGridEl.innerHTML = `<div class="empty-msg">No LoRAs in this folder</div>`;
                return;
            }

            for (const item of items) {
                this.browseGridEl.appendChild(this.createBrowseItem(item));
            }
        } catch (err) {
            this.browseGridEl.innerHTML = `<div class="empty-msg">Failed to load folder</div>`;
            console.error("[GridLoraLoader]", err);
        }
    }

    async renderSearch() {
        this.breadcrumbsEl.innerHTML = `<span style="color:#888">Search results</span>`;
        this.browseGridEl.innerHTML = `<div class="empty-msg">Searching...</div>`;

        try {
            const res = await fetch(
                `${API_BASE}/search?path=${encodeURIComponent(this.currentPath)}&q=${encodeURIComponent(this.searchQuery)}&sfw=${this.sfwParam()}`
            );
            const data = await res.json();
            this.browseGridEl.innerHTML = "";

            const loras = data.loras || [];
            if (loras.length === 0) {
                this.browseGridEl.innerHTML = `<div class="empty-msg">No matches found</div>`;
                return;
            }

            for (const lora of loras) {
                this.browseGridEl.appendChild(this.createBrowseItem({ type: "lora", ...lora, showFolder: true }));
            }
        } catch (err) {
            this.browseGridEl.innerHTML = `<div class="empty-msg">Search failed</div>`;
            console.error("[GridLoraLoader]", err);
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

    createBrowseItem(item) {
        const el = document.createElement("div");
        el.className = "grid-item";
        if (item.type === "lora" && this.selected.has(item.path)) {
            el.classList.add("selected");
        }

        if (item.type === "folder") {
            el.innerHTML = `
                <div class="folder-icon">📁</div>
                <div class="item-label" title="${item.name}">${item.name}</div>
            `;
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                this.setBrowsePath(item.path);
            });
        } else {
            const imgHtml = item.hasPreview
                ? `<img alt="" loading="lazy" />`
                : `<div class="placeholder">🎨</div>`;
            el.innerHTML = `
                ${imgHtml}
                <div class="item-label" title="${triggerTitle(item)}">${item.name}</div>
            `;
            if (item.showFolder && item.folder) {
                const label = el.querySelector(".item-label");
                label.innerHTML = `${item.name}<div class="search-folder">${item.folder}</div>`;
            }
            el.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                if (this.selected.has(item.path)) {
                    this.removeSelection(item.path);
                } else {
                    this.addSelection(item);
                }
            });
            bindLoraContextMenu(el, item.path);
            this.ensureBrowseTriggers(item, el);
            if (item.hasPreview) {
                bindPreviewImage(el.querySelector("img"), item.path, replaceWithPreviewPlaceholder);
            }
        }

        el.addEventListener("pointerdown", (e) => e.stopPropagation());
        return el;
    }

    async ensureBrowseTriggers(item, el) {
        if (!item?.path || !el || (item.triggers && item.triggers.length)) {
            return;
        }
        const triggers = await fetchLoraTriggers(item.path);
        if (!triggers.length) {
            return;
        }
        item.triggers = triggers;
        const label = el.querySelector(".item-label");
        if (label) {
            label.title = triggerTitle(item);
        }
    }

    addSelection(item) {
        const loraPath = item.path;
        const loraName = item.name;
        if (this.selected.has(loraPath)) {
            return;
        }

        this.selected.set(loraPath, {
            on: true,
            lora: loraPath,
            name: loraName,
            strength: 1.0,
            triggers: item.triggers || [],
            triggerOn: {},
        });
        initEntryTriggers(this.selected.get(loraPath), item.triggers || []);
        if (!item.triggers?.length) {
            fetchLoraTriggers(loraPath).then((triggers) => {
                const entry = this.selected.get(loraPath);
                if (!entry || !triggers.length) return;
                initEntryTriggers(entry, triggers);
                this.renderSelected();
                this.renderTags();
                this.syncWidgets();
            });
        }

        this.syncWidgets();
        this.renderSelected();
        this.renderTags();
        this.refreshBrowse();
        this.node.setDirtyCanvas(true, true);
    }

    removeSelection(loraPath) {
        if (!this.selected.has(loraPath)) return;
        this.selected.delete(loraPath);
        this.syncWidgets();
        this.renderSelected();
        this.renderTags();
        this.refreshBrowse();
        this.node.setDirtyCanvas(true, true);
    }

    renderSelected() {
        this.selectedGridEl.innerHTML = "";
        const entries = [...this.selected.values()];

        if (entries.length === 0) {
            this.selectedGridEl.innerHTML = `<div class="empty-msg">Double-click LoRAs above to add them</div>`;
            return;
        }

        for (const entry of entries) {
            this.selectedGridEl.appendChild(this.createSelectedItem(entry));
        }
    }

    createSelectedItem(entry) {
        const el = document.createElement("div");
        el.className = "grid-item";
        if (!entry.on) {
            el.classList.add("disabled");
        }

        el.innerHTML = `
            <img alt="" loading="lazy" />
            <span class="strength-badge" title="LoRA strength">${formatStrength(entry.strength)}</span>
            <button class="cog-btn" title="Set strength">⚙</button>
            <div class="item-label" title="${formatTriggers(entry.triggers) || entry.lora}">${entry.name || entry.lora.split("/").pop()}</div>
        `;

        bindPreviewImage(el.querySelector("img"), entry.lora, replaceWithPreviewPlaceholder);

        el.querySelector(".cog-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            this.promptStrength(entry, e);
        });
        el.querySelector(".cog-btn").addEventListener("pointerdown", (e) => e.stopPropagation());

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
                this.renderTags();
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
                    this.renderTags();
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

    collectVisibleTags() {
        const tags = new Map();

        for (const entry of this.selected.values()) {
            if (!entry.on) {
                continue;
            }
            for (const word of entry.triggers || []) {
                const key = word.toLowerCase();
                if (!tags.has(key)) {
                    tags.set(key, {
                        word,
                        enabled: isTagEnabledForEntry(entry, word),
                        sources: [],
                    });
                }
                const tag = tags.get(key);
                tag.sources.push(entry);
                tag.enabled = tag.sources.every((source) => isTagEnabledForEntry(source, word));
            }
        }

        return [...tags.values()].sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: "base" }));
    }

    setTagEnabled(word, enabled) {
        const key = word.toLowerCase();
        for (const entry of this.selected.values()) {
            if (!entry.on) {
                continue;
            }
            for (const trigger of entry.triggers || []) {
                if (trigger.toLowerCase() === key) {
                    entry.triggerOn[trigger] = enabled;
                }
            }
        }
    }

    renderTags() {
        if (!this.tagsListEl) {
            return;
        }

        this.tagsListEl.innerHTML = "";
        const tags = this.collectVisibleTags();

        if (tags.length === 0) {
            const empty = document.createElement("div");
            empty.className = "empty-msg";
            empty.textContent = this.selected.size
                ? "No trigger tags for enabled LoRAs"
                : "Add LoRAs to see trigger tags";
            this.tagsListEl.appendChild(empty);
            return;
        }

        for (const tag of tags) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = `tag-chip${tag.enabled ? " on" : " off"}`;
            chip.textContent = tag.word;
            chip.title = tag.sources.map((entry) => entry.name || entry.lora).join(", ");
            chip.addEventListener("click", (e) => {
                e.stopPropagation();
                this.setTagEnabled(tag.word, !tag.enabled);
                this.renderTags();
                this.syncWidgets();
                this.node.setDirtyCanvas(true, true);
            });
            chip.addEventListener("pointerdown", (e) => e.stopPropagation());
            this.tagsListEl.appendChild(chip);
        }
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
        gridLog(node, "syncWidgets", { selectedCount: this.selected.size });

        const domWidget = node.widgets?.find((w) => w.name === "grid_lora_ui");
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
                    triggerStates: entryTriggerStates(entry),
                })
            );
        }

        node.widgets = domWidget ? [domWidget, ...loraWidgets, ...others] : [...loraWidgets, ...others];
    }

    async refreshSelectedTriggers() {
        const tasks = [...this.selected.values()].map(async (entry) => {
            initEntryTriggers(entry, await fetchLoraTriggers(entry.lora));
        });
        await Promise.all(tasks);
        this.renderSelected();
        this.renderTags();
        this.syncWidgets();
    }

    loadFromWidgetValues(widgetValues, properties) {
        this.selected.clear();
        for (const value of widgetValues || []) {
            if (value && typeof value === "object" && value.lora) {
                const name = value.lora.split("/").pop().replace(/\.[^.]+$/, "");
                const entry = {
                    on: value.on !== false,
                    lora: value.lora,
                    name,
                    strength: value.strength ?? 1.0,
                    triggers: [],
                    triggerOn: {},
                };
                if (Array.isArray(value.triggerStates)) {
                    entry.triggers = value.triggerStates.map((item) => item.word).filter(Boolean);
                    entry.triggerOn = Object.fromEntries(
                        value.triggerStates
                            .filter((item) => item?.word)
                            .map((item) => [item.word, item.on !== false])
                    );
                }
                this.selected.set(value.lora, entry);
            }
        }
        this.loadFromProperties(properties ?? this.node.properties);
        this.syncWidgets();
        this.renderSelected();
        this.renderTags();
        this.refreshBrowse();
        this.refreshSelectedTriggers();
    }
}

app.registerExtension({
    name: "Comfy.GridLoraLoader",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

            if (this.gridLoraInitialized) return result;
            this.gridLoraInitialized = true;

            gridLog(this, "onNodeCreated start");

            this.properties = this.properties || {};
            applyGlobalDefaults(this.properties);
            if (this.properties.sfw === undefined) {
                this.properties.sfw = true;
            }
            if (this.properties.gridCellSize === undefined) {
                this.properties.gridCellSize = GRID_CELL_DEFAULT;
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

            const ui = new GridLoraLoaderUI(this);
            this.gridLoraUI = ui;

            const nodeRef = this;
            const widget = this.addDOMWidget("grid_lora_ui", "GridLoraLoader", ui.root, {
                serialize: false,
                hideOnZoom: false,
            });
            this.gridLoraWidget = widget;

            widget.computeSize = function (width) {
                const nodeWidth = nodeRef.size?.[0] || width || DEFAULT_WIDTH;
                return [Math.max(MIN_WIDTH, nodeWidth - 20), DEFAULT_CONTENT_HEIGHT];
            };

            ui.refreshBrowse();
            ui.renderSelected();
            ui.renderTags();

            if (this._pendingLoraValues) {
                ui.loadFromWidgetValues(this._pendingLoraValues, this._pendingProperties);
                this._pendingLoraValues = null;
                this._pendingProperties = null;
            }

            requestAnimationFrame(() => {
                applyDefaultNodeSize(this);
                if (!this.gridLoraWidget?.last_y) {
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
            if (this.gridLoraUI) {
                this.gridLoraUI.loadFromWidgetValues(loraValues, info.properties);
                requestAnimationFrame(() => applyDefaultNodeSize(this));
            } else {
                this._pendingLoraValues = loraValues;
                this._pendingProperties = info.properties;
            }
            return result;
        };

        const origConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            gridLog(this, "configure", {
                widgetValueCount: info?.widgets_values?.length ?? 0,
            });
            if (origConfigure) {
                origConfigure.apply(this, arguments);
            }
            const loraValues = (info.widgets_values || []).filter(
                (v) => v && typeof v === "object" && v.lora !== undefined
            );
            if (this.gridLoraUI) {
                this.gridLoraUI.loadFromWidgetValues(loraValues, info.properties);
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
