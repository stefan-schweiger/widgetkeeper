/*
 * Curtains: curtain and blind tiles, two per row. A tap on the tile does what its corner says (Open or
 * Close; while it moves, the other way), so a half-open curtain never leaves you guessing; the bar at the
 * bottom sets the position (0 = closed, 1 = open). Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const OPTIMISTIC_MS = 10e3; // how long a changed tile shows its new value while waiting for the device
  const PENDING_MS = 60e3; // a curtain sent somewhere counts as moving until it gets there, at most this long
  // A position this close to 0 or 1 counts as closed or open: some curtains stop at 1 % and 99 % (a user's SwitchBots).
  const END = 0.05;
  const TAP_SLOP = 10; // px a finger may move and still count as a tap

  const DEFAULT_STRINGS = {
    selectDevices: 'Select curtains in the widget settings.',
    error: 'Could not load the curtains.',
    failed: 'Could not change __name__.',
    unavailable: 'Unavailable',
    isOpen: 'Open',
    isClosed: 'Closed',
    percentOpen: '__percent__% open',
    opening: 'Opening…',
    closing: 'Closing…',
    stopped: 'Stopped',
    open: 'Open',
    close: 'Close',
  };

  /**
   * The corner pill's glyph: filled triangles in the direction the curtain will move: apart (open) or
   * together (close), or for blinds one up (open) or down (close).
   */
  const TRIANGLES = {
    curtain: { open: 'M1 10l6-5v10zM19 10l-6-5v10z', close: 'M8 10L2 5v10zM12 10l6-5v10z' },
    blinds: { open: 'M10 4l7 9H3z', close: 'M10 16l7-9H3z' },
  };
  function actionGlyph(kind, action) {
    const d = (TRIANGLES[kind] || TRIANGLES.curtain)[action];
    return `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${d}" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const clamp01 = x => Math.min(1, Math.max(0, x));
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : null);

  /**
   * What a tap on a tile does: `open`, `close` or null (nothing it can do). A moving curtain turns round
   * (the user's choice over a stop).
   * `c.position` is 0–1 or null (unknown), `c.moving` 1 (opening), -1 (closing) or 0, `c.closed` a boolean
   * or null, `c.lastDir` the last direction it moved (1, -1 or 0).
   * `rule` decides for a curtain in between: `nearer` (the default) goes to the nearer end, `reverse`
   * reverses its last move, like a one-button remote.
   * @param {{position: number | null, moving: number, closed: boolean | null, lastDir: number, canMove?: boolean}} c
   * @param {string} [rule]
   */
  function curtainAction(c, rule) {
    if (c.canMove === false) return null;
    if (c.moving) return c.moving > 0 ? 'close' : 'open';
    const p = c.position;
    if (p == null) {
      if (c.closed === true) return 'open';
      if (c.closed === false) return 'close';
      return c.lastDir > 0 ? 'close' : 'open';
    }
    if (p >= 1 - END) return 'close';
    if (p <= END) return 'open';
    if (rule === 'reverse' && c.lastDir) return c.lastDir > 0 ? 'close' : 'open';
    return p > 0.5 ? 'close' : 'open';
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

  function svgEl(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (parent) parent.appendChild(node);
    return node;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string,
   *   onSet?: (deviceId: string, change: {action?: string, position?: number}) => Promise<any>,
   *   onHeight?: (h: number) => void, groupByZone?: boolean, between?: string, invert?: boolean, showState?: boolean }} opts
   */
  function createCurtainsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`curtains.${key}`, tokens) : null;
      if (s && s !== `curtains.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const rule = opts.between === 'reverse' ? 'reverse' : 'nearer';
    /**
     * Homey's position is 1 = open, but some drivers (SwitchBot's curtains) report 0 = open and 1 = closed; the
     * `invert` setting flips it. The widget works in open-ness (1 = open): `pos()` turns a device's position
     * into that and back.
     */
    const invert = opts.invert === true;
    const pos = v => (invert ? 1 - v : v);

    let devices = []; // [{ id, name, kind, zone, caps } | { id, missing }]
    /**
     * The tiles: one per curtain, or with `groupByZone` one per room that has two or more of them, placed
     * where its first curtain is. `id` is the curtain's id or `zone:<zoneId>`.
     * @type {({id: string, name: string, kind: string, members: any[]} | {id: string, missing: true})[]}
     */
    let items = [];
    const optimistic = new Map(); // `${deviceId}:${capabilityId}` → { value, until }
    /** Where a curtain was sent: deviceId → { value (0–1), dir (1 open, -1 close), until }. */
    const pending = new Map();
    /** The direction each curtain last moved: 1 (opening) or -1 (closing). */
    const lastDir = new Map();
    const drags = new Map(); // tile id → fraction, while a finger or the mouse is on the bar
    let messageText = null;
    let messageTimer = null;
    let lastTouchTap = 0;

    root.classList.add('ct');
    // The state under the name (Open, 42% open, Opening…): on unless `showState` is false.
    root.classList.toggle('ct-no-state', opts.showState === false);
    const grid = el('div', { class: 'ct-grid' }, root);
    const messageEl = el('div', { class: 'ct-message', dir: 'auto' }, root);
    /** @type {Map<string, {tile: HTMLElement, icon: SVGSVGElement, act: HTMLElement, name: HTMLElement,
     *   state: HTMLElement, bar: HTMLElement}>} */
    const tiles = new Map();

    function setState(list) {
      devices = Array.isArray(list) ? list : [];
      messageText = null;
      render();
    }

    function pushChange({ deviceId, capabilityId, value }) {
      const d = devices.find(x => x.id === deviceId);
      if (!d || !d.caps || !d.caps[capabilityId]) return;
      const old = d.caps[capabilityId].value;
      d.caps[capabilityId].value = value;
      // Any report replaces what was hoped for: a curtain reports where it is, also on its way.
      optimistic.delete(`${deviceId}:${capabilityId}`);
      if (capabilityId === 'windowcoverings_state') {
        if (value === 'up') lastDir.set(deviceId, 1);
        else if (value === 'down') lastDir.set(deviceId, -1);
        else if (value === 'idle') pending.delete(deviceId);
      } else if (capabilityId === 'windowcoverings_set') {
        if (typeof old === 'number' && typeof value === 'number' && value !== old) lastDir.set(deviceId, pos(value) > pos(old) ? 1 : -1);
        // There: the motor state hoped for on the tap no longer counts.
        const p = pending.get(deviceId);
        if (p && typeof value === 'number' && Math.abs(pos(value) - p.value) <= END) optimistic.delete(`${deviceId}:windowcoverings_state`);
      } else if (capabilityId === 'windowcoverings_closed') {
        pending.delete(deviceId);
        if (typeof value === 'boolean') lastDir.set(deviceId, value ? -1 : 1);
      }
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

    /** A capability's value, or the one just sent while the device hasn't confirmed it. */
    function shown(d, capabilityId) {
      const key = `${d.id}:${capabilityId}`;
      const o = optimistic.get(key);
      if (o && Date.now() < o.until) return o.value;
      optimistic.delete(key);
      return d.caps[capabilityId] ? d.caps[capabilityId].value : null;
    }

    const settable = (d, id) => !!d.caps[id] && d.caps[id].setable !== false;

    /** One curtain as `curtainAction()` sees it. */
    function view(d) {
      const raw = d.caps.windowcoverings_set ? num(shown(d, 'windowcoverings_set')) : null;
      const position = raw == null ? null : pos(raw);
      const motor = d.caps.windowcoverings_state ? shown(d, 'windowcoverings_state') : null;
      const closedValue = d.caps.windowcoverings_closed ? shown(d, 'windowcoverings_closed') : null;
      let moving = motor === 'up' ? 1 : motor === 'down' ? -1 : 0;
      const p = pending.get(d.id);
      if (p && Date.now() >= p.until) pending.delete(d.id);
      else if (p && !moving && !(position != null && Math.abs(position - p.value) <= END)) moving = p.dir;
      const closed = typeof closedValue === 'boolean' ? closedValue : position != null ? position <= END : null;
      return {
        position,
        moving,
        closed,
        lastDir: lastDir.get(d.id) || 0,
        canMove: ['windowcoverings_set', 'windowcoverings_state', 'windowcoverings_closed'].some(id => settable(d, id)),
        target: p && moving ? p.value : null,
      };
    }

    /** A tile's view: one curtain's, or a room's (the average position, moving when any is). */
    function itemView(item) {
      const vs = item.members.map(view);
      const withPos = vs.filter(v => v.position != null);
      const avg = list => list.reduce((s, x) => s + x, 0) / list.length;
      const movingOne = vs.find(v => v.moving);
      const targets = vs.filter(v => v.target != null).map(v => v.target);
      return {
        position: withPos.length ? avg(withPos.map(v => v.position)) : null,
        moving: movingOne ? movingOne.moving : 0,
        closed: vs.every(v => v.closed === true) ? true : vs.some(v => v.closed === false) ? false : null,
        lastDir: (vs.find(v => v.lastDir) || { lastDir: 0 }).lastDir,
        canMove: vs.some(v => v.canMove),
        target: targets.length ? avg(targets) : null,
      };
    }

    function stateText(v) {
      if (v.moving) return t(v.moving > 0 ? 'opening' : 'closing');
      if (v.position != null) {
        if (v.position >= 1 - END) return t('isOpen');
        if (v.position <= END) return t('isClosed');
        return t('percentOpen', { percent: Math.round(v.position * 100) });
      }
      if (v.closed != null) return t(v.closed ? 'isClosed' : 'isOpen');
      return t('stopped');
    }

    /** Sends one curtain's change; a failure shakes its tile (`item`) and shows a message. */
    async function send(item, d, change) {
      if (!opts.onSet) return;
      try {
        await opts.onSet(d.id, change);
      } catch (err) {
        console.error(err);
        pending.delete(d.id);
        for (const id of ['windowcoverings_set', 'windowcoverings_state', 'windowcoverings_closed']) optimistic.delete(`${d.id}:${id}`);
        const tile = tiles.get(item.id);
        if (tile) {
          tile.tile.classList.remove('shake');
          void tile.tile.offsetWidth; // restart the animation
          tile.tile.classList.add('shake');
        }
        setMessage(t('failed', { name: d.name }), true);
      }
    }

    /** The tile with this id, if it shows curtains. */
    function itemOf(id) {
      const item = items.find(x => x.id === id);
      return item && 'members' in item ? item : null;
    }

    function expectMove(d, value, dir) {
      pending.set(d.id, { value, dir, until: Date.now() + PENDING_MS });
      lastDir.set(d.id, dir);
      setTimeout(render, PENDING_MS + 50);
    }

    /** A tap on a tile: what its corner says, for every curtain on it. */
    function tap(id) {
      const item = itemOf(id);
      if (!item) return;
      const action = curtainAction(itemView(item), rule);
      if (!action) return;
      const changes = [];
      for (const d of item.members) {
        if (!view(d).canMove) continue;
        const open = action === 'open';
        // With a position, the widget sends the end itself, so `invert` applies; else the app picks the motor or open/closed.
        changes.push([d, settable(d, 'windowcoverings_set') ? { position: pos(open ? 1 : 0) } : { action }]);
        if (!d.caps.windowcoverings_set && !settable(d, 'windowcoverings_state')) {
          // Only open/closed: it's there as soon as the device says so.
          optimistic.set(`${d.id}:windowcoverings_closed`, { value: !open, until: Date.now() + OPTIMISTIC_MS });
          lastDir.set(d.id, open ? 1 : -1);
        } else {
          // Also while it moves the other way: the motor's `up`/`down` is hoped over until it reports.
          if (d.caps.windowcoverings_state) optimistic.set(`${d.id}:windowcoverings_state`, { value: open ? 'up' : 'down', until: Date.now() + OPTIMISTIC_MS });
          expectMove(d, open ? 1 : 0, open ? 1 : -1);
        }
      }
      setTimeout(render, OPTIMISTIC_MS + 50);
      render();
      for (const [d, change] of changes) send(item, d, change);
    }

    /** The bar was let go at `x` (0–1): the position of every curtain on the tile that has one. */
    function commit(id, x) {
      const item = itemOf(id);
      if (!item) return;
      const value = Math.round(clamp01(x) * 100) / 100;
      const changes = [];
      for (const d of item.members) {
        if (!settable(d, 'windowcoverings_set')) continue;
        const from = view(d).position;
        if (from != null && Math.abs(from - value) <= END / 2) continue;
        expectMove(d, value, from != null && value < from ? -1 : 1);
        changes.push(d);
      }
      render();
      for (const d of changes) send(item, d, { position: pos(value) });
    }

    /**
     * Taps on the tile body: a touch that ends within TAP_SLOP, or a click. Drags scroll the dashboard.
     * `stop` keeps a control's taps (and keys) from also reaching the tile around it.
     */
    function onTap(node, fn, { stop = false } = {}) {
      let start = null;
      const unpress = () => { start = null; node.classList.remove('pressing'); };
      node.addEventListener('touchstart', (e) => {
        if (stop) e.stopPropagation();
        const p = e.changedTouches[0];
        start = { x: p.clientX, y: p.clientY };
        node.classList.add('pressing');
      }, { passive: true });
      node.addEventListener('touchmove', (e) => {
        const p = e.changedTouches[0];
        if (start && Math.hypot(p.clientX - start.x, p.clientY - start.y) > TAP_SLOP) unpress();
      }, { passive: true });
      node.addEventListener('touchend', (e) => {
        const isTap = !!start;
        unpress();
        // Every touch: one that moved past TAP_SLOP can still get the browser's click.
        lastTouchTap = Date.now();
        if (!isTap) return;
        e.preventDefault(); // no click after it
        if (stop) e.stopPropagation();
        fn();
      });
      node.addEventListener('touchcancel', unpress);
      node.addEventListener('click', (e) => {
        if (stop) e.stopPropagation();
        if (Date.now() - lastTouchTap < 800) return;
        fn();
      });
      node.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (stop) e.stopPropagation();
        fn();
      });
    }

    /**
     * The bar: a drag sets the value live and sends it when let go; a tap sets it where it lands. The
     * touches are taken (preventDefault, touch-action: none) so iOS doesn't scroll the dashboard. Homey's
     * Android app takes the touch anyway after about 100 ms (touchcancel): that gesture is dropped, but a
     * quick tap still gets through. As Light Controls' bar.
     */
    function wireBar(id, bar) {
      const at = clientX => {
        const r = bar.getBoundingClientRect();
        return r.width ? clamp01((clientX - r.left) / r.width) : 0;
      };
      const move = (clientX) => {
        drags.set(id, at(clientX));
        render();
      };
      const end = (commitIt) => {
        if (!drags.has(id)) return;
        const x = drags.get(id);
        drags.delete(id);
        bar.classList.remove('dragging');
        if (commitIt) commit(id, x);
        else render();
      };
      bar.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        bar.classList.add('dragging');
        move(e.changedTouches[0].clientX);
      }, { passive: false });
      bar.addEventListener('touchmove', (e) => {
        e.preventDefault();
        move(e.changedTouches[0].clientX);
      }, { passive: false });
      bar.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        lastTouchTap = Date.now();
        end(true);
      });
      bar.addEventListener('touchcancel', () => end(false));
      // Mouse (and pen): pointer events with capture, ignored for touch (handled above).
      bar.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return;
        e.preventDefault();
        if (bar.setPointerCapture) bar.setPointerCapture(e.pointerId);
        bar.classList.add('dragging');
        move(e.clientX);
      });
      bar.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch' || !drags.has(id)) return;
        move(e.clientX);
      });
      bar.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'touch') return;
        end(true);
      });
      bar.addEventListener('pointercancel', (e) => {
        if (e.pointerType === 'touch') return;
        end(false);
      });
      bar.addEventListener('click', e => e.stopPropagation()); // not a tap on the tile
    }

    /**
     * The icon, drawn at the curtain's position: a rod with two drapes that part as it opens, or for blinds
     * a panel that rises. Unknown positions are drawn half open.
     */
    function makeIcon(parent) {
      const icon = svgEl('svg', { class: 'ct-icon', viewBox: '0 0 20 20', 'aria-hidden': 'true' }, parent);
      svgEl('path', { d: 'M1.5 2.5h17', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', fill: 'none' }, icon);
      svgEl('rect', { class: 'ct-drape-l', x: 2, y: 4, width: 8, height: 13.5, rx: 1, fill: 'currentColor' }, icon);
      svgEl('rect', { class: 'ct-drape-r', x: 10, y: 4, width: 8, height: 13.5, rx: 1, fill: 'currentColor' }, icon);
      return icon;
    }

    function drawIcon(icon, kind, openness) {
      const l = icon.querySelector('.ct-drape-l');
      const r = icon.querySelector('.ct-drape-r');
      if (kind === 'blinds') {
        const h = 2 + (1 - openness) * 11.5;
        l.setAttribute('x', '2'); l.setAttribute('width', '16'); l.setAttribute('height', h.toFixed(2));
        r.setAttribute('width', '0');
        return;
      }
      const w = 2.5 + (1 - openness) * 5.5; // 8 wide closed, 2.5 open
      l.setAttribute('x', '2'); l.setAttribute('width', w.toFixed(2)); l.setAttribute('height', '13.5');
      r.setAttribute('x', (18 - w).toFixed(2)); r.setAttribute('width', w.toFixed(2));
    }

    function tileFor(id) {
      let tile = tiles.get(id);
      if (!tile) {
        const node = el('div', { class: 'ct-tile', 'data-device': id, role: 'group', tabindex: '0' });
        const top = el('div', { class: 'ct-top' }, node);
        const icon = makeIcon(top);
        const act = el('span', { class: 'ct-act' }, top);
        const name = el('span', { class: 'ct-name', dir: 'auto' }, node);
        const state = el('span', { class: 'ct-state', dir: 'auto' }, node);
        const bar = el('div', { class: 'ct-bar', role: 'slider', 'aria-valuemin': '0', 'aria-valuemax': '100' }, node);
        const track = el('div', { class: 'ct-track' }, bar);
        el('div', { class: 'ct-fill' }, track);
        el('div', { class: 'ct-target' }, bar);
        el('div', { class: 'ct-knob' }, bar);
        tile = { tile: node, icon, act, name, state, bar };
        onTap(node, () => tap(id));
        wireBar(id, bar);
        tiles.set(id, tile);
      }
      return tile;
    }

    /** The tiles for the curtains, grouped by room with `groupByZone`. */
    function buildItems() {
      const usable = d => !('missing' in d) && d.caps && Object.keys(d.caps).length > 0;
      const rooms = new Map(); // zone id → its usable curtains
      if (opts.groupByZone) {
        for (const d of devices) {
          if (!usable(d) || !d.zone) continue;
          if (!rooms.has(d.zone.id)) rooms.set(d.zone.id, []);
          rooms.get(d.zone.id).push(d);
        }
      }
      const out = [];
      const placed = new Set();
      for (const d of devices) {
        if (!usable(d)) { out.push({ id: d.id, missing: true }); continue; }
        const room = d.zone ? rooms.get(d.zone.id) : null;
        if (room && room.length > 1) {
          if (placed.has(d.zone.id)) continue;
          placed.add(d.zone.id);
          out.push({ id: `zone:${d.zone.id}`, name: d.zone.name, kind: room[0].kind, members: room });
        } else {
          out.push({ id: d.id, name: d.name, kind: d.kind, members: [d] });
        }
      }
      return out;
    }

    let lastHeight = 0;
    function render() {
      items = buildItems();
      const ids = new Set(items.map(d => d.id));
      for (const [id, tile] of tiles) {
        if (!ids.has(id)) { tile.tile.remove(); tiles.delete(id); }
      }
      let prev = null;
      for (const item of items) {
        const tile = tileFor(item.id);
        // Keeps the settings' order. Only moves a tile that is out of place: moving it would drop the
        // bar's pointer capture during a drag.
        const want = prev ? prev.nextSibling : grid.firstChild;
        if (tile.tile !== want) grid.insertBefore(tile.tile, want);
        prev = tile.tile;
        if (!('members' in item)) {
          for (const c of ['open', 'moving', 'heading', 'no-position']) tile.tile.classList.remove(c);
          tile.tile.classList.add('missing');
          tile.name.textContent = t('unavailable');
          tile.state.textContent = '';
          tile.act.style.display = 'none';
          tile.act.removeAttribute('data-action');
          drawIcon(tile.icon, 'curtain', 0);
          tile.tile.style.setProperty('--ct-x', '0');
          continue;
        }
        const v = itemView(item);
        const drag = drags.get(item.id);
        const x = drag != null ? drag : v.position != null ? v.position : 0;
        const action = curtainAction(v, rule);
        const hasPosition = item.members.some(d => settable(d, 'windowcoverings_set'));
        const openness = v.position != null ? v.position : v.closed === true ? 0 : v.closed === false ? 1 : 0.5;

        tile.tile.classList.remove('missing');
        tile.tile.classList.toggle('open', v.closed === false || (v.position != null && v.position > END));
        tile.tile.classList.toggle('moving', !!v.moving);
        tile.tile.classList.toggle('no-position', !hasPosition);
        tile.name.textContent = item.name;
        tile.state.textContent = drag != null ? t('percentOpen', { percent: Math.round(drag * 100) }) : stateText(v);
        if (tile.act.getAttribute('data-action') !== action || tile.act.getAttribute('data-kind') !== item.kind) {
          if (action) {
            tile.act.setAttribute('data-action', action);
            tile.act.setAttribute('data-kind', item.kind);
            tile.act.innerHTML = `${actionGlyph(item.kind, action)}<span></span>`;
            tile.act.lastElementChild.textContent = t(action);
          } else {
            tile.act.removeAttribute('data-action');
            tile.act.textContent = '';
          }
        }
        tile.act.style.display = action ? '' : 'none';
        // A group, not a button: it holds the slider, which has its own role.
        tile.tile.setAttribute('aria-label', `${item.name}: ${action ? t(action) : stateText(v)}`);
        tile.bar.setAttribute('aria-label', item.name);
        drawIcon(tile.icon, item.kind, openness);
        tile.tile.style.setProperty('--ct-x', String(x));
        tile.tile.style.setProperty('--ct-target', String(v.target != null ? v.target : x));
        tile.tile.classList.toggle('heading', v.target != null && drag == null);
        tile.bar.setAttribute('aria-valuenow', String(Math.round(x * 100)));
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

  window.createCurtainsWidget = createCurtainsWidget;
  window.curtainAction = curtainAction;
})();
