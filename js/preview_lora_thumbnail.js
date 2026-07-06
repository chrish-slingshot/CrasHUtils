import { app } from "../../scripts/app.js";
import { invalidateLoraPreview } from "./lora_preview_cache.js";

const API_BASE = "/crashutils/loras";
const PREVIEW_NODE_TYPES = new Set(["PreviewImage"]);
const LORA_LOADER_TYPES = new Set(["GridLoraLoader", "ListLoraLoader"]);

function getWidgetLoraValue(widget) {
    if (!widget) {
        return null;
    }
    if (typeof widget.serializeValue === "function") {
        return widget.serializeValue();
    }
    return widget.value;
}

export function collectWorkflowLoras() {
    const loras = [];
    const seen = new Set();
    const graph = app.graph;
    if (!graph?._nodes) {
        return loras;
    }

    for (const node of graph._nodes) {
        if (!LORA_LOADER_TYPES.has(node.comfyClass)) {
            continue;
        }

        for (const widget of node.widgets || []) {
            if (!widget.name?.startsWith("lora_")) {
                continue;
            }

            const value = getWidgetLoraValue(widget);
            if (!value?.lora || seen.has(value.lora)) {
                continue;
            }

            seen.add(value.lora);
            const basename = value.lora.split("/").pop().replace(/\.[^.]+$/, "");
            loras.push({
                path: value.lora,
                name: basename,
                enabled: value.on !== false,
            });
        }
    }

    loras.sort((a, b) => {
        if (a.enabled !== b.enabled) {
            return a.enabled ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return loras;
}

function getPreviewImageElement(node) {
    if (!node?.imgs?.length) {
        return null;
    }
    if (node.imageIndex != null) {
        return node.imgs[node.imageIndex];
    }
    if (node.overIndex != null) {
        return node.imgs[node.overIndex];
    }
    return node.imgs[node.imgs.length - 1];
}

function parseViewImageParams(img) {
    if (!img?.src) {
        return null;
    }

    try {
        const url = new URL(img.src, window.location.origin);
        const filename = url.searchParams.get("filename");
        if (!filename) {
            return null;
        }
        return {
            filename,
            type: url.searchParams.get("type") || "temp",
            subfolder: url.searchParams.get("subfolder") || "",
        };
    } catch {
        return null;
    }
}

async function refreshLoraLoaderThumbnails(loraPath) {
    await invalidateLoraPreview(loraPath);

    for (const node of app.graph?._nodes || []) {
        if (!LORA_LOADER_TYPES.has(node.comfyClass)) {
            continue;
        }

        const ui = node.gridLoraUI || node.listLoraUI;
        if (!ui) {
            continue;
        }

        await ui.refreshBrowse();
        ui.renderSelected();
        node.setDirtyCanvas?.(true, true);
    }
}

async function saveLoraThumbnail(img, loraPath) {
    const source = parseViewImageParams(img);
    if (!source) {
        alert("Could not read the preview image source.");
        return;
    }

    const res = await fetch(`${API_BASE}/save-thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            ...source,
            lora_path: loraPath,
        }),
    });

    let data = {};
    try {
        data = await res.json();
    } catch {
        data = {};
    }

    if (!res.ok) {
        alert(data.error || "Failed to save LoRA thumbnail.");
        return;
    }

    await refreshLoraLoaderThumbnails(data.lora_path || loraPath);
}

function insertMenuOption(options, item) {
    let pos = options.findIndex((o) => o?.content === "Save Image");
    if (pos === -1) {
        pos = options.length;
    } else {
        pos += 1;
    }
    options.splice(pos, 0, item);
}

function buildLoraThumbnailMenuItem(node, img) {
    const loras = collectWorkflowLoras();

    if (!loras.length) {
        return {
            content: "Save as LoRA thumbnail",
            disabled: true,
        };
    }

    const submenuOptions = loras.map((lora) => ({
        content: `${lora.enabled ? "" : "⚫ "}${lora.name}`,
        callback: () => saveLoraThumbnail(img, lora.path),
    }));

    return {
        content: "Save as LoRA thumbnail",
        has_submenu: true,
        callback: (_value, _options, event, parentMenu) => {
            new LiteGraph.ContextMenu(submenuOptions, {
                event,
                parentMenu,
            });
        },
    };
}

app.registerExtension({
    name: "Comfy.CrasHUtils.PreviewLoraThumbnail",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!PREVIEW_NODE_TYPES.has(nodeData.name)) {
            return;
        }

        const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_canvas, options) {
            const result = getExtraMenuOptions?.apply(this, arguments);

            const img = getPreviewImageElement(this);
            if (img) {
                insertMenuOption(options, buildLoraThumbnailMenuItem(this, img));
            }

            return result;
        };
    },
});
