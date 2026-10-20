// A tiny Chrome DevTools Protocol driver: launches headless Chrome and talks to it over WebSocket.
// Uses only Node built-ins (Node 22+ has a global WebSocket).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
}

export async function launch({ width = 1400, height = 900 } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('Chrome not found. Set CHROME_PATH to run the browser tests.');
  const profile = mkdtempSync(join(tmpdir(), 'tessera-chrome-'));
  const proc = spawn(exe, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start: ' + buf)), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error('Chrome exited early with code ' + code + ': ' + buf)));
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message + (data.error.data ? ': ' + data.error.data : '')));
      else resolve(data.result);
    } else if (data.method) {
      for (const l of listeners) l(data);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);

  return {
    send,
    page,
    on(fn) { listeners.push(fn); },
    waitFor(method, predicate = () => true, timeout = 15000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Timed out waiting for ' + method)), timeout);
        const fn = (e) => {
          if (e.method === method && predicate(e.params)) {
            clearTimeout(t);
            listeners.splice(listeners.indexOf(fn), 1);
            resolve(e.params);
          }
        };
        listeners.push(fn);
      });
    },
    async close() {
      try { await send('Browser.close'); } catch { /* already gone */ }
      ws.close();
      await new Promise((r) => { if (proc.exitCode != null) r(); else { proc.on('exit', r); setTimeout(() => { proc.kill('SIGKILL'); r(); }, 3000); } });
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
