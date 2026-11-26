// @ts-check
// The TeX engine that compiles a root file, as LaTeX Workshop would choose it. Mirrors LaTeX Workshop
// 10.20.1 (out/src/compile/recipe.js: Recipe.create, findMagicComments, findConfig; plan.js: Plan.create)
// and latexmk (latexmk.pl, 9 March 2026: option parsing, rc files). Pure: the caller supplies settings,
// latexmkrc texts and a PATH lookup.
'use strict';

const ENGINES = ['pdflatex', 'lualatex', 'xelatex', 'latex', 'platex', 'uplatex'];
const LATEXMK_FLAGS = {
    '-pdf': 'pdflatex', '-pdflatex': 'pdflatex', '-pdflua': 'lualatex', '-lualatex': 'lualatex', '-pdflualatex': 'lualatex',
    '-pdfxe': 'xelatex', '-xelatex': 'xelatex', '-pdfxelatex': 'xelatex', '-pdfdvi': 'latex', '-pdfps': 'latex', '-dvi': 'latex', '-ps': 'latex',
};
const PDF_MODE = { 1: 'pdflatex', 2: 'latex', 3: 'latex', 4: 'lualatex', 5: 'xelatex' }; // ponytail: unset or 0 (dvi) runs latex; pdflatex is the same binary
const MODE_VAR = { 1: 'pdflatex', 4: 'lualatex', 5: 'xelatex' }; // rc variable holding the command for each mode
const PROGRAM = /^(?:%\s*!\s*T[Ee]X\s(?:TS-)?program\s*=\s*([^\s]*)$)/m; // copied from LaTeX Workshop
const RECIPE = /^(?:%\s*!\s*LW\srecipe\s*=\s*(.*)$)/m;

// The leading block of % lines (blank lines allowed), the only place LaTeX Workshop reads magic comments.
function leadingComments(text) {
    let out = '';
    for (const line of text.split('\n')) {
        if (!line.startsWith('%') && line.trim().length > 0) break;
        out += line + '\n';
    }
    return out;
}

const base = cmd => String(cmd || '').split(/[\\/]/).pop().replace(/\.exe$/i, '');

// Last value assigned to a latexmk rc variable; rcTexts in read order (user rc, then project rc).
function rcVar(rcTexts, name) {
    let v;
    const re = new RegExp(`^[ \\t]*\\$${name}\\s*=\\s*(.+?)\\s*;`, 'gm');
    for (const t of rcTexts) for (const m of t.matchAll(re)) v = m[1];
    return v;
}

// Engine run by a tool: an engine command itself, or latexmk's choice from its flags and rc files.
function toolEngine(tool, rcTexts) {
    const cmd = base(tool.command);
    if (cmd !== 'latexmk') return cmd;
    let flagged;
    for (const a of tool.args || []) flagged = LATEXMK_FLAGS[a] || flagged;
    if (flagged) return flagged;
    const mode = Number(rcVar(rcTexts, 'pdf_mode'));
    const custom = MODE_VAR[mode] && rcVar(rcTexts, MODE_VAR[mode]);
    const first = custom && custom.replace(/^['"]/, '').split(/\s+/)[0];
    return ENGINES.includes(first) ? first : PDF_MODE[mode] || 'pdflatex';
}

function findRecipe(lw, name) {
    if (!name && !['first', 'lastUsed'].includes(lw.recipeDefault)) name = lw.recipeDefault; // lastUsed is private to LaTeX Workshop
    return (name && lw.recipes.find(r => r.name === name)) || lw.recipes[0];
}

/**
 * @param {{ override?: string, rootText: string, rcTexts: string[], onPath: (name: string) => boolean,
 *   lw: null | { enableMagicComments: boolean, recipeDefault: string, recipes: any[], tools: any[], magicArgs?: string[] } }} inputs
 * @returns {{ engine: string | null, reason: string }}
 */
function resolveEngine({ override, rootText, lw, rcTexts, onPath }) {
    const head = leadingComments(rootText);
    const program = head.match(PROGRAM)?.[1], magicRecipe = head.match(RECIPE)?.[1];
    const magic = !lw || lw.enableMagicComments;
    let engine = 'pdflatex', reason = 'default';
    if (override) [engine, reason] = [override, 'setting latexColors.probe.engine'];
    else if (magic && program) [engine, reason] = [toolEngine({ command: program, args: lw?.magicArgs }, rcTexts), 'magic comment % !TEX program'];
    else if (lw?.recipes?.length) {
        const r = findRecipe(lw, magic ? magicRecipe : undefined);
        const tools = (r.tools || []).map(t => typeof t === 'string' ? lw.tools.find(c => c.name === t) : t).filter(Boolean);
        const tool = tools.find(t => [...ENGINES, 'latexmk'].includes(base(t.command)));
        if (tool) [engine, reason] = [toolEngine(tool, rcTexts), `LaTeX Workshop recipe "${r.name}", tool "${tool.name}"`];
        else reason = `LaTeX Workshop recipe "${r.name}" runs no TeX engine; default`;
    }
    if (!ENGINES.includes(engine)) return { engine: null, reason: `${engine} (${reason}) is not one of ${ENGINES.join(', ')}` };
    if (!onPath(engine)) return { engine: null, reason: `${engine} (${reason}) not found on PATH` };
    return { engine, reason };
}

module.exports = { resolveEngine, ENGINES };
