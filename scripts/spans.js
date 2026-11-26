// node scripts/spans.js file.tex: list the colored spans and marks found in a file.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { scan, readable } = require('../src/colors');
const { marks } = require('../src/marks');

// Colors (for .tex only, as in the extension) then marks.
const snapshot = (text, ext = '.tex') => readable(text, ext === '.tex' ? scan(text) : [], marks(text));

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
