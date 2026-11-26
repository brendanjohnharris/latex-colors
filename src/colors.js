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

const escaped = (t, i) => { let n = 0; while (i - 1 - n >= 0 && t[i - 1 - n] === '\\') n++; return n % 2 === 1; };

// Blank out % comments, keeping offsets.
function stripComments(t) {
    const c = t.split('');
    for (let i = 0; i < c.length; i++)
        if (c[i] === '%' && !escaped(t, i)) while (i < c.length && c[i] !== '\n') c[i++] = ' ';
    return c.join('');
}

// Index just past the brace that closes the group opened at t[i] === '{'; -1 if unclosed.
function closeGroup(t, i) {
    let d = 0;
    for (let j = i; j < t.length; j++) {
        if (escaped(t, j)) continue;
        if (t[j] === '{') d++;
        else if (t[j] === '}' && --d === 0) return j + 1;
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

function colorOf(model, spec, table) { return model ? parseSpec(model, spec) : parseExpr(spec, table); }

const CMD = /\\([A-Za-z@]+)\*?/g;
const DEFINERS = new Set(['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand']);

// Style implied by a macro body, or null if it changes nothing visible.
function bodyStyle(body, table) {
    const s = {};
    const col = /\\(?:textcolor|color)\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/g;
    for (let m; (m = col.exec(body));) s.color = colorOf(m[1], m[2], table) || s.color;
    const hlc = body.match(/\\sethlcolor\s*\{([^{}]*)\}/);
    if (/\\(?:hl|texthl)\b/.test(body)) s.bg = (hlc && parseExpr(hlc[1], table)) || HL_DEFAULT;
    const box = body.match(/\\colorbox\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/);
    if (box) s.bg = colorOf(box[1], box[2], table) || s.bg;
    if (/\\(?:sout|st|xout)\b/.test(body)) s.deco = 'line-through';
    else if (/\\uwave\b/.test(body)) s.deco = 'underline wavy';
    else if (/\\(?:uline|ul|underline)\b/.test(body)) s.deco = 'underline';
    if (/\\(?:textbf|bfseries)\b/.test(body)) s.bold = true;
    if (/\\(?:textit|emph|itshape)\b/.test(body)) s.italic = true;
    for (const k of Object.keys(s)) if (s[k] == null) delete s[k];
    return Object.keys(s).length ? s : null;
}

// Colours and one-argument styling macros defined in the document, in order.
function definitions(code) {
    const table = Object.assign(Object.create(null), BASE), macros = Object.create(null);
    CMD.lastIndex = 0;
    for (let m; (m = CMD.exec(code));) {
        if (escaped(code, m.index)) continue;
        const name = m[1]; let i = CMD.lastIndex;
        if (name === 'definecolor' || name === 'providecolor') {
            const o = readOpt(code, i), a = readArg(code, o.end), b = a && readArg(code, a.end), c = b && readArg(code, b.end);
            if (c) { const v = parseSpec(b.inner, c.inner); if (v && !(name === 'providecolor' && table[a.inner.trim()])) table[a.inner.trim()] = v; }
        } else if (name === 'colorlet') {
            const o = readOpt(code, i), a = readArg(code, o.end), mo = a && readOpt(code, a.end), b = a && readArg(code, mo.end);
            if (b) { const v = parseExpr(b.inner, table); if (v) table[a.inner.trim()] = v; }
        } else if (DEFINERS.has(name)) {
            i = skipWs(code, i);
            let target;
            if (code[i] === '{') { const a = readArg(code, i); if (!a) continue; target = a.inner.trim(); i = a.end; }
            else { const t = /^\\([A-Za-z@]+)/.exec(code.slice(i)); if (!t) continue; target = t[0]; i += t[0].length; }
            const n = readOpt(code, i), dflt = readOpt(code, n.end), body = readArg(code, dflt.end);
            if (!body || !/^\\[A-Za-z@]+$/.test(target) || !(Number(n.inner) >= 1)) continue;
            const s = bodyStyle(body.inner, table);
            if (s) macros[target.slice(1)] = s;
        }
    }
    return { table, macros };
}

// End of the scope of a \color switch starting at i: the enclosing group, an \end, or the document end.
function switchEnd(t, i) {
    for (let j = i, d = 0; j < t.length; j++) {
        if (escaped(t, j)) continue;
        if (t[j] === '{') d++;
        else if (t[j] === '}') { if (d-- === 0) return j; }
        else if (d === 0 && t.startsWith('\\end', j)) return j;
    }
    return t.length;
}

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);

// Raw spans: {start, end, style}; style.color / style.bg are rgb triples in [0, 1]. probed (from the
// probe compile) gives exact colors by macro name and by expression; spans still come from the parser.
function spans(text, probed = undefined) {
    const code = stripComments(text), { table, macros } = definitions(code), out = [];
    const colorFor = (model, spec) => (!model && own(probed?.exprs, spec.trim())) || colorOf(model, spec, table);
    CMD.lastIndex = 0;
    for (let m; (m = CMD.exec(code));) {
        if (escaped(code, m.index)) continue;
        const name = m[1], i = CMD.lastIndex;
        if (name === 'textcolor' || name === 'colorbox') {
            const o = readOpt(code, i), a = readArg(code, o.end), b = a && readArg(code, a.end);
            const v = b && colorFor(o.inner, a.inner);
            if (v) out.push({ start: m.index, end: b.end, style: name === 'textcolor' ? { color: v } : { bg: v } });
        } else if (name === 'color') {
            const o = readOpt(code, i), a = readArg(code, o.end), v = a && colorFor(o.inner, a.inner);
            if (v) out.push({ start: m.index, end: switchEnd(code, a.end), style: { color: v } });
        } else if (macros[name] || own(probed?.macros, name)) {
            const a = readArg(code, i), p = own(probed?.macros, name);
            if (a) out.push({ start: m.index, end: a.end, style: p ? { ...macros[name], color: p } : macros[name] });
        }
    }
    return out;
}

// Non-overlapping segments; where spans nest, the inner span's properties win.
function flatten(raw) {
    const cuts = [...new Set(raw.flatMap(s => [s.start, s.end]))].sort((a, b) => a - b), out = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
        const a = cuts[k], b = cuts[k + 1];
        const cover = raw.filter(s => s.start <= a && s.end >= b).sort((x, y) => (y.end - y.start) - (x.end - x.start));
        if (!cover.length) continue;
        const style = Object.assign({}, ...cover.map(s => s.style));
        const last = out[out.length - 1];
        if (last && last.end === a && JSON.stringify(last.style) === JSON.stringify(style)) last.end = b;
        else out.push({ start: a, end: b, style });
    }
    return out;
}

const scan = (text, probed = undefined) => flatten(spans(text, probed));
const hex = c => '#' + c.map(x => Math.round(255 * Math.min(1, Math.max(0, x))).toString(16).padStart(2, '0')).join('');

// Spans as readable records (source text, hex colors), colors then marks: for snapshots and latexColors._spans.
function readable(text, colors, marks = []) {
    const rec = s => ({ text: text.slice(s.start, s.end), start: s.start, end: s.end });
    return [
        ...colors.map(s => ({ ...rec(s), style: Object.fromEntries(Object.entries(s.style).map(([k, v]) => [k, Array.isArray(v) ? hex(v) : v])) })),
        ...marks.map(m => ({ ...rec(m), mark: m.kind })),
    ];
}

module.exports = { scan, readable, spans, definitions, parseExpr, parseSpec, stripComments, readArg, readOpt, hex, BASE };
