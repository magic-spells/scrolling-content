# Scrolling Content

An infinite scrolling marquee web component. Loops any row of markup forever — logo walls, tickers, announcement bars — with hover-to-pause, drag-to-scrub, and a speed you can set from a media query.

No dependencies. ~2.5 kB gzipped.

[**Live Demo**](https://magic-spells.github.io/scrolling-content/demo/)

## Features

- Measures your content and clones it until the track covers the container — six items or sixty, same markup
- Speed in px/sec, overridable per breakpoint from CSS
- Hover to pause, drag to scrub, both opt-out-able
- Optional edge fade so content dissolves instead of clipping
- Respects `prefers-reduced-motion`
- Clones are hidden from assistive tech and stripped of `id`s
- Styles ship in a cascade layer, so plain author CSS overrides them
- No dependencies, no Shadow DOM, no build step required

## Installation

```bash
npm install @magic-spells/scrolling-content
```

```javascript
// Registers the elements and injects its own styles. Nothing else to import.
import '@magic-spells/scrolling-content';
```

Or via CDN:

```html
<script src="https://unpkg.com/@magic-spells/scrolling-content"></script>
```

## Usage

```html
<scrolling-content speed="60" fade>
  <scrolling-track>
    <span>🚀 Web Components</span>
    <span>⚡ Lightning Fast</span>
    <span>🎨 Fully Customizable</span>
  </scrolling-track>
</scrolling-content>
```

Loose children are wrapped in a `<scrolling-item>` automatically, so `<scrolling-track>` is the only element you need to write. The item is then cloned as many times as it takes to fill the track.

## Configuration

| Attribute        | Default | Description                                                                                              |
| ---------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `speed`          | `60`    | Scroll speed in pixels per second. Overridden by `--scrolling-content-speed` when that property is set.  |
| `direction`      | `left`  | `left` or `right`.                                                                                       |
| `paused`         | absent  | Boolean. Reflected — this is the state `start()` and `stop()` write.                                     |
| `pause-on-hover` | `true`  | Set `"false"` to keep scrolling under the cursor.                                                        |
| `drag`           | `true`  | Set `"false"` to disable scrubbing.                                                                      |
| `fade`           | absent  | Boolean, or a CSS length. Masks the left and right edges. Bare `fade` uses `4rem`.                       |

`drag` is deliberately not named `draggable`, which is a real global HTML attribute with its own meaning.

## Responsive speed

`speed` is plain pixels per second, not a duration — adding items never changes how fast the marquee moves.

To vary it by breakpoint, set `--scrolling-content-speed` instead of the attribute. The component resolves the property through the cascade, so it obeys whatever breakpoints your design system already has — media queries and container queries alike:

```css
.marquee {
  --scrolling-content-speed: 110;
}

@media (max-width: 900px) {
  .marquee {
    --scrolling-content-speed: 55;
  }
}
```

The value is unitless and read as px/sec. It's resolved on resize rather than per frame — reading computed style sixty times a second would put a style recalc on the hot path.

Precedence is `--scrolling-content-speed` → `speed` attribute → `60`. The stylesheet deliberately leaves the property unset, because a default there would always beat the attribute.

## Edge fade

`overflow: hidden` cuts items off with a hard vertical edge, which reads as a box with content sliding behind it. `fade` masks the boundaries instead:

```html
<scrolling-content fade>…</scrolling-content>
<scrolling-content fade="12rem">…</scrolling-content>
```

```css
/* or from the stylesheet, so it can vary by breakpoint */
.marquee {
  --scrolling-content-fade: 10vw;
}
```

## CSS Custom Properties

| Variable                          | Default | Description                                                      |
| --------------------------------- | ------- | ---------------------------------------------------------------- |
| `--scrolling-content-speed`       | unset   | Unitless px/sec. Wins over the `speed` attribute.                |
| `--scrolling-content-gap`         | `1rem`  | Gap between items, and between children inside an item.          |
| `--scrolling-content-fade`        | `4rem`  | Width of the edge-fade ramp. Only applies when `fade` is present. |
| `--scrolling-content-item-padding`| `0`     | Padding applied to each `<scrolling-item>`.                      |

## Styling

Structural styles are injected into a `@layer scrolling-content` cascade layer. Unlayered author rules always beat layered ones, so you can override anything with a plain selector — no `!important`:

```css
scrolling-track {
  align-items: flex-end;
}

.logo-wall {
  --scrolling-content-gap: 3rem;
}

.logo-wall img {
  height: 2rem;
  opacity: 0.7;
}
```

## JavaScript API

```javascript
const marquee = document.querySelector('scrolling-content');

marquee.stop(); // sets `paused`
marquee.start(); // clears `paused`

marquee.speed = 120; // px/sec, live — no restart
marquee.direction = 'right';

marquee.refresh(); // re-measure after you've swapped the content yourself
```

| Member        | Type     | Description                                                                                                        |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `start()`     | method   | Resume by clearing `paused`.                                                                                       |
| `stop()`      | method   | Pause by setting `paused`.                                                                                         |
| `refresh()`   | method   | Re-measure, top up clones, re-normalize. Runs automatically on resize and content change.                          |
| `speed`       | property | Resolved px/sec. Assigning writes the attribute.                                                                   |
| `direction`   | property | `'left'` or `'right'`.                                                                                             |
| `paused`      | property | Boolean mirror of the attribute.                                                                                   |

### Events

All bubble and are composed.

| Event                          | Fires when                                                     |
| ------------------------------ | -------------------------------------------------------------- |
| `scrolling-content:start`      | The animation loop began.                                      |
| `scrolling-content:stop`       | The loop halted — pause, hover, drag, or reduced motion.       |
| `scrolling-content:drag-start` | A scrub gesture began.                                         |
| `scrolling-content:drag-end`   | A scrub gesture ended or was cancelled.                        |

## How It Works

Content is wrapped in a `<scrolling-item>` and cloned until the track covers twice the container width, so a wrap can never expose empty space. The track is moved with `transform: translateX()` on a `requestAnimationFrame` loop, and the offset folds back by one item-plus-gap each cycle to create the loop.

Measurement is driven by a `ResizeObserver` on both the host and the first item, so content that sizes late — images, webfonts, an ancestor that starts hidden — is picked up when it actually resolves rather than at a guessed timeout. The per-frame delta is clamped at 64ms, so returning to a backgrounded tab resumes instead of teleporting.

Dragging uses pointer capture, so a gesture survives leaving the element without any window-level listeners. On touch, `touch-action: pan-y` lets the browser arbitrate: vertical swipes scroll the page, horizontal ones scrub the track.

## Accessibility

- Cloned content is marked `aria-hidden` and `inert`, and any `id` inside a clone is removed — the duplication is invisible to assistive tech and to `getElementById`.
- Under `prefers-reduced-motion: reduce` the loop does not run. Dragging still works, so the marquee degrades into a scrubbable strip rather than disappearing.

## Migrating from v1

| v1                                              | v2                                            |
| ----------------------------------------------- | --------------------------------------------- |
| `mobile-speed` / `desktop-speed` / `breakpoint` | `speed` + `--scrolling-content-speed`         |
| `<scrolling-track gap="30">`                    | `--scrolling-content-gap`                     |
| `<scrolling-item pad="10">`                     | `--scrolling-content-item-padding`            |
| `stop()`, then hovering out resumed             | `stop()` stays stopped; `paused` is real state |
| styles written inline by JS                     | injected `@layer scrolling-content` stylesheet |

The removed speed attributes log a one-time console warning naming their replacement. CommonJS builds were dropped — the package is ESM plus a UMD bundle for script tags.

## Browser Support

Modern browsers with custom elements, `ResizeObserver`, and pointer events. The edge fade uses `mask-image`, which degrades to no fade where unsupported.

## License

MIT
