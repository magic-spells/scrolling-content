'use strict';

// <scrolling-track>
class ScrollingTrack extends HTMLElement {
  connectedCallback() {
    this.style.display = 'flex';
    this.style.flexWrap = 'nowrap';
    this.style.alignItems = 'center';
    this.style.gap = 'var(--scrolling-content-gap, 1rem)';
    this.style.cursor = 'pointer';
    this.style.touchAction = 'pan-y';
    if (this.dataset.gap) this.style.gap = `${parseFloat(this.dataset.gap)}px`;
  }
}
customElements.define('scrolling-track', ScrollingTrack);

// <scrolling-item>
class ScrollingItem extends HTMLElement {
  connectedCallback() {
    this.style.display = 'flex';
    this.style.alignItems = 'center';
    this.style.gap = 'var(--scrolling-content-gap, 1rem)';
    if (this.dataset.pad) this.style.padding = `${parseFloat(this.dataset.pad)}px`;
  }
}
customElements.define('scrolling-item', ScrollingItem);

// <scrolling-content>
class ScrollingContent extends HTMLElement {
  static get observedAttributes() {
    return ['data-mobile-speed', 'data-desktop-speed', 'data-breakpoint'];
  }

  constructor() {
    super();
    const _ = this;
    _.track = null;
    _.items = [];
    _.mobileSpeed = 40;
    _.desktopSpeed = 60;
    _.breakpoint = 767;
    _.isRunning = false;
    _.isHoverPaused = false;
    _.isDragging = false;
    _.prevTime = 0;
    _.offsetX = 0;
    _.dragStartX = 0;
    _.dragStartY = 0; // track initial Y position for direction detection
    _.startOffset = 0;
    _.containerWidth = 0;
    _.loopDistance = 0; // distance to move before wrapping back to start
    _.rafId = null;
    _.resizeHandler = () => _.handleResize();
    _.touchDirection = 0; // 0: unknown, 1: horizontal, -1: vertical
    _.directionThreshold = 3; // pixels of movement before determining direction
  }

  connectedCallback() {
    const _ = this;
    _.initElements();
    _.readAttributes();
    requestAnimationFrame(() => {
      _.checkTrackWidth();
      _.attachEvents();
      _.start();
    });
  }

  attributeChangedCallback(name, oldV, newV) {
    if (oldV === newV) return;
    this.readAttributes();
    if (!this.isHoverPaused && !this.isDragging) {
      this.stop();
      this.start();
    }
  }

  initElements() {
    const _ = this;
    _.style.overflow = 'hidden';
    _.track = _.querySelector('scrolling-track');
    if (!_.track) {
      _.track = document.createElement('scrolling-track');
      while (_.firstChild) _.track.appendChild(_.firstChild);
      _.appendChild(_.track);
    }

    // Check if content is already wrapped in scrolling-item
    const existingItem = _.track.querySelector('scrolling-item');
    if (!existingItem) {
      // Wrap all track content in a single scrolling-item
      const item = document.createElement('scrolling-item');
      while (_.track.firstChild) {
        item.appendChild(_.track.firstChild);
      }
      _.track.appendChild(item);
    }

    _.items = Array.from(_.track.children);
    Object.assign(_.track.style, {
      display: 'flex',
      willChange: 'transform',
    });
    _.containerWidth = _.getBoundingClientRect().width;
  }

  readAttributes() {
    const _ = this;
    const getNum = (attr, fallback) =>
      isNaN(parseFloat(_.getAttribute(attr))) ? fallback : parseFloat(_.getAttribute(attr));
    _.mobileSpeed = getNum('data-mobile-speed', _.mobileSpeed);
    _.desktopSpeed = getNum('data-desktop-speed', _.desktopSpeed);
    _.breakpoint = getNum('data-breakpoint', _.breakpoint);
  }

  /**
   * duplicates items until track is at least 200% of container width
   */
  checkTrackWidth() {
    const _ = this;
    if (!_.items.length) return;

    // get the width of the first item (since all items are the same)
    const itemWidth = _.items[0].getBoundingClientRect().width;

    // get gap from CSS variable or track style
    const computedStyle = getComputedStyle(_.track);
    const gap = parseFloat(computedStyle.gap) || 0;

    // store the distance we need to move before wrapping back to start
    // this is the width of one item plus one gap
    _.loopDistance = itemWidth + gap;

    // calculate how many items we need to fill 200% of container
    const itemsNeeded = Math.ceil((_.containerWidth * 2) / itemWidth) + 1;

    // only duplicate if we need more items
    const currentCount = _.items.length;
    for (let i = currentCount; i < itemsNeeded; i++) {
      const clone = _.items[0].cloneNode(true);
      _.track.appendChild(clone);
    }

    // update items array with all children
    _.items = Array.from(_.track.children);
  }

  attachEvents() {
    const _ = this;
    _.addEventListener('mouseenter', () => {
      _.isHoverPaused = true;
      _.stop();
    });
    _.addEventListener('mouseleave', () => {
      _.isHoverPaused = false;
      if (!_.isDragging) _.start();
    });
    
    // Touch events for better mobile support
    _.track.addEventListener('touchstart', (e) => _.onTouchStart(e), { passive: false });
    _.track.addEventListener('touchmove', (e) => _.onTouchMove(e), { passive: false });
    _.track.addEventListener('touchend', (e) => _.onTouchEnd(e));
    _.track.addEventListener('touchcancel', (e) => _.onTouchEnd(e));
    
    // Pointer events for desktop/mouse
    _.track.addEventListener('pointerdown', (e) => _.onPointerDown(e));
    window.addEventListener('pointermove', (e) => _.onPointerMove(e));
    window.addEventListener('pointerup', (e) => _.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => _.onPointerUp(e));
    window.addEventListener('resize', _.resizeHandler);
  }

  start() {
    const _ = this;
    if (_.isRunning) return;
    _.isRunning = true;
    _.prevTime = performance.now();
    _.rafId = requestAnimationFrame((ts) => _.tick(ts));
  }

  stop() {
    const _ = this;
    if (!_.isRunning) return;
    cancelAnimationFrame(_.rafId);
    _.isRunning = false;
    _.rafId = null;
  }

  /**
   * main animation loop
   * @param {number} ts - timestamp from requestAnimationFrame
   */
  tick(ts) {
    const _ = this;
    if (!_.isRunning) return;

    // calculate time delta
    const delta = (ts - _.prevTime) / 1000;
    _.prevTime = ts;

    // move left by speed * delta
    _.offsetX -= _.getCurrentSpeed() * delta;

    // wrap around when we've moved past one complete loop distance
    // this creates the infinite loop illusion
    if (_.offsetX <= -_.loopDistance) {
      _.offsetX += _.loopDistance;
    }

    // apply the transform
    _.track.style.transform = `translateX(${_.offsetX}px)`;

    // continue animation
    _.rafId = requestAnimationFrame((t) => _.tick(t));
  }

  getCurrentSpeed() {
    return window.innerWidth <= this.breakpoint ? this.mobileSpeed : this.desktopSpeed;
  }

  onTouchStart(e) {
    const _ = this;
    if (e.touches.length !== 1) return; // only handle single touch
    
    _.isDragging = true;
    _.dragStartX = e.touches[0].screenX;
    _.dragStartY = e.touches[0].screenY;
    _.startOffset = _.offsetX;
    _.touchDirection = 0; // reset direction
    _.stop();
  }

  onTouchMove(e) {
    const _ = this;
    if (!_.isDragging || e.touches.length !== 1) return;

    // if already determined to be horizontal, prevent default and scroll
    if (_.touchDirection === 1) {
      e.preventDefault();
      const diffX = e.touches[0].screenX - _.dragStartX;
      
      _.offsetX = _.startOffset + diffX;
      while (_.offsetX <= -_.loopDistance) _.offsetX += _.loopDistance;
      while (_.offsetX > 0) _.offsetX -= _.loopDistance;
      _.track.style.transform = `translateX(${_.offsetX}px)`;
      return;
    }

    // calculate movement distances to determine direction
    const deltaX = Math.abs(_.dragStartX - e.touches[0].screenX);
    const deltaY = Math.abs(_.dragStartY - e.touches[0].screenY);

    // determine direction with bias toward horizontal (like your carousel)
    if (deltaX * 1.15 > deltaY && (deltaX > _.directionThreshold || deltaY > _.directionThreshold)) {
      // horizontal movement detected
      _.touchDirection = 1;
      e.preventDefault();
      return;
    } else if (deltaY > _.directionThreshold && deltaX <= deltaY) {
      // vertical movement detected - cancel drag and allow page scroll
      _.touchDirection = -1;
      _.isDragging = false;
      if (!_.isHoverPaused) _.start();
      return;
    }

    // direction not yet determined - prevent default to avoid premature page scroll
    e.preventDefault();
  }

  onTouchEnd(e) {
    const _ = this;
    if (!_.isDragging) return;
    _.isDragging = false;
    _.touchDirection = 0;
    if (!_.isHoverPaused) _.start();
  }

  onPointerDown(e) {
    const _ = this;
    // Skip if this is a touch event (handled by touch handlers)
    if (e.pointerType === 'touch') return;
    
    _.isDragging = true;
    _.dragStartX = e.clientX;
    _.dragStartY = e.clientY; // store initial Y position
    _.startOffset = _.offsetX;
    _.touchDirection = 0; // reset direction detection
    _.stop();
    _.track.setPointerCapture(e.pointerId);
  }

  onPointerMove(e) {
    const _ = this;
    if (!_.isDragging) return;
    // Skip if this is a touch event (handled by touch handlers)
    if (e.pointerType === 'touch') return;

    // calculate movement distances
    const diffX = e.clientX - _.dragStartX;
    e.clientY - _.dragStartY;

    _.offsetX = _.startOffset + diffX;

    // normalize offset to stay within bounds
    while (_.offsetX <= -_.loopDistance) _.offsetX += _.loopDistance;
    while (_.offsetX > 0) _.offsetX -= _.loopDistance;

    _.track.style.transform = `translateX(${_.offsetX}px)`;
  }

  onPointerUp(e) {
    const _ = this;
    if (!_.isDragging) return;
    // Skip if this is a touch event (handled by touch handlers)
    if (e.pointerType === 'touch') return;
    
    _.isDragging = false;
    _.touchDirection = 0; // reset direction
    try {
      _.track.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore errors if pointer capture was already released
    }
    if (!_.isHoverPaused) _.start();
  }

  handleResize() {
    const _ = this;
    const newW = _.getBoundingClientRect().width;
    if (newW === _.containerWidth) return;
    _.containerWidth = newW;

    // recalculate and rebuild track
    _.checkTrackWidth();

    // normalize offset position
    _.offsetX = _.offsetX % _.loopDistance;
    while (_.offsetX <= -_.loopDistance) _.offsetX += _.loopDistance;
    while (_.offsetX > 0) _.offsetX -= _.loopDistance;

    _.track.style.transform = `translateX(${_.offsetX}px)`;
  }
}
customElements.define('scrolling-content', ScrollingContent);
