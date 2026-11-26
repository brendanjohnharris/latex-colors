'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scan, spans, parseExpr, parseSpec, BASE } = require('../../src/colors');

const doc = String.raw`
\definecolor{myorange}{RGB}{255,102,51}
\colorlet{soft}{myorange!50}
\providecommand{\ben}[1]{\textcolor{myorange}{[#1]}}
\providecommand{\bencut}[1]{\textcolor{red}{\sout{#1}}}
\DeclareRobustCommand{\nao}[1]{{\normalfont\color{red}[Nao: #1]}}
\providecommand{\benhl}[1]{{\sethlcolor{soft}\hl{#1}}}
Text \ben{a {b {c}} d} and \textcolor{blue}{x \textcolor{red}{innerw} outerw}.
{\color{teal} switched \textbf{group}} after. % \ben{commented out}
\nao{see \url{https://x.org/a_b}} and 50\% \textcolor{nosuch}{skip} \bencut{gone} \benhl{lit}.
`;
const seg = scan(doc);
const at = s => seg.find(x => x.start <= doc.indexOf(s) && x.end >= doc.indexOf(s) + s.length);
const rgb = c => c && c.map(x => Math.round(255 * x)).join(',');

test('mix expression', () => assert.deepStrictEqual(parseExpr('red!25!blue', BASE), [.25, 0, .75]));
test('macro color across nested braces', () => assert.strictEqual(rgb(at('a {b {c}} d').style.color), '255,102,51'));
test('inner span wins', () => {
    assert.strictEqual(rgb(at('innerw').style.color), '255,0,0');
    assert.strictEqual(rgb(at('outerw').style.color), '0,0,255');
});
test('\\color runs to the end of its group', () => {
    assert.strictEqual(rgb(at('switched').style.color), '0,128,128');
    assert.ok(!at('after'));
});
test('comments are skipped', () =>
    assert.ok(!spans(doc).some(s => doc.slice(s.start, s.end).includes('commented out'))));
test('\\url inside a macro argument', () => assert.ok(at('https://x.org/a_b')));
test('unknown color ignored', () => assert.ok(!at('skip')));
test('strikethrough from \\sout', () => assert.strictEqual(at('gone').style.deco, 'line-through'));
test('\\sethlcolor via \\colorlet mix', () => assert.strictEqual(rgb(at('lit').style.bg), '255,179,153'));
// xcolor.sty v3.02, \XC@cnv@cmyk@cmy and \XC@calcT: cmy = min(1, cmy + k), then rgb = 1 - cmy.
test('cmyk converts as xcolor does', () =>
    assert.deepStrictEqual(parseSpec('cmyk', '0.25,0,0.75,0.5').map(x => +x.toFixed(6)), [0.25, 0.5, 0]));
test('names that are Object.prototype keys are unknown colors and macros', () =>
    assert.deepStrictEqual(scan('\\textcolor{constructor}{a} \\color{__proto__} \\toString{b} \\hasOwnProperty{c}'), []));

// Merging probe results (PLAN 2.7).
const PDOC = String.raw`\definecolor{myorange}{RGB}{255,102,51}
\providecommand{\bencut}[1]{\textcolor{red}{\sout{#1}}}
\providecommand{\ben}[1]{\textcolor{myorange}{#1}}
\bencut{a} \todo{b} \textcolor{Maroon}{c} {\color{ Maroon }d} \colorbox{Maroon}{e} \ben{f} \textcolor[rgb]{0,0,1}{Maroon} \constructor{h}`;
const PROBED = JSON.parse('{"macros":{"bencut":[0.5,0,0],"todo":[0,0,1]},"exprs":{"Maroon":[0.68,0,0.17]}}');
const pseg = scan(PDOC, PROBED);
const pat = s => pseg.find(x => x.start <= PDOC.lastIndexOf(s) && x.end >= PDOC.lastIndexOf(s) + s.length);

test('probe color replaces the predicted color; decoration stays', () =>
    assert.deepStrictEqual(pat('{a}').style, { color: [0.5, 0, 0], deco: 'line-through' }));
test('macro unknown to the parser, colored by the probe: command through first argument', () => {
    const s = pat('\\todo{b}');
    assert.deepStrictEqual([PDOC.slice(s.start, s.end), s.style], ['\\todo{b}', { color: [0, 0, 1] }]);
});
test('probed expressions in \\textcolor, \\color (trimmed) and \\colorbox', () => {
    assert.deepStrictEqual(pat('{c}').style, { color: [0.68, 0, 0.17] });
    assert.deepStrictEqual(pat('Maroon }d').style, { color: [0.68, 0, 0.17] });
    assert.deepStrictEqual(pat('{e}').style, { bg: [0.68, 0, 0.17] });
});
test('macros without a probe result keep the prediction', () => assert.strictEqual(rgb(pat('{f}').style.color), '255,102,51'));
test('an explicit model is never looked up', () => assert.strictEqual(rgb(pat('{Maroon}').style.color), '0,0,255'));
test('probe results parsed from JSON ignore prototype keys', () => assert.ok(!pat('{h}')));
