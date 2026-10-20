/* Tessera core: the catalogue of adjustments and filters shown in menus, panels and dialogs. */
(function (root) {
  'use strict';
  const NS = (root.TesseraCore = root.TesseraCore || {});
  const range = (key, label, min, max, value, step) => ({ key, label, type: 'range', min, max, value, step: step || 1 });

  const ADJUSTMENTS = [
    {
      id: 'brightness-contrast', name: 'Brightness / Contrast',
      params: [range('brightness', 'Brightness', -100, 100, 0), range('contrast', 'Contrast', -100, 100, 0)],
      run: (img, p) => NS.brightnessContrast(img, p.brightness, p.contrast),
    },
    {
      id: 'levels', name: 'Levels',
      params: [
        range('inBlack', 'Input black', 0, 254, 0), range('inWhite', 'Input white', 1, 255, 255),
        range('gamma', 'Midtones (gamma)', 0.1, 4, 1, 0.01),
        range('outBlack', 'Output black', 0, 255, 0), range('outWhite', 'Output white', 0, 255, 255),
      ],
      run: (img, p) => NS.levels(img, p.inBlack, p.inWhite, p.gamma, p.outBlack, p.outWhite),
    },
    { id: 'exposure', name: 'Exposure', params: [range('ev', 'Exposure (stops)', -3, 3, 0, 0.05)], run: (img, p) => NS.exposure(img, p.ev) },
    {
      id: 'hue-saturation', name: 'Hue / Saturation',
      params: [range('hue', 'Hue', -180, 180, 0), range('saturation', 'Saturation', -100, 100, 0), range('lightness', 'Lightness', -100, 100, 0)],
      run: (img, p) => NS.hueSaturation(img, p.hue, p.saturation, p.lightness),
    },
    { id: 'vibrance', name: 'Vibrance', params: [range('amount', 'Vibrance', -100, 100, 30)], run: (img, p) => NS.vibrance(img, p.amount) },
    {
      id: 'color-balance', name: 'Color Balance',
      params: [range('r', 'Cyan ↔ Red', -100, 100, 0), range('g', 'Magenta ↔ Green', -100, 100, 0), range('b', 'Yellow ↔ Blue', -100, 100, 0)],
      run: (img, p) => NS.colorBalance(img, p.r, p.g, p.b),
    },
    { id: 'warmth', name: 'Warmth', params: [range('amount', 'Cool ↔ Warm', -100, 100, 20)], run: (img, p) => NS.temperature(img, p.amount) },
    { id: 'black-white', name: 'Black & White', params: [], run: (img) => NS.grayscale(img) },
    { id: 'sepia', name: 'Sepia', params: [range('amount', 'Amount', 0, 100, 80)], run: (img, p) => NS.sepia(img, p.amount) },
    { id: 'invert', name: 'Invert', params: [], run: (img) => NS.invert(img) },
    { id: 'threshold', name: 'Threshold', params: [range('level', 'Level', 0, 255, 128)], run: (img, p) => NS.threshold(img, p.level) },
    { id: 'posterize', name: 'Posterize', params: [range('levels', 'Levels', 2, 32, 6)], run: (img, p) => NS.posterize(img, p.levels) },
  ];

  const FILTERS = [
    { id: 'gaussian-blur', name: 'Gaussian Blur', params: [range('radius', 'Radius', 0.5, 60, 4, 0.5)], run: (img, p) => NS.gaussianBlur(img, p.radius) },
    { id: 'box-blur', name: 'Box Blur', params: [range('radius', 'Radius', 1, 60, 4)], run: (img, p) => NS.boxBlur(img, p.radius) },
    { id: 'sharpen', name: 'Sharpen', params: [range('amount', 'Amount', 0, 100, 50)], run: (img, p) => NS.sharpen(img, p.amount) },
    {
      id: 'unsharp-mask', name: 'Unsharp Mask',
      params: [range('radius', 'Radius', 0.5, 20, 2, 0.5), range('amount', 'Amount (%)', 0, 300, 100), range('threshold', 'Threshold', 0, 64, 0)],
      run: (img, p) => NS.unsharpMask(img, p.radius, p.amount, p.threshold),
    },
    { id: 'reduce-noise', name: 'Reduce Noise', params: [range('radius', 'Radius', 1, 3, 1)], run: (img, p) => NS.median(img, p.radius) },
    {
      id: 'add-noise', name: 'Add Noise',
      params: [range('amount', 'Amount', 0, 100, 15), { key: 'mono', label: 'Monochromatic', type: 'checkbox', value: true }],
      run: (img, p) => NS.addNoise(img, p.amount, p.mono, 7),
    },
    { id: 'pixelate', name: 'Pixelate', params: [range('size', 'Cell size', 2, 120, 12)], run: (img, p) => NS.pixelate(img, p.size) },
    { id: 'emboss', name: 'Emboss', params: [], run: (img) => NS.emboss(img) },
    { id: 'find-edges', name: 'Find Edges', params: [], run: (img) => NS.findEdges(img) },
    { id: 'vignette', name: 'Vignette', params: [range('amount', 'Amount', 0, 100, 50)], run: (img, p) => NS.vignette(img, p.amount) },
  ];

  function defaults(effect) {
    const v = {};
    for (const p of effect.params) v[p.key] = p.value;
    return v;
  }

  Object.assign(NS, { ADJUSTMENTS, FILTERS, effectDefaults: defaults });
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
