'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { includes, collect, findRoot } = require('../../src/project');

const P = (...p) => path.join('/proj', ...p);
const FILES = {
    [P('main.tex')]: String.raw`\documentclass{article}
\input{macros}
\usepackage{local,amsmath}
% \input{commented}
\begin{document}
\include{chapters/one}
\subfile{parts/two.tex}
\import{appendix/}{three}
\input{main}
\end{document}
`,
    [P('macros.tex')]: '\\newcommand\\ben[1]{\\textcolor{red}{#1}}\n\\input{deep}\n',
    [P('deep.tex')]: '\\definecolor{deepc}{rgb}{0,0,1}\n',
    [P('local.sty')]: '\\newcommand\\sty[1]{\\textcolor{teal}{#1}}\n',
    [P('chapters', 'one.tex')]: '\\ben{one}\n',
    [P('parts', 'two.tex')]: '\\documentclass[../main.tex]{subfiles}\n\\begin{document}\\ben{two}\\end{document}\n',
    [P('appendix', 'three.tex')]: '% !TEX root = ../main.tex\n\\ben{three}\n',
    [P('other.tex')]: '\\documentclass{article}\\begin{document}\\input{lonely}\\end{document}\n',
    [P('lonely.tex')]: 'lonely\n',
    [P('orphan.tex')]: 'no root\n',
    [P('loop', 'a.tex')]: '% !TEX root = b.tex\n',
    [P('loop', 'b.tex')]: '% !TEX root = a.tex\n',
};
const read = async p => FILES[p] ?? null;
const list = async () => Object.keys(FILES).filter(p => p.endsWith('.tex'));

test('includes: kinds, raw targets and body position, comments skipped', () =>
    assert.deepStrictEqual(includes(FILES[P('main.tex')]).map(i => [i.kind, i.target, i.body]), [
        ['input', 'macros', false], ['package', 'local', false], ['package', 'amsmath', false],
        ['include', 'chapters/one', true], ['subfile', 'parts/two.tex', true], ['import', 'appendix/three', true], ['input', 'main', true],
    ]));

test('collect: root and local files in document order, depth first; missing files and cycles skipped', async () =>
    assert.deepStrictEqual((await collect(P('main.tex'), read)).map(f => [path.relative('/proj', f.path), f.body]), [
        ['main.tex', false], ['macros.tex', false], ['deep.tex', false], ['local.sty', false],
        ['chapters/one.tex', true], ['parts/two.tex', true], ['appendix/three.tex', true],
    ]));

test('collect: depth limit', async () => {
    const chain = {}; for (let k = 0; k < 15; k++) chain[P(`c${k}.tex`)] = `\\input{c${k + 1}}`;
    assert.strictEqual((await collect(P('c0.tex'), async p => chain[p] ?? null)).length, 11); // root plus 10 levels
});

test('findRoot: a file with \\documentclass is its own root', async () =>
    assert.strictEqual(await findRoot(P('main.tex'), FILES[P('main.tex')], { read, list }), P('main.tex')));
test('findRoot: % !TEX root magic comment, relative to the file', async () =>
    assert.strictEqual(await findRoot(P('appendix', 'three.tex'), FILES[P('appendix', 'three.tex')], { read, list }), P('main.tex')));
test('findRoot: subfiles class option names the root', async () =>
    assert.strictEqual(await findRoot(P('parts', 'two.tex'), FILES[P('parts', 'two.tex')], { read, list }), P('main.tex')));
test('findRoot: the workspace file that pulls this one in', async () => {
    assert.strictEqual(await findRoot(P('chapters', 'one.tex'), FILES[P('chapters', 'one.tex')], { read, list }), P('main.tex'));
    assert.strictEqual(await findRoot(P('lonely.tex'), FILES[P('lonely.tex')], { read, list }), P('other.tex'));
});
test('findRoot: else the file itself', async () =>
    assert.strictEqual(await findRoot(P('orphan.tex'), FILES[P('orphan.tex')], { read, list }), P('orphan.tex')));
test('findRoot: a magic comment loop stops', async () =>
    assert.ok([P('loop', 'a.tex'), P('loop', 'b.tex')].includes(await findRoot(P('loop', 'a.tex'), FILES[P('loop', 'a.tex')], { read, list }))));
