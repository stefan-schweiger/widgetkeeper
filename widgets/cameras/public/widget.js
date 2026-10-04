/*
 * Cameras: a grid of camera snapshots, 2 per row (16:9; a lone or odd last tile spans the row), each
 * refreshed every few seconds. Tapping a camera with video plays it live over the whole widget (WebRTC
 * through Homey's own video server); tapping again, or 5 minutes, ends it.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const TAP_SLOP = 10; // px a finger may move and still count as a tap
  const LIVE_MAX_MS = 5 * 60e3;
  const LIVE_TIMEOUT_MS = 15e3; // from the tap to the first frame, and between frames after that
  const FRAME_CHECK_MS = 5000; // how often a live stream's decoded frames are counted
  const KEEPALIVE_MS = 10e3;
  const ICE_WAIT_MS = 2000; // Homey's answer has every candidate, so the offer is sent once gathering is done

  const DEFAULT_STRINGS = {
    selectDevices: 'Select cameras in the widget settings.',
    error: 'Could not load the cameras.',
    noImage: 'No snapshot',
    unavailable: 'Unavailable',
    live: 'Live',
    liveFailed: 'Live view failed',
  };

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

  /** Loads an image off-screen, so a tile only swaps once the new snapshot has decoded. */
  function preload(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => reject(new Error('Image failed'));
      img.src = src;
    });
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, refreshMs?: number,
   *   api?: (method: string, path: string, body?: object) => Promise<any>,
   *   report?: (text: string) => void, onHeight?: (h: number) => void,
   *   now?: () => number }} opts
   */
  function createCamerasWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`cameras.${key}`, tokens) : null;
      if (s && s !== `cameras.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const now = opts.now || (() => Date.now());
    const refreshMs = opts.refreshMs || 10e3;

    let devices = []; // [{ id, name, icon, image: { id, url, lastUpdated } | null, video } | { id, missing }]
    let messageText = null;
    let messageTimer = null;
    let lastTouchTap = 0;
    /**
     * How snapshots load, per camera: 'direct' (the image URL from the widget frame, as Homey's web server
     * serves it), or 'app' (base64 through the app's /snapshot, when the frame can't load that URL). Every
     * camera starts direct; one whose direct load fails moves to the app, the others stay direct.
     */
    const appRoute = new Set();
    let directReported = false;
    let refreshing = false;
    /** The tile playing live, with its connection. */
    let live = null;

    root.classList.add('cw');
    const grid = el('div', { class: 'cw-grid' }, root);
    const messageEl = el('div', { class: 'cw-message', dir: 'auto' }, root);
    /**
     * @type {Map<string, {tile: HTMLElement, img: HTMLImageElement, video: HTMLVideoElement, icon: HTMLElement,
     *   name: HTMLElement, badge: HTMLElement, note: HTMLElement, loadedAt: number, noteTimer: any}>}
     */
    const tiles = new Map();

    function setState(list) {
      devices = Array.isArray(list) ? list : [];
      messageText = null;
      if (live && !devices.some(d => d.id === live.id && d.video)) stopLive();
      render();
    }

    /** A message under the tiles. Persistent messages also clear the tiles. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else { devices = []; stopLive(); }
      render();
    }

    // ---------------------------------------------------------------- snapshots

    function api(method, path, body) {
      if (!opts.api) return Promise.reject(new Error('No API'));
      return opts.api(method, path, body);
    }

    function directUrl(d) {
      const u = d.image.url;
      if (u.startsWith('data:')) return u; // the dev previews' mock scenes
      return `${u}${u.includes('?') ? '&' : '?'}t=${now()}`;
    }

    async function appUrl(d) {
      const s = await api('GET', `/snapshot?deviceId=${encodeURIComponent(d.id)}`);
      return `data:${s.type};base64,${s.data}`;
    }

    /** A new snapshot for one camera; its first direct failure moves that camera to the app route. */
    async function loadSnapshot(d) {
      if (!appRoute.has(d.id)) {
        try {
          const src = await preload(directUrl(d));
          if (!directReported && opts.report) opts.report(`snapshots load directly (frame ${location.origin})`);
          directReported = true;
          return src;
        } catch (err) {
          appRoute.add(d.id);
          if (opts.report) opts.report(`direct snapshot URL failed for ${d.name} (frame ${location.origin}), using the app`);
        }
      }
      return preload(await appUrl(d));
    }

    /** Refreshes every snapshot, one camera at a time, so a slow camera doesn't hold up the frame. */
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        for (const d of devices.slice()) {
          if ('missing' in d || !d.image) continue;
          if (live && live.id === d.id && live.playing) continue;
          const tile = tiles.get(d.id);
          if (!tile) continue;
          try {
            const src = await loadSnapshot(d);
            if (tiles.get(d.id) !== tile) continue;
            tile.img.src = src;
            tile.loadedAt = now();
            tile.tile.classList.add('loaded');
          } catch (err) {
            console.error(err);
          }
          updateBadge(d.id);
        }
      } finally {
        refreshing = false;
      }
    }

    /** A snapshot that hasn't refreshed for two intervals shows the time it was taken. */
    function updateBadge(id) {
      const tile = tiles.get(id);
      if (!tile) return;
      const stale = tile.loadedAt > 0 && now() - tile.loadedAt > 2 * refreshMs + 5000;
      tile.badge.textContent = stale
        ? new Date(tile.loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      tile.badge.style.display = stale ? '' : 'none';
    }

    // ---------------------------------------------------------------- live view

    function note(id, text) {
      const tile = tiles.get(id);
      if (!tile) return;
      if (tile.noteTimer) clearTimeout(tile.noteTimer);
      tile.note.textContent = text;
      tile.note.style.display = '';
      tile.noteTimer = setTimeout(() => { tile.note.style.display = 'none'; }, 4000);
    }

    /**
     * The live camera covers the whole widget, letterboxed. The widget keeps its height, except that a single
     * row of tiles grows to a full-width 16:9 first, so the video isn't a strip. The height is measured before
     * the tile leaves the grid: a wide last tile has a row of its own, which would otherwise collapse.
     */
    function expand(tile, on) {
      const box = grid.getBoundingClientRect();
      const minHeight = on ? `${Math.ceil(Math.max(box.height, box.width * 9 / 16))}px` : '';
      tile.tile.classList.toggle('expanded', on);
      grid.classList.toggle('has-expanded', on);
      grid.style.minHeight = minHeight;
      reportHeight();
    }

    function stopLive() {
      if (!live) return;
      const l = live;
      live = null;
      clearTimeout(l.timeout);
      clearTimeout(l.maxTimer);
      clearInterval(l.keepAlive);
      clearInterval(l.frameCheck);
      try { l.pc.close(); } catch (err) { /* already closed */ }
      const tile = tiles.get(l.id);
      if (tile) {
        tile.video.pause();
        tile.video.srcObject = null;
        tile.tile.classList.remove('live', 'connecting');
        expand(tile, false);
      }
      refresh();
    }

    function waitForIce(pc) {
      if (pc.iceGatheringState === 'complete') return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(undefined); };
        const check = () => { if (pc.iceGatheringState === 'complete') done(); };
        pc.addEventListener('icegatheringstatechange', check);
        setTimeout(done, ICE_WAIT_MS);
      });
    }

    async function startLive(d) {
      const tile = tiles.get(d.id);
      if (!tile || typeof RTCPeerConnection !== 'function') { note(d.id, t('liveFailed')); return; }
      const pc = new RTCPeerConnection();
      const l = {
        id: d.id, pc, playing: false, timeout: null, maxTimer: null, keepAlive: null, frameCheck: null,
        frames: 0, frameAt: 0, fail: null, keepAliveFailed: false,
      };
      live = l;
      const fail = (why) => {
        if (live !== l) return;
        if (opts.report) opts.report(`live view of ${d.name} failed: ${why}`);
        stopLive();
        note(d.id, t('liveFailed'));
      };
      l.fail = fail;
      tile.tile.classList.add('connecting');
      expand(tile, true);
      l.timeout = setTimeout(() => fail('no video after 15 s'), LIVE_TIMEOUT_MS);
      l.maxTimer = setTimeout(() => { if (live === l) stopLive(); }, LIVE_MAX_MS);
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.ontrack = (e) => {
        if (live !== l) return;
        tile.video.srcObject = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
        const p = tile.video.play();
        if (p && p.catch) p.catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') fail('connection failed');
      };
      try {
        await pc.setLocalDescription(await pc.createOffer());
        await waitForIce(pc);
        if (live !== l) return;
        const res = await api('POST', '/video/offer', { videoId: d.video, offer: pc.localDescription.sdp });
        if (live !== l) return;
        await pc.setRemoteDescription({ type: 'answer', sdp: res.answer });
        if (res.streamId) {
          l.keepAlive = setInterval(() => {
            api('POST', '/video/keepalive', { videoId: d.video, streamId: res.streamId }).catch((err) => {
              // A rejected keep-alive ends the stream on Homey's side; the frame check then ends live view.
              if (l.keepAliveFailed || !opts.report) return;
              l.keepAliveFailed = true;
              opts.report(`live view of ${d.name}: keep-alive failed: ${err && err.message ? err.message : err}`);
            });
          }, KEEPALIVE_MS);
        }
      } catch (err) {
        fail(err && err.message ? err.message : String(err));
      }
    }

    /** The video frames decoded so far, from the connection's stats; null when the browser can't tell. */
    async function framesDecoded(pc) {
      if (typeof pc.getStats !== 'function') return null;
      const stats = await pc.getStats();
      let n = null;
      stats.forEach((s) => {
        if (s.type === 'inbound-rtp' && (s.kind || s.mediaType) === 'video' && typeof s.framesDecoded === 'number') {
          n = (n || 0) + s.framesDecoded;
        }
      });
      return n;
    }

    function onPlaying(id) {
      const l = live;
      if (!l || l.id !== id) return;
      clearTimeout(l.timeout);
      const tile = tiles.get(id);
      if (tile) { tile.tile.classList.remove('connecting'); tile.tile.classList.add('live'); }
      if (l.playing) return; // 'playing' again after a stall
      l.playing = true;
      // A stream can stop sending frames while the connection stays up (the camera drops off); the video
      // then just freezes. Live view ends after LIVE_TIMEOUT_MS without a new frame.
      l.frameAt = now();
      l.frameCheck = setInterval(async () => {
        let n = null;
        try { n = await framesDecoded(l.pc); } catch (err) { /* closed meanwhile */ }
        if (live !== l || n == null) return;
        if (n > l.frames) { l.frames = n; l.frameAt = now(); }
        else if (now() - l.frameAt >= LIVE_TIMEOUT_MS) l.fail('no new frame for 15 s');
      }, FRAME_CHECK_MS);
    }

    function press(id) {
      const d = devices.find(x => x.id === id);
      if (!d || 'missing' in d || !d.video) return;
      const wasLive = live && live.id === id;
      stopLive();
      if (!wasLive) startLive(d);
    }

    // ---------------------------------------------------------------- tiles

    function tileFor(id) {
      let tile = tiles.get(id);
      if (tile) return tile;
      const node = el('div', { class: 'cw-tile', 'data-device': id });
      const img = /** @type {HTMLImageElement} */ (el('img', { class: 'cw-img', alt: '' }, node));
      const video = /** @type {HTMLVideoElement} */ (el('video', { class: 'cw-video', playsinline: '', muted: '', autoplay: '' }, node));
      video.muted = true;
      video.addEventListener('playing', () => onPlaying(id));
      const icon = el('span', { class: 'cw-icon' }, node);
      const overlay = el('div', { class: 'cw-overlay' }, node);
      const name = el('span', { class: 'cw-name', dir: 'auto' }, overlay);
      const chip = el('span', { class: 'cw-chip' }, overlay);
      chip.textContent = t('live');
      const badge = el('span', { class: 'cw-badge' }, node);
      badge.style.display = 'none';
      const noteEl = el('span', { class: 'cw-note', dir: 'auto' }, node);
      noteEl.style.display = 'none';
      tile = { tile: node, img, video, icon, name, badge, note: noteEl, loadedAt: 0, noteTimer: null };

      // Taps come from the touch events, like Quick Actions: a touch that ends within TAP_SLOP of where it
      // started. A drag is left to the dashboard, so it still scrolls.
      let start = null;
      node.addEventListener('touchstart', (e) => {
        const p = e.changedTouches[0];
        start = { x: p.clientX, y: p.clientY };
      }, { passive: true });
      node.addEventListener('touchmove', (e) => {
        const p = e.changedTouches[0];
        if (start && Math.hypot(p.clientX - start.x, p.clientY - start.y) > TAP_SLOP) start = null;
      }, { passive: true });
      node.addEventListener('touchend', (e) => {
        const tap = !!start;
        start = null;
        if (!tap) return;
        e.preventDefault(); // no click after it
        lastTouchTap = now();
        press(id);
      });
      node.addEventListener('touchcancel', () => { start = null; });
      node.addEventListener('click', () => {
        if (now() - lastTouchTap < 800) return;
        press(id);
      });
      tiles.set(id, tile);
      return tile;
    }

    function setMask(node, url) {
      const v = url ? `url("${url}")` : '';
      if (node.style.getPropertyValue('--cw-mask') !== v) node.style.setProperty('--cw-mask', v);
    }

    let lastHeight = 0;
    function render() {
      const ids = new Set(devices.map(d => d.id));
      for (const [id, tile] of tiles) {
        if (!ids.has(id)) { tile.tile.remove(); tiles.delete(id); }
      }
      devices.forEach((d, i) => {
        const tile = tileFor(d.id);
        grid.appendChild(tile.tile); // keeps the settings' order; a no-op when already in place
        const missing = 'missing' in d;
        tile.name.textContent = missing ? t('unavailable') : d.name;
        setMask(tile.icon, missing ? null : d.icon);
        tile.icon.classList.toggle('fallback', missing || !d.icon);
        tile.tile.classList.toggle('missing', missing);
        tile.tile.classList.toggle('no-image', !missing && !d.image);
        tile.tile.classList.toggle('has-video', !missing && !!d.video);
        // A lone tile, or the last of an odd number, spans the row.
        tile.tile.classList.toggle('wide', i === devices.length - 1 && devices.length % 2 === 1);
        if (!missing && !d.image) tile.note.style.display = 'none';
        tile.tile.setAttribute('data-empty', !missing && !d.image ? t('noImage') : '');
      });
      grid.style.display = devices.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && devices.length > 0);

      reportHeight();
    }

    function reportHeight() {
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    /** Ends live view, e.g. when the dashboard goes to the background. */
    function pause() { stopLive(); }

    return { setState, setMessage, refresh, render, pause, stopLive, t, routeOf: (id) => (appRoute.has(id) ? 'app' : 'direct') };
  }

  window.createCamerasWidget = createCamerasWidget;
})();
