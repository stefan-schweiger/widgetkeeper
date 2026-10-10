/*
 * Device Quick Actions: a grid of half-height device tiles. The whole tile triggers the device's
 * quick action (the action of the native tile's round button) and shows its state.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const OPTIMISTIC_MS = 10e3; // how long a tapped tile shows its new state while waiting for the device
  const PRESS_MS = 600; // how long a momentary (button) action lights the tile
  const TAP_SLOP = 10; // px a finger may move and still count as a tap

  const DEFAULT_STRINGS = {
    selectDevices: 'Select devices in the widget settings.',
    error: 'Could not load the devices.',
    failed: 'Could not change __name__.',
    unavailable: 'Unavailable',
  };

  // Homey's standard capabilities carry no icon of their own (the Homey app draws them), so these
  // stand in for the quick-action icon unless the capability has one. Each viewBox is cropped to the ink
  // (plus half the stroke), so the glyph fills its box like the library icons do and its edge lines up with
  // the tile's padding. The thin stroke matches the library icons' line (about 1 px).
  const svg = (viewBox, body) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
  const LOCK_BOX = '4.4 2.4 15.2 19.2'; // both padlocks, so the body doesn't move when it toggles
  const GLYPHS = {
    power: svg('3.4 2.4 17.2 18.6', '<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>'),
    locked: svg(LOCK_BOX, '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    unlocked: svg(LOCK_BOX, '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'),
    play: svg('7.4 4.4 12.2 15.2', '<path d="M8 5v14l11-7z" fill="#000"/>'),
    pause: svg('8 4 8 16', '<path d="M9 5v14M15 5v14" stroke-width="2"/>'),
    button: svg('3.4 3.4 17.2 17.2', '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="#000"/>'),
  };

  /** The built-in glyph for a capability and its current value. */
  function glyph(capabilityId, value) {
    const base = capabilityId.split('.')[0];
    if (base === 'locked') return value ? GLYPHS.locked : GLYPHS.unlocked;
    if (base === 'speaker_playing') return value ? GLYPHS.pause : GLYPHS.play;
    if (base === 'button') return GLYPHS.button;
    return GLYPHS.power;
  }

  function el(tag, attrs, parent) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
      }
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, activeStyle?: 'tint' | 'lighter',
   *   onTrigger?: (deviceId: string, value: boolean) => Promise<any>,
   *   onHeight?: (h: number) => void }} opts
   */
  function createQuickActionsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`quickactions.${key}`, tokens) : null;
      if (s && s !== `quickactions.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };

    let devices = []; // [{ id, name, icon, quickAction } | { id, missing }]
    const optimistic = new Map(); // deviceId → { value, until }
    const pressed = new Map(); // deviceId → until (momentary actions)
    let messageText = null;
    let messageTimer = null;

    root.classList.add('qa');
    root.dataset.activeStyle = opts.activeStyle === 'lighter' ? 'lighter' : 'tint';
    const grid = el('div', { class: 'qa-grid' }, root);
    const messageEl = el('div', { class: 'qa-message', dir: 'auto' }, root);
    let lastTouchTap = 0;
    /** @type {Map<string, {button: HTMLButtonElement, icon: HTMLElement, action: HTMLElement, name: HTMLElement}>} */
    const tiles = new Map();

    function setState(list) {
      devices = Array.isArray(list) ? list : [];
      messageText = null;
      render();
    }

    function pushChange({ deviceId, capabilityId, value }) {
      const d = devices.find(x => x.id === deviceId);
      if (!d || !d.quickAction || d.quickAction.capabilityId !== capabilityId) return;
      d.quickAction.value = value;
      const o = optimistic.get(deviceId);
      if (o && o.value === value) optimistic.delete(deviceId);
      render();
    }

    /** A message under the tiles. Persistent messages also clear the tiles. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else devices = [];
      render();
    }

    function shownValue(d) {
      const o = optimistic.get(d.id);
      if (o && Date.now() < o.until) return o.value;
      optimistic.delete(d.id);
      return d.quickAction.value;
    }

    async function press(id) {
      const d = devices.find(x => x.id === id);
      if (!d || !d.quickAction || !d.quickAction.actionable || !opts.onTrigger) return;
      const value = d.quickAction.momentary ? true : !shownValue(d);
      if (d.quickAction.momentary) {
        pressed.set(id, Date.now() + PRESS_MS);
        setTimeout(render, PRESS_MS + 20);
      } else {
        optimistic.set(id, { value, until: Date.now() + OPTIMISTIC_MS });
        setTimeout(render, OPTIMISTIC_MS + 50);
      }
      render();
      try {
        await opts.onTrigger(id, value);
      } catch (err) {
        console.error(err);
        optimistic.delete(id);
        pressed.delete(id);
        const tile = tiles.get(id);
        if (tile) {
          tile.button.classList.remove('shake');
          void tile.button.offsetWidth; // restart the animation
          tile.button.classList.add('shake');
        }
        setMessage(t('failed', { name: d.name }), true);
      }
    }

    function tileFor(id) {
      let tile = tiles.get(id);
      if (!tile) {
        const button = el('button', { type: 'button', class: 'qa-tile', 'data-device': id });
        const top = el('div', { class: 'qa-top' }, button);
        tile = {
          button,
          icon: el('span', { class: 'qa-icon' }, top),
          action: el('span', { class: 'qa-action' }, top),
          name: el('span', { class: 'qa-name', dir: 'auto' }, button),
        };
        // Taps are handled from the touch events, so the pressed state also shows on iOS (where :active
        // needs a touch listener) and the dashboard's own touch handling can't swallow the click. A tap is
        // a touch that ends within TAP_SLOP of where it started; a drag is left to the dashboard, so
        // dragging over the tiles still scrolls it.
        let start = null;
        const unpress = () => { start = null; button.classList.remove('pressing'); };
        button.addEventListener('touchstart', (e) => {
          const p = e.changedTouches[0];
          start = { x: p.clientX, y: p.clientY };
          button.classList.add('pressing');
        }, { passive: true });
        button.addEventListener('touchmove', (e) => {
          const p = e.changedTouches[0];
          if (start && Math.hypot(p.clientX - start.x, p.clientY - start.y) > TAP_SLOP) unpress();
        }, { passive: true });
        button.addEventListener('touchend', (e) => {
          const tap = !!start;
          unpress();
          // Every touch: one that moved past TAP_SLOP can still get the browser's click.
          lastTouchTap = Date.now();
          if (!tap) return;
          e.preventDefault(); // no click after it
          press(id);
        });
        button.addEventListener('touchcancel', unpress);
        // Mouse and keyboard.
        button.addEventListener('click', () => {
          if (Date.now() - lastTouchTap < 800) return;
          press(id);
        });
        tiles.set(id, tile);
      }
      return tile;
    }

    function setMask(node, url) {
      const v = url ? `url("${url}")` : '';
      if (node.style.getPropertyValue('--qa-mask') !== v) node.style.setProperty('--qa-mask', v);
    }

    let lastHeight = 0;
    function render() {
      const ids = new Set(devices.map(d => d.id));
      for (const [id, tile] of tiles) {
        if (!ids.has(id)) { tile.button.remove(); tiles.delete(id); }
      }
      for (const d of devices) {
        const tile = tileFor(d.id);
        grid.appendChild(tile.button); // keeps the settings' order; a no-op when already in place
        const qa = !('missing' in d) ? d.quickAction : null;
        const until = pressed.get(d.id);
        const isPressed = !!until && Date.now() < until;
        if (!isPressed) pressed.delete(d.id);
        const value = qa ? shownValue(d) : null;

        tile.name.textContent = 'missing' in d ? t('unavailable') : d.name;
        setMask(tile.icon, 'missing' in d ? null : d.icon);
        tile.icon.classList.toggle('fallback', 'missing' in d || !d.icon);
        setMask(tile.action, qa ? (qa.icon || glyph(qa.capabilityId, value)) : null);
        tile.action.style.display = qa ? '' : 'none';
        tile.button.classList.toggle('active', qa ? (qa.momentary ? isPressed : value === true) : false);
        tile.button.disabled = !qa || !qa.actionable;
        tile.button.dataset.capability = qa ? qa.capabilityId : '';
      }
      grid.style.display = devices.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && devices.length > 0);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    return { setState, pushChange, setMessage, render, t };
  }

  window.createQuickActionsWidget = createQuickActionsWidget;
})();
