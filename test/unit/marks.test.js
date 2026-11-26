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
