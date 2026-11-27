// @ts-check
// Finds coloured spans in LaTeX source the way xcolor colours the PDF.
// Pure functions (no vscode import), so tests run them under plain node.
'use strict';

const BASE = Object.assign(Object.create(null), { // xcolor.sty base set, rgb; no prototype, so \textcolor{constructor} is unknown
    red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1], brown: [.75, .5, .25], lime: [.75, 1, 0],
    orange: [1, .5, 0], pink: [1, .75, .75], purple: [.75, 0, .25], teal: [0, .5, .5], violet: [.5, 0, .5],
    cyan: [0, 1, 1], magenta: [1, 0, 1], yellow: [1, 1, 0], olive: [.5, .5, 0], black: [0, 0, 0],
    darkgray: [.25, .25, .25], gray: [.5, .5, .5], lightgray: [.75, .75, .75], white: [1, 1, 1],
});
const HL_DEFAULT = [1, 1, 0]; // soul's \hl without \sethlcolor
const NAMES = require('./names.json'); // scripts/gen-names.js

const escaped = (t, i) => { let n = 0; while (i - 1 - n >= 0 && t[i - 1 - n] === '\\') n++; return n % 2 === 1; };

const MASKED = /%|\\verb(?![A-Za-z])|\\begin\s*\{(verbatim\*?|Verbatim\*?|lstlisting|minted|comment|luacode\*?)\}|\\(url|nolinkurl|path|href)(?![A-Za-z@])|\\(lstinline|mintinline)(?![A-Za-z@])/g;
const blankOut = s => s.replace(/[^\n]/g, ' ');

// Blank out what TeX does not read as commands, keeping offsets: % comments, \verb<d>...<d>, the bodies of
// verbatim-like environments, URLs (\url, \nolinkurl, \path, the first argument of \href; % is literal there)
// and inline code (\lstinline, \mintinline).
function mask(t) {
    let out = '', prev = 0;
    const eolAt = i => (j => j < 0 ? t.length : j)(t.indexOf('\n', i));
    const delimited = j => { // {...} or <d>...<d> on one line: [from, end) of the contents, or null
        if (t[j] === '{') { const e = closeGroup(t, j); return e < 0 ? null : [j + 1, e - 1]; }
        const e = j < t.length && !/[\sA-Za-z]/.test(t[j]) ? t.indexOf(t[j], j + 1) : -1;
        return e < 0 || e > eolAt(j) ? null : [j + 1, e];
    };
    MASKED.lastIndex = 0;
    for (let m; (m = MASKED.exec(t));) {
        const i = m.index;
        if (escaped(t, i)) continue;
        let from = i, end;
        if (m[0] === '%') end = eolAt(i);
        else if (m[1]) { from = MASKED.lastIndex; end = (j => j < 0 ? t.length : j)(t.indexOf(`\\end{${m[1]}}`, from)); }
        else if (m[2] || m[3]) {
            let j = MASKED.lastIndex;
            if (m[3] === 'lstinline') j = readOpt(t, j).end;
            if (m[3] === 'mintinline') j = readArg(t, j)?.end ?? j; // the language
            const r = delimited(m[2] ? skipWs(t, j) : j);
            if (!r) continue;
            [from, end] = r;
        } else { // \verb or \verb*, then any delimiter character
            const d = i + (t[i + 5] === '*' ? 6 : 5), close = d < t.length ? t.indexOf(t[d], d + 1) : -1;
            end = close < 0 || close > eolAt(i) ? eolAt(i) : close + 1;
        }
        out += t.slice(prev, from) + blankOut(t.slice(from, end));
        prev = MASKED.lastIndex = Math.max(end, MASKED.lastIndex);
    }
    return out + t.slice(prev);
}

// Index just past the brace that closes the group opened at t[i] === '{'; -1 if unclosed.
function closeGroup(t, i) {
    let d = 0;
    for (let j = i; j < t.length; j++) {
        const c = t[j];
        if ((c !== '{' && c !== '}') || escaped(t, j)) continue;
        if (c === '{') d++;
        else if (--d === 0) return j + 1;
    }
    return -1;
}

const skipWs = (t, i) => { while (i < t.length && /\s/.test(t[i])) i++; return i; };

function readArg(t, i) { // {...}
    i = skipWs(t, i);
    if (t[i] !== '{') return null;
    const end = closeGroup(t, i);
    return end < 0 ? null : { inner: t.slice(i + 1, end - 1), end };
}

function readOpt(t, i) { // [...], brace-aware
    const j = skipWs(t, i);
    if (t[j] !== '[') return { inner: null, end: i };
    for (let k = j + 1, d = 0; k < t.length; k++) {
        if (escaped(t, k)) continue;
        if (t[k] === '{') d++; else if (t[k] === '}') d--;
        else if (t[k] === ']' && d === 0) return { inner: t.slice(j + 1, k), end: k + 1 };
    }
    return { inner: null, end: i };
}

// xcolor.sty \XC@cnv@hsb@rgb: piecewise by sixths of the hue, the fraction complemented in even sixths.
function hsb(h, s, b) {
    const x = 6 * h, i = Math.min(6, Math.max(0, Math.floor(x))), f = i % 2 ? x - i : 1 - (x - i);
    return [[0, f, 1], [f, 0, 1], [1, 0, f], [1, f, 0], [f, 1, 0], [0, 1, f], [0, f, 1]][i].map(y => b * (1 - s * y));
}

function parseSpec(model, spec) {
    model = model.split('/')[0].trim(); spec = spec.split('/')[0].trim();
    const v = spec.split(',').map(Number);
    const ok = (x, n) => x.length === n && x.every(Number.isFinite);
    switch (model) {
        case 'rgb': return ok(v, 3) ? v : null;
        case 'RGB': return ok(v, 3) ? v.map(x => x / 255) : null;
        case 'HTML': return /^[0-9a-fA-F]{6}$/.test(spec) ? [0, 2, 4].map(k => parseInt(spec.slice(k, k + 2), 16) / 255) : null;
        case 'cmyk': return ok(v, 4) ? [0, 1, 2].map(k => 1 - Math.min(1, v[k] + v[3])) : null; // xcolor.sty \XC@cnv@cmyk@cmy
        case 'cmy': return ok(v, 3) ? v.map(x => 1 - x) : null;
        case 'gray': return ok(v, 1) ? [v[0], v[0], v[0]] : null;
        case 'hsb': return ok(v, 3) ? hsb(v[0], v[1], v[2]) : null;
        case 'Hsb': return ok(v, 3) ? hsb(v[0] / 360, v[1], v[2]) : null; // \rangeHsb
        case 'HSB': return ok(v, 3) ? hsb(v[0] / 240, v[1] / 240, v[2] / 240) : null; // \rangeHSB
    }
    return null;
}

// xcolor expressions: name, name!p (with white), a!p!b, a!p!b!q!c (percentages clamped to 0..100); minus
// signs before the whole expression complement it (an even number cancels), before a later name that name.
function parseExpr(expr, table) {
    const lead = /^\s*(-*)\s*/.exec(expr), parts = expr.slice(lead[0].length).trim().split('!').map(s => s.trim());
    const named = n => { const m = /^(-*)(.*)$/.exec(n), c = own(table, m[2].trim()); return c && (m[1].length % 2 ? c.map(x => 1 - x) : c); };
    let c = own(table, parts[0]);
    if (!c) return null;
    for (let i = 1; i < parts.length; i += 2) {
        const p = Math.min(1, Math.max(0, Number(parts[i]) / 100)), o = parts[i + 1] === undefined ? BASE.white : named(parts[i + 1]);
        if (parts[i] === '' || !Number.isFinite(p) || !o) return null; // red! or red!50! while typing
        c = c.map((x, k) => p * x + (1 - p) * o[k]);
    }
    return lead[1].length % 2 ? c.map(x => 1 - x) : c;
}

function colorOf(model, spec, table) {
    if (model?.trim() === 'named') return own(table, spec.trim()) || null;
    return model ? parseSpec(model, spec) : parseExpr(spec, table);
}

const XCOLOR_OPTIONS = /\\(?:usepackage|RequirePackage)\s*\[([^\]]*)\]\s*\{[^}]*\bxcolor\b[^}]*\}|\\PassOptionsToPackage\s*\{([^}]*)\}\s*\{[^}]*\bxcolor\b[^}]*\}|\\documentclass\s*\[([^\]]*)\]/g;

const NAME = /\\([A-Za-z@]+)/y;
const DEF = new Set(['def', 'gdef', 'edef', 'xdef']);
const DEFINING = /\\(definecolor|providecolor|definecolorset|colorlet|newcommand|renewcommand|providecommand|DeclareRobustCommand|NewDocumentCommand|RenewDocumentCommand|ProvideDocumentCommand|DeclareDocumentCommand|[gex]?def|let|newenvironment|renewenvironment)(?![A-Za-z@])\*?/g;
const DEFINERS = new Set(['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand']);
const XPARSE = new Set(['NewDocumentCommand', 'RenewDocumentCommand', 'ProvideDocumentCommand', 'DeclareDocumentCommand']);
// soul and ulem commands, styled wherever they are used; a definition in the document replaces one.
const BUILTINS = Object.fromEntries(Object.entries({
    hl: { bg: HL_DEFAULT }, texthl: { bg: HL_DEFAULT }, st: { deco: 'line-through' }, sout: { deco: 'line-through' }, xout: { deco: 'line-through' },
    uwave: { deco: 'underline wavy' }, ul: { deco: 'underline' }, uline: { deco: 'underline' }, dashuline: { deco: 'underline dashed' }, dotuline: { deco: 'underline dotted' },
}).map(([n, style]) => [n, { style, spec: ['m'], target: 0, builtin: true }]));
// Inside macro bodies only: font and underline commands, companions to a color, highlight or line.
const FONTS = { textbf: { bold: true }, textit: { italic: true }, emph: { italic: true }, underline: { deco: 'underline' } };
const FONT_SWITCHES = { bfseries: { bold: true }, itshape: { italic: true } };

// Fixed key order, so equal styles share one decoration type; null unless it shows a color, highlight or line.
function canon(s) {
    const out = {};
    for (const k of ['color', 'bg', 'deco', 'bold', 'italic']) if (s[k] != null) out[k] = s[k];
    return out.color || out.bg || out.deco ? out : null;
}

// End of a macro's arguments up to spec[target] at a use site; -1 if a mandatory one is missing.
function argsEnd(t, i, spec, target) {
    let end = i;
    for (let k = 0; k <= target; k++) {
        const a = spec[k];
        if (a === 'm') { const r = readArg(t, end); if (!r) return -1; end = r.end; }
        else if (a === 'o') end = readOpt(t, end).end;
        else { const c = a === 's' ? '*' : a.slice(1), j = skipWs(t, end); if (t.startsWith(c, j)) end = j + c.length; }
    }
    return end;
}

// The merged style of the spans covering p, inner (shorter) spans winning, ties in creation order.
function styleAt(regions, p) {
    const cover = regions.filter(r => r.start <= p && p < r.end).sort((a, b) => (b.end - b.start) - (a.end - a.start));
    return cover.length ? canon(Object.assign({}, ...cover.map(r => r.style))) : null;
}

// { style, spec, target } for a definition, or null: target indexes spec, the highest-numbered argument the
// body styles; style is the style at that argument.
function analyze(def, state) {
    const regions = collectSpans(def.body, state, undefined, true);
    let best = null;
    for (const m of def.body.matchAll(/#([1-9])/g)) {
        const k = Number(m[1]) - 1;
        if (k >= def.spec.length || (best && k <= best.target)) continue;
        const style = styleAt(regions, m.index);
        if (style) best = { style, spec: def.spec, target: k };
    }
    return best;
}

// xparse argument specification as m, o, s, t<char>; null for any other kind.
function xparseSpec(s) {
    const out = [];
    for (let i = 0; i < s.length;) {
        const c = s[i];
        if (/\s|\+/.test(c)) i++; // + marks a long argument
        else if (c === 'm' || c === 'o' || c === 's') { out.push(c); i++; }
        else if (c === 'O') { const a = readArg(s, i + 1); if (!a) return null; out.push('o'); i = a.end; }
        else if (c === 't' && s[i + 1] && !/\s/.test(s[i + 1])) { out.push('t' + s[i + 1]); i += 2; }
        else return null;
    }
    return out;
}

// \name or {\name} at i (after an optional star): { name, end }.
function readName(t, i) {
    i = skipWs(t, i);
    if (t[i] === '*') i = skipWs(t, i + 1);
    if (t[i] === '{') { const a = readArg(t, i), n = a && /^\s*\\([A-Za-z@]+)\s*$/.exec(a.inner); return n ? { name: n[1], end: a.end } : null; }
    NAME.lastIndex = i;
    const n = NAME.exec(t);
    return n ? { name: n[1], end: NAME.lastIndex } : null;
}

// Colors, styling macros and environments defined in the document. Colors are read in order; macros
// are resolved to a fixed point afterwards, so a macro may call one defined later.
function definitions(code) {
    const table = Object.assign(Object.create(null), BASE), defs = Object.create(null), envs = Object.create(null), options = new Set();
    for (const m of code.matchAll(XCOLOR_OPTIONS))
        for (const o of (m[1] ?? m[2] ?? m[3]).split(',').map(o => o.trim())) { options.delete(o); options.add(o); } // a repeat moves to the end
    for (const o of options) Object.assign(table, own(NAMES.sets, o)); // option order: class, passed, package; the last set wins
    const envDefs = [];
    DEFINING.lastIndex = 0;
    for (let m; (m = DEFINING.exec(code));) {
        if (escaped(code, m.index)) continue;
        const name = m[1], i = DEFINING.lastIndex;
        if (name === 'definecolor' || name === 'providecolor') {
            const o = readOpt(code, i), a = readArg(code, o.end), b = a && readArg(code, a.end), c = b && readArg(code, b.end);
            if (c) { const v = colorOf(b.inner, c.inner, table); if (v && !(name === 'providecolor' && table[a.inner.trim()])) table[a.inner.trim()] = v; }
        } else if (name === 'definecolorset') { // [type]{models}{head}{tail}{name,spec;...}
            const o = readOpt(code, i), md = readArg(code, o.end), hd = md && readArg(code, md.end), tl = hd && readArg(code, hd.end), b = tl && readArg(code, tl.end);
            for (const entry of b ? b.inner.split(';') : []) {
                const k = entry.indexOf(','), v = k > 0 && parseSpec(md.inner, entry.slice(k + 1));
                if (v) table[hd.inner.trim() + entry.slice(0, k).trim() + tl.inner.trim()] = v;
            }
        } else if (name === 'colorlet') {
            const o = readOpt(code, i), a = readArg(code, o.end), mo = a && readOpt(code, a.end), b = a && readArg(code, mo.end);
            if (b) { const v = parseExpr(b.inner, table); if (v) table[a.inner.trim()] = v; }
        } else if (DEFINERS.has(name) || XPARSE.has(name)) {
            const t = readName(code, i);
            if (!t || (/^(provide|Provide)/.test(name) && defs[t.name])) continue;
            let spec, body;
            if (XPARSE.has(name)) { const a = readArg(code, t.end); spec = a && xparseSpec(a.inner); body = spec && readArg(code, a.end); }
            else {
                const n = readOpt(code, t.end), dflt = readOpt(code, n.end), k = Number(n.inner ?? 0);
                spec = Array.from({ length: k }, (_, j) => j === 0 && dflt.inner !== null ? 'o' : 'm');
                body = readArg(code, dflt.end);
            }
            if (body) defs[t.name] = { body: body.inner, spec };
        } else if (DEF.has(name)) { // undelimited parameters only; TeX skips spaces after the name
            const t = readName(code, i), brace = t ? code.indexOf('{', t.end) : -1;
            const params = brace >= 0 && /^((?:#[1-9])*)$/.exec(code.slice(t.end, brace).replace(/^\s+/, '')), body = params && readArg(code, brace);
            const k = params ? params[1].length / 2 : 0;
            if (body && params[1] === Array.from({ length: k }, (_, j) => `#${j + 1}`).join('')) defs[t.name] = { body: body.inner, spec: Array(k).fill('m') };
        } else if (name === 'let') {
            const a = readName(code, i), eq = a && skipWs(code, a.end), b = a && readName(code, code[eq] === '=' ? eq + 1 : eq);
            if (b && own(defs, b.name)) defs[a.name] = defs[b.name];
            else if (a) delete defs[a.name];
        } else if (name === 'newenvironment' || name === 'renewenvironment') {
            const a = readArg(code, i), n = a && readOpt(code, a.end), dflt = n && readOpt(code, n.end), begin = dflt && readArg(code, dflt.end);
            if (begin) envDefs.push([a.inner.trim(), begin.inner]);
        }
    }
    let macros = Object.assign(Object.create(null), BUILTINS);
    for (let pass = 0; pass < 5; pass++) { // fixed point: macros that call macros
        const next = Object.assign(Object.create(null), BUILTINS);
        for (const n of Object.keys(defs)) { const d = analyze(defs[n], { table, macros, envs }); if (d) next[n] = d; else delete next[n]; }
        const same = JSON.stringify(next) === JSON.stringify(macros);
        macros = next;
        if (same) break;
    }
    for (const [n, begin] of envDefs) { // only a style the begin code leaves open reaches the body: here, a trailing space
        const b = begin + ' ', s = styleAt(collectSpans(b, { table, macros, envs }, undefined, true), b.length - 1);
        if (s) envs[n] = s; else delete envs[n];
    }
    return { table, macros, envs };
}

const GROUP = /\\(begin|end)(?:group)?(?![A-Za-z@])/y;

// +1 where a group opens ({, \begin, \begingroup), -1 where one closes, else 0.
function delta(t, j) {
    if (t[j] === '{') return 1;
    if (t[j] === '}') return -1;
    if (t[j] !== '\\') return 0;
    GROUP.lastIndex = j;
    const m = GROUP.exec(t);
    return m ? (m[1] === 'begin' ? 1 : -1) : 0;
}
const marked = (t, j) => (t[j] === '{' || t[j] === '}' || t[j] === '\\') && !escaped(t, j);

// Group structure of one text, built in one regex pass over braces and \begin/\end: the opening and closing
// positions, where each group closes, and closes with nothing open. switchEnd sweeps a cursor forward over
// these, so a document's switches cost linear time in total.
const GROUPS = /[{}]|\\(begin|end)(?:group)?(?![A-Za-z@])/g;
let groupCache = { t: null, pos: [], d: [], close: new Map(), stray: [], k: 0, open: [] };
function groupsOf(t) {
    if (groupCache.t === t) return groupCache;
    const pos = [], d = [], close = new Map(), stray = [], stack = [];
    GROUPS.lastIndex = 0;
    for (let m; (m = GROUPS.exec(t));) {
        if (escaped(t, m.index)) continue;
        const x = m[0] === '{' || m[1] === 'begin' ? 1 : -1;
        pos.push(m.index); d.push(x);
        if (x > 0) stack.push(m.index); else if (stack.length) close.set(stack.pop(), m.index); else stray.push(m.index);
    }
    return (groupCache = { t, pos, d, close, stray, k: 0, open: [] });
}

// End of the scope of a \color switch starting at i: the end of the enclosing group or environment;
// the next blank line if that group never closes (mid-typing); else the next unmatched close or the document end.
function switchEnd(t, i) {
    for (let j = i, d = 0, n = Math.min(t.length, i + 4096); j < n; j++) // usually the group closes nearby
        if (marked(t, j) && (d += delta(t, j)) < 0) return j;
    const g = groupsOf(t);
    if (g.k > 0 && g.pos[g.k - 1] >= i) { g.k = 0; g.open = []; }
    for (; g.k < g.pos.length && g.pos[g.k] < i; g.k++) if (g.d[g.k] > 0) g.open.push(g.pos[g.k]); else g.open.pop();
    if (g.open.length) {
        const c = g.close.get(g.open[g.open.length - 1]);
        if (c !== undefined) return c;
        const blank = /\n[ \t]*\n/.exec(t.slice(i));
        return blank ? i + blank.index : t.length;
    }
    return g.stray.find(j => j >= i) ?? t.length;
}

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);

// Spans in masked code: {start, end, style, whatEnd, origin}; style.color / style.bg are rgb triples in [0, 1].
// state: { table, macros, envs } from definitions(). fonts: also font and underline commands (macro bodies).
function collectSpans(code, state, probed = undefined, fonts = false) {
    const { table, macros, envs } = state, out = [];
    const memo = new Map(), colorFor = (model, spec) => { // [rgb, origin] or null
        const k = `${model}\0${spec}`, p = !model && own(probed?.exprs, spec.trim());
        if (!memo.has(k)) memo.set(k, p ? [p, 'probe'] : (c => c && [c, 'parser'])(colorOf(model, spec, table)));
        return memo.get(k);
    };
    // Only commands that make or affect a span; a regex over these names skips the rest of the text quickly.
    const names = ['textcolor', 'colorbox', 'color', 'begin', 'sethlcolor', 'let', ...DEF, ...DEFINERS, ...XPARSE, ...Object.keys(macros),
        ...Object.keys(probed?.macros ?? {}), ...(fonts ? [...Object.keys(FONTS), ...Object.keys(FONT_SWITCHES)] : [])];
    const hlColors = []; // [rgb, end of the \sethlcolor's group]
    const switches = new Map(); // scope end -> index in out of the latest \color switch with that scope
    const re = new RegExp(String.raw`\\(${[...new Set(names)].filter(n => /^[A-Za-z@]+$/.test(n)).join('|')})(?![A-Za-z@])`, 'g');
    for (let m; (m = re.exec(code));) {
        if (escaped(code, m.index)) continue;
        const name = m[1], i = re.lastIndex;
        if (DEFINERS.has(name) || XPARSE.has(name) || DEF.has(name) || name === 'let') { // skip the name being defined
            const t = readName(code, i);
            if (t) re.lastIndex = t.end;
        } else if (name === 'textcolor' || name === 'colorbox') {
            const o = readOpt(code, i), a = readArg(code, o.end), b = a && readArg(code, a.end);
            const v = b && colorFor(o.inner, a.inner);
            if (v) out.push({ start: m.index, end: b.end, style: name === 'textcolor' ? { color: v[0] } : { bg: v[0] }, whatEnd: a.end, origin: v[1] });
        } else if (name === 'color') {
            const o = readOpt(code, i), a = readArg(code, o.end), v = a && colorFor(o.inner, a.inner), end = a ? switchEnd(code, a.end) : 0;
            if (!v) continue;
            const prev = switches.get(end); // a later switch in the same group replaces this one from here on
            if (prev !== undefined) out[prev].end = m.index;
            switches.set(end, out.length);
            out.push({ start: m.index, end, style: { color: v[0] }, whatEnd: a.end, origin: v[1] });
        } else if (name === 'sethlcolor') {
            const a = readArg(code, i), v = a && colorFor(null, a.inner);
            if (v) hlColors.push([v[0], switchEnd(code, a.end)]);
        } else if (name === 'begin') {
            const a = readArg(code, i), env = a && a.inner.trim();
            if (env && own(envs, env)) out.push({ start: m.index, end: envEnd(code, a.end, env), style: envs[env], whatEnd: a.end, origin: 'parser' });
        } else if (fonts && own(FONTS, name) && !own(macros, name)) {
            const a = readArg(code, i);
            if (a) out.push({ start: m.index, end: a.end, style: FONTS[name], whatEnd: i, origin: 'parser' });
        } else if (fonts && own(FONT_SWITCHES, name)) {
            out.push({ start: m.index, end: switchEnd(code, i), style: FONT_SWITCHES[name], whatEnd: i, origin: 'parser' });
        } else if (own(macros, name) || own(probed?.macros, name)) {
            const d = own(macros, name) || { style: {}, spec: ['o', 'm'], target: 1 }, p = own(probed?.macros, name);
            const end = argsEnd(code, i, d.spec, d.target);
            let style = p ? { ...d.style, color: p } : d.style;
            if (d.builtin && d.style.bg) // the latest \sethlcolor whose group is still open
                for (let k = hlColors.length - 1; k >= 0; k--) if (m.index < hlColors[k][1]) { style = { ...style, bg: hlColors[k][0] }; break; }
            if (end >= 0) out.push({ start: m.index, end, style, whatEnd: i, origin: p ? 'probe' : 'parser' });
        }
    }
    return out;
}

// Raw spans of a text: collectSpans with the definitions of the text and its prelude. probed (from the probe
// compile) gives exact colors by macro name and by expression; spans still come from the parser. prelude: the
// text of the document's other files, read for definitions only. text.slice(start, whatEnd) is the command
// (with its color argument) that made a span; origin says whether the probe supplied the color.
function spans(text, probed = undefined, prelude = '') {
    const code = mask(text);
    return collectSpans(code, definitions(prelude ? mask(prelude) + '\n' + code : code), probed);
}

// End of the matching \end{env} after i; the next blank line if there is none (mid-typing), else the document end.
function envEnd(t, i, env) {
    const re = new RegExp(String.raw`\\(begin|end)\s*\{${env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\}`, 'g');
    re.lastIndex = i;
    for (let m, d = 0; (m = re.exec(t));) if (m[1] === 'begin') d++; else if (d-- === 0) return re.lastIndex;
    const blank = /\n[ \t]*\n/.exec(t.slice(i));
    return blank ? i + blank.index : t.length;
}

// Non-overlapping segments; where spans nest, the inner (shorter) span's properties win, ties in creation
// order. A sweep: starts in order (spans() emits them so), the next end found among the few active spans.
function flatten(raw) {
    let ids = raw.map((_, k) => k).filter(k => raw[k].start < raw[k].end);
    if (ids.some((k, j) => j && raw[ids[j - 1]].start > raw[k].start)) ids = ids.sort((x, y) => raw[x].start - raw[y].start || x - y);
    const order = (x, y) => (raw[y].end - raw[y].start) - (raw[x].end - raw[x].start) || x - y, out = [];
    let active = [], next = 0, pos = 0;
    while (next < ids.length || active.length) {
        let b = next < ids.length ? raw[ids[next]].start : Infinity;
        for (const k of active) b = Math.min(b, raw[k].end);
        if (active.length && pos < b) {
            const last = out[out.length - 1];
            const style = active.length === 1 ? raw[active[0]].style : Object.assign({}, ...[...active].sort(order).map(k => raw[k].style));
            if (last && last.end === pos && (last.style === style || JSON.stringify(last.style) === JSON.stringify(style))) last.end = b;
            else out.push({ start: pos, end: b, style });
        }
        pos = b;
        active = active.filter(k => raw[k].end > b);
        while (next < ids.length && raw[ids[next]].start === b) active.push(ids[next++]);
    }
    return out;
}

const scan = (text, probed = undefined, prelude = '') => flatten(spans(text, probed, prelude));
const luminance = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// Mix a color toward white until its relative luminance reaches min (for dark themes).
function lift(c, min) {
    for (let k = 0; k < 50 && luminance(c) < min; k++) c = c.map(x => x + 0.15 * (1 - x)); // ponytail: 50 steps reach 0.9997
    return c;
}
const hex = c => '#' + c.map(x => Math.round(255 * Math.min(1, Math.max(0, x))).toString(16).padStart(2, '0')).join('');

// Spans as readable records (source text, hex colors), colors then marks: for snapshots and latexColors._spans.
function readable(text, colors, marks = []) {
    const rec = s => ({ text: text.slice(s.start, s.end), start: s.start, end: s.end });
    return [
        ...colors.map(s => ({ ...rec(s), style: Object.fromEntries(Object.entries(s.style).map(([k, v]) => [k, Array.isArray(v) ? hex(v) : v])) })),
        ...marks.map(m => ({ ...rec(m), mark: m.kind })),
    ];
}

// Decoration options for a style; minLuminance (null for none) lifts dark colors on dark themes.
function renderOptions(s, minLuminance) {
    const o = {};
    if (s.color) o.color = hex(minLuminance === null ? s.color : lift(s.color, minLuminance));
    if (s.bg) { o.backgroundColor = hex(s.bg); if (!s.color) o.color = luminance(s.bg) > 0.5 ? '#000000' : '#ffffff'; }
    if (s.deco) o.textDecoration = s.deco;
    if (s.bold) o.fontWeight = 'bold';
    if (s.italic) o.fontStyle = 'italic';
    if (o.color) o.overviewRulerColor = o.color;
    return o;
}

module.exports = { scan, flatten, readable, renderOptions, lift, luminance, spans, definitions, parseExpr, parseSpec, mask, readArg, readOpt, hex, BASE };
