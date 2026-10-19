/*
 * Dashboard Shortcuts: links to other web dashboards as pills, 1 or 2 per line. Each one is a round icon in its own
 * colour, then the dashboard's name (or the one typed on it); a tap opens that dashboard. The dashboard it's on is
 * marked and does nothing. Web dashboards only. Plain browser JS (served as-is).
 */
(function () {
  const { el, tileNames, applyColors } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  'use strict';

  const TAP_SLOP = 10; // px a finger may move and still count as a tap

  const DEFAULT_STRINGS = {
    selectSlots: 'Pick dashboards in the widget settings.',
    error: 'Could not load the dashboards.',
    missing: 'Dashboard not found',
    webOnly: 'Dashboard Shortcuts only work on web dashboards.',
    current: 'You are here',
    renameFailed: 'Could not save the name.',
  };

  const COLORS = ['blue', 'red', 'orange', 'yellow', 'green', 'purple', 'grey'];

  /** The icons (the kit's): the ids are the `icon` setting's. */
  const ICONS = window.WidgetkeeperKit.icons;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** The icon id if it's one of ICONS, else `dashboard`. */
  function iconOf(id) {
    return id && Object.prototype.hasOwnProperty.call(ICONS, id) ? id : 'dashboard';
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
   *   tiles?: {id: string, color?: string, icon?: string}[],
   *   renameTiles?: boolean, onRename?: (key: string, name: string) => Promise<any>,
   *   onOpen?: (id: string) => void, onHaptic?: () => void, onHeight?: (h: number) => void }} opts
   */
  function createShortcutsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`shortcuts.${key}`, tokens) : null;
      if (s && s !== `shortcuts.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    // Each tile's look, by position; the entries from setState() line up with it.
    const looks = (Array.isArray(opts.tiles) ? opts.tiles : []).map(s => ({
      color: colorOf(s && s.color), icon: iconOf(s && s.icon),
    }));

    let dashboards = []; // [{ id, name } | { id, missing }], one per tile
    let current = null; // the id of the dashboard this widget is on
    let messageText = null;
    let messageTimer = null;

    root.classList.add('sc');
    applyColors(root, { style: opts.colorStyle });
    // The names typed on the tiles (`renameTiles`), by dashboard id: in rename mode a tile's own taps do nothing.
    const typed = tileNames(opts, () => render(), (key) => {
      dashboards.forEach((d, i) => { if (d.id === key) shake(i); });
      setMessage(t('renameFailed'), true);
    });
    root.classList.toggle('renaming', typed.renaming);
    root.dataset.columns = String(opts.columns) === '1' ? '1' : '2';
    const grid = el('div', { class: 'sc-grid' }, root);
    const messageEl = el('div', { class: 'sc-message', dir: 'auto' }, root);
    /** @type {{row: HTMLElement, icon: HTMLElement, name: HTMLElement, glyph: string|null}[]} */
    const rows = [];

    /** `{current, tiles}` from the app: the dashboard it's on, and each tile's dashboard. */
    function setState(state) {
      const s = state && typeof state === 'object' ? state : {};
      dashboards = (Array.isArray(s.tiles) ? s.tiles : []).filter(d => d && typeof d.id === 'string');
      current = typeof s.current === 'string' ? s.current : null;
      messageText = null;
      render();
    }

    /** A message under the tiles. Persistent messages also clear the tiles. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else dashboards = [];
      render();
    }

    function shake(index) {
      const r = rows[index];
      if (!r) return;
      r.row.classList.remove('shake');
      void r.row.offsetWidth; // restart the animation
      r.row.classList.add('shake');
    }

    function open(index) {
      const d = dashboards[index];
      if (!d || d.missing || d.id === current || typed.renaming) return;
      if (opts.onHaptic) opts.onHaptic();
      if (opts.onOpen) opts.onOpen(d.id);
    }

    function rowAt(index) {
      if (rows[index]) return rows[index];
      const row = el('div', { class: 'sc-row' });
      const icon = el('span', { class: 'sc-icon' }, row);
      const r = { row, icon, name: el('span', { class: 'sc-name', dir: 'auto' }, row), glyph: null };
      onTap(row, () => open(index));
      rows[index] = r;
      return r;
    }

    let lastHeight = 0;
    function render() {
      for (let i = rows.length - 1; i >= dashboards.length; i--) { rows[i].row.remove(); rows.pop(); }
      let placed = null;
      dashboards.forEach((d, i) => {
        const r = rowAt(i);
        // Keeps the order, moving only what is out of place: a moved node loses the focus of a field in it.
        const want = placed ? placed.nextSibling : grid.firstChild;
        if (r.row !== want) grid.insertBefore(r.row, want);
        placed = r.row;
        const look = looks[i] || { color: 'blue', icon: 'dashboard' };
        if (r.glyph !== look.icon) {
          r.glyph = look.icon;
          r.icon.replaceChildren(glyph(ICONS[look.icon], 'sc-glyph'));
        }
        const here = !d.missing && d.id === current;
        const name = d.missing ? t('missing') : typed.name(d.id, d.name);
        r.row.dataset.color = look.color;
        r.row.classList.toggle('missing', !!d.missing);
        r.row.classList.toggle('current', here);
        r.name.textContent = name;
        r.row.title = d.missing ? '' : here ? `${name} · ${t('current')}` : name;
        // Only a tile that opens something is a link: not a missing one, the one it's on, or one being renamed.
        const link = !d.missing && !here && !typed.renaming;
        if (link) {
          r.row.setAttribute('role', 'link');
          r.row.tabIndex = 0;
        } else {
          r.row.removeAttribute('role');
          r.row.removeAttribute('tabindex');
        }
        if (here) r.row.setAttribute('aria-current', 'page');
        else r.row.removeAttribute('aria-current');
        r.row.setAttribute('aria-label', name);
        if (typed.renaming && !d.missing) {
          const field = typed.field(d.id, d.name);
          if (field.previousSibling !== r.name) r.name.after(field);
        }
      });
      grid.style.display = dashboards.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && dashboards.length > 0);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    return { setState, setNames: typed.set, setMessage, render, t };
  }

  window.createShortcutsWidget = createShortcutsWidget;
})();
