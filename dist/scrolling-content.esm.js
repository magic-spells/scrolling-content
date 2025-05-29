// <scrolling-track>
class ScrollingTrack extends HTMLElement {
  connectedCallback() {
    this.style.display = 'flex';
    this.style.flexWrap = 'nowrap';
    this.style.alignItems = 'center';
    this.style.gap = 'var(--scrolling-content-gap, 1rem)';
    this.style.cursor = 'pointer';
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
    _.scrollDirection = null; // 'horizontal', 'vertical', or null
    _.directionThreshold = 10; // pixels of movement before determining direction
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

  onPointerDown(e) {
    const _ = this;
    _.isDragging = true;
    _.dragStartX = e.clientX;
    _.dragStartY = e.clientY; // store initial Y position
    _.startOffset = _.offsetX;
    _.scrollDirection = null; // reset direction detection
    _.stop();
    _.track.setPointerCapture(e.pointerId);
  }

  onPointerMove(e) {
    const _ = this;
    if (!_.isDragging) return;

    // calculate movement distances
    const diffX = e.clientX - _.dragStartX;
    const diffY = e.clientY - _.dragStartY;

    // determine scroll direction if not yet determined
    if (!_.scrollDirection) {
      const absX = Math.abs(diffX);
      const absY = Math.abs(diffY);

      // only determine direction after minimum threshold movement
      if (absX > _.directionThreshold || absY > _.directionThreshold) {
        _.scrollDirection = absX > absY ? 'horizontal' : 'vertical';
      }
    }

    // handle horizontal scrolling
    if (_.scrollDirection === 'horizontal') {
      // prevent default to stop page scroll
      if (e.cancelable) {
        e.preventDefault();
      }

      _.offsetX = _.startOffset + diffX;

      // normalize offset to stay within bounds
      while (_.offsetX <= -_.loopDistance) _.offsetX += _.loopDistance;
      while (_.offsetX > 0) _.offsetX -= _.loopDistance;

      _.track.style.transform = `translateX(${_.offsetX}px)`;
    } else if (_.scrollDirection === 'vertical') {
      // release pointer capture to allow normal page scrolling
      try {
        _.track.releasePointerCapture(e.pointerId);
      } catch {}
      _.isDragging = false;
      _.scrollDirection = null;
      if (!_.isHoverPaused) _.start();
    } else {
      // direction not yet determined - prevent default to avoid premature page scroll
      if (e.cancelable) {
        e.preventDefault();
      }
    }
  }

  onPointerUp(e) {
    const _ = this;
    if (!_.isDragging) return;
    _.isDragging = false;
    _.scrollDirection = null; // reset direction
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
//# sourceMappingURL=scrolling-content.esm.js.map
