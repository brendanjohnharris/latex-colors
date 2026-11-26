// node scripts/gen-names.js: write src/names.json, the dvipsnames, svgnames and x11names color sets as rgb,
// from the installed TeX distribution (kpsewhich). Rerun when xcolor or graphics updates these files.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseSpec } = require('../src/colors');

const FILES = { dvipsnames: 'dvipsnam.def', svgnames: 'svgnam.def', x11names: 'x11nam.def' };
const round = c => c.map(x => +x.toFixed(4));

function parse(text) {
    const out = {}, code = text.replace(/%.*$/gm, '');
    for (const m of code.matchAll(/\\DefineNamedColor\{named\}\{(\w+)\}\s*\{(\w+)\}\{([^}]*)\}/g)) out[m[1]] = round(parseSpec(m[2], m[3]));
    for (const m of code.matchAll(/\\preparecolorset\{(\w+)\}\{\}\{\}\{([^}]*)\}/g))
        for (const entry of m[2].split(';').map(s => s.trim()).filter(Boolean)) {
            const k = entry.indexOf(',');
            out[entry.slice(0, k)] = round(parseSpec(m[1], entry.slice(k + 1)));
        }
    return out;
}

const sets = {}, source = {};
for (const [set, file] of Object.entries(FILES)) {
    const p = execFileSync('kpsewhich', [file], { encoding: 'utf8' }).trim(), text = fs.readFileSync(p, 'utf8');
    sets[set] = parse(text);
    source[set] = `${file} ${(/\\ProvidesFile\{[^}]*\}\s*\[([^\]]*)\]/.exec(text) || [])[1]}`;
    console.log(`${set}: ${Object.keys(sets[set]).length} colors from ${p}`);
}
fs.writeFileSync(path.join(__dirname, '..', 'src', 'names.json'), JSON.stringify({ source, sets }) + '\n');
