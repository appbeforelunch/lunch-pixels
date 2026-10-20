// End-to-end tests: open index.html from disk in headless Chrome and drive it with real mouse and
// keyboard events through the DevTools protocol. Run: node --test tests/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { launch, findChrome } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const skip = findChrome() ? false : 'Chrome not installed (set CHROME_PATH)';

let b, page, work, downloads;
const errors = [];
const requests = [];
const downloadEvents = [];

// Encode an RGBA PNG with Node built-ins, so the tests need no image files on disk.
function encodePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function evaluate(expression) {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result.value;
}
// Run a function inside the page with JSON arguments.
const js = (fn, ...args) => evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
const frame = () => js(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn, label, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    if (await js(fn)) return;
    if (Date.now() - start > timeout) throw new Error('Timed out: ' + label);
    await sleep(50);
  }
}

const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

async function mouse(type, x, y, modifiers = 0, extra = {}) {
  const pressed = type === 'mousePressed' || (type === 'mouseMoved' && extra.held);
  await page('Input.dispatchMouseEvent', {
    type, x, y, modifiers,
    button: type === 'mouseMoved' && !extra.held ? 'none' : 'left',
    buttons: pressed ? 1 : 0,
    clickCount: extra.clickCount || 1,
  });
}

const toClient = (x, y) => js((x, y) => {
  const v = tessera.view, r = v.overlay.getBoundingClientRect(), p = v.docToScreen(x, y);
  return { x: r.left + p.x, y: r.top + p.y };
}, x, y);

// Drag through document-space points with the left button held.
async function dragDoc(points, modifiers = 0, steps = 6) {
  const pts = [];
  for (const p of points) pts.push(await toClient(p[0], p[1]));
  await mouse('mouseMoved', pts[0].x, pts[0].y, modifiers);
  await mouse('mousePressed', pts[0].x, pts[0].y, modifiers);
  for (let i = 1; i < pts.length; i++) {
    for (let s = 1; s <= steps; s++) {
      const x = pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * s) / steps;
      const y = pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * s) / steps;
      await mouse('mouseMoved', x, y, modifiers, { held: true });
    }
  }
  const last = pts[pts.length - 1];
  await mouse('mouseReleased', last.x, last.y, modifiers);
  await frame();
}

async function clickDoc(x, y, modifiers = 0) {
  const p = await toClient(x, y);
  await mouse('mouseMoved', p.x, p.y, modifiers);
  await mouse('mousePressed', p.x, p.y, modifiers);
  await mouse('mouseReleased', p.x, p.y, modifiers);
  await frame();
}

async function click(selector, clickCount = 1) {
  const r = await js((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, selector);
  assert.ok(r, 'element not found: ' + selector);
  await mouse('mouseMoved', r.x, r.y);
  await mouse('mousePressed', r.x, r.y, 0, { clickCount });
  await mouse('mouseReleased', r.x, r.y, 0, { clickCount });
  await frame();
}

async function menu(name, cmd) {
  await click(`[data-menu="${name}"]`);
  await click(`[data-cmd="${cmd}"]`);
}

const KEYS = {
  Enter: ['Enter', 13], Escape: ['Escape', 27], Delete: ['Delete', 46], Backspace: ['Backspace', 8], ' ': ['Space', 32],
  ArrowRight: ['ArrowRight', 39], '=': ['Equal', 187], '-': ['Minus', 189], '[': ['BracketLeft', 219], ']': ['BracketRight', 221],
};
async function key(k, modifiers = 0) {
  let code, vk;
  if (KEYS[k]) [code, vk] = KEYS[k];
  else if (/^[a-z]$/i.test(k)) { code = 'Key' + k.toUpperCase(); vk = k.toUpperCase().charCodeAt(0); }
  else if (/^[0-9]$/.test(k)) { code = 'Digit' + k; vk = k.charCodeAt(0); }
  const keyValue = k.length === 1 && modifiers & MOD.shift ? k.toUpperCase() : k;
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: keyValue, code, windowsVirtualKeyCode: vk, modifiers });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: keyValue, code, windowsVirtualKeyCode: vk, modifiers });
  await frame();
}

const layerPx = (x, y, i) => js((x, y, i) => {
  const ed = tessera.editor, l = i == null ? ed.activeLayer : ed.layers[i];
  return Array.from(l.ctx.getImageData(x, y, 1, 1).data);
}, x, y, i == null ? null : i);
const compPx = (x, y) => js((x, y) => Array.from(tessera.editor.composite().getContext('2d').getImageData(x, y, 1, 1).data), x, y);
const state = () => js(() => {
  const ed = tessera.editor;
  return {
    w: ed.width, h: ed.height, layers: ed.layers.map((l) => l.name), active: ed.activeLayer && ed.activeLayer.name,
    labels: ed.history.entries.map((e) => e.label), index: ed.history.index, sel: ed.selection && ed.selection.bounds,
    zoom: tessera.view.zoom, primary: ed.primary, tool: tessera.view.tool.id,
  };
});
const near = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const setPrimary = (hex) => js((h) => tessera.editor.setColor('primary', h), hex);
const setOptions = (tool, o) => js((t, o) => Object.assign(Tessera.toolOptions[t], o), tool, o);

before(async () => {
  if (skip) return;
  work = mkdtempSync(join(tmpdir(), 'tessera-test-'));
  downloads = join(work, 'downloads');
  b = await launch({ width: 1400, height: 900 });
  page = b.page;
  b.on((e) => {
    if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
    if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') errors.push(e.params.args.map((a) => a.value || a.description).join(' '));
    if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errors.push(e.params.entry.text + ' ' + (e.params.entry.url || ''));
    if (e.method === 'Network.requestWillBeSent') requests.push(e.params.request.url);
    if (e.method === 'Browser.downloadProgress') downloadEvents.push(e.params);
  });
  await page('Page.enable');
  await page('Runtime.enable');
  await page('Log.enable');
  await page('Network.enable');
  await page('DOM.enable');
  await b.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  const loaded = b.waitFor('Page.loadEventFired');
  await page('Page.navigate', { url: pathToFileURL(join(ROOT, 'index.html')).href });
  await loaded;
  await waitUntil(() => document.body.classList.contains('ready'), 'app ready');
});

after(async () => {
  if (b) await b.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

test('loads from file:// with its own name, toolbar and start screen', { skip }, async () => {
  const info = await js(() => ({
    title: document.title,
    brand: document.querySelector('.brand-name').textContent,
    tools: document.querySelectorAll('.tool-btn').length,
    menus: Array.from(document.querySelectorAll('.menu-title')).map((m) => m.textContent),
    start: getComputedStyle(document.getElementById('start')).display,
  }));
  assert.equal(info.title, 'Tessera — image editor');
  assert.equal(info.brand, 'Tessera');
  assert.equal(info.tools, 15);
  assert.deepEqual(info.menus, ['File', 'Edit', 'Image', 'Layer', 'Adjust', 'Filter', 'View', 'Help']);
  assert.notEqual(info.start, 'none');
  assert.deepEqual(errors, []);
});

test('opens an image chosen in the file picker and draws it on screen', { skip }, async () => {
  const file = join(work, 'fixture.png');
  writeFileSync(file, encodePng(80, 60, (x, y) => {
    if (x >= 30 && x < 50 && y >= 20 && y < 40) return [0, 255, 0, 255];
    return x < 40 ? [255, 0, 0, 255] : [0, 0, 255, 255];
  }));
  const { result } = await page('Runtime.evaluate', { expression: 'document.getElementById("file-input")' });
  await page('DOM.setFileInputFiles', { files: [file], objectId: result.objectId });
  await waitUntil(() => !!tessera.editor.doc, 'image opened');
  await frame();
  const s = await state();
  assert.equal(s.w, 80);
  assert.equal(s.h, 60);
  assert.deepEqual(s.layers, ['Background']);
  assert.deepEqual(s.labels, ['Open']);
  assert.equal(await js(() => tessera.editor.fileName), 'fixture');
  assert.deepEqual(await compPx(5, 5), [255, 0, 0, 255]);
  assert.deepEqual(await compPx(75, 5), [0, 0, 255, 255]);
  assert.deepEqual(await compPx(40, 30), [0, 255, 0, 255]);
  assert.equal(await js(() => getComputedStyle(document.getElementById('start')).display), 'none');
  // the visible canvas really shows the image: sample the screen pixel over the green square
  const onScreen = await js(() => {
    const v = tessera.view, p = v.docToScreen(40.5, 30.5);
    return Array.from(v.ctx.getImageData(Math.round(p.x * v.dpr), Math.round(p.y * v.dpr), 1, 1).data);
  });
  assert.deepEqual(onScreen, [0, 255, 0, 255]);
});

test('new canvas from the File menu; brush paints with a mouse drag; undo/redo by keyboard, button and history panel', { skip }, async () => {
  await menu('File', 'file.new');
  await js(() => { const d = tessera.ui.activeDialog; d.set('width', 300); d.set('height', 200); });
  await click('dialog [data-role="ok"]');
  let s = await state();
  assert.equal(s.w, 300);
  assert.equal(s.h, 200);
  assert.deepEqual(await compPx(150, 100), [255, 255, 255, 255]);

  await click('[data-tool="brush"]');
  assert.equal((await state()).tool, 'brush');
  await setOptions('brush', { size: 10, hardness: 100, opacity: 100 });
  await setPrimary('#ff0000');
  await dragDoc([[50, 100], [250, 100]]);
  assert.deepEqual(await layerPx(150, 100), [255, 0, 0, 255]);
  assert.deepEqual(await layerPx(150, 150), [255, 255, 255, 255]);
  s = await state();
  assert.deepEqual(s.labels, ['New Canvas', 'Brush']);

  await key('z', MOD.ctrl);
  assert.deepEqual(await layerPx(150, 100), [255, 255, 255, 255]);
  assert.equal((await state()).index, 0);
  await key('z', MOD.ctrl | MOD.shift);
  assert.deepEqual(await layerPx(150, 100), [255, 0, 0, 255]);

  await click('#btn-undo');
  assert.deepEqual(await layerPx(150, 100), [255, 255, 255, 255]);
  await click('#history-list li:last-child button');
  assert.deepEqual(await layerPx(150, 100), [255, 0, 0, 255]);
  assert.equal(await js(() => document.querySelector('#history-list .current').textContent), 'Brush');
});

test('brush opacity does not build up inside one stroke, and [ ] change the size', { skip }, async () => {
  await js(() => tessera.editor.addLayer('Glaze'));
  await setOptions('brush', { size: 16, hardness: 100, opacity: 50 });
  await setPrimary('#0000ff');
  // a zig-zag that crosses itself several times
  await dragDoc([[20, 20], [60, 40], [20, 40], [60, 20]]);
  const crossing = await layerPx(40, 30);
  assert.ok(Math.abs(crossing[3] - 128) <= 2, 'alpha stays at 50% where the stroke overlaps itself: ' + crossing);
  await key(']');
  assert.ok((await js(() => Tessera.toolOptions.brush.size)) > 16);
  await key('[');
  await key('[');
  assert.ok((await js(() => Tessera.toolOptions.brush.size)) < 16);
  await js(() => tessera.editor.deleteLayer());
  await setOptions('brush', { opacity: 100 });
});

test('layers: add, fill a selection, hide, opacity, reorder, merge, duplicate, rename, delete', { skip }, async () => {
  await click('#layer-add');
  let s = await state();
  assert.equal(s.layers.length, 2);
  await key('m');
  assert.equal((await state()).tool, 'marquee');
  await dragDoc([[20, 20], [80, 60]]);
  assert.deepEqual((await state()).sel, { x: 20, y: 20, w: 60, h: 40 });
  await setPrimary('#0000ff');
  await key('Backspace', MOD.alt);
  assert.deepEqual(await layerPx(50, 40), [0, 0, 255, 255]);
  assert.deepEqual(await layerPx(100, 100), [0, 0, 0, 0], 'fill stays inside the selection');
  assert.deepEqual(await compPx(150, 100), [255, 0, 0, 255], 'brush stroke below still shows');
  await key('d', MOD.ctrl);
  assert.equal((await state()).sel, null);

  await click('#layer-list li:first-child .eye');
  assert.deepEqual(await compPx(50, 40), [255, 255, 255, 255]);
  await click('#layer-list li:first-child .eye');
  assert.deepEqual(await compPx(50, 40), [0, 0, 255, 255]);

  await js(() => {
    const r = document.getElementById('layer-opacity');
    r.value = 50;
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.ok(near(await compPx(50, 40), [128, 128, 255, 255]));
  assert.equal((await state()).labels.at(-1), 'Layer Opacity');

  await js(() => {
    const sel = document.getElementById('layer-blend');
    sel.value = 'multiply';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await js(() => tessera.editor.activeLayer.blend), 'multiply');
  assert.match(await js(() => document.querySelector('#layer-list .active .layer-meta').textContent), /Multiply · 50%/);

  await click('#layer-down');
  s = await state();
  assert.equal(s.layers[1], 'Background', 'background now on top');
  assert.deepEqual(await compPx(50, 40), [255, 255, 255, 255]);
  await click('#layer-up');
  assert.equal((await state()).layers[0], 'Background');

  await click('#layer-merge');
  s = await state();
  assert.deepEqual(s.layers, ['Background']);
  assert.ok(near(await compPx(50, 40), [128, 128, 255, 255]), 'merged result keeps the look');

  await key('j', MOD.ctrl);
  s = await state();
  assert.deepEqual(s.layers, ['Background', 'Background copy']);
  await click('#layer-list li:first-child .layer-name', 2);
  await js(() => {
    const i = document.querySelector('#layer-list input.rename');
    i.value = 'Renamed';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  assert.equal((await state()).active, 'Renamed');
  await click('#layer-del');
  assert.deepEqual((await state()).layers, ['Background']);
});

test('adjustments and filters from the menus, with live preview, cancel, and selection limits', { skip }, async () => {
  await menu('Adjust', 'adjust.invert');
  assert.deepEqual(await compPx(150, 100), [0, 255, 255, 255]);
  assert.equal((await state()).labels.at(-1), 'Invert');
  await key('z', MOD.ctrl);
  assert.deepEqual(await compPx(150, 100), [255, 0, 0, 255]);

  const before = await layerPx(150, 109);
  await menu('Filter', 'filter.gaussian-blur');
  assert.equal(await js(() => document.querySelector('dialog[open] .dlg-title').textContent), 'Gaussian Blur');
  await js(() => tessera.ui.activeDialog.set('radius', 6));
  await js(() => document.querySelector('dialog[open] input[name="radius"]').dispatchEvent(new Event('input')));
  await frame();
  const previewed = await layerPx(150, 109);
  assert.notDeepEqual(previewed, before, 'live preview changed the pixels');
  await click('dialog [data-role="cancel"]');
  assert.deepEqual(await layerPx(150, 109), before, 'cancel restores the original');
  const afterCancel = await state();
  assert.equal(afterCancel.labels[afterCancel.index], 'Delete Layer', 'cancel added no history');

  await menu('Filter', 'filter.gaussian-blur');
  await click('dialog [data-role="ok"]');
  assert.equal((await state()).labels.at(-1), 'Gaussian Blur');
  const blurred = await layerPx(150, 109);
  assert.ok(blurred[1] < 255 && blurred[0] === 255, 'white next to the red stroke picked up some red: ' + blurred);

  // brightness limited to a selection on the left half
  await js(() => tessera.editor.setSelection(TesseraCore.rectMask(300, 200, 0, 0, 100, 200)));
  await js(() => tessera.ui.run('adjust.brightness-contrast'));
  await js(() => tessera.ui.activeDialog.set('brightness', -60));
  await click('dialog [data-role="ok"]');
  const left = await compPx(50, 170), right = await compPx(250, 170);
  assert.ok(left[0] < 150, 'left half darkened: ' + left);
  assert.deepEqual(right, [255, 255, 255, 255], 'right half untouched');
  await key('d', MOD.ctrl);

  // every adjustment and filter can be applied with its defaults and undone
  const ok = await js(() => {
    const ed = tessera.editor, ui = tessera.ui, n = ed.history.index;
    const all = TesseraCore.ADJUSTMENTS.concat(TesseraCore.FILTERS);
    for (const e of all) {
      ui.runEffect(e);
      if (ui.activeDialog) ui.activeDialog.ok();
      if (ed.history.current.label !== e.name) return 'missing history for ' + e.name;
      ed.undo();
    }
    return ed.history.index === n ? true : 'history index drifted';
  });
  assert.equal(ok, true);
});

test('zoom with keys, buttons and ctrl+wheel; pan with space-drag', { skip }, async () => {
  const z0 = (await state()).zoom;
  await key('=', MOD.ctrl);
  const z1 = (await state()).zoom;
  assert.ok(z1 > z0);
  await key('-', MOD.ctrl);
  assert.equal((await state()).zoom, z0);
  await key('1', MOD.ctrl);
  assert.equal((await state()).zoom, 1);
  assert.equal(await js(() => document.getElementById('zoom-label').textContent), '100%');
  await click('#zoom-in');
  assert.equal((await state()).zoom, 1.5);
  await click('#zoom-out');
  await click('#zoom-out');
  assert.equal((await state()).zoom, 0.6667);

  const anchor = await toClient(100, 50);
  await page('Input.dispatchMouseEvent', { type: 'mouseWheel', x: anchor.x, y: anchor.y, deltaX: 0, deltaY: -300, modifiers: MOD.ctrl });
  await frame();
  const z2 = (await state()).zoom;
  assert.ok(z2 > 0.6667, 'wheel zoomed in');
  const after = await toClient(100, 50);
  assert.ok(Math.abs(after.x - anchor.x) < 1 && Math.abs(after.y - anchor.y) < 1, 'point under the cursor stayed put');

  const pan0 = await js(() => [tessera.view.panX, tessera.view.panY]);
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await dragDoc([[100, 50], [140, 70]]);
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  const pan1 = await js(() => [tessera.view.panX, tessera.view.panY]);
  assert.ok(Math.abs(pan1[0] - pan0[0] - 40 * z2) < 2 && Math.abs(pan1[1] - pan0[1] - 20 * z2) < 2, 'space-drag panned');
  assert.equal((await state()).tool, 'marquee');
  assert.equal((await state()).sel, null, 'space-drag did not make a selection');
  const afterPan = await state();
  assert.equal(afterPan.labels[afterPan.index], 'Brightness / Contrast', 'panning added no history');

  await key('0', MOD.ctrl);
  assert.ok((await state()).zoom > 1, 'fit on screen scales a small image up');
});

test('crop tool, rotate, canvas size and image size are all undoable', { skip }, async () => {
  await key('c');
  await dragDoc([[10, 10], [110, 60]]);
  await key('Enter');
  let s = await state();
  assert.equal(s.w, 100);
  assert.equal(s.h, 50);
  assert.equal(s.labels.at(-1), 'Crop');
  await key('z', MOD.ctrl);
  s = await state();
  assert.equal(s.w, 300);
  assert.equal(s.h, 200);

  await menu('Image', 'image.rotateCW');
  s = await state();
  assert.equal(s.w, 200);
  assert.equal(s.h, 300);
  await key('z', MOD.ctrl);

  await js(() => { tessera.ui.run('image.canvasSize'); tessera.ui.activeDialog.set('width', 400); });
  await click('dialog [data-role="ok"]');
  s = await state();
  assert.equal(s.w, 400);
  assert.equal((await compPx(10, 100))[3], 0, 'new space is transparent');
  const mid = await compPx(200, 100);
  assert.ok(mid[0] === 255 && mid[1] < 100, 'red stroke stayed centred: ' + mid);
  await key('z', MOD.ctrl);

  await js(() => tessera.ui.run('image.size'));
  await js(() => {
    const i = document.querySelector('dialog[open] input[name="width"]');
    i.value = 150;
    i.dispatchEvent(new Event('input'));
  });
  assert.equal(await js(() => document.querySelector('dialog[open] input[name="height"]').value), '100', 'proportions kept');
  await click('dialog [data-role="ok"]');
  s = await state();
  assert.deepEqual([s.w, s.h], [150, 100]);
  await key('z', MOD.ctrl);
  s = await state();
  assert.deepEqual([s.w, s.h], [300, 200]);
});

test('shape, magic wand + delete, bucket, eyedropper, gradient, eraser', { skip }, async () => {
  await js(() => tessera.editor.newDocument(200, 100, '#ffffff'));
  await setOptions('shape', { kind: 'rect', fill: true, stroke: false });
  await setPrimary('#00aa00');
  await key('u');
  await dragDoc([[20, 20], [60, 60]]);
  assert.deepEqual(await layerPx(40, 40), [0, 170, 0, 255]);
  assert.deepEqual(await layerPx(70, 40), [255, 255, 255, 255]);

  await key('w');
  await setOptions('wand', { tolerance: 10, contiguous: true });
  await clickDoc(40, 40);
  assert.deepEqual((await state()).sel, { x: 20, y: 20, w: 40, h: 40 });
  await key('Delete');
  assert.equal((await layerPx(40, 40))[3], 0, 'delete cleared the selected pixels');
  await key('z', MOD.ctrl);
  await key('d', MOD.ctrl);

  await key('k');
  await setPrimary('#ff00ff');
  await clickDoc(40, 40);
  assert.deepEqual(await layerPx(40, 40), [255, 0, 255, 255]);
  assert.deepEqual(await layerPx(100, 50), [255, 255, 255, 255]);

  await key('i');
  await clickDoc(150, 50);
  assert.equal((await state()).primary, '#ffffff');
  await clickDoc(40, 40);
  assert.equal((await state()).primary, '#ff00ff');
  assert.equal(await js(() => document.getElementById('color-hex').textContent), '#FF00FF');

  await js(() => { tessera.editor.addLayer('Gradient'); tessera.editor.setColor('primary', '#000000'); tessera.editor.setColor('secondary', '#ffffff'); });
  await key('g');
  await dragDoc([[0, 80], [200, 80]]);
  const dark = await layerPx(10, 50), light = await layerPx(190, 50);
  assert.ok(dark[0] < 30 && light[0] > 225, `gradient runs dark to light: ${dark} → ${light}`);
  await js(() => tessera.editor.deleteLayer());

  await key('e');
  await setOptions('eraser', { size: 20, hardness: 100, opacity: 100 });
  await dragDoc([[100, 10], [100, 90]]);
  assert.equal((await layerPx(100, 50))[3], 0, 'erased to transparency');
  assert.equal((await layerPx(130, 50))[3], 255);
});

test('selection tools: lasso and ellipse with add / subtract modifiers', { skip }, async () => {
  await key('l');
  await dragDoc([[10, 10], [90, 10], [90, 90], [10, 90], [10, 10]]);
  let s = await state();
  assert.ok(s.sel && Math.abs(s.sel.x - 10) <= 1 && Math.abs(s.sel.w - 80) <= 2, 'lasso selection: ' + JSON.stringify(s.sel));
  await key('o');
  await dragDoc([[100, 0], [200, 100]], MOD.shift);
  s = await state();
  assert.ok(s.sel.w > 180, 'shift added the ellipse');
  const inside = await js(() => { const m = tessera.editor.selection.mask; return [m[50 * 200 + 150], m[2 * 200 + 102]]; });
  assert.deepEqual(inside, [255, 0], 'ellipse covers its centre, not its corner');
  await key('m');
  await dragDoc([[0, 0], [100, 100]], MOD.alt);
  s = await state();
  assert.ok(s.sel && s.sel.x >= 100, 'alt subtracted the left half: ' + JSON.stringify(s.sel));
  await dragDoc([[100, 0], [200, 100]], MOD.alt);
  assert.equal((await state()).sel, null, 'nothing left after subtracting the rest');
});

test('move tool drags a layer; text tool adds a text layer from typed input', { skip }, async () => {
  await js(() => {
    const ed = tessera.editor;
    ed.addLayer('Square');
    ed.setSelection(TesseraCore.rectMask(200, 100, 0, 0, 10, 10));
    ed.fillSelection('#000000');
    ed.deselect();
  });
  await key('v');
  await dragDoc([[5, 5], [55, 25]]);
  assert.deepEqual(await layerPx(55, 25), [0, 0, 0, 255]);
  assert.equal((await layerPx(5, 5))[3], 0);
  assert.equal((await state()).labels.at(-1), 'Move');
  await key('ArrowRight');
  assert.deepEqual(await layerPx(56, 25), [0, 0, 0, 255], 'arrow key nudged the layer 1px');
  assert.equal((await state()).labels.at(-1), 'Nudge');

  await key('t');
  await setPrimary('#123456');
  await clickDoc(110, 20);
  await waitUntil(() => document.activeElement && document.activeElement.classList.contains('text-entry'), 'text box focused');
  await page('Input.insertText', { text: 'Hi' });
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: MOD.ctrl });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: MOD.ctrl });
  await frame();
  const s = await state();
  assert.equal(s.active, 'Text: Hi');
  assert.equal(s.labels.at(-1), 'Text');
  const inked = await js(() => {
    const d = tessera.editor.activeLayer.ctx.getImageData(100, 10, 100, 90).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
    return n;
  });
  assert.ok(inked > 50, 'text pixels drawn: ' + inked);
  assert.equal(await js(() => document.querySelectorAll('.text-entry').length), 0);
});

test('copy and paste through the Edit menu, flip, flatten', { skip }, async () => {
  await js(() => { const ed = tessera.editor; ed.setActive(ed.layers[0].id); ed.setSelection(TesseraCore.rectMask(200, 100, 20, 20, 40, 40)); });
  await key('c', MOD.ctrl);
  await menu('Edit', 'edit.paste');
  let s = await state();
  assert.equal(s.active, 'Pasted');
  assert.deepEqual(await layerPx(40, 40), [255, 0, 255, 255]);
  assert.equal((await layerPx(10, 10))[3], 0);

  await menu('Image', 'image.flipH');
  assert.deepEqual(await layerPx(159, 40), [255, 0, 255, 255], 'pasted square mirrored');
  await menu('Image', 'image.flatten');
  s = await state();
  assert.deepEqual(s.layers, ['Background']);
  await key('z', MOD.ctrl);
  assert.ok((await state()).layers.length > 1, 'flatten undone');
});

test('export writes real PNG and JPEG files through the browser download', { skip }, async () => {
  await key('s', MOD.ctrl);
  assert.equal(await js(() => document.querySelector('dialog[open] .dlg-title').textContent), 'Export image');
  await js(() => tessera.ui.activeDialog.set('name', 'tessera-test'));
  const done = b.waitFor('Browser.downloadProgress', (p) => p.state === 'completed');
  await click('dialog [data-role="ok"]');
  await done;
  const pngPath = join(downloads, 'tessera-test.png');
  await waitFile(pngPath);
  const png = readFileSync(pngPath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 200, 'PNG width');
  assert.equal(png.readUInt32BE(20), 100, 'PNG height');
  assert.equal(await js(() => tessera.editor.dirty), false);
  assert.ok(!(await js(() => document.title)).includes('•'));

  const done2 = b.waitFor('Browser.downloadProgress', (p) => p.state === 'completed');
  const info = await js(() => tessera.ui.exportImage({ name: 'tessera-test', format: 'jpeg', quality: 80 }));
  await done2;
  assert.equal(info.type, 'image/jpeg');
  const jpgPath = join(downloads, 'tessera-test.jpg');
  await waitFile(jpgPath);
  const jpg = readFileSync(jpgPath);
  assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff]);

  const webp = await js(async () => {
    const blob = await tessera.editor.exportBlob('image/webp', 0.8);
    return blob.type;
  });
  assert.equal(webp, 'image/webp');
});

async function waitFile(p) {
  for (let i = 0; i < 100 && !existsSync(p); i++) await sleep(50);
  assert.ok(existsSync(p), 'downloaded file exists: ' + p);
}

test('dialogs: escape cancels, and discarding unsaved work asks first', { skip }, async () => {
  await js(() => tessera.ui.run('help.shortcuts'));
  assert.equal(await js(() => !!document.querySelector('dialog[open]')), true);
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await frame();
  assert.equal(await js(() => !!document.querySelector('dialog[open]')), false);

  await js(() => tessera.editor.fillSelection('#000000')); // make the document dirty
  await menu('File', 'file.close');
  assert.equal(await js(() => document.querySelector('dialog[open] .dlg-title').textContent), 'Discard unsaved changes?');
  await click('dialog [data-role="cancel"]');
  assert.ok(await js(() => !!tessera.editor.doc), 'still open after cancel');
  await menu('File', 'file.close');
  await click('dialog [data-role="ok"]');
  assert.equal(await js(() => tessera.editor.doc), null);
  assert.notEqual(await js(() => getComputedStyle(document.getElementById('start')).display), 'none');
});

test('nothing was sent over the network and no errors were logged', { skip }, async () => {
  const remote = requests.filter((u) => !/^(file|data|blob):/.test(u));
  assert.deepEqual(remote, []);
  assert.ok(requests.some((u) => u.endsWith('/js/editor.js')), 'request log is working');
  assert.deepEqual(errors, []);
});
