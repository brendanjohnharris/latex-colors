// node scripts/readme-settings.js [--check]: write the settings table in README.md (between the settings
// markers) from package.json; with --check, exit 1 if the README is out of date (CI).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const readme = path.join(__dirname, '..', 'README.md');
const props = require('../package.json').contributes.configuration.properties;
const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const value = v => Array.isArray(v) && v.some(x => typeof x === 'object') ? 'the built-in marks' : `\`${JSON.stringify(v)}\``;
const table = ['| Setting | Default | |', '|---|---|---|',
    ...Object.entries(props).map(([k, p]) => `| \`${k}\` | ${value(p.default)} | ${cell(p.markdownDescription ?? p.description)} |`)].join('\n');

const text = fs.readFileSync(readme, 'utf8'), re = /(<!-- settings -->\n)[\s\S]*?(<!-- \/settings -->)/;
if (!re.test(text)) { console.error('README.md has no <!-- settings --> markers'); process.exit(1); }
const next = text.replace(re, (_, a, b) => a + table + '\n' + b);
if (process.argv.includes('--check')) {
    if (next !== text) { console.error('README.md settings table is out of date: run node scripts/readme-settings.js'); process.exit(1); }
} else fs.writeFileSync(readme, next);
