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

const MASKED = /%|\\verb(?![A-Za-z])|\\begin\s*\{(verbatim\*?|Verbatim\*?|lstlisting|minted|comment)\}/g;
const blankOut = s => s.replace(/[^\n]/g, ' ');

// Blank out what TeX does not read as commands, keeping offsets: % comments, \verb<d>...<d>, and the
// bodies of verbatim-like environments.
function mask(t) {
    let out = '', prev = 0;
    MASKED.lastIndex = 0;
    for (let m; (m = MASKED.exec(t));) {
        const i = m.index;
        if (escaped(t, i)) continue;
        const eol = (j => j < 0 ? t.length : j)(t.indexOf('\n', i));
        let from = i, end;
        if (m[0] === '%') end = eol;
        else if (m[1]) { from = MASKED.lastIndex; end = (j => j < 0 ? t.length : j)(t.indexOf(`\\end{${m[1]}}`, from)); }
        else { // \verb or \verb*, then any delimiter character
            const d = i + (t[i + 5] === '*' ? 6 : 5), close = d < t.length ? t.indexOf(t[d], d + 1) : -1;
            end = close < 0 || close > eol ? eol : close + 1;
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

// xcolor expressions: name, name!p (with white), a!p!b, a!p!b!q!c, leading - for the complement.
function parseExpr(expr, table) {
    expr = expr.trim();
    const neg = expr.startsWith('-');
    const parts = (neg ? expr.slice(1) : expr).split('!').map(s => s.trim());
    let c = table[parts[0]];
    if (!c) return null;
    for (let i = 1; i < parts.length; i += 2) {
        const p = Number(parts[i]) / 100, o = parts[i + 1] ? table[parts[i + 1]] : BASE.white;
        if (!Number.isFinite(p) || !o) return null;
        c = c.map((x, k) => p * x + (1 - p) * o[k]);
    }
    return neg ? c.map(x => 1 - x) : c;
}

function colorOf(model, spec, table) {
    if (model?.trim() === 'named') return own(table, spec.trim()) || null;
    return model ? parseSpec(model, spec) : parseExpr(spec, table);
}

const XCOLOR_OPTIONS = /\\(?:usepackage|RequirePackage)\s*\[([^\]]*)\]\s*\{[^}]*\bxcolor\b[^}]*\}|\\PassOptionsToPackage\s*\{([^}]*)\}\s*\{[^}]*\bxcolor\b[^}]*\}|\\documentclass\s*\[([^\]]*)\]/g;

const CMD = /\\([A-Za-z@]+)\*?/g;
const NAME = /\\([A-Za-z@]+)/y;
const DEFINING = /\\(definecolor|providecolor|definecolorset|colorlet|newcommand|renewcommand|providecommand|DeclareRobustCommand|NewDocumentCommand|RenewDocumentCommand|ProvideDocumentCommand|DeclareDocumentCommand|def|let|newenvironment|renewenvironment)(?![A-Za-z@])\*?/g;
const DEFINERS = new Set(['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand']);
const XPARSE = new Set(['NewDocumentCommand', 'RenewDocumentCommand', 'ProvideDocumentCommand', 'DeclareDocumentCommand']);
// soul and ulem commands, styled wherever they are used; a definition in the document replaces one.
const BUILTINS = Object.fromEntries(Object.entries({
    hl: { bg: HL_DEFAULT }, texthl: { bg: HL_DEFAULT }, st: { deco: 'line-through' }, sout: { deco: 'line-through' }, xout: { deco: 'line-through' },
    uwave: { deco: 'underline wavy' }, ul: { deco: 'underline' }, uline: { deco: 'underline' }, dashuline: { deco: 'underline dashed' }, dotuline: { deco: 'underline dotted' },
}).map(([n, style]) => [n, { style, spec: ['m'], target: 0, builtin: true }]));
const ARG_STYLERS = new Set(['hl', 'texthl', 'sout', 'st', 'xout', 'uwave', 'uline', 'ul', 'underline', 'dashuline', 'dotuline', 'textbf', 'textit', 'emph']);

// Style implied by a macro body (with the styles of macros it calls), or null if it changes nothing visible.
function bodyStyle(body, table, macros) {
    const s = {};
    for (const m of body.matchAll(CMD)) if (own(macros, m[1])) Object.assign(s, macros[m[1]].style);
    const col = /\\(?:textcolor|color)\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/g;
    for (let m; (m = col.exec(body));) s.color = colorOf(m[1], m[2], table) || s.color;
    const hlc = body.match(/\\sethlcolor\s*\{([^{}]*)\}/);
    if (/\\(?:hl|texthl)\b/.test(body)) s.bg = (hlc && parseExpr(hlc[1], table)) || HL_DEFAULT;
    const box = body.match(/\\colorbox\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/);
    if (box) s.bg = colorOf(box[1], box[2], table) || s.bg;
    if (/\\(?:sout|st|xout)\b/.test(body)) s.deco = 'line-through';
    else if (/\\uwave\b/.test(body)) s.deco = 'underline wavy';
    else if (/\\dashuline\b/.test(body)) s.deco = 'underline dashed';
    else if (/\\dotuline\b/.test(body)) s.deco = 'underline dotted';
    else if (/\\(?:uline|ul|underline)\b/.test(body)) s.deco = 'underline';
    if (/\\(?:textbf|bfseries)\b/.test(body)) s.bold = true;
    if (/\\(?:textit|emph|itshape)\b/.test(body)) s.italic = true;
    const out = {}; // fixed key order: equal styles share one decoration type
    for (const k of ['color', 'bg', 'deco', 'bold', 'italic']) if (s[k] != null) out[k] = s[k];
    return Object.keys(out).length ? out : null;
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

// Parts of a body that a styling command covers: [start, end) pairs.
function styledRegions(body, macros) {
    const out = [], arg = r => r && out.push([r.end - r.inner.length - 2, r.end]);
    for (const m of body.matchAll(CMD)) {
        const name = m[1], i = m.index + m[0].length;
        if (name === 'textcolor' || name === 'colorbox') { const o = readOpt(body, i), a = readArg(body, o.end); arg(a && readArg(body, a.end)); }
        else if (name === 'color') { const a = readArg(body, readOpt(body, i).end); if (a) out.push([a.end, switchEnd(body, a.end)]); }
        else if (name === 'bfseries' || name === 'itshape') out.push([i, switchEnd(body, i)]);
        else if (ARG_STYLERS.has(name)) arg(readArg(body, i));
        else if (own(macros, name)) {
            const d = macros[name], end = argsEnd(body, i, d.spec, d.target);
            if (end >= 0) out.push([i, end]);
        }
    }
    return out;
}

// { style, spec, target } for a definition, or null: target indexes spec, the argument the style reaches.
function analyze(def, table, macros) {
    const style = bodyStyle(def.body, table, macros);
    if (!style) return null;
    const regions = styledRegions(def.body, macros);
    let target = -1;
    for (const m of def.body.matchAll(/#([1-9])/g))
        if (regions.some(([a, b]) => a <= m.index && m.index < b)) target = Math.max(target, Number(m[1]) - 1);
    if (target < 0 || target >= def.spec.length) target = def.spec.indexOf('m');
    return target < 0 ? null : { style, spec: def.spec, target };
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

// \name or {\name} at i: { name, end }.
function readName(t, i) {
    i = skipWs(t, i);
    if (t[i] === '{') { const a = readArg(t, i), n = a && /^\s*\\([A-Za-z@]+)\s*$/.exec(a.inner); return n ? { name: n[1], end: a.end } : null; }
    NAME.lastIndex = i;
    const n = NAME.exec(t);
    return n ? { name: n[1], end: NAME.lastIndex } : null;
}

// Colors, styling macros and environments defined in the document. Colors are read in order; macros
// are resolved to a fixed point afterwards, so a macro may call one defined later.
function definitions(code) {
    const table = Object.assign(Object.create(null), BASE), defs = Object.create(null), envs = Object.create(null), options = new Set();
    for (const m of code.matchAll(XCOLOR_OPTIONS)) for (const o of (m[1] ?? m[2] ?? m[3]).split(',')) options.add(o.trim());
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
        } else if (name === 'def') {
            const t = readName(code, i), brace = t ? code.indexOf('{', t.end) : -1;
            const params = brace >= 0 && /^((?:#[1-9])*)$/.exec(code.slice(t.end, brace)), body = params && readArg(code, brace);
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
        for (const n of Object.keys(defs)) { const d = analyze(defs[n], table, macros); if (d) next[n] = d; else delete next[n]; }
        const same = JSON.stringify(next) === JSON.stringify(macros);
        macros = next;
        if (same) break;
    }
    for (const [n, begin] of envDefs) { const s = bodyStyle(begin, table, macros); if (s) envs[n] = s; else delete envs[n]; }
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

// End of the scope of a \color switch starting at i: the end of the enclosing group or environment;
// the next blank line if that group never closes (mid-typing); else the document end.
function switchEnd(t, i) {
    let d = 0;
    const marked = j => (t[j] === '{' || t[j] === '}' || t[j] === '\\') && !escaped(t, j);
    for (let j = i; j < t.length; j++) if (marked(j) && (d += delta(t, j)) < 0) return j;
    let open = 0; // depth at i
    for (let j = 0; j < i; j++) if (marked(j)) open += delta(t, j);
    const blank = /\n[ \t]*\n/.exec(t.slice(i));
    return open > 0 && blank ? i + blank.index : t.length;
}

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);

// Raw spans: {start, end, style}; style.color / style.bg are rgb triples in [0, 1]. probed (from the
// probe compile) gives exact colors by macro name and by expression; spans still come from the parser.
// prelude: the text of the document's other files, read for definitions only. text.slice(start, whatEnd)
// is the command (with its color argument) that made a span; origin says whether the probe supplied the color.
function spans(text, probed = undefined, prelude = '') {
    const code = mask(text), { table, macros, envs } = definitions(prelude ? mask(prelude) + '\n' + code : code), out = [];
    const memo = new Map(), colorFor = (model, spec) => { // [rgb, origin] or null
        const k = `${model}\0${spec}`, p = !model && own(probed?.exprs, spec.trim());
        if (!memo.has(k)) memo.set(k, p ? [p, 'probe'] : (c => c && [c, 'parser'])(colorOf(model, spec, table)));
        return memo.get(k);
    };
    // Only commands that make or affect a span; a regex over these names skips the rest of the text quickly.
    const names = ['textcolor', 'colorbox', 'color', 'begin', 'sethlcolor', 'def', 'let', ...DEFINERS, ...XPARSE, ...Object.keys(macros), ...Object.keys(probed?.macros ?? {})];
    const hlColors = []; // [rgb, end of the \sethlcolor's group]
    const re = new RegExp(String.raw`\\(${[...new Set(names)].filter(n => /^[A-Za-z@]+$/.test(n)).join('|')})(?![A-Za-z@])\*?`, 'g');
    for (let m; (m = re.exec(code));) {
        if (escaped(code, m.index)) continue;
        const name = m[1], i = re.lastIndex;
        if (DEFINERS.has(name) || XPARSE.has(name) || name === 'def' || name === 'let') { // skip the name being defined
            const t = readName(code, i);
            if (t) re.lastIndex = t.end;
        } else if (name === 'textcolor' || name === 'colorbox') {
            const o = readOpt(code, i), a = readArg(code, o.end), b = a && readArg(code, a.end);
            const v = b && colorFor(o.inner, a.inner);
            if (v) out.push({ start: m.index, end: b.end, style: name === 'textcolor' ? { color: v[0] } : { bg: v[0] }, whatEnd: a.end, origin: v[1] });
        } else if (name === 'color') {
            const o = readOpt(code, i), a = readArg(code, o.end), v = a && colorFor(o.inner, a.inner);
            if (v) out.push({ start: m.index, end: switchEnd(code, a.end), style: { color: v[0] }, whatEnd: a.end, origin: v[1] });
        } else if (name === 'sethlcolor') {
            const a = readArg(code, i), v = a && colorFor(null, a.inner);
            if (v) hlColors.push([v[0], switchEnd(code, a.end)]);
        } else if (name === 'begin') {
            const a = readArg(code, i), env = a && a.inner.trim();
            if (env && own(envs, env)) out.push({ start: m.index, end: envEnd(code, a.end, env), style: envs[env], whatEnd: a.end, origin: 'parser' });
        } else if (own(macros, name) || own(probed?.macros, name)) {
            const d = own(macros, name) || { style: {}, spec: ['m'], target: 0 }, p = own(probed?.macros, name);
            const end = argsEnd(code, i, d.spec, d.target);
            let style = p ? { ...d.style, color: p } : d.style;
            if (d.builtin && d.style.bg) // the latest \sethlcolor whose group is still open
                for (let k = hlColors.length - 1; k >= 0; k--) if (m.index < hlColors[k][1]) { style = { ...style, bg: hlColors[k][0] }; break; }
            if (end >= 0) out.push({ start: m.index, end, style, whatEnd: i, origin: p ? 'probe' : 'parser' });
        }
    }
    return out;
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

module.exports = { scan, readable, renderOptions, lift, luminance, spans, definitions, parseExpr, parseSpec, mask, readArg, readOpt, hex, BASE };
