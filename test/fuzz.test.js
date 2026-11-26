// Random token soups: no exception, spans in bounds, scan sorted and non-overlapping, fast.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scan, spans } = require('../src/colors');
const { marks } = require('../src/marks');

const TOKENS = ['\\textcolor{red}{', '\\color{blue}', '{', '}', '%', '\\%', '\\{', '\\}', '\\\\', 'text ', '\n', '\n\n',
    '\\definecolor{c}{RGB}{1,2,3}', '\\newcommand{\\x}[1]{\\textcolor{c}{#1}}', '\\x{', '[[', ']]', 'xx', '((', '))', '....'];

function mulberry32(a) {
    return () => {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function doc(seed) {
    const r = mulberry32(seed), n = Math.floor(r() * 401);
    return Array.from({ length: n }, () => TOKENS[Math.floor(r() * TOKENS.length)]).join('');
}

const inBounds = (s, n) => Number.isInteger(s.start) && Number.isInteger(s.end) && 0 <= s.start && s.start < s.end && s.end <= n;

test('fuzz: 2000 documents', () => {
    for (let seed = 1; seed <= 2000; seed++) {
        const t = doc(seed), where = `seed ${seed}, document ${JSON.stringify(t)}`;
        try {
            const t0 = performance.now();
            const raw = spans(t), seg = scan(t), mk = marks(t);
            const ms = performance.now() - t0;
            for (const s of [...raw, ...seg, ...mk]) assert.ok(inBounds(s, t.length), `span out of bounds ${JSON.stringify(s)}`);
            for (let k = 1; k < seg.length; k++) assert.ok(seg[k - 1].end <= seg[k].start, `scan overlaps at ${k}`);
            assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
        } catch (e) {
            throw new Error(`${e.message}\n${where}`, { cause: e });
        }
    }
});
