// @ts-check
'use strict';
const path = require('node:path');
const vscode = require('vscode');
const { scan, hex, readable } = require('./colors');
const { marks, MARKS } = require('./marks');
const { preambleOf, findCandidates, runProbe, toProbed, cacheKey, serialize } = require('./probe');
const { resolveEngine } = require('./engine');
const { findOnPath, readLatexmkrc, compileProbe, probeArgs } = require('./probeRunner');
const { collect, findRoot } = require('./project');

const types = new Map(); // style key -> decoration type
const markTypes = new Map(); // mark kind -> decoration type
const timers = new Map(), saveTimers = new Map();
const projects = new Map(); // document uri -> { root, files, prelude }: its root file, the files the root pulls in, their text but its own
const probed = new Map(); // root path -> probe colors
const fileCache = new Map(); // path -> { mtime, text }
const applied = new Map(); // document uri -> { text, colors, marks } last decorated, for latexColors._spans
const CACHE_SIZE = 20, CACHE_STATE = 'latexColors.probeCache';
let cache = new Map(); // cacheKey -> probe colors, oldest first; mirrored in workspaceState
let state, out;

const config = (uri = undefined) => vscode.workspace.getConfiguration('latexColors', uri);
const log = msg => out.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);

const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

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
    const proj = projects.get(doc.uri.toString());
    const colors = isTex(doc) ? scan(text, config(doc.uri).get('probe.enabled') ? probed.get(proj?.root ?? doc.uri.fsPath) : undefined, proj?.prelude) : [];
    if (isTex(doc)) {
        const ranges = new Map();
        for (const s of colors) {
            const t = typeFor(s.style);
            if (!ranges.has(t)) ranges.set(t, []);
            ranges.get(t).push(range(s));
        }
        for (const t of types.values()) editor.setDecorations(t, ranges.get(t) || []);
    }
    const found = config(doc.uri).get('marks.enabled') ? marks(text) : [];
    for (const [kind, t] of markTypes) editor.setDecorations(t, found.filter(m => m.kind === kind).map(range));
    applied.set(doc.uri.toString(), { text, colors, marks: found });
}

const refreshAll = () => vscode.window.visibleTextEditors.forEach(refresh);

function resetTypes() {
    for (const t of types.values()) t.dispose();
    types.clear();
    refreshAll();
}

function remember(key, value) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    state.update(CACHE_STATE, [...cache]);
}

function report(list, r, ms) {
    const n = status => r.results.filter(x => x.status === status).length;
    log(`  ${r.runs} run(s), ${ms} ms: ${n('ok')} ok, ${n('neutral')} neutral, ${n('failed')} failed, ${n('undefined')} undefined`);
    if (r.error) return log(`  preamble: ${r.error}`);
    list.forEach((c, k) => {
        const x = r.results[k], what = c.kind === 'macro' ? '\\' + c.name : c.expr;
        if (x.status === 'failed') log(`  failed ${what}: ${x.error}`);
        else if (x.status === 'undefined') log(`  undefined color ${what}`);
    });
}

// Live text for open documents, else the file through workspace.fs, cached by mtime; null if unreadable.
async function readText(p) {
    const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === p);
    if (open) return open.getText();
    try {
        const uri = vscode.Uri.file(p), { mtime } = await vscode.workspace.fs.stat(uri), c = fileCache.get(p);
        if (c?.mtime === mtime) return c.text;
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        fileCache.set(p, { mtime, text });
        return text;
    } catch { return null; }
}
const listTex = async () => (await vscode.workspace.findFiles('**/*.tex', '**/{node_modules,.git}/**', 200)).map(u => u.fsPath);
const editorsOf = root => vscode.window.visibleTextEditors.filter(e => (projects.get(e.document.uri.toString())?.root ?? e.document.uri.fsPath) === root);

// A document's root and the files the root pulls in (PLAN 3.1); colors defined in any of them apply.
async function resolveProject(doc) {
    if (doc.uri.scheme !== 'file' || doc.isClosed) return null;
    const file = doc.uri.fsPath, root = await findRoot(file, doc.getText(), { read: readText, list: listTex });
    const files = await collect(root, readText);
    const proj = { root, files, prelude: files.filter(f => f.path !== file).map(f => f.text).join('\n') };
    projects.set(doc.uri.toString(), proj);
    vscode.window.visibleTextEditors.filter(e => e.document === doc).forEach(refresh);
    return proj;
}

// Ask LaTeX for the colors of the commands and expressions in a root file (PLAN 2.8); cached by engine,
// preamble (with the files it pulls in) and candidates.
async function probe(root) {
    const uri = vscode.Uri.file(root), cfg = config(uri), rootText = await readText(root);
    const preamble = rootText === null ? null : preambleOf(rootText);
    if (!cfg.get('probe.enabled') || !vscode.workspace.isTrusted || preamble === null) return;
    const dir = path.dirname(root), name = path.basename(root);
    const others = (await collect(root, readText)).filter(f => f.path !== root), { list, truncated } = findCandidates(rootText, others);
    const lwc = vscode.workspace.getConfiguration('latex-workshop', uri); // LaTeX Workshop's activate returns no API
    const lw = vscode.extensions.getExtension('James-Yu.latex-workshop') ? {
        enableMagicComments: lwc.get('latex.build.enableMagicComments', true), recipeDefault: lwc.get('latex.recipe.default', 'first'),
        recipes: lwc.get('latex.recipes', []), tools: lwc.get('latex.tools', []), magicArgs: lwc.get('latex.magic.args', []),
    } : null;
    const paths = {};
    const { engine, reason } = resolveEngine({ override: cfg.get('probe.engine', ''), rootText, lw, rcTexts: readLatexmkrc(dir),
        onPath: n => !!(paths[n] = findOnPath(n)) });
    if (!engine) return log(`${name}: probe skipped: ${reason}`);
    const key = cacheKey(engine, [preamble, ...others.filter(f => !f.body).map(f => f.text)].join('\n'), list);
    if (!cache.has(key)) {
        log(`${name}: ${engine} (${reason}), ${list.length} candidates${truncated ? ` (${truncated} over the limit dropped)` : ''}`);
        log(`  ${paths[engine]} ${probeArgs('<tmp>').join(' ')} in ${dir}`);
        const t0 = Date.now();
        const r = await runProbe(preamble, list, tex => compileProbe({ engine: paths[engine], cwd: dir, tex, timeout: cfg.get('probe.timeout', 30) }));
        report(list, r, Date.now() - t0);
        if (r.error) return; // retried on the next save
        remember(key, toProbed(list, r.results));
    }
    probed.set(root, cache.get(key));
    editorsOf(root).forEach(refresh);
}

const runProbeFor = serialize(root => probe(root).catch(e => log(`${path.basename(root)}: probe failed: ${e.message}`)));
const resolveFor = serialize((_key, doc) => resolveProject(doc).catch(e => log(`${path.basename(doc.uri.fsPath)}: ${e.message}`)));

// Resolve a document's project, then probe its root (a cached result applies at once).
async function prepare(doc, probeAgain = true) {
    if (!isTex(doc)) return;
    await resolveFor(doc.uri.toString(), doc);
    const root = projects.get(doc.uri.toString())?.root;
    if (root && (probeAgain || !probed.has(root))) runProbeFor(root, root);
}
const prepareVisible = () => vscode.window.visibleTextEditors.forEach(e => prepare(e.document));

function activate(context) {
    state = context.workspaceState;
    cache = new Map(state.get(CACHE_STATE, []));
    out = vscode.window.createOutputChannel('LaTeX Colors');
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{tex,sty}');
    context.subscriptions.push(
        out,
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            refreshAll();
            editors.filter(e => !projects.has(e.document.uri.toString())).forEach(e => prepare(e.document, false));
        }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (!isTex(doc)) return;
            clearTimeout(saveTimers.get(doc));
            saveTimers.set(doc, setTimeout(() => { // the saved file may belong to any visible document's project
                const docs = new Set([doc, ...vscode.window.visibleTextEditors.map(e => e.document)]);
                docs.forEach(d => prepare(d));
            }, 1000));
        }),
        watcher,
        ...['onDidChange', 'onDidCreate', 'onDidDelete'].map(ev => watcher[ev](uri => { // files not open in an editor
            fileCache.delete(uri.fsPath);
            clearTimeout(saveTimers.get(watcher));
            saveTimers.set(watcher, setTimeout(prepareVisible, 300));
        })),
        vscode.workspace.onDidCloseTextDocument(doc => { projects.delete(doc.uri.toString()); applied.delete(doc.uri.toString()); }),
        vscode.commands.registerCommand('latexColors._spans', () => { // hidden; for integration tests
            const a = applied.get(vscode.window.activeTextEditor?.document.uri.toString());
            return a ? readable(a.text, a.colors, a.marks) : null;
        }),
        vscode.workspace.onDidGrantWorkspaceTrust(prepareVisible),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (!hasMarks(e.document)) return;
            clearTimeout(timers.get(e.document));
            timers.set(e.document, setTimeout(() =>
                vscode.window.visibleTextEditors.filter(ed => ed.document === e.document).forEach(refresh), 250));
        }),
        vscode.window.onDidChangeActiveColorTheme(resetTypes),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration('latexColors')) return;
            resetTypes();
            if (e.affectsConfiguration('latexColors.probe')) prepareVisible();
        }),
        { dispose: () => [...types.values(), ...markTypes.values()].forEach(t => t.dispose()) },
    );
    refreshAll();
    vscode.window.visibleTextEditors.forEach(e => prepare(e.document, false));
}

module.exports = { activate, deactivate() {} };
