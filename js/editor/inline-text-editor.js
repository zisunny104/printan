// 預覽區行內文字編輯：在畫布上選取的文字元素，可直接在預覽區點進去輸入／選取文字。
// 做法是在該元素的疊層外框上蓋一個 contenteditable 節點（真實顯示各 run 的樣式，中文輸入法
// 組字才看得到），輸入後用 replaceFullText 寫回 runs（沿用原本的 diff，run 樣式不會被洗掉），
// 畫布本身仍由 editor.js 照常重繪。這個節點掛在 paper-shadow 底下，不能放進 canvas-host：
// updatePreview() 每次都會清空 canvas-host，聚焦中的節點被移除就會直接失焦。
// 選取範圍（字元偏移）回報給屬性面板，讓面板工具列的粗體／底線等按鈕直接套用在這段選取上。

import { getTextContent, replaceFullText } from "../core/document-model.js";
import { DEFAULT_FONT_FAMILY } from "../core/renderer.js";

export function createInlineTextEditor({ getHost, getElement, getBlockNode, getScale, onInput, onSelection }) {
    let node = null;
    let currentId = null;
    let composing = false;

    function ensureNode() {
        if (node) return node;
        node = document.createElement("div");
        node.className = "inline-text-editor";
        node.contentEditable = "plaintext-only"; // Enter 直接產生 "\n"，貼上也只留純文字
        node.spellcheck = false;
        node.hidden = true;
        node.addEventListener("input", () => { if (!composing) syncModel(); });
        node.addEventListener("compositionstart", () => { composing = true; });
        node.addEventListener("compositionend", () => { composing = false; syncModel(); });
        node.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            close();
        });
        // 視窗本身失焦（切到別的分頁／程式）時不收合，回來後瀏覽器會自動把焦點還給節點
        node.addEventListener("blur", () => { if (document.hasFocus()) close(); });
        document.addEventListener("selectionchange", () => {
            if (!isOpen()) return;
            const range = getSelection2();
            if (range) onSelection(currentId, range.start, range.end);
        });
        getHost().appendChild(node);
        return node;
    }

    function isOpen() {
        return !!node && !node.hidden && !!currentId;
    }

    function isEditing(id) {
        return isOpen() && currentId === id;
    }

    // Chrome 在文字以 "\n" 結尾時會多補一個 "\n" 讓最後一個空行看得到，讀回來要扣掉、渲染時要補上
    function readText() {
        const text = node.textContent;
        return text.endsWith("\n") ? text.slice(0, -1) : text;
    }

    function syncModel() {
        const el = getElement(currentId);
        if (!el) return;
        replaceFullText(el, readText());
        onInput(currentId);
    }

    function textOffsetOf(container, offset) {
        const range = document.createRange();
        range.selectNodeContents(node);
        range.setEnd(container, offset);
        return range.toString().length;
    }

    function getSelection2() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !node.contains(sel.anchorNode) || !node.contains(sel.focusNode)) return null;
        const max = readText().length;
        const a = Math.min(textOffsetOf(sel.anchorNode, sel.anchorOffset), max);
        const b = Math.min(textOffsetOf(sel.focusNode, sel.focusOffset), max);
        return { start: Math.min(a, b), end: Math.max(a, b) };
    }

    function locate(offset) {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let remain = offset;
        let last = null;
        while (walker.nextNode()) {
            const t = walker.currentNode;
            if (remain <= t.length) return [t, remain];
            remain -= t.length;
            last = t;
        }
        return last ? [last, last.length] : [node, 0];
    }

    function setSelection(start, end) {
        const range = document.createRange();
        range.setStart(...locate(start));
        range.setEnd(...locate(end));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function buildContent(el, scale) {
        const frag = document.createDocumentFragment();
        for (const run of el.runs || []) {
            if (!run.text) continue;
            const span = document.createElement("span");
            span.textContent = run.text;
            span.style.fontFamily = run.fontFamily || el.fontFamily || DEFAULT_FONT_FAMILY;
            span.style.fontSize = `${(run.fontSize || el.fontSize) * scale}px`;
            span.style.fontWeight = (run.bold ?? el.bold) ? "700" : "400";
            span.style.fontStyle = run.italic ? "italic" : "normal";
            span.style.textDecoration = [run.underline && "underline", run.strikethrough && "line-through"].filter(Boolean).join(" ") || "none";
            if (run.inverse) {
                span.style.background = el.inverse ? "#fff" : "#000";
                span.style.color = el.inverse ? "#000" : "#fff";
            }
            frag.appendChild(span);
        }
        if (getTextContent(el).endsWith("\n")) frag.appendChild(document.createTextNode("\n"));
        return frag;
    }

    function applyElementStyle(el, scale) {
        const s = node.style;
        s.fontFamily = el.fontFamily || DEFAULT_FONT_FAMILY;
        s.fontSize = `${el.fontSize * scale}px`;
        s.fontWeight = el.bold ? "700" : "400";
        s.lineHeight = String(el.lineHeight || 1.3);
        s.letterSpacing = `${(el.letterSpacing || 0) * scale}px`;
        // 直書用瀏覽器原生 vertical-rl，編輯框的字向跟畫布一致（換行只靠 Enter，不自動換行）
        const vertical = el.writingMode === "vertical";
        s.writingMode = vertical ? "vertical-rl" : "horizontal-tb";
        s.textAlign = vertical ? "start" : el.align || "left";
        s.whiteSpace = el.wrap && !vertical ? "pre-wrap" : "pre";
        s.background = el.inverse ? "#000" : "#fff";
        s.color = el.inverse ? "#fff" : "#000";
    }

    /** 內容由 model 重建（樣式改變後用），並把選取範圍還原。 */
    function refresh() {
        if (!isOpen()) return;
        const el = getElement(currentId);
        if (!el) return close();
        const saved = document.activeElement === node ? getSelection2() : null;
        node.replaceChildren(buildContent(el, getScale()));
        if (saved) setSelection(saved.start, saved.end);
    }

    /** 每次畫布重繪、疊層重建之後，把編輯框對齊回該元素的外框；元素不見了（刪除、切到預覽模式）就收合。 */
    function reposition() {
        if (!isOpen()) return;
        const el = getElement(currentId);
        const block = getBlockNode(currentId);
        if (!el || !block) return close();
        const scale = getScale();
        const host = getHost().getBoundingClientRect();
        const rect = block.getBoundingClientRect();
        applyElementStyle(el, scale);
        node.style.left = `${rect.left - host.left}px`;
        node.style.top = `${rect.top - host.top}px`;
        node.style.width = `${rect.width}px`;
        node.style.minHeight = `${rect.height}px`;
        node.style.height = el.writingMode === "vertical" ? `${rect.height}px` : "";
    }

    function placeCaret(point) {
        let range = null;
        if (point && document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(point.x, point.y);
            if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
            }
        } else if (point && document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(point.x, point.y);
        }
        if (range && node.contains(range.startContainer)) {
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            const end = readText().length;
            setSelection(end, end);
        }
    }

    /** 開始編輯：point 是點擊當下的 viewport 座標，插入點會落在那個位置。 */
    function open(id, point) {
        const el = getElement(id);
        if (!el || el.type !== "text" || !getBlockNode(id)) return false;
        if (isOpen()) close();
        ensureNode();
        currentId = id;
        node.hidden = false;
        node.replaceChildren(buildContent(el, getScale()));
        reposition();
        node.focus({ preventScroll: true });
        placeCaret(point);
        return true;
    }

    function close() {
        if (!isOpen()) return;
        currentId = null;
        composing = false;
        node.hidden = true;
    }

    return { open, close, refresh, reposition, isEditing, getSelection: getSelection2 };
}
