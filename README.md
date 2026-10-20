# lunch-pixels: a photo editor from one prompt

This repo is from the App Before Lunch episode where Claude Code was asked for a browser photo editor and built **Tessera** in one session of about 25 minutes.

- **Try it:** download or clone this repo and open `index.html` in Chrome. No install, no server, nothing leaves your computer.
- **The ask:** [`PROMPT.md`](PROMPT.md), the whole prompt, unchanged. That was the only input.
- **The code:** `index.html`, `css/`, `js/`, written by Claude Code in that session. Its own tests are in `tests/` (35 tests, all pass: `node --test "tests/*.test.*"`, needs Node 22+ and Chrome).
- **The button check:** a separate program (the "robot", [lunch-pixels-audit](https://github.com/appbeforelunch/lunch-pixels-audit)) clicked all 281 controls and flagged 64 as doing nothing. Every one of the 64 was tried again the way a person uses it, and all 64 work. The full list and the reasons are in [`RESULTS.md`](RESULTS.md).
- **Changed after the build:** this top section, `RESULTS.md`, `LICENSE` and `.gitignore` were added afterwards. Everything else is exactly what the session wrote. The session log itself is not published.

Tessera is an independent toy project, not affiliated with, endorsed or sponsored by any software company. The only file that names the commercial editor it was asked to resemble is `PROMPT.md`, which quotes the original request (the app's own tests check that no other file does).

---

*Below is the README Claude Code wrote during the build, unchanged.*

# Tessera

Tessera is a layered image editor that runs entirely in your browser. You open a photo, edit it with familiar desktop-style tools, and export the result. It's plain HTML, CSS and JavaScript: no build step, no packages, no fonts or scripts from the internet. Your images never leave the page. The page's Content-Security-Policy blocks all network connections, and exported files are made in the tab and saved by your browser's normal download.

## How to open it

1. Open `index.html` in Google Chrome. Double-clicking it works, or use **File → Open File…** in Chrome. You don't need a web server.
2. Click **Open an image…**, drop an image file onto the window, or paste one from the clipboard (Ctrl/⌘+V). You can also start from **New blank canvas**.
3. When you're done, click **Export** (or press Ctrl/⌘+S) and pick PNG, JPEG or WebP.

Other recent Chromium-based browsers should work too, but the tests only cover Chrome.

## What it does

**Tools** (toolbar on the right; press the letter to switch):

| Tool | Key | Notes |
|---|---|---|
| Move | V | Drag the active layer; arrow keys nudge 1 px (Shift: 10 px) |
| Rectangle select / Ellipse select | M / O | Shift adds, Alt subtracts, Shift+Alt intersects |
| Lasso | L | Freehand selection |
| Magic wand | W | Tolerance, contiguous, sample all layers |
| Crop | C | Drag, then Enter / double-click / Apply. Esc cancels |
| Brush / Eraser | B / E | Size, hardness, opacity. Shift-click draws a straight line. `[` `]` resize |
| Paint bucket | K | Tolerance, contiguous, opacity |
| Gradient | G | Linear or radial, primary → secondary or → transparent |
| Shape | U | Rectangle, ellipse or line, with fill and/or outline |
| Text | T | Click, type, Ctrl/⌘+Enter. Choice of fonts, size, bold, italic |
| Eyedropper | I | Alt-click sets the secondary colour |
| Hand / Zoom | H / Z | Space-drag pans with any tool. Ctrl/⌘+scroll zooms |

**Layers:** add, duplicate, delete, rename (double-click the name), show/hide, reorder (drag rows or use the arrow buttons), opacity, 16 blend modes, merge down, flatten. You can place another image as a new layer, and copy/cut/paste selections.

**Adjustments** (Adjust menu or panel): Brightness/Contrast, Levels, Exposure, Hue/Saturation, Vibrance, Color Balance, Warmth, Black & White, Sepia, Invert, Threshold, Posterize.

**Filters:** Gaussian Blur, Box Blur, Sharpen, Unsharp Mask, Reduce Noise (median), Add Noise, Pixelate, Emboss, Find Edges, Vignette.

Adjustments and filters apply to the active layer. If something is selected, they only change the selection. Dialogs show a live preview, and Cancel puts everything back.

**Image:** image size (resample), canvas size (with anchor), rotate 90°/180°, flip, crop to selection.

**Undo/redo:** Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or Ctrl+Y), the toolbar arrows, or click any step in the History panel. Up to 40 steps are kept.

**Zoom:** 2%–3200%, with Fit on screen (Ctrl/⌘+0) and Actual pixels (Ctrl/⌘+1). Above 200% the image shows crisp pixels.

**Export:** PNG, JPEG (flattened onto white) or WebP, with a quality setting. Help → Keyboard Shortcuts lists every shortcut.

## Tests

The tests need Node 22 or newer. The browser tests also need Google Chrome; set `CHROME_PATH` if it isn't in the usual place. Run them from this folder:

```sh
node --test "tests/*.test.*"
```

- `tests/core.test.js`: unit tests for the pixel maths: every adjustment and filter, flood fill, selection masks, undo history, zoom geometry.
- `tests/browser.test.mjs`: end-to-end tests. They open `index.html` from disk in headless Chrome and drive it with real mouse and keyboard events through the DevTools protocol. They cover opening a file via the file picker, painting, every tool, layers, menus, dialogs, undo/redo, zoom/pan, crop/rotate/resize and real file downloads. They also check that the page made no network requests and logged no errors.
- `tests/static.test.js`: checks the source has no remote URLs or network APIs, that every referenced file exists, and that the README is present.

## What it can't do yet

- **No project file.** Layers exist only while the tab is open. Export flattens the image to PNG/JPEG/WebP. Closing or reloading the tab loses your layers (it warns you first if you have unsaved changes).
- **Text is pixels.** You can't edit text again after you commit it. Undo and retype instead.
- **Selections are hard-edged.** There's no feathering or anti-aliasing, and no "move selected pixels". The Move tool moves the whole layer, and anything dragged past the canvas edge is cut off.
- **No free transform.** You can't scale, rotate or skew a single layer by an arbitrary amount (only flip it). Whole-image rotation is in 90° steps only.
- **No masks, adjustment layers, layer effects or groups.** Adjustments are destructive and change pixels directly, so undo is the way back.
- **No clone/healing brush, smudge, dodge/burn, curves, or pen/path tool.**
- **Pressure is ignored** on pen tablets.
- **8 bits per channel, sRGB only.** There's no RAW, CMYK, 16-bit or colour management. Opening a file depends on what Chrome can decode (PNG, JPEG, WebP, GIF first frame, BMP, SVG, AVIF…). Images bigger than 12,000 px on a side are scaled down when you open them.
- **Big images are slow and memory-hungry.** Filters run on the main thread. Each history step keeps a copy of every layer it changed.
- **Copy stays inside Tessera.** Pasting images in from other apps works, but copying out to the system clipboard doesn't.
- Built for a desktop with a mouse or trackpad. Small screens hide the side panel, and touch is only basic.
