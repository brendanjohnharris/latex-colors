'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { marks } = require('../../src/marks');

const mk = t => marks(t).map(m => [m.kind, t.slice(m.start, m.end)]);

test('xx runs: suffix, wrapped text, words containing xx untouched', () =>
    assert.deepStrictEqual(mk('the transition xxxxes and drift xxxback-and-forthxxxx, unlike Exxon or maxx'),
        [['rephrase', 'xxxxes'], ['rephrase', 'xxxback-and-forthxxxx']]));
test('bare xxx placeholders are separate marks', () =>
    assert.deepStrictEqual(mk('including xxx or xxx---are; N=xxx'),
        [['rephrase', 'xxx'], ['rephrase', 'xxx'], ['rephrase', 'xxx']]));
test('rewrite across a newline, note, expand; ellipsis untouched', () =>
    assert.deepStrictEqual(mk('[[redo\nthis]] ((why?)) f(x) ....grow this.... an ellipsis... here'),
        [['rewrite', '[[redo\nthis]]'], ['note', '((why?))'], ['expand', '....grow this....']]));

const { compilePatterns, MARKS } = require('../../src/marks');
const pkg = require('../../package.json');

test('compilePatterns: valid entries compile, bad ones are reported by name and skipped', () => {
    const { patterns, errors } = compilePatterns([
        { name: 'todo', regex: 'TODO:[^\\n]*', color: '#ff0000' },
        { name: 'broken', regex: '([', color: '#00ff00' },
        { name: 'empty', regex: 'x*', color: '#0000ff' },
        { regex: 'nameless', color: '#0000ff' },
    ]);
    assert.deepStrictEqual(patterns.map(p => p.kind), ['todo']);
    assert.deepStrictEqual(errors.map(e => e.split(':')[0]), ['broken', 'empty', '(entry 4)']);
    assert.deepStrictEqual(marks('a TODO: fix it\nb', patterns).map(m => m.kind), ['todo']);
});
test('compilePatterns: background defaults to the color at 15% opacity, fontStyle to italic', () => {
    const [p] = compilePatterns([{ name: 'n', regex: 'n', color: '#123456' }]).patterns;
    assert.deepStrictEqual([p.background, p.fontStyle], ['#12345626', 'italic']);
});
test('the default of latexColors.marks.patterns is the built-in marks', () => {
    const def = pkg.contributes.configuration.properties['latexColors.marks.patterns'].default;
    assert.deepStrictEqual(compilePatterns(def).patterns.map(p => [p.kind, p.color, p.re.source]), MARKS.map(m => [m.kind, m.color, m.re.source]));
});
test('latexColors.marks.patterns is restricted in untrusted workspaces (a hostile regex could stall the editor)', () =>
    assert.ok(pkg.capabilities.untrustedWorkspaces.restrictedConfigurations.includes('latexColors.marks.patterns')));

// Review round 2.
const { markable } = require('../../src/marks');
test('rephrase marks wrap text ending in punctuation, math, commands and digits (review B1)', () => {
    for (const [t, want] of [
        ['xxrephrase this.xx', ['xxrephrase this.xx']], ['xxrephrase?xx', ['xxrephrase?xx']], ['xx\\cref{fig:1}xx', ['xx\\cref{fig:1}xx']],
        ['xx$a + b$xx', ['xx$a + b$xx']], ['xxN = 5xx and M = xxx', ['xxN = 5xx', 'xxx']], ['N = xxx and xxN = 5xx', ['xxx', 'xxN = 5xx']],
        ['xxx---xxx', ['xxx', 'xxx']]])
        assert.deepStrictEqual(mk(t).map(m => m[1]), want, t);
});
test('note and rewrite marks stay within a paragraph and need their own closing pair (review B2)', () => {
    assert.deepStrictEqual(mk('$((a + b) c = 0$ text\nmore $(d + (e + f)) = 1$'), []);
    assert.deepStrictEqual(mk('[[a, b] + c] text [d + [e, f]]'), []);
    assert.deepStrictEqual(mk('[[a\n\nb]] ((c\n  \nd))'), []);
    assert.deepStrictEqual(mk('[[redo\nthis]] ((why?))').map(m => m[1]), ['[[redo\nthis]]', '((why?))']);
});
test('markable: LaTeX comments, \\verb and verbatim environments; Markdown code; offsets kept', () => {
    const tex = '% [[old]]\n\\verb|((v))| [[live]]\n\\begin{verbatim}\nx[[1]]\n\\end{verbatim}';
    assert.deepStrictEqual(marks(markable(tex, 'latex')).map(m => tex.slice(m.start, m.end)), ['[[live]]']);
    const md = 'a `x[[1]]` b\n```julia\ny[[2]]\n```\n~~~\n((z))\n~~~\n[[keep]]';
    assert.deepStrictEqual(marks(markable(md, 'markdown')).map(m => md.slice(m.start, m.end)), ['[[keep]]']);
    assert.strictEqual(markable('[[p]] % c', 'plaintext'), '[[p]] % c');
});
test('compilePatterns: a duplicate name is reported and skipped', () => {
    const r = compilePatterns([{ name: 'a', regex: 'x', color: '#000000' }, { name: 'a', regex: 'y', color: '#000000' }]);
    assert.deepStrictEqual([r.patterns.length, r.errors], [1, ['a: duplicate name']]);
});
test('placeholders followed by ~ } $ / \' stay separate (review 2, item 2)', () => {
    for (const t of ['a delay of xxx~ms and a gain of xxx~dB', '\\SI{xxx}{\\milli\\second} and \\SI{xxx}{\\hertz}', '($p = xxx$; $n = xxx$)',
        '\\ref{fig:xxx} and Table~\\ref{tab:xxx}', "xxx/s and xxx'"])
        assert.deepStrictEqual(mk(t).map(m => m[1]), ['xxx', 'xxx'], t);
});
