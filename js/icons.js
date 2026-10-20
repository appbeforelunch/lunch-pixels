/* Tessera icons: simple 24px line drawings made for this app. */
(function () {
  'use strict';
  const T = (window.Tessera = window.Tessera || {});

  const P = {
    move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
    marquee: '<rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2.4"/>',
    ellipseSelect: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5" stroke-dasharray="3 2.4"/>',
    lasso: '<path d="M8.5 16.5C4 15 3 11.5 5.5 8.5S14 4 18 6s2.5 6.5-1.5 8.5-8 1.5-8 1.5"/><path d="M8.5 16.5c-1.5 1-1.5 3 .5 3.5"/>',
    wand: '<path d="M4 20L14.5 9.5"/><path d="M13 8l3 3"/><path d="M17 3v3M20.5 6.5h-3M15 4.5l1 1M20 10l-1-1M19.5 3.5l-1 1"/>',
    crop: '<path d="M7 3v14h14"/><path d="M3 7h14v14"/>',
    brush: '<path d="M20 4c-3 1-8 6-10 9l1.5 1.5c3-2 8-7 9-10z"/><path d="M9.5 14C7 14 6 15.5 6 17.5S4.5 20 3.5 20c2 1 7 1 7.5-3.5z"/>',
    eraser: '<path d="M4 15.5l9-9a2 2 0 012.8 0l3.7 3.7a2 2 0 010 2.8L13 19.5H8z"/><path d="M9 10.5l5 5M8 19.5h12"/>',
    bucket: '<path d="M5 10.5L11.5 4l7 7-6.5 6.5a2 2 0 01-2.8 0L5 13.3a2 2 0 010-2.8z"/><path d="M5.5 11h12.5"/><path d="M20 15s1.8 2.2 1.8 3.4a1.8 1.8 0 01-3.6 0C18.2 17.2 20 15 20 15z"/>',
    gradient: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M8 4.5v15M12 4.5v15" stroke-dasharray="1.5 1.5"/><path d="M16 4.5v15" stroke-dasharray="1 2.5"/>',
    shape: '<rect x="3.5" y="10.5" width="10" height="10" rx="1"/><circle cx="15.5" cy="8.5" r="5"/>',
    text: '<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/>',
    eyedropper: '<path d="M14.5 4.5l5 5M17 2.5l4.5 4.5-2.5 2.5L14.5 5z"/><path d="M15.5 8.5L7 17l-3 3.5 3.5-3 8.5-8.5"/>',
    hand: '<path d="M8 12.5V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4.5-2.5 7.5-6.5 7.5-3 0-4.5-1.5-6-4L3 13.8a1.5 1.5 0 012.5-1.6L8 15"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5"/>',
    undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 010 10H12"/>',
    redo: '<path d="M15 7l4.5 4.5L15 16"/><path d="M19 11.5H9.5a5 5 0 000 10H12"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M4 4l16 16"/><path d="M9.5 6C10.3 5.7 11.1 5.5 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-2.6 3.4M14.5 17.9c-.8.4-1.6.6-2.5.6-6 0-9.5-6.5-9.5-6.5a17 17 0 013.4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    duplicate: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 10.5v6M14 10.5v6"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    merge: '<path d="M7 4v5l5 5 5-5V4M12 14v6"/><path d="M9 18l3 3 3-3"/>',
    swap: '<path d="M7 4L4 7l3 3"/><path d="M4 7h11a4 4 0 014 4v1"/><path d="M17 20l3-3-3-3"/><path d="M20 17H9a4 4 0 01-4-4v-1"/>',
    reset: '<rect x="4" y="4" width="9" height="9" rx="1.5" fill="currentColor"/><rect x="11" y="11" width="9" height="9" rx="1.5"/>',
    open: '<path d="M3.5 7.5v10a2 2 0 002 2h13a2 2 0 002-2v-8a2 2 0 00-2-2h-7l-2-3h-4a2 2 0 00-2 2z"/>',
    file: '<path d="M6 3.5h8l4.5 4.5v12.5H6z"/><path d="M14 3.5V8h4.5M12 11v6M9 14h6"/>',
    fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    minus: '<path d="M5 12h14"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="M4 17l5-5 4 4 2.5-2.5L20 18"/>',
  };

  T.icon = function (name, size) {
    const s = size || 20;
    return `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  };

  // The app mark: four tiles of a mosaic.
  T.logo = function (size) {
    const s = size || 22;
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="9" height="11" rx="2" fill="#ff7a59"/>
      <rect x="13" y="2" width="9" height="7" rx="2" fill="#f2c14e"/>
      <rect x="2" y="15" width="9" height="7" rx="2" fill="#3fc1b0"/>
      <rect x="13" y="11" width="9" height="11" rx="2" fill="#b48cf2"/>
    </svg>`;
  };
})();
