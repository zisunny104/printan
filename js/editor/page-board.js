// 2D 多頁畫布：直接反映列印出來的實體結果——
// 水平並排的是不同「段」（段與段之間真的會切紙），同一段裡用 cutAfter:false 串起來的頁面垂直堆疊
// （它們實際上印在同一張連續紙上）。分段邏輯見 schema.js groupPagesByCut。
//
// 只有作用中頁面是可編輯的：它用的是原本那一組 #paper-shadow／#canvas-host（編輯疊層、行內文字編輯、
// 尺規、縮放錨點全部綁在這組節點上），切頁時把整組節點搬進新的作用中欄位，其餘頁面只是
// 同尺寸的唯讀縮圖，點一下切換成作用中。這樣編輯互動層完全不用知道畫布上有幾頁。
// 窄螢幕（<768px）CSS 只顯示作用中那一頁，改用 #page-pager 前後切換，見 editor.css。

import { groupPagesByCut } from "../core/schema.js";
import { renderTemplate } from "../core/renderer.js";
import { els, state } from "./context.js";
import { setCurrentPage } from "./pages.js";

let layoutKey = "";
let thumbGeneration = 0;
const thumbCache = new Map(); // pageId → { sig, canvas }

// 頁面結構（順序、名稱、切紙、作用中頁）沒變就不重建 DOM：重建會把 #paper-shadow 拔下來再插回去，
// 行內文字編輯中的焦點會掉，所以打字／拖曳這類頁內編輯絕對不能走到重建。
function structureKey(pages) {
    return JSON.stringify([state.currentPageIndex, pages.map((p) => [p.id, p.name, p.cutAfter])]);
}

/** 依目前頁面結構排出 2D 佈局；回傳 true 表示剛重建（呼叫端可能要把作用中頁面捲進畫面）。 */
export function syncPageBoard() {
    const board = els["page-board"];
    const pages = state.project.template.pages;
    const key = structureKey(pages);
    if (key === layoutKey && board.contains(els["paper-shadow"])) {
        // 空白頁撐最短高度（見 editor.css）：有沒有內容隨時會變，只更新 class，不值得為此重建
        for (const frame of board.querySelectorAll(".page-frame")) {
            const page = pages[Number(frame.dataset.pageIndex)];
            frame.classList.toggle("is-empty", !!page && page.elements.length === 0);
        }
        return false;
    }
    layoutKey = key;

    const alive = new Set(pages.map((p) => p.id));
    for (const id of thumbCache.keys()) if (!alive.has(id)) thumbCache.delete(id);

    const groups = groupPagesByCut(pages);
    const fragment = document.createDocumentFragment();
    groups.forEach((indices, g) => {
        if (g > 0) fragment.appendChild(buildCutDivider());
        const group = document.createElement("div");
        group.className = "page-group";
        indices.forEach((pageIndex, pos) => {
            group.appendChild(buildFrame(pages[pageIndex], pageIndex, pos, indices.length));
        });
        fragment.appendChild(group);
    });
    board.replaceChildren(fragment);
    board.classList.toggle("is-multi-page", pages.length > 1);
    updatePager();
    return true;
}

// 兩段之間：垂直虛線＋剪刀。跟同段內的「接續」接縫刻意用完全不同的線型與顏色，
// 不能只靠位置差異表達「這裡會被切開」，否則很容易被誤會成只是排版間距。
function buildCutDivider() {
    const divider = document.createElement("div");
    divider.className = "page-cut-divider";
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-orientation", "vertical");
    divider.setAttribute("aria-label", "切紙：兩側印在不同張紙上");
    divider.innerHTML = '<span class="ts-icon is-scissors-icon" aria-hidden="true"></span>';
    return divider;
}

function buildFrame(page, index, posInGroup, groupSize) {
    const isActive = index === state.currentPageIndex;
    const frame = document.createElement("div");
    frame.className = "page-frame";
    frame.classList.toggle("is-active", isActive);
    frame.classList.toggle("is-joined-above", posInGroup > 0);
    frame.classList.toggle("is-joined-below", posInGroup < groupSize - 1);
    frame.classList.toggle("is-empty", page.elements.length === 0);
    frame.dataset.pageId = page.id;
    frame.dataset.pageIndex = String(index);

    // 頁碼＋頁名：同段第一頁放在紙張上方（同 Figma frame 名稱）；接續頁放在紙張左側外面，
    // 不在兩頁之間插一行把「連續紙」撐開。作用中頁面靠外框顏色辨識（見 editor.css .page-frame.is-active）。
    const label = document.createElement("div");
    label.className = posInGroup === 0 ? "page-frame-label" : "page-frame-label is-side";
    const number = Object.assign(document.createElement("span"), { className: "page-frame-number", textContent: String(index + 1) });
    const name = Object.assign(document.createElement("span"), { className: "page-frame-name", textContent: page.name });
    label.append(number, name);
    label.title = page.name;
    frame.appendChild(label);

    if (isActive) {
        frame.appendChild(els["paper-shadow"]);
    } else {
        frame.appendChild(buildThumb(page));
        frame.tabIndex = 0;
        frame.setAttribute("role", "button");
        frame.setAttribute("aria-label", `切換到第 ${index + 1} 頁「${page.name}」`);
        frame.addEventListener("click", () => setCurrentPage(index));
        frame.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            setCurrentPage(index);
        });
    }

    // 同段最後一頁印完真的會切：紙張下緣畫切割線＋剪刀；最後一頁 cutAfter:false 就不畫（紙停在印表機裡）
    if (posInGroup === groupSize - 1 && page.cutAfter) {
        const edge = document.createElement("div");
        edge.className = "page-cut-edge";
        edge.setAttribute("role", "img");
        edge.setAttribute("aria-label", "印完切紙");
        edge.innerHTML = '<span class="ts-icon is-scissors-icon" aria-hidden="true"></span>';
        frame.appendChild(edge);
    }
    return frame;
}

function buildThumb(page) {
    const shadow = document.createElement("div");
    shadow.className = "paper-shadow page-thumb";
    for (const side of ["left", "right"]) {
        const zone = document.createElement("div");
        zone.className = `unprintable-zone is-${side}`;
        zone.setAttribute("aria-hidden", "true");
        shadow.appendChild(zone);
    }
    const host = document.createElement("div");
    host.className = "canvas-host";
    const cached = thumbCache.get(page.id);
    if (cached) host.appendChild(cached.canvas); // 先放舊的，重畫完再換，切頁時不會閃一下空白
    shadow.appendChild(host);
    return shadow;
}

/**
 * 重畫非作用中頁面的縮圖。內容簽章沒變就沿用快取的 canvas，所以只編輯作用中頁面時
 * 其他頁不會每次都重新排版。跟 updatePreview 一樣用同一份資料／模式／profile，縮圖才會跟實際列印一致。
 */
export async function renderPageThumbs({ data, mode, profile }) {
    const generation = ++thumbGeneration;
    const pages = state.project.template.pages;
    const common = JSON.stringify([data, mode, state.project.paper.widthId, profile]);
    for (let i = 0; i < pages.length; i++) {
        if (i === state.currentPageIndex) continue;
        const page = pages[i];
        const sig = common + JSON.stringify(page.elements);
        let entry = thumbCache.get(page.id);
        if (entry?.sig !== sig) {
            let result;
            try {
                result = await renderTemplate({ ...state.project, template: { elements: page.elements } }, data, { mode, profile });
            } catch (err) {
                console.error(err);
                continue;
            }
            if (generation !== thumbGeneration) return; // 過期：已經有更新的一輪在畫了
            entry = { sig, canvas: result.canvas };
            thumbCache.set(page.id, entry);
        }
        const host = els["page-board"].querySelector(`.page-frame[data-page-id="${CSS.escape(page.id)}"] .canvas-host`);
        if (host && host.firstChild !== entry.canvas) host.replaceChildren(entry.canvas);
    }
}

/** 字體載入狀態改變時快取全部作廢：舊縮圖可能是用替代字體畫的。 */
export function invalidatePageThumbs() {
    thumbCache.clear();
}

/**
 * 把作用中頁面捲進工作區可見範圍。center＝一律水平置中（「符合寬度」／1:1 的語意是對作用中那一欄，
 * 不是整個 2D 佈局）；否則只在它超出畫面時才捲，平常點縮圖切頁不要讓畫面亂跳。
 */
export function revealActivePage({ center = false } = {}) {
    const scroll = els["paper-scroll"];
    const s = scroll.getBoundingClientRect();
    const p = els["paper-shadow"].getBoundingClientRect();
    const left = p.left - s.left + scroll.scrollLeft;
    const top = p.top - s.top + scroll.scrollTop;
    if (center || p.left < s.left || p.right > s.right) {
        scroll.scrollLeft = left - Math.max(0, (scroll.clientWidth - p.width) / 2);
    }
    if (p.top > s.bottom - 48 || p.bottom < s.top + 48) scroll.scrollTop = Math.max(0, top - 32);
}

// 窄螢幕的前後頁切換列：2D 佈局在手機上沒有意義，退回一次一頁；看不到桌面版的分段排列，
// 所以這頁印完會切紙時在頁名旁亮剪刀圖示（同桌面版紙張下緣的切割標記）。
function updatePager() {
    const pager = els["page-pager"];
    if (!pager) return;
    const pages = state.project.template.pages;
    const index = state.currentPageIndex;
    pager.hidden = pages.length <= 1;
    const page = pages[index];
    els["page-pager-label"].textContent = `${index + 1} / ${pages.length}　${page.name}`;
    els["page-pager-cut"].hidden = !page.cutAfter;
    els["btn-page-prev"].disabled = index <= 0;
    els["btn-page-next"].disabled = index >= pages.length - 1;
}

export function bindPagePager() {
    els["btn-page-prev"]?.addEventListener("click", () => setCurrentPage(state.currentPageIndex - 1));
    els["btn-page-next"]?.addEventListener("click", () => setCurrentPage(state.currentPageIndex + 1));
}
