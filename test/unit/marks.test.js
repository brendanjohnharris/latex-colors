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
