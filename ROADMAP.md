# Roadmap to a Marketplace release

**State at v0.5.0 (2026-11-27).** Colors `\textcolor`, `\color`, `\colorbox`, colored environments and macros built on them (`\newcommand` and relatives, xparse, `\def`, `\let`, macros on macros, several arguments), with definitions from every file of a multi-file document, the xcolor name sets and models, and exact colors from a probe compile after each save; highlights four editorial marks, on by default, off with `latexColors.marks.enabled`; unit, fixture, fuzz and VS Code integration tests with CI; publisher `local`; requires VS Code 1.145. Each milestone below ends in a tagged release and lists what must hold before it is called done.

## 1. Tests and CI (v0.3)

- Move `check.js` into `test/` on the built-in `node:test` runner, so `npm test` needs no dependencies.
- Fixture tests: `test/fixtures/<case>.tex` with an expected `<case>.json` of spans (start, end, style); `npm test -- --update` rewrites snapshots for review.
- Fuzz test: random streams of LaTeX tokens (commands, braces, `%`, escapes, unclosed groups) must never throw, must return spans inside the text, non-overlapping after flattening.
- GitHub Actions: `npm test` on every push and pull request; `vsce package` with no warnings.
- Add `CHANGELOG.md`.

**Done when** CI is green and every limitation fixed later arrives with a fixture.

## 2. Adaptive colors from a probe compile (v0.4)

The parser predicts colors on every keystroke; a probe compile then asks LaTeX for the true colors and overrides the predictions. A test on 2026-11-27 with the BorderlineResponsiveness preamble returned exact RGB for every comment macro (`\ben`, `\nao`, `\dai`, ...) and for expressions such as `green!50!black`, in one `pdflatex` run.

**Probe document**
- The root's preamble (everything before `\begin{document}`, with its `\input`s), then a generated body that calls each candidate command with an argument that records the current color: `\extractcolorspecs{.}` converted to `rgb` with `\convertcolorspec`, written with `\immediate\write` to `<job>.lcprobe`.
- Candidates: every command used in the body with a braced argument, minus structural commands (`\section`, `\label`, `\ref`, `\cite`, `\includegraphics`, `\input`, `\url`, ...); and every color expression given to `\textcolor`, `\color` or `\colorbox`. This covers `dvipsnames` and other name sets, every model and expression, `\def` and xparse macros, and package commands such as `changes` and `todonotes`, with no tables or grammar in the extension.
- Each candidate is isolated, so one that fails (soul's `\hl` tokenizes its argument; a command that needs a particular argument) loses only itself. A candidate whose color is unchanged from the surrounding text is not a color macro.
- Highlights, strikethroughs and underlines are not colors and stay with the parser; so does the extent of each span.

**When it runs**
- On save, when the preamble hash or the set of candidates has changed; results cached per hash in workspace storage, so reopening a file costs nothing.
- `-interaction=nonstopmode`, `-no-shell-escape`, a 30 s timeout, output in a temporary directory, run from the root's folder so relative `\input`s resolve. Off with `latexColors.probe.enabled`; it runs the preamble's code, as compiling the document does.

**Engine**, mirroring LaTeX Workshop (v10.20.1, `out/src/compile/recipe.js`), read with `workspace.getConfiguration('latex-workshop', rootUri)`:
1. Magic comments are read only from the comment block at the top of the root file. If `latex-workshop.latex.build.enableMagicComments` is true (its default) and there is a `% !TEX program = <engine>`, use it.
2. Else, with magic comments enabled, `% !LW recipe = <name>` names the recipe.
3. Else `latex-workshop.latex.recipe.default`: `first` (the default) takes the first entry of `latex-workshop.latex.recipes`; a recipe name takes that recipe; `lastUsed` is LaTeX Workshop's private state, so it falls back to `first`.
4. In the recipe, the first tool (`latex-workshop.latex.tools`) that runs a TeX engine decides: `pdflatex`, `xelatex`, `lualatex`, `latex`, `platex` or `uplatex` directly; for `latexmk`, the flag (`-pdf` pdflatex, `-pdflua`/`-lualatex` lualatex, `-pdfxe`/`-xelatex` xelatex, `-pdfdvi`/`-dvi`/`-ps` latex), or without a flag `$pdf_mode` in the project's `latexmkrc`/`.latexmkrc`, then `~/.latexmkrc` and `$XDG_CONFIG_HOME/latexmk/latexmkrc` (1 pdflatex, 4 lualatex, 5 xelatex).
5. Without LaTeX Workshop, or when nothing above names an engine: `% !TEX program`, else `pdflatex`.
6. `latexColors.probe.engine` overrides all of this.

The probe runs the engine directly, not `latexmk`, since one pass is enough.

**Done when** probe colors override predictions in the editor, each engine-resolution step has a test against a mocked configuration, and a failing candidate never blocks the others.

## 3. Parser completeness (v0.5)

**Multi-file documents**
- Find the root: a `% !TEX root = ...` comment, else the open file if it contains `\documentclass`, else a `latexColors.rootFile` setting, else the workspace `.tex` file that `\input`s or `\include`s the open one.
- Read definitions from the root and every local file it pulls in (`\input`, `\include`, `\subfile`, and `\usepackage`/`\RequirePackage` of a `.sty` in the workspace), through `workspace.fs` so it also works on vscode.dev.
- Cache definitions per root; invalidate with a `FileSystemWatcher` on those files.

**Color names and models** (predictions only; the probe gives exact values)
- The `dvipsnames`, `svgnames` and `x11names` tables, so predictions are right before the first probe. Generate them once from `dvipsnam.def`, `svgnam.def` and `x11nam.def` and commit the JSON.

**Macros**
- xparse definitions (`\NewDocumentCommand` and relatives) with `m`, `o`, `O{}` and `s` argument specs.
- `\def\name#1{...}` and `\let` aliases.
- Macros built on other macros (`\newcommand\todo[1]{\ben{TODO: #1}}`), resolved recursively with a cycle guard.
- Multi-argument macros: color the argument the body actually wraps, not always the first; optional arguments before it.
- Environments whose begin code sets `\color` (`\newenvironment`): color the body.
- ulem's `\dashuline` and `\dotuline`.

**Scanner**
- Skip `\verb`, `verbatim`, `lstlisting`, `minted` and `comment` environments.
- While typing, an unclosed group must not color to the end of the file: cap it at the next blank line or `\end`.

**Done when** each item has a fixture and the fuzz test still passes.

## 4. Performance (v0.6)

- Replace the quadratic span flattening with a sweep over sorted start and end events.
- Reuse parsed definitions while the preamble is unchanged (hash of the text before `\begin{document}`).
- Benchmark in CI on a synthetic 1 MB thesis and on real theses: a full scan under 20 ms; fail CI above 50 ms.
- If needed, decorate only the visible ranges of very large files.

**Done when** typing in a 1 MB file shows no lag at the 250 ms debounce.

## 5. Configuration and interface (v0.7)

- `latexColors.colors.enabled`, next to the existing `latexColors.marks.enabled` (marks stay in this extension and on by default).
- `latexColors.marks.patterns`: a list of `{name, regex, color, background, fontStyle}` that replaces the four built-in marks, validated on load, with errors shown once per session.
- `latexColors.marks.languages` (default `latex`, `markdown`, `plaintext`) and `latexColors.minLuminance` next to `liftDarkColors`.
- Commands: Toggle colors, Toggle marks, Rescan.
- Hover over a colored span to show its color expression and value.
- A `browser` entry point so the extension runs on vscode.dev and github.dev.

**Done when** every setting is in `package.json` with a description and covered by a test.

## 6. Integration tests (alongside 2 to 5)

- `@vscode/test-cli` with `@vscode/test-electron`: launch VS Code, open fixtures, call a hidden command `latexColors._spans` that returns the spans for the active editor, and compare with the fixture snapshots.
- Run under `xvfb` in CI against current stable and Insiders. `engines.vscode` tracks the current stable release; older versions are not supported.
- Manual checklist per release: light, dark and high-contrast themes; split editors; Remote SSH; typing latency in a large file.

## 7. Publishing (v1.0)

- **Name.** A Marketplace search for "latex color" on 2026-11-27 found no extension doing this (closest: "Add Latex Color Code", which inserts color commands). Settle the display name and extension ID before the first publish; neither can be reused freely later.
- **Marketplace publisher.** Create one on the Marketplace publisher management page with a Microsoft account; create an Azure DevOps personal access token for "All accessible organizations" with the Marketplace "Manage" scope; `vsce login <publisher>`; replace `"publisher": "local"` in `package.json`.
- **Open VSX** (VSCodium, Cursor, Gitpod). Create an Eclipse account, sign the Publisher Agreement from the open-vsx.org profile page, create a token, then `npx ovsx create-namespace <publisher> -p <token>`.
- **Listing.** A 128 x 128 PNG icon; README screenshots as PNG or GIF over https (vsce rejects most SVG images); `CHANGELOG.md`; `categories`, `keywords`, `galleryBanner`; `.vscodeignore` keeps tests and fixtures out of the package.
- **Release workflow.** Pushing a `v*` tag runs tests, packages the `.vsix`, attaches it to a GitHub Release, and publishes with `vsce publish -p $VSCE_PAT` and `ovsx publish -p $OVSX_PAT` (repository secrets).

**Done when** a tag alone produces installable releases on both registries.

## 8. After 1.0

- Issue templates (bug: a minimal `.tex` and a screenshot).
- Semantic versioning: new syntax is a minor release, behavior changes to existing syntax are major.
- Packages that color text from inside their own `.sty`, invisible to a parser of the document: `changes` (`\added`, `\deleted`, `\replaced`, colored per `\definechangesauthor`), `todonotes` (`\todo[color=...]`), `fixme`. Each needs built-in knowledge of the package; add one when someone asks.
