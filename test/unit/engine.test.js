'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resolveEngine } = require('../../src/engine');

// Trimmed copy of LaTeX Workshop 10.20.1 defaults (package.json).
const LW = () => ({
    enableMagicComments: true,
    recipeDefault: 'first',
    recipes: [
        { name: 'latexmk', tools: ['latexmk'] },
        { name: 'latexmk (latexmkrc)', tools: ['latexmk_rconly'] },
        { name: 'latexmk (lualatex)', tools: ['lualatexmk'] },
        { name: 'pdflatex -> bibtex -> pdflatex', tools: ['bibtex', 'pdflatex', 'bibtex'] },
    ],
    tools: [
        { name: 'latexmk', command: 'latexmk', args: ['-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-pdf', '-outdir=%OUTDIR%', '%DOC%'] },
        { name: 'latexmk_rconly', command: 'latexmk', args: ['%DOC%'] },
        { name: 'lualatexmk', command: 'latexmk', args: ['-lualatex', '%DOC%'] },
        { name: 'pdflatex', command: 'pdflatex', args: ['%DOC%'] },
        { name: 'bibtex', command: 'bibtex', args: ['%DOCFILE%'] },
    ],
    magicArgs: ['-synctex=1', '%DOC%'],
});
const ALL = () => true;
const DOC = '\\documentclass{article}\n';
const run = o => resolveEngine({ override: '', rootText: DOC, lw: null, rcTexts: [], onPath: ALL, ...o }).engine;
const rconly = (rcTexts, lw = LW()) => run({ lw: { ...lw, recipeDefault: 'latexmk (latexmkrc)' }, rcTexts });

test('no LaTeX Workshop, no magic comment: pdflatex', () => assert.strictEqual(run({}), 'pdflatex'));
test('no LaTeX Workshop, program magic comment', () =>
    assert.strictEqual(run({ rootText: '% !TEX program = xelatex\n' + DOC }), 'xelatex'));
test('TeXShop form TS-program', () =>
    assert.strictEqual(run({ rootText: '%!TEX TS-program = lualatex\n' + DOC }), 'lualatex'));
test('LaTeX Workshop defaults: latexmk -pdf gives pdflatex', () => assert.strictEqual(run({ lw: LW() }), 'pdflatex'));
test('program magic comment wins when magic comments are enabled', () =>
    assert.strictEqual(run({ lw: LW(), rootText: '% !TEX program = lualatex\n' + DOC }), 'lualatex'));
test('program magic comment ignored when magic comments are disabled', () =>
    assert.strictEqual(run({ lw: { ...LW(), enableMagicComments: false }, rootText: '% !TEX program = lualatex\n' + DOC }), 'pdflatex'));
test('LW recipe magic comment names the recipe', () =>
    assert.strictEqual(run({ lw: LW(), rootText: '% !LW recipe = latexmk (lualatex)\n' + DOC }), 'lualatex'));
test('program magic comment beats LW recipe magic comment', () =>
    assert.strictEqual(run({ lw: LW(), rootText: '% !LW recipe = latexmk (lualatex)\n% !TEX program = xelatex\n' + DOC }), 'xelatex'));
test('recipe.default set to a name', () =>
    assert.strictEqual(run({ lw: { ...LW(), recipeDefault: 'latexmk (lualatex)' } }), 'lualatex'));
test('recipe.default lastUsed is treated as first', () =>
    assert.strictEqual(run({ lw: { ...LW(), recipeDefault: 'lastUsed', recipes: LW().recipes.slice(2) } }), 'lualatex'));
test('unknown recipe name falls back to the first recipe, as LaTeX Workshop does', () =>
    assert.strictEqual(run({ lw: { ...LW(), recipeDefault: 'nosuch' } }), 'pdflatex'));
test('first TeX tool in the recipe decides, skipping bibtex', () =>
    assert.strictEqual(run({ lw: { ...LW(), recipeDefault: 'pdflatex -> bibtex -> pdflatex', tools: LW().tools.map(t => t.name === 'pdflatex' ? { ...t, command: '/opt/tex/bin/lualatex' } : t) } }), 'lualatex'));
test('inline tool objects in a recipe', () =>
    assert.strictEqual(run({ lw: { ...LW(), recipes: [{ name: 'x', tools: [{ name: 'y', command: 'uplatex', args: [] }] }] } }), 'uplatex'));

const flags = { '-pdf': 'pdflatex', '-pdflatex': 'pdflatex', '-pdflua': 'lualatex', '-lualatex': 'lualatex', '-pdflualatex': 'lualatex',
    '-pdfxe': 'xelatex', '-xelatex': 'xelatex', '-pdfxelatex': 'xelatex', '-pdfdvi': 'latex', '-pdfps': 'latex', '-dvi': 'latex', '-ps': 'latex' };
for (const [flag, engine] of Object.entries(flags))
    test(`latexmk ${flag}`, () => assert.strictEqual(
        run({ lw: { ...LW(), tools: [{ name: 'latexmk', command: 'latexmk', args: ['-synctex=1', flag, '%DOC%'] }] } }), engine));
test('latexmk: the last engine flag wins', () =>
    assert.strictEqual(run({ lw: { ...LW(), tools: [{ name: 'latexmk', command: 'latexmk', args: ['-pdf', '-xelatex'] }] } }), 'xelatex'));

test('flagless latexmk, no rc file: pdflatex', () => assert.strictEqual(rconly([]), 'pdflatex'));
test('flagless latexmk, $pdf_mode = 4', () => assert.strictEqual(rconly(['$pdf_mode = 4;\n']), 'lualatex'));
test('flagless latexmk, $pdf_mode = 5', () => assert.strictEqual(rconly(['$pdf_mode = 5;\n']), 'xelatex'));
test('flagless latexmk, $pdf_mode = 3: latex', () => assert.strictEqual(rconly(['$pdf_mode = 3;\n']), 'latex'));
test('project rc overrides user rc', () => assert.strictEqual(rconly(['$pdf_mode = 5;\n', '$pdf_mode = 4;\n']), 'lualatex'));
test('commented $pdf_mode ignored', () => assert.strictEqual(rconly(['$pdf_mode = 5;\n# $pdf_mode = 4;\n']), 'xelatex'));
test('$pdflatex override in rc', () =>
    assert.strictEqual(rconly(["$pdf_mode = 1;\n$pdflatex = 'lualatex -shell-escape %O %S';\n"]), 'lualatex'));
test('$pdflatex override that is not an engine is ignored', () =>
    assert.strictEqual(rconly(["$pdf_mode = 1;\n$pdflatex = 'internal mylatex %O %S';\n"]), 'pdflatex'));

test('override setting wins over everything', () =>
    assert.strictEqual(run({ override: 'xelatex', lw: LW(), rootText: '% !TEX program = lualatex\n' + DOC }), 'xelatex'));
test('engine missing from PATH: no engine, with a reason', () => {
    const r = resolveEngine({ override: '', rootText: DOC, lw: null, rcTexts: [], onPath: n => n !== 'pdflatex' });
    assert.strictEqual(r.engine, null);
    assert.match(r.reason, /pdflatex.*PATH/);
});
test('unsupported engine: no engine, with a reason', () => {
    const r = resolveEngine({ override: 'tectonic', rootText: DOC, lw: null, rcTexts: [], onPath: ALL });
    assert.strictEqual(r.engine, null);
    assert.match(r.reason, /tectonic/);
});
test('magic comment below the first non-comment line is ignored', () =>
    assert.strictEqual(run({ rootText: DOC + '% !TEX program = xelatex\n' }), 'pdflatex'));
test('blank lines inside the leading comment block are allowed', () =>
    assert.strictEqual(run({ rootText: '% header\n\n% !TEX program = xelatex\n' + DOC }), 'xelatex'));
test('reason names the source of the decision', () =>
    assert.match(resolveEngine({ override: '', rootText: DOC, lw: LW(), rcTexts: [], onPath: ALL }).reason, /recipe "latexmk"/));
