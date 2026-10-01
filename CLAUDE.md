# @magic-spells/scrolling-content

## Purpose

Infinite scrolling marquee web component — logo walls, tickers, announcement bars. Measures one pass of the author's content, clones it until the track covers the container, and translates the track on a rAF loop. No dependencies, no Shadow DOM. Registers `<scrolling-content>`, `<scrolling-track>`, `<scrolling-item>`.

## Key files

- `src/scrolling-content.js` — all three classes, single file, named exports at the bottom
- `src/scrolling-content.css` — structural styles, imported `?inline` and injected as a cascade layer
- `src/scrolling-content.d.ts` — hand-maintained declarations (keep in sync)
- `scripts/build.mjs` — Vite + Rolldown build orchestrator (matches the split-text pattern)
- `demo/index.html` — showcase page (port 3080); references `dist/…` so the same paths work in dev (served from `demo/`) and on Pages (deployed from `demo/`)
- `demo/dist/` — dev-mode build output, **committed** so GitHub Pages can serve it

## Architecture

**`#buildDOM` adopts, it doesn't relocate.** An existing `<scrolling-track>` and an existing `<scrolling-item>` are used as-is; only loose children get moved into generated ones. As of 2.1.0 that is the documented contract, not an implementation detail — it's what makes the component usable from a framework that owns the DOM it rendered (the Puzzle `Marquee` piece pre-authors both elements). Don't "simplify" `#buildDOM` into an unconditional wrap.

**Measurement is ResizeObserver-driven, not timeout-driven.** v1 had three layers of `setTimeout` (5ms in `connectedCallback`, a 5ms debounce, 1ms inside the recalc) guessing when layout had settled. `connectedCallback` now just builds the DOM and calls `observe()`; the RO's initial callback fires after layout, and fires *again* when late content (images, webfonts, an ancestor that starts hidden) changes the item's width. Both the host and `#items[0]` are observed. Don't reintroduce a timeout here — the RO is what makes the clone count derive from real widths.

**Zero-width content must never produce a clone count.** `#fill()` bails when the measured item is under `MIN_ITEM_WIDTH` (1px), leaving `#loopDistance` at 0. This is not defensive padding: v1 computed `Math.ceil(containerWidth * 2 / itemWidth)`, which is `Infinity` at width 0, and the `for` loop below it froze the tab. The same zero fed `while (offsetX > 0) offsetX -= loopDistance` in the drag path — a second infinite loop. `#normalizeOffset()` now guards on `distance > 0` (which also rejects NaN) and folds with modulo instead of a `while`. Both regressions are worth a manual check if that math is ever touched.

**`#syncPlayback()` is the single decision point** for whether the rAF loop is alive. `#shouldRun` ANDs together: connected, measurable, not `paused`, not hover-paused, not dragging, not reduced-motion. Every state change calls `#syncPlayback()` rather than calling `#startLoop`/`#stopLoop` directly — that's what keeps "explicit stop survives hovering out" true, which was a v1 bug (hover-leave unconditionally restarted).

**Delta is clamped at 64ms.** rAF doesn't fire in a hidden tab, so the first frame back carries the whole hidden duration and would teleport the track. Same rationale and same constant as animation-engine.

**Speed resolves from the cascade, on resize only.** `--scrolling-content-speed` beats the `speed` attribute beats 60. This replaced v1's `mobile-speed`/`desktop-speed`/`breakpoint` trio so breakpoints live in the stylesheet instead of being hard-coded in JS. **The stylesheet deliberately does not set a default for that property** — a default there would always beat the attribute, making `speed` dead. Resolution happens in `refresh()` (RO + `window.resize`) and on `speed` attribute change, never per frame: `getComputedStyle` is a style recalc and the tick is the hot path. `window.resize` is watched *in addition to* the RO because a media query can change without the host resizing (orientation, height queries).

**Styles are injected as `@layer scrolling-content`, and also shipped as `./css`.** These elements have no shadow root, so without the styles the component is simply broken — requiring a separate CSS import would make `import '@magic-spells/scrolling-content'` alone produce a broken marquee. The layer is what makes them overridable: unlayered author rules beat layered ones, so plain selectors win with no `!important`. This is the fix for v1 writing `display`/`gap`/`align-items` as inline styles that authors couldn't override at all. The CSS is imported `?inline` so there's one source of truth. 2.1.0 added a `./css` export for bundler users who want the stylesheet in their own cascade (a Tailwind app importing it into `layer(components)`); `scripts/build.mjs` writes `dist/scrolling-content.css` from the same source with the same layer wrapper. Injection stays the default and is *skipped* when the file is already on the page — detected by reading the `--scrolling-content-styles: 1` sentinel the stylesheet sets on the host. That probe is why `injectStyles()` moved from module scope into `connectedCallback`: at module scope there is no host to compute styles on. It is called on every connect, not just the first — both guards (an existing `style[data-scrolling-content]`, then the sentinel) short-circuit, and a per-instance "already checked" flag would buy nothing since each new instance needs the check regardless. Don't rename the sentinel on one side only.

**Content edits rebuild the clones; `refresh()` alone cannot.** `#fill()` only tops clones up (`for (i = #items.length; i < needed)`), so an edit to the source item leaves every clone holding the old markup. A `MutationObserver` on `#items[0]` (`childList` + `characterData` + `subtree`) schedules `rebuild()` on the next frame: drop every `[data-clone]`, re-measure, refill. **Observe the item, never the track** — the track is where clones land, so observing it would make each refill schedule another. Attributes are deliberately unobserved (a class toggle is a restyle; the RO covers it if the width moves). The pending frame is cancelled and the observer disconnected in `disconnectedCallback`, and `#observeContent()` re-runs on reconnect.

**Clones are filler, and are treated as such.** `#cloneItem` sets `data-clone`, sets `aria-hidden`, sets `tabindex="-1"` on every focusable descendant, starts each of the clone's direct children `inert`, and strips `id` from the clone and every descendant. v1 cloned raw, which put N copies of every id in the document and read the whole marquee N times to a screen reader.

**Clone children are inert only while not fully visible.** 2.1.0 made every clone permanently `inert`, and most cards on screen at any moment are clones, so a marquee of links was mostly unclickable. Cory's rule: "they should only be marked inert when they aren't fully visible on the page." The rule is applied **per direct child of a clone, never to the clone wrapper**: magicspells.io's Marquee puts a whole pass of 17 link cards (~4,400px) in ONE `<scrolling-item>`, so a whole clone is never fully visible. Per-clone inert left every clone card dead there while the single-chip demo passed. `#measureLayout()` (run from `refresh()`, i.e. on resize, and on content change via `rebuild()`) records each clone child's start/end inside the track, the track's resting x in the host, and the visible span (the host's padding box, inset by the fade width when `fade` is set). `#syncCloneVisibility()` then runs on every paint (tick, drag move, refresh) with no layout reads: position is `#trackStart + #offsetX + start`, and it writes `inert` only when the state flips. It holds while a press is in progress, so the card under the pointer can't go inert before its click. A clickable clone keeps `aria-hidden` and `tabindex="-1"`; an aria-hidden element must never be focusable. For the same reason a `mousedown` on a focusable inside a clone is `preventDefault`ed: that stops the click from focusing it, and the click still fires. Don't move the measurement into the tick. Fade width is parsed from `--_fade` for px/rem/em/%/vw; any other length (a `calc()`) counts as no fade.

**A press is not a drag until it moves.** `pointerdown` only records the press (`#pressed`, the pointer id, the start x). `#onPointerMove` promotes it to a drag in `#beginDrag()` once it travels `DRAG_THRESHOLD` (5px): that is where the `dragging` attribute, the pause, `drag-start` and pointer capture happen. 2.1.0 captured on every pointerdown, which retargeted every click to the track, so no link inside the marquee could ever be clicked. Don't move capture back to pointerdown. The drag offset is anchored at the threshold crossing (the loop may have moved the track since the press), the pointer x at the press, so the threshold travel is applied rather than lost. After a completed drag (`pointerup`, not `pointercancel`, which gets no click) `#suppressClick` is armed and a capture-phase click listener on the host swallows the next click once. It is disarmed by any new pointerdown and ignores `detail === 0` (keyboard) clicks, so a release outside the window can't leave it eating a later real click. `dragstart` is prevented inside the track while `drag` is on: a native link/image drag fires `pointercancel` and kills the scrub.

**Pointer capture, no window listeners.** Once a drag begins, the track captures the pointer, so move/up retarget there even outside the element — v1 bound `pointermove`/`pointerup`/`pointercancel` to `window` and never removed them. `setPointerCapture` is called **last and in a try/catch**: it throws when the pointer is already gone, and throwing mid-handler used to abandon the drag half-started with the loop never re-synced. Capture is an enhancement, not a precondition.

**Hover is `pointerenter`/`pointerleave` gated on `pointerType === 'mouse'`.** Touch has no hover: a tap fires a compatibility `mouseenter` with no matching `mouseleave`, so the v2.0 `mouseenter` listener paused the marquee permanently on the first tap. Don't go back to mouse events for this.

**Touch axis detection is the browser's job.** `touch-action: pan-y` on the track means vertical swipes scroll the page and horizontal ones reach our pointer handlers. This deleted v1's whole `touchstart`/`touchmove`/`touchend` block with its `deltaX * 1.15 > deltaY` heuristic. Don't add touch handlers back.

**Cleanup is real.** One `AbortController` covers every listener; `disconnectedCallback` aborts it, disconnects the RO, stops the loop, and ends any in-flight drag. `#attachListeners()` aborts the previous controller first, so re-connecting the element doesn't double-bind.

## API

- Attributes: `speed` (px/sec), `direction` (`left`/`right`), `paused` (boolean, reflected), `pause-on-hover="false"`, `drag="false"`, `fade` (boolean or CSS length)
- CSS custom properties: `--scrolling-content-speed`, `--scrolling-content-gap`, `--scrolling-content-fade`, `--scrolling-content-item-padding`
- Methods: `start()`, `stop()`, `refresh()`, `rebuild()`; properties `speed`, `direction`, `paused`
- Events: `scrolling-content:start` / `:stop` / `:drag-start` / `:drag-end` — all bubble and compose

`drag` is **not** named `draggable` on purpose: that's a real global HTML attribute and the names would collide.

`fade` masks the host's left/right edges. The attribute value, when present, is written to `--scrolling-content-fade` as an inline style so the common case needs no accompanying CSS rule; the value is handed to the cascade rather than parsed, so any CSS length works.

## Conventions

- Plain JS + JSDoc, `.d.ts` maintained by hand — no TypeScript sources
- Private fields with `#`; `const _ = this` only when a method uses `this` 4+ times
- Registration guards (`if (!customElements.get(...))`) on all three elements
- No Shadow DOM; `:not(:defined)` hides the host until definition, with a second `:not(:defined):has(scrolling-track)` rule unhiding pre-authored markup (already laid out correctly, so it paints immediately). Split deliberately: a browser without `:has()` drops only the exemption and falls back to the 2.0.0 behavior
- Single-file source — no `src/index.js`
- Demo code blocks must show the REAL attributes and API driving each section

## Commands

- `npm run build` — production build to `dist/` (clean rebuild: unminified ESM, terser-minified UMD, then copies the `.d.ts`)
- `npm run dev` — watch build to `demo/dist/` plus a Vite dev server at `http://localhost:3080`, using `@magic-spells/vite-plugin-live-reload`
- `npm run lint` — ESLint over `src/` and `scripts/`
- `npm run format` — Prettier write. **`demo/` is prettier-ignored**: the demo's code samples live in `white-space: pre` blocks and Prettier reflows them into garbage.

## Demo & GitHub Pages

Pages serves `demo/` as static files at `https://magic-spells.github.io/scrolling-content/demo/`, with a root `index.html` that redirects there and a `.nojekyll` alongside it. The demo references `dist/scrolling-content.esm.js` **relative to `demo/`**, which resolves to `demo/dist/` both in dev (Vite root is `demo/`) and on Pages. That means **`demo/dist/` is committed deliberately** — rebuild and commit it alongside any change meant to show up in the demo. The published `dist/` at the repo root is a separate, npm-only artifact.
