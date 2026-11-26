// node check.js [file.tex]: asserts on a sample, then lists the spans found in a file.
'use strict';
const assert = require('assert');
const fs = require('fs');
const { scan, spans, parseExpr, BASE } = require('./colors');

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
const raw = spans(doc), seg = scan(doc);
const at = s => seg.find(x => x.start <= doc.indexOf(s) && x.end >= doc.indexOf(s) + s.length);
const hex = c => c && c.map(x => Math.round(255 * x)).join(',');

assert.deepStrictEqual(parseExpr('red!25!blue', BASE), [.25, 0, .75]);
assert.strictEqual(hex(at('a {b {c}} d').style.color), '255,102,51');      // nested braces, macro colour
assert.strictEqual(hex(at('innerw').style.color), '255,0,0');                   // inner span wins
assert.strictEqual(hex(at('outerw').style.color), '0,0,255');
assert.strictEqual(hex(at('switched').style.color), '0,128,128');          // \color to end of group
assert.ok(!at('after'));
assert.ok(!raw.some(s => doc.slice(s.start, s.end).includes('commented out')));
assert.ok(at('https://x.org/a_b'));                                        // \url inside \nao
assert.ok(!at('skip'));                                                     // unknown colour ignored
assert.strictEqual(at('gone').style.deco, 'line-through');
assert.strictEqual(hex(at('lit').style.bg), '255,179,153');                 // \sethlcolor via \colorlet mix
const { marks } = require('./marks');
const mk = t => marks(t).map(m => [m.kind, t.slice(m.start, m.end)]);
assert.deepStrictEqual(mk('the transition xxxxes and drift xxxback-and-forthxxxx, unlike Exxon or maxx'),
    [['rephrase', 'xxxxes'], ['rephrase', 'xxxback-and-forthxxxx']]);
assert.deepStrictEqual(mk('including xxx or xxx---are; N=xxx'), [['rephrase', 'xxx'], ['rephrase', 'xxx'], ['rephrase', 'xxx']]);
assert.deepStrictEqual(mk('[[redo\nthis]] ((why?)) f(x) ....grow this.... an ellipsis... here'),
    [['rewrite', '[[redo\nthis]]'], ['note', '((why?))'], ['expand', '....grow this....']]);
console.log('check: ok');

if (process.argv[2]) {
    const t = fs.readFileSync(process.argv[2], 'utf8');
    for (const s of scan(t)) {
        const line = t.slice(0, s.start).split('\n').length;
        console.log(String(line).padStart(5), JSON.stringify(s.style, (k, v) => Array.isArray(v) ? hex(v) : v), JSON.stringify(t.slice(s.start, s.end).slice(0, 50)));
    }
}
