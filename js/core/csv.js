// 批次資料用的 CSV 解析：第一列是欄位（變數）名稱，之後每列一筆資料；支援雙引號欄位、欄內逗號／換行、"" 跳脫。

export function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    const src = text.replace(/^﻿/, "");
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quoted) {
            if (ch !== '"') cell += ch;
            else if (src[i + 1] === '"') { cell += '"'; i++; }
            else quoted = false;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") { row.push(cell); cell = ""; }
        else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && src[i + 1] === "\n") i++;
            row.push(cell); cell = "";
            rows.push(row); row = [];
        } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** CSV 文字 → 資料物件陣列（欄位名稱去頭尾空白；空欄位名稱略過）。 */
export function csvToRecords(text) {
    const [header, ...body] = parseCsv(text);
    if (!header) return [];
    const names = header.map((h) => h.trim());
    return body.map((cells) => {
        const rec = {};
        names.forEach((name, i) => { if (name) rec[name] = cells[i] ?? ""; });
        return rec;
    });
}
