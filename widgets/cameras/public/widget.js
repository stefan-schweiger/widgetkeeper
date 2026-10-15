/*
 * Cameras: a grid of camera snapshots, 2 per row (16:9; a lone or odd last tile spans the row), each
 * refreshed every few seconds. Tapping a camera with video plays it live over the whole widget (WebRTC
 * through Homey's own video server), trying the camera's next stream when one won't play (an H.265 one);
 * tapping again, or 5 minutes, ends it. A camera with video but no
 * snapshot (Aqara's) gets a frame grabbed from a short-lived stream instead, at most once a minute.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const TAP_SLOP = 10; // px a finger may move and still count as a tap
  const LIVE_MAX_MS = 5 * 60e3;
  const LIVE_TIMEOUT_MS = 15e3; // from the tap to the first frame, and between frames after that
  const NEXT_STREAM_MS = 10e3; // to the first frame of a stream with another one left to try
  const FRAME_CHECK_MS = 5000; // how often a live stream's decoded frames are counted
  const KEEPALIVE_MS = 10e3;
  const ICE_WAIT_MS = 2000; // Homey's answer has every candidate, so the offer is sent once gathering is done
  const GRAB_MIN_MS = 60e3; // a video-only camera's frame grab: each one opens a stream through Homey
  const GRAB_RETRY_MS = 5 * 60e3; // after a failed grab
  const GRAB_WIDTH = 640; // px; a grabbed frame is scaled down to this

  const DEFAULT_STRINGS = {
    selectDevices: 'Select cameras in the widget settings.',
    error: 'Could not load the cameras.',
    noImage: 'No snapshot',
    unavailable: 'Unavailable',
    live: 'Live',
    liveFailed: 'Live view failed',
    liveH265: 'H.265 can\'t play live. Try H.264.',
    renameFailed: 'Could not save the name.',
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
  /** The video's current frame as a JPEG data URL, or null before it has a size. */
  function captureFrame(video) {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    const scale = Math.min(1, GRAB_WIDTH / w);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  function preload(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => reject(new Error('Image failed'));
      img.src = src;
    });
  }

  /**
   * The names typed on the tiles (`renameTiles`; the app keeps them per widget instance, by tile key): `name(key, own)`
   * is the typed name, else `own`. In rename mode `field(key, own)` is the tile's text field (made once per key, with
   * `own` as the placeholder): it saves on change (Enter or leaving it), Escape puts it back, and a realtime update
   * doesn't overwrite it while it has the focus. Its touches, clicks and keys never reach the tile's own taps.
   * `failed(key)` shakes the tile and says so; the name goes back, unless the app's names came meanwhile.
   */
  function tileNames(opts, render, failed) {
    let names = {};
    let reads = 0; // set() calls: the app's names, by realtime or a read
    const fields = new Map();
    async function save(key, value) {
      const before = names[key];
      if ((before || '') === value) return;
      const put = v => { names = { ...names }; if (v) names[key] = v; else delete names[key]; };
      put(value);
      const seen = reads;
      render();
      try {
        if (opts.onRename) await opts.onRename(key, value);
      } catch (err) {
        console.error(err);
        // Only while it still shows this save's name and nothing came from the app since: what came says what the
        // app kept (a newer name, or this one when only the answer was lost).
        if (reads === seen && (names[key] || '') === value) put(before);
        failed(key);
      }
    }
    return {
      renaming: opts.renameTiles === true,
      name: (key, own) => names[key] || own,
      set(map) {
        reads++;
        names = {};
        if (map && typeof map === 'object') for (const [k, v] of Object.entries(map)) if (typeof v === 'string' && v) names[k] = v;
        render();
      },
      field(key, own) {
        let input = fields.get(key);
        if (!input) {
          input = document.createElement('input');
          input.type = 'text';
          input.className = 'wk-rename';
          input.dir = 'auto';
          input.maxLength = 60;
          input.autocomplete = 'off';
          input.setAttribute('enterkeyhint', 'done');
          const field = input;
          for (const type of ['touchstart', 'touchend', 'pointerdown', 'click']) field.addEventListener(type, e => e.stopPropagation(), { passive: true });
          field.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') field.blur();
            else if (e.key === 'Escape') { field.value = names[key] || ''; field.blur(); }
          });
          field.addEventListener('change', () => { field.value = field.value.trim(); save(key, field.value); });
          fields.set(key, input);
        }
        input.placeholder = own || '';
        input.setAttribute('aria-label', own || '');
        if (document.activeElement !== input) input.value = names[key] || '';
        return input;
      },
    };
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, refreshMs?: number,
   *   api?: (method: string, path: string, body?: object) => Promise<any>,
   *   report?: (text: string, warn?: boolean) => void, onHeight?: (h: number) => void,
   *   now?: () => number, renameTiles?: boolean, onRename?: (key: string, name: string) => Promise<any> }} opts
   */
  function createCamerasWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`cameras.${key}`, tokens) : null;
      if (s && s !== `cameras.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const now = opts.now || (() => Date.now());
    const refreshMs = opts.refreshMs || 10e3;
    const grabMs = Math.max(GRAB_MIN_MS, refreshMs);

    let devices = []; // [{ id, name, icon, image: { id, url, lastUpdated } | null, video, videos, h265 } | { id, missing }]
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
    /** The frame grab under way (a video-only camera). */
    let grab = null;
    const grabReported = new Set();
    /** Per camera, this session: the stream that last played, and the streams that failed before a frame. */
    const workingVideo = new Map();
    const failedVideos = new Map();

    root.classList.add('cw');
    const names = tileNames(opts, () => render(), (key) => {
      const tile = tiles.get(key);
      if (tile) {
        tile.tile.classList.remove('shake');
        void tile.tile.offsetWidth; // restart the animation
        tile.tile.classList.add('shake');
      }
      setMessage(t('renameFailed'), true);
    });
    root.classList.toggle('renaming', names.renaming);
    const grid = el('div', { class: 'cw-grid' }, root);
    const messageEl = el('div', { class: 'cw-message', dir: 'auto' }, root);
    /**
     * @type {Map<string, {tile: HTMLElement, img: HTMLImageElement, video: HTMLVideoElement, icon: HTMLElement,
     *   name: HTMLElement, badge: HTMLElement, note: HTMLElement, loadedAt: number, noteTimer: any,
     *   grabAt: number | null, grabFailed: boolean}>}
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
          if ('missing' in d) continue;
          if (live && live.id === d.id && live.playing) continue;
          const tile = tiles.get(d.id);
          if (!tile) continue;
          if (!d.image) {
            if (d.video) await grabInto(d, tile);
            continue;
          }
          try {
            const src = await loadSnapshot(d);
            if (tiles.get(d.id) !== tile) continue;
            showImage(tile, src);
          } catch (err) {
            console.error(err);
          }
          updateBadge(d.id);
        }
      } finally {
        refreshing = false;
      }
    }

    function showImage(tile, src) {
      tile.img.src = src;
      tile.loadedAt = now();
      tile.tile.classList.add('loaded');
    }

    /**
     * A video-only camera's picture: a frame from its stream, one stream at a time, at most every grabMs
     * (GRAB_RETRY_MS after a failure), and never while a camera is live.
     */
    async function grabInto(d, tile) {
      if (live || grab) return;
      if (tile.grabAt != null && now() - tile.grabAt < (tile.grabFailed ? GRAB_RETRY_MS : grabMs)) return;
      tile.grabAt = now();
      try {
        const src = await grabFrame(d, tile);
        if (src == null || tiles.get(d.id) !== tile) return; // cancelled, or the camera went
        tile.grabFailed = false;
        showImage(tile, src);
      } catch (err) {
        tile.grabFailed = true;
        if (!grabReported.has(d.id)) report(`frame grab of ${d.name} failed: ${err && err.message ? err.message : err}`, true);
        grabReported.add(d.id);
        render();
      }
      updateBadge(d.id);
    }

    /** The first frame of the first stream that gives one; null when cancelled. */
    async function grabFrame(d, tile) {
      const order = videoOrder(d);
      let error = null;
      for (let i = 0; i < order.length; i++) {
        const last = i === order.length - 1;
        try {
          const src = await grabStream(d, tile, order[i], last ? LIVE_TIMEOUT_MS : NEXT_STREAM_MS);
          if (src != null) streamWorked(d.id, order[i]);
          return src;
        } catch (err) {
          error = err;
          streamFailed(d.id, order[i]);
          if (tiles.get(d.id) !== tile) return null;
        }
      }
      throw error || new Error('no video');
    }

    /** Opens a stream just long enough to draw its first frame; resolves null when cancelled. */
    function grabStream(d, tile, videoId, timeoutMs) {
      return new Promise((resolve, reject) => {
        if (typeof RTCPeerConnection !== 'function') { reject(new Error('no WebRTC')); return; }
        const pc = new RTCPeerConnection();
        const video = tile.video;
        let finished = false;
        let retry = null;
        const finish = (result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          clearTimeout(retry);
          video.removeEventListener('playing', onPlaying);
          if (grab === g) grab = null;
          try { pc.close(); } catch (err) { /* already closed */ }
          video.pause();
          video.srcObject = null;
          if (result instanceof Error) reject(result);
          else resolve(result);
        };
        const g = { id: d.id, cancel: () => finish(null) };
        grab = g;
        const timer = setTimeout(() => finish(new Error(`no video after ${timeoutMs / 1000} s`)), timeoutMs);
        const take = () => {
          if (finished) return;
          let src = null;
          try { src = captureFrame(video); } catch (err) { finish(err); return; }
          if (src) finish(src);
          else retry = setTimeout(take, 250); // no size yet
        };
        const onPlaying = () => {
          if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(() => take());
          else retry = setTimeout(take, 100);
        };
        video.addEventListener('playing', onPlaying);
        pc.ontrack = (e) => {
          if (finished) return;
          video.srcObject = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
          const p = video.play();
          if (p && p.catch) p.catch(() => {});
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'failed') finish(new Error('connection failed'));
        };
        openStream(pc, videoId, () => !finished)
          .catch(err => finish(err instanceof Error ? err : new Error(String(err))));
      });
    }

    /** Sends the offer and sets Homey's answer; null when `current()` says the stream was dropped meanwhile. */
    async function openStream(pc, videoId, current) {
      pc.addTransceiver('video', { direction: 'recvonly' });
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc);
      if (!current()) return null;
      const res = await api('POST', '/video/offer', { videoId, offer: pc.localDescription.sdp });
      if (!current()) return null;
      await pc.setRemoteDescription({ type: 'answer', sdp: res.answer });
      return res;
    }

    /** A snapshot that hasn't refreshed for two intervals shows the time it was taken. */
    function updateBadge(id) {
      const tile = tiles.get(id);
      if (!tile) return;
      const d = devices.find(x => x.id === id);
      const every = d && !('missing' in d) && !d.image ? grabMs : refreshMs;
      const stale = tile.loadedAt > 0 && now() - tile.loadedAt > 2 * every + 5000;
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
      tile.noteTimer = setTimeout(() => { tile.note.style.display = 'none'; }, 6000);
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

    function stopLive(refreshAfter = true) {
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
        // A video-only camera keeps the last frame it showed live.
        const d = devices.find(x => x.id === l.id);
        if (l.playing && d && !('missing' in d) && !d.image) {
          let src = null;
          try { src = captureFrame(tile.video); } catch (err) { /* no frame */ }
          if (src) { tile.grabAt = now(); tile.grabFailed = false; showImage(tile, src); }
        }
        tile.video.pause();
        tile.video.srcObject = null;
        tile.tile.classList.remove('live', 'connecting');
        expand(tile, false);
        render();
      }
      if (refreshAfter) refresh();
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

    /**
     * The camera's streams in the order to try: the one that last played first, then those that haven't
     * failed this session, then those that have (they may work now), each group in the app's order.
     */
    function videoOrder(d) {
      const all = Array.isArray(d.videos) && d.videos.length ? d.videos : (d.video ? [d.video] : []);
      const failed = failedVideos.get(d.id);
      const ok = workingVideo.get(d.id);
      const rank = v => (v === ok ? 0 : failed && failed.has(v) ? 2 : 1);
      return all.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i).map(x => x.v);
    }

    function streamWorked(id, videoId) {
      workingVideo.set(id, videoId);
      const failed = failedVideos.get(id);
      if (failed) failed.delete(videoId);
    }

    function streamFailed(id, videoId) {
      if (workingVideo.get(id) === videoId) workingVideo.delete(id);
      if (!failedVideos.has(id)) failedVideos.set(id, new Set());
      failedVideos.get(id).add(videoId);
    }

    /** Every stream of the camera is H.265, which Homey's WebRTC refuses ("codecs not matched"). */
    function allH265(d) {
      const all = Array.isArray(d.videos) && d.videos.length ? d.videos : (d.video ? [d.video] : []);
      const h265 = Array.isArray(d.h265) ? d.h265 : [];
      return all.length > 0 && all.every(v => h265.includes(v));
    }

    function report(text, warn) {
      if (opts.report) opts.report(text, warn);
    }

    /**
     * Live view: the camera's streams one at a time (videoOrder) until one plays; a stream that gives no frame
     * in NEXT_STREAM_MS (LIVE_TIMEOUT_MS for the last), or whose offer or connection fails, makes way for the
     * next. Once one plays, losing it ends live view.
     */
    function startLive(d) {
      const tile = tiles.get(d.id);
      if (!tile || typeof RTCPeerConnection !== 'function') { note(d.id, t('liveFailed')); return; }
      if (grab) grab.cancel(); // one stream at a time
      const order = videoOrder(d);
      const l = {
        id: d.id, pc: null, videoId: null, playing: false, timeout: null, maxTimer: null, keepAlive: null,
        frameCheck: null, frames: 0, frameAt: 0, fail: null, keepAliveFailed: false,
      };
      live = l;
      l.fail = (why) => {
        if (live !== l) return;
        report(`live view of ${d.name} failed: ${why}`, true);
        stopLive();
        note(d.id, t('liveFailed'));
      };
      const giveUp = () => {
        if (live !== l) return;
        report(`live view of ${d.name}: none of its ${order.length} streams played`, true);
        stopLive();
        note(d.id, t(allH265(d) ? 'liveH265' : 'liveFailed'));
      };
      tile.tile.classList.add('connecting');
      expand(tile, true);
      l.maxTimer = setTimeout(() => { if (live === l) stopLive(); }, LIVE_MAX_MS);

      const attempt = (i) => {
        if (live !== l) return;
        if (i >= order.length) { giveUp(); return; }
        if (l.pc) { try { l.pc.close(); } catch (err) { /* already closed */ } }
        clearTimeout(l.timeout);
        clearInterval(l.keepAlive);
        tile.video.srcObject = null;
        const videoId = order[i];
        const pc = new RTCPeerConnection();
        l.pc = pc;
        l.videoId = videoId;
        l.keepAliveFailed = false;
        const current = () => live === l && l.pc === pc;
        const next = (why) => {
          if (!current() || l.playing) return;
          streamFailed(d.id, videoId);
          report(`live view of ${d.name}: stream ${i + 1} of ${order.length} failed: ${why}`, true);
          attempt(i + 1);
        };
        const wait = i === order.length - 1 ? LIVE_TIMEOUT_MS : NEXT_STREAM_MS;
        l.timeout = setTimeout(() => next(`no video after ${wait / 1000} s`), wait);
        pc.ontrack = (e) => {
          if (!current()) return;
          tile.video.srcObject = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
          const p = tile.video.play();
          if (p && p.catch) p.catch(() => {});
        };
        pc.onconnectionstatechange = () => {
          if (!current() || pc.connectionState !== 'failed') return;
          if (l.playing) l.fail('connection failed');
          else next('connection failed');
        };
        openStream(pc, videoId, current).then((res) => {
          if (!res || !current() || !res.streamId) return;
          l.keepAlive = setInterval(() => {
            api('POST', '/video/keepalive', { videoId, streamId: res.streamId }).catch((err) => {
              // A rejected keep-alive ends the stream on Homey's side; the frame check then ends live view.
              if (l.keepAliveFailed) return;
              l.keepAliveFailed = true;
              report(`live view of ${d.name}: keep-alive failed: ${err && err.message ? err.message : err}`, true);
            });
          }, KEEPALIVE_MS);
        }).catch(err => next(err && err.message ? err.message : String(err)));
      };
      attempt(0);
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
      streamWorked(id, l.videoId);
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
      if (!d || 'missing' in d || !d.video || names.renaming) return;
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
      tile = {
        tile: node, img, video, icon, name, badge, note: noteEl, loadedAt: 0, noteTimer: null,
        grabAt: null, grabFailed: false,
      };

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
        // Every touch: one that moved past TAP_SLOP can still get the browser's click.
        lastTouchTap = Date.now(); // the real clock: opts.now may be fixed
        if (!tap) return;
        e.preventDefault(); // no click after it
        press(id);
      });
      node.addEventListener('touchcancel', () => { start = null; });
      node.addEventListener('click', () => {
        if (Date.now() - lastTouchTap < 800) return;
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
        tile.name.textContent = missing ? t('unavailable') : names.name(d.id, d.name);
        if (names.renaming && !missing) {
          const field = names.field(d.id, d.name);
          if (field.previousSibling !== tile.name) tile.name.after(field);
        }
        setMask(tile.icon, missing ? null : d.icon);
        tile.icon.classList.toggle('fallback', missing || !d.icon);
        tile.tile.classList.toggle('missing', missing);
        // "No snapshot": no image and no video to grab a frame from, or a failed grab before any frame.
        const empty = !missing && !d.image && (!d.video || (tile.grabFailed && !tile.loadedAt));
        tile.tile.classList.toggle('no-image', empty);
        tile.tile.classList.toggle('has-video', !missing && !!d.video);
        // A lone tile, or the last of an odd number, spans the row.
        tile.tile.classList.toggle('wide', i === devices.length - 1 && devices.length % 2 === 1);
        if (empty) tile.note.style.display = 'none';
        tile.tile.setAttribute('data-empty', !empty ? '' : d.video && allH265(d) ? t('liveH265') : t('noImage'));
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
    function pause() {
      if (grab) grab.cancel();
      stopLive(false);
    }

    return { setState, setNames: names.set, setMessage, refresh, render, pause, t, routeOf: (id) => (appRoute.has(id) ? 'app' : 'direct') };
  }

  window.createCamerasWidget = createCamerasWidget;
})();
