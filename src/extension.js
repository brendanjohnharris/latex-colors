// @ts-check
'use strict';
const path = require('node:path');
const vscode = require('vscode');
const { spans, flatten, readable, renderOptions, hoverMarkdown } = require('./colors');
const { marks, markable, compilePatterns } = require('./marks');
const { muted } = require('./mute');
const { preambleOf, findCandidates, runProbe, toProbed, cacheKey, serialize } = require('./probe');
const { resolveEngine } = require('./engine');
const { findOnPath, readLatexmkrc, compileProbe, probeArgs } = require('./probeRunner');
const { collect, findRoot, byProximity } = require('./project');

const types = new Map(); // style key -> decoration type
let markTypes = new Map(), patterns = [], muteType; // mark kind -> decoration type; compiled latexColors.marks.patterns; faded markup
const warned = new Set(); // bad mark patterns, warned about once per session
const timers = new Map(); // key -> pending timeout
const pendingDocs = new Set(); // documents to prepare when the save/watcher timer fires
const projects = new Map(); // document uri -> { root, files, prelude }: its root file, the files the root pulls in, their text but its own
const probed = new Map(); // root path -> probe colors
const fileCache = new Map(); // path -> { mtime, text }
const applied = new Map(); // document uri -> { text, raw, colors, marks, mutes, styles } last decorated, for the hover, pruning and the hidden commands
const CACHE_SIZE = 20, CACHE_STATE = 'latexColors.probeCache.2', MAX_TYPES = 300, MUTE_MARGIN = 200; // lines beyond the visible ones
let cache = new Map(); // cacheKey -> probe colors, oldest first; mirrored in workspaceState under a key that changes with their format
let state, out, resets = 0; // resets: for latexColors._stats

const config = (uri = undefined) => vscode.workspace.getConfiguration('latexColors', uri);
const log = msg => out.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
const debounce = (key, ms, fn) => { clearTimeout(timers.get(key)); timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, ms)); };

const dark = () => [vscode.ColorThemeKind.Dark, vscode.ColorThemeKind.HighContrast].includes(vscode.window.activeColorTheme.kind); // HighContrastLight is light
const options = s => renderOptions(s, dark() && config().get('liftDarkColors') ? config().get('minLuminance', 0.15) : null);

function typeFor(style) {
    const key = JSON.stringify(style);
    if (!types.has(key)) types.set(key, vscode.window.createTextEditorDecorationType(options(style)));
    return types.get(key);
}

const isTex = doc => doc.languageId === 'latex' || doc.languageId === 'tex';
const hasMarks = doc => config(doc.uri).get('marks.languages', []).includes(doc.languageId);
const probedFor = (doc, cfg) => cfg.get('probe.enabled') ? probed.get(projects.get(doc.uri.toString())?.root ?? doc.uri.fsPath) : undefined;

// Mark and mute decoration types from the settings; a bad mark pattern is skipped with one warning per session.
function loadTypes() {
    for (const t of [...markTypes.values(), muteType]) t?.dispose();
    const r = compilePatterns(config().get('marks.patterns'));
    for (const e of r.errors.filter(e => !warned.has(e))) {
        warned.add(e);
        vscode.window.showWarningMessage(`LaTeX Colors: latexColors.marks.patterns entry ${e}; skipped.`);
    }
    patterns = r.patterns;
    markTypes = new Map(patterns.map(p => [p.kind, vscode.window.createTextEditorDecorationType({
        color: p.color, backgroundColor: p.background, fontStyle: p.fontStyle, overviewRulerColor: p.color })]));
    muteType = vscode.window.createTextEditorDecorationType({ opacity: String(config().get('muteMarkup.opacity', 0.5)) });
}

// Faded markup within the visible lines and a margin, so large documents do not decorate every brace at once.
function applyMutes(editor) {
    const doc = editor.document, mutes = applied.get(doc.uri.toString())?.mutes ?? [], vis = editor.visibleRanges;
    const from = vis.length ? doc.offsetAt(new vscode.Position(Math.max(0, vis[0].start.line - MUTE_MARGIN), 0)) : 0;
    const to = vis.length ? doc.offsetAt(new vscode.Position(vis[vis.length - 1].end.line + MUTE_MARGIN, 0)) : Infinity;
    editor.setDecorations(muteType, mutes.filter(r => r.end > from && r.start < to).map(r => new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end))));
}

function refresh(editor) {
    if (!editor) return;
    const doc = editor.document, key = doc.uri.toString(), cfg = config(doc.uri);
    const withColors = isTex(doc) && cfg.get('colors.enabled'), withMarks = hasMarks(doc) && cfg.get('marks.enabled');
    const withMutes = isTex(doc) && cfg.get('muteMarkup.enabled');
    if (!withColors && !withMarks && !withMutes && !applied.has(key)) return;
    const text = doc.getText(), range = s => new vscode.Range(doc.positionAt(s.start), doc.positionAt(s.end));
    const raw = withColors ? spans(text, probedFor(doc, cfg), projects.get(key)?.prelude) : [], colors = flatten(raw);
    const ranges = new Map();
    for (const s of colors) {
        const t = typeFor(s.style);
        if (!ranges.has(t)) ranges.set(t, []);
        ranges.get(t).push(range(s));
    }
    for (const t of types.values()) editor.setDecorations(t, ranges.get(t) || []);
    const found = withMarks ? marks(markable(text, doc.languageId), patterns) : [];
    for (const [kind, t] of markTypes) editor.setDecorations(t, found.filter(m => m.kind === kind).map(range));
    applied.set(key, { text, raw, colors, marks: found, mutes: withMutes ? muted(text) : [], styles: new Set(colors.map(s => JSON.stringify(s.style))) });
    applyMutes(editor);
    if (types.size > MAX_TYPES) debounce('prune', 1000, prune); // styles typed and deleted leave unused types behind
}

// Dispose the decoration types no visible editor uses; those in use stay, so this never refreshes or repeats.
function prune() {
    const live = new Set(vscode.window.visibleTextEditors.flatMap(e => [...(applied.get(e.document.uri.toString())?.styles ?? [])]));
    for (const [k, t] of types) if (!live.has(k)) { t.dispose(); types.delete(k); }
}

// What colored the text under the pointer: the innermost span (the later one on a tie, as in flatten), its value,
// the color shown, and whether the probe supplied it.
function hover(doc, pos) {
    const cfg = config(doc.uri), at = doc.offsetAt(pos), text = doc.getText(), a = applied.get(doc.uri.toString());
    if (!cfg.get('colors.enabled')) return;
    const raw = a?.text === text ? a.raw : spans(text, probedFor(doc, cfg), projects.get(doc.uri.toString())?.prelude);
    const hit = raw.map((s, k) => ({ s, k })).filter(({ s }) => s.start <= at && at < s.end)
        .sort((x, y) => (x.s.end - x.s.start) - (y.s.end - y.s.start) || y.k - x.k)[0]?.s;
    if (!hit) return;
    const md = new vscode.MarkdownString(hoverMarkdown(text.slice(hit.start, hit.whatEnd).replace(/\s+/g, ' '), hit.style, options(hit.style).color, hit.origin));
    md.supportHtml = true;
    return new vscode.Hover(md, new vscode.Range(doc.positionAt(hit.start), doc.positionAt(hit.end)));
}

const refreshAll = () => vscode.window.visibleTextEditors.forEach(refresh);

function resetTypes() {
    resets++;
    for (const t of types.values()) t.dispose();
    types.clear();
    loadTypes();
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

// Live text for open documents (unless live is false), else the file through workspace.fs, cached by
// mtime; null if unreadable.
async function readText(p, live = true) {
    const open = live && vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === p);
    if (open) return open.getText();
    try {
        const uri = vscode.Uri.file(p), { mtime } = await vscode.workspace.fs.stat(uri), c = fileCache.get(p);
        if (c?.mtime === mtime) return c.text;
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        fileCache.set(p, { mtime, text });
        return text;
    } catch { return null; }
}
// Workspace .tex files that might be a file's root, nearest folders first.
const listTex = async file => byProximity(file, (await vscode.workspace.findFiles('**/*.tex', '**/{node_modules,.git}/**', 1000)).map(u => u.fsPath));
const editorsOf = root => vscode.window.visibleTextEditors.filter(e => (projects.get(e.document.uri.toString())?.root ?? e.document.uri.fsPath) === root);
const preludeOf = (files, file) => files.filter(f => f.path !== file).map(f => f.text).join('\n');

// A document's root and the files the root pulls in (PLAN 3.1); colors defined in any of them apply.
async function resolveProject(doc) {
    if (doc.uri.scheme !== 'file' || doc.isClosed) return null;
    const file = doc.uri.fsPath, root = await findRoot(file, doc.getText(), { read: readText, list: () => listTex(file) });
    const files = await collect(root, readText);
    const proj = { root, files, prelude: preludeOf(files, file) };
    projects.set(doc.uri.toString(), proj);
    vscode.window.visibleTextEditors.filter(e => e.document === doc).forEach(refresh);
    return proj;
}

// An edit to one file of a project reaches the other open files of that project before it is saved.
function editedFile(doc) {
    for (const e of vscode.window.visibleTextEditors) {
        const proj = projects.get(e.document.uri.toString()), f = proj?.files.find(f => f.path === doc.uri.fsPath);
        if (!f || e.document === doc) continue;
        f.text = doc.getText();
        proj.prelude = preludeOf(proj.files, e.document.uri.fsPath);
        refresh(e);
    }
}

// Ask LaTeX for the colors of the commands and expressions in a root file (PLAN 2.8); cached by engine,
// preamble (with the files it pulls in) and candidates.
async function probe(root) {
    const uri = vscode.Uri.file(root), cfg = config(uri), rootText = await readText(root);
    const preamble = rootText === null ? null : preambleOf(rootText);
    if (!cfg.get('probe.enabled') || !cfg.get('colors.enabled') || !vscode.workspace.isTrusted || preamble === null) return;
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
    const pulled = await Promise.all(others.filter(f => !f.body).map(f => readText(f.path, false))); // as TeX reads them: from disk
    const key = cacheKey(engine, [preamble, ...pulled].join('\n'), list);
    if (!cache.has(key)) {
        log(`${name}: ${engine} (${reason}), ${list.length} candidates${truncated ? ` (${truncated} over the limit dropped)` : ''}`);
        log(`  ${paths[engine]} ${probeArgs('<tmp>').join(' ')} in ${dir}`);
        const t0 = Date.now();
        const r = await runProbe(preamble, list, tex => compileProbe({ engine: paths[engine], root: dir, tex, timeout: cfg.get('probe.timeout', 30) }));
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

// Saves and file-system events share one timer, so a save that also fires the watcher prepares once.
function schedulePrepare(docs, ms) {
    docs.forEach(d => pendingDocs.add(d));
    debounce('prepare', ms, () => { const docs = [...pendingDocs]; pendingDocs.clear(); docs.forEach(d => prepare(d)); });
}
const visibleDocs = () => vscode.window.visibleTextEditors.map(e => e.document);

function activate(context) {
    state = context.workspaceState;
    cache = new Map(state.get(CACHE_STATE, []));
    out = vscode.window.createOutputChannel('LaTeX Colors');
    loadTypes();
    const toggle = key => () => config().update(key, !config().get(key),
        vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{tex,sty,cls}');
    context.subscriptions.push(
        out,
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            refreshAll();
            editors.filter(e => !projects.has(e.document.uri.toString())).forEach(e => prepare(e.document, false));
        }),
        vscode.window.onDidChangeTextEditorVisibleRanges(e => debounce('scroll ' + e.textEditor.document.uri, 50, () => applyMutes(e.textEditor))),
        vscode.workspace.onDidSaveTextDocument(doc => { // the saved file (also a .sty or .cls) may belong to any visible document's project
            if (isTex(doc) || /\.(sty|cls)$/i.test(doc.uri.fsPath)) schedulePrepare([doc, ...visibleDocs()], 1000);
        }),
        watcher,
        ...['onDidChange', 'onDidCreate', 'onDidDelete'].map(ev => watcher[ev](uri => { // files not open in an editor
            fileCache.delete(uri.fsPath);
            schedulePrepare(visibleDocs(), 1000);
        })),
        vscode.workspace.onDidCloseTextDocument(doc => {
            const key = doc.uri.toString();
            for (const k of [key, 'edit ' + key, 'scroll ' + key]) { clearTimeout(timers.get(k)); timers.delete(k); }
            projects.delete(key); applied.delete(key); pendingDocs.delete(doc);
        }),
        vscode.commands.registerCommand('latexColors.toggleColors', toggle('colors.enabled')),
        vscode.commands.registerCommand('latexColors.toggleMarks', toggle('marks.enabled')),
        vscode.commands.registerCommand('latexColors.showOutput', () => out.show()),
        vscode.commands.registerCommand('latexColors.rescan', async () => {
            cache.clear(); probed.clear(); projects.clear(); fileCache.clear();
            await state.update(CACHE_STATE, []);
            log('rescan: caches cleared');
            resetTypes();
            await Promise.all(vscode.window.visibleTextEditors.map(e => prepare(e.document)));
        }),
        vscode.languages.registerHoverProvider([{ language: 'latex' }, { language: 'tex' }], { provideHover: hover }),
        vscode.commands.registerCommand('latexColors._spans', () => { // hidden; for integration tests
            const a = applied.get(vscode.window.activeTextEditor?.document.uri.toString());
            return a ? readable(a.text, a.colors, a.marks) : null;
        }),
        vscode.commands.registerCommand('latexColors._stats', () => ({ types: types.size, resets })), // hidden; for integration tests
        vscode.commands.registerCommand('latexColors._muted', () => { // hidden; for integration tests
            const a = applied.get(vscode.window.activeTextEditor?.document.uri.toString());
            return a ? a.mutes.map(r => a.text.slice(r.start, r.end)) : null;
        }),
        vscode.workspace.onDidGrantWorkspaceTrust(prepareVisible),
        vscode.workspace.onDidChangeTextDocument(e => {
            const doc = e.document;
            if (!isTex(doc) && !hasMarks(doc)) return;
            debounce('edit ' + doc.uri, 250, () => {
                vscode.window.visibleTextEditors.filter(ed => ed.document === doc).forEach(refresh);
                if (isTex(doc)) editedFile(doc);
            });
        }),
        vscode.window.onDidChangeActiveColorTheme(resetTypes),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration('latexColors')) return;
            resetTypes();
            if (e.affectsConfiguration('latexColors.probe')) prepareVisible();
        }),
        { dispose: () => { [...types.values(), ...markTypes.values(), muteType].forEach(t => t?.dispose()); timers.forEach(clearTimeout); timers.clear(); } },
    );
    refreshAll();
    vscode.window.visibleTextEditors.forEach(e => prepare(e.document, false));
}

module.exports = { activate, deactivate() {} };
