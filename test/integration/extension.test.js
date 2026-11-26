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
    suiteTeardown(async () => { for (const k of ['probe.enabled', 'marks.enabled']) await set(k, undefined); });

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

    test('probe colors replace predictions, on open and after a save', async function () {
        if (!findOnPath('pdflatex') && !process.env.CI) this.skip();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-vscode-'));
        try {
            const file = path.join(dir, 'probe.tex');
            fs.writeFileSync(file, '\\documentclass{article}\n\\usepackage[dvipsnames]{xcolor}\n\\newcommand{\\xp}[1]{\\textcolor{Maroon}{#1}}\n' +
                '\\begin{document}\n\\xp{a}\n\\end{document}\n');
            await set('probe.enabled', true);
            const editor = await show(file);
            const maroon = hex(parseSpec('cmyk', '0,0.87,0.68,0.32')); // dvipsnam.def; the parser alone does not know Maroon
            let s = await spansWhen(x => at(x, '\\xp{a}'), 60000);
            assert.deepStrictEqual(at(s, '\\xp{a}')?.style, { color: maroon });
            await editor.edit(e => e.insert(new vscode.Position(5, 0), '\\textcolor{Peach}{b}\n'));
            await editor.document.save();
            s = await spansWhen(x => at(x, '\\textcolor{Peach}{b}'), 60000);
            assert.deepStrictEqual(at(s, '\\textcolor{Peach}{b}')?.style, { color: hex(parseSpec('cmyk', '0,0.50,0.70,0')) });
        } finally {
            await set('probe.enabled', false);
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
