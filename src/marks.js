// @ts-check
// Editorial marks (scientific-writing skill): [[rewrite]], xxrephrasexx, ((note)), ....expand....
'use strict';
const { mask } = require('./colors');

// Default of latexColors.marks.patterns (package.json holds the same list; a unit test keeps them equal).
const DEFAULT_PATTERNS = [ // Fathom: seohae, bermejo, ianthina, qinghai
    // [[...]] and ((...)) stay within a paragraph and close at the first pair, so math such as $((a+b)c$ never opens one.
    { name: 'rewrite', regex: '\\[\\[(?:(?!\\n[ \\t]*\\n|\\[\\[)[^\\]])*?\\]\\]', color: '#ffa829' },
    // A run of 2+ x not inside a word: wrapping text up to a closing run (not crossing a new opener; a run followed by
    // a space or punctuation is a bare placeholder), or bare (xxx, xxxxes).
    { name: 'rephrase', regex: '(?<![A-Za-z])x{2,}(?:(?![\\s\\-;,.!?:)\\]])(?:(?!(?<![A-Za-z])x{2})[^\\n])+?x{2,}(?![A-Za-z])|[A-Za-z]*)', color: '#f93d53' },
    { name: 'note', regex: '\\(\\((?:(?!\\n[ \\t]*\\n|\\(\\()[^)])*?\\)\\)', color: '#b97ad7' },
    { name: 'expand', regex: '\\.{4,}(?:[^\\n]*?\\.{4,})?', color: '#88bd69' },
];

/**
 * Compile { name, regex, color, background, fontStyle } entries; an entry without a name, regex or
 * color, with a regex that does not compile, or that matches the empty string is reported and skipped.
 * @returns {{ patterns: Array<{ kind: string, re: RegExp, color: string, background?: string, fontStyle: string }>, errors: string[] }}
 */
function compilePatterns(list) {
    const patterns = [], errors = [], names = new Set();
    (Array.isArray(list) ? list : []).forEach((p, k) => {
        const name = typeof p?.name === 'string' && p.name ? p.name : `(entry ${k + 1})`;
        try {
            if (name.startsWith('(') || typeof p.regex !== 'string' || typeof p.color !== 'string') throw new Error('needs a name, a regex and a color');
            if (names.has(name)) throw new Error('duplicate name');
            names.add(name);
            const re = new RegExp(p.regex, 'g');
            if (new RegExp(p.regex).exec('')?.[0] === '') throw new Error('matches the empty string');
            const background = p.background ?? (/^#[0-9a-f]{6}$/i.test(p.color) ? p.color + '26' : undefined); // 15% opacity
            patterns.push({ kind: name, re, color: p.color, background, fontStyle: p.fontStyle ?? 'italic' });
        } catch (e) { errors.push(`${name}: ${e.message}`); }
    });
    return { patterns, errors };
}

const MARKS = compilePatterns(DEFAULT_PATTERNS).patterns;

const blankOut = s => s.replace(/[^\n]/g, ' ');
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$[\s\S]*?(?:^[ \t]{0,3}\1[ \t]*$|(?![\s\S]))/gm;

/** Text in which marks are sought, offsets kept: LaTeX without comments and verbatim; Markdown without code. */
function markable(text, languageId) {
    if (languageId === 'latex' || languageId === 'tex') return mask(text);
    if (languageId === 'markdown') return text.replace(FENCE, blankOut).replace(/`[^`\n]+`/g, blankOut);
    return text;
}

function marks(text, patterns = MARKS) {
    const out = [];
    for (const { kind, re } of patterns)
        for (const m of text.matchAll(re)) if (m[0]) out.push({ start: m.index, end: m.index + m[0].length, kind });
    return out;
}

module.exports = { marks, markable, compilePatterns, MARKS, DEFAULT_PATTERNS };
