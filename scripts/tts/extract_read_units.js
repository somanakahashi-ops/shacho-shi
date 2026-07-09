/* ================================================================
   extract_read_units.js
   ── 事前生成TTS用：本文から「読み上げ単位」を抽出する

   何をするか:
     data/book-data.js を読み、各ページ（モバイル読み上げ単位）と
     各見開き（PC読み上げ単位）の「読み上げテキスト」を、重複を除いて
     取り出し、ハッシュ付きで scripts/tts/read-units.json に書き出す。

   ハッシュ（FNV-1a）は js/util.js の ttsHash() と完全に一致させること。
   同じ文章→同じハッシュ→同じ音声ファイル、という対応で音声を引く。

   使い方:  node scripts/tts/extract_read_units.js
   ================================================================ */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const src = fs.readFileSync(path.join(ROOT, 'data', 'book-data.js'), 'utf8');
const sandbox = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console };
vm.createContext(sandbox);
vm.runInContext(src + '\nthis.__PAGES = PAGES;', sandbox);
const PAGES = sandbox.__PAGES;

// js/PageContentRenderer.js の getPageReadText と同じ組み立て
function readText(p) {
    if (!p) return '';
    const parts = [];
    if (p.chapter)  parts.push(p.chapter);
    if (p.title)    parts.push(p.title);
    if (p.question) parts.push(p.question);
    if (p.answer)   parts.push(p.answer);
    if (p.body)     parts.push(p.body);
    return parts.join('。 ').replace(/\n/g, ' ').trim();
}

// js/util.js の ttsHash と一致（FNV-1a 32bit → 8桁hex）
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
}

const seen = new Set();
const out = [];
const add = (t) => { if (t && !seen.has(t)) { seen.add(t); out.push({ hash: fnv1a(t), text: t }); } };

// ページ単位（モバイル）
PAGES.forEach((p) => add(readText(p)));
// 見開き単位（PC）: book-data.js と同じく2枚ずつ組にする
const padded = (PAGES.length % 2 === 0) ? PAGES : [...PAGES, {}];
for (let i = 0; i < padded.length; i += 2) {
    const spread = [readText(padded[i]), readText(padded[i + 1])].filter(Boolean).join('。 ');
    add(spread);
}

const outPath = path.join(__dirname, 'read-units.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log('read-units:', out.length, '/ total chars:', out.reduce((s, p) => s + p.text.length, 0));
console.log('written:', outPath);
