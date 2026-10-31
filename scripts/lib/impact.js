'use strict';
// Who depends on a changed file: the modules in the project that import it. A change to a shared module can break
// code far from it, and the tests next to the change won't show that.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SKIP_DIR = /^(?:node_modules|\.git|\.hg|dist|build|out|bin|obj|coverage|target|vendor|__pycache__|\.venv|venv|\.next|\.nuxt|\.turbo|\.cache)$/i;
const JS = /\.(?:[cm]?[jt]sx?)$/i;
const PY = /\.py$/i;
// .NET: the graph is between projects (<ProjectReference>), and a source file belongs to the nearest project above it.
const PROJ = /\.(?:cs|fs|vb)proj$/i;
const DOTNET_SRC = /\.(?:cs|fs|vb)$/i;
const MAX_FILES = 4000;
const MAX_BYTES = 512 * 1024;
const INDEX_VERSION = 3;

const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
const isTestFile = (f) => /(?:^|\/)(?:tests?|__tests__|spec)\/|[._-](?:test|spec)\.[a-z]+$|(?:^|\/)test_[^/]+\.py$|_test\.py$|[._-](?:unit|integration)?tests?\.[cfv]sproj$/i.test(f);

function sources(root) {
  const out = [];
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= MAX_FILES) return;
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name)); } else if (JS.test(e.name) || PY.test(e.name) || PROJ.test(e.name)) out.push(path.join(dir, e.name));
    }
  };
  walk(root);
  return out;
}

// Every file this source might import, as normalised absolute paths (existence is checked by the caller).
function importsOf(file, text, root) {
  const dir = path.dirname(file);
  const found = [];
  if (JS.test(file)) {
    // './x', '../x', and the bare '.' / '..' that tests use for the package entry point.
    for (const m of text.matchAll(/(?:require\s*\(\s*|import\s*\(\s*|\bfrom\s+|^\s*import\s+)['"](\.{1,2}(?:\/[^'"]*)?)['"]/gm)) {
      const base = path.resolve(dir, m[1]);
      for (const ext of ['', '.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '/index.js', '/index.ts']) found.push(base + ext);
    }
  } else if (PY.test(file)) {
    // `from pkg.mod import (a, b,\n    c)` spans lines inside the parentheses.
    for (const m of text.matchAll(/^\s*(?:from\s+(\.*[\w.]*)\s+import\s+(\([\w*,\s]+\)|[\w*, ]+)|import\s+([\w.]+))/gm)) {
      const mod = m[1] !== undefined ? m[1] : m[3];
      const dots = (mod.match(/^\.+/) || [''])[0].length;
      const rest = mod.slice(dots).split('.').filter(Boolean);
      const bases = dots ? [path.resolve(dir, ...Array(dots - 1).fill('..'))] : [root, path.join(root, 'src')];
      // `from pkg import money` may name a module, not only a symbol.
      const names = m[2] ? m[2].replace(/[()]/g, '').split(',').map((s) => s.trim()).filter((s) => /^\w+$/.test(s)) : [];
      for (const b of bases) {
        const p = path.join(b, ...rest);
        found.push(p + '.py', path.join(p, '__init__.py'), ...names.map((n) => path.join(p, n + '.py')));
      }
    }
  } else if (PROJ.test(file)) {
    for (const m of text.matchAll(/<ProjectReference\s+Include\s*=\s*"([^"]+)"/gi)) found.push(path.resolve(dir, m[1].replace(/\\/g, '/')));
  }
  return found.map(norm);
}

// The project's import graph, cached by file mtime: a hook on every edit re-reads only what changed.
function index(root) {
  const key = crypto.createHash('sha1').update(norm(root)).digest('hex').slice(0, 16);
  const cacheFile = path.join(process.env.RECEIPTS_CACHE_DIR || path.join(os.tmpdir(), 'claude-receipts'), `imports-${key}.json`);
  let old = {};
  try { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (c.v === INDEX_VERSION && c.root === norm(root)) old = c.files; } catch { /* first use */ }
  const stats = [];
  for (const file of sources(root)) {
    try { const st = fs.statSync(file); if (st.size <= MAX_BYTES) stats.push([file, norm(file), st.mtimeMs]); } catch { /* vanished */ }
  }
  const known = new Set(stats.map(([, k]) => k));
  const files = {};
  let dirty = Object.keys(old).length !== stats.length;
  for (const [file, k, m] of stats) {
    const prev = old[k];
    if (prev && prev.m === m) { files[k] = prev; continue; }
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { /* unreadable: no imports */ }
    files[k] = { m, rel: path.relative(root, file).replace(/\\/g, '/'), i: [...new Set(importsOf(file, text, root).filter((p) => known.has(p)))] };
    dirty = true;
  }
  if (dirty) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ v: INDEX_VERSION, root: norm(root), files }));
      fs.renameSync(tmp, cacheFile);
    } catch { /* cache is an optimisation only */ }
  }
  return files;
}

// The project a .NET source file belongs to: the nearest directory above it with a project file.
function ownerProject(files, file) {
  const byDir = new Map();
  for (const k of Object.keys(files)) if (PROJ.test(k) && !byDir.has(path.posix.dirname(k))) byDir.set(path.posix.dirname(k), k);
  for (let d = norm(path.dirname(path.resolve(file))); ; d = path.posix.dirname(d)) {
    if (byDir.has(d)) return byDir.get(d);
    if (path.posix.dirname(d) === d) return null;
  }
}

// Files that import any of `changed`, excluding the changed files themselves. A changed C#/F#/VB file stands for its
// project, and its dependents are the projects that reference that one.
function dependents(root, changed) {
  const files = index(root);
  const targets = new Set(changed.map((c) => (DOTNET_SRC.test(c) ? ownerProject(files, c) : norm(c))).filter(Boolean));
  const out = [];
  for (const [k, f] of Object.entries(files)) {
    if (targets.has(k)) continue;
    const hit = f.i.find((p) => targets.has(p));
    if (hit) out.push({ file: f.rel, imports: files[hit] ? files[hit].rel : path.relative(root, hit).replace(/\\/g, '/') });
  }
  return out;
}

// The subset of `files` (paths relative to root) that some test reaches, directly or through what it imports
// (`require('..')` → index.js → lib/express.js → lib/response.js). A dependent no test reaches can't be verified by
// running the suite, so there is nothing to send Claude back for.
function testedFiles(root, files) {
  const idx = index(root);
  const reached = new Set();
  const queue = Object.entries(idx).filter(([, f]) => isTestFile(f.rel)).flatMap(([, f]) => f.i);
  while (queue.length) {
    const k = queue.pop();
    if (reached.has(k)) continue;
    reached.add(k);
    if (idx[k]) queue.push(...idx[k].i);
  }
  return files.filter((f) => reached.has(norm(path.join(root, f))));
}

// Does a test run plausibly cover `dep` (a path relative to the project root)? An unfiltered, unscoped run does; a
// `cd`-scoped one covers what is inside that directory; a filtered one only if it names the dependent's directory or file.
function covers(cmd, dep, filtered, scope) {
  if (!filtered && !scope) return true;
  const d = dep.toLowerCase();
  if (!filtered && scope && d.startsWith(scope.replace(/^\.\//, '') + '/')) return true;
  const c = String(cmd).replace(/\\/g, '/').toLowerCase();
  const dir = path.posix.dirname(d);
  const top = d.split('/').slice(0, 2).join('/');
  return c.includes(path.posix.basename(d).replace(/\.\w+$/, '')) || (dir !== '.' && c.includes(dir)) || (top.includes('/') && c.includes(top));
}

// A directory given in lower case (scopes are), found on a case-sensitive file system.
function resolveIgnoringCase(root, rel) {
  if (path.isAbsolute(rel)) return rel;
  let cur = root;
  for (const seg of rel.split(/[\\/]/).filter(Boolean)) {
    let ents = [];
    try { ents = fs.readdirSync(cur); } catch { /* not a directory: no match below */ }
    cur = path.join(cur, ents.find((e) => e.toLowerCase() === seg.toLowerCase()) || seg);
  }
  return cur;
}

// The project file a `dotnet test <path>` run is limited to (a project, or a directory holding exactly one), or null
// when it runs a solution or everything under the directory.
function dotnetTarget(root, cmd, scope) {
  const m = /\bdotnet\s+test\b((?:\s+(?!-)[^\s;&|]+)?)/i.exec(String(cmd));
  if (!m) return null;
  const target = path.resolve(scope ? resolveIgnoringCase(root, scope) : root, m[1].trim().replace(/^["']|["']$/g, '') || '.');
  if (/\.slnx?$/i.test(target)) return null;
  if (PROJ.test(target)) return norm(target);
  let ents = [];
  try { ents = fs.readdirSync(target); } catch { return null; }
  if (ents.some((e) => /\.slnx?$/i.test(e))) return null;
  const projs = ents.filter((e) => PROJ.test(e));
  return projs.length === 1 ? norm(path.join(target, projs[0])) : null;
}

// Does `project` (a normalised project path) reach `dep` (relative to root) through its references?
function reaches(root, project, dep) {
  const idx = index(root);
  const want = norm(path.join(root, dep));
  const seen = new Set();
  const queue = [project];
  while (queue.length) {
    const k = queue.pop();
    if (k === want) return true;
    if (seen.has(k)) continue;
    seen.add(k);
    if (idx[k]) queue.push(...idx[k].i);
  }
  return false;
}

module.exports = { dependents, testedFiles, covers, isTestFile, importsOf, dotnetTarget, reaches, PROJ };
