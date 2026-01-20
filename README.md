# Scrolling Content Web Component

A lightweight, performant Web Component for creating smooth infinite scrolling content. Perfect for displaying logos, announcements, testimonials, or any content that needs to scroll continuously across the screen.

[**Live Demo**](https://magic-spells.github.io/scrolling-content/demo/)

## Features

- No dependencies
- Lightweight and performant
- Smooth animations that adapt to device refresh rates
- Infinite loop with automatic content duplication
- Interactive hover-to-pause and drag-to-scroll
- Responsive speed settings for mobile and desktop
- Customizable gap spacing with CSS variables
- Touch-friendly on mobile devices

## Installation

```bash
npm install @magic-spells/scrolling-content
```

```javascript
// Add to your JavaScript file
import '@magic-spells/scrolling-content';
```

Or include directly in your HTML:

```html
<script src="https://unpkg.com/@magic-spells/scrolling-content"></script>
```

## Usage

```html
<scrolling-content mobile-speed="40" desktop-speed="60">
  <scrolling-track>
    <div>🚀 Web Components</div>
    <div>⚡ Lightning Fast</div>
    <div>🎨 Fully Customizable</div>
    <div>📱 Mobile Friendly</div>
    <!-- Component automatically wraps content and duplicates it -->
  </scrolling-track>
</scrolling-content>

<!-- Control gap with CSS -->
<style>
  scrolling-content {
    --scrolling-content-gap: 1rem;
  }
</style>
```

## How It Works

- Content is wrapped in `<scrolling-item>` and is duplicated until it fills at least 200% of the container width.
- The component automatically starts scrolling when loaded.
- The track smoothly scrolls left, creating an infinite loop by resetting position when one full cycle completes.
- Hovering over the content pauses the animation.
- You can drag the content to manually scroll (touch-friendly on mobile).
- Different speeds can be set for mobile and desktop devices with a customizable breakpoint.

## Configuration

The scrolling content can be configured using the following attributes:

| Attribute       | Description                                                                   | Default |
| --------------- | ----------------------------------------------------------------------------- | ------- |
| `mobile-speed`  | Animation speed in pixels per second for mobile devices (≤ breakpoint width)  | 40      |
| `desktop-speed` | Animation speed in pixels per second for desktop devices (> breakpoint width) | 60      |
| `breakpoint`    | Screen width in pixels that determines mobile vs desktop speed                | 767     |

### Track Configuration

| Attribute | Description                                                | Default           |
| --------- | ---------------------------------------------------------- | ----------------- |
| `gap`     | Gap between duplicated items in pixels (overrides CSS var) | Uses CSS variable |

Example:

```html
<!-- Fast scrolling with custom breakpoint -->
<scrolling-content mobile-speed="60" desktop-speed="100" breakpoint="1024">
  <scrolling-track gap="30">
    <div>Fast scrolling content</div>
  </scrolling-track>
</scrolling-content>

<!-- Slow, gentle scrolling -->
<scrolling-content mobile-speed="20" desktop-speed="30">
  <scrolling-track>
    <div>Slow scrolling content</div>
  </scrolling-track>
</scrolling-content>
```

## Customization

### Styling

The component provides full styling flexibility. Style the content elements however you like:

```css
/* Control gap between items */
scrolling-content {
  --scrolling-content-gap: 2rem;
}

/* Style your content items */
scrolling-track div {
  background: #667eea;
  color: white;
  padding: 1rem 2rem;
  border-radius: 8px;
  font-weight: 500;
}

/* Different themes for different instances */
.logo-carousel {
  --scrolling-content-gap: 3rem;
}

.logo-carousel scrolling-track div {
  background: white;
  border: 2px solid #e0e0e0;
  color: #333;
  font-weight: 600;
}
```

### CSS Variables

| Variable                  | Description                              | Default |
| ------------------------- | ---------------------------------------- | ------- |
| `--scrolling-content-gap` | Gap between track items and within items | 1rem    |

Example:

```css
/* Global gap setting */
:root {
  --scrolling-content-gap: 1.5rem;
}

/* Per-instance gap setting */
.tight-spacing {
  --scrolling-content-gap: 0.5rem;
}

.wide-spacing {
  --scrolling-content-gap: 3rem;
}
```

### JavaScript API

#### Methods

- `start()`: Starts the scrolling animation (automatically called on load).
- `stop()`: Stops the scrolling animation.

#### Interaction Events

The component automatically handles:

- **Hover**: Pauses animation when mouse enters, resumes when mouse leaves
- **Drag**: Click and drag to manually scroll the content
- **Touch**: Touch-friendly dragging on mobile devices
- **Resize**: Automatically recalculates content duplication on window resize

#### Programmatic Control

```javascript
const scrollingContent = document.querySelector('scrolling-content');

// Stop the animation
scrollingContent.stop();

// Start the animation
scrollingContent.start();

// Change speed dynamically
scrollingContent.setAttribute('desktop-speed', '80');
```

#### Performance

The component uses:

- `requestAnimationFrame` for smooth animations that adapt to device refresh rates
- CSS `transform` for hardware-accelerated scrolling
- Efficient content duplication that only runs when needed
- Automatic cleanup of event listeners

## Browser Support

This component works in all modern browsers that support Web Components.

## License

MIT
