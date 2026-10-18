/*
 * Flow Buttons: flows as compact rows, 1 or 2 per line, the size of Variables' rows. Each one is a round
 * button in its own colour and icon, then the flow's name; a tap anywhere on the row starts the flow.
 * Plain browser JS (served as-is).
 */
(function () {
  const { el, withName, applyColors } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
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
    keyScope: 'The API key may not start flows: it needs Start Flows.',
    keyInvalid: 'The API key was not accepted.',
  };
  /** Why a start was refused, from the app (`{ok: false, reason}`): each has its own message. */
  const KEY_PROBLEMS = ['noKey', 'keyScope', 'keyInvalid'];

  const COLORS = ['blue', 'red', 'orange', 'yellow', 'green', 'purple', 'grey'];

  /** The button icons (the kit's): the ids are the `icon` setting's. */
  const ICONS = window.WidgetkeeperKit.icons;
  const CHECK = { d: 'M5 12.5 10 17.5 19 7' };
  const SVG_NS = 'http://www.w3.org/2000/svg';

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
   * @param {{ colorStyle?: string, t?: (key: string, tokens?: object) => string, columns?: number|string,
   *   buttons?: {id: string, color?: string, icon?: string, name?: string}[],
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
      id: b && b.id, color: colorOf(b && b.color), icon: iconOf(b && b.icon), name: b && b.name,
    }));

    let flows = []; // [{ id, name, enabled, triggerable, advanced } | { id, missing }], one per button
    const busy = new Map(); // button index → 'running' | 'done'
    let messageText = null;
    let messageTimer = null;

    root.classList.add('fb');
    applyColors(root, { style: opts.colorStyle });
    root.dataset.columns = String(opts.columns) === '2' ? '2' : '1';
    const grid = el('div', { class: 'fb-grid' }, root);
    const messageEl = el('div', { class: 'fb-message', dir: 'auto' }, root);
    /** @type {{row: HTMLElement, button: HTMLElement, name: HTMLElement, icon: string|null}[]} */
    const rows = [];

    function setState(list) {
      flows = (Array.isArray(list) ? list : []).map((f, i) => withName(f, buttons[i] && buttons[i].name));
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
      let placed = null;
      flows.forEach((f, i) => {
        const r = rowAt(i);
        // Keeps the order, moving only what is out of place: a moved node loses the focus of a field in it.
        const want = placed ? placed.nextSibling : grid.firstChild;
        if (r.row !== want) grid.insertBefore(r.row, want);
        placed = r.row;
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
})();
