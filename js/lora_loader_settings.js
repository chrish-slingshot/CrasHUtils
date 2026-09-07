import { fetchLoraTriggerVariants } from "./lora_info.js";

let stylesInjected = false;

const SETTINGS_STYLES = `
.crash-lora-settings-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
}
.crash-lora-settings-dialog {
    background: #2a2a2a;
    border: 1px solid #666;
    border-radius: 8px;
    width: min(480px, 96vw);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    color: #ddd;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.45);
}
.crash-lora-settings-dialog * { box-sizing: border-box; }
.crash-lora-settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid #555;
    background: #333;
}
.crash-lora-settings-header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.crash-lora-settings-close {
    border: none;
    background: #444;
    color: #ddd;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
}
.crash-lora-settings-close:hover { background: #555; color: #fff; }
.crash-lora-settings-body {
    overflow: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.crash-lora-settings-field label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #ccc;
}
.crash-lora-settings-field input[type="number"] {
    width: 80px;
    padding: 4px 6px;
    border: 1px solid #555;
    border-radius: 4px;
    background: #1a1a1a;
    color: #eee;
}
.crash-lora-settings-section h3 {
    margin: 0 0 8px;
    font-size: 11px;
    font-weight: 600;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.crash-lora-settings-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.crash-lora-settings-chip {
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
.crash-lora-settings-chip.on {
    border-color: #6c6;
    background: #243024;
    color: #cfc;
}
.crash-lora-settings-chip.off {
    opacity: 0.45;
}
.crash-lora-settings-chip:hover {
    border-color: #8af;
}
.crash-lora-settings-empty {
    color: #666;
    font-style: italic;
    font-size: 11px;
}
.crash-lora-settings-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid #555;
    background: #333;
}
.crash-lora-settings-btn {
    border: 1px solid #666;
    background: #3a3a3a;
    color: #eee;
    border-radius: 4px;
    padding: 5px 12px;
    cursor: pointer;
    font-size: 11px;
}
.crash-lora-settings-btn.primary {
    border-color: #6c6;
    background: #243024;
}
.crash-lora-settings-btn:hover {
    background: #4a4a4a;
    border-color: #8af;
}
`;

function injectSettingsStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement("style");
    style.textContent = SETTINGS_STYLES;
    document.head.appendChild(style);
}

export function initEntryTriggers(entry, triggers) {
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

export function recomputeEntryTriggers(entry) {
    const merged = [];
    const seen = new Set();
    const addTerms = (list) => {
        for (const word of list || []) {
            const key = word.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(word);
        }
    };

    addTerms(entry.defaultTriggers);
    for (const variant of entry.variantFiles || []) {
        if (entry.variantOn?.[variant.id] === true) {
            addTerms(variant.triggers);
        }
    }
    initEntryTriggers(entry, merged);
}

export function entryTriggerStates(entry) {
    return (entry.triggers || []).map((word) => ({
        word,
        on: entry.triggerOn?.[word] !== false,
    }));
}

export function entryVariantStates(entry) {
    return (entry.variantFiles || []).map((variant) => ({
        id: variant.id,
        on: entry.variantOn?.[variant.id] === true,
    }));
}

export function formatEnabledTriggers(entry) {
    return (entry.triggers || []).filter((word) => entry.triggerOn?.[word] !== false);
}

export async function loadEntryTriggerData(entry) {
    const data = await fetchLoraTriggerVariants(entry.lora);
    entry.defaultTriggers = data.default || [];
    entry.variantFiles = data.variants || [];
    entry.variantOn = entry.variantOn || {};
    recomputeEntryTriggers(entry);
}

export function createEmptyTriggerEntry(base = {}) {
    return {
        defaultTriggers: [],
        variantFiles: [],
        variantOn: {},
        triggers: [],
        triggerOn: {},
        ...base,
    };
}

export function restoreTriggerEntryFromWidget(entry, value) {
    if (Array.isArray(value.variantStates)) {
        entry.variantOn = Object.fromEntries(
            value.variantStates.filter((item) => item?.id).map((item) => [item.id, item.on === true])
        );
    }
    if (Array.isArray(value.triggerStates)) {
        entry.triggers = value.triggerStates.map((item) => item.word).filter(Boolean);
        entry.triggerOn = Object.fromEntries(
            value.triggerStates.filter((item) => item?.word).map((item) => [item.word, item.on !== false])
        );
    }
}

export class LoraEntrySettingsDialog {
    constructor(entry, { onApply } = {}) {
        injectSettingsStyles();
        this.entry = entry;
        this.onApply = onApply;
        this.closed = false;

        this.overlay = document.createElement("div");
        this.overlay.className = "crash-lora-settings-overlay";
        this.overlay.innerHTML = `
            <div class="crash-lora-settings-dialog" role="dialog" aria-modal="true">
                <div class="crash-lora-settings-header">
                    <h2>LoRA Settings</h2>
                    <button type="button" class="crash-lora-settings-close" title="Close">✕</button>
                </div>
                <div class="crash-lora-settings-body">
                    <div class="crash-lora-settings-field">
                        <label>
                            Strength
                            <input type="number" class="strength-input" step="0.05" />
                        </label>
                    </div>
                    <div class="crash-lora-settings-section variant-section">
                        <h3>Character / Concept Tags</h3>
                        <div class="crash-lora-settings-chips variant-chips"></div>
                    </div>
                    <div class="crash-lora-settings-section tag-section">
                        <h3>Trigger Tags</h3>
                        <div class="crash-lora-settings-chips tag-chips"></div>
                    </div>
                </div>
                <div class="crash-lora-settings-footer">
                    <button type="button" class="crash-lora-settings-btn cancel-btn">Cancel</button>
                    <button type="button" class="crash-lora-settings-btn primary apply-btn">Apply</button>
                </div>
            </div>
        `;

        this.titleEl = this.overlay.querySelector("h2");
        this.strengthInput = this.overlay.querySelector(".strength-input");
        this.variantSection = this.overlay.querySelector(".variant-section");
        this.variantChipsEl = this.overlay.querySelector(".variant-chips");
        this.tagChipsEl = this.overlay.querySelector(".tag-chips");

        this.overlay.querySelector(".crash-lora-settings-close").addEventListener("click", () => this.close(false));
        this.overlay.querySelector(".cancel-btn").addEventListener("click", () => this.close(false));
        this.overlay.querySelector(".apply-btn").addEventListener("click", () => this.close(true));
        this.overlay.addEventListener("click", (e) => {
            if (e.target === this.overlay) this.close(false);
        });

        this.strengthInput.value = String(this.entry.strength ?? 1.0);
        this.titleEl.textContent = this.entry.name || this.entry.lora.split("/").pop() || "LoRA Settings";
        this.renderVariantChips();
        this.renderTagChips();
    }

    renderVariantChips() {
        const variants = this.entry.variantFiles || [];
        this.variantSection.style.display = variants.length ? "" : "none";
        this.variantChipsEl.innerHTML = "";

        if (variants.length === 0) {
            return;
        }

        for (const variant of variants) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = `crash-lora-settings-chip${this.entry.variantOn?.[variant.id] === true ? " on" : " off"}`;
            chip.textContent = variant.label || variant.id;
            chip.title = variant.label || variant.id;
            chip.addEventListener("click", (e) => {
                e.stopPropagation();
                const enabled = this.entry.variantOn?.[variant.id] === true;
                this.entry.variantOn[variant.id] = !enabled;
                recomputeEntryTriggers(this.entry);
                this.renderVariantChips();
                this.renderTagChips();
            });
            this.variantChipsEl.appendChild(chip);
        }
    }

    renderTagChips() {
        this.tagChipsEl.innerHTML = "";
        const tags = this.entry.triggers || [];

        if (tags.length === 0) {
            this.tagChipsEl.innerHTML = `<div class="crash-lora-settings-empty">No trigger tags available</div>`;
            return;
        }

        for (const word of tags) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = `crash-lora-settings-chip${this.entry.triggerOn?.[word] !== false ? " on" : " off"}`;
            chip.textContent = word;
            chip.title = word;
            chip.addEventListener("click", (e) => {
                e.stopPropagation();
                this.entry.triggerOn[word] = this.entry.triggerOn?.[word] === false;
                this.renderTagChips();
            });
            this.tagChipsEl.appendChild(chip);
        }
    }

    open() {
        document.body.appendChild(this.overlay);
        this.strengthInput.focus();
        this.strengthInput.select();
    }

    close(apply) {
        if (this.closed) return;
        this.closed = true;

        if (apply) {
            const num = Number(this.strengthInput.value);
            if (!Number.isNaN(num)) {
                this.entry.strength = num;
            }
            this.onApply?.();
        }

        this.overlay.remove();
    }
}
