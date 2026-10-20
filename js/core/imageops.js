/*
 * Tessera core: pixel operations on ImageData-like objects { width, height, data: Uint8ClampedArray (RGBA) }.
 * Every operation returns a new image and leaves its input untouched. No DOM, so it runs in Node tests too.
 */
(function (root) {
  'use strict';
  const NS = (root.TesseraCore = root.TesseraCore || {});

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function createImage(width, height, data) {
    return { width, height, data: data || new Uint8ClampedArray(width * height * 4) };
  }

  function cloneImage(img) {
    return createImage(img.width, img.height, new Uint8ClampedArray(img.data));
  }

  function lut(fn) {
    const t = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) t[i] = fn(i);
    return t;
  }

  function applyLUT(img, r, g, b) {
    g = g || r;
    b = b || r;
    const out = cloneImage(img), d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = r[d[i]];
      d[i + 1] = g[d[i + 1]];
      d[i + 2] = b[d[i + 2]];
    }
    return out;
  }

  /* ---------- Adjustments ---------- */

  // brightness, contrast: -100..100
  function brightnessContrast(img, brightness, contrast) {
    const off = (brightness || 0) * 2.55;
    const c = clamp((contrast || 0) * 2.55, -254, 254);
    const f = (259 * (c + 255)) / (255 * (259 - c));
    return applyLUT(img, lut((v) => f * (v + off - 128) + 128));
  }

  // ev: stops, -5..5
  function exposure(img, ev) {
    const m = Math.pow(2, ev || 0);
    return applyLUT(img, lut((v) => v * m));
  }

  function levels(img, inBlack, inWhite, gamma, outBlack, outWhite) {
    inBlack = inBlack == null ? 0 : inBlack;
    inWhite = inWhite == null ? 255 : inWhite;
    outBlack = outBlack == null ? 0 : outBlack;
    outWhite = outWhite == null ? 255 : outWhite;
    const range = Math.max(1, inWhite - inBlack);
    const g = 1 / Math.max(0.01, gamma == null ? 1 : gamma);
    return applyLUT(img, lut((v) => {
      const t = clamp((v - inBlack) / range, 0, 1);
      return outBlack + Math.pow(t, g) * (outWhite - outBlack);
    }));
  }

  // r, g, b: -100..100 shift per channel
  function colorBalance(img, r, g, b) {
    const k = 1.275;
    return applyLUT(img, lut((v) => v + (r || 0) * k), lut((v) => v + (g || 0) * k), lut((v) => v + (b || 0) * k));
  }

  // amount: -100 (cool) .. 100 (warm)
  function temperature(img, amount) {
    const k = (amount || 0) * 0.6;
    return applyLUT(img, lut((v) => v + k), lut((v) => v + k * 0.1), lut((v) => v - k));
  }

  function invert(img) {
    return applyLUT(img, lut((v) => 255 - v));
  }

  function luma(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function grayscale(img) {
    const out = cloneImage(img), d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = luma(d[i], d[i + 1], d[i + 2]);
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    return out;
  }

  // amount: 0..100
  function sepia(img, amount) {
    const a = clamp(amount == null ? 100 : amount, 0, 100) / 100;
    const out = cloneImage(img), d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const tr = 0.393 * r + 0.769 * g + 0.189 * b;
      const tg = 0.349 * r + 0.686 * g + 0.168 * b;
      const tb = 0.272 * r + 0.534 * g + 0.131 * b;
      d[i] = r + (tr - r) * a;
      d[i + 1] = g + (tg - g) * a;
      d[i + 2] = b + (tb - b) * a;
    }
    return out;
  }

  function threshold(img, level) {
    level = level == null ? 128 : level;
    const out = cloneImage(img), d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = luma(d[i], d[i + 1], d[i + 2]) >= level ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    return out;
  }

  function posterize(img, count) {
    const n = clamp(Math.round(count || 4), 2, 256);
    const step = 255 / (n - 1);
    return applyLUT(img, lut((v) => Math.round(Math.round(v / step) * step)));
  }

  // hue: -180..180 degrees, saturation and lightness: -100..100
  function hueSaturation(img, hue, saturation, lightness) {
    hue = hue || 0; saturation = saturation || 0; lightness = lightness || 0;
    if (!hue && !saturation && !lightness) return cloneImage(img);
    const toHsl = NS.rgbToHsl, toRgb = NS.hslToRgb;
    const dh = hue / 360, s = saturation / 100, l = lightness / 100;
    const out = cloneImage(img), d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      const hsl = toHsl(d[i], d[i + 1], d[i + 2]);
      let h = (hsl[0] + dh) % 1;
      if (h < 0) h += 1;
      const ss = clamp(hsl[1] * (1 + s), 0, 1);
      let ll = hsl[2];
      ll = l >= 0 ? ll + (1 - ll) * l : ll * (1 + l);
      const rgb = toRgb(h, ss, ll);
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2];
    }
    return out;
  }

  // Boosts muted colours more than already-saturated ones. amount: -100..100
  function vibrance(img, amount) {
    const adj = (amount || 0) / 100;
    const out = cloneImage(img), d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = (mx - mn) / 255;
      const k = 1 + adj * (1 - sat);
      const y = luma(r, g, b);
      d[i] = y + (r - y) * k;
      d[i + 1] = y + (g - y) * k;
      d[i + 2] = y + (b - y) * k;
    }
    return out;
  }

  /* ---------- Blur (premultiplied alpha so transparent edges don't go dark) ---------- */

  function toPremult(img) {
    const d = img.data, f = new Float32Array(d.length);
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      f[i] = d[i] * a; f[i + 1] = d[i + 1] * a; f[i + 2] = d[i + 2] * a; f[i + 3] = d[i + 3];
    }
    return f;
  }

  function fromPremult(f, w, h) {
    const out = createImage(w, h), d = out.data;
    for (let i = 0; i < f.length; i += 4) {
      const a = f[i + 3];
      if (a > 0.01) {
        const k = 255 / a;
        d[i] = f[i] * k; d[i + 1] = f[i + 1] * k; d[i + 2] = f[i + 2] * k; d[i + 3] = a;
      }
    }
    return out;
  }

  // One running-sum box blur pass with clamped edges.
  function boxPass(src, dst, w, h, r, horizontal) {
    const inv = 1 / (r + r + 1);
    const outer = horizontal ? h : w, len = horizontal ? w : h;
    const stride = horizontal ? 4 : w * 4;
    for (let o = 0; o < outer; o++) {
      const base = horizontal ? o * w * 4 : o * 4;
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += src[base + clamp(k, 0, len - 1) * stride + c];
        for (let i = 0; i < len; i++) {
          dst[base + i * stride + c] = acc * inv;
          acc += src[base + Math.min(len - 1, i + r + 1) * stride + c] - src[base + Math.max(0, i - r) * stride + c];
        }
      }
    }
  }

  function blurPremult(f, w, h, radii) {
    const tmp = new Float32Array(f.length);
    for (const r of radii) {
      boxPass(f, tmp, w, h, r, true);
      boxPass(tmp, f, w, h, r, false);
    }
    return f;
  }

  function boxBlur(img, radius) {
    const r = Math.round(radius || 0);
    if (r < 1) return cloneImage(img);
    return fromPremult(blurPremult(toPremult(img), img.width, img.height, [r]), img.width, img.height);
  }

  // Three box passes approximate a gaussian with standard deviation sigma.
  function boxesForGauss(sigma, n) {
    const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
    let wl = Math.floor(wIdeal);
    if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
    const m = Math.round(mIdeal);
    const sizes = [];
    for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
    return sizes;
  }

  function gaussianBlur(img, sigma) {
    if (!(sigma > 0)) return cloneImage(img);
    const radii = boxesForGauss(sigma, 3).map((s) => Math.max(0, (s - 1) / 2));
    return fromPremult(blurPremult(toPremult(img), img.width, img.height, radii), img.width, img.height);
  }

  /* ---------- Convolution filters ---------- */

  function convolve(img, kernel, divisor, bias) {
    const side = Math.round(Math.sqrt(kernel.length)), half = side >> 1;
    const w = img.width, h = img.height, src = img.data;
    const out = createImage(w, h), dst = out.data;
    divisor = divisor || 1;
    bias = bias || 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let ky = 0; ky < side; ky++) {
          const sy = clamp(y + ky - half, 0, h - 1);
          for (let kx = 0; kx < side; kx++) {
            const wgt = kernel[ky * side + kx];
            if (!wgt) continue;
            const si = (sy * w + clamp(x + kx - half, 0, w - 1)) * 4;
            r += src[si] * wgt; g += src[si + 1] * wgt; b += src[si + 2] * wgt;
          }
        }
        const di = (y * w + x) * 4;
        dst[di] = r / divisor + bias;
        dst[di + 1] = g / divisor + bias;
        dst[di + 2] = b / divisor + bias;
        dst[di + 3] = src[di + 3];
      }
    }
    return out;
  }

  // amount: 0..100 (50 is the classic 5-point sharpen)
  function sharpen(img, amount) {
    const a = (amount == null ? 50 : amount) / 50;
    if (a <= 0) return cloneImage(img);
    return convolve(img, [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]);
  }

  // radius: blur sigma, amount: percent, thresh: 0..255 minimum difference to sharpen
  function unsharpMask(img, radius, amount, thresh) {
    const blurred = gaussianBlur(img, radius || 1);
    const k = (amount == null ? 100 : amount) / 100;
    thresh = thresh || 0;
    const out = cloneImage(img), d = out.data, s = img.data, bl = blurred.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = s[i + c] - bl[i + c];
        if (Math.abs(diff) >= thresh) d[i + c] = s[i + c] + diff * k;
      }
    }
    return out;
  }

  function emboss(img) {
    return convolve(img, [-2, -1, 0, -1, 1, 1, 0, 1, 2]);
  }

  // Sobel edge magnitude, drawn as dark lines on white.
  function findEdges(img) {
    const w = img.width, h = img.height, s = img.data;
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; p < gray.length; i += 4, p++) gray[p] = luma(s[i], s[i + 1], s[i + 2]);
    const out = createImage(w, h), d = out.data;
    const at = (x, y) => gray[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
        const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
        const v = 255 - Math.min(255, Math.sqrt(gx * gx + gy * gy));
        const i = (y * w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = s[i + 3];
      }
    }
    return out;
  }

  // Median filter, good for speckle noise. radius 1..3
  function median(img, radius) {
    const r = clamp(Math.round(radius || 1), 1, 3);
    const w = img.width, h = img.height, s = img.data;
    const out = cloneImage(img), d = out.data;
    const n = (2 * r + 1) * (2 * r + 1), buf = new Uint8Array(n), mid = n >> 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const di = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          let k = 0;
          for (let dy = -r; dy <= r; dy++) {
            const row = clamp(y + dy, 0, h - 1) * w;
            for (let dx = -r; dx <= r; dx++) {
              const v = s[(row + clamp(x + dx, 0, w - 1)) * 4 + c];
              let j = k++;
              while (j > 0 && buf[j - 1] > v) { buf[j] = buf[j - 1]; j--; }
              buf[j] = v;
            }
          }
          d[di + c] = buf[mid];
        }
      }
    }
    return out;
  }

  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // amount: 0..100. Deterministic for a given seed.
  function addNoise(img, amount, monochrome, seed) {
    const rand = mulberry32(seed == null ? 1 : seed);
    const k = (amount || 0) * 2.55;
    const out = cloneImage(img), d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      if (monochrome) {
        const n = (rand() - 0.5) * 2 * k;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      } else {
        d[i] += (rand() - 0.5) * 2 * k;
        d[i + 1] += (rand() - 0.5) * 2 * k;
        d[i + 2] += (rand() - 0.5) * 2 * k;
      }
    }
    return out;
  }

  // Average each size x size block.
  function pixelate(img, size) {
    const bs = Math.max(1, Math.round(size || 8));
    if (bs === 1) return cloneImage(img);
    const w = img.width, h = img.height, s = img.data;
    const out = createImage(w, h), d = out.data;
    for (let by = 0; by < h; by += bs) {
      for (let bx = 0; bx < w; bx += bs) {
        const ex = Math.min(w, bx + bs), ey = Math.min(h, by + bs);
        let r = 0, g = 0, b = 0, a = 0, wsum = 0, n = 0;
        for (let y = by; y < ey; y++) {
          for (let x = bx; x < ex; x++) {
            const i = (y * w + x) * 4, al = s[i + 3];
            r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al; wsum += al; n++;
          }
        }
        const cr = wsum ? r / wsum : 0, cg = wsum ? g / wsum : 0, cb = wsum ? b / wsum : 0, ca = a / n;
        for (let y = by; y < ey; y++) {
          for (let x = bx; x < ex; x++) {
            const i = (y * w + x) * 4;
            d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = ca;
          }
        }
      }
    }
    return out;
  }

  // Darken toward the corners. amount: 0..100
  function vignette(img, amount) {
    const a = clamp(amount == null ? 50 : amount, 0, 100) / 100;
    const w = img.width, h = img.height;
    const cx = (w - 1) / 2, cy = (h - 1) / 2, maxD = Math.hypot(cx, cy) || 1;
    const out = cloneImage(img), d = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = clamp((Math.hypot(x - cx, y - cy) / maxD - 0.35) / 0.65, 0, 1);
        const f = 1 - a * t * t * (3 - 2 * t);
        const i = (y * w + x) * 4;
        d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
      }
    }
    return out;
  }

  /* ---------- Selection masks: Uint8Array of width*height, 255 = selected ---------- */

  function rectMask(w, h, x, y, rw, rh) {
    const m = new Uint8Array(w * h);
    const x1 = clamp(Math.round(x), 0, w), y1 = clamp(Math.round(y), 0, h);
    const x2 = clamp(Math.round(x + rw), 0, w), y2 = clamp(Math.round(y + rh), 0, h);
    for (let yy = y1; yy < y2; yy++) m.fill(255, yy * w + x1, yy * w + x2);
    return m;
  }

  function fullMask(w, h) {
    return new Uint8Array(w * h).fill(255);
  }

  // Turn the alpha channel of RGBA data into a hard mask.
  function maskFromAlpha(data, cutoff) {
    cutoff = cutoff == null ? 128 : cutoff;
    const m = new Uint8Array(data.length / 4);
    for (let p = 0, i = 3; p < m.length; p++, i += 4) m[p] = data[i] >= cutoff ? 255 : 0;
    return m;
  }

  function invertMask(mask) {
    const m = new Uint8Array(mask.length);
    for (let i = 0; i < m.length; i++) m[i] = 255 - mask[i];
    return m;
  }

  // mode: replace | add | subtract | intersect
  function combineMasks(base, next, mode) {
    const m = new Uint8Array(next.length);
    if (mode === 'replace' || !base) {
      if (mode === 'subtract' || mode === 'intersect') return m;
      m.set(next);
      return m;
    }
    for (let i = 0; i < m.length; i++) {
      const a = base[i], b = next[i];
      m[i] = mode === 'add' ? Math.max(a, b) : mode === 'subtract' ? Math.min(a, 255 - b) : Math.min(a, b);
    }
    return m;
  }

  function isMaskEmpty(mask) {
    for (let i = 0; i < mask.length; i++) if (mask[i]) return false;
    return true;
  }

  function maskBounds(mask, w, h) {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (mask[row + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  // Edges between selected and unselected pixels, merged into line segments [x1, y1, x2, y2, ...].
  function maskOutline(mask, w, h, bounds) {
    const b = bounds || maskBounds(mask, w, h);
    const segs = [];
    if (!b) return segs;
    const sel = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= 128;
    const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
    for (let y = y0; y <= y1; y++) {
      let start = -1;
      for (let x = x0; x <= x1; x++) {
        const edge = x < x1 && sel(x, y - 1) !== sel(x, y);
        if (edge) { if (start < 0) start = x; }
        else if (start >= 0) { segs.push(start, y, x, y); start = -1; }
      }
    }
    for (let x = x0; x <= x1; x++) {
      let start = -1;
      for (let y = y0; y <= y1; y++) {
        const edge = y < y1 && sel(x - 1, y) !== sel(x, y);
        if (edge) { if (start < 0) start = y; }
        else if (start >= 0) { segs.push(x, start, x, y); start = -1; }
      }
    }
    return segs;
  }

  // Pixels similar to the one at (sx, sy). tolerance 0..255 per channel (alpha included).
  function floodFillMask(img, sx, sy, tolerance, contiguous) {
    const w = img.width, h = img.height, d = img.data;
    const mask = new Uint8Array(w * h);
    sx = Math.floor(sx); sy = Math.floor(sy);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;
    const tol = tolerance == null ? 32 : tolerance;
    const i0 = (sy * w + sx) * 4;
    const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3];
    const match = (p) => {
      const i = p * 4, a = d[i + 3];
      if (ta === 0 && a === 0) return true;
      return Math.abs(d[i] - tr) <= tol && Math.abs(d[i + 1] - tg) <= tol && Math.abs(d[i + 2] - tb) <= tol && Math.abs(a - ta) <= tol;
    };
    if (contiguous === false) {
      for (let p = 0; p < mask.length; p++) if (match(p)) mask[p] = 255;
      return mask;
    }
    const stack = [sy * w + sx];
    while (stack.length) {
      const p = stack.pop();
      if (mask[p] || !match(p)) continue;
      const y = (p / w) | 0, row = y * w;
      let lx = p - row, rx = lx;
      while (lx > 0 && !mask[row + lx - 1] && match(row + lx - 1)) lx--;
      while (rx < w - 1 && !mask[row + rx + 1] && match(row + rx + 1)) rx++;
      let upOpen = false, downOpen = false;
      for (let x = lx; x <= rx; x++) {
        mask[row + x] = 255;
        if (y > 0) {
          const q = row - w + x, ok = !mask[q] && match(q);
          if (ok && !upOpen) stack.push(q);
          upOpen = ok;
        }
        if (y < h - 1) {
          const q = row + w + x, ok = !mask[q] && match(q);
          if (ok && !downOpen) stack.push(q);
          downOpen = ok;
        }
      }
    }
    return mask;
  }

  // Keep `processed` where the mask is set and `original` elsewhere.
  function blendWithMask(original, processed, mask) {
    const out = cloneImage(original), d = out.data, p = processed.data;
    for (let px = 0, i = 0; px < mask.length; px++, i += 4) {
      const m = mask[px];
      if (m === 255) {
        d[i] = p[i]; d[i + 1] = p[i + 1]; d[i + 2] = p[i + 2]; d[i + 3] = p[i + 3];
      } else if (m) {
        const k = m / 255;
        for (let c = 0; c < 4; c++) d[i + c] = d[i + c] + (p[i + c] - d[i + c]) * k;
      }
    }
    return out;
  }

  // RGBA image of a solid colour wherever the mask is set.
  function colorFromMask(mask, w, h, rgb, alpha) {
    const out = createImage(w, h), d = out.data;
    const a = alpha == null ? 255 : alpha;
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (mask[p]) {
        d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = (mask[p] * a) / 255;
      }
    }
    return out;
  }

  Object.assign(NS, {
    createImage, cloneImage,
    brightnessContrast, exposure, levels, colorBalance, temperature, invert, grayscale, sepia, threshold, posterize,
    hueSaturation, vibrance,
    boxBlur, gaussianBlur, boxesForGauss, convolve, sharpen, unsharpMask, emboss, findEdges, median, addNoise, pixelate, vignette,
    rectMask, fullMask, maskFromAlpha, invertMask, combineMasks, isMaskEmpty, maskBounds, maskOutline, floodFillMask,
    blendWithMask, colorFromMask,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
