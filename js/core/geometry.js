/* Tessera core: view and rectangle maths. Pure functions, no DOM. */
(function (root) {
  'use strict';
  const NS = (root.TesseraCore = root.TesseraCore || {});

  const ZOOM_STEPS = [0.02, 0.03, 0.05, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
  const MIN_ZOOM = ZOOM_STEPS[0];
  const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

  function clampZoom(z) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }

  // Next preset zoom level in a direction (+1 in, -1 out).
  function nextZoom(z, dir) {
    if (dir > 0) {
      for (const s of ZOOM_STEPS) if (s > z * 1.001) return s;
      return MAX_ZOOM;
    }
    for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < z * 0.999) return ZOOM_STEPS[i];
    return MIN_ZOOM;
  }

  function fitZoom(docW, docH, viewW, viewH, pad, maxZoom) {
    if (!(docW > 0 && docH > 0 && viewW > 0 && viewH > 0)) return 1;
    pad = pad == null ? 32 : pad;
    maxZoom = maxZoom == null ? 1 : maxZoom;
    const z = Math.min(maxZoom, (viewW - pad * 2) / docW, (viewH - pad * 2) / docH);
    return clampZoom(z);
  }

  // Zoom so the document point under screen point (sx, sy) stays put.
  function zoomAround(view, newZoom, sx, sy) {
    newZoom = clampZoom(newZoom);
    const dx = (sx - view.panX) / view.zoom;
    const dy = (sy - view.panY) / view.zoom;
    return { zoom: newZoom, panX: sx - dx * newZoom, panY: sy - dy * newZoom };
  }

  function normRect(x1, y1, x2, y2) {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }

  // Round a rectangle to whole pixels and clip it to a w x h area.
  function clampRect(r, w, h) {
    const x1 = Math.min(w, Math.max(0, Math.round(r.x)));
    const y1 = Math.min(h, Math.max(0, Math.round(r.y)));
    const x2 = Math.min(w, Math.max(0, Math.round(r.x + r.w)));
    const y2 = Math.min(h, Math.max(0, Math.round(r.y + r.h)));
    return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
  }

  // Make the drag from start to cur a square (for shapes with Shift held).
  function constrainSquare(start, cur) {
    const dx = cur.x - start.x, dy = cur.y - start.y;
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: start.x + (dx < 0 ? -s : s), y: start.y + (dy < 0 ? -s : s) };
  }

  // Snap the angle of start->cur to multiples of stepDeg, keeping its length.
  function constrainAngle(start, cur, stepDeg) {
    const step = ((stepDeg || 45) * Math.PI) / 180;
    const dx = cur.x - start.x, dy = cur.y - start.y;
    const len = Math.hypot(dx, dy);
    const a = Math.round(Math.atan2(dy, dx) / step) * step;
    return { x: start.x + Math.cos(a) * len, y: start.y + Math.sin(a) * len };
  }

  const ANCHORS = {
    'top-left': [0, 0], top: [0.5, 0], 'top-right': [1, 0],
    left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5],
    'bottom-left': [0, 1], bottom: [0.5, 1], 'bottom-right': [1, 1],
  };

  // Where old content lands when the canvas is resized around an anchor.
  function anchorOffset(oldW, oldH, newW, newH, anchor) {
    const a = ANCHORS[anchor] || ANCHORS.center;
    return { x: Math.round((newW - oldW) * a[0]), y: Math.round((newH - oldH) * a[1]) };
  }

  Object.assign(NS, {
    ZOOM_STEPS, MIN_ZOOM, MAX_ZOOM, ANCHORS,
    clampZoom, nextZoom, fitZoom, zoomAround, normRect, clampRect, constrainSquare, constrainAngle, anchorOffset,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
