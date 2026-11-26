// Snapshot tests: test/fixtures/<case>.tex (colors and marks) or <case>.md (marks only, as in the
// extension) against <case>.spans.json. UPDATE=1 rewrites changed snapshots; review them by eye.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { snapshot } = require('../scripts/spans');

const dir = path.join(__dirname, 'fixtures');

for (const f of fs.readdirSync(dir).filter(f => /\.(tex|md)$/.test(f)).sort()) {
    const file = path.join(dir, f), snap = file.replace(/\.\w+$/, '.spans.json');
    test(f, () => {
        const got = JSON.stringify(snapshot(fs.readFileSync(file, 'utf8'), path.extname(f)), null, 2) + '\n';
        if (process.env.UPDATE) {
            if (!fs.existsSync(snap) || fs.readFileSync(snap, 'utf8') !== got) {
                fs.writeFileSync(snap, got);
                console.log(`updated ${path.basename(snap)}`);
            }
            return;
        }
        assert.ok(fs.existsSync(snap), `no snapshot for ${f}; run npm run test:update`);
        assert.deepStrictEqual(JSON.parse(got), JSON.parse(fs.readFileSync(snap, 'utf8')));
    });
}
