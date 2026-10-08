/*
 * Flow Buttons: flows as compact rows, 1 or 2 per line, the size of Flow Variables' rows. Each one is a round
 * button in its own colour and icon, then the flow's name; a tap anywhere on the row starts the flow.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const TAP_SLOP = 10; // px a finger may move and still count as a tap
  const MIN_RUNNING_MS = 400; // the spinner shows at least this long, so a fast start still registers
  const DONE_MS = 1500; // how long the check mark shows after a start

  const DEFAULT_STRINGS = {
    selectSlots: 'Pick flows in the widget settings.',
    error: 'Could not load the flows.',
    failed: 'Could not start __name__.',
    missing: 'Flow not found',
    disabled: '__name__ is turned off.',
    notTriggerable: "__name__ can't be started by hand.",
    noKey: 'To start flows, add an API key in the app settings.',
    keyScope: 'The API key may not start flows.',
    keyInvalid: 'The API key was not accepted.',
  };
  /** Why a start was refused, from the app (`{ok: false, reason}`): each has its own message. */
  const KEY_PROBLEMS = ['noKey', 'keyScope', 'keyInvalid'];

  const COLORS = ['blue', 'red', 'orange', 'yellow', 'green', 'purple', 'grey'];

  /**
   * The button icons, drawn on a 24 px grid with a 2 px round stroke (`fill: true` for a filled shape). The ids are
   * the `icon` setting's (FLOW_ICONS in lib/FlowService.ts, named in `flows.icons.<id>`).
   */
  const ICONS = {
    play: { fill: true, d: 'M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z' },
    power: { d: 'M12 3v8M7.05 6.05a7 7 0 1 0 9.9 0' },
    bulb: { d: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.55 1.1 1.3 1.1 2.2h5c0-.9.4-1.65 1.1-2.2A6 6 0 0 0 12 3z' },
    sun: { d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41' },
    moon: { d: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' },
    home: { d: 'M3.5 11 12 3.8l8.5 7.2M6 9.3V20h4.5v-5.5h3V20H18V9.3' },
    leave: { d: 'M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10M15 8l4 4-4 4M19 12H9' },
    bed: { d: 'M3 6v13M3 16h18v3M21 16v-3.5a2.5 2.5 0 0 0-2.5-2.5H11v6M7 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z' },
    lock: { d: 'M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11zM8 11V8a4 4 0 0 1 8 0v3' },
    shield: { d: 'M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6l-7-3z' },
    bell: { d: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 21h4' },
    flame: { d: 'M12 2.5c.8 3.2 5.5 5.3 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.3 1-4 2.3-5.2.2 2 1.1 3.2 2.3 3.2-.7-3-.3-5.9.9-8.5z' },
    snowflake: { d: 'M12 2v20M3.34 7l17.32 10M3.34 17 20.66 7M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5' },
    fan: { d: 'M12 12c-1.6-4-1.2-9.2 2.4-9.4 3.6-.2 3.4 5.4-2.4 9.4zM12 12c4.2.6 8.6 3.6 7 6.9-1.6 3.2-6.6.6-7-6.9zM12 12c-2.6 3.3-7.4 5.8-9.4 2.8C.6 11.8 5.6 9 12 12z' },
    drop: { d: 'M12 3.5s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11z' },
    bolt: { d: 'M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8z' },
    music: { d: 'M9 18V5.5l11-2V16M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
    tv: { d: 'M4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6zM8 21h8M9 2.5 12 6l3-3.5' },
    clock: { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2' },
    star: { d: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.06 6.2L12 17.3l-5.56 2.9 1.06-6.2L3 9.6l6.2-.9L12 3z' },
    heart: { d: 'M12 20s-8-4.9-8-10.5A4.5 4.5 0 0 1 12 6.6a4.5 4.5 0 0 1 8 2.9C20 15.1 12 20 12 20z' },
  };
  const CHECK = { d: 'M5 12.5 10 17.5 19 7' };
  const SVG_NS = 'http://www.w3.org/2000/svg';

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

  /** The icon id if it's one of ICONS, else `play`. */
  function iconOf(id) {
    return id && Object.prototype.hasOwnProperty.call(ICONS, id) ? id : 'play';
  }

  /** The colour id if it's one of COLORS, else `blue`. */
  function colorOf(id) {
    return COLORS.includes(id) ? id : 'blue';
  }

  /** An inline SVG of a glyph, stroked (or filled) in the current colour. */
  function glyph(icon, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', icon.d);
    if (icon.fill) path.setAttribute('class', 'filled');
    svg.appendChild(path);
    return svg;
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
      if (!tap) return;
      e.preventDefault(); // no click after it
      lastTouchTap = Date.now();
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
   * @param {{ t?: (key: string, tokens?: object) => string, columns?: number|string,
   *   buttons?: {id: string, color?: string, icon?: string}[],
   *   onTrigger?: (id: string) => Promise<any>, onHaptic?: () => void,
   *   onHeight?: (h: number) => void }} opts
   */
  function createFlowsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`flows.${key}`, tokens) : null;
      if (s && s !== `flows.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    // Each button's look, by position; the entries from setState() line up with it.
    const buttons = (Array.isArray(opts.buttons) ? opts.buttons : []).map(b => ({
      id: b && b.id, color: colorOf(b && b.color), icon: iconOf(b && b.icon),
    }));

    let flows = []; // [{ id, name, enabled, triggerable, advanced } | { id, missing }], one per button
    const busy = new Map(); // button index → 'running' | 'done'
    let messageText = null;
    let messageTimer = null;

    root.classList.add('fb');
    root.dataset.columns = String(opts.columns) === '2' ? '2' : '1';
    const grid = el('div', { class: 'fb-grid' }, root);
    const messageEl = el('div', { class: 'fb-message', dir: 'auto' }, root);
    /** @type {{row: HTMLElement, button: HTMLElement, name: HTMLElement, icon: string|null}[]} */
    const rows = [];

    function setState(list) {
      flows = Array.isArray(list) ? list : [];
      messageText = null;
      render();
    }

    /** A message under the rows. Persistent messages also clear the rows. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else flows = [];
      render();
    }

    function shake(index) {
      const r = rows[index];
      if (!r) return;
      r.row.classList.remove('shake');
      void r.row.offsetWidth; // restart the animation
      r.row.classList.add('shake');
    }

    async function start(index) {
      const f = flows[index];
      if (!f || busy.get(index) === 'running') return;
      if (f.missing) return;
      if (!f.triggerable || !f.enabled) {
        shake(index);
        setMessage(t(f.enabled ? 'notTriggerable' : 'disabled', { name: f.name }), true);
        return;
      }
      if (opts.onHaptic) opts.onHaptic();
      busy.set(index, 'running');
      render();
      const began = Date.now();
      let error = null;
      try {
        if (opts.onTrigger) await opts.onTrigger(f.id);
      } catch (err) {
        error = err || new Error('failed');
      }
      const wait = MIN_RUNNING_MS - (Date.now() - began);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (error) {
        console.error(error);
        busy.delete(index);
        shake(index);
        setMessage(KEY_PROBLEMS.includes(error.reason) ? t(error.reason) : t('failed', { name: f.name }), true);
        return;
      }
      busy.set(index, 'done');
      render();
      setTimeout(() => {
        if (busy.get(index) !== 'done') return;
        busy.delete(index);
        render();
      }, DONE_MS);
    }

    function rowAt(index) {
      if (rows[index]) return rows[index];
      const row = el('div', { class: 'fb-row', role: 'button', tabindex: '0' });
      const button = el('span', { class: 'fb-button' }, row);
      const r = { row, button, name: el('span', { class: 'fb-name', dir: 'auto' }, row), icon: null };
      onTap(row, () => start(index));
      rows[index] = r;
      return r;
    }

    let lastHeight = 0;
    function render() {
      for (let i = rows.length - 1; i >= flows.length; i--) { rows[i].row.remove(); rows.pop(); busy.delete(i); }
      flows.forEach((f, i) => {
        const r = rowAt(i);
        grid.appendChild(r.row); // keeps the order; a no-op when already in place
        const look = buttons[i] || { color: 'blue', icon: 'play' };
        const state = busy.get(i) || null;
        const icon = state === 'done' ? 'check' : look.icon;
        if (r.icon !== icon) {
          r.icon = icon;
          r.button.replaceChildren(glyph(icon === 'check' ? CHECK : ICONS[icon], 'fb-glyph'));
        }
        r.row.dataset.color = look.color;
        r.row.classList.toggle('missing', !!f.missing);
        r.row.classList.toggle('unavailable', !f.missing && (!f.enabled || !f.triggerable));
        r.row.classList.toggle('running', state === 'running');
        r.row.classList.toggle('done', state === 'done');
        r.name.textContent = f.missing ? t('missing') : f.name;
        r.row.title = f.missing ? '' : f.name;
        r.row.setAttribute('aria-label', f.missing ? t('missing') : f.name);
        r.row.setAttribute('aria-busy', String(state === 'running'));
      });
      grid.style.display = flows.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && flows.length > 0);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    return { setState, setMessage, render, t };
  }

  window.createFlowsWidget = createFlowsWidget;
  window.FLOW_BUTTON_ICONS = Object.keys(ICONS);
})();
