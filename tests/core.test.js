// Unit tests for the pure image-processing core (no browser needed). Run: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

for (const f of ['color', 'geometry', 'history', 'imageops', 'effects']) require(path.join(__dirname, '..', 'js', 'core', f + '.js'));
const C = globalThis.TesseraCore;

function solid(w, h, rgba) {
  const img = C.createImage(w, h);
  for (let i = 0; i < img.data.length; i += 4) img.data.set(rgba, i);
  return img;
}
function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}
function setPx(img, x, y, rgba) {
  img.data.set(rgba, (y * img.width + x) * 4);
}

test('colour conversions round-trip', () => {
  assert.deepEqual(C.hexToRgb('#ff8000'), [255, 128, 0]);
  assert.deepEqual(C.hexToRgb('fff'), [255, 255, 255]);
  assert.equal(C.hexToRgb('nope'), null);
  assert.equal(C.rgbToHex(255, 128, 0), '#ff8000');
  for (const rgb of [[10, 200, 30], [255, 0, 0], [128, 128, 128], [0, 0, 0], [12, 34, 250]]) {
    const hsl = C.rgbToHsl(...rgb);
    assert.deepEqual(C.hslToRgb(...hsl), rgb);
  }
});

test('history: undo, redo, branch truncation and limit', () => {
  const h = new C.History(3);
  h.push('a'); h.push('b'); h.push('c');
  assert.equal(h.undo(), 'b');
  assert.equal(h.undo(), 'a');
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), 'b');
  h.push('d'); // drops 'c'
  assert.deepEqual(h.entries, ['a', 'b', 'd']);
  assert.equal(h.canRedo(), false);
  h.push('e'); // limit 3 drops 'a'
  assert.deepEqual(h.entries, ['b', 'd', 'e']);
  assert.equal(h.index, 2);
  assert.equal(h.jump(0), 'b');
  assert.equal(h.jump(7), null);
});

test('geometry: zoom steps, fit and zoom-around keep the anchor point fixed', () => {
  assert.equal(C.nextZoom(1, 1), 1.5);
  assert.equal(C.nextZoom(1, -1), 0.6667);
  assert.equal(C.nextZoom(32, 1), 32);
  assert.equal(C.fitZoom(2000, 1000, 1032, 600, 16, 1), 0.5);
  assert.equal(C.fitZoom(100, 100, 1000, 1000, 0, 1), 1);
  const v = { zoom: 1, panX: 10, panY: 20 };
  const n = C.zoomAround(v, 4, 110, 220);
  // the document point under (110, 220) was (100, 200); it must still be there
  assert.equal((110 - n.panX) / n.zoom, 100);
  assert.equal((220 - n.panY) / n.zoom, 200);
  assert.deepEqual(C.normRect(10, 50, 0, 20), { x: 0, y: 20, w: 10, h: 30 });
  assert.deepEqual(C.clampRect({ x: -5, y: 2.4, w: 20, h: 300 }, 10, 100), { x: 0, y: 2, w: 10, h: 98 });
  assert.deepEqual(C.anchorOffset(100, 100, 200, 300, 'bottom-right'), { x: 100, y: 200 });
  assert.deepEqual(C.anchorOffset(100, 100, 200, 300, 'center'), { x: 50, y: 100 });
  const sq = C.constrainSquare({ x: 0, y: 0 }, { x: 10, y: -3 });
  assert.deepEqual(sq, { x: 10, y: -10 });
  const ang = C.constrainAngle({ x: 0, y: 0 }, { x: 10, y: 1 }, 45);
  assert.ok(Math.abs(ang.y) < 1e-9 && Math.abs(ang.x - Math.hypot(10, 1)) < 1e-9);
});

test('adjustments never modify their input', () => {
  const img = solid(4, 4, [100, 150, 200, 255]);
  const before = Array.from(img.data);
  for (const e of C.ADJUSTMENTS.concat(C.FILTERS)) {
    const params = C.effectDefaults(e);
    const out = e.run(img, params);
    assert.equal(out.width, 4, e.id);
    assert.equal(out.data.length, img.data.length, e.id);
    assert.notEqual(out.data, img.data, e.id);
  }
  assert.deepEqual(Array.from(img.data), before);
});

test('brightness/contrast, exposure, invert, grayscale, threshold, posterize', () => {
  const img = solid(2, 2, [100, 150, 200, 255]);
  assert.deepEqual(px(C.brightnessContrast(img, 0, 0), 0, 0), [100, 150, 200, 255]);
  assert.ok(px(C.brightnessContrast(img, 50, 0), 0, 0)[0] > 100);
  const lowContrast = px(C.brightnessContrast(img, 0, -100), 0, 0);
  assert.ok(lowContrast.slice(0, 3).every((v) => Math.abs(v - 128) <= 1), 'contrast -100 flattens to mid grey');
  assert.deepEqual(px(C.exposure(img, 1), 0, 0), [200, 255, 255, 255]);
  assert.deepEqual(px(C.invert(img), 1, 1), [155, 105, 55, 255]);
  const g = px(C.grayscale(img), 0, 0);
  assert.equal(g[0], g[1]);
  assert.equal(g[1], g[2]);
  assert.equal(g[0], Math.round(0.299 * 100 + 0.587 * 150 + 0.114 * 200));
  assert.deepEqual(px(C.threshold(img, 100), 0, 0), [255, 255, 255, 255]);
  assert.deepEqual(px(C.threshold(img, 200), 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(C.posterize(img, 2), 0, 0), [0, 255, 255, 255]);
});

test('levels maps the input range to the output range', () => {
  const img = solid(1, 1, [50, 100, 200, 255]);
  assert.deepEqual(px(C.levels(img, 50, 200, 1, 0, 255), 0, 0), [0, 85, 255, 255]);
  assert.deepEqual(px(C.levels(img, 0, 255, 1, 100, 100), 0, 0), [100, 100, 100, 255]);
});

test('hue/saturation: hue 180 swaps red to cyan, -100 saturation is grey', () => {
  const red = solid(1, 1, [255, 0, 0, 255]);
  assert.deepEqual(px(C.hueSaturation(red, 180, 0, 0), 0, 0), [0, 255, 255, 255]);
  const grey = px(C.hueSaturation(red, 0, -100, 0), 0, 0);
  assert.equal(grey[0], grey[1]);
  assert.equal(grey[1], grey[2]);
  assert.deepEqual(px(C.hueSaturation(red, 0, 0, 100), 0, 0), [255, 255, 255, 255]);
});

test('colour balance, warmth, sepia and vibrance move colours the right way', () => {
  const img = solid(1, 1, [100, 100, 100, 255]);
  const cb = px(C.colorBalance(img, 100, 0, -100), 0, 0);
  assert.ok(cb[0] > 200 && cb[1] === 100 && cb[2] < 1);
  const warm = px(C.temperature(img, 50), 0, 0);
  assert.ok(warm[0] > 100 && warm[2] < 100);
  const sep = px(C.sepia(solid(1, 1, [100, 100, 100, 255]), 100), 0, 0);
  assert.ok(sep[0] > sep[1] && sep[1] > sep[2]);
  const muted = solid(1, 1, [120, 100, 100, 255]);
  const v = px(C.vibrance(muted, 100), 0, 0);
  assert.ok(v[0] - v[1] > 20, 'difference between channels grows');
  assert.deepEqual(px(C.vibrance(img, 100), 0, 0), [100, 100, 100, 255], 'greys stay grey');
});

test('gaussian and box blur spread a single bright pixel and keep total energy', () => {
  const img = solid(21, 21, [0, 0, 0, 255]);
  setPx(img, 10, 10, [255, 255, 255, 255]);
  for (const out of [C.gaussianBlur(img, 2), C.boxBlur(img, 2)]) {
    const centre = px(out, 10, 10)[0];
    assert.ok(centre > 0 && centre < 255, 'centre dimmed');
    assert.ok(px(out, 11, 10)[0] > 0, 'neighbour lit');
    assert.equal(px(out, 0, 0)[0], 0, 'far corner untouched');
    let sum = 0;
    for (let i = 0; i < out.data.length; i += 4) sum += out.data[i];
    assert.ok(Math.abs(sum - 255) < 30, `energy roughly preserved (${sum})`);
  }
});

test('blur does not darken the edges of a shape on a transparent layer', () => {
  const img = C.createImage(10, 10); // fully transparent
  for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) setPx(img, x, y, [255, 255, 255, 255]);
  const out = C.gaussianBlur(img, 1.5);
  const edge = px(out, 2, 5);
  assert.ok(edge[3] > 0 && edge[3] < 255, 'alpha feathered');
  assert.ok(edge[0] > 250, 'colour stays white (premultiplied blur)');
});

test('sharpen, emboss, find edges, median, noise, pixelate, vignette', () => {
  const flat = solid(8, 8, [90, 90, 90, 255]);
  assert.deepEqual(px(C.sharpen(flat, 50), 4, 4), [90, 90, 90, 255], 'flat areas unchanged by sharpen');
  assert.deepEqual(px(C.findEdges(flat), 4, 4), [255, 255, 255, 255], 'no edges on a flat image');
  assert.deepEqual(px(C.emboss(flat), 4, 4), [90, 90, 90, 255]);

  const step = solid(8, 8, [0, 0, 0, 255]);
  for (let y = 0; y < 8; y++) for (let x = 4; x < 8; x++) setPx(step, x, y, [255, 255, 255, 255]);
  assert.ok(px(C.findEdges(step), 4, 4)[0] < 50, 'edge found at the step');
  assert.ok(px(C.sharpen(step, 50), 4, 4)[0] === 255 && px(C.sharpen(step, 50), 3, 4)[0] === 0);

  const speck = solid(5, 5, [10, 10, 10, 255]);
  setPx(speck, 2, 2, [250, 250, 250, 255]);
  assert.equal(px(C.median(speck, 1), 2, 2)[0], 10, 'median removes a lone speck');

  const n1 = C.addNoise(flat, 30, true, 5), n2 = C.addNoise(flat, 30, true, 5);
  assert.deepEqual(Array.from(n1.data), Array.from(n2.data), 'noise is deterministic per seed');
  const np = px(n1, 3, 3);
  assert.equal(np[0], np[1], 'monochrome noise keeps channels equal');
  assert.ok(Array.from(n1.data).some((v, i) => i % 4 !== 3 && v !== 90));

  const grad = C.createImage(4, 1);
  [[0, 0, 0, 255], [100, 100, 100, 255], [200, 200, 200, 255], [255, 255, 255, 255]].forEach((c, x) => setPx(grad, x, 0, c));
  const pix = C.pixelate(grad, 2);
  assert.deepEqual(px(pix, 0, 0), [50, 50, 50, 255]);
  assert.deepEqual(px(pix, 1, 0), [50, 50, 50, 255]);
  assert.deepEqual(px(pix, 3, 0), [228, 228, 228, 255]);

  const vig = C.vignette(solid(21, 21, [200, 200, 200, 255]), 100);
  assert.equal(px(vig, 10, 10)[0], 200, 'centre untouched');
  assert.ok(px(vig, 0, 0)[0] < 20, 'corner darkened');
});

test('flood fill: contiguous vs global, tolerance and transparency', () => {
  const img = solid(6, 3, [255, 255, 255, 255]);
  for (let y = 0; y < 3; y++) setPx(img, 2, y, [0, 0, 0, 255]); // a wall at x=2
  setPx(img, 5, 0, [250, 250, 250, 255]);
  const m = C.floodFillMask(img, 0, 0, 0, true);
  assert.equal(m.filter(Boolean).length, 6, 'left of the wall only');
  const m2 = C.floodFillMask(img, 0, 0, 10, true);
  assert.equal(m2.filter(Boolean).length, 6);
  const g = C.floodFillMask(img, 0, 0, 10, false);
  assert.equal(g.filter(Boolean).length, 15, 'every near-white pixel when not contiguous');
  const g0 = C.floodFillMask(img, 0, 0, 0, false);
  assert.equal(g0.filter(Boolean).length, 14);
  assert.equal(C.floodFillMask(img, -1, 0, 0, true).filter(Boolean).length, 0);

  const clear = C.createImage(4, 4);
  clear.data[3] = 0;
  clear.data[4] = 99; // transparent pixels with junk rgb still count as the same
  assert.equal(C.floodFillMask(clear, 3, 3, 0, true).filter(Boolean).length, 16);
});

test('flood fill handles a large maze without stack overflow', () => {
  const w = 600, h = 600, img = solid(w, h, [255, 255, 255, 255]);
  for (let x = 0; x < w; x += 4) for (let y = x % 8 ? 0 : 1; y < h - (x % 8 ? 1 : 0); y++) setPx(img, x, y, [0, 0, 0, 255]);
  const m = C.floodFillMask(img, 1, 1, 0, true);
  assert.ok(m.filter(Boolean).length > w * h * 0.6);
});

test('selection masks: rect, combine, invert, bounds and outline', () => {
  const a = C.rectMask(10, 10, 1, 1, 4, 4);
  assert.equal(a.filter(Boolean).length, 16);
  assert.deepEqual(C.maskBounds(a, 10, 10), { x: 1, y: 1, w: 4, h: 4 });
  const b = C.rectMask(10, 10, 3, 3, 4, 4);
  assert.equal(C.combineMasks(a, b, 'add').filter(Boolean).length, 28);
  assert.equal(C.combineMasks(a, b, 'subtract').filter(Boolean).length, 12);
  assert.equal(C.combineMasks(a, b, 'intersect').filter(Boolean).length, 4);
  assert.equal(C.combineMasks(a, b, 'replace').filter(Boolean).length, 16);
  assert.equal(C.combineMasks(null, b, 'subtract').filter(Boolean).length, 0);
  assert.equal(C.invertMask(a).filter(Boolean).length, 84);
  assert.equal(C.maskBounds(new Uint8Array(100), 10, 10), null);
  assert.ok(C.isMaskEmpty(new Uint8Array(5)));
  assert.equal(C.rectMask(10, 10, -5, -5, 7, 7).filter(Boolean).length, 4, 'clipped to the image');

  // a 4x4 square has an outline of four merged segments, total length 16
  const segs = C.maskOutline(a, 10, 10);
  assert.equal(segs.length / 4, 4);
  let len = 0;
  for (let i = 0; i < segs.length; i += 4) len += Math.abs(segs[i + 2] - segs[i]) + Math.abs(segs[i + 3] - segs[i + 1]);
  assert.equal(len, 16);
});

test('blendWithMask keeps processed pixels only inside the mask', () => {
  const o = solid(2, 1, [0, 0, 0, 255]), p = solid(2, 1, [200, 200, 200, 255]);
  const m = new Uint8Array([255, 0]);
  const out = C.blendWithMask(o, p, m);
  assert.deepEqual(px(out, 0, 0), [200, 200, 200, 255]);
  assert.deepEqual(px(out, 1, 0), [0, 0, 0, 255]);
  const half = C.blendWithMask(o, p, new Uint8Array([128, 128]));
  assert.ok(Math.abs(px(half, 0, 0)[0] - 100) <= 1);
  const fill = C.colorFromMask(m, 2, 1, [1, 2, 3]);
  assert.deepEqual(px(fill, 0, 0), [1, 2, 3, 255]);
  assert.deepEqual(px(fill, 1, 0), [0, 0, 0, 0]);
});

test('every effect in the catalogue has a unique id and sane defaults', () => {
  const ids = new Set();
  for (const e of C.ADJUSTMENTS.concat(C.FILTERS)) {
    assert.ok(!ids.has(e.id), 'duplicate ' + e.id);
    ids.add(e.id);
    for (const p of e.params) {
      if (p.type === 'range') assert.ok(p.value >= p.min && p.value <= p.max, `${e.id}.${p.key} default in range`);
    }
  }
});
