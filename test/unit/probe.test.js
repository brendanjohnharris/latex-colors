'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { preambleOf, findCandidates, buildProbe, parseProbeLog, runProbe, cacheKey, toProbed, serialize, LIMIT } = require('../../src/probe');
const { matchSnapshot } = require('../snapshot');

const DOC = String.raw`\documentclass{article}
\usepackage{xcolor}
% \begin{document} in a comment
\newcommand{\ben}[1]{\textcolor{orange}{#1}}
\begin{document}
\section{Intro} \ben{a} \ben{b} \todo{c} \textbf{d} \cite{k} \citep{k} \cref{x} \label{y}
\textcolor{red!30!blue}{e} {\color{ red }f} \colorbox{-Maroon}{g} \textcolor[rgb]{1,0,0}{h} \textcolor{#1}{i}
% \commented{x}
\end{document}
`;

test('preambleOf: text before the first \\begin{document} outside a comment', () =>
    assert.strictEqual(preambleOf(DOC), DOC.slice(0, DOC.indexOf('\\begin{document}\n\\section'))));
test('preambleOf: null without \\begin{document}', () => assert.strictEqual(preambleOf('\\section{x}'), null));

test('findCandidates: body macros with a braced argument, minus the deny list, in order, once each', () =>
    assert.deepStrictEqual(findCandidates(DOC).list.filter(c => c.kind === 'macro').map(c => c.name), ['ben', 'todo'])); // \\textbf is denied (review B11)
test('findCandidates: named expressions, trimmed; models and parameters skipped', () =>
    assert.deepStrictEqual(findCandidates(DOC).list.filter(c => c.kind === 'expr'),
        [{ kind: 'expr', expr: 'orange', names: ['orange'] }, { kind: 'expr', expr: 'red!30!blue', names: ['red', 'blue'] },
            { kind: 'expr', expr: 'red', names: ['red'] }, { kind: 'expr', expr: '-Maroon', names: ['Maroon'] }]));
test('findCandidates: limit, with the count truncated', () => {
    const name = i => { let s = ''; do { s = String.fromCharCode(97 + i % 26) + s; i = Math.floor(i / 26); } while (i); return 'm' + s; };
    const body = Array.from({ length: LIMIT + 7 }, (_, i) => `\\${name(i)}{x}`).join(' ');
    const r = findCandidates(`\\begin{document}${body}\\end{document}`);
    assert.strictEqual(r.list.length, LIMIT);
    assert.strictEqual(r.truncated, 7);
});

const LIST = [{ kind: 'macro', name: 'ben', args: 1 }, { kind: 'expr', expr: 'green!50!black', names: ['green', 'black'] }, { kind: 'macro', name: 'textbf', args: 1 },
    { kind: 'expr', expr: 'Maroon', names: ['Maroon'] }, { kind: 'macro', name: 'hl', args: 1 }, { kind: 'macro', name: 'replaced', args: 2 }];
const LIST5 = LIST.slice(0, 5); // the candidates CLEAN reports on

test('buildProbe snapshot', () =>
    matchSnapshot(path.join(__dirname, 'probe-build.expected.tex'), buildProbe('\\documentclass{article}\n', LIST)));

// Log shapes recorded from pdflatex (TeX Live 2026) runs of buildProbe output.
const CLEAN = `This is pdfTeX
LCBEGIN 0
LCRESULT 0=0,0,0
LCEND 0
LCBEGIN 1
LCRESULT 1=1,0.4,0.2
LCEND 1
LCBEGIN 2
LCRESULT 2=0,0.5,0
LCEND 2
LCBEGIN 3
LCRESULT 3=0,0,0
LCEND 3
LCBEGIN 4
LCRESULT 4=undefined
LCEND 4
LCBEGIN 5
LCRESULT {5}=0,0,0
LCEND 5
`;
test('parseProbeLog: ok, neutral, undefined; a mangled id is failed', () => {
    const r = parseProbeLog(CLEAN, LIST5);
    assert.deepStrictEqual(r.baseline, [0, 0, 0]);
    assert.deepStrictEqual(r.results.map(x => x.status), ['ok', 'ok', 'neutral', 'undefined', 'failed']);
    assert.deepStrictEqual(r.results[0].rgb, [1, 0.4, 0.2]);
    assert.strictEqual(r.fatal, null);
});
test('parseProbeLog: an error between markers fails that candidate only', () => {
    const log = CLEAN.replace('LCBEGIN 1\n', 'LCBEGIN 1\n! LaTeX Error: Not allowed in LR mode.\nl.27 ...\n');
    const r = parseProbeLog(log, LIST5);
    assert.deepStrictEqual(r.results.map(x => x.status), ['failed', 'ok', 'neutral', 'undefined', 'failed']);
    assert.strictEqual(r.results[0].error, '! LaTeX Error: Not allowed in LR mode.');
});
test('parseProbeLog: a fatal stop fails that candidate and leaves the rest unknown', () => {
    const log = CLEAN.split('LCBEGIN 3')[0] + 'LCBEGIN 3\n! Emergency stop.\n*** (job aborted, no legal \\end found)\n';
    const r = parseProbeLog(log, LIST5);
    assert.strictEqual(r.fatal, 2);
    assert.deepStrictEqual(r.results.map(x => x && x.status), ['ok', 'ok', 'failed', null, null]);
    assert.strictEqual(r.results[2].error, '! Emergency stop.');
});
test('parseProbeLog: no baseline means the preamble failed', () =>
    assert.strictEqual(parseProbeLog('! LaTeX Error: File `nosuch.sty\' not found.\n', LIST5).fatal, -1));

test('runProbe: reruns after a fatal stop with only the later candidates', async () => {
    const seen = [];
    const compile = async tex => {
        const ids = [...tex.matchAll(/\\lcbegin\{(\d+)\}/g)].map(m => +m[1]);
        seen.push(ids.length - 1);
        if (ids.length === LIST5.length + 1) return CLEAN.split('LCBEGIN 3')[0] + 'LCBEGIN 3\n! Emergency stop.\n';
        return 'LCBEGIN 0\nLCRESULT 0=0,0,0\nLCEND 0\nLCBEGIN 1\nLCRESULT 1=undefined\nLCEND 1\nLCBEGIN 2\nLCRESULT 2=1,1,0\nLCEND 2\n';
    };
    const r = await runProbe('\\documentclass{article}\n', LIST5, compile);
    assert.deepStrictEqual(seen, [5, 2]);
    assert.strictEqual(r.runs, 2);
    assert.deepStrictEqual(r.results.map(x => x.status), ['ok', 'ok', 'failed', 'undefined', 'ok']);
    assert.deepStrictEqual(r.results[4].rgb, [1, 1, 0]);
});
test('runProbe: at most maxRuns compiles', async () => {
    let n = 0;
    const r = await runProbe('', LIST5, async () => (n++, 'LCBEGIN 0\nLCRESULT 0=0,0,0\nLCEND 0\nLCBEGIN 1\n! Emergency stop.\n'), 2);
    assert.strictEqual(n, 2);
    assert.deepStrictEqual(r.results.map(x => x.status), ['failed', 'failed', 'failed', 'failed', 'failed']);
});
test('runProbe: nothing to probe, no compile', async () =>
    assert.strictEqual((await runProbe('', [], async () => assert.fail('compiled'))).runs, 0));

test('toProbed: ok results only, by macro name and expression', () =>
    assert.deepStrictEqual(toProbed(LIST5, parseProbeLog(CLEAN, LIST5).results),
        { macros: { ben: [1, 0.4, 0.2] }, exprs: { 'green!50!black': [0, 0.5, 0] }, arity: { ben: 1 }, neutral: { textbf: true } }));

test('cacheKey: stable under candidate order, sensitive to engine and preamble', () => {
    const k = cacheKey('pdflatex', 'P', LIST);
    assert.strictEqual(k, cacheKey('pdflatex', 'P', [...LIST].reverse()));
    assert.notStrictEqual(k, cacheKey('lualatex', 'P', LIST));
    assert.notStrictEqual(k, cacheKey('pdflatex', 'Q', LIST));
});

test('serialize: one run per key at a time; calls during a run queue one more with the latest argument', async () => {
    const calls = [], gates = [];
    const run = serialize((key, arg) => { calls.push(`${key}${arg}`); return new Promise(r => gates.push(r)); });
    run('a', 1); run('a', 2); run('a', 3); run('b', 1);
    await new Promise(r => setImmediate(r));
    assert.deepStrictEqual(calls, ['a1', 'b1']);
    gates.shift()(); gates.shift()();
    await new Promise(r => setImmediate(r));
    assert.deepStrictEqual(calls, ['a1', 'b1', 'a3']);
    gates.shift()();
});
test('serialize: a failing run does not block the next', async () => {
    const calls = [];
    const run = serialize(async (key, arg) => { calls.push(arg); throw new Error('boom'); });
    await run('a', 1);
    await run('a', 2);
    assert.deepStrictEqual(calls, [1, 2]);
});
test('findCandidates: macros from files pulled in after \\begin{document}; preamble files give expressions only', () => {
    const root = '\\documentclass{article}\\input{macros}\\begin{document}\\include{one}\\end{document}';
    const files = [{ text: '\\newcommand\\ben[1]{\\textcolor{teal}{#1}}\\pre{x}', body: false }, { text: '\\ben{a} \\textcolor{Maroon}{b}', body: true }];
    const list = findCandidates(root, files).list;
    assert.deepStrictEqual(list.filter(c => c.kind === 'macro').map(c => c.name), ['ben']);
    assert.deepStrictEqual(list.filter(c => c.kind === 'expr').map(c => c.expr), ['teal', 'Maroon']);
});

// Review round 2: probe.
test('findCandidates: optional arguments skipped, mandatory arguments counted (review B3, B5)', () => {
    const t = '\\begin{document}\\added[id=BH]{a} \\replaced{new}{old} \\note{x}\\end{document}';
    assert.deepStrictEqual(findCandidates(t).list.map(c => [c.name, c.args]), [['added', 1], ['replaced', 2], ['note', 1]]);
});
test('findCandidates: math, font and box commands are not candidates; expressions come first (review B11)', () => {
    const t = '\\begin{document}\\ben{x} \\frac{a}{b} \\mathbf{x} \\textbf{y} \\hat{z} \\mbox{w} \\SI{1}{m} \\text{t} \\textcolor{red}{r}\\end{document}';
    assert.deepStrictEqual(findCandidates(t).list.map(c => c.name ?? c.expr), ['red', 'ben']);
});
test('findCandidates: extended xcolor expressions skip the undefined-name check (review B8)', () =>
    assert.deepStrictEqual(findCandidates('\\textcolor{rgb:red,1;green,2}{x} \\textcolor{red>wheel,3}{y}').list.map(c => c.names), [[], []]));
test('buildProbe: \\lcreport is protected, and every mandatory argument reports (review B3)', () => {
    const tex = buildProbe('', LIST);
    assert.match(tex, /\\protected\\def\\lcreport#1/);
    assert.match(tex, /\\replaced\{\\lcreport\{6\}\}\{\\lcreport\{6\}\}/);
});
test('parseProbeLog: of several reports for one candidate, the first that differs from the text color counts', () => {
    const log = CLEAN + 'LCBEGIN 6\nLCRESULT 6=0,0,0\nLCRESULT 6=0,0,1\nLCRESULT 6=1,0,0\nLCEND 6\n';
    assert.deepStrictEqual(parseProbeLog(log, LIST).results[5], { status: 'ok', rgb: [0, 0, 1] });
});
test('toProbed: neutral macros and the argument count are recorded (review B4)', () => {
    const p = toProbed(LIST, parseProbeLog(CLEAN + 'LCBEGIN 6\nLCRESULT 6=0,0,1\nLCEND 6\n', LIST).results);
    assert.deepStrictEqual([p.neutral, p.arity], [{ textbf: true }, { ben: 1, replaced: 2 }]);
});
test('findCandidates: a macro\'s argument count is the fewest seen, so a following group does not count (review 2, item 4)', () =>
    assert.deepStrictEqual(findCandidates('\\begin{document}\\added{word} {\\small x} \\added{other}.\\end{document}').list.map(c => [c.name, c.args]),
        [['added', 1]]));
