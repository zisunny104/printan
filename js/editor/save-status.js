// 自動儲存並把結果顯示在標題列的狀態文字：成功維持安靜（不朗讀），失敗改成錯誤樣式並以 role=alert 通知讀屏軟體。

/** 執行 save()，回傳它的結果；失敗時回傳 null 並顯示「儲存失敗」。 */
export async function runAutosave(statusEl, save) {
    try {
        const result = await save();
        const time = new Date().toLocaleTimeString("zh-TW", { hour12: false });
        setStatus(statusEl, `已自動儲存 ${time}`, false);
        return result;
    } catch (err) {
        console.error("自動儲存失敗", err);
        setStatus(statusEl, "儲存失敗：瀏覽器空間不足或被封鎖，請先匯出檔案備份", true);
        return null;
    }
}

function setStatus(el, text, isError) {
    el.textContent = text;
    el.classList.toggle("is-negative", isError);
    el.classList.toggle("is-description", !isError);
    if (isError) el.setAttribute("role", "alert");
    else el.removeAttribute("role");
}
