# LaTeX Colors

A VS Code extension that colors LaTeX source the way xcolor colors the PDF, and highlights editorial marks in LaTeX, Markdown and plain text.

## Colors

- `\textcolor{c}{...}`, `{\color{c} ...}` (to the end of the group or environment) and `\colorbox{c}{...}`.
- soul and ulem commands in the text: `\hl` (with `\sethlcolor`), `\st`, `\ul`, `\sout`, `\xout`, `\uwave`, `\uline`, `\dashuline` and `\dotuline`.
- Macros defined with `\newcommand`, `\renewcommand`, `\providecommand`, `\DeclareRobustCommand`, xparse's `\NewDocumentCommand` and relatives (argument types `m`, `o`, `O{...}`, `s`, `t`), `\def` (undelimited parameters) or `\let`, whose body uses those commands, soul's `\hl` (with `\sethlcolor`), ulem's `\sout`, `\uwave`, `\uline`, `\dashuline` and `\dotuline`, or another such macro. A comment macro such as `\providecommand{\ben}[1]{\textcolor{myorange}{[#1]}}` colors every `\ben{...}`; a macro with several arguments colors through the argument its body styles.
- Environments defined with `\newenvironment` whose begin code sets a color.
- Colors: xcolor's base names; the `dvipsnames`, `svgnames` and `x11names` sets when xcolor is loaded with those options (in `\usepackage`, `\PassOptionsToPackage` or `\documentclass`); and every `\definecolor`, `\providecolor`, `\colorlet` and `\definecolorset` (models `rgb`, `RGB`, `HTML`, `cmyk`, `cmy`, `gray`, `hsb`, `Hsb`, `HSB`, `named`), including expressions such as `red!50!blue`.
- latexdiff output: `\DIFadd` and `\DIFdel` are defined in the diff's preamble, so they color like any other macro.
- Multi-file documents: definitions are read from the root file and every local file it pulls in (`\input`, `\include`, `\subfile`, `\import`, and `\usepackage` of a `.sty` in the root's folder). The root is found from a `% !TEX root` magic comment, the `subfiles` class option, `\documentclass` in the file itself, or the workspace file that pulls the file in.

Braces are matched to any depth; `%` comments, `\verb` and the verbatim, `Verbatim`, `lstlisting`, `minted` and `comment` environments are skipped. Where colored spans nest, the inner one wins.

## Exact colors from LaTeX

The colors above are predicted from the source on every keystroke. When a root file is opened, and after each save, a probe compile of the document's root file asks LaTeX for the true colors: it compiles the preamble with a generated body that typesets each command used in the document, and each color expression given to `\textcolor`, `\color` or `\colorbox`, around a command that reports the current color. Those colors replace the predictions, so colors computed by macros, package commands such as those of `changes` (`\added`, `\deleted`, `\replaced`), and any xcolor expression are exact. A command that colors a box or note rather than its text, such as `todonotes`' `\todo`, is left as it is. Extents, highlights and strikethroughs still come from the parser.

- The engine is the one LaTeX Workshop would use (magic comments, the default recipe, latexmk flags and `latexmkrc`), else a `% !TEX program` magic comment, else `pdflatex`; `latexColors.probe.engine` overrides it. The engine must be on `PATH`.
- The probe runs the preamble's code, as compiling the document does, with shell escape off. It runs inside a temporary directory that is deleted afterwards, with the root's folder first on `TEXINPUTS`, so `\input` and local packages resolve while files the preamble writes by relative path (`\openout`, Lua's `io.open`) land in the temporary directory. It is stopped after `latexColors.probe.timeout` seconds.
- The probe does not run in untrusted workspaces. VS Code trusts a file opened outside any folder unless `security.workspace.trust.emptyWindow` is off.
- Results are cached by engine, preamble and the set of commands, so reopening a file does not recompile. The **LaTeX Colors** output channel lists each run: engine, command line, time, and every command that failed or color that is undefined.

## Editorial marks

| Mark | Meaning | Color |
|---|---|---|
| `[[text]]` | rewrite | `#ffa829` |
| `xxtextxx` | rephrase; a bare `xxx` is a placeholder | `#f93d53` |
| `((text))` | note to the writer | `#b97ad7` |
| `....text....` | expand, about one dot per word | `#88bd69` |

## Settings

<!-- settings -->
| Setting | Default | |
|---|---|---|
| `latexColors.colors.enabled` | `true` | Color LaTeX source as xcolor colors the PDF. |
| `latexColors.marks.enabled` | `true` | Highlight editorial marks: [[rewrite]], xxrephrasexx, ((note)), ....expand..... |
| `latexColors.marks.patterns` | the built-in marks | Editorial marks: each a `name`, a JavaScript `regex` (matched across lines with `[\s\S]`), a `color`, and optionally a `background` (default: the color at 15% opacity) and a `fontStyle` (default `italic`). Replaces the built-in marks. |
| `latexColors.marks.languages` | `["latex","tex","markdown","plaintext"]` | Language identifiers in which editorial marks are highlighted. |
| `latexColors.liftDarkColors` | `true` | On dark themes, lighten colors too dark to read. |
| `latexColors.minLuminance` | `0.35` | On dark themes, colors are lightened until their relative luminance reaches this value. |
| `latexColors.probe.enabled` | `true` | When a root file is opened and after each save, compile its preamble with a generated body (shell escape off, inside a temporary directory) so LaTeX reports the exact color of each command and color expression. Runs only in trusted workspaces. |
| `latexColors.probe.engine` | `""` | TeX engine for the probe compile. |
| `latexColors.probe.timeout` | `30` | Seconds before a probe compile is stopped. |
<!-- /settings -->

## Commands

- **LaTeX Colors: Toggle Colors** and **Toggle Editorial Marks** flip `latexColors.colors.enabled` and `latexColors.marks.enabled` for the workspace.
- **LaTeX Colors: Rescan and Rerun the Probe** clears the caches and probes the visible documents again.
- **LaTeX Colors: Show Output** opens the output channel with the probe's log.

Hovering over colored text shows the command or expression that colored it, its value, and whether the value was predicted or came from the probe.

Requires VS Code 1.90 or later, or an editor built on it (Cursor, VSCodium, Windsurf) through Open VSX.

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
npm run bench [-- file.tex ...]  # scan time on a generated 1 MB document (and on the files given)
```

See [ROADMAP.md](ROADMAP.md) for the path to a Marketplace release.

## Limitations

- A file is read for definitions only when its root pulls it in with a literal path; `\input{\dir/file}` is not followed.
- Without the probe (no TeX engine, an untrusted workspace, before the first save), macros whose color comes from code the parser does not model, such as `\textcolor{\mycolor}{...}` or a package's own commands, are not colored.
