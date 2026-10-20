# Results: the robot's 64, and the re-test

This file is not part of the build. It was added afterwards, for viewers of the App Before Lunch episode about this app.

## What happened

1. **The build.** Claude Code got [`PROMPT.md`](PROMPT.md) and nothing else. One session, 24 min 53 s. It named the app Tessera, wrote 18 files and 35 tests; all 35 pass (`node --test "tests/*.test.*"`).
2. **The robot.** A separate test program, [lunch-pixels-audit](https://github.com/appbeforelunch/lunch-pixels-audit), was written and locked (tag `v1-frozen`) before the build started. Claude was never told about it. It opens the app, clicks every visible, enabled control from a fresh page with the same test image, and checks whether anything changed (canvas, page, address, storage, downloads, dialogs). Flagged controls get a second try with a fixed set of setups.
3. **The robot's verdict** (run 1, two passes): **64 of 281 controls do nothing** (strict count 68): 50 dead, 14 that only light up. 211 work, 4 work with setup, 2 where the two passes disagree, 14 disabled (not counted).
4. **The re-test.** All 64 flagged controls were used again the way a person uses them (text typed before Bold, a crop box drawn before Cancel, zoomed in before Fit, a value changed before Reset). This was a second script, written after the run, not a re-run of the robot. **Result: 0 of 64 are really dead.** A random 5 of the 211 "works" rows were also re-checked: 5 of 5 work.

| Why the robot saw "nothing" | Count |
|---|---|
| Clicked the History step that was already the current one | 28 |
| Pressed End on a slider that was already at its maximum | 12 |
| Pressed Reset on a dialog that was still at its defaults | 5 |
| Needed a step first (text typed, a crop box, zoomed in, a changed value, the dialog's own button, the colour picker) | 19 |
| **Total** | **64** |

So the mistakes were the checker's, not the editor's. The robot's v1 stays frozen as published; any fixes go into a new version.

Known limits of the re-test: it ran in headless Chrome, so the two colour swatches were confirmed by the colour input they open and the colour that then paints, not by looking at the system colour window.

## The 64 flagged controls

| # | Control | Reached through | Robot said | Why it looked like nothing | Re-test in real use |
|---|---|---|---|---|---|
| 013 | Opacity 100% | (top level) | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it.  |
| 016 | Layer opacity | (top level) | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it. starts 100, End -> 100; Home -> 0, view changed true |
| 035 | Brush | (top level) | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 051 | Primary colour | (top level) | lights up only | click swatch, choose a colour in the picker | Works: click calls the colour input (click:color); a native OS picker opens in real Chrome, headless shows none; choice #2b1d3a -> #ff00aa; brush then paints in the new colour |
| 052 | Secondary colour | (top level) | lights up only | click swatch, choose a colour in the picker | Works: click calls the colour input (click:color); a native OS picker opens in real Chrome, headless shows none; choice #ffffff -> #ff00aa; swap makes it primary: #ff00aa |
| 058 | Fit on screen | (top level) | dead | zoom in 3x, then Fit | Works: start 65.6%; zoomed 150%; Fit -> 65.6%; Fit again at fit -> 65.6% (no-op: already fitted, which is what the audit saw) |
| 113 | Format PNG (lossless, keeps transparency) JPEG (smaller, no transparency) WebP ( | Export | lights up only | Export as PNG, then pick JPEG and Export | Works: default -> test-photo.png 395434 B; JPEG -> test-photo.jpg 52927 B |
| 114 | Quality (JPEG / WebP) | Export | lights up only | JPEG at quality 10 vs 100 | Works: q10 test-photo.jpg 15095 B; q100 test-photo.jpg 238480 B |
| 118 | Size 400px | Size 24px | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it. End -> 400 (max 400); End again -> 400 (no-op, audit saw this); Home -> 1 (label 1px) |
| 119 | Hardness 100% | Hardness 80% | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it. End -> 100 (max 100); End again -> 100 (no-op, audit saw this); Home -> 0 (label 0%) |
| 120 | Blend Mode | Blend mode | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 122 | Hide Layer | Hide layer | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 124 | New Layer | New layer | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 125 | Duplicate Layer | Duplicate layer | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 130 | Preview | Brightness / Contrast | lights up only | set Brightness to 60, untick then tick Preview | Works: preview on changes view true; off restores original true; on again true |
| 131 | Reset | Brightness / Contrast | dead | Reset on a dialog that was still at its defaults | Works: change a value first, then Reset puts it back. value 0 -> 50 (preview changed true) -> Reset -> 0, preview back true |
| 136 | Input white | Levels | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it. starts 255 (its max), set 180 -> preview changed true |
| 142 | Output white | Levels | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it. starts 255 (its max), set 180 -> preview changed true |
| 144 | Preview | Levels | lights up only | set Input black to 80, untick then tick Preview | Works: preview on changes view true; off restores original true; on again true |
| 145 | Reset | Levels | dead | Reset on a dialog that was still at its defaults | Works: change a value first, then Reset puts it back. value 0 -> 127 (preview changed true) -> Reset -> 0, preview back true |
| 150 | Preview | Exposure | lights up only | set /Exposure/ to 2, untick then tick Preview | Works: preview on changes view true; off restores original true; on again true |
| 151 | Reset | Exposure | dead | Reset on a dialog that was still at its defaults | Works: change a value first, then Reset puts it back.  |
| 160 | Preview | Hue / Saturation | lights up only | set Hue to 90, untick then tick Preview | Works: preview on changes view true; off restores original true; on again true |
| 161 | Reset | Hue / Saturation | dead | Reset on a dialog that was still at its defaults | Works: change a value first, then Reset puts it back. value 0 -> 90 (preview changed true) -> Reset -> 0, preview back true |
| 174 | Black & White | Black & White | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 177 | Invert | Invert | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 198 | Cancel | Crop | dead | drag a crop box, click Cancel | Works: overlay drawn true; Cancel clears it true; image still "1600 × 1000 px" |
| 209 | Font System Sans Serif Grotesque Typewriter Poster Humanist Script | Text | lights up only | type "Hello", pick another font | Works: textarea font "42px / 50.4px system-ui, sans-serif" -> "42px / 50.4px "Trebuchet MS", Verdana, sans-serif" |
| 211 | Bold | Text | lights up only | type "Hello", tick Bold, Commit | Works: textarea font "42px / 50.4px system-ui, sans-serif" -> "700 42px / 50.4px system-ui, sans-serif"; committed pixels differ from plain text: true |
| 212 | Italic | Text | lights up only | type "Hello", tick Italic, Commit | Works: textarea font "42px / 50.4px system-ui, sans-serif" -> "italic 42px / 50.4px system-ui, sans-serif"; committed pixels differ from plain text: true |
| 213 | Commit | Text | dead | type "Lunch", click Commit | Works: layers 1 -> 2, pixels changed true; Commit with nothing typed -> layers 2 (no-op, audit saw this) |
| 214 | Cancel | Text | dead | type "Lunch", click Cancel | Works: text box removed true; layers 1 -> 1 |
| 216 | 100% | 65.6% | dead | zoom out, then click the zoom label | Works: 65.6% -> click 100%; click again at 100% -> 100% (no-op, audit saw this); zoom out 66.7% -> click 100% |
| 220 | Background White Transparent Primary colour Secondary colour | File > New… ⌥⌘N | lights up only | New canvas with White, then Transparent | Works: corner pixel RGBA white 255,255,255,255 vs transparent 0,0,0,0 |
| 225 | Cut | Edit > Cut ⌘X | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 229 | Keep proportions | Image > Image Size… ⌥⌘I | lights up only | type widths with it on, then off | Works: height 1000; width 800 with Keep on -> height 500; Keep off, width 400 -> height 500 |
| 234 | Keep image at Top left Top Top right Left Center Right Bottom left Bottom Bottom | Image > Canvas Size… ⌥⌘C | lights up only | widen the canvas with anchor Center, then Top left | Works: image placed differently: true |
| 237 | Rotate 90° CW | Image > Rotate 90° Clockwise | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 239 | Rotate 90° CCW | Image > Rotate 90° Counter-clockwise | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 240 | Rotate 180° | Image > Rotate 180° | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 241 | Flip Horizontal | Image > Flip Horizontal | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 242 | Flip Vertical | Image > Flip Vertical | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 243 | Flip Layer Horizontal | Layer > Flip Layer Horizontal | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 244 | Flip Layer Vertical | Layer > Flip Layer Vertical | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 253 | Reset | Filter > Add Noise… | dead | Reset on a dialog that was still at its defaults | Works: change a value first, then Reset puts it back. value 15 -> 58 (preview changed true) -> Reset -> 15, preview back true |
| 258 | Emboss | Filter > Emboss | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 259 | Find Edges | Filter > Find Edges | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 264 | Show Layer | Hide layer > Show layer | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 266 | Hide Layer | New layer > Hide layer | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 267 | Brightness / Contrast | Brightness / Contrast > Brightness | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 268 | Levels | Levels > Input black | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 269 | Exposure | Exposure > OK | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 270 | Hue / Saturation | Hue / Saturation > Hue | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 271 | Vibrance | Vibrance > Vibrance | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 272 | Color Balance | Color Balance > Cyan ↔ Red | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 273 | Warmth | Warmth > Cool ↔ Warm | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 274 | Sepia | Sepia > Amount | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 275 | Threshold | Threshold > Level | dead | History step that was already the current one | Works: clicking another step jumps to it; the current step does nothing by design. All 29 steps re-tested in one sequence: 29/29 jump to their state. |
| 276 | Tolerance 255 | Magic Wand > Tolerance 32 | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it. End -> 255 (max 255); End again -> 255 (no-op, audit saw this); Home -> 0 (label 0) |
| 277 | Size 400px | Eraser > Size 40px | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it. End -> 400 (max 400); End again -> 400 (no-op, audit saw this); Home -> 1 (label 1px) |
| 278 | Hardness 100% | Eraser > Hardness 60% | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it. End -> 100 (max 100); End again -> 100 (no-op, audit saw this); Home -> 0 (label 0%) |
| 279 | Tolerance 255 | Paint Bucket > Tolerance 32 | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it. End -> 255 (max 255); End again -> 255 (no-op, audit saw this); Home -> 0 (label 0) |
| 280 | Width 100px | Shape > Width 6px | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it. End -> 100 (max 100); End again -> 100 (no-op, audit saw this); Home -> 1 (label 1px) |
| 281 | Size 400px | Text > Size 64px | dead | Slider already at its maximum; the robot pressed End again | Works: Home (or dragging) moves it. End -> 400 (max 400); End again -> 400 (no-op, audit saw this); Home -> 8 (label 8px) |
