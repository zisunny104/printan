// 使用說明用的小型 Markdown 轉換器（不用建置工具、不依賴外部套件）。
// 只支援說明書用到的語法：## 章／### 小標、段落、無序／有序清單、表格、引用（>）、水平線（---）、
// 行內的 **粗體**、*斜體*、`行內碼`、[文字](連結)、[[按鍵]]（→ <kbd>）。
// 安全：先把整段文字跳脫（& < > " '）再套標記，來源裡的 HTML 一律當純文字；
// 連結只允許 http(s):// 與相對路徑（含 # 錨點），其餘（javascript:、data: …）不轉成連結。

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
const ENTITY_CHARS = { quot: '"', "#39": "'", amp: "&" };
const HOLD = "\u0000"; // 暫存已轉好的 HTML 用的占位符；輸入裡的 NUL 會先移除，來源文字無法偽造

function safeHref(url) {
    if (/^https?:\/\/\S+$/i.test(url)) return url;
    // 相對路徑：不含協定、也不能是 // 開頭（protocol-relative 會跳到別的網站）
    if (/^[\w./#?=&%-]+$/.test(url) && !url.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
    return null;
}

/** 行內標記。輸入是原始文字，輸出已跳脫的 HTML。 */
export function renderInline(raw) {
    const held = [];
    const hold = (html) => `${HOLD}${held.push(html) - 1}${HOLD}`;
    let s = escapeHtml(raw.replaceAll(HOLD, ""));
    s = s.replace(/`([^`]{1,500})`/g, (_, code) => hold(`<code>${code}</code>`));
    s = s.replace(/\[\[([^\]]{1,50})\]\]/g, (_, key) => hold(`<kbd>${key}</kbd>`));
    // 網址在跳脫後 & " ' 已變成實體，還原後再檢查，輸出時再跳脫一次（否則 &quot; 會被二次跳脫成 &amp;quot;）
    s = s.replace(/\[([^\]]{1,300})\]\(([^)\s]{1,500})\)/g, (_, label, url) => {
        const href = safeHref(url.replace(/&(quot|#39|amp);/g, (_m, e) => ENTITY_CHARS[e]));
        if (!href) return label;
        const external = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
        return hold(`<a href="${escapeHtml(href)}"${external}>${label}</a>`);
    });
    s = s.replace(/\*\*([^*]{1,500})\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]{1,500})\*/g, "<em>$1</em>");
    return s.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, "g"), (_, i) => held[Number(i)]);
}

const splitRow = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/** 區塊層級：回傳 HTML 字串。 */
export function renderMarkdown(src) {
    const lines = src.replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }

        const heading = /^#{3,4}\s+(.*)$/.exec(line);
        if (heading) {
            out.push(`<div class="ts-header is-small">${renderInline(heading[1])}</div>`);
            i++;
        } else if (/^---+\s*$/.test(line)) {
            out.push('<div class="ts-divider"></div>');
            i++;
        } else if (line.includes("|") && isTableSep(lines[i + 1] ?? "")) {
            const head = splitRow(line);
            i += 2;
            const rows = [];
            while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
            const th = head.map((c) => `<th>${renderInline(c)}</th>`).join("");
            const tr = rows.map((r) => `<tr>${head.map((_, k) => `<td>${renderInline(r[k] ?? "")}</td>`).join("")}</tr>`).join("");
            out.push(`<div class="help-table-wrap"><table class="ts-table is-celled"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
        } else if (BULLET.test(line) || NUMBERED.test(line)) {
            const marker = BULLET.test(line) ? BULLET : NUMBERED;
            const tag = marker === BULLET ? "ul" : "ol";
            const items = [];
            while (i < lines.length && marker.test(lines[i])) items.push(lines[i++].replace(marker, ""));
            out.push(`<${tag} class="help-list">${items.map((t) => `<li>${renderInline(t)}</li>`).join("")}</${tag}>`);
        } else if (/^>\s?/.test(line)) {
            const quote = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
            out.push(`<blockquote class="help-quote">${renderInline(quote.join(" "))}</blockquote>`);
        } else {
            const para = [lines[i++]];
            while (i < lines.length && lines[i].trim() && !/^(#{3,4}\s|---+\s*$|>\s?)/.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) para.push(lines[i++]);
            out.push(`<p class="help-paragraph">${renderInline(para.join(" "))}</p>`);
        }
    }
    return out.join("");
}

/** 以 `## 章名` 切成章節：[{ title, body(原始 Markdown) }]；第一個 ## 之前的文字忽略。 */
export function splitChapters(src) {
    const chapters = [];
    for (const line of src.replace(/\r\n?/g, "\n").split("\n")) {
        const m = /^##\s+(.+?)\s*$/.exec(line);
        if (m) chapters.push({ title: m[1], body: "" });
        else if (chapters.length) chapters.at(-1).body += `${line}\n`;
    }
    return chapters;
}
