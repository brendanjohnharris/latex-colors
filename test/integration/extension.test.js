// Runs inside VS Code (npm run test:vscode); the workspace is test/fixtures.
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');
const { findOnPath } = require('../../src/probeRunner');
const { parseSpec, hex } = require('../../src/colors');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const set = (key, value) => vscode.workspace.getConfiguration('latexColors').update(key, value, vscode.ConfigurationTarget.Global);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Spans applied to the active editor, polled until pred holds or ms pass; the last value either way.
async function spansWhen(pred, ms = 15000) {
    let s = null;
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) {
        s = await vscode.commands.executeCommand('latexColors._spans').then(x => x, () => null); // not registered until activation
        if (s && pred(s)) break;
    }
    return s;
}
const show = async target => vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
const at = (spans, text) => spans.find(s => s.text === text);

suite('LaTeX Colors in VS Code', () => {
    suiteSetup(() => set('probe.enabled', false));
    suiteTeardown(async () => {
        for (const k of ['probe.enabled', 'marks.enabled', 'colors.enabled', 'marks.patterns', 'marks.languages']) await set(k, undefined);
        fs.rmSync(path.join(FIXTURES, '.vscode'), { recursive: true, force: true }); // written by the toggle commands
    });

    for (const f of fs.readdirSync(FIXTURES).filter(f => /\.(tex|md)$/.test(f)).sort())
        test(`${f} matches its snapshot`, async () => {
            const want = JSON.parse(fs.readFileSync(path.join(FIXTURES, f.replace(/\.\w+$/, '.spans.json')), 'utf8'));
            await show(path.join(FIXTURES, f));
            assert.deepStrictEqual(await spansWhen(s => JSON.stringify(s) === JSON.stringify(want)), want);
        });

    test('an edit updates the spans', async () => {
        const editor = await show({ language: 'latex', content: 'plain \\textcolor{red}{old}\n' });
        assert.ok(at(await spansWhen(s => at(s, '\\textcolor{red}{old}')), '\\textcolor{red}{old}'));
        await editor.edit(e => e.insert(new vscode.Position(0, 0), '\\textcolor{blue}{new} '));
        const s = await spansWhen(x => at(x, '\\textcolor{blue}{new}'));
        assert.deepStrictEqual(at(s, '\\textcolor{blue}{new}').style, { color: '#0000ff' });
    });

    test('latexColors.marks.enabled false removes the marks', async () => {
        await show(path.join(FIXTURES, 'marks-latex.tex'));
        assert.ok((await spansWhen(s => s.some(x => x.mark))).some(x => x.mark));
        await set('marks.enabled', false);
        assert.ok(!(await spansWhen(s => !s.some(x => x.mark))).some(x => x.mark));
        await set('marks.enabled', undefined);
        assert.ok((await spansWhen(s => s.some(x => x.mark))).some(x => x.mark));
    });

    test('a chapter gets the macros its root pulls in', async () => {
        await show(path.join(FIXTURES, 'multi', 'chapters', 'one.tex'));
        const s = await spansWhen(x => x.length > 0);
        assert.deepStrictEqual(s, [{ text: "\\ben{from the root's macros}", start: 0, end: 28, style: { color: '#6ea0f9' } }]);
    });

    test('probe colors replace predictions, on open and after a save; rescan reruns it', async function () {
        if (!findOnPath('pdflatex') && !process.env.CI) this.skip();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-vscode-'));
        try {
            const file = path.join(dir, 'probe.tex');
            fs.writeFileSync(file, '\\documentclass{article}\n\\usepackage{xcolor}\n\\newcommand\\tone{teal}\n\\newcommand\\ttwo{olive}\n' +
                '\\newcommand{\\xp}[1]{\\textcolor{\\tone}{#1}}\n\\newcommand{\\yp}[1]{\\textcolor{\\ttwo}{#1}}\n\\begin{document}\n\\xp{a}\n\\end{document}\n');
            const editor = await show(file); // probe off: the parser cannot expand \tone
            assert.ok(!at(await spansWhen(x => x !== null), '\\xp{a}'));
            await set('probe.enabled', true);
            let s = await spansWhen(x => at(x, '\\xp{a}'), 60000);
            assert.deepStrictEqual(at(s, '\\xp{a}')?.style, { color: '#008080' });
            await editor.edit(e => e.insert(new vscode.Position(8, 0), '\\yp{b}\n'));
            await editor.document.save();
            s = await spansWhen(x => at(x, '\\yp{b}'), 60000);
            assert.deepStrictEqual(at(s, '\\yp{b}')?.style, { color: '#808000' });
            await vscode.commands.executeCommand('latexColors.rescan');
            s = await spansWhen(x => at(x, '\\yp{b}'), 60000);
            assert.deepStrictEqual(at(s, '\\yp{b}')?.style, { color: '#808000' });
        } finally {
            await set('probe.enabled', false);
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the probe cache follows the files TeX reads, not unsaved edits', async function () {
        if (!findOnPath('pdflatex') && !process.env.CI) this.skip();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-vscode-'));
        try {
            const main = path.join(dir, 'main.tex'), tones = path.join(dir, 'tones.tex');
            fs.writeFileSync(main, '\\documentclass{article}\n\\usepackage{xcolor}\n\\input{tones}\n\\newcommand\\pk[1]{\\textcolor{\\tone}{#1}}\n' +
                '\\begin{document}\n\\pk{x}\n\\end{document}\n');
            fs.writeFileSync(tones, '\\newcommand\\tone{teal}\n');
            await set('probe.enabled', true);
            const tonesEditor = await show(tones);
            await tonesEditor.edit(e => e.replace(new vscode.Range(0, 0, 0, 100), '\\newcommand\\tone{olive}')); // unsaved
            await show(main);
            let s = await spansWhen(x => at(x, '\\pk{x}'), 60000);
            assert.deepStrictEqual(at(s, '\\pk{x}')?.style, { color: '#008080' }); // TeX reads tones.tex from disk
            await tonesEditor.document.save();
            s = await spansWhen(x => at(x, '\\pk{x}')?.style.color === '#808000', 30000);
            assert.deepStrictEqual(at(s, '\\pk{x}')?.style, { color: '#808000' });
        } finally {
            await set('probe.enabled', false);
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor').then(() => {}, () => {});
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the probe of the root colors a chapter', async function () {
        if (!findOnPath('pdflatex') && !process.env.CI) this.skip();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-vscode-'));
        try {
            fs.writeFileSync(path.join(dir, 'main.tex'), '\\documentclass{article}\n\\usepackage{xcolor}\n\\newcommand\\tone{teal}\n' +
                '\\newcommand\\pk[1]{\\textcolor{\\tone}{#1}}\n\\begin{document}\n\\input{ch}\n\\end{document}\n');
            fs.writeFileSync(path.join(dir, 'ch.tex'), '% !TEX root = main.tex\n\\pk{x}\n');
            await set('probe.enabled', true);
            await show(path.join(dir, 'ch.tex'));
            const s = await spansWhen(x => at(x, '\\pk{x}'), 60000); // the parser cannot expand \tone; the probe can
            assert.deepStrictEqual(at(s, '\\pk{x}')?.style, { color: '#008080' });
        } finally {
            await set('probe.enabled', false);
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('latexColors.colors.enabled false removes colors and keeps marks', async () => {
        await show(path.join(FIXTURES, 'marks-latex.tex'));
        assert.ok((await spansWhen(x => x.some(y => y.style))).some(y => y.style));
        await set('colors.enabled', false);
        const s = await spansWhen(x => !x.some(y => y.style));
        assert.ok(!s.some(y => y.style) && s.some(y => y.mark));
        await set('colors.enabled', undefined);
    });

    test('latexColors.marks.patterns replaces the marks; a bad entry is skipped', async () => {
        await set('marks.patterns', [{ name: 'todo', regex: 'needs', color: '#ff0000' }, { name: 'bad', regex: '(', color: '#00ff00' }]);
        await show(path.join(FIXTURES, 'marks-latex.tex'));
        const s = await spansWhen(x => x.some(y => y.mark === 'todo'));
        assert.deepStrictEqual(s.filter(y => y.mark).map(y => [y.mark, y.text]), [['todo', 'needs']]);
        await set('marks.patterns', undefined);
    });

    test('latexColors.marks.languages limits where marks appear', async () => {
        await show(path.join(FIXTURES, 'marks-markdown.md'));
        assert.ok((await spansWhen(x => x.some(y => y.mark))).some(y => y.mark));
        await set('marks.languages', ['latex']);
        assert.ok(!(await spansWhen(x => !x.some(y => y.mark))).some(y => y.mark));
        await set('marks.languages', undefined);
    });

    test('toggle commands flip the settings in workspace scope', async () => {
        const ws = k => vscode.workspace.getConfiguration('latexColors').inspect(k)?.workspaceValue;
        for (const [command, key] of [['latexColors.toggleColors', 'colors.enabled'], ['latexColors.toggleMarks', 'marks.enabled']]) {
            await vscode.commands.executeCommand(command);
            assert.strictEqual(ws(key), false, command);
            await vscode.commands.executeCommand(command);
            assert.strictEqual(ws(key), true, command);
            await vscode.workspace.getConfiguration('latexColors').update(key, undefined, vscode.ConfigurationTarget.Workspace);
        }
    });

    test('latexColors.showOutput runs', async () => vscode.commands.executeCommand('latexColors.showOutput'));

    test('hover names what colored the text, its value and its origin', async () => {
        const editor = await show(path.join(FIXTURES, 'textcolor-basic.tex'));
        await spansWhen(x => x.length > 0);
        const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', editor.document.uri, new vscode.Position(0, 25));
        const text = hovers.flatMap(h => h.contents.map(c => c.value ?? String(c))).join('\n');
        assert.match(text, /\\textcolor\{red\}/);
        assert.match(text, /#ff0000/);
        assert.match(text, /predicted/);
    });

    test('markup that does not reach the PDF is muted; latexColors.muteMarkup.enabled turns it off', async () => {
        await show(path.join(FIXTURES, 'textcolor-basic.tex'));
        const muted = async pred => {
            let m = null;
            for (const t0 = Date.now(); Date.now() - t0 < 15000; await sleep(100)) { m = await vscode.commands.executeCommand('latexColors._muted'); if (m && pred(m)) break; }
            return m;
        };
        assert.deepStrictEqual(await muted(m => m.length > 0),
            ['\\textcolor{red}{', '}', '\\textcolor[rgb]{0,0.5,1}{', '}', '\\colorbox{yellow}{', '}']);
        await set('muteMarkup.enabled', false);
        assert.deepStrictEqual(await muted(m => m.length === 0), []);
        await set('muteMarkup.enabled', undefined);
    });

    test('an unsaved edit to a file the root pulls in updates a chapter open beside it (review B12)', async () => {
        const macros = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(FIXTURES, 'multi', 'macros.tex')), vscode.ViewColumn.One);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(FIXTURES, 'multi', 'chapters', 'one.tex')), vscode.ViewColumn.Two);
        assert.strictEqual((await spansWhen(x => x.length > 0))[0]?.style.color, '#6ea0f9');
        try {
            await macros.edit(e => e.replace(new vscode.Range(0, 0, 0, 100), '\\definecolor{multicolor}{HTML}{FF0000}'));
            assert.strictEqual((await spansWhen(x => x[0]?.style.color === '#ff0000'))[0]?.style.color, '#ff0000');
        } finally {
            await vscode.window.showTextDocument(macros.document, vscode.ViewColumn.One);
            await vscode.commands.executeCommand('workbench.action.files.revert');
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        }
    });
});
