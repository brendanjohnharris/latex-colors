// The probe against a real pdflatex; skipped when pdflatex is not on PATH, except in CI.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { preambleOf, findCandidates, runProbe } = require('../src/probe');
const { findOnPath, compileProbe } = require('../src/probeRunner');
const { parseSpec } = require('../src/colors');

const PDFLATEX = findOnPath('pdflatex');

const DOC = String.raw`\documentclass{article}
\usepackage[dvipsnames]{xcolor}
\usepackage{soul}
\usepackage[normalem]{ulem}
\input{colors}
\definecolor{myorange}{RGB}{255,102,51}
\colorlet{soft}{myorange!50}
\newcommand{\ben}[1]{\textcolor{myorange}{[#1]}}
\newcommand{\benhl}[1]{{\sethlcolor{soft}\hl{#1}}}
\NewDocumentCommand{\xp}{m}{\textcolor{Maroon}{#1}}
\newcommand{\viafile}[1]{\textcolor{fromfile}{#1}}
\providecommand{\DIFadd}[1]{{\protect\color{blue}\uwave{#1}}}
\providecommand{\DIFdel}[1]{{\protect\color{red}\sout{#1}}}
\begin{document}
\ben{a} \benhl{b} \xp{c} \viafile{d} \DIFadd{e} \DIFdel{f} \textbf{g} \section{h}
\textcolor{soft!50!blue}{i} \textcolor{NoSuchColor}{j} {\color{Maroon} k}
\end{document}
`;

test('probe with pdflatex', { skip: !PDFLATEX && !process.env.CI && 'pdflatex not on PATH', timeout: 120000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-int-'));
    try {
        fs.writeFileSync(path.join(root, 'colors.tex'), '\\definecolor{fromfile}{HTML}{6EA0F9}\n'); // relative \input from the root folder
        const { list } = findCandidates(DOC);
        const r = await runProbe(preambleOf(DOC), list, tex => compileProbe({ engine: PDFLATEX, cwd: root, tex, timeout: 60 }));
        const got = Object.fromEntries(list.map((c, k) => [c.kind === 'macro' ? '\\' + c.name : c.expr, r.results[k]]));
        const near = (key, want) => {
            assert.strictEqual(got[key].status, 'ok', `${key}: ${JSON.stringify(got[key])}`);
            got[key].rgb.forEach((x, k) => assert.ok(Math.abs(x - want[k]) < 1e-3, `${key}: ${got[key].rgb} vs ${want}`));
        };
        assert.deepStrictEqual(r.baseline, [0, 0, 0]);
        near('\\ben', [1, 0.4, 0.2]);
        near('\\xp', parseSpec('cmyk', '0,0.87,0.68,0.32')); // dvipsnam.def Maroon, through the parser's cmyk conversion
        near('\\viafile', parseSpec('HTML', '6EA0F9'));
        near('\\DIFadd', [0, 0, 1]);
        near('\\DIFdel', [1, 0, 0]);
        near('soft!50!blue', [0.5, 0.35, 0.8]);
        near('Maroon', parseSpec('cmyk', '0,0.87,0.68,0.32'));
        assert.strictEqual(got['\\textbf'].status, 'neutral');
        assert.notStrictEqual(got['\\benhl'].status, 'ok'); // soul mangles the reporting command; the parser keeps the highlight
        assert.strictEqual(got['\\section'], undefined); // deny list
        assert.strictEqual(got.NoSuchColor.status, 'undefined');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
