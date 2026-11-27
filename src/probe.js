// @ts-check
// The probe compile: the root's preamble plus a generated body that typesets each candidate command
// around a reporting command, so LaTeX itself states the color each command and expression produces.
// Pure apart from the injected compile function.
'use strict';
const crypto = require('node:crypto');
const { mask, readArg, readOpt } = require('./colors');

const LIMIT = 500;
// Commands that are never color candidates: structure, references, definitions, spacing, and the math, font
// and box commands that fill math-heavy documents (each fails in the probe's text-mode box or leaves the color unchanged).
const DENY = new Set(['begin', 'end', 'item', 'part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph',
    'caption', 'label', 'bibliography', 'bibliographystyle', 'include', 'input', 'subfile', 'import', 'includegraphics', 'url', 'href',
    'footnote', 'marginpar', 'newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand', 'NewDocumentCommand',
    'RenewDocumentCommand', 'ProvideDocumentCommand', 'DeclareDocumentCommand', 'newenvironment', 'renewenvironment', 'def', 'hspace',
    'vspace', 'verb', 'textcolor', 'color', 'colorbox',
    'frac', 'dfrac', 'tfrac', 'sqrt', 'binom', 'hat', 'widehat', 'tilde', 'widetilde', 'bar', 'overline', 'underline', 'vec', 'dot',
    'ddot', 'bm', 'boldsymbol', 'mathcal', 'mathbb', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathfrak', 'mathscr', 'operatorname',
    'text', 'mbox', 'fbox', 'makebox', 'framebox', 'parbox', 'raisebox', 'phantom', 'vphantom', 'hphantom', 'smash', 'overset', 'underset',
    'stackrel', 'textbf', 'textit', 'emph', 'texttt', 'textsc', 'textsf', 'textrm', 'textup', 'textsl', 'textmd', 'textnormal',
    'SI', 'si', 'qty', 'unit', 'num', 'ang', 'SIrange', 'qtyrange', 'numrange', 'crefrange', 'Crefrange', 'setlength', 'addtolength',
    'setcounter', 'addtocounter', 'usepackage', 'RequirePackage', 'thanks', 'title', 'author', 'date', 'nocite']);
const denied = name => DENY.has(name) || /cite/i.test(name) || /ref$/i.test(name); // \cite*, \parencite, \ref, \eqref, \cref, ...
const EXTENDED = /[:>+\[\]=;,]/; // extended xcolor syntax (rgb:red,1;green,2, red>wheel,3, series): no plain names to pre-check
const CMD = /\\([A-Za-z@]+)\*?/g;
const BEGIN_DOC = /\\begin\s*\{document\}/;

/** Text before the first \begin{document} outside a comment, or null. */
function preambleOf(text) {
    const m = BEGIN_DOC.exec(mask(text));
    return m ? text.slice(0, m.index) : null;
}

/**
 * Commands used in the body with a braced argument, and the color expressions given anywhere to
 * \textcolor, \color or \colorbox without a model (with a model the parser is exact). files: the root's
 * other files ({ text, body }), body ones read as part of the body and the rest for expressions only.
 * @returns {{ list: Array<{kind: 'macro', name: string, args: number} | {kind: 'expr', expr: string, names: string[]}>, truncated: number }}
 */
function findCandidates(text, files = []) {
    const part = body => files.filter(f => f.body === body).map(f => f.text + '\n').join('');
    const code = mask(part(false) + text + '\n' + part(true)), body = BEGIN_DOC.exec(code)?.index ?? code.length; // files: [{ text, body }]
    const exprs = [], macros = [], seen = new Map();
    const add = (to, key, c) => { // a macro's argument count is the fewest seen: a group after a use may be text
        const old = seen.get(key);
        if (old) { if (c.args < old.args) old.args = c.args; } else { seen.set(key, c); to.push(c); }
    };
    for (const m of code.matchAll(CMD)) {
        const name = m[1], i = m.index + m[0].length;
        if (name === 'textcolor' || name === 'color' || name === 'colorbox') {
            const o = readOpt(code, i), a = o.inner === null && readArg(code, o.end), expr = a && a.inner.trim();
            if (expr && !/[\\{}#%]/.test(expr)) add(exprs, 'e' + expr, { kind: 'expr', expr, names: EXTENDED.test(expr) ? [] :
                expr.split('!').map(s => s.trim().replace(/^-+/, '')).filter(s => s && s !== '.' && !/^[\d.]+$/.test(s)) });
        } else if (m.index > body && !denied(name)) {
            let j = i, args = 0;
            for (let o; (o = readOpt(code, j)).inner !== null;) j = o.end; // \added[id=BH]{...}
            for (let a; args < 9 && (a = readArg(code, j));) { j = a.end; args++; }
            if (args) add(macros, 'm' + name, { kind: 'macro', name, args });
        }
    }
    const list = [...exprs, ...macros]; // expressions first: the limit drops unknown macros before them
    return { list: list.slice(0, LIMIT), truncated: Math.max(0, list.length - LIMIT) };
}

// \lcreport is protected, so packages that write their argument to a file (changes, todonotes) do not expand it.
// \lcend ends a paragraph in a scratch box: TeX quits after 100 errors without a paragraph end.
const DEFS = String.raw`\makeatletter
\def\lc@emit#1#2{\extractcolorspecs{#2}\lc@m\lc@s\convertcolorspec\lc@m\lc@s{rgb}\lc@rgb\typeout{LCRESULT #1=\lc@rgb}}
\protected\def\lcreport#1{\lc@emit{#1}{.}}
\newcommand\lcbegin[1]{\typeout{LCBEGIN #1}}
\newcommand\lcend[1]{\setbox0\vbox{\leavevmode\par}\typeout{LCEND #1}}
\newcommand\lcexpr[3]{\let\lc@ok\@firstoftwo
  \@for\lc@n:=#3\do{\expandafter\@ifundefinedcolor\expandafter{\lc@n}{\let\lc@ok\@secondoftwo}{}}%
  \lc@ok{\begingroup\colorlet{lc@tmp}{#2}\lc@emit{#1}{lc@tmp}\endgroup}{\typeout{LCRESULT #1=undefined}}}
\makeatother
`;

/** Probe document; candidate k gets id k + 1, id 0 is the text color. Blank lines stop runaway arguments. A macro gets
 * as many arguments as at its first use, each reporting; the first color that differs from the text color counts. */
function buildProbe(preamble, list) {
    const lines = list.map((c, k) => {
        const id = k + 1;
        return c.kind === 'macro'
            ? `\\lcbegin{${id}}\\setbox0\\hbox{\\${c.name}${`{\\lcreport{${id}}}`.repeat(c.args || 1)}}\\lcend{${id}}` // every argument reports
            : `\\lcbegin{${id}}\\lcexpr{${id}}{${c.expr}}{${c.names.join(',')}}\\lcend{${id}}`;
    });
    return preamble + '\n\\makeatletter\\@ifpackageloaded{xcolor}{}{\\RequirePackage{xcolor}}\\makeatother\n\\begin{document}\n' + DEFS +
        '\\lcbegin{0}\\lcreport{0}\\lcend{0}\n\n' + lines.map(l => l + '\n\n').join('') + '\\end{document}\n';
}

const sameColor = (a, b) => a.every((x, k) => Math.abs(x - b[k]) < 1e-4);

/**
 * Results per candidate: ok (with rgb), neutral (a macro that leaves the text color unchanged),
 * undefined (an expression naming an undefined color) or failed (with the first error line).
 * fatal: index of the candidate where the run stopped (later results null), -1 if the baseline never
 * finished, null if the run completed.
 */
function parseProbeLog(log, list) {
    const n = list.length, ids = Array.from({ length: n + 1 }, () => ({ ended: false, rgbs: [], undef: false, error: null }));
    let cur = -1;
    for (const line of log.split(/\r?\n/)) {
        let m;
        if ((m = /^LCBEGIN (\d+)$/.exec(line))) cur = +m[1];
        else if ((m = /^LCEND (\d+)$/.exec(line))) { if (ids[+m[1]]) ids[+m[1]].ended = true; cur = -1; }
        else if ((m = /^LCRESULT (\d+)=(.*)$/.exec(line.trim())) && ids[+m[1]]) {
            const v = m[2].split(',').map(Number);
            if (m[2] === 'undefined') ids[+m[1]].undef = true;
            else if (v.length === 3 && v.every(Number.isFinite)) ids[+m[1]].rgbs.push(v);
        } else if (cur >= 0 && ids[cur] && line.startsWith('!') && !ids[cur].error) ids[cur].error = line.trim();
    }
    if (!ids[0].ended || !ids[0].rgbs.length) return { baseline: null, results: Array(n).fill(null), fatal: -1, error: ids[0].error };
    const baseline = ids[0].rgbs[0];
    let fatal = null;
    const results = list.map((c, k) => {
        const r = ids[k + 1];
        if (fatal !== null) return null;
        if (!r.ended) { fatal = k; return { status: 'failed', error: r.error || 'fatal stop' }; }
        if (r.error) return { status: 'failed', error: r.error };
        if (r.undef) return { status: 'undefined' };
        if (!r.rgbs.length) return { status: 'failed', error: 'no result' };
        const rgb = r.rgbs.find(v => !sameColor(v, baseline));
        if (c.kind === 'macro' && !rgb) return { status: 'neutral' };
        return { status: 'ok', rgb: rgb ?? r.rgbs[0] };
    });
    return { baseline, results, fatal };
}

/**
 * Compile until every candidate has a result: after a fatal stop, rerun with the later candidates.
 * @param {(tex: string) => Promise<string>} compile returns the log
 */
async function runProbe(preamble, list, compile, maxRuns = 5) {
    const results = Array(list.length).fill(null);
    let baseline = null, runs = 0, start = 0, error = null;
    while (start < list.length && runs < maxRuns) {
        const part = list.slice(start), p = parseProbeLog(await compile(buildProbe(preamble, part)), part);
        runs++;
        if (p.fatal === -1) { error = p.error || 'the preamble did not compile'; break; }
        baseline = p.baseline;
        p.results.forEach((r, k) => { if (r) results[start + k] = r; });
        if (p.fatal === null) break;
        start += p.fatal + 1;
    }
    return { baseline, runs, error, results: results.map(r => r || { status: 'failed', error: error || 'not run' }) };
}

/** For the parser: colors of ok macros and expressions, the argument count of each ok macro, and the macros that
 * leave the text color unchanged (neutral), whose predicted color the parser drops. */
function toProbed(list, results) {
    const probed = { macros: {}, exprs: {}, arity: {}, neutral: {} };
    list.forEach((c, k) => {
        if (c.kind === 'macro' && results[k]?.status === 'neutral') probed.neutral[c.name] = true;
        if (results[k]?.status !== 'ok') return;
        if (c.kind === 'macro') { probed.macros[c.name] = results[k].rgb; probed.arity[c.name] = c.args || 1; }
        else probed.exprs[c.expr] = results[k].rgb;
    });
    return probed;
}

function cacheKey(engine, preamble, list) {
    const keys = list.map(c => c.kind === 'macro' ? 'm' + c.name : 'e' + c.expr).sort();
    return crypto.createHash('sha256').update(JSON.stringify([engine, preamble, keys])).digest('hex');
}

/**
 * Wrap fn(key, arg) so it runs at most once at a time per key; calls during a run queue one more run
 * with the latest arg. fn reports its own errors; a rejection only ends that run.
 */
function serialize(fn) {
    const running = new Map(), queued = new Map();
    const run = (key, arg) => {
        if (running.has(key)) { queued.set(key, arg); return running.get(key); }
        const p = Promise.resolve().then(() => fn(key, arg)).catch(() => {}).finally(() => {
            running.delete(key);
            if (queued.has(key)) { const next = queued.get(key); queued.delete(key); run(key, next); }
        });
        running.set(key, p);
        return p;
    };
    return run;
}

module.exports = { preambleOf, findCandidates, buildProbe, parseProbeLog, runProbe, toProbed, cacheKey, serialize, LIMIT };
