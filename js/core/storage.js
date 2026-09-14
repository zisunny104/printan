// 本地儲存：草稿與圖片用 IndexedDB（見需求單第十七節：圖片內容優先評估 IndexedDB
// 而非單純依賴 LocalStorage），「最近使用」清單用 localStorage 存輕量 metadata。
// 這裡的本地暫存只是編輯中的草稿，不能取代正式的 .ptan 匯出／匯入。

const DB_NAME = "printan";
const DB_VERSION = 1;
const STORE_DRAFTS = "drafts";
const RECENT_KEY = "printan:recent";
const MAX_RECENT = 10;

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
                db.createObjectStore(STORE_DRAFTS, { keyPath: "id" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_DRAFTS, mode);
        const store = tx.objectStore(STORE_DRAFTS);
        const result = fn(store);
        tx.oncomplete = () => resolve(result.result !== undefined ? result.result : result);
        tx.onerror = () => reject(tx.error);
    });
}

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** 儲存草稿（project 需要有 id；沒有的話會自動產生一個）。 */
export async function saveDraft(project) {
    if (!project.id) project.id = `draft_${Date.now().toString(36)}`;
    project.meta = { ...project.meta, updatedAt: new Date().toISOString() };
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_DRAFTS, "readwrite");
        tx.objectStore(STORE_DRAFTS).put(project);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    touchRecent(project.id, project.meta?.name || "未命名版型");
    return project.id;
}

export async function loadDraft(id) {
    const db = await openDb();
    const tx = db.transaction(STORE_DRAFTS, "readonly");
    return requestToPromise(tx.objectStore(STORE_DRAFTS).get(id));
}

export async function deleteDraft(id) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_DRAFTS, "readwrite");
        tx.objectStore(STORE_DRAFTS).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    removeRecent(id);
}

export async function listDrafts() {
    const db = await openDb();
    const tx = db.transaction(STORE_DRAFTS, "readonly");
    return requestToPromise(tx.objectStore(STORE_DRAFTS).getAll());
}

// ---- 「最近使用」輕量清單（localStorage，只存 id/name/時間，不存圖片內容） ----

function readRecent() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    } catch {
        return [];
    }
}

function writeRecent(list) {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
        // localStorage 不可用時（例如無痕模式）安靜略過，不影響 IndexedDB 草稿本身
    }
}

function touchRecent(id, name) {
    const list = readRecent().filter((r) => r.id !== id);
    list.unshift({ id, name, updatedAt: new Date().toISOString() });
    writeRecent(list.slice(0, MAX_RECENT));
}

function removeRecent(id) {
    writeRecent(readRecent().filter((r) => r.id !== id));
}

export function listRecent() {
    return readRecent();
}
