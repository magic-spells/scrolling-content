/**
 * Infinite scrolling marquee web component.
 *
 * Registers `<scrolling-content>`, `<scrolling-track>` and `<scrolling-item>`
 * as a side effect of importing the module, and injects its structural styles
 * into a `@layer scrolling-content` cascade layer when the first instance
 * connects — unless those styles are already on the page, which it detects from
 * the `--scrolling-content-styles` sentinel the stylesheet sets. Importing `@magic-spells/scrolling-content/css`
 * instead of relying on the injection is therefore safe and duplicate-free.
 *
 * ## Adopting pre-authored markup
 *
 * ```html
 * <scrolling-content>
 *   <scrolling-track>
 *     <scrolling-item>…one pass of content…</scrolling-item>
 *   </scrolling-track>
 * </scrolling-content>
 * ```
 *
 * This is the supported framework-friendly form. When the track and the item
 * are already present the component moves nothing — it measures the authored
 * item and appends clones after it, each marked `data-clone` alongside
 * `aria-hidden`, with focusable descendants set to `tabindex="-1"`. Each direct
 * child of a clone is `inert` only while it isn't fully inside the visible box.
 * A framework that owns its rendered DOM can keep patching the source item; edits to it rebuild the clones automatically. Loose
 * children are still wrapped in a `<scrolling-item>` for plain-HTML authors.
 *
 * Attribute-only options (no matching property): `pause-on-hover="false"`,
 * `drag="false"`, and `fade` — bare for the 4rem default, or any CSS length,
 * which masks the left and right edges so content dissolves instead of
 * clipping.
 */
export declare class ScrollingContent extends HTMLElement {
	/**
	 * Current scroll speed in pixels per second.
	 *
	 * Resolved from the `--scrolling-content-speed` custom property when set
	 * (which lets a media or container query change it at a breakpoint),
	 * otherwise the `speed` attribute, otherwise 60. Setting this writes the
	 * `speed` attribute.
	 */
	speed: number;

	/** Scroll direction. Reflects the `direction` attribute. Default `'left'`. */
	direction: 'left' | 'right';

	/** Whether scrolling is paused. Reflects the `paused` attribute. */
	paused: boolean;

	/** Resume scrolling by clearing `paused`. */
	start(): void;

	/** Pause scrolling by setting `paused`. */
	stop(): void;

	/**
	 * Re-measure the container and content, top up clones, and re-normalize the
	 * offset. Called automatically on resize and when content size changes.
	 *
	 * Tops clones up only — it never refreshes the ones already there, so it
	 * cannot pick up a content EDIT. Use `rebuild()` for that.
	 */
	refresh(): void;

	/**
	 * Discard every `[data-clone]`, re-measure the source item, and refill.
	 *
	 * Runs automatically when the source item's subtree changes (a
	 * `MutationObserver` watching `childList`, `characterData` and `subtree`,
	 * coalesced to one animation frame). Call it manually only when the change is
	 * one the observer can't see — replacing the `<scrolling-item>` element
	 * itself, for instance.
	 */
	rebuild(): void;
}

/** The flex row that gets translated. Created automatically if absent. */
export declare class ScrollingTrack extends HTMLElement {}

/** One repeatable unit of content. Created automatically if absent. */
export declare class ScrollingItem extends HTMLElement {}

export interface ScrollingContentEventMap {
	'scrolling-content:start': CustomEvent<void>;
	'scrolling-content:stop': CustomEvent<void>;
	'scrolling-content:drag-start': CustomEvent<void>;
	'scrolling-content:drag-end': CustomEvent<void>;
}

declare global {
	interface HTMLElementTagNameMap {
		'scrolling-content': ScrollingContent;
		'scrolling-track': ScrollingTrack;
		'scrolling-item': ScrollingItem;
	}

	interface HTMLElementEventMap extends ScrollingContentEventMap {}
}
