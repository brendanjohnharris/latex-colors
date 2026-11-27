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
    assert.deepStrictEqual(spanOf(t, '\\todo{b}')?.style, { color: [1, 0, 0] }); // \\textbf{TODO:} does not cover #1 (review B7)
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
    assert.deepStrictEqual(extent('\\newenvironment{redbox}[1]{\\color{red}#1}{}\n\\begin{redbox}{x} typing\n\nplain', 'typing')?.[0],
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

// Interface (PLAN 5).
const { lift } = require('../../src/colors');
test('lift: mixes toward white until the luminance reaches the minimum', () => {
    const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]), lin = x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    assert.deepStrictEqual(lift([1, 1, 0], 0.15), [1, 1, 0]);
    const c = lift([0, 0, 0.5], 0.15);
    assert.ok(lum(c) >= 0.15 && lum(c) < 0.25, String(lum(c)));
    assert.deepStrictEqual(lift([0, 0, 0.5], 0), [0, 0, 0.5]);
});
test('spans record what made them and whether the probe supplied the color', () => {
    const t = '\\newcommand\\ben[1]{\\textcolor{red}{#1}}\\ben{a} \\todo{b} \\textcolor{Maroon}{c} {\\color{blue} d}';
    const got = spans(t, { macros: { todo: [0, 0, 1] }, exprs: { Maroon: [0.68, 0, 0] } }).map(s => [t.slice(s.start, s.whatEnd), s.origin]);
    assert.deepStrictEqual(got, [['\\textcolor{red}', 'parser'], ['\\ben', 'parser'], ['\\todo', 'probe'], ['\\textcolor{Maroon}', 'probe'], ['\\color{blue}', 'parser']]);
});
const { renderOptions } = require('../../src/colors');
test('renderOptions: lifts colors only when given a minimum luminance (dark theme with liftDarkColors)', () => {
    assert.deepStrictEqual(renderOptions({ color: [0, 0, 0.5] }, null), { color: '#000080', overviewRulerColor: '#000080' });
    assert.notStrictEqual(renderOptions({ color: [0, 0, 0.5] }, 0.35).color, '#000080');
    assert.strictEqual(renderOptions({ color: [0, 0, 0.5] }, 0).color, '#000080');
});
test('renderOptions: a background alone gets readable text; decorations and fonts pass through', () => {
    assert.deepStrictEqual(renderOptions({ bg: [1, 1, 0], deco: 'line-through', bold: true, italic: true }, 0.35),
        { backgroundColor: '#ffff00', color: '#000000', textDecoration: 'line-through', fontWeight: 'bold', fontStyle: 'italic', overviewRulerColor: '#000000' });
    assert.strictEqual(renderOptions({ bg: [0, 0, 0.3] }, null).color, '#ffffff');
});

// soul and ulem commands used directly in the text.
test('soul and ulem commands in the text are styled', () => {
    const t = '\\hl{a} \\texthl{b} \\st{c} \\sout{d} \\xout{e} \\uwave{f} \\ul{g} \\uline{h} \\dashuline{i} \\dotuline{j}';
    assert.deepStrictEqual(scan(t).map(s => [t.slice(s.start, s.end), s.style]), [
        ['\\hl{a}', { bg: [1, 1, 0] }], ['\\texthl{b}', { bg: [1, 1, 0] }], ['\\st{c}', { deco: 'line-through' }],
        ['\\sout{d}', { deco: 'line-through' }], ['\\xout{e}', { deco: 'line-through' }], ['\\uwave{f}', { deco: 'underline wavy' }],
        ['\\ul{g}', { deco: 'underline' }], ['\\uline{h}', { deco: 'underline' }], ['\\dashuline{i}', { deco: 'underline dashed' }],
        ['\\dotuline{j}', { deco: 'underline dotted' }]]);
});
test('\\sethlcolor colors the \\hl calls after it, within its group', () => {
    const t = '{\\sethlcolor{cyan}\\hl{a}} \\hl{b} \\sethlcolor{red!50}\\hl{c}';
    assert.deepStrictEqual(['\\hl{a}', '\\hl{b}', '\\hl{c}'].map(s => spanOf(t, s)?.style), [{ bg: [0, 1, 1] }, { bg: [1, 1, 0] }, { bg: [1, 0.5, 0.5] }]);
});
test('a decoration inside a colored span keeps both', () => {
    const t = '\\textcolor{blue}{x \\sout{y} z}';
    assert.deepStrictEqual(scan(t).find(s => t.slice(s.start, s.end) === '\\sout{y}')?.style, { color: [0, 0, 1], deco: 'line-through' });
});
test('a user definition replaces the built-in style', () =>
    assert.ok(!spanOf('\\renewcommand\\hl[1]{#1}\\hl{a}', '\\hl{a}')));

// Review round 2: parser.
const styleOf = (t, s) => scan(t).find(x => t.slice(x.start, x.end).includes(s))?.style;
test('font-only macros are not colors (review B4)', () => {
    assert.deepStrictEqual(colored('\\newcommand{\\vect}[1]{\\textbf{#1}}\\newcommand{\\sp}[1]{\\emph{#1}}\\vect{x} \\sp{y}'), []);
    assert.deepStrictEqual(styleOf('\\newcommand\\bx[1]{\\textcolor{red}{\\textbf{#1}}}\\bx{z}', 'z}'), { color: [1, 0, 0], bold: true });
});
test('an argument outside every styled part of the body is not colored (review B4)', () =>
    assert.ok(!scan('\\newcommand{\\flag}[1]{\\textcolor{red}{[FLAG]} #1}\\flag{x}').some(s => s.start > 40)));
test('an environment colors its body only if its begin code leaves a color open (review B4)', () => {
    assert.ok(!styleOf('\\newenvironment{rem}[1]{\\textbf{#1:}}{}\\begin{rem}{A} body\\end{rem}', 'body'));
    assert.ok(!styleOf('\\newenvironment{rb}[1]{\\textcolor{red}{#1}}{}\\begin{rb}{A} body\\end{rb}', 'body'));
    assert.deepStrictEqual(styleOf('\\newenvironment{rc}[1]{\\color{red}#1:}{}\\begin{rc}{A} body\\end{rc}', 'body'), { color: [1, 0, 0] });
});
test('the style at the target argument: inner macros win, fixed text does not bleed, per-argument styles (review B7)', () => {
    assert.deepStrictEqual(styleOf('\\newcommand{\\inner}[1]{\\textcolor{red}{#1}}\\newcommand{\\outerc}[1]{\\textcolor{blue}{\\inner{#1}}}\\outerc{x}', '\\outerc{x}'), { color: [1, 0, 0] });
    assert.deepStrictEqual(styleOf('\\newcommand\\early[1]{\\textcolor{red}{#1}}\\newcommand\\todo[1]{\\early{\\textbf{TODO:} #1}}\\todo{x}', '\\todo{x}'), { color: [1, 0, 0] });
    assert.deepStrictEqual(styleOf('\\newcommand{\\chg}[2]{\\textcolor{red}{\\sout{#1}}\\textcolor{blue}{#2}}\\chg{old}{new}', 'new}'), { color: [0, 0, 1] });
});
test('a star after a macro without one is its argument (review B5)', () =>
    assert.ok(!scan('\\newcommand\\ben[1]{\\textcolor{red}{#1}}\n\\ben*{text}').some(s => s.start > 38)));
test('% inside \\url, \\href, \\nolinkurl, \\path, \\lstinline, \\mintinline and luacode is not a comment (review B6)', () => {
    const t = '{\\color{red} See \\url{https://e.org/%C3%89} here} plain.\nMore.';
    assert.deepStrictEqual(colored(t), ['\\color{red} See \\url{https://e.org/%C3%89} here']);
    assert.deepStrictEqual(colored('\\href{https://a.b/%20}{\\textcolor{blue}{link}} x'), ['\\textcolor{blue}{link}']);
    for (const s of ['\\nolinkurl{a%b}', '\\path{a%b}', '\\lstinline|a%{|', '\\lstinline[language=TeX]{a%b}', '\\mintinline{tex}{a%b}', '\\mintinline{tex}|a%{|',
        '\\begin{luacode}\nx = 5 % 2\n\\end{luacode}', '\\begin{luacode*}\nx = 5 % 2\n\\end{luacode*}'])
        assert.deepStrictEqual(colored(`{\\color{red} ${s} after} plain`).map(x => x.endsWith('after')), [true], s);
});
test('xcolor expressions as xcolor evaluates them (review B8)', () => {
    for (const [e, want] of [['--red', [1, 0, 0]], ['red!50!-blue', [1, 0.5, 0]], ['-red!50!blue', [0.5, 1, 0.5]], ['--red!50!blue', [0.5, 0, 0.5]],
        ['red!150', [1, 0, 0]], ['red!-20', [1, 1, 1]], ['red!50!blue!50', [0.75, 0.5, 0.75]]])
        assert.deepStrictEqual(parseExpr(e, BASE), want, e);
    assert.strictEqual(parseExpr('red!', BASE), null); // mid-typing: no white flash
    assert.strictEqual(parseExpr('red!50!', BASE), null);
});
test('\\def with a space before its parameters; \\gdef, \\edef and \\xdef (review I2)', () => {
    for (const d of ['def', 'gdef', 'edef', 'xdef'])
        assert.deepStrictEqual(styleOf(`\\${d}\\foo #1{\\textcolor{red}{#1}}\\foo{x}`, '\\foo{x}'), { color: [1, 0, 0] }, d);
});
test('a repeated xcolor option moves to its latest position (review I2)', () =>
    close(colorIn('\\documentclass[svgnames]{article}\\PassOptionsToPackage{dvipsnames}{xcolor}\\usepackage[svgnames]{xcolor}\\textcolor{Maroon}{x}', 'x}'), [0.5, 0, 0]));
test('many ungrouped \\color switches scan in linear time', () => {
    const t = Array.from({ length: 4000 }, (_, k) => `\\color{red} para ${k} with some words in it.\n`).join('');
    const t0 = performance.now(); scan(t); scan(t);
    assert.ok((performance.now() - t0) / 2 < 500, `${((performance.now() - t0) / 2).toFixed(0)} ms`); // quadratic took 5.6 s
});
test('a macro the probe found neutral keeps only its highlight or line (review B4)', () => {
    const t = '\\newcommand\\fake[1]{\\textcolor{red}{#1}}\\newcommand\\cut[1]{\\textcolor{red}{\\sout{#1}}}\\fake{x} \\cut{y}';
    const probed = { macros: {}, exprs: {}, neutral: { fake: true, cut: true } };
    assert.ok(!scan(t, probed).some(s => t.slice(s.start, s.end) === '\\fake{x}'));
    assert.deepStrictEqual(scan(t, probed).find(s => t.slice(s.start, s.end) === '\\cut{y}')?.style, { deco: 'line-through' });
});
test('a macro known only to the probe spans its optional and all probed mandatory arguments (review B5)', () => {
    const t = '\\added[id=BH]{a} \\replaced{new}{old} rest';
    const probed = { macros: { added: [0, 0, 1], replaced: [0, 0, 1] }, exprs: {}, arity: { added: 1, replaced: 2 } };
    assert.deepStrictEqual(colored(t, probed), ['\\added[id=BH]{a}', '\\replaced{new}{old}']);
});

// Review round 2: rendering and hover.
const { luminance, hoverMarkdown } = require('../../src/colors');
test('luminance is WCAG relative luminance, from linearized sRGB (review B9)', () => {
    assert.ok(Math.abs(luminance([0.376, 0.376, 0.376]) - 0.117) < 0.002);
    assert.deepStrictEqual([luminance([0, 0, 0]), luminance([1, 1, 1])], [0, 1]);
});
test('text on a highlight or box keeps its color on dark themes (review B9)', () =>
    assert.strictEqual(renderOptions({ color: [0, 0, 0], bg: [1, 1, 0] }, 0.15).color, '#000000'));
test('hoverMarkdown: the command sits in a code span that its own backticks cannot close; no raw HTML from the source (review B13)', () => {
    const md = hoverMarkdown('\\foo[``a`` <b>x</b>]{c}', { color: [1, 0, 0] }, '#ff0000', 'parser');
    assert.match(md, /^``` \\foo\[``a`` <b>x<\/b>\]\{c\} ``` /);
    assert.strictEqual((md.match(/<span/g) || []).length, 1); // the swatch only
});
test('hoverMarkdown: a lifted color says what is shown', () =>
    assert.match(hoverMarkdown('\\ben', { color: [0, 0, 0.5] }, '#6b6bc0', 'probe'), /color #000080, shown as #6b6bc0 \(from the probe compile\)/));
test('TikZ \\path is not a url.sty \\path (review 2, item 5)', () =>
    assert.deepStrictEqual(colored('\\path (0,0) node {\\textcolor{red}{x}} (1,1); \\path[draw] (0,0) -- (1,1);'), ['\\textcolor{red}{x}']));
