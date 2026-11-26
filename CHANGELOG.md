# Changelog

All notable changes are listed here, in the form of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/).

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
