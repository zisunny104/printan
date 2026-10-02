import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildEmbeddedFonts } from '../js/core/web-fonts.js';
import { FONT_LICENSES } from '../js/core/font-licenses.js';
import { serializeProject, loadProject } from '../js/core/schema.js';
const originalFetch = globalThis.fetch;
globalThis.location = { href: 'https://fixture.test/' };
globalThis.fetch = async (url) => String(url).endsWith('.css')
    ? { ok:true, text:async()=> '@font-face{src:url(fixture.woff2);unicode-range:U+0-7F;}' }
    : { ok:true, arrayBuffer:async()=>new Uint8Array([119,79,70,50]).buffer };
try {
    for (const family of ['Sarasa Mono TC', 'JetBrains Mono']) {
        const licenseFile = family === 'Sarasa Mono TC' ? '../fonts/sarasa-mono-tc/LICENSE.txt' : '../licenses/JetBrainsMono-OFL.txt';
        assert.equal(FONT_LICENSES[family].text, fs.readFileSync(new URL(licenseFile, import.meta.url),'utf8'));
        const elements = [{type:'text',runs:[{text:'ABC',fontFamily:family}]}];
        const result = await buildEmbeddedFonts(elements, family);
        assert.equal(result.fonts.length,1);
        assert.deepEqual(result.failed,[]);
        assert.equal(result.fonts[0].license.license,'OFL-1.1');
        assert.equal(result.fonts[0].license.text,FONT_LICENSES[family].text);
        const json=serializeProject({ format:'ptan',version:3,assets:[],template:{pages:[{elements}]},embeddedFonts:result.fonts });
        const restored=loadProject(json);
        assert.equal(restored.ok,true);
        assert.deepEqual(restored.project.embeddedFonts[0].license,result.fonts[0].license);
    }
    console.log('fontcheck：兩款字型匯出附完整授權、著作權及來源，.ptan 往返保留');
} finally { globalThis.fetch=originalFetch; delete globalThis.location; }
