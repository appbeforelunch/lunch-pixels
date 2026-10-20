/*
 * Tessera view: draws the document onto the stage canvas, keeps zoom and pan, draws the overlay
 * (marching ants, tool previews, brush cursor) and routes pointer input to the active tool.
 */
(function () {
  'use strict';
  const C = window.TesseraCore;
  const T = (window.Tessera = window.Tessera || {});

  class View {
    constructor(editor, stage) {
      this.editor = editor;
      this.stage = stage;
      this.canvas = stage.querySelector('#view');
      this.overlay = stage.querySelector('#overlay');
      this.ctx = this.canvas.getContext('2d');
      this.octx = this.overlay.getContext('2d');
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.w = 0;
      this.h = 0;
      this.dpr = window.devicePixelRatio || 1;
      this.tool = null;
      this.pointer = null; // last known pointer position {sx, sy, x, y}
      this.spaceDown = false;
      this.panning = null;
      this.antOffset = 0;
      this.pending = false;
      this.checker = this.makeChecker();

      new ResizeObserver(() => this.resize()).observe(stage);
      this.resize();

      editor.on('doc', () => { this.fit(); this.render(); });
      editor.on('resize', () => { this.fit(); this.render(); });
      editor.on('change', () => this.requestRender());
      editor.on('render', () => this.requestRender());
      editor.on('selection', () => this.renderOverlay());
      setInterval(() => {
        if (this.editor.selection) {
          this.antOffset = (this.antOffset + 1) % 8;
          this.renderOverlay();
        }
      }, 140);

      this.bindInput();
    }

    makeChecker() {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const x = c.getContext('2d');
      x.fillStyle = '#e9e6ee';
      x.fillRect(0, 0, 16, 16);
      x.fillStyle = '#c9c4d1';
      x.fillRect(0, 0, 8, 8);
      x.fillRect(8, 8, 8, 8);
      return this.ctx.createPattern(c, 'repeat');
    }

    resize() {
      const r = this.stage.getBoundingClientRect();
      const first = !this.w;
      this.dpr = window.devicePixelRatio || 1;
      this.w = r.width;
      this.h = r.height;
      for (const c of [this.canvas, this.overlay]) {
        c.width = Math.max(1, Math.round(r.width * this.dpr));
        c.height = Math.max(1, Math.round(r.height * this.dpr));
      }
      if (first) this.fit();
      this.render();
    }

    /* ---------- zoom and pan ---------- */

    fit(allowUpscale) {
      const d = this.editor.doc;
      if (!d || !this.w) return;
      this.zoom = C.fitZoom(d.width, d.height, this.w, this.h, 32, allowUpscale ? C.MAX_ZOOM : 1);
      this.center();
    }

    center() {
      const d = this.editor.doc;
      if (!d) return;
      this.panX = Math.round((this.w - d.width * this.zoom) / 2);
      this.panY = Math.round((this.h - d.height * this.zoom) / 2);
      this.changed();
    }

    setZoom(z, sx, sy) {
      if (!this.editor.doc) return;
      const v = C.zoomAround(this, z, sx == null ? this.w / 2 : sx, sy == null ? this.h / 2 : sy);
      this.zoom = v.zoom;
      this.panX = v.panX;
      this.panY = v.panY;
      this.changed();
    }

    zoomIn(sx, sy) { this.setZoom(C.nextZoom(this.zoom, 1), sx, sy); }
    zoomOut(sx, sy) { this.setZoom(C.nextZoom(this.zoom, -1), sx, sy); }

    actualPixels() {
      this.zoom = 1;
      this.center();
    }

    panBy(dx, dy) {
      this.panX += dx;
      this.panY += dy;
      this.changed();
    }

    changed() {
      this.requestRender();
      this.editor.emit('view');
    }

    screenToDoc(sx, sy) {
      return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
    }

    docToScreen(x, y) {
      return { x: x * this.zoom + this.panX, y: y * this.zoom + this.panY };
    }

    /* ---------- drawing ---------- */

    requestRender() {
      if (this.pending) return;
      this.pending = true;
      requestAnimationFrame(() => {
        this.pending = false;
        this.render();
      });
    }

    render() {
      const ctx = this.ctx, dpr = this.dpr, d = this.editor.doc;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (d) {
        // Snap to whole device pixels so the image covers its backing exactly (no light seam at the edges).
        const x = Math.round(this.panX * dpr), y = Math.round(this.panY * dpr);
        const w = Math.round((this.panX + d.width * this.zoom) * dpr) - x, h = Math.round((this.panY + d.height * this.zoom) * dpr) - y;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 24 * dpr;
        ctx.shadowOffsetY = 6 * dpr;
        ctx.fillStyle = '#ddd';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = this.checker;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        const comp = this.editor.composite();
        ctx.imageSmoothingEnabled = this.zoom < 2;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(comp, 0, 0, d.width, d.height, x, y, w, h);
      }
      this.renderOverlay();
    }

    renderOverlay() {
      const o = this.octx, dpr = this.dpr, d = this.editor.doc;
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.clearRect(0, 0, this.overlay.width, this.overlay.height);
      if (!d) return;
      o.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sel = this.editor.selection;
      if (sel) {
        const p = new Path2D();
        p.addPath(sel.path, new DOMMatrix([this.zoom, 0, 0, this.zoom, this.panX, this.panY]));
        o.lineWidth = 1;
        o.setLineDash([4, 4]);
        o.lineDashOffset = -this.antOffset;
        o.strokeStyle = '#000';
        o.stroke(p);
        o.lineDashOffset = -this.antOffset + 4;
        o.strokeStyle = '#fff';
        o.stroke(p);
        o.setLineDash([]);
      }
      if (this.tool && this.tool.drawOverlay) {
        o.save();
        this.tool.drawOverlay(o, this);
        o.restore();
      }
      const radius = this.tool && this.tool.cursorRadius ? this.tool.cursorRadius() : 0;
      if (radius && this.pointer && !this.spaceDown) {
        const r = Math.max(1.5, radius * this.zoom);
        o.beginPath();
        o.arc(this.pointer.sx, this.pointer.sy, r, 0, Math.PI * 2);
        o.lineWidth = 1;
        o.strokeStyle = 'rgba(0,0,0,0.7)';
        o.stroke();
        o.beginPath();
        o.arc(this.pointer.sx, this.pointer.sy, r + 1, 0, Math.PI * 2);
        o.strokeStyle = 'rgba(255,255,255,0.8)';
        o.stroke();
      }
    }

    /* ---------- input ---------- */

    toolEvent(e) {
      const r = this.overlay.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const p = this.screenToDoc(sx, sy);
      return { x: p.x, y: p.y, sx, sy, shift: e.shiftKey, alt: e.altKey, mod: e.ctrlKey || e.metaKey, button: e.button, detail: e.detail };
    }

    updateCursor() {
      let cursor = 'default';
      if (this.panning) cursor = 'grabbing';
      else if (this.spaceDown || (this.tool && this.tool.id === 'hand')) cursor = 'grab';
      else if (this.tool) cursor = this.tool.cursor || 'crosshair';
      if (this.tool && this.tool.cursorRadius && !this.spaceDown && !this.panning) cursor = 'none';
      this.overlay.style.cursor = this.editor.doc ? cursor : 'default';
    }

    bindInput() {
      const ov = this.overlay;
      ov.addEventListener('pointerdown', (e) => {
        if (!this.editor.doc) return;
        ov.setPointerCapture(e.pointerId);
        const ev = this.toolEvent(e);
        this.pointer = ev;
        if (e.button === 1 || this.spaceDown || (this.tool && this.tool.id === 'hand' && e.button === 0)) {
          e.preventDefault();
          this.panning = { sx: ev.sx, sy: ev.sy, panX: this.panX, panY: this.panY };
          this.updateCursor();
          return;
        }
        if (e.button !== 0 || !this.tool) return;
        this.toolActive = true;
        if (this.tool.down) this.tool.down(ev);
        this.renderOverlay();
      });
      ov.addEventListener('pointermove', (e) => {
        const ev = this.toolEvent(e);
        this.pointer = ev;
        this.editor.emit('pointer', ev);
        if (this.panning) {
          this.panX = this.panning.panX + ev.sx - this.panning.sx;
          this.panY = this.panning.panY + ev.sy - this.panning.sy;
          this.changed();
          return;
        }
        if (this.toolActive && this.tool && this.tool.move) this.tool.move(ev);
        else if (this.tool && this.tool.hover) this.tool.hover(ev);
        this.renderOverlay();
      });
      const end = (e) => {
        if (this.panning) {
          this.panning = null;
          this.updateCursor();
          return;
        }
        if (!this.toolActive) return;
        this.toolActive = false;
        if (this.tool && this.tool.up) this.tool.up(this.toolEvent(e));
        this.renderOverlay();
      };
      ov.addEventListener('pointerup', end);
      ov.addEventListener('pointercancel', end);
      ov.addEventListener('pointerleave', () => {
        if (!this.toolActive) {
          this.pointer = null;
          this.renderOverlay();
        }
      });
      ov.addEventListener('dblclick', (e) => {
        if (this.tool && this.tool.dblclick) this.tool.dblclick(this.toolEvent(e));
      });
      ov.addEventListener('wheel', (e) => {
        if (!this.editor.doc) return;
        e.preventDefault();
        const ev = this.toolEvent(e);
        if (e.ctrlKey || e.metaKey || e.altKey) {
          const unit = e.deltaMode === 1 ? 16 : 1;
          this.setZoom(this.zoom * Math.exp(-e.deltaY * unit * 0.0025), ev.sx, ev.sy);
        } else {
          this.panBy(-e.deltaX, -e.deltaY);
        }
      }, { passive: false });
    }

    setTool(tool) {
      if (this.tool && this.tool.deactivate) this.tool.deactivate();
      this.tool = tool;
      this.toolActive = false;
      if (tool && tool.activate) tool.activate();
      this.updateCursor();
      this.renderOverlay();
    }
  }

  T.View = View;
})();
