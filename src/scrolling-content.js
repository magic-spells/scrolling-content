import styles from './scrolling-content.css?inline';

// Structural styles are injected rather than shipped as a file the consumer has
// to remember to link: these elements have no shadow root, so without them the
// component is simply broken. They go into a named cascade layer, which loses
// to every unlayered author rule — so overriding `align-items` or `gap` needs a
// plain selector, not `!important`. That was the whole problem with the inline
// styles this replaced.
function injectStyles() {
	if (typeof document === 'undefined') return;
	if (document.querySelector('style[data-scrolling-content]')) return;

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
	#motionQuery = null;
	#rafId = null;
	#initialized = false;
	#running = false;
	#hoverPaused = false;
	#dragging = false;
	#pointerId = null;
	#previousTime = 0;
	#offsetX = 0;
	#dragStartX = 0;
	#dragStartOffset = 0;
	#containerWidth = 0;
	#loopDistance = 0;
	#speed = DEFAULTS.speed;

	static get observedAttributes() {
		return ['speed', 'direction', 'paused', 'pause-on-hover', 'drag', 'fade'];
	}

	connectedCallback() {
		const _ = this;

		if (!_.#initialized) {
			_.#initialized = true;
			_.#warnLegacyAttributes();
			_.#buildDOM();
		}

		_.#applyFade();

		_.#attachListeners();

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
		_.#hoverPaused = false;
		_.#endDrag();
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
		_.#syncPlayback();
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

		_.addEventListener('mouseenter', () => _.#onHover(true), { signal });
		_.addEventListener('mouseleave', () => _.#onHover(false), { signal });

		// Pointer capture routes move/up back to the track even when the pointer
		// leaves it, so there are no window-level listeners to leak.
		_.#track.addEventListener('pointerdown', (e) => _.#onPointerDown(e), { signal });
		_.#track.addEventListener('pointermove', (e) => _.#onPointerMove(e), { signal });
		_.#track.addEventListener('pointerup', (e) => _.#onPointerUp(e), { signal });
		_.#track.addEventListener('pointercancel', (e) => _.#onPointerUp(e), { signal });

		// A media query can change --scrolling-content-speed without the host
		// resizing (orientation, height queries), so resize is watched in addition
		// to the ResizeObserver.
		window.addEventListener('resize', () => _.refresh(), { passive: true, signal });

		_.#motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		_.#motionQuery.addEventListener('change', () => _.#syncPlayback(), { signal });
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
	 */
	#cloneItem(source) {
		const clone = source.cloneNode(true);
		clone.setAttribute('aria-hidden', 'true');
		clone.inert = true;
		clone.removeAttribute('id');
		for (const element of clone.querySelectorAll('[id]')) element.removeAttribute('id');
		return clone;
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

		_.#rafId = requestAnimationFrame((next) => _.#tick(next));
	}

	/* ----------------------------------------------------------- interaction */

	#onHover(entering) {
		if (this.getAttribute('pause-on-hover') === 'false') return;
		this.#hoverPaused = entering;
		this.#syncPlayback();
	}

	get #dragEnabled() {
		return this.getAttribute('drag') !== 'false';
	}

	#onPointerDown(event) {
		const _ = this;
		if (!_.#dragEnabled || _.#dragging || !event.isPrimary) return;

		_.#dragging = true;
		_.#pointerId = event.pointerId;
		_.#dragStartX = event.clientX;
		_.#dragStartOffset = _.#offsetX;
		_.setAttribute('dragging', '');
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

	#onPointerMove(event) {
		const _ = this;
		if (!_.#dragging || event.pointerId !== _.#pointerId) return;

		_.#offsetX = _.#dragStartOffset + (event.clientX - _.#dragStartX);
		_.#normalizeOffset();
		_.#paint();
	}

	#onPointerUp(event) {
		if (!this.#dragging || event.pointerId !== this.#pointerId) return;
		this.#endDrag();
	}

	#endDrag() {
		const _ = this;
		if (!_.#dragging) return;

		if (_.#pointerId !== null && _.#track?.hasPointerCapture(_.#pointerId)) {
			_.#track.releasePointerCapture(_.#pointerId);
		}
		_.#dragging = false;
		_.#pointerId = null;
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

injectStyles();

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
