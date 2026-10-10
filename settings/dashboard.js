/*
 * The web dashboards page (`settings/dashboard.html`): our widgets in any browser on the home network, laid out
 * on the page itself. Served by the Homey at `/app/<appId>/settings/dashboard.html`, with no login; everything it
 * reads or changes goes through the app's API with the personal API key the user pastes (kept in this browser).
 *
 * Each widget runs in an iframe of its own, unchanged `index.html` (`../widgets/<id>/index.html`, into which the
 * Homey puts its widget SDK, as on a Homey dashboard). The SDK talks to its parent frame with Homey's crossframe
 * messages (`CF2_MESSAGE` + UTF-16 hex JSON, `{type: 'tx', event, data, callbackId}`, answered by
 * `{type: 'cb', args: [err, result], callbackId}`), so this page answers them as Homey's dashboard does:
 * `getInitialData` (the widget's settings, devices, strings, dark mode), `api` (through the app's `/web/call`, to
 * the widget's own API), `registerRealtimeListener` (our app's realtime events, from Homey's realtime socket),
 * `ready`/`setHeight` (the frame's height), `popup` and `shortPressHapticFeedback`.
 */
(function () {
  'use strict';

  /** English, also the fallback while the app's strings haven't loaded (they're `web.*` in locales/<lang>.json). */
  const DEFAULT_STRINGS = {
    title: 'Web dashboards',
    keyTitle: 'Connect to your Homey',
    keyText: 'Paste a personal API key. Make one in the Homey web app under Settings → API Keys. It stays in this browser.',
    keyPlaceholder: 'API key',
    connect: 'Connect',
    keyRejected: 'Homey didn\'t accept this key.',
    forgetKey: 'Forget the key',
    loadFailed: 'Could not reach Widgetkeeper on your Homey.',
    retry: 'Try again',
    off: 'Web dashboards are turned off. Turn them on in the Widgetkeeper app settings in the Homey app.',
    noDashboards: 'No dashboards yet.',
    newDashboard: 'New dashboard',
    untitled: 'Dashboard',
    widgetCount: '__count__ widgets',
    dashboards: 'Dashboards',
    missing: 'This dashboard no longer exists.',
    edit: 'Edit',
    done: 'Done',
    fullScreen: 'Full screen',
    noLive: 'No live updates',
    name: 'Name',
    columns: 'Columns',
    theme: 'Theme',
    themeAuto: 'Automatic',
    themeDark: 'Dark',
    themeLight: 'Light',
    deleteDashboard: 'Delete dashboard',
    tapAgain: 'Tap again to confirm',
    addWidget: 'Add widget',
    chooseWidget: 'Choose a widget',
    settings: 'Settings',
    moveUp: 'Move up',
    moveDown: 'Move down',
    moveLeft: 'Move left',
    moveRight: 'Move right',
    drag: 'Drag to move',
    remove: 'Remove',
    widgetTitle: 'Title',
    widgetTitleHint: 'Shown above the widget. Leave it empty for none.',
    devices: 'Devices',
    device: 'Device',
    search: 'Search',
    noDevices: 'No matching devices.',
    choose: 'Choose…',
    clear: 'Clear',
    nothingFound: 'Nothing found.',
    save: 'Save',
    cancel: 'Cancel',
    saveFailed: 'Could not save the dashboard.',
  };

  const KEY_STORAGE = 'widgetkeeper.web.key';
  const PREFIX = 'CF2_MESSAGE';
  const ACK_TIMEOUT_MS = 10e3;
  /** After a realtime outage this long, the frames reload: they may have missed changes (they re-read every 5 min). */
  const STALE_AFTER_MS = 30e3;
  const CONFIRM_MS = 3000;
  /** A press on a widget's bar that moves this far is a drag. */
  const DRAG_SLOP = 6;
  /** Near the window's top or bottom edge, a drag scrolls the page. */
  const EDGE_PX = 64;

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  /** An element with a class and text. */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(className, text, onClick, label) {
    const b = el('button', className, text);
    b.type = 'button';
    if (label) { b.title = label; b.setAttribute('aria-label', label); }
    b.addEventListener('click', onClick);
    return b;
  }

  /** A button that needs a second tap within 3 s (no browser dialog, which would block a wall tablet). */
  function confirmButton(className, text, onConfirm, confirmText, label) {
    let armed = 0;
    const b = button(className, text, () => {
      if (Date.now() - armed < CONFIRM_MS) { onConfirm(); return; }
      armed = Date.now();
      b.classList.add('armed');
      b.textContent = confirmText;
      setTimeout(() => {
        if (!b.isConnected) return;
        b.classList.remove('armed');
        b.textContent = text;
      }, CONFIRM_MS);
    }, label);
    return b;
  }

  function hexEncode(input) {
    let out = '';
    for (let i = 0; i < input.length; i++) out += ('000' + input.charCodeAt(i).toString(16)).slice(-4);
    return out;
  }
  function hexDecode(input) {
    let out = '';
    for (const hex of input.match(/.{1,4}/g) || []) out += String.fromCharCode(parseInt(hex, 16));
    return out;
  }

  /** The bar's icons: 24 px paths, stroked in the text colour. */
  const ICONS = {
    pen: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4zM13.5 6.5l4 4',
    fullScreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  };

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const clone = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

  /** The app id from this page's path (`/app/<appId>/settings/dashboard.html`). */
  const APP_ID = (location.pathname.match(/\/app\/([^/]+)\//) || [])[1] || 'com.thomassidor.widgetkeeper';

  window.mountWebDashboards = function (root) {
    let key = storageGet(KEY_STORAGE);
    let setup = null; // `/web/setup`: {appId, homeyId, language, strings, widgets, dashboards}
    let types = new Map(); // widget id → its type (name, settings, devices …)
    let dashboards = [];
    let current = null; // {dashboard, editing, grid, columns: Map<widget id, {el, sig}>}
    let live = false;
    let socketStarted = false;
    const frames = new Set(); // {widget, iframe, subs: Map<callbackId, event>}
    const listeners = new Map(); // realtime event → Set<fn>
    const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function t(name, tokens) {
      const strings = setup && setup.strings && setup.strings.web;
      let s = (strings && typeof strings[name] === 'string' && strings[name]) || DEFAULT_STRINGS[name] || name;
      for (const k in tokens || {}) s = s.split(`__${k}__`).join(String(tokens[k]));
      return s;
    }

    // ---- The app's API, with the key ------------------------------------------------------------------------

    async function request(method, path, body) {
      const headers = { Authorization: `Bearer ${key}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`/api/app/${APP_ID}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (res.status === 401 || res.status === 403) {
        throw Object.assign(new Error((data && data.error) || `HTTP ${res.status}`), { unauthorized: true });
      }
      if (!res.ok) throw new Error((data && (data.error || data.message)) || (typeof data === 'string' && data) || `HTTP ${res.status}`);
      return data;
    }

    async function loadSetup() {
      setup = await request('GET', '/web/setup');
      types = new Map((setup.widgets || []).map(w => [w.type, w]));
      dashboards = setup.dashboards || [];
      if (setup.language) document.documentElement.lang = setup.language;
      if (setup.disabled) return; // turned off in the app settings: `route()` says so
      if (!socketStarted) {
        socketStarted = true;
        connectSocket();
      }
    }

    // ---- Realtime: Homey's socket (socket.io v2), as homey-api connects ------------------------------------

    let socketGen = 0;
    let retryMs = 2000;
    let lostAt = null;
    let activeSocket = null;

    /** Closes the socket and stops its retries (a rejected key). */
    function stopSocket() {
      socketGen++;
      socketStarted = false;
      retryMs = 2000;
      if (activeSocket) { try { activeSocket.close(); } catch (e) { /* closed */ } }
      activeSocket = null;
    }

    function ack(socket, event, data) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${event}: timeout`)), ACK_TIMEOUT_MS);
        socket.emit(event, data, (err, result) => {
          clearTimeout(timer);
          if (err != null) reject(err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err)));
          else resolve(result);
        });
      });
    }

    function waitFor(socket, event) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${event}: timeout`)), ACK_TIMEOUT_MS);
        socket.once(event, () => { clearTimeout(timer); resolve(undefined); });
      });
    }

    /**
     * Connects to the Homey's realtime socket with the key: `handshakeClient {token, homeyId}` names a namespace
     * (`/api`), where `subscribe` to `homey:app:<appId>` brings our app's `homey.api.realtime()` events. Any failure
     * or disconnect starts over after a growing pause.
     */
    async function connectSocket() {
      if (typeof window.io !== 'function' || !setup) return;
      const gen = ++socketGen;
      const socket = window.io(location.origin, { transports: ['websocket'], autoConnect: false, reconnection: false, forceNew: true });
      activeSocket = socket;
      let failed = false;
      const fail = (why) => {
        if (failed || gen !== socketGen) return;
        failed = true;
        console.warn('Realtime:', why && why.message ? why.message : why);
        try { socket.close(); } catch (e) { /* closed */ }
        setLive(false);
        if (lostAt == null) lostAt = Date.now();
        setTimeout(connectSocket, retryMs);
        retryMs = Math.min(retryMs * 2, 60e3);
      };
      try {
        const connected = waitFor(socket, 'connect');
        socket.open();
        await connected;
        const res = await ack(socket, 'handshakeClient', { token: key, homeyId: setup.homeyId });
        const ns = socket.io.socket(res && res.namespace ? res.namespace : '/api');
        const uri = `homey:app:${APP_ID}`;
        ns.on(uri, (event, data) => dispatch(event, data));
        if (!ns.connected) {
          const nsConnected = waitFor(ns, 'connect');
          ns.open();
          await nsConnected;
        }
        await ack(ns, 'subscribe', uri);
        socket.on('disconnect', () => fail('disconnected'));
        ns.on('disconnect', () => fail('namespace disconnected'));
        if (failed) return;
        if (gen !== socketGen) { socket.close(); return; } // stopped meanwhile
        retryMs = 2000;
        setLive(true);
        if (lostAt != null && Date.now() - lostAt > STALE_AFTER_MS) reloadFrames();
        lostAt = null;
      } catch (err) {
        fail(err);
      }
    }

    function setLive(on) {
      live = on;
      for (const node of root.querySelectorAll('.wd-live')) /** @type {HTMLElement} */ (node).hidden = on;
    }

    function dispatch(event, data) {
      for (const fn of listeners.get(event) || []) {
        try { fn(data); } catch (e) { console.error(e); }
      }
    }

    // ---- The widget frames: Homey's crossframe protocol, parent side ----------------------------------------

    function post(frame, message) {
      const win = frame.iframe.contentWindow;
      if (win) win.postMessage(PREFIX + hexEncode(JSON.stringify(message)), location.origin);
    }

    function reply(frame, callbackId, err, result) {
      if (callbackId == null) return;
      const error = err ? { type: 'Error', data: String(err && err.message ? err.message : err) } : null;
      post(frame, { type: 'cb', args: [error, result === undefined ? null : result], callbackId });
    }

    function isDark() {
      const theme = current && current.dashboard.theme;
      if (theme === 'dark') return true;
      if (theme === 'light') return false;
      return !!(darkQuery && darkQuery.matches);
    }

    function setFrameHeight(frame, height) {
      const h = Number(height);
      if (Number.isFinite(h) && h >= 0) frame.iframe.style.height = `${Math.ceil(h)}px`;
    }

    function handle(frame, msg) {
      const id = msg.callbackId;
      const w = frame.widget;
      const def = types.get(w.type);
      switch (msg.event) {
        case 'getInitialData':
          // A new document in the frame (it reloads when it's moved): the old one's listeners and pending answers go.
          dropListeners(frame);
          frame.gen++;
          reply(frame, id, null, {
            settings: clone(w.settings || {}),
            deviceIds: (w.deviceIds || []).slice(),
            transparent: !!(def && def.transparent),
            locales: (setup && setup.strings) || {},
            language: (setup && setup.language) || 'en',
            devmode: false,
            fontScale: 1,
            isDarkMode: isDark(),
          });
          break;
        case 'ready':
          if (msg.data && msg.data.height != null) setFrameHeight(frame, msg.data.height);
          reply(frame, id, null, null);
          break;
        case 'setHeight':
          setFrameHeight(frame, msg.data && msg.data.height);
          reply(frame, id, null, null);
          break;
        case 'api': {
          const data = msg.data || {};
          const [path, qs] = String(data.path || '').split('?');
          const query = {};
          new URLSearchParams(qs || '').forEach((v, k) => { query[k] = v; });
          // The page's key goes along: a route that acts with the app's stored key checks that this key may too.
          const gen = frame.gen;
          request('POST', '/web/call', { type: w.type, method: String(data.method || 'GET').toUpperCase(), path, query, body: data.body == null ? {} : data.body, key })
            .then(result => { if (frame.gen === gen) reply(frame, id, null, result); }, err => { if (frame.gen === gen) reply(frame, id, err); });
          break;
        }
        case 'registerRealtimeListener': {
          const event = String(msg.data || '');
          const fn = (data) => post(frame, { type: 'cb', args: [data], callbackId: id });
          frame.subs.set(id, { event, fn });
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event).add(fn);
          break;
        }
        case 'popup':
          if (msg.data && typeof msg.data.url === 'string') window.open(msg.data.url, '_blank', 'noopener');
          reply(frame, id, null, null);
          break;
        case 'shortPressHapticFeedback':
          try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) { /* not on every browser */ }
          reply(frame, id, null, null);
          break;
        case 'emit':
          reply(frame, id, null, null);
          break;
        default:
          reply(frame, id, new Error(`Not supported here: ${msg.event}`));
      }
    }

    window.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data.indexOf(PREFIX) !== 0) return;
      let frame = null;
      for (const f of frames) if (f.iframe.contentWindow === e.source) { frame = f; break; }
      if (!frame) return;
      let msg;
      try { msg = JSON.parse(hexDecode(e.data.slice(PREFIX.length))); } catch (err) { return; }
      if (msg && msg.type === 'tx') handle(frame, msg);
    });

    function dropListeners(frame) {
      for (const { event, fn } of frame.subs.values()) {
        const set = listeners.get(event);
        if (set) set.delete(fn);
      }
      frame.subs.clear();
    }

    /** Forgets the frames no longer on the page, with their realtime listeners. */
    function sweepFrames() {
      for (const frame of [...frames]) {
        if (frame.iframe.isConnected) continue;
        dropListeners(frame);
        frames.delete(frame);
      }
    }

    function reloadFrames() {
      if (!current) return;
      current.widgets.clear();
      syncGrid();
    }

    // ---- Views ---------------------------------------------------------------------------------------------

    /** The browser title: `Widgetkeeper - <dashboard name>` on a dashboard, else `Widgetkeeper`. */
    function setTitle(dashboard) {
      document.title = dashboard ? `Widgetkeeper - ${dashboard.name || t('untitled')}` : 'Widgetkeeper';
    }

    function clearRoot() {
      if (drag) endDrag(false);
      setTitle(null);
      root.classList.remove('editing');
      root.textContent = '';
      current = null;
      sweepFrames();
    }

    function applyTheme(theme) {
      const dark = theme === 'dark' || (theme !== 'light' && !!(darkQuery && darkQuery.matches));
      document.documentElement.classList.toggle('homey-dark-mode', dark);
    }

    if (darkQuery && darkQuery.addEventListener) {
      darkQuery.addEventListener('change', () => {
        if (current && current.dashboard.theme !== 'auto') return;
        applyTheme(current ? current.dashboard.theme : 'auto');
        reloadFrames(); // a frame's dark mode is set when it starts
      });
    }

    function centered(...children) {
      const wrap = el('div', 'wd-center');
      const card = el('div', 'wd-card');
      card.append(...children);
      wrap.append(card);
      return wrap;
    }

    function renderKey(message) {
      clearRoot();
      applyTheme('auto');
      const input = el('input', 'wd-input');
      input.type = 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = t('keyPlaceholder');
      const error = el('p', 'wd-error', message || '');
      const go = button('wd-btn primary', t('connect'), async () => {
        const value = input.value.trim();
        if (!value) return;
        key = value;
        go.disabled = true;
        try {
          await loadSetup();
          storageSet(KEY_STORAGE, key);
          route();
        } catch (err) {
          key = null;
          go.disabled = false;
          error.textContent = err.unauthorized ? t('keyRejected') : t('loadFailed');
        }
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
      const form = el('div', 'wd-row');
      form.append(input, go);
      root.append(centered(el('h1', 'wd-h1', t('keyTitle')), el('p', 'wd-muted', t('keyText')), form, error));
      input.focus();
    }

    function renderOff() {
      clearRoot();
      applyTheme('auto');
      root.append(centered(
        el('h1', 'wd-h1', t('title')),
        el('p', 'wd-muted', t('off')),
        button('wd-btn', t('retry'), () => start()),
      ));
    }

    function renderFailed() {
      clearRoot();
      applyTheme('auto');
      root.append(centered(
        el('p', 'wd-error', t('loadFailed')),
        button('wd-btn', t('retry'), () => start()),
      ));
    }

    function bar(...children) {
      const node = el('header', 'wd-bar');
      node.append(...children);
      return node;
    }

    function liveNote() {
      const note = el('span', 'wd-live', t('noLive'));
      note.hidden = live;
      return note;
    }

    function renderList() {
      clearRoot();
      applyTheme('auto');
      const list = el('div', 'wd-list');
      if (!dashboards.length) list.append(el('p', 'wd-muted', t('noDashboards')));
      for (const d of dashboards) {
        const a = el('a', 'wd-item');
        a.href = `#/d/${d.id}`;
        const count = d.columns.reduce((n, c) => n + c.length, 0);
        a.append(el('span', 'wd-item-name', d.name || t('untitled')), el('span', 'wd-muted', t('widgetCount', { count })));
        list.append(a);
      }
      const add = button('wd-btn primary', t('newDashboard'), async () => {
        add.disabled = true;
        try {
          const saved = await request('PUT', '/web/dashboards', { name: t('untitled'), theme: 'auto', columns: [[], [], []] });
          dashboards.push(saved);
          location.hash = `#/d/${saved.id}/edit`;
        } catch (err) {
          add.disabled = false;
          failed(err);
        }
      });
      const forget = button('wd-btn quiet', t('forgetKey'), () => {
        storageSet(KEY_STORAGE, null);
        location.reload();
      });
      root.append(
        bar(el('span', 'wd-bar-title', t('title')), el('span', 'wd-spacer'), liveNote(), forget),
        centered(list, add),
      );
    }

    function renderMissing() {
      clearRoot();
      applyTheme('auto');
      const back = el('a', 'wd-btn', t('dashboards'));
      back.href = '#/';
      root.append(centered(el('p', 'wd-muted', t('missing')), back));
    }

    /** The widget ids' frame signature: a change (settings, devices, title, theme) reloads that frame. */
    const signature = (w) => JSON.stringify([w.type, w.title, w.settings, w.deviceIds, isDark()]);

    function renderDashboard(dashboard, editing) {
      clearRoot();
      setTitle(dashboard);
      applyTheme(dashboard.theme);
      current = { dashboard: clone(dashboard), editing, widgets: new Map(), grid: el('main', 'wd-grid') };
      root.classList.toggle('editing', editing);
      root.append(editing ? editBar() : viewBar(), current.grid);
      syncGrid();
    }

    function viewBar() {
      const d = current.dashboard;
      const back = el('a', 'wd-btn quiet', '‹');
      back.href = '#/';
      back.title = t('dashboards');
      back.setAttribute('aria-label', t('dashboards'));
      const items = [back, el('span', 'wd-bar-title', d.name || t('untitled')), el('span', 'wd-spacer'), liveNote()];
      // Safari on an iPad only has the webkit-prefixed calls.
      const doc = /** @type {any} */ (document.documentElement);
      const page = /** @type {any} */ (document);
      if (doc.requestFullscreen || doc.webkitRequestFullscreen) {
        const full = button('wd-icon', '', () => {
          if (page.fullscreenElement || page.webkitFullscreenElement) {
            (page.exitFullscreen || page.webkitExitFullscreen).call(page);
          } else {
            (doc.requestFullscreen || doc.webkitRequestFullscreen).call(doc);
          }
        }, t('fullScreen'));
        full.append(icon('fullScreen'));
        items.push(full);
      }
      const edit = el('a', 'wd-icon');
      edit.href = `#/d/${d.id}/edit`;
      edit.title = t('edit');
      edit.setAttribute('aria-label', t('edit'));
      edit.append(icon('pen'));
      items.push(edit);
      return bar(...items);
    }

    function editBar() {
      const d = current.dashboard;
      const name = el('input', 'wd-input wd-name');
      name.value = d.name;
      name.placeholder = t('untitled');
      name.setAttribute('aria-label', t('name'));
      name.addEventListener('change', () => { d.name = name.value.trim(); setTitle(d); persist(); });

      const cols = el('span', 'wd-stepper');
      const count = el('span', 'wd-count', String(d.columns.length));
      cols.append(
        button('wd-btn small', '−', () => setColumns(d.columns.length - 1), t('columns')),
        count,
        button('wd-btn small', '+', () => setColumns(d.columns.length + 1), t('columns')),
      );
      cols.title = t('columns');

      const theme = el('select', 'wd-input wd-theme');
      theme.setAttribute('aria-label', t('theme'));
      for (const [id, label] of [['auto', 'themeAuto'], ['dark', 'themeDark'], ['light', 'themeLight']]) {
        const o = el('option', null, t(label));
        o.value = id;
        theme.append(o);
      }
      theme.value = d.theme;
      theme.addEventListener('change', () => {
        d.theme = theme.value;
        applyTheme(d.theme);
        persist();
        syncGrid();
      });

      const remove = confirmButton('wd-btn danger', t('deleteDashboard'), async () => {
        // After the saves already queued, and no save of it after (a name field's change can fire on the way).
        deleted.add(d.id);
        saving = saving.then(async () => {
          try {
            await request('DELETE', `/web/dashboards/${encodeURIComponent(d.id)}`);
            dashboards = dashboards.filter(x => x.id !== d.id);
            location.hash = '#/';
          } catch (err) {
            deleted.delete(d.id);
            failed(err);
          }
        });
      }, t('tapAgain'));

      const done = el('a', 'wd-btn primary', t('done'));
      done.href = `#/d/${d.id}`;
      return bar(name, cols, theme, el('span', 'wd-spacer'), remove, done);
    }

    function setColumns(n) {
      const d = current.dashboard;
      if (n < 1 || n > 6) return;
      while (d.columns.length < n) d.columns.push([]);
      while (d.columns.length > n) {
        const last = d.columns.pop();
        d.columns[d.columns.length - 1].push(...last); // its widgets stay, in the column before
      }
      const count = root.querySelector('.wd-count');
      if (count) count.textContent = String(d.columns.length);
      persist();
      syncGrid();
    }

    /**
     * Brings the grid in line with the dashboard: a widget whose frame signature didn't change keeps its element
     * (and so its running frame, unless it has to move: moving an iframe reloads it).
     */
    function syncGrid() {
      if (!current) return;
      if (drag) endDrag(false); // its widget may be rebuilt
      const { dashboard, grid, widgets, editing } = current;
      grid.style.setProperty('--cols', String(dashboard.columns.length));
      while (grid.children.length < dashboard.columns.length) grid.append(el('section', 'wd-col'));
      while (grid.children.length > dashboard.columns.length) grid.lastChild.remove();
      const seen = new Set();
      dashboard.columns.forEach((column, c) => {
        const col = grid.children[c];
        const nodes = column.map((w, i) => {
          seen.add(w.id);
          const sig = signature(w);
          let entry = widgets.get(w.id);
          if (!entry || entry.sig !== sig) {
            if (entry) entry.el.remove();
            entry = { el: widgetElement(w), sig };
            widgets.set(w.id, entry);
          }
          setTools(entry.el, w, c, i, column.length);
          return entry.el;
        });
        if (editing) {
          let add = col.querySelector(':scope > .wd-add');
          if (!add) add = button('wd-add', `+ ${t('addWidget')}`, () => {});
          add.onclick = () => chooseWidget(c);
          nodes.push(add);
        } else if (!column.length) {
          nodes.push(el('div', 'wd-empty'));
        }
        // Only what's out of place moves.
        nodes.forEach((node, i) => { if (col.children[i] !== node) col.insertBefore(node, col.children[i] || null); });
        while (col.children.length > nodes.length) col.lastChild.remove();
      });
      for (const [id, entry] of widgets) {
        if (seen.has(id)) continue;
        entry.el.remove();
        widgets.delete(id);
      }
      sweepFrames();
    }

    function widgetElement(w) {
      const def = types.get(w.type);
      const node = el('article', 'wd-widget');
      node.dataset.id = w.id;
      if (current.editing) node.append(dragHandle(el('div', 'wd-tools')));
      if (w.title) node.append(el('h2', 'wd-title', w.title));
      if (!def) {
        node.append(el('p', 'wd-error', w.type));
        return node;
      }
      const wrap = el('div', def.transparent ? 'wd-frame' : 'wd-frame card');
      const iframe = document.createElement('iframe');
      iframe.title = w.title || def.name;
      iframe.style.height = `${def.height || 120}px`;
      iframe.setAttribute('allow', 'autoplay; fullscreen');
      // The dashboard and widget ids: a Timers widget keeps its own timer, a Media widget its speaker choice.
      const instance = `web-${current.dashboard.id}-${w.id}`;
      iframe.src = `../widgets/${encodeURIComponent(w.type)}/index.html?widgetInstanceId=${encodeURIComponent(instance)}`;
      wrap.append(iframe);
      node.append(wrap);
      frames.add({ widget: clone(w), iframe, subs: new Map(), gen: 0 });
      return node;
    }

    /** The edit tools over a widget: its name, settings, moves and remove. */
    function setTools(node, w, c, i, n) {
      const tools = node.querySelector(':scope > .wd-tools');
      if (!tools) return;
      const def = types.get(w.type);
      const cols = current.dashboard.columns.length;
      tools.textContent = '';
      const grip = el('span', 'wd-grip', '⠿');
      grip.title = t('drag');
      grip.setAttribute('aria-hidden', 'true');
      tools.append(
        grip,
        el('span', 'wd-tools-name', (def && def.name) || w.type),
        el('span', 'wd-spacer'),
        button('wd-tool', '⚙', () => editWidget(w.id), t('settings')),
        button('wd-tool', '↑', () => move(w.id, 0, -1), t('moveUp')),
        button('wd-tool', '↓', () => move(w.id, 0, 1), t('moveDown')),
        button('wd-tool', '←', () => move(w.id, -1, 0), t('moveLeft')),
        button('wd-tool', '→', () => move(w.id, 1, 0), t('moveRight')),
        confirmButton('wd-tool danger', '✕', () => removeWidget(w.id), '✕?', t('remove')),
      );
      const [, up, down, left, right] = tools.querySelectorAll('.wd-tool');
      up.disabled = i === 0;
      down.disabled = i === n - 1;
      left.disabled = c === 0;
      right.disabled = c === cols - 1;
    }

    function find(id) {
      const columns = current.dashboard.columns;
      for (let c = 0; c < columns.length; c++) {
        const i = columns[c].findIndex(w => w.id === id);
        if (i >= 0) return { c, i, widget: columns[c][i] };
      }
      return null;
    }

    function move(id, dc, di) {
      const at = find(id);
      if (!at) return;
      const columns = current.dashboard.columns;
      if (dc) {
        const to = at.c + dc;
        if (to < 0 || to >= columns.length) return;
        columns[at.c].splice(at.i, 1);
        columns[to].splice(Math.min(at.i, columns[to].length), 0, at.widget);
      } else {
        const to = at.i + di;
        if (to < 0 || to >= columns[at.c].length) return;
        columns[at.c].splice(at.i, 1);
        columns[at.c].splice(to, 0, at.widget);
      }
      persist();
      syncGrid();
    }

    /** Puts a widget at `index` of column `c` (an index among the column's other widgets). */
    function moveTo(id, c, index) {
      const at = find(id);
      const columns = current.dashboard.columns;
      if (!at || !columns[c] || (at.c === c && at.i === index)) return;
      columns[at.c].splice(at.i, 1);
      columns[c].splice(Math.min(index, columns[c].length), 0, at.widget);
      persist();
      syncGrid();
    }

    // ---- Drag and drop (editing): a widget's bar is its handle. Pointer events, so it works by touch too; the
    // widget stays where it is (moving an iframe reloads it) while a line shows where it will go. ----------------

    let drag = null; // {id, node, pointerId, x0, y0, x, y, active, ghost, marker, target: {c, i}, raf}

    function dragHandle(tools) {
      tools.addEventListener('pointerdown', (e) => {
        if (drag || !current || !current.editing || e.button !== 0) return;
        if (/** @type {Element} */ (e.target).closest('button')) return;
        const node = tools.parentElement;
        drag = { id: node.dataset.id, node, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false };
        try { tools.setPointerCapture(e.pointerId); } catch (err) { /* moves still come while over the bar */ }
        e.preventDefault();
      });
      tools.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (!drag.active && Math.hypot(drag.x - drag.x0, drag.y - drag.y0) >= DRAG_SLOP) beginDrag();
        if (drag.active) dragTo();
      });
      tools.addEventListener('pointerup', (e) => {
        if (drag && e.pointerId === drag.pointerId) endDrag(true);
      });
      tools.addEventListener('pointercancel', () => endDrag(false));
      tools.addEventListener('lostpointercapture', () => endDrag(false));
      return tools;
    }

    function beginDrag() {
      const at = find(drag.id);
      const def = at && types.get(at.widget.type);
      drag.active = true;
      root.classList.add('dragging');
      drag.node.classList.add('lifted');
      drag.ghost = el('div', 'wd-ghost', (at && at.widget.title) || (def && def.name) || '');
      drag.marker = el('div', 'wd-drop');
      document.body.append(drag.ghost);
      drag.raf = requestAnimationFrame(autoScroll);
    }

    /** Follows the pointer: the ghost under it, the line where the widget would go. */
    function dragTo() {
      drag.ghost.style.transform = `translate(${drag.x}px, ${drag.y}px)`;
      // The column nearest the pointer (one under another on a phone), then the place among its other widgets.
      let c = 0;
      let best = Infinity;
      [...current.grid.children].forEach((col, n) => {
        const r = col.getBoundingClientRect();
        const dx = Math.max(r.left - drag.x, 0, drag.x - r.right);
        const dy = Math.max(r.top - drag.y, 0, drag.y - r.bottom);
        if (dx * dx + dy * dy < best) { best = dx * dx + dy * dy; c = n; }
      });
      const col = current.grid.children[c];
      if (!col) return;
      const others = [...col.children].filter(n => n.classList.contains('wd-widget') && n !== drag.node);
      let i = 0;
      while (i < others.length) {
        const r = others[i].getBoundingClientRect();
        if (drag.y < r.top + r.height / 2) break;
        i++;
      }
      drag.target = { c, i };
      const before = others[i] || col.querySelector(':scope > .wd-add');
      if (drag.marker.parentNode !== col || drag.marker.nextSibling !== before) col.insertBefore(drag.marker, before || null);
    }

    function autoScroll() {
      if (!drag || !drag.active) return;
      const h = window.innerHeight;
      const by = drag.y < EDGE_PX ? drag.y - EDGE_PX : drag.y > h - EDGE_PX ? drag.y - (h - EDGE_PX) : 0;
      if (by) {
        window.scrollBy(0, Math.round(by / 4));
        dragTo();
      }
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function endDrag(drop) {
      if (!drag) return;
      const { id, active, target } = drag;
      if (active) {
        cancelAnimationFrame(drag.raf);
        drag.ghost.remove();
        drag.marker.remove();
        drag.node.classList.remove('lifted');
        root.classList.remove('dragging');
      }
      drag = null;
      if (drop && active && target && current) moveTo(id, target.c, target.i);
    }

    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag) endDrag(false); });

    function removeWidget(id) {
      const at = find(id);
      if (!at) return;
      current.dashboard.columns[at.c].splice(at.i, 1);
      persist();
      syncGrid();
    }

    let saving = Promise.resolve();
    const deleted = new Set(); // dashboards being deleted, or deleted: never saved again
    /**
     * Saves the dashboard as it is now (one save at a time, in order). When nothing changed meanwhile, the editor
     * takes the app's copy, so a value it corrected (a clamped number, a new widget id) shows and is sent on.
     */
    function persist() {
      const snapshot = clone(current.dashboard);
      saving = saving.then(async () => {
        if (deleted.has(snapshot.id)) return;
        try {
          const saved = await request('PUT', '/web/dashboards', snapshot);
          if (deleted.has(saved.id)) return;
          const i = dashboards.findIndex(d => d.id === saved.id);
          if (i >= 0) dashboards[i] = saved; else dashboards.push(saved);
          if (current && current.dashboard.id === saved.id
            && JSON.stringify(current.dashboard) === JSON.stringify(snapshot)
            && JSON.stringify(saved) !== JSON.stringify(snapshot)) {
            current.dashboard = clone(saved);
            syncGrid();
          }
        } catch (err) {
          failed(err, t('saveFailed'));
        }
      });
      return saving;
    }

    /** A key Homey no longer accepts: not kept, and the socket that used it stops. */
    function forgetKey() {
      key = null;
      storageSet(KEY_STORAGE, null);
      stopSocket();
      setLive(false);
    }

    function failed(err, message) {
      console.error(err);
      if (err && err.unauthorized) { forgetKey(); renderKey(t('keyRejected')); return; }
      if (err && /turned off/.test(String(err.message))) { start(); return; } // turned off meanwhile
      toast(message || t('loadFailed'));
    }

    function toast(text) {
      const node = el('div', 'wd-toast', text);
      document.body.append(node);
      setTimeout(() => node.remove(), 4000);
    }

    // ---- Dialogs: choose a widget, a widget's settings -------------------------------------------------------

    function dialog(title) {
      const d = el('dialog', 'wd-dialog');
      const head = el('div', 'wd-dialog-head');
      head.append(el('h2', 'wd-h2', title), button('wd-tool', '✕', () => d.close(), t('cancel')));
      const body = el('div', 'wd-dialog-body');
      d.append(head, body);
      d.addEventListener('close', () => d.remove());
      document.body.append(d);
      return { d, body };
    }

    function chooseWidget(column) {
      const { d, body } = dialog(t('chooseWidget'));
      d.classList.add('wide');
      const list = el('div', 'wd-types');
      const sorted = [...types.values()].sort((a, b) => a.name.localeCompare(b.name));
      for (const def of sorted) {
        const b = button('wd-type', '', () => {
          d.close();
          const settings = {};
          for (const s of def.settings) settings[s.id] = clone(s.value);
          const w = { id: newId(), type: def.type, title: '', settings, deviceIds: [] };
          current.dashboard.columns[column].push(w);
          persist();
          syncGrid();
          editWidget(w.id);
        });
        // The widget's own preview (as Homey's widget picker shows it), served beside its files; in the dashboard's theme.
        const img = el('img', 'wd-type-preview');
        img.src = `../widgets/${encodeURIComponent(def.type)}/preview-${isDark() ? 'dark' : 'light'}.png`;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => img.remove());
        b.append(img, el('span', 'wd-type-name', def.name));
        list.append(b);
      }
      body.append(list);
      d.showModal();
    }

    function field(label, hint, control, forId) {
      const row = el('div', 'wd-field');
      const l = el('label', 'wd-label', label);
      if (forId) l.htmlFor = forId;
      row.append(l, control);
      if (hint) row.append(el('p', 'wd-hint', hint));
      return row;
    }

    function editWidget(id) {
      const at = find(id);
      if (!at) return;
      const w = at.widget;
      const def = types.get(w.type);
      if (!def) return;
      const draft = { title: w.title || '', settings: clone(w.settings || {}), deviceIds: (w.deviceIds || []).slice() };
      const { d, body } = dialog(def.name);
      let n = 0;
      const uid = () => `wd-f${++n}`;

      const title = el('input', 'wd-input');
      title.id = uid();
      title.value = draft.title;
      title.addEventListener('input', () => { draft.title = title.value; });
      body.append(field(t('widgetTitle'), t('widgetTitleHint'), title, title.id));

      if (def.devices) body.append(devicePicker(def, draft));

      for (const s of def.settings) {
        let control;
        const fid = uid();
        switch (s.type) {
          case 'checkbox': {
            const box = el('input');
            box.type = 'checkbox';
            box.id = fid;
            box.checked = draft.settings[s.id] === true;
            box.addEventListener('change', () => { draft.settings[s.id] = box.checked; });
            const row = el('div', 'wd-field wd-check');
            const l = el('label', 'wd-label', s.title);
            l.htmlFor = fid;
            row.append(box, l);
            body.append(row);
            if (s.hint) body.append(el('p', 'wd-hint wd-check-hint', s.hint));
            continue;
          }
          case 'number':
            control = el('input', 'wd-input');
            control.type = 'number';
            control.step = 'any';
            if (s.min != null) control.min = String(s.min);
            if (s.max != null) control.max = String(s.max);
            control.value = draft.settings[s.id] == null ? '' : String(draft.settings[s.id]);
            control.addEventListener('input', () => {
              const v = control.value.trim();
              draft.settings[s.id] = v === '' ? null : Number(v);
            });
            break;
          case 'textarea':
            control = el('textarea', 'wd-input');
            control.rows = 4;
            control.value = String(draft.settings[s.id] ?? '');
            control.addEventListener('input', () => { draft.settings[s.id] = control.value; });
            break;
          case 'dropdown':
            control = el('select', 'wd-input');
            for (const v of s.values || []) {
              const o = el('option', null, v.title);
              o.value = v.id;
              control.append(o);
            }
            control.value = String(draft.settings[s.id] ?? '');
            control.addEventListener('change', () => { draft.settings[s.id] = control.value; });
            break;
          case 'autocomplete':
            control = autocompletePicker(def, s, draft);
            break;
          default: // text
            control = el('input', 'wd-input');
            control.value = String(draft.settings[s.id] ?? '');
            control.addEventListener('input', () => { draft.settings[s.id] = control.value; });
        }
        control.id = fid;
        body.append(field(s.title, s.hint, control, fid));
      }

      const actions = el('div', 'wd-actions');
      actions.append(
        button('wd-btn quiet', t('cancel'), () => d.close()),
        button('wd-btn primary', t('save'), () => {
          const now = find(id);
          if (now) {
            now.widget.title = draft.title.trim();
            now.widget.settings = draft.settings;
            now.widget.deviceIds = draft.deviceIds;
            persist();
            syncGrid();
          }
          d.close();
        }),
      );
      d.append(actions);
      d.showModal();
    }

    /** The widget's devices: a searchable list, ticked ones first (in the order they were ticked). */
    function devicePicker(def, draft) {
      const singular = def.devices.singular;
      const wrap = el('div', 'wd-picker open');
      const search = el('input', 'wd-input');
      search.type = 'search';
      search.placeholder = t('search');
      const list = el('div', 'wd-options');
      wrap.append(search, list);
      let all = null;
      const draw = () => {
        list.textContent = '';
        if (!all) return;
        const q = search.value.trim().toLowerCase();
        const byId = new Map(all.map(d => [d.id, d]));
        const picked = draft.deviceIds.map(id => byId.get(id) || { id, name: id });
        const rest = all.filter(d => !draft.deviceIds.includes(d.id));
        const shown = [...picked, ...rest].filter(d => !q || `${d.name} ${d.description || ''}`.toLowerCase().includes(q));
        if (!shown.length) list.append(el('p', 'wd-hint', t('noDevices')));
        for (const dev of shown) {
          const row = el('label', 'wd-option');
          const box = el('input');
          box.type = singular ? 'radio' : 'checkbox';
          box.name = 'wd-devices';
          box.checked = draft.deviceIds.includes(dev.id);
          box.addEventListener('change', () => {
            if (singular) draft.deviceIds = [dev.id];
            else if (box.checked) draft.deviceIds.push(dev.id);
            else draft.deviceIds = draft.deviceIds.filter(x => x !== dev.id);
            draw();
          });
          const text = el('span', 'wd-option-text');
          text.append(el('span', 'wd-option-name', dev.name));
          if (dev.description) text.append(el('span', 'wd-hint', dev.description));
          row.append(box, text);
          list.append(row);
        }
      };
      search.addEventListener('input', draw);
      request('GET', `/web/devices?type=${encodeURIComponent(def.type)}`)
        .then((items) => { all = items || []; draw(); })
        .catch((err) => { list.append(el('p', 'wd-error', String(err.message || err))); });
      return field(singular ? t('device') : t('devices'), null, wrap);
    }

    /** An autocomplete setting: the choice, and a search through the app's own listener (with the draft's settings). */
    function autocompletePicker(def, s, draft) {
      const wrap = el('div', 'wd-picker');
      const head = el('div', 'wd-row');
      const pick = button('wd-btn wd-choice', '', () => toggle());
      const clear = button('wd-btn quiet small', t('clear'), () => {
        draft.settings[s.id] = null;
        label();
      });
      head.append(pick, clear);
      const search = el('input', 'wd-input');
      search.type = 'search';
      search.placeholder = t('search');
      const list = el('div', 'wd-options');
      wrap.append(head);
      const label = () => {
        const v = draft.settings[s.id];
        pick.textContent = v && v.name ? v.name : t('choose');
        clear.hidden = !v;
      };
      label();
      let open = false;
      let seq = 0;
      let timer = null;
      const load = async () => {
        const mine = ++seq;
        try {
          const items = await request('POST', '/web/autocomplete', { type: def.type, setting: s.id, query: search.value, settings: draft.settings });
          if (mine !== seq) return;
          list.textContent = '';
          if (!items || !items.length) list.append(el('p', 'wd-hint', t('nothingFound')));
          for (const item of items || []) {
            const row = button('wd-option', '', () => {
              const chosen = {};
              for (const k in item) if (k !== 'image') chosen[k] = item[k];
              draft.settings[s.id] = chosen;
              label();
              toggle(false);
            });
            if (item.image) {
              const img = el('img', 'wd-option-image');
              img.src = item.image;
              img.alt = '';
              row.append(img);
            }
            const text = el('span', 'wd-option-text');
            text.append(el('span', 'wd-option-name', item.name));
            if (item.description) text.append(el('span', 'wd-hint', item.description));
            row.append(text);
            list.append(row);
          }
        } catch (err) {
          if (mine !== seq) return;
          list.textContent = '';
          list.append(el('p', 'wd-error', String(err.message || err)));
        }
      };
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(load, 250);
      });
      function toggle(on = !open) {
        open = on;
        wrap.classList.toggle('open', open);
        if (open) {
          wrap.append(search, list);
          search.value = '';
          list.textContent = '';
          load();
          search.focus();
        } else {
          search.remove();
          list.remove();
        }
      }
      return wrap;
    }

    // ---- Routing: #/ the list, #/d/<id> a dashboard, #/d/<id>/edit editing it ---------------------------------

    function route() {
      if (!key) { renderKey(); return; }
      if (!setup) { start(); return; }
      if (setup.disabled) { renderOff(); return; }
      const m = location.hash.match(/^#\/d\/([A-Za-z0-9_-]+)(\/edit)?$/);
      if (!m) { renderList(); return; }
      const dashboard = dashboards.find(d => d.id === m[1]);
      if (!dashboard) { renderMissing(); return; }
      renderDashboard(dashboard, !!m[2]);
    }

    async function start() {
      if (!key) { renderKey(); return; }
      try {
        await loadSetup();
        route();
      } catch (err) {
        if (err.unauthorized) {
          forgetKey();
          renderKey(t('keyRejected'));
        } else {
          renderFailed();
        }
      }
    }

    window.addEventListener('hashchange', async () => {
      // Leaving the editor: wait for the last save, so the view shows what was saved.
      await saving;
      route();
    });
    start();
  };
})();
