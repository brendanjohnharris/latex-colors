'use strict';
const vscode = require('vscode');
const { scan } = require('./colors');
const { marks, MARKS } = require('./marks');

const types = new Map(); // style key -> decoration type
const markTypes = new Map(); // mark kind -> decoration type
const timers = new Map();

const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const hex = c => '#' + c.map(x => Math.round(255 * Math.min(1, Math.max(0, x))).toString(16).padStart(2, '0')).join('');

function dark() {
    const k = vscode.window.activeColorTheme.kind;
    return k === vscode.ColorThemeKind.Dark || k === vscode.ColorThemeKind.HighContrast;
}

// On dark themes, mix colours that are too dark to read towards white.
function lift(c) {
    if (!dark() || !vscode.workspace.getConfiguration('latexColors').get('liftDarkColors')) return c;
    while (lum(c) < 0.35) c = c.map(x => x + 0.15 * (1 - x));
    return c;
}

function options(s) {
    const o = {};
    if (s.color) o.color = hex(lift(s.color));
    if (s.bg) { o.backgroundColor = hex(s.bg); if (!s.color) o.color = lum(s.bg) > 0.5 ? '#000000' : '#ffffff'; }
    if (s.deco) o.textDecoration = s.deco;
    if (s.bold) o.fontWeight = 'bold';
    if (s.italic) o.fontStyle = 'italic';
    if (o.color) o.overviewRulerColor = o.color;
    return o;
}

function typeFor(style) {
    const key = JSON.stringify(style);
    if (!types.has(key)) types.set(key, vscode.window.createTextEditorDecorationType(options(style)));
    return types.get(key);
}

const isTex = doc => doc.languageId === 'latex' || doc.languageId === 'tex';
const hasMarks = doc => isTex(doc) || doc.languageId === 'markdown' || doc.languageId === 'plaintext';

for (const { kind, color } of MARKS)
    markTypes.set(kind, vscode.window.createTextEditorDecorationType({
        color, backgroundColor: color + '26', fontStyle: 'italic', overviewRulerColor: color }));

function refresh(editor) {
    if (!editor || !hasMarks(editor.document)) return;
    const doc = editor.document, text = doc.getText();
    const range = s => new vscode.Range(doc.positionAt(s.start), doc.positionAt(s.end));
    if (isTex(doc)) {
        const ranges = new Map();
        for (const s of scan(text)) {
            const t = typeFor(s.style);
            if (!ranges.has(t)) ranges.set(t, []);
            ranges.get(t).push(range(s));
        }
        for (const t of types.values()) editor.setDecorations(t, ranges.get(t) || []);
    }
    const found = marks(text);
    for (const [kind, t] of markTypes) editor.setDecorations(t, found.filter(m => m.kind === kind).map(range));
}

const refreshAll = () => vscode.window.visibleTextEditors.forEach(refresh);

function resetTypes() {
    for (const t of types.values()) t.dispose();
    types.clear();
    refreshAll();
}

function activate(context) {
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(refreshAll),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (!hasMarks(e.document)) return;
            clearTimeout(timers.get(e.document));
            timers.set(e.document, setTimeout(() =>
                vscode.window.visibleTextEditors.filter(ed => ed.document === e.document).forEach(refresh), 250));
        }),
        vscode.window.onDidChangeActiveColorTheme(resetTypes),
        vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('latexColors') && resetTypes()),
        { dispose: () => [...types.values(), ...markTypes.values()].forEach(t => t.dispose()) },
    );
    refreshAll();
}

module.exports = { activate, deactivate() {} };
