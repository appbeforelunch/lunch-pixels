// Static checks on the source files: offline-only, no third-party names, nothing missing. Run: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Files that belong to the project brief or the build harness rather than to the app.
const IGNORE = new Set(['.git', 'node_modules', 'PROMPT.md', 'precheck.txt', '.DS_Store', 'audit-runs']);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (IGNORE.has(name) || /^session-/.test(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const rel = (p) => path.relative(ROOT, p);
const text = (p) => fs.readFileSync(p, 'utf8');
const appFiles = files.filter((p) => /\.(html|css|js)$/.test(p) && !rel(p).startsWith('tests'));

test('no third-party product or company names in any file', () => {
  // spelled in pieces so this file does not contain the words itself
  const banned = [['ado', 'be'], ['photo', 'shop']].map((w) => new RegExp(w.join(''), 'i'));
  for (const p of files) {
    for (const re of banned) assert.ok(!re.test(text(p)) && !re.test(rel(p)), `${rel(p)} mentions a banned name`);
  }
});

test('the app makes no network calls and loads nothing remote', () => {
  for (const p of appFiles) {
    const src = text(p);
    assert.ok(!/https?:\/\//i.test(src), `${rel(p)} references a remote URL`);
    assert.ok(!/\/\/[a-z0-9.-]+\.(com|net|org|io)\b/i.test(src), `${rel(p)} references a protocol-relative URL`);
    for (const api of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'importScripts', '@import', '@font-face']) {
      assert.ok(!src.includes(api), `${rel(p)} uses ${api}`);
    }
  }
  const html = text(path.join(ROOT, 'index.html'));
  assert.match(html, /Content-Security-Policy[^>]+connect-src 'none'/, 'CSP blocks connections');
});

test('index.html references only local files that exist, with no build step or packages', () => {
  const html = text(path.join(ROOT, 'index.html'));
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 10);
  for (const r of refs) assert.ok(fs.existsSync(path.join(ROOT, r)), `missing ${r}`);
  assert.ok(!fs.existsSync(path.join(ROOT, 'package.json')), 'no package.json');
  assert.ok(!fs.existsSync(path.join(ROOT, 'node_modules')), 'no node_modules');
  for (const p of appFiles.filter((f) => f.endsWith('.js'))) {
    assert.ok(!/^\s*(import|export)\s/m.test(text(p)), `${rel(p)} uses ES modules, which file:// pages cannot load`);
  }
});

test('README explains what it does, how to open it and what it cannot do yet', () => {
  const readme = text(path.join(ROOT, 'README.md'));
  assert.match(readme, /index\.html/);
  assert.match(readme, /can.t do yet|limitations/i);
});
