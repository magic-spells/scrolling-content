import styles from './scrolling-content.css?inline';

// Structural styles are injected rather than shipped as a file the consumer has
// to remember to link: these elements have no shadow root, so without them the
// component is simply broken. They go into a named cascade layer, which loses
// to every unlayered author rule — so overriding `align-items` or `gap` needs a
// plain selector, not `!important`. That was the whole problem with the inline
// styles this replaced.
//
// The same rules are also published as `@magic-spells/scrolling-content/css`
// for bundler users who want the stylesheet in their own cascade. When that
// file is already on the page the injection is skipped, detected by the
// `--scrolling-content-styles` sentinel the stylesheet sets on the host: one
// computed-style read, and it is true however the CSS arrived (a `<link>`, a
// bundler-inlined `<style>`, or a previous injection).
//
// Cheap enough to call on every connect — which is what happens; both guards
// short-circuit before touching the DOM.
function injectStyles(host) {
	if (typeof document === 'undefined') return;
	if (document.querySelector('style[data-scrolling-content]')) return;
	if (host && getComputedStyle(host).getPropertyValue('--scrolling-content-styles').trim() === '1')
		return;

	const style = document.createElement('style');
	style.setAttribute('data-scrolling-content', '');
	style.textContent = `@layer scrolling-content {\n${styles}\n}`;
	document.head.prepend(style);
}

const DEFAULTS = {
	speed: 60,
	direction: 'left',
};

// Cap the per-frame delta. rAF doesn't fire in a hidden tab, so returning to a
// backgrounded tab hands us one enormous step that would teleport the track.
const MAX_DELTA_MS = 64;

// Fill this multiple of the container width with content before wrapping, so a
// wrap can never expose empty space at the trailing edge.
const FILL_RATIO = 2;

// An item measuring under this is unmeasurable, not tiny — images still
// loading, fonts unsettled, an ancestor display:none. Deriving a clone count
// from it divides by ~zero and produces an unbounded clone loop.
const MIN_ITEM_WIDTH = 1;

// Backstop against pathological markup (a 1px item in a 4K container) turning
// into tens of thousands of DOM nodes.
const MAX_ITEMS = 200;

// A press becomes a drag only once the pointer has travelled this far. Below it
// the gesture is still a click, and the link or button under the pointer has to
// receive it untouched — capturing on press retargeted every click to the track.
const DRAG_THRESHOLD = 5;

// Sub-pixel slack for the "is this clone fully inside the host" test, so an item
// sitting exactly on the edge isn't flipped back and forth by rounding.
const VISIBILITY_EPSILON = 0.5;

// Everything a clone could put in the tab order. Clones are aria-hidden, and an
// aria-hidden element must not be focusable, so each match gets tabindex="-1".
const FOCUSABLE_SELECTOR = [
	'a[href]',
	'area[href]',
	'button',
	'input',
	'select',
	'textarea',
	'iframe',
	'summary',
	'audio[controls]',
	'video[controls]',
	'[contenteditable]:not([contenteditable="false"])',
	'[tabindex]',
].join(',');

const LEGACY_ATTRIBUTES = ['mobile-speed', 'desktop-speed', 'breakpoint'];
let legacyWarned = false;

/**
 * Track element — the flex row that gets translated. Layout lives entirely in
 * scrolling-content.css so authors can override it without `!important`.
 */
class ScrollingTrack extends HTMLElement {}

/**
 * Item element — one repeatable unit of content. The component wraps loose
 * children in one of these and clones it to fill the track.
 */
class ScrollingItem extends HTMLElement {}

/**
 * Infinite scrolling marquee.
 *
 * Authoring the structure yourself is the supported, framework-friendly form:
 *
 *   <scrolling-content>
 *     <scrolling-track>
 *       <scrolling-item>…one pass of content…</scrolling-item>
 *     </scrolling-track>
 *   </scrolling-content>
 *
 * With the track and the item already present the component MOVES NOTHING — it
 * measures the item you wrote and appends clones after it. That matters to any
 * framework that owns the DOM it rendered (Puzzle, React, Vue): a component
 * that relocated children would fight the next patch. Loose children are still
 * wrapped automatically for plain-HTML authors.
 *
 * Attributes:
 *   speed           — pixels per second (default 60). Overridden by the
 *                     `--scrolling-content-speed` custom property, which lets a
 *                     media or container query change speed at a breakpoint.
 *   direction       — "left" (default) | "right"
 *   paused          — boolean; reflected, and the state `start()`/`stop()` set
 *   pause-on-hover  — "false" to opt out (default on)
 *   drag            — "false" to opt out (default on)
 *
 * Events (all bubble, all composed):
 *   scrolling-content:start, scrolling-content:stop,
 *   scrolling-content:drag-start, scrolling-content:drag-end
 */
class ScrollingContent extends HTMLElement {
	#track = null;
	#items = [];
	#abortController = null;
	#resizeObserver = null;
	#mutationObserver = null;
	#rebuildFrame = null;
	#motionQuery = null;
	#rafId = null;
	#initialized = false;
	#running = false;
	#hoverPaused = false;
	#dragging = false;
	#pressed = false;
	#suppressClick = false;
	#pointerId = null;
	#previousTime = 0;
	#offsetX = 0;
	#dragStartX = 0;
	#dragStartOffset = 0;
	#containerWidth = 0;
	#loopDistance = 0;
	#speed = DEFAULTS.speed;
	#trackStart = 0;
	#cloneParts = [];
	#partStarts = [];
	#partEnds = [];
	#visibleStart = 0;
	#visibleEnd = 0;

	static get observedAttributes() {
		return ['speed', 'direction', 'paused', 'pause-on-hover', 'drag', 'fade'];
	}

	connectedCallback() {
		const _ = this;

		// Styles are injected from connectedCallback rather than at import, so the
		// host exists to be probed for the sentinel that says the stylesheet is
		// already here. This runs on EVERY connect, not just the first: both of
		// injectStyles()'s guards make a repeat call a no-op, and every new
		// instance has to be checked anyway (the stylesheet can arrive at any
		// point, and a `<style>` a previous instance injected is found by the
		// first guard).
		injectStyles(_);

		if (!_.#initialized) {
			_.#initialized = true;
			_.#warnLegacyAttributes();
			_.#buildDOM();
		}

		_.#applyFade();

		_.#attachListeners();
		_.#observeContent();

		// The ResizeObserver delivers an initial observation once layout has run,
		// which is where measurement belongs. It also fires again when late content
		// (images, webfonts) changes the item's width — the reason this component
		// no longer needs a setTimeout ladder to guess when layout has settled.
		_.#resizeObserver = new ResizeObserver(() => _.refresh());
		_.#resizeObserver.observe(_);
		if (_.#items[0]) _.#resizeObserver.observe(_.#items[0]);
	}

	disconnectedCallback() {
		const _ = this;
		_.#stopLoop();
		_.#abortController?.abort();
		_.#abortController = null;
		_.#resizeObserver?.disconnect();
		_.#resizeObserver = null;
		_.#mutationObserver?.disconnect();
		_.#mutationObserver = null;
		if (_.#rebuildFrame !== null) cancelAnimationFrame(_.#rebuildFrame);
		_.#rebuildFrame = null;
		_.#hoverPaused = false;
		_.#endDrag();
		_.#pressed = false;
		_.#pointerId = null;
		_.#suppressClick = false;
	}

	attributeChangedCallback(name, previousValue, currentValue) {
		if (previousValue === currentValue) return;
		// Attributes are set during upgrade, before connectedCallback — nothing is
		// measured or built yet, and connectedCallback reads them anyway.
		if (!this.#initialized) return;

		if (name === 'speed') this.#speed = this.#resolveSpeed();
		if (name === 'fade') this.#applyFade();
		this.#syncPlayback();
	}

	/* ---------------------------------------------------------------- public */

	/** Resume scrolling (clears `paused`). */
	start() {
		this.removeAttribute('paused');
	}

	/** Pause scrolling (sets `paused`). */
	stop() {
		this.setAttribute('paused', '');
	}

	/**
	 * Re-measure the container and content, top up clones, and re-normalize the
	 * offset. Called automatically on resize and content change.
	 */
	refresh() {
		const _ = this;
		if (!_.isConnected || !_.#track) return;

		const width = _.getBoundingClientRect().width;
		_.#containerWidth = width;
		_.#speed = _.#resolveSpeed();
		_.#fill();
		_.#normalizeOffset();
		_.#paint();
		_.#measureLayout();
		_.#syncCloneVisibility();
		_.#syncPlayback();
	}

	/**
	 * Throw away every clone, re-measure the source item, and refill. This is
	 * what `refresh()` is not: `refresh()` only tops clones up, so it can't see a
	 * content EDIT — the existing clones still hold the old markup. Called
	 * automatically when the source item's subtree changes; public so a host that
	 * mutates content in a way the observer can't see (replacing the item element
	 * itself) can force it.
	 */
	rebuild() {
		const _ = this;
		if (!_.#track) return;

		const previousSource = _.#items[0];

		// Removing clones is a track mutation, and the observer watches the source
		// item — not the track — so this can't retrigger itself.
		for (const clone of _.#track.querySelectorAll(':scope > [data-clone]')) clone.remove();
		_.#items = Array.from(_.#track.children);

		// The source can be a DIFFERENT element than the one we were watching —
		// replacing the item wholesale is the case this method exists for. Both
		// observers are keyed to that element, so they have to move with it;
		// otherwise the first manual rebuild leaves the component watching a
		// detached node and nothing auto-updates again.
		if (_.#items[0] !== previousSource) {
			_.#observeContent();
			if (previousSource) _.#resizeObserver?.unobserve(previousSource);
			if (_.#items[0]) _.#resizeObserver?.observe(_.#items[0]);
		}

		_.refresh();
	}

	get speed() {
		return this.#speed;
	}

	set speed(value) {
		this.setAttribute('speed', String(value));
	}

	get direction() {
		return this.getAttribute('direction') === 'right' ? 'right' : DEFAULTS.direction;
	}

	set direction(value) {
		this.setAttribute('direction', value === 'right' ? 'right' : 'left');
	}

	get paused() {
		return this.hasAttribute('paused');
	}

	set paused(value) {
		this.toggleAttribute('paused', Boolean(value));
	}

	/* ----------------------------------------------------------------- setup */

	#warnLegacyAttributes() {
		if (legacyWarned) return;
		const found = LEGACY_ATTRIBUTES.filter((name) => this.hasAttribute(name));
		if (!found.length) return;
		legacyWarned = true;
		console.warn(
			`<scrolling-content>: ${found.join(', ')} ${found.length > 1 ? 'were' : 'was'} removed in v2. ` +
				'Use the `speed` attribute (px/sec) and override it per breakpoint with the ' +
				'`--scrolling-content-speed` custom property.'
		);
	}

	/**
	 * `fade` on its own uses the stylesheet's default width; `fade="3rem"` sets
	 * the width inline so the common case needs no accompanying CSS rule. Any CSS
	 * length works — the value is handed to the cascade, not parsed here.
	 */
	#applyFade() {
		const value = this.getAttribute('fade');
		if (value) this.style.setProperty('--scrolling-content-fade', value);
		else this.style.removeProperty('--scrolling-content-fade');
	}

	#buildDOM() {
		const _ = this;

		_.#track = _.querySelector('scrolling-track');
		if (!_.#track) {
			_.#track = document.createElement('scrolling-track');
			while (_.firstChild) _.#track.appendChild(_.firstChild);
			_.appendChild(_.#track);
		}

		if (!_.#track.querySelector('scrolling-item')) {
			const item = document.createElement('scrolling-item');
			while (_.#track.firstChild) item.appendChild(_.#track.firstChild);
			_.#track.appendChild(item);
		}

		_.#items = Array.from(_.#track.children);
	}

	#attachListeners() {
		const _ = this;
		_.#abortController?.abort();
		_.#abortController = new AbortController();
		const { signal } = _.#abortController;

		// Pointer events rather than mouseenter/mouseleave so the pointer TYPE is
		// available: a touch tap fires mouseenter with no matching mouseleave, which
		// used to pause the marquee permanently on the first tap. Only a real mouse
		// hovers.
		_.addEventListener('pointerenter', (e) => _.#onHover(e, true), { signal });
		_.addEventListener('pointerleave', (e) => _.#onHover(e, false), { signal });

		// Once a press turns into a drag, pointer capture routes move/up back to the
		// track even when the pointer leaves it, so there are no window-level
		// listeners to leak.
		_.#track.addEventListener('pointerdown', (e) => _.#onPointerDown(e), { signal });
		_.#track.addEventListener('pointermove', (e) => _.#onPointerMove(e), { signal });
		_.#track.addEventListener('pointerup', (e) => _.#onPointerUp(e), { signal });
		_.#track.addEventListener('pointercancel', (e) => _.#onPointerUp(e), { signal });
		// An un-promoted press has no capture, so its pointerup can land outside the
		// track (moved off vertically, then released). Leaving ends the press.
		_.#track.addEventListener('pointerleave', (e) => _.#onPointerLeave(e), { signal });

		// After a real scrub the browser still fires a click when the button comes
		// up, and letting go over a link would navigate. Capture phase on the host,
		// so it runs before any handler inside the content.
		_.addEventListener('click', (e) => _.#onClickCapture(e), { capture: true, signal });

		// A clone is aria-hidden, and an aria-hidden element must never hold focus.
		// Clicking a link focuses it on mousedown; cancelling that keeps the focus
		// where it was without touching the click, which still fires.
		_.#track.addEventListener(
			'mousedown',
			(e) => {
				const focusable = e.target.closest?.(FOCUSABLE_SELECTOR);
				if (focusable?.closest('[data-clone]')) e.preventDefault();
			},
			{ signal }
		);

		// Links and images are natively draggable. A native drag steals the gesture
		// (and fires pointercancel), so it can't coexist with drag-to-scrub.
		_.#track.addEventListener(
			'dragstart',
			(e) => {
				if (_.#dragEnabled) e.preventDefault();
			},
			{ signal }
		);

		// A media query can change --scrolling-content-speed without the host
		// resizing (orientation, height queries), so resize is watched in addition
		// to the ResizeObserver.
		window.addEventListener('resize', () => _.refresh(), { passive: true, signal });

		_.#motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		_.#motionQuery.addEventListener('change', () => _.#syncPlayback(), { signal });
	}

	/**
	 * Watch the SOURCE item — never the track — for content changes.
	 *
	 * The track is where clones land, so observing it would make every refill
	 * schedule another one. Observing `#items[0]` instead means the only things
	 * that reach us are real content edits: a child added or removed anywhere in
	 * the item's subtree (`childList` + `subtree`) or text rewritten in place
	 * (`characterData`). Attribute changes are deliberately not watched — a class
	 * toggle on existing markup is a restyle, not new content, and the
	 * ResizeObserver already covers it if it changes the width.
	 */
	#observeContent() {
		const _ = this;
		_.#mutationObserver?.disconnect();
		if (!_.#items[0]) return;

		_.#mutationObserver = new MutationObserver(() => _.#scheduleRebuild());
		_.#mutationObserver.observe(_.#items[0], {
			childList: true,
			characterData: true,
			subtree: true,
		});
	}

	/** Coalesce a burst of mutations into one rebuild on the next frame. */
	#scheduleRebuild() {
		const _ = this;
		if (_.#rebuildFrame !== null) return;
		_.#rebuildFrame = requestAnimationFrame(() => {
			_.#rebuildFrame = null;
			_.rebuild();
		});
	}

	/* ----------------------------------------------------------- measurement */

	/**
	 * Resolve speed in px/sec. The custom property wins when set, so a breakpoint
	 * can override the attribute. Deliberately not given a default in the
	 * stylesheet — a stylesheet default would always beat the attribute.
	 */
	#resolveSpeed() {
		const custom = getComputedStyle(this).getPropertyValue('--scrolling-content-speed').trim();
		const fromCSS = custom === '' ? NaN : parseFloat(custom);
		if (Number.isFinite(fromCSS)) return fromCSS;

		const fromAttribute = parseFloat(this.getAttribute('speed'));
		return Number.isFinite(fromAttribute) ? fromAttribute : DEFAULTS.speed;
	}

	/**
	 * Measure one item and clone it until the track covers the container plus a
	 * full loop. Leaves `#loopDistance` at 0 when the content isn't measurable
	 * yet; the ResizeObserver will call back once it is.
	 */
	#fill() {
		const _ = this;
		const source = _.#items[0];
		if (!source) return;

		const itemWidth = source.getBoundingClientRect().width;
		if (!(itemWidth >= MIN_ITEM_WIDTH)) {
			_.#loopDistance = 0;
			return;
		}

		const gap = parseFloat(getComputedStyle(_.#track).columnGap) || 0;
		_.#loopDistance = itemWidth + gap;

		const needed = Math.min(
			Math.ceil((_.#containerWidth * FILL_RATIO) / _.#loopDistance) + 1,
			MAX_ITEMS
		);

		for (let i = _.#items.length; i < needed; i++) {
			_.#track.appendChild(_.#cloneItem(source));
		}

		_.#items = Array.from(_.#track.children);
	}

	/**
	 * Clones are visual filler. They're hidden from assistive tech and taken out
	 * of the tab order, and their ids are stripped so the page doesn't end up
	 * with N copies of every id in the content.
	 *
	 * They are NOT permanently inert: most of what's on screen at any moment is
	 * clones, and a marquee of links has to be clickable. Inert is applied per
	 * direct child of the clone, never to the clone itself — an item can hold a
	 * whole pass of cards wider than the screen, so the clone as a unit is never
	 * fully visible even when a card inside it is. Each child starts inert and
	 * `#syncCloneVisibility()` lifts it while it sits fully inside the host. The
	 * clone stays `aria-hidden` throughout, and every focusable descendant gets
	 * `tabindex="-1"`, so a clickable card is still never a Tab stop.
	 *
	 * `data-clone` marks them as ours: it is how `rebuild()` tells filler from
	 * the author's own item, and how a framework or a test can ignore them.
	 */
	#cloneItem(source) {
		const clone = source.cloneNode(true);
		clone.setAttribute('data-clone', '');
		clone.setAttribute('aria-hidden', 'true');
		for (const child of clone.children) child.inert = true;
		clone.removeAttribute('id');
		for (const element of clone.querySelectorAll('[id]')) element.removeAttribute('id');
		for (const element of clone.querySelectorAll(FOCUSABLE_SELECTOR)) {
			element.setAttribute('tabindex', '-1');
		}
		return clone;
	}

	/**
	 * Record where every child of every clone sits inside the track, and the span
	 * of the host a child has to fit within to count as visible. Runs on refresh
	 * (resize, and content change via rebuild), never per frame: the track is
	 * translated as a whole, so from here on a child's position is just
	 * `#trackStart + #offsetX + start`.
	 *
	 * Positions are in the host's local px, divided out of any ancestor scale so
	 * they're in the same units as `#offsetX`.
	 */
	#measureLayout() {
		const _ = this;
		const hostRect = _.getBoundingClientRect();
		const trackRect = _.#track.getBoundingClientRect();
		const scale = _.offsetWidth > 0 ? hostRect.width / _.offsetWidth || 1 : 1;

		// The track's rect includes the transform #paint() just wrote, so the
		// offset is subtracted back out to get its resting position.
		_.#trackStart = (trackRect.left - hostRect.left) / scale - _.clientLeft - _.#offsetX;
		_.#cloneParts = [];
		_.#partStarts = [];
		_.#partEnds = [];
		for (const item of _.#items) {
			if (!item.hasAttribute('data-clone')) continue;
			for (const child of item.children) {
				const rect = child.getBoundingClientRect();
				const start = (rect.left - trackRect.left) / scale;
				_.#cloneParts.push(child);
				_.#partStarts.push(start);
				_.#partEnds.push(start + rect.width / scale);
			}
		}

		// `overflow: hidden` clips at the padding box. Under `fade` the edges are
		// masked, so a clone half-dissolved into the fade isn't "fully visible".
		const fade = _.hasAttribute('fade') ? _.#resolveFade() : 0;
		_.#visibleStart = fade;
		_.#visibleEnd = _.clientWidth - fade;
	}

	/**
	 * The fade width in px, from the same `--_fade` the mask is drawn with. The
	 * value is whatever length the author wrote, so the common units are
	 * resolved by hand; anything else (a `calc()`, `clamp()`…) counts as no fade
	 * rather than being guessed at.
	 */
	#resolveFade() {
		const value = getComputedStyle(this).getPropertyValue('--_fade').trim();
		const match = /^(-?[\d.]+)(px|rem|em|%|vw)?$/.exec(value);
		if (!match) return 0;

		const amount = parseFloat(match[1]);
		if (!Number.isFinite(amount)) return 0;
		switch (match[2]) {
			case 'rem':
				return amount * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
			case 'em':
				return amount * (parseFloat(getComputedStyle(this).fontSize) || 16);
			case '%':
				return (amount / 100) * this.offsetWidth;
			case 'vw':
				return (amount / 100) * window.innerWidth;
			default:
				return amount;
		}
	}

	/**
	 * A clone's child is inert only while it isn't fully inside the visible box:
	 * a card cut off by the edge can't be clicked, one the viewer can see whole
	 * can. Runs with every paint, from positions measured on refresh — no layout
	 * reads here — and touches the DOM only when a child's state actually flips.
	 *
	 * Held while a press is in progress, so the card under the pointer can't
	 * turn inert between pointerdown and the click it's about to receive.
	 */
	#syncCloneVisibility() {
		const _ = this;
		if (_.#pressed && !_.#dragging) return;

		const measured = _.#loopDistance > 0;
		const origin = _.#trackStart + _.#offsetX;
		const visibleStart = _.#visibleStart - VISIBILITY_EPSILON;
		const visibleEnd = _.#visibleEnd + VISIBILITY_EPSILON;

		for (let i = 0; i < _.#cloneParts.length; i++) {
			const part = _.#cloneParts[i];
			const fullyVisible =
				measured &&
				origin + _.#partStarts[i] >= visibleStart &&
				origin + _.#partEnds[i] <= visibleEnd;
			if (part.inert === fullyVisible) part.inert = !fullyVisible;
		}
	}

	/** Fold the offset into (-loopDistance, 0]. */
	#normalizeOffset() {
		const distance = this.#loopDistance;
		if (!(distance > 0)) {
			this.#offsetX = 0;
			return;
		}
		this.#offsetX = (((this.#offsetX % distance) + distance) % distance) - distance;
	}

	#paint() {
		if (this.#track) this.#track.style.transform = `translateX(${this.#offsetX}px)`;
	}

	/* -------------------------------------------------------------- playback */

	get #prefersReducedMotion() {
		return this.#motionQuery?.matches ?? false;
	}

	get #shouldRun() {
		const _ = this;
		return (
			_.isConnected &&
			_.#loopDistance > 0 &&
			!_.paused &&
			!_.#hoverPaused &&
			!_.#dragging &&
			!_.#prefersReducedMotion
		);
	}

	/** Single place that decides whether the rAF loop is alive. */
	#syncPlayback() {
		if (this.#shouldRun) this.#startLoop();
		else this.#stopLoop();
	}

	#startLoop() {
		const _ = this;
		if (_.#running) return;
		_.#running = true;
		_.#previousTime = performance.now();
		_.#rafId = requestAnimationFrame((timestamp) => _.#tick(timestamp));
		_.#emit('start');
	}

	#stopLoop() {
		const _ = this;
		if (!_.#running) return;
		cancelAnimationFrame(_.#rafId);
		_.#rafId = null;
		_.#running = false;
		_.#emit('stop');
	}

	#tick(timestamp) {
		const _ = this;
		if (!_.#running) return;

		const delta = Math.min(timestamp - _.#previousTime, MAX_DELTA_MS) / 1000;
		_.#previousTime = timestamp;

		const step = _.#speed * delta;
		_.#offsetX += _.direction === 'right' ? step : -step;
		_.#normalizeOffset();
		_.#paint();
		_.#syncCloneVisibility();

		_.#rafId = requestAnimationFrame((next) => _.#tick(next));
	}

	/* ----------------------------------------------------------- interaction */

	#onHover(event, entering) {
		if (event.pointerType !== 'mouse') return;
		if (this.getAttribute('pause-on-hover') === 'false') return;
		this.#hoverPaused = entering;
		this.#syncPlayback();
	}

	get #dragEnabled() {
		return this.getAttribute('drag') !== 'false';
	}

	/**
	 * A press only records where it started. It becomes a drag in
	 * `#onPointerMove` once it travels past DRAG_THRESHOLD; until then nothing is
	 * captured or paused, so a plain click reaches the link under the pointer.
	 */
	#onPointerDown(event) {
		const _ = this;
		// Any new press disarms a swallow left over from a scrub whose release
		// produced no click (let go outside the window).
		_.#suppressClick = false;
		if (!_.#dragEnabled || _.#dragging || !event.isPrimary || event.button !== 0) return;

		_.#pressed = true;
		_.#pointerId = event.pointerId;
		_.#dragStartX = event.clientX;
	}

	#onPointerMove(event) {
		const _ = this;
		if (!_.#pressed || event.pointerId !== _.#pointerId) return;

		if (!_.#dragging) {
			if (Math.abs(event.clientX - _.#dragStartX) < DRAG_THRESHOLD) return;
			_.#beginDrag(event);
		}

		_.#offsetX = _.#dragStartOffset + (event.clientX - _.#dragStartX);
		_.#normalizeOffset();
		_.#paint();
		_.#syncCloneVisibility();
	}

	/**
	 * The press has moved far enough to be a scrub. The offset is anchored HERE,
	 * not at pointerdown — the loop may have kept moving the track in between
	 * (touch never hover-pauses), and anchoring to the old offset would snap it
	 * back. The pointer stays anchored at the press, so the travel spent crossing
	 * the threshold is applied rather than lost.
	 */
	#beginDrag(event) {
		const _ = this;
		_.#dragging = true;
		_.#dragStartOffset = _.#offsetX;
		_.setAttribute('dragging', '');

		// The press may already have started a text selection before
		// `user-select: none` arrived with the dragging attribute.
		const selection = window.getSelection?.();
		if (selection && !selection.isCollapsed && _.contains(selection.anchorNode)) {
			selection.removeAllRanges();
		}

		_.#syncPlayback();
		_.#emit('drag-start');

		// Last, and tolerated if it fails: capture is an enhancement (it keeps the
		// gesture alive outside the element), not a precondition. It throws when the
		// pointer is already gone by the time we run — and throwing here used to
		// abandon the drag half-started, with the loop never re-synced.
		try {
			_.#track.setPointerCapture(event.pointerId);
		} catch {
			// Pointer is no longer active; the drag still tracks via bubbled events.
		}
	}

	#onPointerUp(event) {
		const _ = this;
		if (!_.#pressed || event.pointerId !== _.#pointerId) return;

		// Only a completed scrub is followed by a click worth swallowing; a
		// cancelled one gets no click at all, so arming here would eat the next
		// real one.
		const wasDragging = _.#dragging;
		_.#pressed = false;
		_.#endDrag();
		_.#pointerId = null;
		if (wasDragging && event.type === 'pointerup') _.#suppressClick = true;
		_.#syncCloneVisibility();
	}

	#onPointerLeave(event) {
		const _ = this;
		if (!_.#pressed || _.#dragging || event.pointerId !== _.#pointerId) return;
		_.#pressed = false;
		_.#pointerId = null;
		_.#syncCloneVisibility();
	}

	/** One-shot: swallow the click that follows a scrub, then disarm. */
	#onClickCapture(event) {
		// `detail` is 0 for a keyboard-activated click, which no scrub precedes.
		if (!this.#suppressClick || event.detail === 0) return;
		this.#suppressClick = false;
		event.preventDefault();
		event.stopPropagation();
	}

	#endDrag() {
		const _ = this;
		if (!_.#dragging) return;

		if (_.#pointerId !== null && _.#track?.hasPointerCapture(_.#pointerId)) {
			_.#track.releasePointerCapture(_.#pointerId);
		}
		_.#dragging = false;
		_.removeAttribute('dragging');
		_.#syncPlayback();
		_.#emit('drag-end');
	}

	#emit(name) {
		this.dispatchEvent(
			new CustomEvent(`scrolling-content:${name}`, { bubbles: true, composed: true })
		);
	}
}

if (!customElements.get('scrolling-track')) {
	customElements.define('scrolling-track', ScrollingTrack);
}
if (!customElements.get('scrolling-item')) {
	customElements.define('scrolling-item', ScrollingItem);
}
if (!customElements.get('scrolling-content')) {
	customElements.define('scrolling-content', ScrollingContent);
}

export { ScrollingContent, ScrollingTrack, ScrollingItem };
