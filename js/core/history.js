/* Tessera core: a linear undo/redo stack. Entries are opaque; the editor stores document snapshots in them. */
(function (root) {
  'use strict';
  const NS = (root.TesseraCore = root.TesseraCore || {});

  class History {
    constructor(limit) {
      this.limit = Math.max(2, limit || 40);
      this.entries = [];
      this.index = -1;
    }

    get current() {
      return this.entries[this.index] || null;
    }

    get length() {
      return this.entries.length;
    }

    clear() {
      this.entries = [];
      this.index = -1;
    }

    // Adding an entry drops everything after the current position (no branching redo).
    push(entry) {
      this.entries.length = this.index + 1;
      this.entries.push(entry);
      while (this.entries.length > this.limit) this.entries.shift();
      this.index = this.entries.length - 1;
      return entry;
    }

    canUndo() {
      return this.index > 0;
    }

    canRedo() {
      return this.index < this.entries.length - 1;
    }

    undo() {
      if (!this.canUndo()) return null;
      this.index--;
      return this.current;
    }

    redo() {
      if (!this.canRedo()) return null;
      this.index++;
      return this.current;
    }

    jump(i) {
      if (i < 0 || i >= this.entries.length) return null;
      this.index = i;
      return this.current;
    }
  }

  NS.History = History;
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
