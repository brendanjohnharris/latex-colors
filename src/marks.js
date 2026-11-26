// @ts-check
// Editorial marks (scientific-writing skill): [[rewrite]], xxrephrasexx, ((note)), ....expand....
'use strict';

const MARKS = [ // Fathom: seohae, bermejo, ianthina, qinghai
    { kind: 'rewrite', color: '#ffa829', re: /\[\[[\s\S]*?\]\]/g },
    // A run of 2+ x not inside a word, either wrapping text (no new run opened inside) or bare (xxx, xxxxes).
    { kind: 'rephrase', color: '#f93d53', re: /(?<![A-Za-z])x{2,}(?:(?:(?![^A-Za-z]x{2})[^\n])*?x{2,}(?![A-Za-z])|[A-Za-z]*)/g },
    { kind: 'note', color: '#b97ad7', re: /\(\([\s\S]*?\)\)/g },
    { kind: 'expand', color: '#88bd69', re: /\.{4,}(?:[^\n]*?\.{4,})?/g },
];

function marks(text) {
    const out = [];
    for (const { kind, re } of MARKS)
        for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length, kind });
    return out;
}

module.exports = { marks, MARKS };
