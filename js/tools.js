/*
 * Tessera tools. Each tool gets pointer events in document coordinates from the view:
 *   down(e) / move(e) / up(e) / hover(e) / dblclick(e) / keydown(e) -> true when handled
 *   drawOverlay(ctx, view) draws previews in screen space; cursorRadius() shows a brush circle.
 * `options` describes the controls the options bar shows; values live in Tessera.toolOptions.
 */
(function () {
  'use strict';
  const C = window.TesseraCore;
  const T = (window.Tessera = window.Tessera || {});

  T.toolOptions = {
    brush: { size: 24, hardness: 80, opacity: 100 },
    eraser: { size: 40, hardness: 60, opacity: 100 },
    bucket: { tolerance: 32, contiguous: true, opacity: 100 },
    wand: { tolerance: 32, contiguous: true, allLayers: false },
    gradient: { kind: 'linear', colors: 'fg-bg', opacity: 100 },
    shape: { kind: 'rect', fill: true, stroke: false, strokeWidth: 6, opacity: 100 },
    text: { font: 'system-ui, sans-serif', size: 64, bold: false, italic: false },
  };

  T.FONTS = [
    ['system-ui, sans-serif', 'System Sans'],
    ['Georgia, "Times New Roman", serif', 'Serif'],
    ['"Helvetica Neue", Arial, sans-serif', 'Grotesque'],
    ['"Courier New", Courier, monospace', 'Typewriter'],
    ['Impact, "Arial Black", sans-serif', 'Poster'],
    ['"Trebuchet MS", Verdana, sans-serif', 'Humanist'],
    ['"Brush Script MT", cursive', 'Script'],
  ];

  const selectionHint = 'Shift adds, Alt subtracts, Shift+Alt intersects.';

  function selMode(e) {
    return e.shift && e.alt ? 'intersect' : e.shift ? 'add' : e.alt ? 'subtract' : 'replace';
  }

  function strokeDashed(o, draw) {
    o.lineWidth = 1;
    o.setLineDash([5, 4]);
    o.strokeStyle = '#000';
    o.beginPath(); draw(); o.stroke();
    o.lineDashOffset = 4.5;
    o.strokeStyle = '#fff';
    o.beginPath(); draw(); o.stroke();
    o.setLineDash([]);
  }

  T.createTools = function (editor, view, ui) {
    const opt = (key) => T.toolOptions[key];

    function paintableLayer() {
      const l = editor.activeLayer;
      if (!l) return null;
      if (!l.visible) {
        ui.toast('The active layer is hidden. Show it to paint on it.');
        return null;
      }
      return l;
    }

    function screenRect(a, b) {
      const p = view.docToScreen(a.x, a.y), q = view.docToScreen(b.x, b.y);
      return C.normRect(p.x, p.y, q.x, q.y);
    }

    /* ---------- move ---------- */
    const move = {
      id: 'move', name: 'Move', key: 'V', icon: 'move', cursor: 'move',
      hint: 'Drag to move the active layer. Arrow keys nudge by 1 px (Shift: 10 px).',
      down(e) {
        const l = paintableLayer();
        if (!l) return;
        this.drag = { layer: l, x: e.x, y: e.y };
      },
      move(e) {
        if (!this.drag) return;
        editor.setLayerOffset(this.drag.layer, Math.round(e.x - this.drag.x), Math.round(e.y - this.drag.y));
      },
      up() {
        if (!this.drag) return;
        editor.bakeOffset(this.drag.layer, 'Move');
        this.drag = null;
      },
      keydown(e) {
        const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const d = dirs[e.key];
        const l = editor.activeLayer;
        if (!d || !l) return false;
        const step = e.shiftKey ? 10 : 1;
        l.offsetX = d[0] * step;
        l.offsetY = d[1] * step;
        editor.bakeOffset(l, 'Nudge');
        return true;
      },
    };

    /* ---------- rectangle / ellipse select ---------- */
    function shapeSelect(id, name, key, icon, ellipse) {
      return {
        id, name, key, icon, cursor: 'crosshair', hint: `Drag to select. ${selectionHint}`,
        down(e) {
          this.start = { x: e.x, y: e.y };
          this.cur = this.start;
          this.mode = selMode(e);
        },
        move(e) {
          if (this.start) this.cur = { x: e.x, y: e.y };
        },
        up() {
          if (!this.start) return;
          const r = C.normRect(this.start.x, this.start.y, this.cur.x, this.cur.y);
          this.start = null;
          if (r.w < 1 || r.h < 1) {
            if (this.mode === 'replace') editor.deselect();
            return;
          }
          let mask;
          if (ellipse) {
            mask = editor.maskFromDrawing((ctx) => {
              ctx.beginPath();
              ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
              ctx.fill();
            });
          } else {
            mask = C.rectMask(editor.width, editor.height, r.x, r.y, r.w, r.h);
          }
          editor.setSelection(mask, this.mode);
        },
        drawOverlay(o) {
          if (!this.start) return;
          const r = screenRect(this.start, this.cur);
          strokeDashed(o, () => {
            if (ellipse) o.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
            else o.rect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
          });
        },
      };
    }

    /* ---------- lasso ---------- */
    const lasso = {
      id: 'lasso', name: 'Lasso', key: 'L', icon: 'lasso', cursor: 'crosshair',
      hint: `Drag around an area to select it freehand. ${selectionHint}`,
      down(e) {
        this.points = [{ x: e.x, y: e.y }];
        this.mode = selMode(e);
      },
      move(e) {
        if (!this.points) return;
        const last = this.points[this.points.length - 1];
        if (Math.hypot(e.x - last.x, e.y - last.y) * view.zoom > 2) this.points.push({ x: e.x, y: e.y });
      },
      up() {
        const pts = this.points;
        this.points = null;
        if (!pts || pts.length < 3) {
          if (this.mode === 'replace') editor.deselect();
          return;
        }
        const mask = editor.maskFromDrawing((ctx) => {
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
          ctx.fill();
        });
        editor.setSelection(mask, this.mode);
      },
      keydown(e) {
        if (e.key === 'Escape' && this.points) { this.points = null; view.renderOverlay(); return true; }
        return false;
      },
      drawOverlay(o) {
        if (!this.points) return;
        strokeDashed(o, () => {
          this.points.forEach((p, i) => {
            const s = view.docToScreen(p.x, p.y);
            if (i) o.lineTo(s.x, s.y); else o.moveTo(s.x, s.y);
          });
        });
      },
    };

    /* ---------- magic wand ---------- */
    const wand = {
      id: 'wand', name: 'Magic Wand', key: 'W', icon: 'wand', cursor: 'crosshair', optionsKey: 'wand',
      hint: `Click to select similar colours. ${selectionHint}`,
      options: [
        { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 255 },
        { key: 'contiguous', label: 'Contiguous', type: 'checkbox' },
        { key: 'allLayers', label: 'Sample all layers', type: 'checkbox' },
      ],
      down(e) {
        const o = opt('wand');
        let img;
        if (o.allLayers) {
          const c = editor.composite();
          img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        } else {
          if (!editor.activeLayer) return;
          img = editor.getLayerImage();
        }
        const mask = C.floodFillMask(img, e.x, e.y, o.tolerance, o.contiguous);
        editor.setSelection(mask, selMode(e));
      },
    };

    /* ---------- crop ---------- */
    const crop = {
      id: 'crop', name: 'Crop', key: 'C', icon: 'crop', cursor: 'crosshair',
      hint: 'Drag the area to keep, then press Enter or double-click. Esc cancels.',
      options: [
        { type: 'button', label: 'Apply crop', primary: true, action: () => crop.apply() },
        { type: 'button', label: 'Cancel', action: () => crop.cancel() },
      ],
      down(e) {
        this.start = { x: e.x, y: e.y };
        this.rect = { x: e.x, y: e.y, w: 0, h: 0 };
      },
      move(e) {
        if (!this.start) return;
        const x = Math.min(editor.width, Math.max(0, e.x)), y = Math.min(editor.height, Math.max(0, e.y));
        this.rect = C.normRect(this.start.x, this.start.y, x, y);
      },
      up() {
        this.start = null;
        if (this.rect && (this.rect.w < 2 || this.rect.h < 2)) this.rect = null;
        view.renderOverlay();
      },
      dblclick() { this.apply(); },
      apply() {
        if (!this.rect) { ui.toast('Drag on the image to choose the area to keep.'); return; }
        const r = this.rect;
        this.rect = null;
        editor.crop(r);
      },
      cancel() {
        this.rect = null;
        this.start = null;
        view.renderOverlay();
      },
      keydown(e) {
        if (e.key === 'Enter' && this.rect) { this.apply(); return true; }
        if (e.key === 'Escape' && this.rect) { this.cancel(); return true; }
        return false;
      },
      deactivate() { this.cancel(); },
      drawOverlay(o) {
        if (!this.rect) return;
        const r = screenRect({ x: this.rect.x, y: this.rect.y }, { x: this.rect.x + this.rect.w, y: this.rect.y + this.rect.h });
        const d = screenRect({ x: 0, y: 0 }, { x: editor.width, y: editor.height });
        o.fillStyle = 'rgba(10,8,14,0.6)';
        o.beginPath();
        o.rect(d.x, d.y, d.w, d.h);
        o.rect(r.x + r.w, r.y, -r.w, r.h);
        o.fill('evenodd');
        o.strokeStyle = 'rgba(255,255,255,0.35)';
        o.lineWidth = 1;
        o.beginPath();
        for (let i = 1; i < 3; i++) {
          o.moveTo(r.x + (r.w * i) / 3, r.y); o.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
          o.moveTo(r.x, r.y + (r.h * i) / 3); o.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
        }
        o.stroke();
        o.strokeStyle = '#ffd36b';
        o.lineWidth = 2;
        o.strokeRect(r.x, r.y, r.w, r.h);
        const label = `${Math.round(this.rect.w)} × ${Math.round(this.rect.h)}`;
        o.font = '12px system-ui, sans-serif';
        o.fillStyle = 'rgba(0,0,0,0.7)';
        o.fillRect(r.x, r.y - 22, o.measureText(label).width + 12, 20);
        o.fillStyle = '#fff';
        o.fillText(label, r.x + 6, r.y - 8);
      },
    };

    /* ---------- brush and eraser ---------- */
    function dab(ctx, x, y, size, hardness, color) {
      const r = size / 2;
      if (hardness >= 0.99 || r < 1.5) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      const g = ctx.createRadialGradient(x, y, r * hardness, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, C.rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    function paintTool(id, name, key, icon, erase) {
      return {
        id, name, key, icon, optionsKey: id,
        hint: erase ? 'Drag to erase to transparency. Shift-click draws a straight line. [ and ] change size.'
          : 'Drag to paint with the primary colour. Shift-click draws a straight line. [ and ] change size.',
        options: [
          { key: 'size', label: 'Size', type: 'range', min: 1, max: 400, unit: 'px' },
          { key: 'hardness', label: 'Hardness', type: 'range', min: 0, max: 100, unit: '%' },
          { key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, unit: '%' },
        ],
        cursorRadius() { return opt(id).size / 2; },
        down(e) {
          const l = paintableLayer();
          if (!l) return;
          const o = opt(id);
          this.layer = l;
          this.stroke = editor.newCanvas();
          this.sctx = this.stroke.getContext('2d');
          this.preview = editor.newCanvas();
          this.color = erase ? '#000000' : editor.primary;
          const from = e.shift && this.lastPoint ? this.lastPoint : null;
          this.last = from || { x: e.x, y: e.y };
          if (from) this.lineTo(e, o);
          else dab(this.sctx, e.x, e.y, o.size, o.hardness / 100, this.color);
          this.last = { x: e.x, y: e.y };
          editor.livePreview = { layerId: l.id, build: () => this.buildPreview() };
          editor.emit('render');
        },
        lineTo(p, o) {
          const dx = p.x - this.last.x, dy = p.y - this.last.y;
          const dist = Math.hypot(dx, dy);
          const spacing = Math.max(0.5, o.size * 0.12);
          const steps = Math.max(1, Math.ceil(dist / spacing));
          for (let i = 1; i <= steps; i++) {
            dab(this.sctx, this.last.x + (dx * i) / steps, this.last.y + (dy * i) / steps, o.size, o.hardness / 100, this.color);
          }
        },
        move(e) {
          if (!this.stroke) return;
          this.lineTo(e, opt(id));
          this.last = { x: e.x, y: e.y };
          editor.emit('render');
        },
        buildPreview() {
          const p = this.preview, ctx = p.getContext('2d');
          ctx.globalCompositeOperation = 'copy';
          ctx.globalAlpha = 1;
          ctx.drawImage(this.layer.canvas, 0, 0);
          ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
          ctx.globalAlpha = opt(id).opacity / 100;
          ctx.drawImage(editor.masked(this.stroke), 0, 0);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          return p;
        },
        up() {
          if (!this.stroke) return;
          editor.livePreview = null;
          editor.paintCanvas(this.stroke, {
            layer: this.layer, alpha: opt(id).opacity / 100, op: erase ? 'destination-out' : 'source-over', label: name,
          });
          this.lastPoint = this.last;
          this.stroke = this.sctx = this.preview = this.layer = null;
        },
      };
    }

    /* ---------- paint bucket ---------- */
    const bucket = {
      id: 'bucket', name: 'Paint Bucket', key: 'K', icon: 'bucket', cursor: 'crosshair', optionsKey: 'bucket',
      hint: 'Click to fill similar neighbouring pixels with the primary colour.',
      options: [
        { key: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 255 },
        { key: 'contiguous', label: 'Contiguous', type: 'checkbox' },
        { key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, unit: '%' },
      ],
      down(e) {
        const l = paintableLayer();
        if (!l || e.x < 0 || e.y < 0 || e.x >= editor.width || e.y >= editor.height) return;
        const o = opt('bucket');
        const mask = C.floodFillMask(editor.getLayerImage(l), e.x, e.y, o.tolerance, o.contiguous);
        const fill = C.colorFromMask(mask, editor.width, editor.height, C.hexToRgb(editor.primary));
        const c = editor.newCanvas();
        c.getContext('2d').putImageData(new ImageData(fill.data, fill.width, fill.height), 0, 0);
        editor.paintCanvas(c, { layer: l, alpha: o.opacity / 100, label: 'Paint Bucket' });
      },
    };

    /* ---------- gradient ---------- */
    const gradient = {
      id: 'gradient', name: 'Gradient', key: 'G', icon: 'gradient', cursor: 'crosshair', optionsKey: 'gradient',
      hint: 'Drag to draw a gradient from the primary colour. Shift snaps to 45°.',
      options: [
        { key: 'kind', label: 'Type', type: 'select', options: [['linear', 'Linear'], ['radial', 'Radial']] },
        { key: 'colors', label: 'Colours', type: 'select', options: [['fg-bg', 'Primary → Secondary'], ['fg-clear', 'Primary → Transparent']] },
        { key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, unit: '%' },
      ],
      down(e) {
        if (!paintableLayer()) return;
        this.start = { x: e.x, y: e.y };
        this.cur = this.start;
      },
      move(e) {
        if (!this.start) return;
        this.cur = e.shift ? C.constrainAngle(this.start, e, 45) : { x: e.x, y: e.y };
      },
      up() {
        if (!this.start) return;
        const a = this.start, b = this.cur;
        this.start = null;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return;
        const o = opt('gradient');
        const c = editor.newCanvas(), ctx = c.getContext('2d');
        const g = o.kind === 'radial'
          ? ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y))
          : ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        g.addColorStop(0, editor.primary);
        g.addColorStop(1, o.colors === 'fg-clear' ? C.rgba(editor.primary, 0) : editor.secondary);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, c.width, c.height);
        editor.paintCanvas(c, { alpha: o.opacity / 100, label: 'Gradient' });
      },
      drawOverlay(o) {
        if (!this.start) return;
        const p = view.docToScreen(this.start.x, this.start.y), q = view.docToScreen(this.cur.x, this.cur.y);
        o.lineWidth = 3; o.strokeStyle = 'rgba(0,0,0,0.6)';
        o.beginPath(); o.moveTo(p.x, p.y); o.lineTo(q.x, q.y); o.stroke();
        o.lineWidth = 1.5; o.strokeStyle = '#fff';
        o.beginPath(); o.moveTo(p.x, p.y); o.lineTo(q.x, q.y); o.stroke();
        for (const [pt, col] of [[p, editor.primary], [q, editor.secondary]]) {
          o.beginPath(); o.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
          o.fillStyle = col; o.fill(); o.strokeStyle = '#fff'; o.stroke();
        }
      },
    };

    /* ---------- shapes ---------- */
    function traceShape(ctx, kind, a, b) {
      ctx.beginPath();
      if (kind === 'ellipse') {
        const r = C.normRect(a.x, a.y, b.x, b.y);
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      } else if (kind === 'line') {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      } else {
        const r = C.normRect(a.x, a.y, b.x, b.y);
        ctx.rect(r.x, r.y, r.w, r.h);
      }
    }

    function paintShape(ctx, o, a, b, scale) {
      traceShape(ctx, o.kind, a, b);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (o.kind === 'line') {
        ctx.lineWidth = o.strokeWidth * scale;
        ctx.strokeStyle = editor.primary;
        ctx.stroke();
        return;
      }
      if (o.fill) { ctx.fillStyle = editor.primary; ctx.fill(); }
      if (o.stroke || !o.fill) {
        ctx.lineWidth = o.strokeWidth * scale;
        ctx.strokeStyle = o.fill ? editor.secondary : editor.primary;
        ctx.stroke();
      }
    }

    const shape = {
      id: 'shape', name: 'Shape', key: 'U', icon: 'shape', cursor: 'crosshair', optionsKey: 'shape',
      hint: 'Drag to draw. Fill uses the primary colour, outline the secondary. Shift keeps proportions.',
      options: [
        { key: 'kind', label: 'Shape', type: 'select', options: [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line']] },
        { key: 'fill', label: 'Fill', type: 'checkbox' },
        { key: 'stroke', label: 'Outline', type: 'checkbox' },
        { key: 'strokeWidth', label: 'Width', type: 'range', min: 1, max: 100, unit: 'px' },
        { key: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, unit: '%' },
      ],
      down(e) {
        if (!paintableLayer()) return;
        this.start = { x: e.x, y: e.y };
        this.cur = this.start;
      },
      move(e) {
        if (!this.start) return;
        const kind = opt('shape').kind;
        this.cur = e.shift ? (kind === 'line' ? C.constrainAngle(this.start, e, 45) : C.constrainSquare(this.start, e)) : { x: e.x, y: e.y };
      },
      up() {
        if (!this.start) return;
        const a = this.start, b = this.cur;
        this.start = null;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return;
        const o = opt('shape');
        const c = editor.newCanvas();
        paintShape(c.getContext('2d'), o, a, b, 1);
        editor.paintCanvas(c, { alpha: o.opacity / 100, label: 'Shape' });
      },
      drawOverlay(o) {
        if (!this.start) return;
        const p = view.docToScreen(this.start.x, this.start.y), q = view.docToScreen(this.cur.x, this.cur.y);
        o.globalAlpha = opt('shape').opacity / 100;
        paintShape(o, opt('shape'), p, q, view.zoom);
      },
    };

    /* ---------- text ---------- */
    const text = {
      id: 'text', name: 'Text', key: 'T', icon: 'text', cursor: 'text', optionsKey: 'text',
      hint: 'Click to place text. Ctrl/⌘+Enter or Commit adds it as a new layer. Esc cancels.',
      options: [
        { key: 'font', label: 'Font', type: 'select', options: T.FONTS },
        { key: 'size', label: 'Size', type: 'range', min: 8, max: 400, unit: 'px' },
        { key: 'bold', label: 'Bold', type: 'checkbox' },
        { key: 'italic', label: 'Italic', type: 'checkbox' },
        { type: 'button', label: 'Commit', primary: true, action: () => text.commit() },
        { type: 'button', label: 'Cancel', action: () => text.cancel() },
      ],
      down(e) {
        if (this.entry) { this.commit(); return; }
        if (!editor.doc) return;
        this.open(e.x, e.y);
      },
      open(x, y) {
        const ta = document.createElement('textarea');
        ta.className = 'text-entry';
        ta.spellcheck = false;
        ta.setAttribute('aria-label', 'Text to add');
        ta.addEventListener('keydown', (ev) => {
          ev.stopPropagation();
          if (ev.key === 'Escape') { ev.preventDefault(); this.cancel(); }
          else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); this.commit(); }
        });
        ta.addEventListener('input', () => this.layout());
        view.stage.appendChild(ta);
        this.entry = { ta, x, y };
        this.layout();
        setTimeout(() => ta.focus(), 0);
      },
      layout() {
        if (!this.entry) return;
        const { ta, x, y } = this.entry, o = opt('text');
        const s = view.docToScreen(x, y);
        const px = o.size * view.zoom;
        Object.assign(ta.style, {
          left: s.x - 1 + 'px', top: s.y - 1 + 'px', font: T.fontString(o.font, px, o.bold, o.italic), lineHeight: '1.2', color: editor.primary,
        });
        const lines = ta.value.split('\n');
        ta.style.width = Math.max(px * 2, ...lines.map((l) => l.length * px * 0.62 + px)) + 'px';
        ta.style.height = lines.length * px * 1.2 + 6 + 'px';
      },
      commit() {
        if (!this.entry) return;
        const { ta, x, y } = this.entry;
        const value = ta.value;
        this.close();
        if (value.trim()) editor.addTextLayer(value, x, y, Object.assign({ color: editor.primary }, opt('text')));
      },
      cancel() { this.close(); },
      close() {
        if (!this.entry) return;
        this.entry.ta.remove();
        this.entry = null;
      },
      deactivate() { this.commit(); },
      onOptionsChange() { this.layout(); },
    };

    /* ---------- eyedropper, hand, zoom ---------- */
    const eyedropper = {
      id: 'eyedropper', name: 'Eyedropper', key: 'I', icon: 'eyedropper', cursor: 'crosshair',
      hint: 'Click to pick the primary colour from the image. Alt-click picks the secondary.',
      pick(e) {
        const hex = editor.sampleColor(e.x, e.y);
        if (hex) editor.setColor(e.alt ? 'secondary' : 'primary', hex);
      },
      down(e) { this.active = true; this.pick(e); },
      move(e) { if (this.active) this.pick(e); },
      up() { this.active = false; },
    };

    const hand = { id: 'hand', name: 'Hand', key: 'H', icon: 'hand', cursor: 'grab', hint: 'Drag to pan. Hold Space with any tool to pan.' };

    const zoom = {
      id: 'zoom', name: 'Zoom', key: 'Z', icon: 'zoom', cursor: 'zoom-in',
      hint: 'Click to zoom in, Alt-click to zoom out. Ctrl/⌘ + scroll zooms anywhere.',
      down(e) { if (e.alt) view.zoomOut(e.sx, e.sy); else view.zoomIn(e.sx, e.sy); },
    };

    return [
      move,
      shapeSelect('marquee', 'Rectangle Select', 'M', 'marquee', false),
      shapeSelect('ellipse-select', 'Ellipse Select', 'O', 'ellipseSelect', true),
      lasso,
      wand,
      crop,
      paintTool('brush', 'Brush', 'B', 'brush', false),
      paintTool('eraser', 'Eraser', 'E', 'eraser', true),
      bucket,
      gradient,
      shape,
      text,
      eyedropper,
      hand,
      zoom,
    ];
  };
})();
