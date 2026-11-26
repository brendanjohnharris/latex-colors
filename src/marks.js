// @ts-check
// Editorial marks (scientific-writing skill): [[rewrite]], xxrephrasexx, ((note)), ....expand....
'use strict';

// Default of latexColors.marks.patterns (package.json holds the same list; a unit test keeps them equal).
const DEFAULT_PATTERNS = [ // Fathom: seohae, bermejo, ianthina, qinghai
    { name: 'rewrite', regex: '\\[\\[[\\s\\S]*?\\]\\]', color: '#ffa829' },
    // A run of 2+ x not inside a word, either wrapping text (no new run opened inside) or bare (xxx, xxxxes).
    { name: 'rephrase', regex: '(?<![A-Za-z])x{2,}(?:(?:(?![^A-Za-z]x{2})[^\\n])*?x{2,}(?![A-Za-z])|[A-Za-z]*)', color: '#f93d53' },
    { name: 'note', regex: '\\(\\([\\s\\S]*?\\)\\)', color: '#b97ad7' },
    { name: 'expand', regex: '\\.{4,}(?:[^\\n]*?\\.{4,})?', color: '#88bd69' },
];

/**
 * Compile { name, regex, color, background, fontStyle } entries; an entry without a name, regex or
 * color, with a regex that does not compile, or that matches the empty string is reported and skipped.
 * @returns {{ patterns: Array<{ kind: string, re: RegExp, color: string, background?: string, fontStyle: string }>, errors: string[] }}
 */
function compilePatterns(list) {
    const patterns = [], errors = [];
    (Array.isArray(list) ? list : []).forEach((p, k) => {
        const name = typeof p?.name === 'string' && p.name ? p.name : `(entry ${k + 1})`;
        try {
            if (name.startsWith('(') || typeof p.regex !== 'string' || typeof p.color !== 'string') throw new Error('needs a name, a regex and a color');
            const re = new RegExp(p.regex, 'g');
            if (new RegExp(p.regex).exec('')?.[0] === '') throw new Error('matches the empty string');
            const background = p.background ?? (/^#[0-9a-f]{6}$/i.test(p.color) ? p.color + '26' : undefined); // 15% opacity
            patterns.push({ kind: name, re, color: p.color, background, fontStyle: p.fontStyle ?? 'italic' });
        } catch (e) { errors.push(`${name}: ${e.message}`); }
    });
    return { patterns, errors };
}

const MARKS = compilePatterns(DEFAULT_PATTERNS).patterns;

function marks(text, patterns = MARKS) {
    const out = [];
    for (const { kind, re } of patterns)
        for (const m of text.matchAll(re)) if (m[0]) out.push({ start: m.index, end: m.index + m[0].length, kind });
    return out;
}

module.exports = { marks, compilePatterns, MARKS, DEFAULT_PATTERNS };
