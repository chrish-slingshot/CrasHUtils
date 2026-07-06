const INFO_API = "/crashutils/loras";

const DIALOG_STYLES = `
.crash-lora-info-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
}
.crash-lora-info-dialog {
    background: #2a2a2a;
    border: 1px solid #666;
    border-radius: 8px;
    width: min(560px, 96vw);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    color: #ddd;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.45);
}
.crash-lora-info-dialog * { box-sizing: border-box; }
.crash-lora-info-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid #555;
    background: #333;
}
.crash-lora-info-header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.crash-lora-info-close {
    border: none;
    background: #444;
    color: #ddd;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
}
.crash-lora-info-close:hover { background: #555; color: #fff; }
.crash-lora-info-body {
    overflow: auto;
    padding: 12px;
}
.crash-lora-info-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
}
.crash-lora-info-tag {
    padding: 2px 8px;
    border-radius: 999px;
    background: #3a3a3a;
    border: 1px solid #555;
    font-size: 10px;
    color: #bbb;
}
.crash-lora-info-table {
    width: 100%;
    border-collapse: collapse;
}
.crash-lora-info-table td {
    vertical-align: top;
    padding: 6px 4px;
    border-bottom: 1px solid #3a3a3a;
}
.crash-lora-info-table td:first-child {
    width: 110px;
    color: #aaa;
    font-weight: 600;
    white-space: nowrap;
}
.crash-lora-info-table td:last-child {
    word-break: break-word;
}
.crash-lora-info-words {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.crash-lora-info-word {
    padding: 2px 6px;
    border-radius: 4px;
    background: #1f1f1f;
    border: 1px solid #444;
    font-size: 11px;
    cursor: pointer;
}
.crash-lora-info-word.selected {
    border-color: #8af;
    background: #243044;
}
.crash-lora-info-word .civitai-mark {
    color: #4a9;
    margin-left: 3px;
    font-size: 9px;
}
.crash-lora-info-images {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
    list-style: none;
    padding: 0;
}
.crash-lora-info-images img,
.crash-lora-info-images video {
    max-width: 160px;
    max-height: 160px;
    border-radius: 4px;
    border: 1px solid #555;
    display: block;
}
.crash-lora-info-btn {
    border: 1px solid #666;
    background: #3a3a3a;
    color: #eee;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 11px;
}
.crash-lora-info-btn:hover { background: #4a4a4a; border-color: #8af; }
.crash-lora-info-loading {
    text-align: center;
    color: #888;
    padding: 24px 12px;
}
`;

let stylesInjected = false;

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement("style");
    style.textContent = DIALOG_STYLES;
    document.head.appendChild(style);
}

async function fetchLoraInfo(loraPath, refresh = false) {
    const endpoint = refresh ? `${INFO_API}/info/refresh` : `${INFO_API}/info`;
    const res = await fetch(`${endpoint}?path=${encodeURIComponent(loraPath)}`);
    if (!res.ok) {
        throw new Error("Failed to load LoRA info");
    }
    return res.json();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function infoRow(label, valueHtml) {
    if (!valueHtml) return "";
    return `<tr><td>${escapeHtml(label)}</td><td>${valueHtml}</td></tr>`;
}

function civitaiRow(info) {
    const civitai = info.raw?.civitai;
    const link = (info.links || []).find((item) => item.includes("civitai.com/models"));
    if (link) {
        return infoRow("CivitAI", `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">View on CivitAI</a>`);
    }
    if (civitai?.error === "Model not found" || civitai?.error === "Not Found") {
        return infoRow("CivitAI", "<i>Model not found</i>");
    }
    if (civitai?.error) {
        return infoRow("CivitAI", escapeHtml(civitai.error));
    }
    if (!civitai) {
        return infoRow(
            "CivitAI",
            `<button type="button" class="crash-lora-info-btn" data-action="fetch-civitai">Fetch info from CivitAI</button>`
        );
    }
    return "";
}

function trainedWordsMarkup(words) {
    if (!words?.length) return "";
    return `<div class="crash-lora-info-words">${words
        .map(
            (item) =>
                `<span class="crash-lora-info-word" data-word="${escapeHtml(item.word)}" title="Click to select">${escapeHtml(item.word)}${item.civitai ? '<span class="civitai-mark">C</span>' : ""}</span>`
        )
        .join("")}</div>`;
}

function imagesMarkup(images) {
    if (!images?.length) return "";
    return `<ul class="crash-lora-info-images">${images
        .map((img) => {
            const media =
                img.type === "video"
                    ? `<video src="${escapeHtml(img.url)}" autoplay loop muted playsinline></video>`
                    : `<img src="${escapeHtml(img.url)}" alt="" loading="lazy" />`;
            return `<li>${media}</li>`;
        })
        .join("")}</ul>`;
}

function renderInfoContent(info) {
    const tags = [];
    if (info.type) tags.push(info.type);
    if (info.baseModel) tags.push(info.baseModel);

    return `
        ${tags.length ? `<div class="crash-lora-info-tags">${tags.map((tag) => `<span class="crash-lora-info-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        <table class="crash-lora-info-table">
            ${infoRow("File", escapeHtml(info.file))}
            ${infoRow("Hash", escapeHtml(info.sha256))}
            ${civitaiRow(info)}
            ${infoRow("Name", escapeHtml(info.name))}
            ${infoRow("Base Model", escapeHtml(info.baseModel))}
            ${infoRow("Clip Skip", escapeHtml(info.clipSkip))}
            ${infoRow("Trained Words", trainedWordsMarkup(info.trainedWords))}
        </table>
        ${imagesMarkup(info.images)}
    `;
}

class LoraInfoDialog {
    constructor(loraPath) {
        this.loraPath = loraPath;
        this.info = null;
        injectStyles();

        this.overlay = document.createElement("div");
        this.overlay.className = "crash-lora-info-overlay";
        this.overlay.innerHTML = `
            <div class="crash-lora-info-dialog" role="dialog" aria-modal="true">
                <div class="crash-lora-info-header">
                    <h2>Loading...</h2>
                    <button type="button" class="crash-lora-info-close" title="Close">✕</button>
                </div>
                <div class="crash-lora-info-body"><div class="crash-lora-info-loading">Loading...</div></div>
            </div>
        `;

        this.titleEl = this.overlay.querySelector("h2");
        this.bodyEl = this.overlay.querySelector(".crash-lora-info-body");
        this.overlay.querySelector(".crash-lora-info-close").addEventListener("click", () => this.close());
        this.overlay.addEventListener("click", (e) => {
            if (e.target === this.overlay) this.close();
        });
        this.bodyEl.addEventListener("click", (e) => this.handleClick(e));
    }

    async open() {
        document.body.appendChild(this.overlay);
        await this.load(false);
    }

    close() {
        this.overlay.remove();
    }

    async load(refresh) {
        this.bodyEl.innerHTML = `<div class="crash-lora-info-loading">${refresh ? "Fetching from CivitAI..." : "Loading..."}</div>`;
        try {
            this.info = await fetchLoraInfo(this.loraPath, refresh);
            this.titleEl.textContent = this.info.name || this.info.file || "LoRA Info";
            this.bodyEl.innerHTML = renderInfoContent(this.info);
        } catch (err) {
            this.titleEl.textContent = "LoRA Info";
            this.bodyEl.innerHTML = `<div class="crash-lora-info-loading">${escapeHtml(err.message || "Failed to load info")}</div>`;
        }
    }

    async handleClick(event) {
        const actionEl = event.target.closest("[data-action]");
        if (actionEl?.dataset.action === "fetch-civitai") {
            event.preventDefault();
            await this.load(true);
            return;
        }

        const wordEl = event.target.closest(".crash-lora-info-word");
        if (wordEl) {
            wordEl.classList.toggle("selected");
            const selected = [...this.bodyEl.querySelectorAll(".crash-lora-info-word.selected")]
                .map((el) => el.dataset.word)
                .filter(Boolean);
            if (selected.length && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(selected.join(", "));
            }
        }
    }
}

export async function fetchLoraTriggers(loraPath) {
    if (!loraPath) return [];
    try {
        const res = await fetch(`${INFO_API}/triggers?path=${encodeURIComponent(loraPath)}`);
        const data = await res.json();
        return data.triggers || [];
    } catch {
        return [];
    }
}

export function showLoraInfoDialog(loraPath) {
    if (!loraPath) return;
    new LoraInfoDialog(loraPath).open();
}

export function bindLoraContextMenu(element, loraPath, extraItems = []) {
    if (!element || !loraPath) return;
    element.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showLoraContextMenu(event, loraPath, extraItems);
    });
}

export function showLoraContextMenu(event, loraPath, extraItems = []) {
    if (!loraPath) return;
    const items = [
        {
            content: "ℹ️ Show Info",
            callback: () => showLoraInfoDialog(loraPath),
        },
        ...extraItems,
    ];
    if (typeof LiteGraph !== "undefined" && LiteGraph.ContextMenu) {
        new LiteGraph.ContextMenu(items, {
            title: "LoRA",
            event,
        });
    } else {
        showLoraInfoDialog(loraPath);
    }
}
