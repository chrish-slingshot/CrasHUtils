const API_BASE = "/crashutils/loras";
const DB_NAME = "CrashUtilsLoraPreviews";
const DB_VERSION = 1;
const STORE_NAME = "previews";

const memoryCache = new Map();
const previewVersions = new Map();

let dbPromise = null;

function cacheKey(loraPath) {
    return loraPath ? String(loraPath).replace(/\\/g, "/") : "";
}

function openDb() {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
            reject(new Error("IndexedDB unavailable"));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }).catch(() => null);

    return dbPromise;
}

async function idbGet(key) {
    const db = await openDb();
    if (!db) {
        return null;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
    });
}

async function idbPut(key, value) {
    const db = await openDb();
    if (!db) {
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

async function idbDelete(key) {
    const db = await openDb();
    if (!db) {
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

function rememberObjectUrl(key, blob) {
    const existing = memoryCache.get(key);
    if (existing) {
        URL.revokeObjectURL(existing);
    }

    const url = URL.createObjectURL(blob);
    memoryCache.set(key, url);
    return url;
}

export async function invalidateLoraPreview(loraPath) {
    const key = cacheKey(loraPath);
    if (!key) {
        return;
    }

    const cached = memoryCache.get(key);
    if (cached) {
        URL.revokeObjectURL(cached);
        memoryCache.delete(key);
    }

    await idbDelete(key);
    previewVersions.set(key, (previewVersions.get(key) || 0) + 1);
}

export function previewRequestUrl(loraPath) {
    const key = cacheKey(loraPath);
    const version = previewVersions.get(key);
    const versionParam = version ? `&v=${version}` : "";
    return `${API_BASE}/preview?path=${encodeURIComponent(key)}${versionParam}`;
}

export async function getPreviewObjectUrl(loraPath) {
    const key = cacheKey(loraPath);
    if (!key) {
        return null;
    }

    if (memoryCache.has(key)) {
        return memoryCache.get(key);
    }

    const cached = await idbGet(key);
    const headers = {};
    if (cached?.etag) {
        headers["If-None-Match"] = cached.etag;
    }

    let response;
    try {
        response = await fetch(previewRequestUrl(key), { headers });
    } catch {
        if (cached?.blob) {
            return rememberObjectUrl(key, cached.blob);
        }
        return null;
    }

    if (response.status === 304 && cached?.blob) {
        return rememberObjectUrl(key, cached.blob);
    }

    if (!response.ok) {
        return null;
    }

    const blob = await response.blob();
    const etag = response.headers.get("ETag") || "";
    await idbPut(key, { blob, etag, savedAt: Date.now() });
    return rememberObjectUrl(key, blob);
}

export function bindPreviewImage(img, loraPath, onError) {
    if (!img || !loraPath) {
        return;
    }

    getPreviewObjectUrl(loraPath).then((url) => {
        if (!img.isConnected) {
            return;
        }
        if (url) {
            img.src = url;
            img.onerror = () => onError?.(img);
            return;
        }
        onError?.(img);
    });
}

export function replaceWithPreviewPlaceholder(img) {
    if (!img?.replaceWith) {
        return;
    }
    img.replaceWith(
        Object.assign(document.createElement("div"), {
            className: "placeholder",
            textContent: "🎨",
        })
    );
}
