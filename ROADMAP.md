# Roadmap to a Marketplace release

**State at v0.2.0 (2026-11-27).** Colors `\textcolor`, `\color`, `\colorbox` and one-argument macros built on them, from the open document only; highlights four editorial marks; one assertion script (`check.js`); no CI; publisher `local`. Each milestone below ends in a tagged release and lists what must hold before it is called done.

## 1. Tests and CI (v0.3)

- Move `check.js` into `test/` on the built-in `node:test` runner, so `npm test` needs no dependencies.
- Fixture tests: `test/fixtures/<case>.tex` with an expected `<case>.json` of spans (start, end, style); `npm test -- --update` rewrites snapshots for review.
- Fuzz test: random streams of LaTeX tokens (commands, braces, `%`, escapes, unclosed groups) must never throw, must return spans inside the text, non-overlapping after flattening.
- GitHub Actions: `npm test` on every push and pull request; `vsce package` with no warnings.
- Add `CHANGELOG.md`.

**Done when** CI is green and every limitation fixed later arrives with a fixture.

## 2. Parser completeness (v0.4)

**Multi-file documents**
- Find the root: a `% !TEX root = ...` comment, else the open file if it contains `\documentclass`, else a `latexColors.rootFile` setting, else the workspace `.tex` file that `\input`s or `\include`s the open one.
- Read definitions from the root and every local file it pulls in (`\input`, `\include`, `\subfile`, and `\usepackage`/`\RequirePackage` of a `.sty` in the workspace), through `workspace.fs` so it also works on vscode.dev.
- Cache definitions per root; invalidate with a `FileSystemWatcher` on those files.

**Color names and models**
- The `dvipsnames`, `svgnames` and `x11names` tables, active when xcolor is loaded with those options (in `\usepackage`, `\PassOptionsToPackage` or `\documentclass`). Generate the tables once from `dvipsnam.def`, `svgnam.def` and `x11nam.def` and commit the JSON.
- Models `hsb`, `Hsb`, `HSB`, `named`; `\definecolorset`.
- The rest of the xcolor expression grammar in common use: `.` (current color), extended expressions (`rgb:red,1;blue,2`).

**Macros**
- xparse definitions (`\NewDocumentCommand` and relatives) with `m`, `o`, `O{}` and `s` argument specs.
- `\def\name#1{...}` and `\let` aliases.
- Macros built on other macros (`\newcommand\todo[1]{\ben{TODO: #1}}`), resolved recursively with a cycle guard.
- Multi-argument macros: color the argument the body actually wraps, not always the first; optional arguments before it.
- Environments whose begin code sets `\color` (`\newenvironment`): color the body.
- Annotation packages: `changes` (`\added`, `\deleted`, `\replaced`, colored per `\definechangesauthor`), `todonotes` (`\todo`), ulem's `\dashuline` and `\dotuline`.

**Scanner**
- Skip `\verb`, `verbatim`, `lstlisting`, `minted` and `comment` environments.
- While typing, an unclosed group must not color to the end of the file: cap it at the next blank line or `\end`.

**Done when** each item has a fixture and the fuzz test still passes.

## 3. Performance (v0.5)

- Replace the quadratic span flattening with a sweep over sorted start and end events.
- Reuse parsed definitions while the preamble is unchanged (hash of the text before `\begin{document}`).
- Benchmark in CI on a synthetic 1 MB thesis and on real theses: a full scan under 20 ms; fail CI above 50 ms.
- If needed, decorate only the visible ranges of very large files.

**Done when** typing in a 1 MB file shows no lag at the 250 ms debounce.

## 4. Configuration and interface (v0.6)

- `latexColors.colors.enabled` and `latexColors.marks.enabled`. Marks are a personal convention, so they ship **off**, with the four current marks given in the README as an example.
- `latexColors.marks.patterns`: a list of `{name, regex, color, background, fontStyle}`, validated on load, with errors shown once per session.
- `latexColors.marks.languages` (default `latex`, `markdown`, `plaintext`) and `latexColors.minLuminance` next to `liftDarkColors`.
- Commands: Toggle colors, Toggle marks, Rescan.
- Hover over a colored span to show its color expression and value.
- A `browser` entry point so the extension runs on vscode.dev and github.dev.

**Done when** every setting is in `package.json` with a description and covered by a test.

## 5. Integration tests (alongside 2 to 4)

- `@vscode/test-cli` with `@vscode/test-electron`: launch VS Code, open fixtures, call a hidden command `latexColors._spans` that returns the spans for the active editor, and compare with the fixture snapshots.
- Run under `xvfb` in CI against the minimum and the current VS Code versions; set `engines.vscode` to the minimum that passes.
- Manual checklist per release: light, dark and high-contrast themes; split editors; Remote SSH; typing latency in a large file.

## 6. Publishing (v1.0)

- **Name.** A Marketplace search for "latex color" on 2026-11-27 found no extension doing this (closest: "Add Latex Color Code", which inserts color commands). Settle the display name and extension ID before the first publish; neither can be reused freely later.
- **Marketplace publisher.** Create one on the Marketplace publisher management page with a Microsoft account; create an Azure DevOps personal access token for "All accessible organizations" with the Marketplace "Manage" scope; `vsce login <publisher>`; replace `"publisher": "local"` in `package.json`.
- **Open VSX** (VSCodium, Cursor, Gitpod). Create an Eclipse account, sign the Publisher Agreement from the open-vsx.org profile page, create a token, then `npx ovsx create-namespace <publisher> -p <token>`.
- **Listing.** A 128 x 128 PNG icon; README screenshots as PNG or GIF over https (vsce rejects most SVG images); `CHANGELOG.md`; `categories`, `keywords`, `galleryBanner`; `.vscodeignore` keeps tests and fixtures out of the package.
- **Release workflow.** Pushing a `v*` tag runs tests, packages the `.vsix`, attaches it to a GitHub Release, and publishes with `vsce publish -p $VSCE_PAT` and `ovsx publish -p $OVSX_PAT` (repository secrets).

**Done when** a tag alone produces installable releases on both registries.

## 7. After 1.0

- Issue templates (bug: a minimal `.tex` and a screenshot).
- Semantic versioning: new syntax is a minor release, behavior changes to existing syntax are major.

## Open questions

- Should the editorial marks stay in this extension, or move to a separate one so this one stays strictly about LaTeX colors?
- Which annotation packages matter most beyond plain macros (`changes`, `todonotes`)?
- The lowest VS Code version to support.
