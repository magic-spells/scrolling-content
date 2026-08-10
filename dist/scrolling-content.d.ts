/**
 * Infinite scrolling marquee web component.
 *
 * Registers `<scrolling-content>`, `<scrolling-track>` and `<scrolling-item>`
 * as a side effect of importing the module, and injects its structural styles
 * into a `@layer scrolling-content` cascade layer.
 *
 * Attribute-only options (no matching property): `pause-on-hover="false"`
 * and `drag="false"`.
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
	 */
	refresh(): void;
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
