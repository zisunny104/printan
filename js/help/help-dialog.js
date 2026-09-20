// 「使用說明」modal：內文寫在 help/help.md（Markdown，以 ## 分章），第一次開啟時載入並轉成 HTML，
// 每章一個分頁。載入失敗只顯示簡短錯誤，不留空白。標記與轉換規則見 markdown.js。

import { renderMarkdown, splitChapters } from "./markdown.js";

export function wireHelpDialog() {
    const dialog = document.getElementById("help-dialog");
    const openButton = document.getElementById("btn-help");
    if (!dialog || !openButton) return;
    const tabsBox = dialog.querySelector(".help-tabs");
    const body = dialog.querySelector(".help-body");
    const src = dialog.dataset.helpSrc;
    let loaded = false;
    let loading = null;

    function showError() {
        tabsBox.hidden = true;
        body.textContent = "";
        const notice = document.createElement("div");
        notice.className = "ts-notice is-negative";
        const content = document.createElement("div");
        content.className = "content";
        content.textContent = "說明載入失敗，請關閉後再開一次。";
        notice.appendChild(content);
        body.appendChild(notice);
    }

    function select(name) {
        for (const tab of tabsBox.children) {
            const active = tab.dataset.helpTab === name;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
        }
        for (const panel of body.children) panel.hidden = panel.dataset.helpPanel !== name;
        body.scrollTop = 0;
    }

    function build(chapters) {
        tabsBox.hidden = false;
        tabsBox.textContent = "";
        body.textContent = "";
        chapters.forEach((chapter, index) => {
            const name = String(index);
            const tab = document.createElement("a");
            tab.className = "item";
            tab.setAttribute("role", "tab");
            tab.dataset.helpTab = name;
            tab.textContent = chapter.title;
            tab.addEventListener("click", () => select(name));
            tabsBox.appendChild(tab);
            const panel = document.createElement("div");
            panel.dataset.helpPanel = name;
            panel.innerHTML = renderMarkdown(chapter.body); // markdown.js 已先跳脫再套標記
            body.appendChild(panel);
        });
        select("0");
        loaded = true;
    }

    function load() {
        if (loaded || loading) return;
        loading = fetch(src)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.text();
            })
            .then((text) => {
                const chapters = splitChapters(text);
                if (!chapters.length) throw new Error("沒有章節");
                build(chapters);
            })
            .catch((err) => {
                console.error("使用說明載入失敗", err);
                showError();
            })
            .finally(() => { loading = null; });
    }

    openButton.addEventListener("click", () => {
        dialog.showModal();
        load();
    });
    document.getElementById("btn-help-close")?.addEventListener("click", () => dialog.close());
}
