/*
 * Tessera editor model: the open document, its layers, the selection, undo history and every
 * operation that changes pixels. It knows nothing about the screen; view.js draws it.
 *
 * Events: doc (new document), change (pixels/layers changed), render (redraw only),
 * history, selection, colors, resize (document size changed).
 */
(function () {
  'use strict';
  const C = window.TesseraCore;
  const T = (window.Tessera = window.Tessera || {});

  const MAX_SIDE = 12000;
  let revSeq = 1;
  const nextRev = () => revSeq++;

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // Layer and history canvases are read back often, so keep them in CPU memory.
  function readable(c) {
    return c.getContext('2d', { willReadFrequently: true });
  }

  function cloneCanvas(src) {
    const c = makeCanvas(src.width, src.height);
    readable(c).drawImage(src, 0, 0);
    return c;
  }

  function stripExtension(name) {
    return String(name || 'untitled').replace(/\.[a-z0-9]+$/i, '') || 'untitled';
  }

  class Layer {
    constructor(id, name, w, h) {
      this.id = id;
      this.name = name;
      this.canvas = makeCanvas(w, h);
      this.ctx = readable(this.canvas);
      this.visible = true;
      this.opacity = 1;
      this.blend = 'source-over';
      this.offsetX = 0; // temporary, while the move tool drags
      this.offsetY = 0;
      this.rev = nextRev();
    }

    touch() {
      this.rev = nextRev();
    }

    setCanvas(c) {
      this.canvas = c;
      this.ctx = readable(c);
      this.touch();
    }
  }

  class Editor {
    constructor() {
      this.doc = null;
      this.history = new C.History(40);
      this.snapCache = new Map();
      this.handlers = {};
      this.primary = '#2b1d3a';
      this.secondary = '#ffffff';
      this.selection = null;
      this.clipboard = null;
      this.livePreview = null;
      this.compositeCanvas = null;
      this.layerSeq = 1;
      this.fileName = 'untitled';
      this.savedIndex = 0;
    }

    on(ev, fn) {
      (this.handlers[ev] = this.handlers[ev] || []).push(fn);
    }

    emit(ev, data) {
      (this.handlers[ev] || []).forEach((fn) => fn(data));
    }

    get width() { return this.doc ? this.doc.width : 0; }
    get height() { return this.doc ? this.doc.height : 0; }
    get layers() { return this.doc ? this.doc.layers : []; }

    get activeLayer() {
      return this.doc ? this.doc.layers.find((l) => l.id === this.doc.activeId) || null : null;
    }

    get activeIndex() {
      return this.doc ? this.doc.layers.findIndex((l) => l.id === this.doc.activeId) : -1;
    }

    get dirty() {
      return !!this.doc && this.history.index !== this.savedIndex;
    }

    layerById(id) {
      return this.layers.find((l) => l.id === id) || null;
    }

    /* ---------- documents ---------- */

    static clampSize(v) {
      return Math.max(1, Math.min(MAX_SIDE, Math.round(Number(v) || 1)));
    }

    newDocument(w, h, background, name) {
      w = Editor.clampSize(w);
      h = Editor.clampSize(h);
      this.doc = { width: w, height: h, layers: [], activeId: null };
      this.fileName = stripExtension(name || 'untitled');
      const bg = this.createLayer('Background');
      if (background && background !== 'transparent') {
        bg.ctx.fillStyle = background;
        bg.ctx.fillRect(0, 0, w, h);
      }
      this.doc.layers.push(bg);
      this.doc.activeId = bg.id;
      this.startHistory('New Canvas');
      return this.doc;
    }

    // source: an image, bitmap or canvas
    openImage(source, name) {
      const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
      if (!(w > 0 && h > 0)) throw new Error('That image has no pixels.');
      let sw = w, sh = h;
      if (w > MAX_SIDE || h > MAX_SIDE) {
        const k = MAX_SIDE / Math.max(w, h);
        sw = Math.round(w * k);
        sh = Math.round(h * k);
      }
      this.doc = { width: sw, height: sh, layers: [], activeId: null };
      this.fileName = stripExtension(name);
      const bg = this.createLayer('Background');
      bg.ctx.imageSmoothingQuality = 'high';
      bg.ctx.drawImage(source, 0, 0, sw, sh);
      this.doc.layers.push(bg);
      this.doc.activeId = bg.id;
      this.startHistory('Open');
      return this.doc;
    }

    closeDocument() {
      this.doc = null;
      this.selection = null;
      this.livePreview = null;
      this.history.clear();
      this.snapCache.clear();
      this.emit('doc');
      this.emit('history');
      this.emit('selection');
    }

    startHistory(label) {
      this.selection = null;
      this.livePreview = null;
      this.history.clear();
      this.snapCache.clear();
      this.commit(label, true);
      this.savedIndex = this.history.index;
      this.emit('doc');
      this.emit('selection');
    }

    markSaved() {
      this.savedIndex = this.history.index;
    }

    /* ---------- history ---------- */

    snapshot(label) {
      const d = this.doc;
      const layers = d.layers.map((l) => {
        let cached = this.snapCache.get(l.id);
        if (!cached || cached.rev !== l.rev) {
          cached = { rev: l.rev, canvas: cloneCanvas(l.canvas) };
          this.snapCache.set(l.id, cached);
        }
        return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, rev: l.rev, canvas: cached.canvas };
      });
      return { label, width: d.width, height: d.height, activeId: d.activeId, layers };
    }

    commit(label, quiet) {
      if (!this.doc) return;
      this.history.push(this.snapshot(label));
      if (this.savedIndex > this.history.index) this.savedIndex = -1;
      if (!quiet) {
        this.emit('history');
        this.emit('change');
      }
    }

    restore(state) {
      const d = this.doc;
      const sizeChanged = d.width !== state.width || d.height !== state.height;
      const current = new Map(d.layers.map((l) => [l.id, l]));
      d.width = state.width;
      d.height = state.height;
      d.layers = state.layers.map((s) => {
        let l = current.get(s.id);
        if (!l || l.rev !== s.rev || l.canvas.width !== state.width || l.canvas.height !== state.height) {
          l = new Layer(s.id, s.name, state.width, state.height);
          l.ctx.drawImage(s.canvas, 0, 0);
          l.rev = s.rev;
        }
        l.name = s.name;
        l.visible = s.visible;
        l.opacity = s.opacity;
        l.blend = s.blend;
        l.offsetX = l.offsetY = 0;
        this.snapCache.set(s.id, { rev: s.rev, canvas: s.canvas });
        return l;
      });
      d.activeId = d.layers.some((l) => l.id === state.activeId) ? state.activeId : d.layers[d.layers.length - 1].id;
      this.livePreview = null;
      if (sizeChanged) {
        this.selection = null;
        this.emit('selection');
        this.emit('resize');
      }
    }

    undo() {
      const s = this.history.undo();
      if (!s) return false;
      this.restore(s);
      this.emit('history');
      this.emit('change');
      return true;
    }

    redo() {
      const s = this.history.redo();
      if (!s) return false;
      this.restore(s);
      this.emit('history');
      this.emit('change');
      return true;
    }

    jumpHistory(i) {
      const s = this.history.jump(i);
      if (!s) return false;
      this.restore(s);
      this.emit('history');
      this.emit('change');
      return true;
    }

    /* ---------- layers ---------- */

    createLayer(name) {
      const id = this.layerSeq++;
      return new Layer(id, name || `Layer ${id}`, this.doc.width, this.doc.height);
    }

    insertAboveActive(layer) {
      const idx = this.activeIndex;
      this.doc.layers.splice(idx + 1, 0, layer);
      this.doc.activeId = layer.id;
    }

    addLayer(name, label) {
      if (!this.doc) return null;
      const l = this.createLayer(name);
      this.insertAboveActive(l);
      this.commit(label || 'New Layer');
      return l;
    }

    // Put an image on its own new layer, centred unless x/y are given.
    addImageLayer(source, name, x, y) {
      if (!this.doc) return null;
      const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
      const l = this.createLayer(stripExtension(name || 'Image'));
      const px = x == null ? Math.round((this.doc.width - w) / 2) : x;
      const py = y == null ? Math.round((this.doc.height - h) / 2) : y;
      l.ctx.drawImage(source, px, py);
      this.insertAboveActive(l);
      this.commit('Place Image');
      return l;
    }

    setActive(id) {
      if (!this.layerById(id) || this.doc.activeId === id) return;
      this.doc.activeId = id;
      this.emit('change');
    }

    deleteLayer(id) {
      if (!this.doc || this.doc.layers.length <= 1) return false;
      id = id == null ? this.doc.activeId : id;
      const idx = this.doc.layers.findIndex((l) => l.id === id);
      if (idx < 0) return false;
      this.doc.layers.splice(idx, 1);
      this.snapCache.delete(id);
      if (this.doc.activeId === id) this.doc.activeId = this.doc.layers[Math.max(0, idx - 1)].id;
      this.commit('Delete Layer');
      return true;
    }

    duplicateLayer() {
      const src = this.activeLayer;
      if (!src) return null;
      const l = this.createLayer(src.name + ' copy');
      l.ctx.drawImage(src.canvas, 0, 0);
      l.visible = src.visible;
      l.opacity = src.opacity;
      l.blend = src.blend;
      this.insertAboveActive(l);
      this.commit('Duplicate Layer');
      return l;
    }

    moveLayer(id, delta) {
      const layers = this.layers;
      const idx = layers.findIndex((l) => l.id === id);
      const ni = idx + delta;
      if (idx < 0 || ni < 0 || ni >= layers.length) return false;
      const [l] = layers.splice(idx, 1);
      layers.splice(ni, 0, l);
      this.commit('Reorder Layers');
      return true;
    }

    setLayerProps(id, props, label) {
      const l = this.layerById(id);
      if (!l) return;
      Object.assign(l, props);
      if (label) this.commit(label);
      else this.emit('render');
    }

    mergeDown() {
      const idx = this.activeIndex;
      if (idx < 1) return false;
      const upper = this.doc.layers[idx], lower = this.doc.layers[idx - 1];
      if (upper.visible) {
        lower.ctx.save();
        lower.ctx.globalAlpha = upper.opacity;
        lower.ctx.globalCompositeOperation = upper.blend;
        lower.ctx.drawImage(upper.canvas, 0, 0);
        lower.ctx.restore();
        lower.touch();
      }
      this.doc.layers.splice(idx, 1);
      this.snapCache.delete(upper.id);
      this.doc.activeId = lower.id;
      this.commit('Merge Down');
      return true;
    }

    flatten() {
      if (!this.doc) return;
      const flat = this.composite(makeCanvas(this.doc.width, this.doc.height));
      const l = this.createLayer('Background');
      l.ctx.drawImage(flat, 0, 0);
      this.snapCache.clear();
      this.doc.layers = [l];
      this.doc.activeId = l.id;
      this.commit('Flatten Image');
    }

    /* ---------- drawing the stack ---------- */

    // Draw every visible layer into target (or the shared composite canvas) and return it.
    composite(target, background) {
      const d = this.doc;
      let c = target;
      if (!c) {
        if (!this.compositeCanvas || this.compositeCanvas.width !== d.width || this.compositeCanvas.height !== d.height) {
          this.compositeCanvas = makeCanvas(d.width, d.height);
        }
        c = this.compositeCanvas;
      }
      const ctx = c.getContext('2d');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, c.width, c.height);
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, c.width, c.height);
      }
      for (const l of d.layers) {
        if (!l.visible || l.opacity <= 0) continue;
        let src = l.canvas;
        if (this.livePreview && this.livePreview.layerId === l.id) src = this.livePreview.build() || src;
        ctx.globalAlpha = l.opacity;
        ctx.globalCompositeOperation = l.blend;
        ctx.drawImage(src, l.offsetX, l.offsetY);
      }
      ctx.restore();
      return c;
    }

    sampleColor(x, y) {
      if (!this.doc) return null;
      x = Math.floor(x);
      y = Math.floor(y);
      if (x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return null;
      const c = this.composite();
      const p = c.getContext('2d').getImageData(x, y, 1, 1).data;
      if (p[3] === 0) return null;
      return C.rgbToHex(p[0], p[1], p[2]);
    }

    setColor(which, hex) {
      if (!C.hexToRgb(hex)) return;
      this[which === 'secondary' ? 'secondary' : 'primary'] = hex.toLowerCase();
      this.emit('colors');
    }

    swapColors() {
      [this.primary, this.secondary] = [this.secondary, this.primary];
      this.emit('colors');
    }

    resetColors() {
      this.primary = '#000000';
      this.secondary = '#ffffff';
      this.emit('colors');
    }

    /* ---------- selection ---------- */

    buildSelection(mask) {
      const w = this.doc.width, h = this.doc.height;
      const bounds = C.maskBounds(mask, w, h);
      if (!bounds) return null;
      const canvas = makeCanvas(w, h);
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(w, h);
      for (let p = 0, i = 3; p < mask.length; p++, i += 4) img.data[i] = mask[p];
      ctx.putImageData(img, 0, 0);
      const segs = C.maskOutline(mask, w, h, bounds);
      const path = new Path2D();
      for (let i = 0; i < segs.length; i += 4) {
        path.moveTo(segs[i], segs[i + 1]);
        path.lineTo(segs[i + 2], segs[i + 3]);
      }
      return { mask, canvas, bounds, path };
    }

    // mode: replace | add | subtract | intersect
    setSelection(mask, mode) {
      if (!this.doc) return;
      mode = mode || 'replace';
      let m = mask;
      if (mode !== 'replace') m = C.combineMasks(this.selection ? this.selection.mask : null, mask, this.selection ? mode : mode === 'add' ? 'replace' : mode);
      this.selection = m && !C.isMaskEmpty(m) ? this.buildSelection(m) : null;
      this.emit('selection');
    }

    // Draw a shape into a canvas and use its coverage as a selection mask.
    maskFromDrawing(draw) {
      const c = makeCanvas(this.doc.width, this.doc.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      draw(ctx);
      return C.maskFromAlpha(ctx.getImageData(0, 0, c.width, c.height).data, 128);
    }

    selectAll() {
      if (this.doc) this.setSelection(C.fullMask(this.doc.width, this.doc.height));
    }

    deselect() {
      if (!this.selection) return;
      this.selection = null;
      this.emit('selection');
    }

    invertSelection() {
      if (!this.doc) return;
      if (!this.selection) return this.selectAll();
      this.setSelection(C.invertMask(this.selection.mask));
    }

    // A copy of canvas with everything outside the selection removed (or canvas itself when nothing is selected).
    masked(canvas) {
      if (!this.selection) return canvas;
      const c = makeCanvas(canvas.width, canvas.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(this.selection.canvas, 0, 0);
      return c;
    }

    /* ---------- pixel operations ---------- */

    newCanvas() {
      return makeCanvas(this.doc.width, this.doc.height);
    }

    // Composite a full-size source canvas onto a layer, limited to the selection.
    paintCanvas(src, opts) {
      opts = opts || {};
      const layer = opts.layer || this.activeLayer;
      if (!layer) return false;
      const ctx = layer.ctx;
      ctx.save();
      ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
      ctx.globalCompositeOperation = opts.op || 'source-over';
      ctx.drawImage(this.masked(src), 0, 0);
      ctx.restore();
      layer.touch();
      if (opts.label) this.commit(opts.label);
      return true;
    }

    getLayerImage(layer) {
      layer = layer || this.activeLayer;
      return layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    }

    putLayerImage(layer, img) {
      const id = img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height);
      layer.ctx.putImageData(id, 0, 0);
    }

    // Run fn(ImageData) -> image on the active layer, respecting the selection.
    applyImageOp(fn, label) {
      const layer = this.activeLayer;
      if (!layer) return false;
      const orig = this.getLayerImage(layer);
      let out = fn(orig);
      if (this.selection) out = C.blendWithMask(orig, out, this.selection.mask);
      this.putLayerImage(layer, out);
      layer.touch();
      this.commit(label);
      return true;
    }

    fillSelection(color) {
      if (!this.activeLayer) return false;
      const c = this.newCanvas();
      const ctx = c.getContext('2d');
      ctx.fillStyle = color || this.primary;
      ctx.fillRect(0, 0, c.width, c.height);
      return this.paintCanvas(c, { label: 'Fill' });
    }

    clearSelection() {
      if (!this.activeLayer || !this.selection) return false;
      return this.paintCanvas(this.selection.canvas, { op: 'destination-out', label: 'Clear' });
    }

    copy() {
      const layer = this.activeLayer;
      if (!layer) return false;
      const b = this.selection ? this.selection.bounds : { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
      const c = makeCanvas(b.w, b.h);
      c.getContext('2d').drawImage(this.masked(layer.canvas), -b.x, -b.y);
      this.clipboard = { canvas: c, x: b.x, y: b.y };
      return true;
    }

    cut() {
      if (!this.copy()) return false;
      if (this.selection) this.clearSelection();
      else {
        const l = this.activeLayer;
        l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
        l.touch();
        this.commit('Cut');
      }
      return true;
    }

    paste() {
      if (!this.doc || !this.clipboard) return null;
      const cb = this.clipboard;
      const fits = cb.x + cb.canvas.width <= this.doc.width && cb.y + cb.canvas.height <= this.doc.height;
      const l = this.createLayer('Pasted');
      const x = fits ? cb.x : Math.round((this.doc.width - cb.canvas.width) / 2);
      const y = fits ? cb.y : Math.round((this.doc.height - cb.canvas.height) / 2);
      l.ctx.drawImage(cb.canvas, x, y);
      this.insertAboveActive(l);
      this.commit('Paste');
      return l;
    }

    setLayerOffset(layer, dx, dy) {
      layer.offsetX = dx;
      layer.offsetY = dy;
      this.emit('render');
    }

    // Make a move-tool drag permanent.
    bakeOffset(layer, label) {
      if (!layer || (!layer.offsetX && !layer.offsetY)) return false;
      const c = makeCanvas(layer.canvas.width, layer.canvas.height);
      c.getContext('2d').drawImage(layer.canvas, layer.offsetX, layer.offsetY);
      layer.offsetX = layer.offsetY = 0;
      layer.setCanvas(c);
      this.commit(label || 'Move');
      return true;
    }

    addTextLayer(text, x, y, opts) {
      if (!this.doc || !String(text).trim()) return null;
      opts = opts || {};
      const size = opts.size || 48;
      const l = this.createLayer('Text: ' + String(text).split('\n')[0].slice(0, 24));
      const ctx = l.ctx;
      ctx.font = T.fontString(opts.font, size, opts.bold, opts.italic);
      ctx.fillStyle = opts.color || this.primary;
      ctx.textBaseline = 'top';
      // 1.2 line height with the half-leading on top, matching the on-screen text box
      String(text).split('\n').forEach((line, i) => ctx.fillText(line, x, y + size * 0.1 + i * size * 1.2));
      this.insertAboveActive(l);
      this.commit('Text');
      return l;
    }

    /* ---------- whole-image transforms ---------- */

    transformLayers(newW, newH, draw, label) {
      for (const l of this.doc.layers) {
        const c = makeCanvas(newW, newH);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        draw(ctx, l.canvas);
        l.setCanvas(c);
      }
      this.doc.width = newW;
      this.doc.height = newH;
      this.selection = null;
      this.commit(label);
      this.emit('selection');
      this.emit('resize');
    }

    resizeImage(w, h) {
      if (!this.doc) return;
      w = Editor.clampSize(w);
      h = Editor.clampSize(h);
      this.transformLayers(w, h, (ctx, src) => ctx.drawImage(src, 0, 0, w, h), 'Image Size');
    }

    resizeCanvas(w, h, anchor) {
      if (!this.doc) return;
      w = Editor.clampSize(w);
      h = Editor.clampSize(h);
      const off = C.anchorOffset(this.doc.width, this.doc.height, w, h, anchor);
      this.transformLayers(w, h, (ctx, src) => ctx.drawImage(src, off.x, off.y), 'Canvas Size');
    }

    crop(rect) {
      if (!this.doc) return false;
      const r = C.clampRect(rect, this.doc.width, this.doc.height);
      if (r.w < 1 || r.h < 1) return false;
      this.transformLayers(r.w, r.h, (ctx, src) => ctx.drawImage(src, -r.x, -r.y), 'Crop');
      return true;
    }

    cropToSelection() {
      return this.selection ? this.crop(this.selection.bounds) : false;
    }

    // degrees: 90 (clockwise), -90 or 180
    rotate(degrees) {
      if (!this.doc) return;
      const w = this.doc.width, h = this.doc.height;
      const quarter = Math.abs(degrees) === 90;
      const nw = quarter ? h : w, nh = quarter ? w : h;
      this.transformLayers(nw, nh, (ctx, src) => {
        ctx.translate(nw / 2, nh / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.drawImage(src, -w / 2, -h / 2);
      }, degrees === 180 ? 'Rotate 180°' : degrees > 0 ? 'Rotate 90° CW' : 'Rotate 90° CCW');
    }

    flipImage(horizontal) {
      if (!this.doc) return;
      const w = this.doc.width, h = this.doc.height;
      this.transformLayers(w, h, (ctx, src) => {
        if (horizontal) ctx.setTransform(-1, 0, 0, 1, w, 0);
        else ctx.setTransform(1, 0, 0, -1, 0, h);
        ctx.drawImage(src, 0, 0);
      }, horizontal ? 'Flip Horizontal' : 'Flip Vertical');
    }

    flipLayer(horizontal) {
      const l = this.activeLayer;
      if (!l) return;
      const w = l.canvas.width, h = l.canvas.height;
      const c = makeCanvas(w, h);
      const ctx = c.getContext('2d');
      if (horizontal) ctx.setTransform(-1, 0, 0, 1, w, 0);
      else ctx.setTransform(1, 0, 0, -1, 0, h);
      ctx.drawImage(l.canvas, 0, 0);
      l.setCanvas(c);
      this.commit(horizontal ? 'Flip Layer Horizontal' : 'Flip Layer Vertical');
    }

    /* ---------- export ---------- */

    // type: image/png | image/jpeg | image/webp; quality 0..1
    exportBlob(type, quality) {
      type = type || 'image/png';
      const c = makeCanvas(this.doc.width, this.doc.height);
      this.composite(c, type === 'image/jpeg' ? '#ffffff' : null);
      return new Promise((resolve, reject) => {
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode this image.'))), type, quality == null ? 0.92 : quality);
      });
    }
  }

  T.fontString = function (family, size, bold, italic) {
    return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${family || 'system-ui, sans-serif'}`;
  };
  T.makeCanvas = makeCanvas;
  T.cloneCanvas = cloneCanvas;
  T.Layer = Layer;
  T.Editor = Editor;
})();
