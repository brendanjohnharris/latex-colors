# Changelog

All notable changes are listed here, in the form of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/).

## 0.9.0 - 2026-11-27 (pre-release)

### Added
- Marketplace and Open VSX listing: publisher `brendanjohnharris`, icon, categories and keywords; `examples/demo.tex` shows every feature.
- Release workflow: a version tag tests, packages and publishes to the Marketplace and Open VSX, and creates a GitHub Release with the `.vsix`; odd minor versions publish as pre-releases.

## 0.7.0 - 2026-11-27

### Added
- Settings `latexColors.colors.enabled`, `latexColors.marks.patterns` (your own marks: name, regex, color, background, font style; a bad entry is skipped with one warning), `latexColors.marks.languages` and `latexColors.minLuminance`.
- Commands: Toggle Colors, Toggle Editorial Marks, Rescan and Rerun the Probe, Show Output.
- Hover over colored text: the command or expression, its value, and whether it was predicted or probed.
- Marks reach any language listed in `latexColors.marks.languages` (activation on startup).

## 0.6.0 - 2026-11-27

### Changed
- Scanning is near linear: a 1.1 MB document with 5000 paragraphs scans in about 15 ms (was 2.1 s), measured by `npm run bench` and checked in CI.

## 0.5.0 - 2026-11-27

### Added
- Multi-file documents: definitions from the root file and the local files it pulls in (`\input`, `\include`, `\subfile`, `\import`, local `.sty` packages); the root from `% !TEX root`, the `subfiles` class, or the workspace file that includes the open one. The probe compiles the root and covers commands used in every file.
- The `dvipsnames`, `svgnames` and `x11names` color sets, generated from TeX Live 2026 (`scripts/gen-names.js`); models `hsb`, `Hsb`, `HSB` and `named`; `\definecolorset`.
- Macros from xparse (`\NewDocumentCommand` and relatives), `\def` and `\let`; macros built on other macros; multi-argument macros color through the argument their body styles; environments from `\newenvironment` whose begin code sets a color; ulem's `\dashuline` and `\dotuline`.
- `\verb` and the verbatim, `Verbatim`, `lstlisting`, `minted` and `comment` environments are skipped.

### Fixed
- A `\color` switch inside an environment runs to the environment's own `\end`, not to the first nested `\end`; `\endcsname` no longer ends it.
- A `\color` switch in a group that is not yet closed stops at the next blank line instead of running to the end of the document.

## 0.4.0 - 2026-11-27

### Added
- Probe compile: after each save of a root file, LaTeX reports the exact color of each command and color expression in the document, and those colors replace the predictions. The engine is chosen as LaTeX Workshop would choose it. Settings `latexColors.probe.enabled` (default `true`), `latexColors.probe.engine` and `latexColors.probe.timeout`; output channel **LaTeX Colors**.
- Untrusted workspaces are supported with the probe off.
- Integration tests in VS Code stable and Insiders (`npm run test:vscode`), run in CI.

### Fixed
- A color or macro named after an `Object` property (`\textcolor{constructor}{...}`) no longer breaks coloring.

## 0.3.0 - 2026-11-27

### Fixed
- `cmyk` colors convert to RGB as xcolor does (`1 - min(1, c + k)`), not as `(1 - c)(1 - k)`.

### Changed
- Sources moved to `src/`; `check.js` replaced by `node:test` unit, fixture and fuzz tests (`npm test`), and by `node scripts/spans.js file.tex` for listing spans.
- CI runs the tests, a type check and `vsce package` on every push and pull request.

## 0.2.1 - 2026-11-27

### Added
- `latexColors.marks.enabled` (default `true`) turns the editorial marks off.

### Changed
- Requires VS Code 1.145 or later.

## 0.2.0 - 2026-11-27

### Added
- Editorial marks in LaTeX, Markdown and plain text: `[[rewrite]]`, `xxrephrasexx`, `((note))`, `....expand....`.

## 0.1.0 - 2026-11-27

### Added
- Colors LaTeX source as xcolor colors the PDF: `\textcolor`, `\color` (to the end of its group or environment) and `\colorbox`; one-argument macros built on them, on soul's `\hl` or on ulem; colors from `\definecolor`, `\providecolor` and `\colorlet` in the models `rgb`, `RGB`, `HTML`, `cmyk`, `cmy` and `gray`, with xcolor expressions such as `red!50!blue`.
- `latexColors.liftDarkColors` (default `true`) lightens colors too dark to read on dark themes.
