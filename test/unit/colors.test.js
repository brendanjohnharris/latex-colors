'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scan, spans, parseExpr, parseSpec, BASE } = require('../../src/colors');

const doc = String.raw`
\definecolor{myorange}{RGB}{255,102,51}
\colorlet{soft}{myorange!50}
\providecommand{\ben}[1]{\textcolor{myorange}{[#1]}}
\providecommand{\bencut}[1]{\textcolor{red}{\sout{#1}}}
\DeclareRobustCommand{\nao}[1]{{\normalfont\color{red}[Nao: #1]}}
\providecommand{\benhl}[1]{{\sethlcolor{soft}\hl{#1}}}
Text \ben{a {b {c}} d} and \textcolor{blue}{x \textcolor{red}{innerw} outerw}.
{\color{teal} switched \textbf{group}} after. % \ben{commented out}
\nao{see \url{https://x.org/a_b}} and 50\% \textcolor{nosuch}{skip} \bencut{gone} \benhl{lit}.
`;
const seg = scan(doc);
const at = s => seg.find(x => x.start <= doc.indexOf(s) && x.end >= doc.indexOf(s) + s.length);
const rgb = c => c && c.map(x => Math.round(255 * x)).join(',');

test('mix expression', () => assert.deepStrictEqual(parseExpr('red!25!blue', BASE), [.25, 0, .75]));
test('macro color across nested braces', () => assert.strictEqual(rgb(at('a {b {c}} d').style.color), '255,102,51'));
test('inner span wins', () => {
    assert.strictEqual(rgb(at('innerw').style.color), '255,0,0');
    assert.strictEqual(rgb(at('outerw').style.color), '0,0,255');
});
test('\\color runs to the end of its group', () => {
    assert.strictEqual(rgb(at('switched').style.color), '0,128,128');
    assert.ok(!at('after'));
});
test('comments are skipped', () =>
    assert.ok(!spans(doc).some(s => doc.slice(s.start, s.end).includes('commented out'))));
test('\\url inside a macro argument', () => assert.ok(at('https://x.org/a_b')));
test('unknown color ignored', () => assert.ok(!at('skip')));
test('strikethrough from \\sout', () => assert.strictEqual(at('gone').style.deco, 'line-through'));
test('\\sethlcolor via \\colorlet mix', () => assert.strictEqual(rgb(at('lit').style.bg), '255,179,153'));
// xcolor.sty v3.02, \XC@cnv@cmyk@cmy and \XC@calcT: cmy = min(1, cmy + k), then rgb = 1 - cmy.
test('cmyk converts as xcolor does', () =>
    assert.deepStrictEqual(parseSpec('cmyk', '0.25,0,0.75,0.5').map(x => +x.toFixed(6)), [0.25, 0.5, 0]));
test('names that are Object.prototype keys are unknown colors and macros', () =>
    assert.deepStrictEqual(scan('\\textcolor{constructor}{a} \\color{__proto__} \\toString{b} \\hasOwnProperty{c}'), []));

// Merging probe results (PLAN 2.7).
const PDOC = String.raw`\definecolor{myorange}{RGB}{255,102,51}
\providecommand{\bencut}[1]{\textcolor{red}{\sout{#1}}}
\providecommand{\ben}[1]{\textcolor{myorange}{#1}}
\bencut{a} \todo{b} \textcolor{Maroon}{c} {\color{ Maroon }d} \colorbox{Maroon}{e} \ben{f} \textcolor[rgb]{0,0,1}{Maroon} \constructor{h}`;
const PROBED = JSON.parse('{"macros":{"bencut":[0.5,0,0],"todo":[0,0,1]},"exprs":{"Maroon":[0.68,0,0.17]}}');
const pseg = scan(PDOC, PROBED);
const pat = s => pseg.find(x => x.start <= PDOC.lastIndexOf(s) && x.end >= PDOC.lastIndexOf(s) + s.length);

test('probe color replaces the predicted color; decoration stays', () =>
    assert.deepStrictEqual(pat('{a}').style, { color: [0.5, 0, 0], deco: 'line-through' }));
test('macro unknown to the parser, colored by the probe: command through first argument', () => {
    const s = pat('\\todo{b}');
    assert.deepStrictEqual([PDOC.slice(s.start, s.end), s.style], ['\\todo{b}', { color: [0, 0, 1] }]);
});
test('probed expressions in \\textcolor, \\color (trimmed) and \\colorbox', () => {
    assert.deepStrictEqual(pat('{c}').style, { color: [0.68, 0, 0.17] });
    assert.deepStrictEqual(pat('Maroon }d').style, { color: [0.68, 0, 0.17] });
    assert.deepStrictEqual(pat('{e}').style, { bg: [0.68, 0, 0.17] });
});
test('macros without a probe result keep the prediction', () => assert.strictEqual(rgb(pat('{f}').style.color), '255,102,51'));
test('an explicit model is never looked up', () => assert.strictEqual(rgb(pat('{Maroon}').style.color), '0,0,255'));
test('probe results parsed from JSON ignore prototype keys', () => assert.ok(!pat('{h}')));

// Scanner (PLAN 3.4).
const colored = (t, probed) => scan(t, probed).map(s => t.slice(s.start, s.end));
test('mask: \\verb and \\verb* hide their contents, including %', () =>
    assert.deepStrictEqual(colored('\\verb|\\textcolor{red}{a}| \\verb*+%\\textcolor{blue}{b}+ \\textcolor{teal}{c}'), ['\\textcolor{teal}{c}']));
test('mask: verbatim-like environments hide their contents', () => {
    for (const env of ['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment'])
        assert.deepStrictEqual(colored(`\\begin{${env}}\n\\textcolor{red}{a} % x\n\\end{${env}}\n\\textcolor{teal}{c}`), ['\\textcolor{teal}{c}'], env);
});
test('mask: a % comment hides \\verb', () =>
    assert.deepStrictEqual(colored('% \\verb|\n\\textcolor{teal}{c}|'), ['\\textcolor{teal}{c}']));
test('\\color inside an environment runs to its \\end, past nested environments', () =>
    assert.deepStrictEqual(colored('\\begin{quote}\\color{red} a \\begin{itemize}\\item b\\end{itemize} c\\end{quote} d'),
        ['\\color{red} a \\begin{itemize}\\item b\\end{itemize} c']));
test('\\color in a group that never closes stops at the next blank line', () =>
    assert.deepStrictEqual(colored('x {\\color{red} typing\nmore\n\nplain'), ['\\color{red} typing\nmore']));
test('\\color outside any group still runs to the end of the document', () =>
    assert.deepStrictEqual(colored('x \\color{red} a\n\nb'), ['\\color{red} a\n\nb']));
test('an unclosed macro argument gives no span', () =>
    assert.deepStrictEqual(colored('\\newcommand{\\na}[1]{\\textcolor{red}{#1}}\n\\na{typing'), ['\\textcolor{red}{#1}']));
test('\\endcsname is not an environment end; \\begingroup...\\endgroup is a group', () => {
    assert.deepStrictEqual(colored('{\\color{red} a \\csname relax\\endcsname b} c'), ['\\color{red} a \\csname relax\\endcsname b']);
    assert.deepStrictEqual(colored('\\begingroup\\color{red} a\\endgroup b'), ['\\color{red} a']);
});

// Color models and name sets (PLAN 3.2); expected values from xcolor 3.02 under pdflatex.
const close = (got, want) => assert.ok(got && got.every((x, k) => Math.abs(x - want[k]) < 1e-3), `${got} vs ${want}`);
const colorIn = (t, s) => { const x = scan(t).find(x => t.slice(x.start, x.end).includes(s)); return x && x.style.color; };
test('models hsb, Hsb, HSB', () => {
    close(parseSpec('hsb', '0.1,0.7,0.9'), [0.9, 0.648, 0.27]);
    close(parseSpec('hsb', '0.75,0.4,0.6'), [0.48, 0.36, 0.6]);
    close(parseSpec('Hsb', '200,0.5,0.8'), [0.4, 0.66663, 0.8]);
    close(parseSpec('HSB', '40,200,180'), [0.74998, 0.75, 0.125]);
});
test('model named', () =>
    close(colorIn('\\usepackage[dvipsnames]{xcolor}\\definecolor{e}{named}{Maroon}\\textcolor{e}{x}', 'x}'), [0.68, 0, 0]));
test('\\definecolorset with head and tail', () => {
    const t = '\\definecolorset{rgb}{x}{y}{one,1,0,0;two,0,0.5,1}\\textcolor{xoney}{a}\\textcolor{xtwoy}{b}';
    close(colorIn(t, 'a}'), [1, 0, 0]);
    close(colorIn(t, 'b}'), [0, 0.5, 1]);
});
test('name sets from xcolor options in \\usepackage, \\PassOptionsToPackage and \\documentclass', () => {
    close(colorIn('\\usepackage[table,dvipsnames]{xcolor}\\textcolor{Maroon}{x}', 'x}'), [0.68, 0, 0]);
    close(colorIn('\\PassOptionsToPackage{svgnames}{xcolor}\\textcolor{AliceBlue}{x}', 'x}'), [0.94, 0.972, 1]);
    close(colorIn('\\documentclass[11pt,x11names]{article}\\textcolor{AntiqueWhite4}{x}', 'x}'), [0.545, 0.512, 0.47]);
});
test('name sets are off without the option, and with the starred option', () => {
    assert.strictEqual(colorIn('\\usepackage{xcolor}\\textcolor{Maroon}{x}', 'x}'), undefined);
    assert.strictEqual(colorIn('\\usepackage[dvipsnames*]{xcolor}\\textcolor{Maroon}{x}', 'x}'), undefined);
});
test('names.json holds the three sets', () => {
    const names = require('../../src/names.json');
    assert.deepStrictEqual(Object.keys(names.sets), ['dvipsnames', 'svgnames', 'x11names']);
    assert.strictEqual(Object.keys(names.sets.dvipsnames).length, 68);
    assert.ok(Object.keys(names.sets.svgnames).length > 140 && Object.keys(names.sets.x11names).length > 300);
});
test('name sets apply in option order; the last one wins, as in xcolor', () => {
    close(colorIn('\\usepackage[dvipsnames,svgnames]{xcolor}\\textcolor{Maroon}{x}', 'x}'), [0.5, 0, 0]);
    close(colorIn('\\usepackage[svgnames,dvipsnames]{xcolor}\\textcolor{Maroon}{x}', 'x}'), [0.68, 0, 0]);
    close(colorIn('\\documentclass[dvipsnames]{article}\\usepackage[svgnames]{xcolor}\\textcolor{Maroon}{x}', 'x}'), [0.5, 0, 0]);
});

// Macro definitions (PLAN 3.3).
const extent = (t, s) => { const x = scan(t).find(x => t.slice(x.start, x.end).includes(s)); return x && [t.slice(x.start, x.end), x.style]; };
const spanOf = (t, s) => spans(t).find(x => t.slice(x.start, x.end) === s);
const RED = { color: [1, 0, 0] }, BLUE = { color: [0, 0, 1] };
test('xparse: m, s, o, O{...}, t<char> argument specs', () => {
    const t = String.raw`\NewDocumentCommand{\xa}{m}{\textcolor{red}{#1}}
\DeclareDocumentCommand\xb{s o m}{\textcolor{blue}{#3}}
\RenewDocumentCommand\xc{O{x}m}{\textcolor{red}{#2}}
\ProvideDocumentCommand\xd{t+m}{\textcolor{red}{#2}}
\xa{a} \xb*[o]{b} \xb{bb} \xc[o]{c} \xd+{d}`;
    for (const [s, style] of [['\\xa{a}', RED], ['\\xb*[o]{b}', BLUE], ['\\xb{bb}', BLUE], ['\\xc[o]{c}', RED], ['\\xd+{d}', RED]])
        assert.deepStrictEqual(spanOf(t, s)?.style, style, s);
});
test('xparse: other argument specs are skipped', () =>
    assert.deepStrictEqual(colored('\\NewDocumentCommand\\xe{r()}{\\textcolor{red}{#1}}\n\\xe(a)'), ['\\textcolor{red}{#1}']));
test('\\def with undelimited parameters; delimited ones skipped', () => {
    const t = '\\def\\da#1{\\textcolor{red}{#1}}\\def\\db#1.{\\textcolor{red}{#1}}\\def\\dc#1#2{\\textcolor{blue}{#2}}\n\\da{a} \\db b. \\dc{c}{cc}';
    assert.deepStrictEqual(spanOf(t, '\\da{a}')?.style, RED);
    assert.deepStrictEqual(spanOf(t, '\\dc{c}{cc}')?.style, BLUE);
    assert.ok(!scan(t).some(x => t.slice(x.start, x.end).includes('b.')));
});
test('\\let copies a style', () => {
    const t = '\\newcommand\\ben[1]{\\textcolor{red}{#1}}\\let\\lb\\ben \\let\\lc=\\ben\n\\lb{a} \\lc{b}';
    assert.deepStrictEqual(spanOf(t, '\\lb{a}')?.style, RED);
    assert.deepStrictEqual(spanOf(t, '\\lc{b}')?.style, RED);
});
test('macros built on macros, in any order; cycles end', () => {
    const t = String.raw`\providecommand\later[1]{\early{#1}}
\newcommand\early[1]{\textcolor{red}{#1}}
\newcommand\todo[1]{\early{\textbf{TODO:} #1}}
\newcommand\ca[1]{\cb{#1}}\newcommand\cb[1]{\ca{#1}}
\later{a} \todo{b} \ca{c}`;
    assert.deepStrictEqual(spanOf(t, '\\later{a}')?.style, RED);
    assert.deepStrictEqual(spanOf(t, '\\todo{b}')?.style, { color: [1, 0, 0], bold: true });
    assert.ok(!spanOf(t, '\\ca{c}'));
});
test('multi-argument macros color through the argument the body styles', () => {
    const t = String.raw`\newcommand\note[2]{#1: \textcolor{red}{#2}}
\newcommand\rep[2][Ben]{\textcolor{blue}{[#1] #2}}
\note{Ben}{text} \rep[Nao]{x} \rep{y} \note{Ben}`;
    assert.deepStrictEqual(spanOf(t, '\\note{Ben}{text}')?.style, RED);
    assert.deepStrictEqual(spanOf(t, '\\rep[Nao]{x}')?.style, BLUE);
    assert.deepStrictEqual(spanOf(t, '\\rep{y}')?.style, BLUE);
    assert.ok(!spans(t).some(x => t.slice(x.start, x.end) === '\\note{Ben}'));
});
test('environments whose begin code sets a color color their body, counting nesting', () => {
    const t = '\\newenvironment{redbox}{\\color{red}}{}\n\\begin{redbox} a \\begin{redbox} b \\end{redbox} c \\end{redbox} d';
    assert.deepStrictEqual(extent(t, ' c '), ['\\begin{redbox} a \\begin{redbox} b \\end{redbox} c \\end{redbox}', RED]);
    assert.ok(!extent(t, ' d'));
});
test('an unclosed colored environment stops at the next blank line', () =>
    assert.deepStrictEqual(extent('\\newenvironment{redbox}[1]{\\textcolor{red}{#1}}{}\n\\begin{redbox}{x} typing\n\nplain', 'typing')?.[0],
        '\\begin{redbox}{x} typing'));
test('ulem \\dashuline and \\dotuline', () => {
    const t = '\\newcommand\\dsh[1]{\\dashuline{#1}}\\newcommand\\dtt[1]{\\dotuline{#1}}\n\\dsh{a} \\dtt{b}';
    assert.deepStrictEqual(spanOf(t, '\\dsh{a}')?.style, { deco: 'underline dashed' });
    assert.deepStrictEqual(spanOf(t, '\\dtt{b}')?.style, { deco: 'underline dotted' });
});
test('the name being defined is not a use site', () =>
    assert.deepStrictEqual(colored('\\NewDocumentCommand\\xb{s o m}{\\textcolor{blue}{#3}}\\def\\dz#1{\\xb{#1}}'),
        ['\\textcolor{blue}{#3}', '\\xb{#1}']));

// Multi-file documents (PLAN 3.1): definitions from the document's other files.
test('prelude supplies definitions; spans stay in the text\'s coordinates', () => {
    const t = 'x \\ben{a} \\textcolor{deepc}{b}', pre = '\\newcommand\\ben[1]{\\textcolor{red}{#1}} % \\definecolor{no}{rgb}{0,0,0}\n\\definecolor{deepc}{rgb}{0,0,1}';
    assert.deepStrictEqual(scan(t, undefined, pre).map(s => [t.slice(s.start, s.end), s.style]),
        [['\\ben{a}', { color: [1, 0, 0] }], ['\\textcolor{deepc}{b}', { color: [0, 0, 1] }]]);
});
