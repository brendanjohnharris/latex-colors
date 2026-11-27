// node scripts/bench.js [--max ms] [file.tex ...]: median of 5 warm runs of scan plus marks on a generated
// 1 MB document (5000 paragraphs) and on any files given. With --max, exit 1 if the generated
// document's median exceeds it (CI).
'use strict';
const fs = require('node:fs');
const { scan } = require('../src/colors');
const { marks } = require('../src/marks');

function generated() {
    const pre = String.raw`\documentclass{article}
\usepackage[dvipsnames]{xcolor}
\usepackage{soul}
\definecolor{myorange}{RGB}{255,102,51}
\providecommand{\ben}[1]{\textcolor{myorange}{[#1]}}
\providecommand{\nao}[1]{{\color{red}[Nao: #1]}}
\providecommand{\benhl}[1]{{\sethlcolor{yellow}\hl{#1}}}
\begin{document}
`;
    const paras = [];
    for (let k = 0; k < 5000; k++)
        paras.push(`Paragraph ${k} with \\ben{a comment ${k}} and \\textcolor{Maroon}{colored text} then {\\color{blue} a group ` +
            `with \\emph{nested} words} and [[rewrite this]] or xxrephrasexx, ((a note)) ....expand.... and \\nao{see} \\benhl{lit} end.\n\n`);
    return pre + paras.join('') + '\\end{document}\n';
}

function median(text) { // after 8 untimed runs (the JIT settles within about 7): the editor rescans on every edit, so its code is warm
    for (let k = 0; k < 8; k++) { scan(text); marks(text); }
    const ms = [];
    for (let k = 0; k < 5; k++) { const t0 = performance.now(); scan(text); marks(text); ms.push(performance.now() - t0); }
    return ms.sort((a, b) => a - b)[2];
}

const args = process.argv.slice(2), at = args.indexOf('--max'), max = at >= 0 ? Number(args.splice(at, 2)[1]) : Infinity;
const doc = generated(), m = median(doc);
console.log(`generated: ${(doc.length / 1e6).toFixed(2)} MB, ${(doc.match(/\n\n/g) || []).length} paragraphs: ${m.toFixed(1)} ms`);
for (const f of args) { const t = fs.readFileSync(f, 'utf8'); console.log(`${f}: ${(t.length / 1e3).toFixed(0)} kB: ${median(t).toFixed(1)} ms`); }
if (m > max) { console.error(`generated document over ${max} ms`); process.exit(1); }
