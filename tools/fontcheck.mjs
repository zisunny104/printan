import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEmbeddedFonts } from '../js/core/web-fonts.js';
import { FONT_LICENSES } from '../js/core/font-licenses.js';
import { serializeProject, loadProject } from '../js/core/schema.js';
const originalFetch = globalThis.fetch;
globalThis.location = { href: 'https://fixture.test/' };
// 假樣式表：三個 unicode-range 分片（ASCII、CJK 標點、中日韓）
globalThis.fetch = async (url) => String(url).endsWith('.css')
    ? { ok:true, text:async()=> ['U+0-7F','U+3000-303F','U+4E00-9FFF'].map((r,i)=>`@font-face{src:url(f${i}.woff2);unicode-range:${r};}`).join('') }
    : { ok:true, arrayBuffer:async()=>new Uint8Array([119,79,70,50]).buffer };
const FAMILIES = ['Sarasa Mono TC', 'JetBrains Mono'];
const wrap = (elements, embeddedFonts) => ({ format:'ptan',version:3,assets:[],template:{pages:[{elements}]},embeddedFonts });
const textOf = (family, text) => [{type:'text',runs:[{text,fontFamily:family}]}];
try {
    // (a) 同家族多分片：只有第一片有完整授權
    const sarasa = await buildEmbeddedFonts(textOf('Sarasa Mono TC', 'A，中'), 'Sarasa Mono TC');
    assert.ok(sarasa.fonts.length >= 2);
    assert.deepEqual(sarasa.failed, []);
    assert.deepEqual(sarasa.fonts[0].license, FONT_LICENSES['Sarasa Mono TC']);
    assert.equal(sarasa.fonts[0].license.license, 'OFL-1.1');
    for (const f of sarasa.fonts.slice(1)) assert.equal('license' in f, false);

    // (b) 兩款字型各自一份
    for (const family of FAMILIES) {
        const licenseFile = family === 'Sarasa Mono TC' ? '../fonts/sarasa-mono-tc/LICENSE.txt' : '../licenses/JetBrainsMono-OFL.txt';
        assert.equal(FONT_LICENSES[family].text, fs.readFileSync(new URL(licenseFile, import.meta.url),'utf8'));
    }
    const both = await buildEmbeddedFonts([...textOf('Sarasa Mono TC', 'A中'), ...textOf('JetBrains Mono', 'AB')], 'Sarasa Mono TC');
    for (const family of FAMILIES) {
        const withLicense = both.fonts.filter((f) => f.family === family && f.license);
        assert.equal(withLicense.length, 1, family);
        assert.equal(withLicense[0].license.text, FONT_LICENSES[family].text);
        assert.equal(both.fonts.find((f) => f.family === family), withLicense[0]);
    }

    // (c) 未知家族不產生 license 欄位（空物件也不行）
    const unknownFont = { family:'No Such Font', weight:400, unicodeRange:'U+0-7F', data:'d3', license:{} };
    const unknownOut = JSON.parse(serializeProject(wrap([], [unknownFont]))).embeddedFonts[0];
    assert.equal('license' in unknownOut, false);

    // (d) .ptan 往返：授權保留
    const json = serializeProject(wrap(textOf('Sarasa Mono TC', 'A，中'), sarasa.fonts));
    const restored = loadProject(json);
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.project.embeddedFonts, sarasa.fonts);
    assert.deepEqual(restored.project.embeddedFonts[0].license, FONT_LICENSES['Sarasa Mono TC']);

    // (e) 舊格式（每片都帶完整授權）可讀，再存檔收斂為每家族一份
    const oldFonts = sarasa.fonts.map((f) => ({ ...f, license: { ...FONT_LICENSES['Sarasa Mono TC'] } }));
    const oldJson = JSON.stringify(wrap(textOf('Sarasa Mono TC', 'A，中'), oldFonts));
    const old = loadProject(oldJson);
    assert.equal(old.ok, true);
    assert.equal(old.project.embeddedFonts.length, oldFonts.length);
    assert.ok(old.project.embeddedFonts.every((f) => f.license?.text === FONT_LICENSES['Sarasa Mono TC'].text));
    const reSaved = JSON.parse(serializeProject(old.project)).embeddedFonts;
    assert.equal(reSaved.filter((f) => f.license).length, 1);
    assert.deepEqual(reSaved[0].license, FONT_LICENSES['Sarasa Mono TC']);
    assert.ok(reSaved.length > 1 && reSaved.slice(1).every((f) => !('license' in f)));

    // 體積比較：20 片同家族
    const many = Array.from({ length: 20 }, (_, i) => ({ family:'Sarasa Mono TC', weight:400, unicodeRange:`U+${i}`, data:'d3', license:{ ...FONT_LICENSES['Sarasa Mono TC'] } }));
    const before = JSON.stringify(wrap([], many), null, 2).length;
    const after = serializeProject(wrap([], many)).length;
    console.log(`fontcheck：20 片 .ptan 授權去重前 ${before} → 後 ${after} bytes（省 ${before - after}）`);
    console.log('fontcheck：同家族授權只在第一片、兩款字型各一份、未知家族不寫 license、往返與舊格式皆正常');
} finally { globalThis.fetch=originalFetch; delete globalThis.location; }
