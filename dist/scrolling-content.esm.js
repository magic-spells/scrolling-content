//#region src/scrolling-content.css?inline
var scrolling_content_default = "scrolling-content:not(:defined) {\n  visibility: hidden;\n}\n\nscrolling-content:not(:defined):has(scrolling-track) {\n  visibility: visible;\n}\n\nscrolling-content {\n  --scrolling-content-styles: 1;\n  display: block;\n  overflow: hidden;\n}\n\nscrolling-content[fade] {\n  --_fade: var(--scrolling-content-fade, 4rem);\n  -webkit-mask-image: linear-gradient(90deg,\n		transparent,\n		#000 var(--_fade),\n		#000 calc(100% - var(--_fade)),\n		transparent);\n  -webkit-mask-image: linear-gradient(90deg,\n		transparent,\n		#000 var(--_fade),\n		#000 calc(100% - var(--_fade)),\n		transparent);\n  mask-image: linear-gradient(90deg,\n		transparent,\n		#000 var(--_fade),\n		#000 calc(100% - var(--_fade)),\n		transparent);\n}\n\nscrolling-track {\n  align-items: center;\n  gap: var(--scrolling-content-gap, 1rem);\n  will-change: transform;\n  touch-action: pan-y;\n  cursor: grab;\n  flex-wrap: nowrap;\n  width: max-content;\n  display: flex;\n}\n\nscrolling-content[drag=\"false\"] scrolling-track {\n  cursor: auto;\n  touch-action: auto;\n}\n\nscrolling-content[dragging] scrolling-track {\n  cursor: grabbing;\n  -webkit-user-select: none;\n  user-select: none;\n}\n\nscrolling-item {\n  align-items: center;\n  gap: var(--scrolling-content-gap, 1rem);\n  padding: var(--scrolling-content-item-padding, 0);\n  flex: none;\n  display: flex;\n}\n";
//#endregion
//#region src/scrolling-content.js
function injectStyles(host) {
	if (typeof document === "undefined") return;
	if (document.querySelector("style[data-scrolling-content]")) return;
	if (host && getComputedStyle(host).getPropertyValue("--scrolling-content-styles").trim() === "1") return;
	const style = document.createElement("style");
	style.setAttribute("data-scrolling-content", "");
	style.textContent = `@layer scrolling-content {\n${scrolling_content_default}\n}`;
	document.head.prepend(style);
}
var DEFAULTS = {
	speed: 60,
	direction: "left"
};
var MAX_DELTA_MS = 64;
var FILL_RATIO = 2;
var MIN_ITEM_WIDTH = 1;
var MAX_ITEMS = 200;
var LEGACY_ATTRIBUTES = [
	"mobile-speed",
	"desktop-speed",
	"breakpoint"
];
var legacyWarned = false;
/**
* Track element — the flex row that gets translated. Layout lives entirely in
* scrolling-content.css so authors can override it without `!important`.
*/
var ScrollingTrack = class extends HTMLElement {};
/**
* Item element — one repeatable unit of content. The component wraps loose
* children in one of these and clones it to fill the track.
*/
var ScrollingItem = class extends HTMLElement {};
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
var ScrollingContent = class extends HTMLElement {
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
	#pointerId = null;
	#previousTime = 0;
	#offsetX = 0;
	#dragStartX = 0;
	#dragStartOffset = 0;
	#containerWidth = 0;
	#loopDistance = 0;
	#speed = DEFAULTS.speed;
	static get observedAttributes() {
		return [
			"speed",
			"direction",
			"paused",
			"pause-on-hover",
			"drag",
			"fade"
		];
	}
	connectedCallback() {
		const _ = this;
		injectStyles(_);
		if (!_.#initialized) {
			_.#initialized = true;
			_.#warnLegacyAttributes();
			_.#buildDOM();
		}
		_.#applyFade();
		_.#attachListeners();
		_.#observeContent();
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
	}
	attributeChangedCallback(name, previousValue, currentValue) {
		if (previousValue === currentValue) return;
		if (!this.#initialized) return;
		if (name === "speed") this.#speed = this.#resolveSpeed();
		if (name === "fade") this.#applyFade();
		this.#syncPlayback();
	}
	/** Resume scrolling (clears `paused`). */
	start() {
		this.removeAttribute("paused");
	}
	/** Pause scrolling (sets `paused`). */
	stop() {
		this.setAttribute("paused", "");
	}
	/**
	* Re-measure the container and content, top up clones, and re-normalize the
	* offset. Called automatically on resize and content change.
	*/
	refresh() {
		const _ = this;
		if (!_.isConnected || !_.#track) return;
		_.#containerWidth = _.getBoundingClientRect().width;
		_.#speed = _.#resolveSpeed();
		_.#fill();
		_.#normalizeOffset();
		_.#paint();
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
		for (const clone of _.#track.querySelectorAll(":scope > [data-clone]")) clone.remove();
		_.#items = Array.from(_.#track.children);
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
		this.setAttribute("speed", String(value));
	}
	get direction() {
		return this.getAttribute("direction") === "right" ? "right" : DEFAULTS.direction;
	}
	set direction(value) {
		this.setAttribute("direction", value === "right" ? "right" : "left");
	}
	get paused() {
		return this.hasAttribute("paused");
	}
	set paused(value) {
		this.toggleAttribute("paused", Boolean(value));
	}
	#warnLegacyAttributes() {
		if (legacyWarned) return;
		const found = LEGACY_ATTRIBUTES.filter((name) => this.hasAttribute(name));
		if (!found.length) return;
		legacyWarned = true;
		console.warn(`<scrolling-content>: ${found.join(", ")} ${found.length > 1 ? "were" : "was"} removed in v2. Use the \`speed\` attribute (px/sec) and override it per breakpoint with the \`--scrolling-content-speed\` custom property.`);
	}
	/**
	* `fade` on its own uses the stylesheet's default width; `fade="3rem"` sets
	* the width inline so the common case needs no accompanying CSS rule. Any CSS
	* length works — the value is handed to the cascade, not parsed here.
	*/
	#applyFade() {
		const value = this.getAttribute("fade");
		if (value) this.style.setProperty("--scrolling-content-fade", value);
		else this.style.removeProperty("--scrolling-content-fade");
	}
	#buildDOM() {
		const _ = this;
		_.#track = _.querySelector("scrolling-track");
		if (!_.#track) {
			_.#track = document.createElement("scrolling-track");
			while (_.firstChild) _.#track.appendChild(_.firstChild);
			_.appendChild(_.#track);
		}
		if (!_.#track.querySelector("scrolling-item")) {
			const item = document.createElement("scrolling-item");
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
		_.addEventListener("pointerenter", (e) => _.#onHover(e, true), { signal });
		_.addEventListener("pointerleave", (e) => _.#onHover(e, false), { signal });
		_.#track.addEventListener("pointerdown", (e) => _.#onPointerDown(e), { signal });
		_.#track.addEventListener("pointermove", (e) => _.#onPointerMove(e), { signal });
		_.#track.addEventListener("pointerup", (e) => _.#onPointerUp(e), { signal });
		_.#track.addEventListener("pointercancel", (e) => _.#onPointerUp(e), { signal });
		window.addEventListener("resize", () => _.refresh(), {
			passive: true,
			signal
		});
		_.#motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
		_.#motionQuery.addEventListener("change", () => _.#syncPlayback(), { signal });
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
			subtree: true
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
	/**
	* Resolve speed in px/sec. The custom property wins when set, so a breakpoint
	* can override the attribute. Deliberately not given a default in the
	* stylesheet — a stylesheet default would always beat the attribute.
	*/
	#resolveSpeed() {
		const custom = getComputedStyle(this).getPropertyValue("--scrolling-content-speed").trim();
		const fromCSS = custom === "" ? NaN : parseFloat(custom);
		if (Number.isFinite(fromCSS)) return fromCSS;
		const fromAttribute = parseFloat(this.getAttribute("speed"));
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
		_.#loopDistance = itemWidth + (parseFloat(getComputedStyle(_.#track).columnGap) || 0);
		const needed = Math.min(Math.ceil(_.#containerWidth * FILL_RATIO / _.#loopDistance) + 1, MAX_ITEMS);
		for (let i = _.#items.length; i < needed; i++) _.#track.appendChild(_.#cloneItem(source));
		_.#items = Array.from(_.#track.children);
	}
	/**
	* Clones are visual filler. They're hidden from assistive tech and taken out
	* of the tab order, and their ids are stripped so the page doesn't end up
	* with N copies of every id in the content.
	*
	* `data-clone` marks them as ours: it is how `rebuild()` tells filler from
	* the author's own item, and how a framework or a test can ignore them.
	*/
	#cloneItem(source) {
		const clone = source.cloneNode(true);
		clone.setAttribute("data-clone", "");
		clone.setAttribute("aria-hidden", "true");
		clone.inert = true;
		clone.removeAttribute("id");
		for (const element of clone.querySelectorAll("[id]")) element.removeAttribute("id");
		return clone;
	}
	/** Fold the offset into (-loopDistance, 0]. */
	#normalizeOffset() {
		const distance = this.#loopDistance;
		if (!(distance > 0)) {
			this.#offsetX = 0;
			return;
		}
		this.#offsetX = (this.#offsetX % distance + distance) % distance - distance;
	}
	#paint() {
		if (this.#track) this.#track.style.transform = `translateX(${this.#offsetX}px)`;
	}
	get #prefersReducedMotion() {
		return this.#motionQuery?.matches ?? false;
	}
	get #shouldRun() {
		const _ = this;
		return _.isConnected && _.#loopDistance > 0 && !_.paused && !_.#hoverPaused && !_.#dragging && !_.#prefersReducedMotion;
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
		_.#emit("start");
	}
	#stopLoop() {
		const _ = this;
		if (!_.#running) return;
		cancelAnimationFrame(_.#rafId);
		_.#rafId = null;
		_.#running = false;
		_.#emit("stop");
	}
	#tick(timestamp) {
		const _ = this;
		if (!_.#running) return;
		const delta = Math.min(timestamp - _.#previousTime, MAX_DELTA_MS) / 1e3;
		_.#previousTime = timestamp;
		const step = _.#speed * delta;
		_.#offsetX += _.direction === "right" ? step : -step;
		_.#normalizeOffset();
		_.#paint();
		_.#rafId = requestAnimationFrame((next) => _.#tick(next));
	}
	#onHover(event, entering) {
		if (event.pointerType !== "mouse") return;
		if (this.getAttribute("pause-on-hover") === "false") return;
		this.#hoverPaused = entering;
		this.#syncPlayback();
	}
	get #dragEnabled() {
		return this.getAttribute("drag") !== "false";
	}
	#onPointerDown(event) {
		const _ = this;
		if (!_.#dragEnabled || _.#dragging || !event.isPrimary) return;
		_.#dragging = true;
		_.#pointerId = event.pointerId;
		_.#dragStartX = event.clientX;
		_.#dragStartOffset = _.#offsetX;
		_.setAttribute("dragging", "");
		_.#syncPlayback();
		_.#emit("drag-start");
		try {
			_.#track.setPointerCapture(event.pointerId);
		} catch {}
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
		if (_.#pointerId !== null && _.#track?.hasPointerCapture(_.#pointerId)) _.#track.releasePointerCapture(_.#pointerId);
		_.#dragging = false;
		_.#pointerId = null;
		_.removeAttribute("dragging");
		_.#syncPlayback();
		_.#emit("drag-end");
	}
	#emit(name) {
		this.dispatchEvent(new CustomEvent(`scrolling-content:${name}`, {
			bubbles: true,
			composed: true
		}));
	}
};
if (!customElements.get("scrolling-track")) customElements.define("scrolling-track", ScrollingTrack);
if (!customElements.get("scrolling-item")) customElements.define("scrolling-item", ScrollingItem);
if (!customElements.get("scrolling-content")) customElements.define("scrolling-content", ScrollingContent);
//#endregion
export { ScrollingContent, ScrollingItem, ScrollingTrack };
