// @ts-check
// Markup that does not reach the PDF: command names, braces, alignment tabs, optional arguments, and arguments
// that never print (labels, references, citations, file names, sizes, color names, definitions). The extension
// shows these at reduced opacity, so they keep their color. Math, comments and verbatim are left alone. Pure.
'use strict';
const { mask, readArg, readOpt } = require('./colors');

// Commands with arguments that do not print: per mandatory argument, M muted whole or k printed (only its
// braces muted). Their optional arguments are muted whole.
const ARGS = {
    label: 'M', ref: 'M', eqref: 'M', pageref: 'M', autoref: 'M', nameref: 'M', vref: 'M', cref: 'M', Cref: 'M', cpageref: 'M',
    Cpageref: 'M', crefrange: 'MM', Crefrange: 'MM', includegraphics: 'M', input: 'M', include: 'M', subfile: 'M', import: 'MM',
    subimport: 'MM', usepackage: 'M', RequirePackage: 'M', documentclass: 'M', bibliography: 'M', bibliographystyle: 'M',
    addbibresource: 'M', graphicspath: 'M', hypersetup: 'M', geometry: 'M', pagestyle: 'M', thispagestyle: 'M', setlength: 'MM',
    addtolength: 'MM', setcounter: 'MM', addtocounter: 'MM', newcounter: 'M', numberwithin: 'MM', hspace: 'M', vspace: 'M',
    PassOptionsToPackage: 'MM', definecolor: 'MMM', providecolor: 'MMM', colorlet: 'MM', definecolorset: 'MMMM', color: 'M',
    pagecolor: 'M', sethlcolor: 'M', textcolor: 'Mk', colorbox: 'Mk', fcolorbox: 'MMk', href: 'Mk', end: 'M',
};
// Definitions, muted whole: N a command name ({\name} or \name), o any optional arguments, M a braced argument.
const DEFS = {
    newcommand: 'NoM', renewcommand: 'NoM', providecommand: 'NoM', DeclareRobustCommand: 'NoM', NewDocumentCommand: 'NMM',
    RenewDocumentCommand: 'NMM', ProvideDocumentCommand: 'NMM', DeclareDocumentCommand: 'NMM', newenvironment: 'NoMM',
    renewenvironment: 'NoMM', NewDocumentEnvironment: 'NMMM', RenewDocumentEnvironment: 'NMMM',
};
// Environment arguments after the name that do not print: column specifications and widths.
const ENV_ARGS = { tabular: 'M', 'tabular*': 'MM', tabularx: 'MM', tabulary: 'MM', array: 'M', longtable: 'M', minipage: 'M',
    wrapfigure: 'MM', subfigure: 'M', multicols: 'M', thebibliography: 'M' };
// Commands that print a glyph or a word.
const GLYPHS = new Set(['LaTeX', 'LaTeXe', 'TeX', 'ldots', 'dots', 'textellipsis', 'textbackslash', 'S', 'P', 'dag', 'ddag', 'copyright',
    'textregistered', 'texttrademark', 'pounds', 'euro', 'ss', 'ae', 'AE', 'oe', 'OE', 'o', 'O', 'i', 'j', 'l', 'L', 'aa', 'AA',
    'textasciitilde', 'textasciicircum', 'textendash', 'textemdash', 'textquotedblleft', 'textquotedblright', 'textquoteleft',
    'textquoteright', 'textbullet', 'textdegree', 'textperiodcentered', 'checkmark', 'today', 'slash', 'textbar', 'textless',
    'textgreater', 'textunderscore', 'textpm', 'texttimes', 'textmu']);
// Environments whose optional arguments do not print (placement, alignment, list options); others print theirs
// (\begin{theorem}[Cauchy--Schwarz]), so only the brackets fade.
const OPT_ENVS = new Set(['figure', 'figure*', 'table', 'table*', 'wrapfigure', 'wraptable', 'minipage', 'tabular', 'tabular*', 'tabularx',
    'array', 'longtable', 'subfigure', 'subtable', 'itemize', 'enumerate', 'description', 'algorithm', 'algorithmic']);
const SPACING = new Set(['\\', ',', ';', ':', '!', ' ', '\n', '/', '-', '@']); // \\ \, \; ... print no glyph
const MATH = /\$\$|\$|\\\(|\\\)|\\\[|\\\]|\\(begin|end)\s*\{(equation|align|gather|multline|flalign|alignat|eqnarray|math|displaymath|dmath)(\*?)\}/g;
const TOKEN = /\\([A-Za-z@]+)(\*?)|\\([^A-Za-z@])|[{}&]/g;
const escaped = (t, i) => { let n = 0; while (i - 1 - n >= 0 && t[i - 1 - n] === '\\') n++; return n % 2 === 1; };
const skipWs = (t, i) => { while (i < t.length && /\s/.test(t[i])) i++; return i; };

// Math regions [start, end) in masked code: their contents print.
function mathRegions(code) {
    const out = [];
    let close = null, from = 0;
    MATH.lastIndex = 0;
    for (let m; (m = MATH.exec(code));) {
        if (escaped(code, m.index)) continue;
        const tok = m[1] ? `${m[1]}{${m[2]}${m[3]}}` : m[0];
        if (close === null) {
            if (m[1] === 'end' || tok === '\\)' || tok === '\\]') continue;
            close = m[1] ? `end{${m[2]}${m[3]}}` : { '$$': '$$', $: '$', '\\(': '\\)', '\\[': '\\]' }[tok];
            from = m.index + m[0].length;
        } else if (tok === close) { out.push([from, m.index]); close = null; }
    }
    if (close !== null) out.push([from, code.length]);
    return out;
}

// End of the arguments described by spec (N, o, M) from j; stops early where a mandatory one is missing.
function take(t, j, spec) {
    for (const c of spec) {
        if (c === 'o') for (let o; (o = readOpt(t, j)).inner !== null;) j = o.end;
        else if (c === 'N') {
            const k = skipWs(t, t[skipWs(t, j)] === '*' ? skipWs(t, j) + 1 : j), n = /^\\[A-Za-z@]+/.exec(t.slice(k, k + 100));
            if (n) j = k + n[0].length; else { const a = readArg(t, k); if (!a) return j; j = a.end; }
        } else { const a = readArg(t, j); if (!a) return j; j = a.end; }
    }
    return j;
}

/** Ranges [start, end) of markup that does not reach the PDF, adjacent ones merged. */
function muted(text) {
    const code = mask(text), math = mathRegions(code), out = [];
    const add = (a, b) => { const last = out[out.length - 1]; if (last && last.end === a) last.end = b; else if (a < b) out.push({ start: a, end: b }); };
    const brackets = j => { // fade only the brackets of the optional arguments from j; their end
        for (let o; (o = readOpt(code, j)).inner !== null; j = o.end) { add(o.end - o.inner.length - 2, o.end - o.inner.length - 1); add(o.end - 1, o.end); }
        return j;
    };
    let r = 0; // next math region
    TOKEN.lastIndex = 0;
    for (let m; (m = TOKEN.exec(code));) {
        const i = m.index;
        while (r < math.length && math[r][1] <= i) r++;
        if ((r < math.length && math[r][0] <= i) || escaped(code, i)) continue; // in math, or \{ \} \& print
        let end = TOKEN.lastIndex;
        const name = m[1];
        if (m[3] !== undefined) { // control symbol
            if (!SPACING.has(m[3])) continue; // \% \& \' ... print
            if (m[3] === '\\') end = readOpt(code, end).end; // \\[2pt]
        } else if (name === undefined) { // { } &
        } else if (GLYPHS.has(name)) continue;
        else if (DEFS[name]) end = take(code, end, DEFS[name]);
        else if (/^[gex]?def$/.test(name)) { const b = code.indexOf('{', end), a = b >= 0 && readArg(code, b); if (a) end = a.end; }
        else if (name === 'begin') {
            const a = readArg(code, end), env = a ? a.inner.trim() : '';
            if (a) {
                add(i, a.end);
                const j = OPT_ENVS.has(env) ? take(code, a.end, 'o') : brackets(a.end);
                if (OPT_ENVS.has(env)) add(a.end, j);
                end = take(code, j, ENV_ARGS[env] ?? '');
                add(j, end);
                TOKEN.lastIndex = Math.max(TOKEN.lastIndex, end);
                continue;
            }
        } else if (/cite/i.test(name) && !ARGS[name]) { // pre- and postnotes print, the key does not
            add(i, end);
            const j = brackets(end);
            end = take(code, j, 'M');
            add(j, end);
            TOKEN.lastIndex = Math.max(TOKEN.lastIndex, end);
            continue;
        } else if (ARGS[name]) end = take(code, end, 'o' + ARGS[name].replace(/k.*$/, ''));
        else { // a command whose arguments print: mute the brackets of its optional arguments
            add(i, end);
            brackets(end);
            continue;
        }
        add(i, end);
        TOKEN.lastIndex = Math.max(TOKEN.lastIndex, end);
    }
    return out;
}

module.exports = { muted };
