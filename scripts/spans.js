// node scripts/spans.js file.tex: list the colored spans and marks found in a file.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { scan, hex } = require('../src/colors');
const { marks } = require('../src/marks');

// Readable spans: colors (for .tex) then marks, rgb triples as hex.
function snapshot(text, ext = '.tex') {
    const colors = ext === '.tex' ? scan(text).map(s => ({
        text: text.slice(s.start, s.end), start: s.start, end: s.end,
        style: Object.fromEntries(Object.entries(s.style).map(([k, v]) => [k, Array.isArray(v) ? hex(v) : v])),
    })) : [];
    return [...colors, ...marks(text).map(m => ({ text: text.slice(m.start, m.end), start: m.start, end: m.end, mark: m.kind }))];
}

if (require.main === module) {
    const file = process.argv[2];
    if (!file) { console.error('usage: node scripts/spans.js file.tex'); process.exit(1); }
    const t = fs.readFileSync(file, 'utf8');
    for (const s of snapshot(t, path.extname(file))) {
        const line = t.slice(0, s.start).split('\n').length;
        console.log(String(line).padStart(5), JSON.stringify(s.style || s.mark), JSON.stringify(s.text.slice(0, 50)));
    }
}

module.exports = { snapshot };
