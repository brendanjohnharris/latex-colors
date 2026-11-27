// @ts-check
// Runs a probe document through a TeX engine in a temporary directory.
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const WIN = process.platform === 'win32';

/** Absolute path of an executable on PATH, or null. */
function findOnPath(name, env = process.env) {
    const exts = WIN ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
    for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean))
        for (const ext of exts) {
            const f = path.join(dir, name + ext);
            try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch { /* not here */ }
        }
    return null;
}

const readFirst = files => { for (const f of files) try { return fs.readFileSync(f, 'utf8'); } catch { /* next */ } return null; };

/** latexmk rc texts in the order latexmk reads them (latexmk.pl, 9 March 2026): user rc, then project rc. */
function readLatexmkrc(rootDir, env = process.env) {
    const home = env.HOME || env.USERPROFILE || '';
    const xdg = env.XDG_CONFIG_HOME || (home && fs.existsSync(path.join(home, '.config')) ? path.join(home, '.config') : '');
    const user = readFirst([xdg && path.join(xdg, 'latexmk', 'latexmkrc'), home && path.join(home, '.latexmkrc')].filter(Boolean));
    const project = readFirst([path.join(rootDir, '.latexmkrc'), path.join(rootDir, 'latexmkrc')]);
    return [user, project].filter(t => t !== null);
}

const probeArgs = dir => ['-interaction=nonstopmode', '-no-shell-escape', '-no-file-line-error', `-output-directory=${dir}`, '-jobname=lcprobe', path.join(dir, 'lcprobe.tex')];

/**
 * Engine process options: run in the temporary directory, so a preamble's writes by relative path
 * (\openout, Lua's io.open) land there; root first on TEXINPUTS, so \input and local packages resolve.
 * A trailing path separator keeps TeX's default search path after it.
 */
const spawnOptions = (dir, root, env = process.env) => ({
    cwd: dir, stdio: /** @type {'ignore'} */ ('ignore'), detached: !WIN, windowsHide: true,
    env: { ...env, TEXINPUTS: root + path.delimiter + (env.TEXINPUTS ?? ''), max_print_line: '10000', error_line: '254', half_error_line: '238' }, // unwrapped log lines
});

function killTree(child) {
    try {
        if (WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
        else process.kill(-child.pid, 'SIGKILL'); // detached: the engine leads its own process group
    } catch { /* already gone */ }
}

/**
 * Compile tex with engine in a temporary directory, reading the document's files from root.
 * Resolves with the log text; rejects on timeout (seconds) or if the engine cannot start.
 * @param {{ engine: string, root: string, tex: string, timeout: number }} o
 */
async function compileProbe({ engine, root, tex, timeout }) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'latex-colors-'));
    try {
        const file = path.join(dir, 'lcprobe.tex');
        await fsp.writeFile(file, tex);
        const args = probeArgs(dir);
        await new Promise((resolve, reject) => {
            const child = spawn(engine, args, spawnOptions(dir, root));
            const timer = setTimeout(() => { killTree(child); reject(new Error(`timed out after ${timeout} s`)); }, timeout * 1000);
            child.on('error', e => { clearTimeout(timer); reject(e); });
            child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
        });
        return await fsp.readFile(path.join(dir, 'lcprobe.log'), 'utf8').catch(() => '');
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
}

module.exports = { findOnPath, readLatexmkrc, compileProbe, probeArgs, spawnOptions };
