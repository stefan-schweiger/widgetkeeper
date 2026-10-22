/*
 * Web Page: a page the user picks, in a frame, drawn at a set width and scaled to fill the widget (a gadget with
 * fixed pixel sizes, such as a map gadget, then fills it at any size without borders), optionally with a
 * row of buttons that switch between addresses (a map's zoom levels). Links never open (the sandbox has no popups or
 * top navigation), and unless the page may be tapped a layer over it takes the taps. Plain browser JS (served as-is).
 */
(function () {
  const { el } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  'use strict';

  const TAP_SLOP = 10; // px a finger may move and still count as a tap
  const SWAP_MS = 20e3; // a reloaded page replaces the shown one once loaded, or after this long anyway
  const MAX_BUTTONS = 4;
  /** Scripts and forms run, but nothing opens: no popups, no navigating the dashboard away. */
  const SANDBOX = 'allow-scripts allow-same-origin allow-forms';

  const DEFAULT_STRINGS = {
    noAddress: "Type the page's address in the widget settings.",
    badAddress: "This address can't be shown: it must start with https:// or http://.",
    noLocation: "Set the Homey's location to use {lat} and {lon}.",
    locationError: "Could not read the Homey's location.",
    button: 'Button __n__',
  };

  /** Whether an address uses Homey's location. */
  function usesLocation(raw) {
    return typeof raw === 'string' && /\{(lat|lon)\}/.test(raw);
  }

  /**
   * The address to load for a setting: trimmed, `{lat}`/`{lon}` filled in from `loc`, `https://` added when it has no
   * scheme. `{error}` for an empty one (`noAddress`), one that isn't http(s) (`badAddress`) or one that needs a
   * location it hasn't got (`noLocation`).
   */
  function pageAddress(raw, loc) {
    let s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return { error: 'noAddress' };
    if (usesLocation(s)) {
      if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return { error: 'noLocation' };
      s = s.replace(/\{lat\}/g, String(loc.lat)).replace(/\{lon\}/g, String(loc.lon));
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
    let url;
    try { url = new URL(s); } catch (e) { return { error: 'badAddress' }; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'badAddress' };
    return { url: url.href };
  }

  /** A setting's number, rounded and kept within [min, max]; `fallback` for anything that isn't a number. */
  function settingNumber(v, fallback, min, max) {
    const n = typeof v === 'number' || (typeof v === 'string' && v.trim()) ? Number(v) : NaN;
    return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : fallback;
  }

  /**
   * The page's frame for a widget `width` px wide: drawn `pageWidth` px wide (the widget's own width when 0) and
   * `pageHeight` high, scaled by `scale`; `height` is the widget's, rounded down so the scaled page always covers it.
   */
  function pageBox(width, pageWidth, pageHeight) {
    const w = Math.max(0, width);
    const drawn = pageWidth > 0 ? pageWidth : w;
    const scale = drawn > 0 && pageWidth > 0 ? w / drawn : 1;
    return { width: drawn, height: pageHeight, scale, boxHeight: Math.floor(pageHeight * scale) };
  }

  /**
   * A tap: a touch that ends within TAP_SLOP of where it started (a drag is left to the dashboard, so it
   * still scrolls), or a click from a mouse or keyboard. Quick Actions' logic.
   */
  function onTap(node, fn) {
    let start = null;
    let lastTouchTap = 0;
    const unpress = () => { start = null; node.classList.remove('pressing'); };
    node.addEventListener('touchstart', (e) => {
      const p = e.changedTouches[0];
      start = { x: p.clientX, y: p.clientY };
      node.classList.add('pressing');
    }, { passive: true });
    node.addEventListener('touchmove', (e) => {
      const p = e.changedTouches[0];
      if (start && Math.hypot(p.clientX - start.x, p.clientY - start.y) > TAP_SLOP) unpress();
    }, { passive: true });
    node.addEventListener('touchend', (e) => {
      const tap = !!start;
      unpress();
      // Every touch: one that moved past TAP_SLOP can still get the browser's click.
      lastTouchTap = Date.now();
      if (!tap) return;
      e.preventDefault(); // no click after it
      fn(e);
    });
    node.addEventListener('touchcancel', unpress);
    node.addEventListener('click', (e) => {
      if (Date.now() - lastTouchTap < 800) return;
      fn(e);
    });
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      fn(e);
    });
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, url?: string, pageWidth?: any, pageHeight?: any,
   *   interactive?: boolean, refresh?: any, buttons?: {name?: string, url?: string}[],
   *   onHeight?: (h: number) => void }} opts `refresh` is in minutes (0: never). With an address that uses
   *   `{lat}`/`{lon}`, nothing loads until `setLocation()`.
   */
  function createWebPageWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`webpage.${key}`, tokens) : null;
      if (s && s !== `webpage.${key}`) return s;
      return String(DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && k in tokens ? tokens[k] : ''));
    };
    const pageWidth = settingNumber(opts.pageWidth, 0, 0, 4000);
    const pageHeight = settingNumber(opts.pageHeight, 320, 20, 4000);
    const refreshMs = settingNumber(opts.refresh, 0, 0, 1440) * 60e3;
    const buttonsIn = (opts.buttons || []).slice(0, MAX_BUTTONS)
      .map((b, i) => ({ name: (b && typeof b.name === 'string' ? b.name.trim() : '') || t('button', { n: i + 1 }), raw: b && b.url }))
      .filter(b => typeof b.raw === 'string' && b.raw.trim());
    const needsLocation = usesLocation(opts.url) || buttonsIn.some(b => usesLocation(b.raw));

    root.classList.add('wp');
    const box = el('div', { class: 'wp-page' }, root);
    const message = el('div', { class: 'wp-message', dir: 'auto' }, root);
    const row = el('div', { class: 'wp-row' }, root);
    if (!opts.interactive) el('div', { class: 'wp-shield' }, box);

    let current = null; // the address shown
    let frame = null; // the iframe shown
    let pending = null; // { frame, timer }: a reload waiting for its page
    let width = -1;
    let dueWhileHidden = false;
    let buttons = []; // { name, url, node }

    function newFrame(url) {
      const f = el('iframe', { class: 'wp-frame', src: url, sandbox: SANDBOX, referrerpolicy: 'no-referrer', loading: 'eager', title: '' });
      f.setAttribute('scrolling', 'no');
      size(f);
      box.insertBefore(f, box.firstChild);
      return f;
    }

    function size(f) {
      const b = pageBox(width < 0 ? root.clientWidth : width, pageWidth, pageHeight);
      f.style.width = `${b.width}px`;
      f.style.height = `${b.height}px`;
      f.style.transform = b.scale === 1 ? '' : `scale(${b.scale})`;
    }

    /** Shows `url`: the first page at once; a later one replaces the shown page once it has loaded. */
    function load(url) {
      current = url;
      buttons.forEach(b => b.node.classList.toggle('active', b.url === url));
      if (!frame) {
        frame = newFrame(url);
        return;
      }
      if (pending) { clearTimeout(pending.timer); pending.frame.remove(); }
      const next = newFrame(url);
      const swap = () => {
        if (!pending || pending.frame !== next) return;
        clearTimeout(pending.timer);
        pending = null;
        if (frame) frame.remove();
        frame = next;
      };
      pending = { frame: next, timer: setTimeout(swap, SWAP_MS) };
      next.addEventListener('load', swap);
    }

    function reload() {
      if (!current) return;
      if (document.hidden) { dueWhileHidden = true; return; }
      load(current);
    }

    function showMessage(key) {
      message.textContent = key ? t(key) : '';
      root.classList.toggle('wp-has-message', !!key);
      layout();
    }

    /** Sizes the page to the widget's width; Homey gets the new height. */
    function layout() {
      width = root.clientWidth;
      box.style.height = current ? `${pageBox(width, pageWidth, pageHeight).boxHeight}px` : '';
      for (const f of box.querySelectorAll('iframe')) size(f);
      if (opts.onHeight) opts.onHeight(root.offsetHeight);
    }

    /** Builds the button row (two or more usable buttons) and opens the start page. */
    function start(loc) {
      buttons = buttonsIn.map(b => ({ name: b.name, url: pageAddress(b.raw, loc).url })).filter(b => b.url);
      row.textContent = '';
      if (buttons.length >= 2) {
        row.style.setProperty('--wp-count', String(buttons.length));
        for (const b of buttons) {
          b.node = el('button', { class: 'wp-btn', type: 'button' }, row);
          el('span', { dir: 'auto', text: b.name }, b.node);
          onTap(b.node, () => { if (b.url !== current) load(b.url); });
        }
      } else {
        buttons = [];
      }
      root.classList.toggle('wp-has-row', buttons.length >= 2);
      const page = pageAddress(opts.url, loc);
      if (page.error) {
        showMessage(page.error);
        return;
      }
      showMessage(null);
      load(page.url);
      layout();
    }

    if (refreshMs > 0) setInterval(reload, refreshMs);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !dueWhileHidden) return;
      dueWhileHidden = false;
      reload();
    });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (root.clientWidth !== width) layout(); }).observe(root);
    else window.addEventListener('resize', layout);

    if (!needsLocation) start(null);

    return {
      needsLocation,
      /** Homey's location (`{lat, lon}`, `{noLocation: true}`, or null when it couldn't be read). */
      setLocation(loc) {
        if (!needsLocation) return;
        if (!loc) { showMessage('locationError'); return; }
        start(loc.noLocation ? null : loc);
      },
      /** The address shown, or null. */
      current: () => current,
    };
  }

  window.createWebPageWidget = createWebPageWidget;
  window.webPageAddress = pageAddress;
  window.webPageBox = pageBox;
})();
