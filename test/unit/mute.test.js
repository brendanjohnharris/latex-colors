'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { muted } = require('../../src/mute');

const parts = t => muted(t).map(r => t.slice(r.start, r.end));

test('a command and its braces are muted; the text it prints is not', () =>
    assert.deepStrictEqual(parts('\\section*{Supplementary Material}'), ['\\section*{', '}']));

test('the figure from the request', () => {
    const t = String.raw`\begin{figure}[!htbp]
\centering
\includegraphics[width=0.7\textwidth]{figures/fig1.png}
\caption{The slow axis of EEG bandpower for:
(a) the ketamine (balanced accuracy 0.286, $p = 0.8$);
\uline{(d) propofol subjects (0.875, $p = 0.010$); drawn faint.}
\nao{To check with Katja.}
Shaded bands the 30\,s response windows.}
\label{fig:slow_axis_pilot}
\end{figure}`;
    assert.deepStrictEqual(parts(t), ['\\begin{figure}[!htbp]', '\\centering', '\\includegraphics[width=0.7\\textwidth]{figures/fig1.png}',
        '\\caption{', '\\uline{', '}', '\\nao{', '}', '\\,', '}', '\\label{fig:slow_axis_pilot}', '\\end{figure}']);
});

test('math is left alone; its environments\' \\begin and \\end are muted', () =>
    assert.deepStrictEqual(parts('$\\alpha + {x}$ \\(\\beta\\) \\[\\gamma\\] $$\\delta$$ \\begin{equation}\\epsilon{}\\end{equation}'),
        ['\\begin{equation}', '\\end{equation}']));

test('glyph commands and escaped characters print, so they are not muted', () =>
    assert.deepStrictEqual(parts('\\LaTeX{} \\ldots 50\\% \\& \\{x\\} \\_'), ['{}']));

test('arguments that never print are muted whole: colors, references, citations, sizes', () => {
    assert.deepStrictEqual(parts('\\textcolor{red}{text} \\colorbox[rgb]{1,0,0}{box}'), ['\\textcolor{red}{', '}', '\\colorbox[rgb]{1,0,0}{', '}']);
    assert.deepStrictEqual(parts('see \\cref{fig:a} and \\citep[p.~2]{key}; \\vspace*{2pt} \\href{https://x.org}{link}'),
        ['\\cref{fig:a}', '\\citep[p.~2]{key}', '\\vspace*{2pt}', '\\href{https://x.org}{', '}']);
    assert.deepStrictEqual(parts('\\begin{tabular}{ll}a & b \\\\[2pt] c & d\\end{tabular}'),
        ['\\begin{tabular}{ll}', '&', '\\\\[2pt]', '&', '\\end{tabular}']);
});

test('definitions are muted whole', () =>
    assert.deepStrictEqual(parts('\\newcommand{\\ben}[1]{\\textcolor{red}{#1}}\n\\def\\x#1{y}\n\\NewDocumentCommand\\z{m}{#1}\n\\definecolor{c}{RGB}{1,2,3}'),
        ['\\newcommand{\\ben}[1]{\\textcolor{red}{#1}}', '\\def\\x#1{y}', '\\NewDocumentCommand\\z{m}{#1}', '\\definecolor{c}{RGB}{1,2,3}']));

test('comments and verbatim are left to the theme', () =>
    assert.deepStrictEqual(parts('% \\section{x}\n\\verb|\\y{z}| \\begin{verbatim}\n\\q{}\n\\end{verbatim}'), ['\\begin{verbatim}', '\\end{verbatim}']));
