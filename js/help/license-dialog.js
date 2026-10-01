// 「授權」modal：兩個固定分頁，第一次開啟時平行載入對應檔案並轉成 HTML。
// LICENSE 維持純英文官方範本（供 GitHub 授權徽章偵測），中文譯文與第三方元件各自分檔，
// 這樣才不會干擾 GitHub 對 LICENSE 內容的自動比對。載入失敗只顯示簡短錯誤，不留空白。
// 標記與轉換規則見 markdown.js。

import { renderMarkdown } from "./markdown.js";

const TABS = [
    { title: "MIT License", files: ["LICENSE", "LICENSE.zh-TW.md"] },
    { title: "第三方元件", files: ["THIRD-PARTY-NOTICES.md"] },
];

export function wireLicenseDialog() {
    const dialog = document.getElementById("license-dialog");
    const openButton = document.getElementById("btn-license");
    if (!dialog || !openButton) return;
    const tabsBox = dialog.querySelector(".help-tabs");
    const body = dialog.querySelector(".help-body");
    const base = dialog.dataset.licenseBase;
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

    function build(bodies) {
        tabsBox.hidden = false;
        tabsBox.textContent = "";
        body.textContent = "";
        TABS.forEach((tabDef, index) => {
            const name = String(index);
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = "item";
            tab.id = `license-tab-${name}`;
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-controls", `license-panel-${name}`);
            tab.dataset.licenseTab = name;
            tab.textContent = tabDef.title;
            tab.addEventListener("click", () => select(name));
            tabsBox.appendChild(tab);
            const panel = document.createElement("div");
            panel.id = `license-panel-${name}`;
            panel.setAttribute("role", "tabpanel");
            panel.setAttribute("aria-labelledby", `license-tab-${name}`);
            panel.dataset.licensePanel = name;
            panel.innerHTML = bodies[index]; // markdown.js 已先跳脫再套標記
            body.appendChild(panel);
        });
        select("0");
        loaded = true;
    }

    function load() {
        if (loaded || loading) return;
        loading = Promise.all(
            TABS.map((tabDef) =>
                Promise.all(
                    tabDef.files.map((file) =>
                        fetch(`${base}/${file}`).then((res) => {
                            if (!res.ok) throw new Error(`HTTP ${res.status}（${file}）`);
                            return res.text();
                        })
                    )
                ).then((texts) => renderMarkdown(texts.join("\n\n---\n\n")))
            )
        )
            .then((bodies) => {
                build(bodies);
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
