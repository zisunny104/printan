// 「授權」modal：內文讀根目錄 LICENSE（Markdown，以 ## 分章），第一次開啟時載入並轉成 HTML，
// 每章一個分頁。載入失敗只顯示簡短錯誤，不留空白。標記與轉換規則見 markdown.js。

import { renderMarkdown, splitChapters } from "./markdown.js";

export function wireLicenseDialog() {
    const dialog = document.getElementById("license-dialog");
    const openButton = document.getElementById("btn-license");
    if (!dialog || !openButton) return;
    const tabsBox = dialog.querySelector(".help-tabs");
    const body = dialog.querySelector(".help-body");
    const src = dialog.dataset.licenseSrc;
    let loaded = false;
    let loading = null;

    function showError() {
        tabsBox.hidden = true;
        if (dialog.open) document.getElementById("btn-license-close")?.focus();
        body.textContent = "";
        const notice = document.createElement("div");
        notice.className = "ts-notice is-negative";
        const content = document.createElement("div");
        content.className = "content";
        content.textContent = "授權資訊載入失敗，請關閉後再開一次。";
        notice.appendChild(content);
        body.appendChild(notice);
    }

    function select(name, { focus = false } = {}) {
        for (const tab of tabsBox.children) {
            const active = tab.dataset.licenseTab === name;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1; // roving tabindex：Tab 只停在目前分頁，方向鍵切換
            if (active && focus) tab.focus();
        }
        for (const panel of body.children) panel.hidden = panel.dataset.licensePanel !== name;
        body.scrollTop = 0;
    }

    tabsBox.addEventListener("keydown", (e) => {
        const tabs = [...tabsBox.children];
        const current = tabs.findIndex((t) => t === document.activeElement);
        if (current < 0) return;
        const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        select(String((next + tabs.length) % tabs.length), { focus: true });
    });

    function build(chapters) {
        tabsBox.hidden = false;
        tabsBox.textContent = "";
        body.textContent = "";
        chapters.forEach((chapter, index) => {
            const name = String(index);
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = "item";
            tab.id = `license-tab-${name}`;
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-controls", `license-panel-${name}`);
            tab.dataset.licenseTab = name;
            tab.textContent = chapter.title;
            tab.addEventListener("click", () => select(name));
            tabsBox.appendChild(tab);
            const panel = document.createElement("div");
            panel.id = `license-panel-${name}`;
            panel.setAttribute("role", "tabpanel");
            panel.setAttribute("aria-labelledby", `license-tab-${name}`);
            panel.dataset.licensePanel = name;
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
                if (dialog.open) tabsBox.querySelector('[tabindex="0"]')?.focus();
            })
            .catch((err) => {
                console.error("授權資訊載入失敗", err);
                showError();
            })
            .finally(() => { loading = null; });
    }

    // 開啟時焦點放在目前分頁（還在載入或失敗時放在關閉鈕）；Esc 由 <dialog> 原生處理，
    // 關閉後（Esc 或關閉鈕）焦點明確還給開啟鈕。
    openButton.addEventListener("click", () => {
        dialog.showModal();
        load();
        (tabsBox.querySelector('[tabindex="0"]') ?? document.getElementById("btn-license-close"))?.focus();
    });
    dialog.addEventListener("close", () => openButton.focus());
    document.getElementById("btn-license-close")?.addEventListener("click", () => dialog.close());
}
