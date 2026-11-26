// Snapshot tests: test/fixtures/<case>.tex (colors and marks) or <case>.md (marks only, as in the
// extension) against <case>.spans.json.
'use strict';
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { snapshot } = require('../scripts/spans');
const { matchSnapshot } = require('./snapshot');

const dir = path.join(__dirname, 'fixtures');

for (const f of fs.readdirSync(dir).filter(f => /\.(tex|md)$/.test(f)).sort()) {
    const file = path.join(dir, f);
    test(f, () => matchSnapshot(file.replace(/\.\w+$/, '.spans.json'),
        JSON.stringify(snapshot(fs.readFileSync(file, 'utf8'), path.extname(f)), null, 2) + '\n'));
}
