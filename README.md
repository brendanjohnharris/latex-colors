# LaTeX Colors

A VS Code extension that colors LaTeX source the way xcolor colors the PDF, and highlights editorial marks in LaTeX, Markdown and plain text.

## Colors

- `\textcolor{c}{...}`, `{\color{c} ...}` (to the end of the group or environment) and `\colorbox{c}{...}`.
- One-argument macros defined with `\newcommand`, `\renewcommand`, `\providecommand` or `\DeclareRobustCommand` whose body uses those commands, soul's `\hl` (with `\sethlcolor`), or `\sout`, `\uwave` and `\uline`. A comment macro such as `\providecommand{\ben}[1]{\textcolor{myorange}{[#1]}}` colors every `\ben{...}`.
- Colors: xcolor's base names, and every `\definecolor`, `\providecolor` and `\colorlet` in the document (models `rgb`, `RGB`, `HTML`, `cmyk`, `cmy`, `gray`), including expressions such as `red!50!blue`.

Braces are matched to any depth; `%` comments and escaped `\{`, `\}`, `\%` are skipped. Where colored spans nest, the inner one wins.

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
| `latexColors.liftDarkColors` | `true` | On dark themes, lighten colors too dark to read |

## Install

```sh
npx @vscode/vsce package
code --install-extension latex-colors-*.vsix
```

## Development

`node check.js [file.tex]` runs the assertions and, given a file, lists the spans found in it. See [ROADMAP.md](ROADMAP.md) for the path to a Marketplace release.

## Limitations

- Only the open document is read, so colors defined in an `\input` preamble are missed.
- The `dvipsnames`, `svgnames` and `x11names` sets are not known.
- `\def`, xparse commands and multi-argument macros are not interpreted.
