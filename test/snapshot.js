// Compare text with a snapshot file; UPDATE=1 rewrites it instead (review the diff by eye).
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function matchSnapshot(file, got) {
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (process.env.UPDATE) {
        if (old !== got) { fs.writeFileSync(file, got); console.log(`updated ${path.basename(file)}`); }
        return;
    }
    assert.ok(old !== null, `no snapshot ${path.basename(file)}; run npm run test:update`);
    assert.strictEqual(got, old);
}

module.exports = { matchSnapshot };
