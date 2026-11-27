// @ts-check
// Multi-file documents: the root file of a .tex file, and the local files a root pulls in.
// Pure apart from the injected read (path -> text or null) and list (candidate root paths).
'use strict';
const path = require('node:path');
const { mask, readArg, readOpt } = require('./colors');

const ROOT_MAGIC = /^(?:%\s*!\s*T[Ee]X\sroot\s*=\s*(.*\.(?:tex|[jrsRS]nw|[rR]tex|jtexw))$)/m; // LaTeX Workshop 10.20.1 core/root.js
const SUBFILES = /\\documentclass\s*\[([^\]]*)\]\s*\{subfiles\}/;
const INCLUDE = /\\(input|include|subfile|import|usepackage|RequirePackage|documentclass|LoadClass)(?![A-Za-z@])/g;
const BEGIN_DOC = /\\begin\s*\{document\}/;

/** Files a text pulls in: { kind, target, body } in order; body is true after \begin{document}. */
function includes(text) {
    const code = mask(text), begin = BEGIN_DOC.exec(code)?.index ?? Infinity, out = [];
    for (const m of code.matchAll(INCLUDE)) {
        const opts = ['usepackage', 'RequirePackage', 'documentclass', 'LoadClass'].includes(m[1]); // [options]{names}
        let a = readArg(code, m.index + m[0].length);
        if (!a && !opts) continue;
        const body = m.index > begin;
        if (opts) {
            a = readArg(code, readOpt(code, m.index + m[0].length).end);
            const kind = m[1] === 'documentclass' || m[1] === 'LoadClass' ? 'class' : 'package';
            for (const p of a ? a.inner.split(',').map(s => s.trim()).filter(Boolean) : []) out.push({ kind, target: p, body });
        } else if (m[1] === 'import') {
            const b = readArg(code, a.end);
            if (b) out.push({ kind: 'import', target: path.posix.join(a.inner.trim(), b.inner.trim()), body });
        } else out.push({ kind: m[1], target: a.inner.trim(), body });
    }
    return out;
}

// Paths to try for an include, in TeX's order: \input, \include, \import, packages and classes are relative to
// the root's folder (the compile's working directory); \subfile to the including file's folder.
function candidates(inc, rootDir, fileDir) {
    const t = inc.target, withTex = t.endsWith('.tex') ? [t] : [t + '.tex'];
    switch (inc.kind) {
        case 'input': return (t.endsWith('.tex') ? [t] : [t + '.tex', t]).map(x => path.resolve(rootDir, x));
        case 'include': case 'import': return withTex.map(x => path.resolve(rootDir, x));
        case 'subfile': return withTex.map(x => path.resolve(fileDir, x));
        case 'package': return [path.resolve(rootDir, t + '.sty')];
        case 'class': return [path.resolve(rootDir, t + '.cls')];
    }
    return [];
}

/**
 * The root and the local files it pulls in, depth first in document order: [{ path, text, body }].
 * body: pulled in after \begin{document}. Missing files, cycles and depth beyond maxDepth are skipped.
 * @param {(p: string) => Promise<string | null>} read
 */
async function collect(root, read, maxDepth = 10) {
    const rootDir = path.dirname(root), out = [], seen = new Set();
    async function visit(p, body, depth) { // true if p exists
        if (seen.has(p)) return true;
        if (depth > maxDepth) return false;
        const text = await read(p);
        if (text === null) return false;
        seen.add(p);
        out.push({ path: p, text, body });
        for (const inc of includes(text))
            for (const c of candidates(inc, rootDir, path.dirname(p))) if (await visit(c, body || inc.body, depth + 1)) break;
        return true;
    }
    await visit(root, false, 0);
    return out;
}

/**
 * Root of a .tex file: a % !TEX root chain (as LaTeX Workshop follows it), the subfiles class option,
 * the file itself if it has \documentclass, a listed file that pulls it in, else the file itself.
 * @param {string} file
 * @param {string} text
 * @param {{ read: (p: string) => Promise<string | null>, list: () => Promise<string[]> }} io
 */
async function findRoot(file, text, io) {
    const { read, list } = io;
    let p = file, t = text, m;
    const stack = [];
    while (t !== null && (m = ROOT_MAGIC.exec(t))) {
        p = path.resolve(path.dirname(p), m[1].trim());
        if (stack.includes(p)) return p;
        stack.push(p);
        t = await read(p);
    }
    if (stack.length && t !== null) return p;
    const code = mask(text), sub = SUBFILES.exec(code);
    if (sub) return path.resolve(path.dirname(file), sub[1].trim());
    if (/\\documentclass\b/.test(code)) return file;
    for (const c of await list()) {
        if (c === file) continue;
        const ct = await read(c);
        if (ct && /\\documentclass\b/.test(mask(ct)) && (await collect(c, read)).some(f => f.path === file)) return c;
    }
    return file;
}

module.exports = { includes, collect, findRoot };
