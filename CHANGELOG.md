# Changelog

All notable changes to this project are documented here.

## 2.1.1

Links inside the marquee are clickable.

### Fixed

- **A click on a link inside the track no longer dies.** `pointerdown` used to
  enter the drag and take pointer capture immediately, which retargeted every
  click to the track. A press now becomes a drag only after it moves 5px; below
  that it is a plain click and reaches the link untouched. Capture, the
  `dragging` attribute, the pause and `scrolling-content:drag-start` all move to
  the threshold crossing.
- **Letting go of a scrub over a link doesn't navigate.** The click the browser
  fires after a real drag is swallowed once, in the capture phase. A cancelled
  gesture arms nothing, and the next press disarms it.
- **Dragging from a link or image scrubs.** Native `dragstart` is prevented
  inside the track while `drag` is on; it used to start a browser drag and fire
  `pointercancel`.
- **Clones are clickable while fully visible.** 2.1.0 made every clone `inert`,
  and most cards on screen at any moment are clones. A clone is now `inert` only
  while it isn't fully inside the host's visible box (inset by the fade when
  `fade` is set). The check runs on every paint from positions measured on
  resize, and writes only when a clone's state flips. Clones stay `aria-hidden`,
  and every focusable element inside a clone now gets `tabindex="-1"`, so a
  clickable clone is still never a Tab stop or a screen-reader stop.

## 2.1.0

Adoption and live content. The component was already capable of using markup you
wrote yourself; this release makes that the documented contract and fixes the two
things that stood in the way of using it from a framework — clones that went
stale after a content edit, and a first paint that was blank even when the markup
was already correct.

### Added

- **The adopt contract is official.** Authoring
  `<scrolling-content><scrolling-track><scrolling-item>…</scrolling-item></scrolling-track></scrolling-content>`
  is the supported, framework-friendly form. With the track and item present the
  component moves nothing — it measures your item and appends clones after it, so
  a renderer that owns its DOM can keep patching in place. Documented in the
  README, the `.d.ts` and the source.
- **Clones rebuild when the content changes.** A `MutationObserver` on the source
  item (`childList`, `characterData`, `subtree`) coalesces a burst of mutations
  into one rebuild on the next animation frame: every clone is discarded, the item
  re-measured, the track refilled. It observes the source item rather than the
  track, so appending clones cannot retrigger it. Disconnected on
  `disconnectedCallback`, re-established on reconnect.
- **`rebuild()`** is public — the same path, for changes the observer can't see
  (replacing the `<scrolling-item>` element itself). `refresh()` still means
  "re-measure and top up", which by design never refreshes an existing clone.
- **`data-clone=""` on every clone**, alongside the existing `aria-hidden` and
  `inert`. `scrolling-item:not([data-clone])` now selects only your own content.
- **`@magic-spells/scrolling-content/css`** export — `dist/scrolling-content.css`,
  the same rules the component injects, in the same `@layer scrolling-content`
  wrapper. For bundler users who want the stylesheet in their own cascade
  (`@import '@magic-spells/scrolling-content/css' layer(components);`). The head
  injection remains the default and is skipped automatically when the stylesheet
  is already present, so there is never a duplicate copy.

### Changed

- **Pause-on-hover is gated on `pointerType === 'mouse'`.** `pointerenter` /
  `pointerleave` replace `mouseenter` / `mouseleave`. A touch tap used to fire a
  compatibility `mouseenter` with no matching `mouseleave` and pause the marquee
  permanently.
- **Pre-authored markup is no longer hidden before upgrade.** The hide rule is now
  `scrolling-content:not(:defined):not(:has(scrolling-track))`, so a prerendered
  page paints one static row immediately and gains the clones on upgrade. Loose
  children are still hidden until wrapped — that markup genuinely is unstyled
  until the component runs.
- Structural styles are injected from `connectedCallback` rather than at module
  evaluation, which is what lets the injection probe the host for the
  `--scrolling-content-styles` sentinel the stylesheet sets. It is attempted on
  every connect, not only the first; the existing `style[data-scrolling-content]`
  guard and the sentinel guard both short-circuit, so repeat calls do nothing.
  Same frame, same result, for every existing usage.

## 2.0.0

Complete rewrite. See the "Migrating from v1" section of the README.
