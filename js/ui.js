/*
 * Tessera UI: menus, keyboard shortcuts, tool rail, options bar, panels (layers, adjust, history),
 * dialogs, colour swatches, file open / drop / paste and export.
 */
(function () {
  'use strict';
  const C = window.TesseraCore;
  const T = (window.Tessera = window.Tessera || {});

  const BLEND_MODES = [
    ['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
    ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'],
    ['hard-light', 'Hard Light'], ['soft-light', 'Soft Light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'],
    ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
  ];

  const FORMATS = {
    png: { mime: 'image/png', ext: 'png', label: 'PNG (lossless, keeps transparency)' },
    jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG (smaller, no transparency)' },
    webp: { mime: 'image/webp', ext: 'webp', label: 'WebP (small, keeps transparency)' },
  };

  const SELECT_TOOLS = ['marquee', 'ellipse-select', 'lasso', 'wand'];

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // Keyboard event -> normalised key name, independent of layout quirks with Alt on macOS.
  function keyName(e) {
    const code = e.code || '';
    if (code.startsWith('Key')) return code.slice(3).toLowerCase();
    if (code.startsWith('Digit')) return code.slice(5);
    const map = { BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', NumpadAdd: '=', NumpadSubtract: '-' };
    if (map[code]) return map[code];
    const k = e.key === '+' ? '=' : e.key;
    return k.length === 1 ? k.toLowerCase() : k;
  }

  function parseShortcut(s) {
    const parts = s.split('+');
    let key = parts.pop();
    if (key === '') key = '+';
    return { mod: parts.includes('Mod'), shift: parts.includes('Shift'), alt: parts.includes('Alt'), key: key.length === 1 ? key.toLowerCase() : key };
  }

  class UI {
    constructor(editor, view) {
      this.editor = editor;
      this.view = view;
      this.isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
      this.tools = T.createTools(editor, view, this);
      this.toolById = {};
      this.tools.forEach((t) => (this.toolById[t.id] = t));
      this.lastExport = null;
      this.activeDialog = null;
      this.commands = {};

      this.buildCommands();
      this.buildMenus();
      this.buildToolRail();
      this.buildTopbar();
      this.buildPanels();
      this.bindColors();
      this.bindFiles();
      this.bindKeys();
      this.bindStatus();

      editor.on('doc', () => this.refreshAll());
      editor.on('change', () => { this.refreshLayers(); this.refreshButtons(); });
      editor.on('history', () => { this.refreshHistory(); this.refreshButtons(); });
      editor.on('colors', () => this.refreshColors());
      editor.on('selection', () => this.refreshButtons());
      editor.on('resize', () => this.refreshStatus());
      editor.on('view', () => {
        this.refreshStatus();
        const t = this.toolById.text;
        if (t.entry) t.layout();
      });

      this.setTool('brush');
      this.refreshAll();
    }

    /* ---------- commands, menus, shortcuts ---------- */

    cmd(id, label, run, opts) {
      opts = opts || {};
      this.commands[id] = { id, label, run, keys: [].concat(opts.key || []), native: opts.native, enabled: opts.enabled || (() => !!this.editor.doc) };
    }

    run(id) {
      const c = this.commands[id];
      if (!c) throw new Error('Unknown command ' + id);
      if (!c.enabled()) return false;
      c.run();
      return true;
    }

    buildCommands() {
      const ed = this.editor, view = this.view;
      const always = () => true;
      const hasSel = () => !!ed.selection;
      const multi = () => ed.layers.length > 1;
      this.cmd('file.new', 'New…', () => this.newDialog(), { key: 'Mod+Alt+N', enabled: always });
      this.cmd('file.open', 'Open…', () => this.chooseFile('open'), { key: 'Mod+O', enabled: always });
      this.cmd('file.place', 'Place Image as Layer…', () => this.chooseFile('place'), { key: 'Mod+Shift+O' });
      this.cmd('file.export', 'Export…', () => this.exportDialog(), { key: 'Mod+S' });
      this.cmd('file.quickExport', 'Quick Export as PNG', () => this.exportImage({ name: ed.fileName, format: 'png', quality: 100 }), { key: 'Mod+Shift+S' });
      this.cmd('file.close', 'Close Image', () => this.confirmDiscard(() => ed.closeDocument()));

      this.cmd('edit.undo', 'Undo', () => ed.undo(), { key: 'Mod+Z', enabled: () => ed.history.canUndo() });
      this.cmd('edit.redo', 'Redo', () => ed.redo(), { key: ['Mod+Shift+Z', 'Mod+Y'], enabled: () => ed.history.canRedo() });
      this.cmd('edit.cut', 'Cut', () => ed.cut(), { key: 'Mod+X' });
      this.cmd('edit.copy', 'Copy', () => { ed.copy(); this.toast(ed.selection ? 'Copied the selection.' : 'Copied the whole layer.'); }, { key: 'Mod+C' });
      this.cmd('edit.paste', 'Paste', () => this.pasteInternal(), { key: 'Mod+V', native: true });
      this.cmd('edit.clear', 'Clear Selection Pixels', () => ed.clearSelection(), { key: ['Delete', 'Backspace'], enabled: hasSel });
      this.cmd('edit.fill', 'Fill with Primary Colour', () => ed.fillSelection(ed.primary), { key: 'Alt+Backspace' });
      this.cmd('edit.selectAll', 'Select All', () => ed.selectAll(), { key: 'Mod+A' });
      this.cmd('edit.deselect', 'Deselect', () => ed.deselect(), { key: 'Mod+D', enabled: hasSel });
      this.cmd('edit.invertSelection', 'Invert Selection', () => ed.invertSelection(), { key: 'Mod+Shift+I' });

      this.cmd('image.size', 'Image Size…', () => this.imageSizeDialog(), { key: 'Mod+Alt+I' });
      this.cmd('image.canvasSize', 'Canvas Size…', () => this.canvasSizeDialog(), { key: 'Mod+Alt+C' });
      this.cmd('image.rotateCW', 'Rotate 90° Clockwise', () => ed.rotate(90));
      this.cmd('image.rotateCCW', 'Rotate 90° Counter-clockwise', () => ed.rotate(-90));
      this.cmd('image.rotate180', 'Rotate 180°', () => ed.rotate(180));
      this.cmd('image.flipH', 'Flip Horizontal', () => ed.flipImage(true));
      this.cmd('image.flipV', 'Flip Vertical', () => ed.flipImage(false));
      this.cmd('image.cropToSelection', 'Crop to Selection', () => ed.cropToSelection(), { enabled: hasSel });
      this.cmd('image.flatten', 'Flatten Image', () => ed.flatten(), { enabled: multi });

      this.cmd('layer.new', 'New Layer', () => ed.addLayer(), { key: 'Mod+Shift+L' });
      this.cmd('layer.duplicate', 'Duplicate Layer', () => ed.duplicateLayer(), { key: 'Mod+J' });
      this.cmd('layer.delete', 'Delete Layer', () => ed.deleteLayer(), { enabled: multi });
      this.cmd('layer.up', 'Move Layer Up', () => ed.moveLayer(ed.doc.activeId, 1), { key: 'Mod+]', enabled: () => ed.doc && ed.activeIndex < ed.layers.length - 1 });
      this.cmd('layer.down', 'Move Layer Down', () => ed.moveLayer(ed.doc.activeId, -1), { key: 'Mod+[', enabled: () => ed.doc && ed.activeIndex > 0 });
      this.cmd('layer.mergeDown', 'Merge Down', () => ed.mergeDown(), { key: 'Mod+E', enabled: () => ed.doc && ed.activeIndex > 0 });
      this.cmd('layer.flipH', 'Flip Layer Horizontal', () => ed.flipLayer(true));
      this.cmd('layer.flipV', 'Flip Layer Vertical', () => ed.flipLayer(false));

      for (const a of C.ADJUSTMENTS) this.cmd('adjust.' + a.id, a.name + (a.params.length ? '…' : ''), () => this.runEffect(a));
      for (const f of C.FILTERS) this.cmd('filter.' + f.id, f.name + (f.params.length ? '…' : ''), () => this.runEffect(f));

      this.cmd('view.zoomIn', 'Zoom In', () => view.zoomIn(), { key: ['Mod+=', 'Mod+Shift+='] });
      this.cmd('view.zoomOut', 'Zoom Out', () => view.zoomOut(), { key: 'Mod+-' });
      this.cmd('view.fit', 'Fit on Screen', () => view.fit(true), { key: 'Mod+0' });
      this.cmd('view.actual', 'Actual Pixels (100%)', () => view.actualPixels(), { key: 'Mod+1' });
      this.cmd('view.panels', 'Show / Hide Panels', () => document.body.classList.toggle('panels-hidden'), { enabled: always });

      this.cmd('help.shortcuts', 'Keyboard Shortcuts', () => this.shortcutsDialog(), { key: 'Shift+?', enabled: always });
      this.cmd('help.about', 'About Tessera', () => this.aboutDialog(), { enabled: always });
    }

    shortcutText(s) {
      const p = parseShortcut(s);
      const keyLabel = { Backspace: '⌫', Delete: 'Del', '=': '+', Tab: 'Tab' }[p.key] || p.key.toUpperCase();
      if (this.isMac) return (p.alt ? '⌥' : '') + (p.shift && p.key !== '?' ? '⇧' : '') + (p.mod ? '⌘' : '') + keyLabel;
      return [p.mod && 'Ctrl', p.alt && 'Alt', p.shift && p.key !== '?' && 'Shift', keyLabel].filter(Boolean).join('+');
    }

    buildMenus() {
      const sep = '-';
      this.menus = [
        ['File', ['file.new', 'file.open', 'file.place', sep, 'file.export', 'file.quickExport', sep, 'file.close']],
        ['Edit', ['edit.undo', 'edit.redo', sep, 'edit.cut', 'edit.copy', 'edit.paste', sep, 'edit.clear', 'edit.fill', sep, 'edit.selectAll', 'edit.deselect', 'edit.invertSelection']],
        ['Image', ['image.size', 'image.canvasSize', sep, 'image.rotateCW', 'image.rotateCCW', 'image.rotate180', 'image.flipH', 'image.flipV', sep, 'image.cropToSelection', 'image.flatten']],
        ['Layer', ['layer.new', 'layer.duplicate', 'layer.delete', sep, 'layer.up', 'layer.down', 'layer.mergeDown', sep, 'layer.flipH', 'layer.flipV']],
        ['Adjust', C.ADJUSTMENTS.map((a) => 'adjust.' + a.id)],
        ['Filter', C.FILTERS.map((f) => 'filter.' + f.id)],
        ['View', ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.actual', sep, 'view.panels']],
        ['Help', ['help.shortcuts', 'help.about']],
      ];
      const bar = document.getElementById('menubar');
      this.openMenu = null;
      for (const [name, items] of this.menus) {
        const wrap = el('div', 'menu-wrap');
        const btn = el('button', 'menu-title', name);
        btn.type = 'button';
        btn.dataset.menu = name;
        btn.setAttribute('aria-haspopup', 'true');
        const list = el('div', 'menu');
        list.setAttribute('role', 'menu');
        wrap.append(btn, list);
        bar.appendChild(wrap);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.openMenu === wrap) this.closeMenus();
          else this.showMenu(wrap, items);
        });
        btn.addEventListener('pointerenter', () => {
          if (this.openMenu && this.openMenu !== wrap) this.showMenu(wrap, items);
        });
      }
      document.addEventListener('pointerdown', (e) => {
        if (this.openMenu && !e.target.closest('.menu-wrap')) this.closeMenus();
      });
    }

    showMenu(wrap, items) {
      this.closeMenus();
      const list = wrap.querySelector('.menu');
      list.innerHTML = '';
      for (const id of items) {
        if (id === '-') { list.appendChild(el('div', 'menu-sep')); continue; }
        const c = this.commands[id];
        const item = el('button', 'menu-item');
        item.type = 'button';
        item.dataset.cmd = id;
        item.setAttribute('role', 'menuitem');
        item.innerHTML = `<span>${escapeHtml(c.label)}</span><kbd>${c.keys[0] ? this.shortcutText(c.keys[0]) : ''}</kbd>`;
        item.disabled = !c.enabled();
        item.addEventListener('click', () => {
          this.closeMenus();
          this.run(id);
        });
        list.appendChild(item);
      }
      wrap.classList.add('open');
      this.openMenu = wrap;
    }

    closeMenus() {
      if (this.openMenu) this.openMenu.classList.remove('open');
      this.openMenu = null;
    }

    bindKeys() {
      const bound = [];
      for (const c of Object.values(this.commands)) for (const k of c.keys) bound.push([parseShortcut(k), c]);
      document.addEventListener('keydown', (e) => {
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (document.querySelector('dialog[open]')) return;
        if (e.key === 'Escape' && this.openMenu) { this.closeMenus(); return; }
        const mod = e.ctrlKey || e.metaKey;
        if (e.code === 'Space' && !mod) {
          e.preventDefault();
          if (!this.view.spaceDown) { this.view.spaceDown = true; this.view.updateCursor(); this.view.renderOverlay(); }
          return;
        }
        const tool = this.view.tool;
        if (!mod && tool && tool.keydown && tool.keydown(e)) { e.preventDefault(); return; }
        const key = keyName(e);
        for (const [s, c] of bound) {
          const shiftOk = s.key === '?' ? true : s.shift === e.shiftKey;
          if (s.mod === mod && shiftOk && s.alt === e.altKey && (s.key === key || s.key === e.key)) {
            if (c.native) return; // let the browser fire its paste event
            e.preventDefault();
            this.run(c.id);
            return;
          }
        }
        if (mod || e.altKey) return;
        if (key === 'x') { this.editor.swapColors(); return; }
        if (key === 'd') { this.editor.resetColors(); return; }
        if (key === '[' || key === ']') { this.changeBrushSize(key === ']' ? 1 : -1); e.preventDefault(); return; }
        const t = this.tools.find((t) => t.key.toLowerCase() === key);
        if (t) { e.preventDefault(); this.setTool(t.id); }
      });
      document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
          this.view.spaceDown = false;
          this.view.updateCursor();
          this.view.renderOverlay();
        }
      });
      window.addEventListener('blur', () => { this.view.spaceDown = false; this.view.updateCursor(); });
      window.addEventListener('beforeunload', (e) => {
        if (this.editor.dirty) { e.preventDefault(); e.returnValue = ''; }
      });
    }

    changeBrushSize(dir) {
      const t = this.view.tool;
      const store = t && t.optionsKey && T.toolOptions[t.optionsKey];
      if (!store || store.size == null) return;
      const next = dir > 0 ? Math.ceil(store.size * 1.2 + 0.5) : Math.floor(store.size / 1.2);
      store.size = Math.max(1, Math.min(400, next));
      this.renderOptions();
      this.view.renderOverlay();
    }

    /* ---------- tools ---------- */

    buildToolRail() {
      const rail = document.getElementById('tool-buttons');
      for (const t of this.tools) {
        const b = el('button', 'tool-btn', T.icon(t.icon, 22));
        b.type = 'button';
        b.dataset.tool = t.id;
        b.title = `${t.name} (${t.key})`;
        b.setAttribute('aria-label', t.name);
        b.addEventListener('click', () => this.setTool(t.id));
        rail.appendChild(b);
      }
    }

    setTool(id) {
      const t = this.toolById[id];
      if (!t || this.view.tool === t) return;
      this.view.setTool(t);
      document.querySelectorAll('.tool-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.tool === id);
        b.setAttribute('aria-pressed', b.dataset.tool === id ? 'true' : 'false');
      });
      this.renderOptions();
      this.refreshStatus();
    }

    renderOptions() {
      const bar = document.getElementById('optionsbar');
      const t = this.view.tool;
      bar.innerHTML = '';
      if (!t) return;
      bar.appendChild(el('div', 'opt-tool', `${T.icon(t.icon, 18)}<span>${escapeHtml(t.name)}</span>`));
      const store = t.optionsKey ? T.toolOptions[t.optionsKey] : null;
      const changed = () => {
        if (t.onOptionsChange) t.onOptionsChange();
        this.view.renderOverlay();
      };
      for (const o of t.options || []) {
        if (o.type === 'button') {
          const b = el('button', o.primary ? 'btn btn-primary btn-sm' : 'btn btn-sm', escapeHtml(o.label));
          b.type = 'button';
          b.addEventListener('click', o.action);
          bar.appendChild(b);
          continue;
        }
        const field = el('label', 'opt');
        field.appendChild(el('span', 'opt-label', escapeHtml(o.label)));
        let input;
        if (o.type === 'range') {
          input = el('input');
          input.type = 'range';
          input.min = o.min; input.max = o.max; input.step = o.step || 1;
          input.value = store[o.key];
          const out = el('output', 'opt-value', store[o.key] + (o.unit || ''));
          input.addEventListener('input', () => {
            store[o.key] = Number(input.value);
            out.textContent = input.value + (o.unit || '');
            changed();
          });
          field.append(input, out);
        } else if (o.type === 'select') {
          input = el('select');
          for (const [v, label] of o.options) {
            const op = el('option', null, escapeHtml(label));
            op.value = v;
            input.appendChild(op);
          }
          input.value = store[o.key];
          input.addEventListener('change', () => { store[o.key] = input.value; changed(); });
          field.appendChild(input);
        } else if (o.type === 'checkbox') {
          input = el('input');
          input.type = 'checkbox';
          input.checked = !!store[o.key];
          input.addEventListener('change', () => { store[o.key] = input.checked; changed(); });
          field.classList.add('opt-check');
          field.insertBefore(input, field.firstChild);
        }
        input.dataset.option = o.key;
        bar.appendChild(field);
      }
      if (SELECT_TOOLS.includes(t.id)) {
        for (const [label, id] of [['Select all', 'edit.selectAll'], ['Deselect', 'edit.deselect'], ['Invert', 'edit.invertSelection']]) {
          const b = el('button', 'btn btn-sm', label);
          b.type = 'button';
          b.addEventListener('click', () => this.run(id));
          bar.appendChild(b);
        }
      }
      bar.appendChild(el('span', 'opt-hint', escapeHtml(t.hint || '')));
    }

    /* ---------- top bar, colours ---------- */

    buildTopbar() {
      document.getElementById('brand-mark').innerHTML = T.logo(22);
      const undo = document.getElementById('btn-undo'), redo = document.getElementById('btn-redo');
      undo.innerHTML = T.icon('undo', 18);
      redo.innerHTML = T.icon('redo', 18);
      undo.title = `Undo (${this.shortcutText('Mod+Z')})`;
      redo.title = `Redo (${this.shortcutText('Mod+Shift+Z')})`;
      undo.addEventListener('click', () => this.run('edit.undo'));
      redo.addEventListener('click', () => this.run('edit.redo'));
      document.getElementById('btn-export').addEventListener('click', () => this.run('file.export'));
      document.getElementById('start-open').addEventListener('click', () => this.run('file.open'));
      document.getElementById('start-new').addEventListener('click', () => this.run('file.new'));
      document.querySelector('#start .start-mark').innerHTML = T.logo(56);
    }

    bindColors() {
      const input = document.getElementById('color-input');
      const pick = (which) => {
        input.dataset.which = which;
        input.value = this.editor[which];
        input.click();
      };
      document.getElementById('swatch-primary').addEventListener('click', () => pick('primary'));
      document.getElementById('swatch-secondary').addEventListener('click', () => pick('secondary'));
      input.addEventListener('input', () => this.editor.setColor(input.dataset.which, input.value));
      const swap = document.getElementById('swap-colors'), reset = document.getElementById('reset-colors');
      swap.innerHTML = T.icon('swap', 14);
      reset.innerHTML = T.icon('reset', 14);
      swap.addEventListener('click', () => this.editor.swapColors());
      reset.addEventListener('click', () => this.editor.resetColors());
      this.refreshColors();
    }

    refreshColors() {
      const p = document.getElementById('swatch-primary'), s = document.getElementById('swatch-secondary');
      p.style.background = this.editor.primary;
      s.style.background = this.editor.secondary;
      p.title = `Primary colour ${this.editor.primary} (click to change)`;
      s.title = `Secondary colour ${this.editor.secondary} (click to change)`;
      document.getElementById('color-hex').textContent = this.editor.primary.toUpperCase();
      const t = this.toolById.text;
      if (t.entry) t.layout();
    }

    /* ---------- panels ---------- */

    buildPanels() {
      const blend = document.getElementById('layer-blend');
      for (const [v, label] of BLEND_MODES) {
        const o = el('option', null, label);
        o.value = v;
        blend.appendChild(o);
      }
      blend.addEventListener('change', () => {
        const l = this.editor.activeLayer;
        if (l) this.editor.setLayerProps(l.id, { blend: blend.value }, 'Blend Mode');
      });
      const op = document.getElementById('layer-opacity'), opOut = document.getElementById('layer-opacity-value');
      op.addEventListener('input', () => {
        const l = this.editor.activeLayer;
        if (!l) return;
        opOut.textContent = op.value + '%';
        this.editor.setLayerProps(l.id, { opacity: Number(op.value) / 100 });
      });
      op.addEventListener('change', () => {
        if (this.editor.activeLayer) this.editor.commit('Layer Opacity');
      });

      const actions = [
        ['layer-add', 'plus', 'layer.new', 'New layer'],
        ['layer-dup', 'duplicate', 'layer.duplicate', 'Duplicate layer'],
        ['layer-up', 'up', 'layer.up', 'Move layer up'],
        ['layer-down', 'down', 'layer.down', 'Move layer down'],
        ['layer-merge', 'merge', 'layer.mergeDown', 'Merge down'],
        ['layer-del', 'trash', 'layer.delete', 'Delete layer'],
      ];
      const bar = document.getElementById('layer-actions');
      for (const [id, icon, cmd, title] of actions) {
        const b = el('button', 'icon-btn', T.icon(icon, 17));
        b.type = 'button';
        b.id = id;
        b.title = title;
        b.setAttribute('aria-label', title);
        b.dataset.cmd = cmd;
        b.addEventListener('click', () => this.run(cmd));
        bar.appendChild(b);
      }

      const grid = document.getElementById('adjust-grid');
      for (const a of C.ADJUSTMENTS) {
        const b = el('button', 'chip', escapeHtml(a.name));
        b.type = 'button';
        b.dataset.cmd = 'adjust.' + a.id;
        b.addEventListener('click', () => this.run('adjust.' + a.id));
        grid.appendChild(b);
      }

      document.querySelectorAll('.panel-head').forEach((h) => {
        h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'));
      });
    }

    refreshAll() {
      document.body.classList.toggle('has-doc', !!this.editor.doc);
      this.refreshLayers();
      this.refreshHistory();
      this.refreshButtons();
      this.refreshStatus();
      this.view.updateCursor();
    }

    refreshButtons() {
      const can = (id) => this.commands[id].enabled();
      document.getElementById('btn-undo').disabled = !can('edit.undo');
      document.getElementById('btn-redo').disabled = !can('edit.redo');
      document.getElementById('btn-export').disabled = !this.editor.doc;
      document.querySelectorAll('#layer-actions [data-cmd], #adjust-grid [data-cmd]').forEach((b) => (b.disabled = !can(b.dataset.cmd)));
      this.refreshStatus();
    }

    refreshLayers() {
      const ed = this.editor, list = document.getElementById('layer-list');
      list.innerHTML = '';
      const active = ed.activeLayer;
      const blend = document.getElementById('layer-blend'), op = document.getElementById('layer-opacity');
      blend.disabled = op.disabled = !active;
      if (active) {
        blend.value = active.blend;
        op.value = Math.round(active.opacity * 100);
        document.getElementById('layer-opacity-value').textContent = op.value + '%';
      }
      const layers = ed.layers;
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        const row = el('li', 'layer-row' + (l === active ? ' active' : '') + (l.visible ? '' : ' hidden-layer'));
        row.dataset.id = l.id;
        row.draggable = true;
        const eye = el('button', 'eye', T.icon(l.visible ? 'eye' : 'eyeOff', 16));
        eye.type = 'button';
        eye.title = l.visible ? 'Hide layer' : 'Show layer';
        eye.setAttribute('aria-label', eye.title);
        eye.addEventListener('click', (e) => {
          e.stopPropagation();
          ed.setLayerProps(l.id, { visible: !l.visible }, l.visible ? 'Hide Layer' : 'Show Layer');
        });
        const thumb = el('canvas', 'thumb');
        const k = Math.min(44 / l.canvas.width, 32 / l.canvas.height);
        thumb.width = Math.max(1, Math.round(l.canvas.width * k));
        thumb.height = Math.max(1, Math.round(l.canvas.height * k));
        const tctx = thumb.getContext('2d');
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(l.canvas, 0, 0, thumb.width, thumb.height);
        const name = el('span', 'layer-name', escapeHtml(l.name));
        name.title = 'Double-click to rename';
        name.addEventListener('dblclick', (e) => { e.stopPropagation(); this.renameLayer(l, name); });
        const meta = el('span', 'layer-meta', l.blend !== 'source-over' || l.opacity < 1
          ? `${BLEND_MODES.find((b) => b[0] === l.blend)[1]} · ${Math.round(l.opacity * 100)}%` : '');
        const text = el('div', 'layer-text');
        text.append(name, meta);
        row.append(eye, thumb, text);
        row.addEventListener('click', () => ed.setActive(l.id));
        row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-layer', String(l.id)); row.classList.add('dragging'); });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-layer')) { e.preventDefault(); row.classList.add('drop-target'); } });
        row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
        row.addEventListener('drop', (e) => {
          const id = Number(e.dataTransfer.getData('text/x-layer'));
          if (!id) return;
          e.preventDefault();
          e.stopPropagation();
          const from = layers.findIndex((x) => x.id === id);
          if (from >= 0 && from !== i) ed.moveLayer(id, i - from);
        });
        list.appendChild(row);
      }
    }

    renameLayer(layer, span) {
      const input = el('input', 'rename');
      input.value = layer.name;
      span.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (save && v && v !== layer.name) this.editor.setLayerProps(layer.id, { name: v }, 'Rename Layer');
        else this.refreshLayers();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('click', (e) => e.stopPropagation());
    }

    refreshHistory() {
      const list = document.getElementById('history-list'), h = this.editor.history;
      list.innerHTML = '';
      h.entries.forEach((entry, i) => {
        const b = el('button', 'history-item' + (i === h.index ? ' current' : i > h.index ? ' future' : ''), escapeHtml(entry.label));
        b.type = 'button';
        b.dataset.index = i;
        b.addEventListener('click', () => this.editor.jumpHistory(i));
        const li = el('li');
        li.appendChild(b);
        list.appendChild(li);
      });
      const cur = list.querySelector('.current');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    /* ---------- status bar ---------- */

    bindStatus() {
      const zin = document.getElementById('zoom-in'), zout = document.getElementById('zoom-out'), zfit = document.getElementById('zoom-fit');
      zin.innerHTML = T.icon('plus', 15);
      zout.innerHTML = T.icon('minus', 15);
      zfit.innerHTML = T.icon('fit', 15);
      zin.addEventListener('click', () => this.run('view.zoomIn'));
      zout.addEventListener('click', () => this.run('view.zoomOut'));
      zfit.addEventListener('click', () => this.run('view.fit'));
      document.getElementById('zoom-label').addEventListener('click', () => this.run('view.actual'));
      const pos = document.getElementById('status-pos');
      this.editor.on('pointer', (p) => {
        const d = this.editor.doc;
        pos.textContent = d && p.x >= 0 && p.y >= 0 && p.x < d.width && p.y < d.height ? `${Math.floor(p.x)}, ${Math.floor(p.y)} px` : '';
      });
    }

    refreshStatus() {
      const d = this.editor.doc;
      document.getElementById('zoom-label').textContent = d ? Math.round(this.view.zoom * 1000) / 10 + '%' : '–';
      let size = d ? `${d.width} × ${d.height} px` : 'No image open';
      const sel = this.editor.selection;
      if (sel) size += ` · selection ${sel.bounds.w} × ${sel.bounds.h}`;
      document.getElementById('status-size').textContent = size;
      document.getElementById('status-hint').textContent = this.view.tool ? this.view.tool.hint || '' : '';
      document.title = d ? `${this.editor.fileName}${this.editor.dirty ? ' •' : ''} — Tessera` : 'Tessera — image editor';
    }

    toast(msg, kind) {
      const box = document.getElementById('toasts');
      const t = el('div', 'toast' + (kind ? ' toast-' + kind : ''), escapeHtml(msg));
      t.setAttribute('role', 'status');
      box.appendChild(t);
      setTimeout(() => t.classList.add('leaving'), 3200);
      setTimeout(() => t.remove(), 3600);
    }

    /* ---------- dialogs ---------- */

    // fields: { key, label, type: range|number|select|checkbox|text|info, ... }
    dialog(spec) {
      const dlg = el('dialog', 'dlg' + (spec.preview ? ' dlg-side' : ''));
      const form = el('form');
      form.method = 'dialog';
      form.appendChild(el('h2', 'dlg-title', escapeHtml(spec.title)));
      const body = el('div', 'dlg-body');
      const values = {}, inputs = {};
      let previewOn = true, raf = 0, closed = false;

      const schedule = () => {
        if (!spec.preview || raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (!closed) spec.preview(values, previewOn);
        });
      };
      const set = (key, v) => {
        values[key] = v;
        const inp = inputs[key];
        if (!inp) return;
        if (inp.type === 'checkbox') inp.checked = !!v; else inp.value = v;
        if (inp._sync) inp._sync(v);
      };
      const changed = (key) => {
        if (spec.onChange) spec.onChange(values, key, set);
        schedule();
      };

      for (const f of spec.fields) {
        if (f.type === 'info') { body.appendChild(el('p', 'dlg-info', f.html || escapeHtml(f.text))); continue; }
        values[f.key] = f.value;
        const row = el('label', 'dlg-row' + (f.type === 'checkbox' ? ' dlg-check' : ''));
        const label = el('span', 'dlg-label', escapeHtml(f.label));
        let input;
        if (f.type === 'range') {
          input = el('input');
          input.type = 'range';
          input.min = f.min; input.max = f.max; input.step = f.step || 1; input.value = f.value;
          const num = el('input', 'dlg-num');
          num.type = 'number';
          num.min = f.min; num.max = f.max; num.step = f.step || 1; num.value = f.value;
          num.setAttribute('aria-label', f.label);
          input._sync = (v) => (num.value = v);
          input.addEventListener('input', () => { values[f.key] = Number(input.value); num.value = input.value; changed(f.key); });
          num.addEventListener('input', () => {
            if (num.value === '' || isNaN(Number(num.value))) return;
            values[f.key] = C.clamp(Number(num.value), f.min, f.max);
            input.value = values[f.key];
            changed(f.key);
          });
          const line = el('div', 'dlg-range');
          line.append(input, num);
          row.append(label, line);
        } else if (f.type === 'select') {
          input = el('select');
          for (const [v, l] of f.options) {
            const o = el('option', null, escapeHtml(l));
            o.value = v;
            input.appendChild(o);
          }
          input.value = f.value;
          input.addEventListener('change', () => { values[f.key] = input.value; changed(f.key); });
          row.append(label, input);
        } else if (f.type === 'checkbox') {
          input = el('input');
          input.type = 'checkbox';
          input.checked = !!f.value;
          input.addEventListener('change', () => { values[f.key] = input.checked; changed(f.key); });
          row.append(input, label);
        } else {
          input = el('input');
          input.type = f.type === 'number' ? 'number' : 'text';
          if (f.min != null) input.min = f.min;
          if (f.max != null) input.max = f.max;
          input.value = f.value;
          input.addEventListener('input', () => { values[f.key] = f.type === 'number' ? Number(input.value) : input.value; changed(f.key); });
          row.append(label, input);
        }
        input.name = f.key;
        inputs[f.key] = input;
        body.appendChild(row);
      }
      form.appendChild(body);

      const foot = el('div', 'dlg-foot');
      if (spec.preview) {
        const pv = el('label', 'dlg-preview');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.addEventListener('change', () => { previewOn = cb.checked; schedule(); });
        pv.append(cb, document.createTextNode(' Preview'));
        foot.appendChild(pv);
        const reset = el('button', 'btn', 'Reset');
        reset.type = 'button';
        reset.addEventListener('click', () => { for (const f of spec.fields) if (f.key) set(f.key, f.value); schedule(); });
        foot.appendChild(reset);
      }
      const cancel = el('button', 'btn', 'Cancel');
      cancel.type = 'button';
      cancel.dataset.role = 'cancel';
      const ok = el('button', 'btn btn-primary', escapeHtml(spec.okLabel || 'OK'));
      ok.type = 'submit';
      ok.dataset.role = 'ok';
      foot.append(cancel, ok);
      form.appendChild(foot);
      dlg.appendChild(form);

      const close = (accept) => {
        if (closed) return;
        closed = true;
        if (raf) cancelAnimationFrame(raf);
        dlg.close();
        dlg.remove();
        if (this.activeDialog && this.activeDialog.dlg === dlg) this.activeDialog = null;
        if (accept) { if (spec.onOk) spec.onOk(values); }
        else if (spec.onCancel) spec.onCancel();
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); close(true); });
      cancel.addEventListener('click', () => close(false));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
      dlg.addEventListener('keydown', (e) => e.stopPropagation());

      document.body.appendChild(dlg);
      dlg.showModal();
      const first = body.querySelector('input, select');
      if (first) first.focus(); else ok.focus();
      schedule();
      this.activeDialog = { dlg, values, set, ok: () => close(true), cancel: () => close(false) };
      return this.activeDialog;
    }

    runEffect(effect) {
      const ed = this.editor, layer = ed.activeLayer;
      if (!layer) return null;
      if (!layer.visible) { this.toast('The active layer is hidden.'); return null; }
      if (!effect.params.length) {
        ed.applyImageOp((img) => effect.run(img, {}), effect.name);
        return null;
      }
      const orig = ed.getLayerImage(layer);
      const mask = ed.selection ? ed.selection.mask : null;
      const compute = (v) => {
        const out = effect.run(orig, v);
        return mask ? C.blendWithMask(orig, out, mask) : out;
      };
      return this.dialog({
        title: effect.name,
        fields: effect.params.map((p) => Object.assign({}, p)),
        preview: (v, on) => { ed.putLayerImage(layer, on ? compute(v) : orig); ed.emit('render'); },
        onOk: (v) => { ed.putLayerImage(layer, compute(v)); layer.touch(); ed.commit(effect.name); },
        onCancel: () => { ed.putLayerImage(layer, orig); ed.emit('render'); },
      });
    }

    confirmDiscard(proceed) {
      if (!this.editor.dirty) return proceed();
      this.dialog({
        title: 'Discard unsaved changes?',
        fields: [{ type: 'info', text: `“${this.editor.fileName}” has changes that haven’t been exported. They will be lost.` }],
        okLabel: 'Discard changes',
        onOk: proceed,
      });
    }

    newDialog() {
      const ed = this.editor;
      return this.dialog({
        title: 'New canvas',
        fields: [
          { key: 'width', label: 'Width (px)', type: 'number', value: 1600, min: 1, max: 12000 },
          { key: 'height', label: 'Height (px)', type: 'number', value: 1000, min: 1, max: 12000 },
          { key: 'background', label: 'Background', type: 'select', value: 'white', options: [['white', 'White'], ['transparent', 'Transparent'], ['primary', 'Primary colour'], ['secondary', 'Secondary colour']] },
        ],
        okLabel: 'Create',
        onOk: (v) => this.confirmDiscard(() => {
          const bg = { white: '#ffffff', transparent: 'transparent', primary: ed.primary, secondary: ed.secondary }[v.background];
          ed.newDocument(v.width, v.height, bg, 'untitled');
        }),
      });
    }

    imageSizeDialog() {
      const ed = this.editor, ratio = ed.height / ed.width;
      return this.dialog({
        title: 'Image size',
        fields: [
          { key: 'width', label: 'Width (px)', type: 'number', value: ed.width, min: 1, max: 12000 },
          { key: 'height', label: 'Height (px)', type: 'number', value: ed.height, min: 1, max: 12000 },
          { key: 'keep', label: 'Keep proportions', type: 'checkbox', value: true },
        ],
        onChange: (v, key, set) => {
          if (!v.keep) return;
          if (key === 'width') set('height', Math.max(1, Math.round(v.width * ratio)));
          if (key === 'height') set('width', Math.max(1, Math.round(v.height / ratio)));
        },
        okLabel: 'Resize',
        onOk: (v) => ed.resizeImage(v.width, v.height),
      });
    }

    canvasSizeDialog() {
      const ed = this.editor;
      const anchors = Object.keys(C.ANCHORS).map((k) => [k, k.replace('-', ' ').replace(/^./, (c) => c.toUpperCase())]);
      return this.dialog({
        title: 'Canvas size',
        fields: [
          { key: 'width', label: 'Width (px)', type: 'number', value: ed.width, min: 1, max: 12000 },
          { key: 'height', label: 'Height (px)', type: 'number', value: ed.height, min: 1, max: 12000 },
          { key: 'anchor', label: 'Keep image at', type: 'select', value: 'center', options: anchors },
          { type: 'info', text: 'New space is transparent. Shrinking the canvas trims the edges.' },
        ],
        okLabel: 'Apply',
        onOk: (v) => ed.resizeCanvas(v.width, v.height, v.anchor),
      });
    }

    exportDialog() {
      const ed = this.editor;
      return this.dialog({
        title: 'Export image',
        fields: [
          { key: 'name', label: 'File name', type: 'text', value: ed.fileName },
          { key: 'format', label: 'Format', type: 'select', value: 'png', options: Object.entries(FORMATS).map(([k, f]) => [k, f.label]) },
          { key: 'quality', label: 'Quality (JPEG / WebP)', type: 'range', min: 1, max: 100, value: 90 },
          { type: 'info', text: `${ed.width} × ${ed.height} px, all visible layers. The file is made in this tab and saved by your browser — nothing is uploaded.` },
        ],
        okLabel: 'Export',
        onOk: (v) => this.exportImage(v),
      });
    }

    async exportImage(v) {
      const f = FORMATS[v.format] || FORMATS.png;
      const base = String(v.name || 'untitled').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'untitled';
      try {
        const blob = await this.editor.exportBlob(f.mime, (v.quality == null ? 90 : v.quality) / 100);
        const ext = blob.type === f.mime ? f.ext : 'png';
        const filename = `${base}.${ext}`;
        this.download(blob, filename);
        this.editor.markSaved();
        this.refreshStatus();
        this.lastExport = { filename, type: blob.type, size: blob.size };
        this.toast(`Exported ${filename} (${Math.max(1, Math.round(blob.size / 1024))} KB)`);
        return this.lastExport;
      } catch (err) {
        this.toast(err.message || 'Export failed.', 'error');
        return null;
      }
    }

    download(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = el('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }

    shortcutsDialog() {
      const rows = this.tools.map((t) => `<tr><td>${escapeHtml(t.name)}</td><td><kbd>${t.key}</kbd></td></tr>`).join('');
      const cmds = Object.values(this.commands).filter((c) => c.keys.length)
        .map((c) => `<tr><td>${escapeHtml(c.label.replace('…', ''))}</td><td><kbd>${c.keys.map((k) => this.shortcutText(k)).join('</kbd> <kbd>')}</kbd></td></tr>`).join('');
      const extra = [['Pan', 'Space + drag'], ['Zoom', `${this.isMac ? '⌘' : 'Ctrl'} + scroll`], ['Brush size', '[ and ]'], ['Swap colours', 'X'], ['Default colours', 'D']]
        .map(([a, b]) => `<tr><td>${a}</td><td><kbd>${b}</kbd></td></tr>`).join('');
      return this.dialog({
        title: 'Keyboard shortcuts',
        fields: [{ type: 'info', html: `<div class="shortcut-cols"><table>${rows}${extra}</table><table>${cmds}</table></div>` }],
        okLabel: 'Close',
      });
    }

    aboutDialog() {
      return this.dialog({
        title: 'About Tessera',
        fields: [{ type: 'info', text: 'Tessera is a layered image editor that runs entirely in this browser tab. Your images are never uploaded: opening, editing and exporting all happen on your device.' }],
        okLabel: 'Close',
      });
    }

    /* ---------- files ---------- */

    chooseFile(mode) {
      const input = document.getElementById('file-input');
      input.dataset.mode = mode;
      input.value = '';
      input.click();
    }

    async loadFile(file, mode) {
      if (!file) return;
      if (file.type && !file.type.startsWith('image/')) {
        this.toast(`“${file.name}” isn’t an image.`, 'error');
        return;
      }
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        if (mode === 'place' && this.editor.doc) {
          this.editor.addImageLayer(img, file.name);
          this.toast(`Placed “${file.name}” as a new layer.`);
        } else {
          await new Promise((resolve) => this.confirmDiscard(() => { this.editor.openImage(img, file.name); resolve(); }));
        }
      } catch (err) {
        this.toast(`Couldn’t open “${file.name}”. The format may not be supported by this browser.`, 'error');
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    pasteInternal() {
      if (this.editor.clipboard) { this.editor.paste(); return; }
      this.toast(`Nothing copied yet. To paste an image from another app, press ${this.isMac ? '⌘' : 'Ctrl'}+V.`);
    }

    bindFiles() {
      const input = document.getElementById('file-input');
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) this.loadFile(input.files[0], input.dataset.mode || 'open');
      });
      const app = document.getElementById('app');
      let depth = 0;
      const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
      app.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; document.body.classList.add('dropping'); } });
      app.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; document.body.classList.remove('dropping'); } });
      app.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
      app.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        document.body.classList.remove('dropping');
        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/')) || e.dataTransfer.files[0];
        this.loadFile(file, this.editor.doc ? 'place' : 'open');
      });
      document.addEventListener('paste', (e) => {
        if (e.target.closest && e.target.closest('input, textarea')) return;
        const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((i) => i.type.startsWith('image/'));
        if (item) {
          e.preventDefault();
          const file = item.getAsFile();
          this.loadFile(file, this.editor.doc ? 'place' : 'open');
          return;
        }
        if (this.editor.doc && this.editor.clipboard) {
          e.preventDefault();
          this.editor.paste();
        }
      });
    }
  }

  T.UI = UI;
  T.BLEND_MODES = BLEND_MODES;
})();
