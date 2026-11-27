'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findOnPath, readLatexmkrc, compileProbe, spawnOptions } = require('../../src/probeRunner');

const made = [], tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-test-')); made.push(d); return d; };
test.after(() => made.forEach(d => fs.rmSync(d, { recursive: true, force: true })));
const script = (dir, name, body) => { const f = path.join(dir, name); fs.writeFileSync(f, '#!/bin/sh\n' + body); fs.chmodSync(f, 0o755); return f; };
const posix = { skip: process.platform === 'win32' && 'POSIX shell scripts' };

test('findOnPath: first executable match on PATH', posix, () => {
    const a = tmp(), b = tmp();
    fs.writeFileSync(path.join(a, 'xelatex'), ''); // not executable
    const exe = script(b, 'xelatex', 'exit 0\n');
    assert.strictEqual(findOnPath('xelatex', { PATH: [a, b].join(path.delimiter) }), exe);
    assert.strictEqual(findOnPath('lualatex', { PATH: [a, b].join(path.delimiter) }), null);
});

test('readLatexmkrc: user rc (XDG before ~/.latexmkrc), then project rc (.latexmkrc before latexmkrc)', () => {
    const home = tmp(), root = tmp();
    fs.mkdirSync(path.join(home, '.config', 'latexmk'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'latexmk', 'latexmkrc'), 'xdg');
    fs.writeFileSync(path.join(home, '.latexmkrc'), 'home');
    fs.writeFileSync(path.join(root, '.latexmkrc'), 'dot');
    fs.writeFileSync(path.join(root, 'latexmkrc'), 'plain');
    assert.deepStrictEqual(readLatexmkrc(root, { HOME: home }), ['xdg', 'dot']);
    fs.rmSync(path.join(root, '.latexmkrc'));
    fs.rmSync(path.join(home, '.config'), { recursive: true });
    assert.deepStrictEqual(readLatexmkrc(root, { HOME: home }), ['home', 'plain']);
    assert.deepStrictEqual(readLatexmkrc(tmp(), { HOME: tmp() }), []);
});

// A fake engine: records its arguments, cwd and environment, writes a log into -output-directory.
const FAKE = `for a in "$@"; do case "$a" in -output-directory=*) out="\${a#*=}";; -jobname=*) job="\${a#*=}";; esac; done
printf '%s\\n' "$@" > "$MARK"; pwd >> "$MARK"; echo "$max_print_line" >> "$MARK"; echo "$TEXINPUTS" >> "$MARK"; echo "$out" >> "$MARK"
printf 'LCBEGIN 0\\n' > "$out/$job.log"; cat "$out/$job.tex" >> "$out/$job.log"
`;

test('compileProbe: runs the engine in a temporary directory, reading from the root folder; returns the log; removes the directory', posix, async () => {
    const bin = tmp(), root = tmp(), mark = path.join(tmp(), 'mark');
    process.env.MARK = mark;
    const log = await compileProbe({ engine: script(bin, 'pdflatex', FAKE), root, tex: 'TEXBODY', timeout: 10 });
    const lines = fs.readFileSync(mark, 'utf8').trimEnd().split('\n'), [cwd, mpl, texinputs, out] = lines.slice(-4), args = lines.slice(0, -4);
    assert.match(log, /LCBEGIN 0\nTEXBODY/);
    assert.deepStrictEqual(args.slice(0, 3), ['-interaction=nonstopmode', '-no-shell-escape', '-no-file-line-error']);
    assert.strictEqual(cwd, out); // writes by relative path land in the temporary directory
    assert.ok(texinputs.startsWith(root + path.delimiter), texinputs); // \input and \usepackage still find the root's files
    assert.strictEqual(mpl, '10000');
    assert.ok(!fs.existsSync(out), 'temp directory left behind');
});

test('compileProbe: timeout kills the process group and rejects', posix, async () => {
    const bin = tmp(), pids = path.join(tmp(), 'pids');
    const slow = script(bin, 'pdflatex', `sleep 30 & echo $! > "${pids}"; wait\n`);
    const t0 = Date.now();
    await assert.rejects(compileProbe({ engine: slow, root: tmp(), tex: '', timeout: 0.3 }), /timed out/);
    assert.ok(Date.now() - t0 < 5000);
    const child = +fs.readFileSync(pids, 'utf8');
    await new Promise(r => setTimeout(r, 100));
    assert.throws(() => process.kill(child, 0), /ESRCH/, 'child process survived');
});

test('compileProbe: missing engine rejects', async () =>
    assert.rejects(compileProbe({ engine: path.join(tmp(), 'nosuch'), root: tmp(), tex: '', timeout: 5 })));

test('spawnOptions: no console window on Windows; the caller\'s TEXINPUTS kept after the root folder', () => {
    const o = spawnOptions('/tmp/x', '/doc', { TEXINPUTS: '/mine:' });
    assert.strictEqual(o.windowsHide, true);
    assert.strictEqual(o.cwd, '/tmp/x');
    assert.strictEqual(o.env.TEXINPUTS, `/doc${path.delimiter}/mine:`);
    assert.strictEqual(spawnOptions('/tmp/x', '/doc', {}).env.TEXINPUTS, `/doc${path.delimiter}`); // trailing separator: then the default path
});
