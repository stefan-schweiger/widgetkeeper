/*
 * Spacer: an empty, transparent widget of a set height, to line up widgets across a dashboard's columns.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const DEFAULT_HEIGHT = 32;
  // At 0 px the iOS app showed its loading placeholder for good; 16 px was fine (2026-10-23).
  const MIN_HEIGHT = 16;
  const MAX_HEIGHT = 800;

  /** The `height` setting as whole px within 16–800 (a 0 stored before is 16); anything that isn't a number is the default. */
  function spacerHeight(value) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_HEIGHT;
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(n)));
  }

  /** @param {HTMLElement} root @param {{ height?: unknown }} [opts] */
  function createSpacerWidget(root, opts = {}) {
    const height = spacerHeight(opts.height);
    const box = document.createElement('div');
    box.className = 'sp';
    box.style.height = `${height}px`;
    root.replaceChildren(box);
    return { height };
  }

  window.spacerHeight = spacerHeight;
  window.createSpacerWidget = createSpacerWidget;
})();
