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
    assert.deepStrictEqual(findCandidates(DOC).list.filter(c => c.kind === 'macro').map(c => c.name), ['ben', 'todo', 'textbf']));
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

const LIST = [{ kind: 'macro', name: 'ben' }, { kind: 'expr', expr: 'green!50!black', names: ['green', 'black'] }, { kind: 'macro', name: 'textbf' },
    { kind: 'expr', expr: 'Maroon', names: ['Maroon'] }, { kind: 'macro', name: 'hl' }];

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
    const r = parseProbeLog(CLEAN, LIST);
    assert.deepStrictEqual(r.baseline, [0, 0, 0]);
    assert.deepStrictEqual(r.results.map(x => x.status), ['ok', 'ok', 'neutral', 'undefined', 'failed']);
    assert.deepStrictEqual(r.results[0].rgb, [1, 0.4, 0.2]);
    assert.strictEqual(r.fatal, null);
});
test('parseProbeLog: an error between markers fails that candidate only', () => {
    const log = CLEAN.replace('LCBEGIN 1\n', 'LCBEGIN 1\n! LaTeX Error: Not allowed in LR mode.\nl.27 ...\n');
    const r = parseProbeLog(log, LIST);
    assert.deepStrictEqual(r.results.map(x => x.status), ['failed', 'ok', 'neutral', 'undefined', 'failed']);
    assert.strictEqual(r.results[0].error, '! LaTeX Error: Not allowed in LR mode.');
});
test('parseProbeLog: a fatal stop fails that candidate and leaves the rest unknown', () => {
    const log = CLEAN.split('LCBEGIN 3')[0] + 'LCBEGIN 3\n! Emergency stop.\n*** (job aborted, no legal \\end found)\n';
    const r = parseProbeLog(log, LIST);
    assert.strictEqual(r.fatal, 2);
    assert.deepStrictEqual(r.results.map(x => x && x.status), ['ok', 'ok', 'failed', null, null]);
    assert.strictEqual(r.results[2].error, '! Emergency stop.');
});
test('parseProbeLog: no baseline means the preamble failed', () =>
    assert.strictEqual(parseProbeLog('! LaTeX Error: File `nosuch.sty\' not found.\n', LIST).fatal, -1));

test('runProbe: reruns after a fatal stop with only the later candidates', async () => {
    const seen = [];
    const compile = async tex => {
        const ids = [...tex.matchAll(/\\lcbegin\{(\d+)\}/g)].map(m => +m[1]);
        seen.push(ids.length - 1);
        if (ids.length === LIST.length + 1) return CLEAN.split('LCBEGIN 3')[0] + 'LCBEGIN 3\n! Emergency stop.\n';
        return 'LCBEGIN 0\nLCRESULT 0=0,0,0\nLCEND 0\nLCBEGIN 1\nLCRESULT 1=undefined\nLCEND 1\nLCBEGIN 2\nLCRESULT 2=1,1,0\nLCEND 2\n';
    };
    const r = await runProbe('\\documentclass{article}\n', LIST, compile);
    assert.deepStrictEqual(seen, [5, 2]);
    assert.strictEqual(r.runs, 2);
    assert.deepStrictEqual(r.results.map(x => x.status), ['ok', 'ok', 'failed', 'undefined', 'ok']);
    assert.deepStrictEqual(r.results[4].rgb, [1, 1, 0]);
});
test('runProbe: at most maxRuns compiles', async () => {
    let n = 0;
    const r = await runProbe('', LIST, async () => (n++, 'LCBEGIN 0\nLCRESULT 0=0,0,0\nLCEND 0\nLCBEGIN 1\n! Emergency stop.\n'), 2);
    assert.strictEqual(n, 2);
    assert.deepStrictEqual(r.results.map(x => x.status), ['failed', 'failed', 'failed', 'failed', 'failed']);
});
test('runProbe: nothing to probe, no compile', async () =>
    assert.strictEqual((await runProbe('', [], async () => assert.fail('compiled'))).runs, 0));

test('toProbed: ok results only, by macro name and expression', () =>
    assert.deepStrictEqual(toProbed(LIST, parseProbeLog(CLEAN, LIST).results),
        { macros: { ben: [1, 0.4, 0.2] }, exprs: { 'green!50!black': [0, 0.5, 0] } }));

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
