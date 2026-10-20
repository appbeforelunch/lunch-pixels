/* Tessera entry point: wires the editor model, the view and the UI together. */
(function () {
  'use strict';
  const T = window.Tessera;
  const editor = new T.Editor();
  const view = new T.View(editor, document.getElementById('stage'));
  const ui = new T.UI(editor, view);
  // Exposed for the automated tests and for tinkering from the console.
  window.tessera = { editor, view, ui, core: window.TesseraCore };
  document.body.classList.add('ready');
})();
