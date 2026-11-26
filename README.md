# LaTeX Colors

A VS Code extension that colors LaTeX source the way xcolor colors the PDF, and highlights editorial marks in LaTeX, Markdown and plain text.

## Colors

- `\textcolor{c}{...}`, `{\color{c} ...}` (to the end of the group or environment) and `\colorbox{c}{...}`.
- Macros defined with `\newcommand`, `\renewcommand`, `\providecommand`, `\DeclareRobustCommand`, xparse's `\NewDocumentCommand` and relatives (argument types `m`, `o`, `O{...}`, `s`, `t`), `\def` (undelimited parameters) or `\let`, whose body uses those commands, soul's `\hl` (with `\sethlcolor`), ulem's `\sout`, `\uwave`, `\uline`, `\dashuline` and `\dotuline`, or another such macro. A comment macro such as `\providecommand{\ben}[1]{\textcolor{myorange}{[#1]}}` colors every `\ben{...}`; a macro with several arguments colors through the argument its body styles.
- Environments defined with `\newenvironment` whose begin code sets a color.
- Colors: xcolor's base names; the `dvipsnames`, `svgnames` and `x11names` sets when xcolor is loaded with those options (in `\usepackage`, `\PassOptionsToPackage` or `\documentclass`); and every `\definecolor`, `\providecolor`, `\colorlet` and `\definecolorset` (models `rgb`, `RGB`, `HTML`, `cmyk`, `cmy`, `gray`, `hsb`, `Hsb`, `HSB`, `named`), including expressions such as `red!50!blue`.
- latexdiff output: `\DIFadd` and `\DIFdel` are defined in the diff's preamble, so they color like any other macro.
- Multi-file documents: definitions are read from the root file and every local file it pulls in (`\input`, `\include`, `\subfile`, `\import`, and `\usepackage` of a `.sty` in the root's folder). The root is found from a `% !TEX root` magic comment, the `subfiles` class option, `\documentclass` in the file itself, or the workspace file that pulls the file in.

Braces are matched to any depth; `%` comments, `\verb` and the verbatim, `Verbatim`, `lstlisting`, `minted` and `comment` environments are skipped. Where colored spans nest, the inner one wins.

## Exact colors from LaTeX

The colors above are predicted from the source on every keystroke. After each save, a probe compile of the document's root file asks LaTeX for the true colors: it compiles the preamble with a generated body that typesets each command used in the document, and each color expression given to `\textcolor`, `\color` or `\colorbox`, around a command that reports the current color. Those colors replace the predictions, so colors computed by macros, package commands (`todonotes`, `changes`) and any xcolor expression are exact. Extents, highlights and strikethroughs still come from the parser.

- The engine is the one LaTeX Workshop would use (magic comments, the default recipe, latexmk flags and `latexmkrc`), else a `% !TEX program` magic comment, else `pdflatex`; `latexColors.probe.engine` overrides it. The engine must be on `PATH`.
- The probe runs the preamble's code, as compiling the document does, with shell escape off, from the root's folder, writing only to a temporary directory that is deleted afterwards, and is stopped after `latexColors.probe.timeout` seconds. The probe does not run in untrusted workspaces.
- Results are cached by engine, preamble and the set of commands, so reopening a file does not recompile. The **LaTeX Colors** output channel lists each run: engine, command line, time, and every command that failed or color that is undefined.

## Editorial marks

| Mark | Meaning | Color |
|---|---|---|
| `[[text]]` | rewrite | `#ffa829` |
| `xxtextxx` | rephrase; a bare `xxx` is a placeholder | `#f93d53` |
| `((text))` | note to the writer | `#b97ad7` |
| `....text....` | expand, about one dot per word | `#88bd69` |

## Settings

| Setting | Default | |
|---|---|---|
| `latexColors.marks.enabled` | `true` | Highlight editorial marks |
| `latexColors.liftDarkColors` | `true` | On dark themes, lighten colors too dark to read |
| `latexColors.probe.enabled` | `true` | Run the probe compile after each save |
| `latexColors.probe.engine` | `""` | Engine for the probe; empty chooses as above |
| `latexColors.probe.timeout` | `30` | Seconds before a probe compile is stopped |

Requires VS Code 1.145 or later.

## Install

```sh
npx @vscode/vsce package
code --install-extension latex-colors-*.vsix
```

## Development

```sh
npm install
npm test                         # unit, fixture and fuzz tests
npm run test:update              # rewrite fixture snapshots (test/fixtures/*.spans.json); review the diff
npm run typecheck
xvfb-run -a npm run test:vscode  # integration tests in VS Code (VSCODE_VERSION=insiders for Insiders)
node scripts/spans.js file.tex   # list the spans found in a file
```

See [ROADMAP.md](ROADMAP.md) for the path to a Marketplace release.

## Limitations

- A file is read for definitions only when its root pulls it in with a literal path; `\input{\dir/file}` is not followed.
- Without the probe (no TeX engine, an untrusted workspace, before the first save), macros whose color comes from code the parser does not model, such as `\textcolor{\mycolor}{...}` or a package's own commands, are not colored.
