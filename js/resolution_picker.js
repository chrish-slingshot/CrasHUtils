import { app } from "../../scripts/app.js";

const NODE_NAME = "ResolutionPicker";
const DEFAULT_RESOLUTION = "1280x1280";
const RESOLUTIONS = [
    { label: "1440 × 868", value: "1440x868", width: 1440, height: 868 },
    { label: "1440 × 1040", value: "1440x1040", width: 1440, height: 1040 },
    { label: "1280 × 1280", value: "1280x1280", width: 1280, height: 1280 },
    { label: "1040 × 1440", value: "1040x1440", width: 1040, height: 1440 },
    { label: "868 × 1440", value: "868x1440", width: 868, height: 1440 },
];
const PREVIEW_MAX = 28;
const DEFAULT_NODE_WIDTH = 220;
const ROW_HEIGHT = 36;
const DEFAULT_CONTENT_HEIGHT = RESOLUTIONS.length * ROW_HEIGHT + 8;
const DEFAULT_NODE_HEIGHT = 30 + DEFAULT_CONTENT_HEIGHT + 18;
const MIN_NODE_WIDTH = 180;
const MIN_CONTENT_HEIGHT = 120;
const NODE_BOTTOM_PAD = 18;
const TITLE_BAR_FALLBACK = 30;
const WIDGET_ROW_FALLBACK = 20;
const WIDGET_ROW_GAP = 4;

const STYLES = `
.crash-resolution-picker {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 11px;
    color: #ccc;
    user-select: none;
    box-sizing: border-box;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}
.crash-resolution-picker * { box-sizing: border-box; }
.crash-resolution-picker .resolution-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
}
.crash-resolution-picker .resolution-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border: 1px solid #444;
    border-radius: 4px;
    background: #1e1e1e;
    cursor: pointer;
    flex-shrink: 0;
    min-height: ${ROW_HEIGHT - 4}px;
    transition: border-color 0.15s, background 0.15s;
}
.crash-resolution-picker .resolution-row:hover {
    border-color: #8af;
}
.crash-resolution-picker .resolution-row.selected {
    border-color: #6c6;
    background: #263026;
}
.crash-resolution-picker .preview-box {
    flex-shrink: 0;
    border: 1px solid #666;
    border-radius: 2px;
    background: #333;
}
.crash-resolution-picker .resolution-label {
    flex: 1;
    font-weight: 600;
    color: #ddd;
    white-space: nowrap;
}
`;

function previewSize(width, height) {
    const scale = PREVIEW_MAX / Math.max(width, height);
    return {
        w: Math.max(8, Math.round(width * scale)),
        h: Math.max(8, Math.round(height * scale)),
    };
}

function hideWidget(widget) {
    if (!widget) return;
    widget.hidden = true;
    widget.type = "hidden";
    widget.computeSize = () => [0, -4];
}

class ResolutionPickerUI {
    constructor(node, resolutionWidget) {
        this.node = node;
        this.resolutionWidget = resolutionWidget;

        this.root = document.createElement("div");
        this.root.className = "crash-resolution-picker";

        const style = document.createElement("style");
        style.textContent = STYLES;
        this.root.appendChild(style);

        const list = document.createElement("div");
        list.className = "resolution-list";
        this.root.appendChild(list);
        this.listEl = list;

        for (const option of RESOLUTIONS) {
            list.appendChild(this.createRow(option));
        }

        this.setSelection(this.getCurrentValue(), false);
    }

    getCurrentValue() {
        return this.resolutionWidget?.value || this.node.properties?.resolution || DEFAULT_RESOLUTION;
    }

    createRow(option) {
        const { w, h } = previewSize(option.width, option.height);
        const el = document.createElement("div");
        el.className = "resolution-row";
        el.dataset.value = option.value;
        el.innerHTML = `
            <div class="preview-box" style="width:${w}px;height:${h}px"></div>
            <span class="resolution-label">${option.label}</span>
        `;
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            this.setSelection(option.value, true);
        });
        el.addEventListener("pointerdown", (e) => e.stopPropagation());
        return el;
    }

    setSelection(value, markDirty) {
        const resolved = RESOLUTIONS.some((o) => o.value === value) ? value : DEFAULT_RESOLUTION;
        this.resolutionWidget.value = resolved;
        this.node.properties = this.node.properties || {};
        this.node.properties.resolution = resolved;

        for (const row of this.listEl.querySelectorAll(".resolution-row")) {
            row.classList.toggle("selected", row.dataset.value === resolved);
        }

        if (markDirty) {
            this.node.setDirtyCanvas(true, true);
        }
    }

    loadFromProperties(props = {}) {
        if (props.resolution) {
            this.setSelection(props.resolution, false);
        }
    }

    layoutPanels(width, height) {
        const w = Math.max(MIN_NODE_WIDTH, width);
        const h = Math.max(MIN_CONTENT_HEIGHT, height);
        this.root.style.width = `${w}px`;
        this.root.style.height = `${h}px`;
    }
}

function getWidgetTop(node) {
    const domWidget = node.resolutionPickerWidget;
    if (domWidget?.last_y != null && domWidget.last_y > 0) {
        return domWidget.last_y;
    }

    let yOffset = TITLE_BAR_FALLBACK;
    for (const widget of node.widgets || []) {
        if (widget === domWidget) break;
        if (widget.hidden || widget.type === "hidden") continue;
        if (widget.computeSize) {
            const [, widgetHeight] = widget.computeSize();
            yOffset += Math.max(widgetHeight, 0) + WIDGET_ROW_GAP;
        } else {
            yOffset += WIDGET_ROW_FALLBACK + WIDGET_ROW_GAP;
        }
    }
    return yOffset;
}

function getContentArea(node, nodeHeight) {
    const widgetY = getWidgetTop(node);
    const totalH = nodeHeight ?? node.size?.[1] ?? DEFAULT_NODE_HEIGHT;
    return {
        w: Math.max(MIN_NODE_WIDTH, (node.size?.[0] || DEFAULT_NODE_WIDTH) - 20),
        h: Math.max(MIN_CONTENT_HEIGHT, totalH - widgetY - NODE_BOTTOM_PAD),
    };
}

function syncLayoutToNode(node, nodeHeight) {
    if (!node?.resolutionPickerUI) return;
    const { w, h } = getContentArea(node, nodeHeight);
    if (node._resolutionPickerLayoutW === w && node._resolutionPickerLayoutH === h) return;
    node._resolutionPickerLayoutW = w;
    node._resolutionPickerLayoutH = h;
    node.resolutionPickerUI.layoutPanels(w, h);
}

function getMinimumNodeSize(node) {
    const widgetY = getWidgetTop(node);
    return [
        Math.max(MIN_NODE_WIDTH + 20, DEFAULT_NODE_WIDTH),
        widgetY + DEFAULT_CONTENT_HEIGHT + NODE_BOTTOM_PAD,
    ];
}

function applyDefaultNodeSize(node) {
    if (!node.size) {
        node.size = [DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT];
    }
    const [minW, minH] = getMinimumNodeSize(node);
    if (node.size[0] < minW) node.size[0] = minW;
    if (node.size[1] < minH) node.size[1] = minH;
    syncLayoutToNode(node, node.size[1]);
    node.setDirtyCanvas(true, true);
}

app.registerExtension({
    name: "Comfy.ResolutionPicker",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

            if (this.resolutionPickerInitialized) return result;
            this.resolutionPickerInitialized = true;

            this.properties = this.properties || {};
            this.resizable = true;

            const resolutionWidget = this.widgets?.find((w) => w.name === "resolution");
            if (!resolutionWidget) return result;

            hideWidget(resolutionWidget);

            if (this.properties.resolution) {
                resolutionWidget.value = this.properties.resolution;
            }

            const ui = new ResolutionPickerUI(this, resolutionWidget);
            this.resolutionPickerUI = ui;

            const nodeRef = this;
            const domWidget = this.addDOMWidget("resolution_picker_ui", "ResolutionPicker", ui.root, {
                serialize: false,
                hideOnZoom: false,
            });
            this.resolutionPickerWidget = domWidget;

            domWidget.computeSize = function (width) {
                const nodeWidth = nodeRef.size?.[0] || width || DEFAULT_NODE_WIDTH;
                return [Math.max(MIN_NODE_WIDTH, nodeWidth - 20), DEFAULT_CONTENT_HEIGHT];
            };

            // DOM widget first so it sits directly under the title bar; combo stays hidden for serialization.
            this.widgets = [domWidget, resolutionWidget];

            if (this._pendingResolutionProperties) {
                ui.loadFromProperties(this._pendingResolutionProperties);
                this._pendingResolutionProperties = null;
            }

            requestAnimationFrame(() => {
                applyDefaultNodeSize(this);
                if (!this.resolutionPickerWidget?.last_y) {
                    requestAnimationFrame(() => applyDefaultNodeSize(this));
                }
            });

            return result;
        };

        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function (size) {
            if (onResize) onResize.apply(this, arguments);
            syncLayoutToNode(this, size?.[1]);
        };

        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            if (onDrawForeground) onDrawForeground.apply(this, arguments);
            syncLayoutToNode(this);
        };

        const applyConfigure = (node, info) => {
            if (info?.properties?.resolution) {
                const widget = node.widgets?.find((w) => w.name === "resolution");
                if (widget) widget.value = info.properties.resolution;
            }
            if (node.resolutionPickerUI) {
                node.resolutionPickerUI.loadFromProperties(info?.properties);
                requestAnimationFrame(() => applyDefaultNodeSize(node));
            } else {
                node._pendingResolutionProperties = info?.properties;
            }
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            const result = onConfigure ? onConfigure.apply(this, arguments) : undefined;
            applyConfigure(this, info);
            return result;
        };

        const origConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            if (origConfigure) origConfigure.apply(this, arguments);
            applyConfigure(this, info);
        };
    },
});
