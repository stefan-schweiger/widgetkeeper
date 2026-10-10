/*
 * Smart Stack: this app's widgets from another dashboard, one page at a time. The pages rotate every few seconds;
 * a swipe (or a tap on a dot) moves by hand and pauses the rotation for a while. With smart rotate a page comes
 * forward while something happens on it (music playing, a timer, an alarm, someone on a camera, a door open or
 * unlocked), and a Flow card can bring a widget type forward for some minutes.
 *
 * The stack only arranges the pages: index.html mounts each page's own widget into the slide this gives it (the
 * widget's mount.js, with a Homey of the stack's making). Plain browser JS, served as-is.
 */
(function () {
  /** The widgets a page can be, and their mount function (`window[...]`, from the widget's mount.js). */
  const TYPES = {
    electricity: 'mountElectricityWidget', thermostat: 'mountThermostatWidget', quickactions: 'mountQuickActionsWidget',
    sensoralarms: 'mountSensorAlarmsWidget', sensordots: 'mountSensorDotsWidget', weather: 'mountWeatherWidget',
    heatmap: 'mountHeatmapWidget', cameras: 'mountCamerasWidget', values: 'mountValuesWidget', lights: 'mountLightsWidget',
    sparklines: 'mountSparklinesWidget', variables: 'mountVariablesWidget', flows: 'mountFlowsWidget', price: 'mountPriceWidget',
    timers: 'mountTimersWidget', locks: 'mountLocksWidget', curtains: 'mountCurtainsWidget', media: 'mountMediaWidget',
  };

  const KEY_PROBLEMS = ['noKey', 'keyScope', 'keyInvalid'];

  /** A camera's detections that bring its page forward. */
  const CAMERA_DETECTIONS = ['alarm_person', 'alarm_vehicle', 'alarm_pet', 'alarm_motion'];
  /**
   * Sensor Alarms' "states" (lib/SensorAlarmService.ts): only counted with the widget's `includeStates`. Used for an
   * alarm an event brings that the last read didn't have.
   */
  const STATE_ALARMS = ['alarm_motion', 'alarm_contact', 'alarm_person', 'alarm_vehicle', 'alarm_pet'];
  /** Locks and Doors: a value that isn't secure (`LOCK_CAPS` in lib/LockService.ts). */
  const INSECURE = { locked: false, alarm_contact: true, garagedoor_closed: false };

  const baseId = (capabilityId) => String(capabilityId || '').split('.')[0];

  /**
   * Whether a page wants to be seen, from the state the watcher keeps (`createAttentionWatcher`). Types without a
   * rule never do.
   * @param {{ type: string, settings?: Record<string, any> }} page
   * @param {{ playing?: boolean, timers?: any[], alarms?: Record<string, Record<string, { value: unknown, state?: boolean }>>,
   *   locks?: Record<string, Record<string, unknown>> }} state
   */
  function stackAttention(page, state) {
    if (!state) return false;
    switch (page.type) {
      case 'media': return state.playing === true;
      case 'timers': return Array.isArray(state.timers) && state.timers.length > 0;
      case 'cameras':
        return Object.values(state.alarms || {}).some(caps => Object.entries(caps)
          .some(([id, a]) => a.value === true && CAMERA_DETECTIONS.includes(baseId(id))));
      case 'sensoralarms': {
        // As the widget counts them: motion, contact and camera detections only with its `includeStates` setting.
        const includeStates = !!(page.settings && page.settings.includeStates === true);
        return Object.values(state.alarms || {}).some(caps => Object.values(caps)
          .some(a => a.value === true && (!a.state || includeStates)));
      }
      case 'locks':
        return Object.values(state.locks || {}).some(caps => Object.entries(caps)
          .some(([id, value]) => INSECURE[baseId(id)] === value));
      default: return false;
    }
  }

  /**
   * Keeps the state `stackAttention()` needs for each page, from the pages' own widget routes (`call`) and the app's
   * realtime events (`on`), and says when a page's attention changes. The speaker of a media page is `speakerOf()`'s
   * (the one this screen switched to, else the default).
   * @param {any[]} pages
   * @param {{ call: (type: string, method: string, path: string, query: object) => Promise<any>,
   *   on: (event: string, fn: (data: any) => void) => void, onChange: (pageId: string, on: boolean) => void,
   *   speakerOf?: (page: any) => string | null }} io
   */
  function createAttentionWatcher(pages, io) {
    const states = new Map(); // page id → its state
    const flags = new Map(); // page id → attention
    const watched = pages.filter(p => ['media', 'timers', 'cameras', 'sensoralarms', 'locks'].includes(p.type));
    const speaker = (p) => (io.speakerOf ? io.speakerOf(p) : null) || (p.settings && p.settings.device && p.settings.device.id) || null;

    function update(page, change) {
      const state = Object.assign(states.get(page.id) || {}, change);
      states.set(page.id, state);
      const on = stackAttention(page, state);
      if (flags.get(page.id) === on) return;
      flags.set(page.id, on);
      io.onChange(page.id, on);
    }

    /** `/state` of Sensor Alarms (also for cameras) → deviceId → capabilityId → {value, state}. */
    function alarmsOf(entries) {
      const out = {};
      for (const d of Array.isArray(entries) ? entries : []) {
        if (!d || d.missing || !Array.isArray(d.alarms)) continue;
        out[d.id] = {};
        for (const a of d.alarms) out[d.id][a.capabilityId] = { value: a.value, state: a.state };
      }
      return out;
    }
    function locksOf(res) {
      const out = {};
      for (const d of (res && Array.isArray(res.devices) ? res.devices : [])) {
        if (!d || d.missing || !d.caps) continue;
        out[d.id] = {};
        for (const [id, c] of Object.entries(d.caps)) out[d.id][id] = c && c.value;
      }
      return out;
    }

    /** Reads every watched page's state (at load, and every few minutes in case an event was missed). */
    function refresh() {
      return Promise.all(watched.map(async (page) => {
        try {
          if (page.type === 'media') {
            const deviceId = speaker(page);
            if (!deviceId) return;
            const res = await io.call('media', 'GET', '/state', { deviceId });
            const playing = res && res.caps && res.caps.speaker_playing;
            update(page, { playing: !!(playing && playing.value === true) });
          } else if (page.type === 'timers') {
            const res = await io.call('timers', 'GET', '/state', { instance: page.id });
            update(page, { timers: (res && res.timers) || [] });
          } else if (page.type === 'cameras' || page.type === 'sensoralarms') {
            if (!page.deviceIds.length) return;
            const res = await io.call('sensoralarms', 'GET', '/state', { deviceIds: page.deviceIds.join(',') });
            update(page, { alarms: alarmsOf(res) });
          } else if (page.type === 'locks') {
            if (!page.deviceIds.length) return;
            const res = await io.call('locks', 'GET', '/state', { deviceIds: page.deviceIds.join(',') });
            update(page, { locks: locksOf(res) });
          }
        } catch (err) {
          console.error(err); // the page keeps its last attention
        }
      }));
    }

    io.on('media:state', (d) => {
      if (!d || d.capabilityId !== 'speaker_playing') return;
      for (const p of watched) if (p.type === 'media' && speaker(p) === d.deviceId) update(p, { playing: d.value === true });
    });
    io.on('timers:state', (d) => {
      for (const p of watched) if (p.type === 'timers' && d && d.instance === p.id) update(p, { timers: d.timers || [] });
    });
    io.on('sensoralarms:state', (d) => {
      if (!d) return;
      for (const p of watched) {
        if ((p.type !== 'cameras' && p.type !== 'sensoralarms') || !p.deviceIds.includes(d.deviceId)) continue;
        const alarms = Object.assign({}, (states.get(p.id) || {}).alarms);
        const caps = Object.assign({}, alarms[d.deviceId]);
        const known = caps[d.capabilityId];
        caps[d.capabilityId] = { value: d.value, state: known ? known.state : STATE_ALARMS.includes(baseId(d.capabilityId)) };
        alarms[d.deviceId] = caps;
        update(p, { alarms });
      }
    });
    io.on('locks:state', (d) => {
      if (!d) return;
      for (const p of watched) {
        if (p.type !== 'locks' || !p.deviceIds.includes(d.deviceId)) continue;
        const locks = Object.assign({}, (states.get(p.id) || {}).locks);
        locks[d.deviceId] = Object.assign({}, locks[d.deviceId], { [d.capabilityId]: d.value });
        update(p, { locks });
      }
    });

    return { refresh, attention: (id) => flags.get(id) === true };
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, intervalMs?: number, smart?: boolean, resumeAfterMs?: number,
   *   showDots?: boolean, dotsPosition?: 'above' | 'below', dotsSize?: 'small' | 'large', now?: () => number, onHeight?: (h: number) => void, onHaptic?: () => void,
   *   onVisible?: (page: any, visible: boolean) => void }} opts
   */
  function createStackWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`stack.${key}`, tokens) : null;
      if (s && s !== `stack.${key}`) return s;
      return key;
    };
    const now = opts.now || (() => Date.now());
    const intervalMs = opts.intervalMs || 0; // 0: no rotation
    const resumeAfterMs = opts.resumeAfterMs || 60e3;
    const TICK_MS = 1000;

    root.classList.add('sk');
    // The dots go above the pages or below them (the default), small or large (easier to tap).
    root.classList.toggle('dots-above', opts.dotsPosition === 'above');
    root.classList.toggle('dots-large', opts.dotsSize === 'large');
    const track = document.createElement('div');
    track.className = 'sk-track';
    const dots = document.createElement('div');
    dots.className = 'sk-dots';
    const message = document.createElement('div');
    message.className = 'sk-message';
    message.setAttribute('dir', 'auto');
    root.append(track, dots, message);

    /** @type {{ page: any, slide: HTMLElement, root: HTMLElement, dot: HTMLElement, visible?: boolean }[]} */
    let pages = [];
    let current = 0;
    let shownAt = now(); // when the current page came on screen
    let pausedUntil = 0; // a swipe or tap: nothing moves on its own until then
    const attention = new Map(); // page id → when it started wanting attention
    const dismissed = new Set(); // pages the user moved away from while they wanted attention
    const requests = new Map(); // type → until (Flow cards)
    let lastHeight = -1;

    // ---------------------------------------------------------------- pages

    /**
     * Builds a slide per page and returns them, for index.html to mount each page's widget into (`root`), with the
     * slide as its frame (it carries the widget's frame classes).
     */
    function setPages(list) {
      message.textContent = '';
      root.classList.remove('has-message');
      track.textContent = '';
      dots.textContent = '';
      pages = list.map((page, i) => {
        const slide = document.createElement('div');
        const mount = TYPES[page.type] ? /** @type {any} */ (window)[TYPES[page.type]] : null;
        const frameClass = (mount && mount.frameClass) || 'homey-widget-full';
        // A widget that isn't transparent (`homey-widget`, not `homey-widget-full`) gets the card Homey would draw.
        const card = frameClass.split(/\s+/).includes('homey-widget');
        slide.className = `sk-slide ${frameClass}${card ? ' sk-card' : ''}`;
        slide.dataset.type = page.type;
        const pageRoot = document.createElement('div');
        slide.append(pageRoot);
        track.append(slide);
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'sk-dot';
        dot.setAttribute('aria-label', page.title || page.type);
        onTap(dot, () => { userMoved(); go(i, true, true); });
        dots.append(dot);
        return { page, slide, root: pageRoot, dot };
      });
      root.classList.toggle('no-dots', opts.showDots === false || pages.length < 2);
      current = Math.min(current, Math.max(0, pages.length - 1));
      shownAt = now();
      for (const p of pages) observer && observer.observe(p.slide);
      paint();
      pickNow();
      return pages.map(p => ({ page: p.page, root: p.root, frame: p.slide }));
    }

    function setMessage(text, isError) {
      track.textContent = '';
      dots.textContent = '';
      pages = [];
      message.textContent = text;
      message.classList.toggle('error', !!isError);
      root.classList.add('has-message', 'no-dots');
      measure();
    }

    // ---------------------------------------------------------------- choosing the page

    /** Drops the Flow requests that have run out; true when there were any. */
    function expire() {
      const t0 = now();
      let any = false;
      for (const [type, until] of requests) {
        if (until <= t0) { requests.delete(type); any = true; }
      }
      return any;
    }

    /** The pages that should be on screen now (a Flow request, else attention), or null for plain rotation. */
    function wanted() {
      expire();
      const requested = pages.filter(p => requests.has(p.page.type));
      if (requested.length) {
        // The newest request first.
        return requested.sort((a, b) => requests.get(b.page.type) - requests.get(a.page.type));
      }
      if (opts.smart === false) return null;
      const urgent = pages.filter(p => attention.has(p.page.id) && !dismissed.has(p.page.id));
      return urgent.length ? urgent.sort((a, b) => attention.get(b.page.id) - attention.get(a.page.id)) : null;
    }

    /** Moves to the page that should show, if it isn't already showing (not while the user holds the stack still). */
    function pickNow() {
      if (!pages.length || now() < pausedUntil) return;
      const want = wanted();
      if (want && !want.includes(pages[current])) go(pages.indexOf(want[0]), false);
    }

    function tick() {
      if (!pages.length) return;
      if (expire()) paint();
      if (document.hidden) return;
      const t0 = now();
      if (t0 < pausedUntil) return;
      const want = wanted();
      if (want) {
        if (!want.includes(pages[current])) go(pages.indexOf(want[0]), false);
        else if (want.length > 1 && intervalMs && t0 - shownAt >= intervalMs) {
          go(pages.indexOf(want[(want.indexOf(pages[current]) + 1) % want.length]), false);
        }
        return;
      }
      if (intervalMs && pages.length > 1 && t0 - shownAt >= intervalMs) go((current + 1) % pages.length, false);
    }
    const timer = setInterval(tick, TICK_MS);

    /** A swipe, a dot or a touch on the page: the stack holds still for a while. */
    function userMoved() {
      pausedUntil = now() + resumeAfterMs;
      shownAt = now();
    }

    /** Shows page `i`. When the user moves away from a page that wants attention, it only comes back the next time. */
    function go(i, smooth, byUser) {
      if (i < 0 || i >= pages.length) return;
      const from = pages[current];
      if (byUser && i !== current && from && attention.has(from.page.id)) dismissed.add(from.page.id);
      const changed = i !== current;
      current = i;
      shownAt = now();
      scrollTo(i, smooth);
      paint();
      if (changed && opts.onHaptic) opts.onHaptic();
    }

    let programmatic = 0; // until when a scroll is ours (real time: `opts.now` may be a fixed clock)
    function scrollTo(i, smooth) {
      const left = i * track.clientWidth;
      if (Math.abs(track.scrollLeft - left) < 1) return;
      programmatic = Date.now() + 800;
      try { track.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { track.scrollLeft = left; }
    }

    function paint() {
      pages.forEach((p, i) => {
        p.dot.classList.toggle('on', i === current);
        p.dot.classList.toggle('alert', attention.has(p.page.id) || requests.has(p.page.type));
        p.slide.setAttribute('aria-hidden', i === current ? 'false' : 'true');
        const visible = i === current;
        if (p.visible !== visible) {
          p.visible = visible;
          if (opts.onVisible) opts.onVisible(p.page, visible);
        }
      });
      measure();
    }

    // A swipe: the track scrolls natively (snapping to a page), and the page it settles on becomes the current one.
    let scrollTimer = null;
    track.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const w = track.clientWidth;
        if (!w || !pages.length) return;
        const i = Math.max(0, Math.min(pages.length - 1, Math.round(track.scrollLeft / w)));
        if (Date.now() > programmatic && i !== current) {
          userMoved();
          go(i, false, true);
        }
      }, 120);
    }, { passive: true });
    // Any touch on a page (a slider, an overlay, a button): the user is using it, so it stays.
    track.addEventListener('pointerdown', () => { if (pages.length > 1) userMoved(); }, { passive: true });

    // ---------------------------------------------------------------- height

    /** The widget's height follows the current page (and the dots under it). */
    function measure() {
      const p = pages[current];
      const pageH = p ? Math.ceil(p.slide.getBoundingClientRect().height) : 0;
      track.style.height = p ? `${pageH}px` : '';
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h !== lastHeight) {
        lastHeight = h;
        if (opts.onHeight) opts.onHeight(h);
      }
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      measure();
      scrollTo(current, false); // a new width moves the snap points
    }) : null;
    if (observer) observer.observe(track);

    // ---------------------------------------------------------------- smart rotate and Flows

    /**
     * A page started or stopped wanting attention. One that starts takes the screen (unless a Flow's request or a
     * move by hand holds it); several then take turns.
     */
    function setAttention(pageId, on) {
      const started = on && !attention.has(pageId);
      if (started) attention.set(pageId, now());
      if (!on) {
        attention.delete(pageId);
        dismissed.delete(pageId); // it may come back the next time it starts
      }
      if (now() >= pausedUntil) {
        const i = pages.findIndex(p => p.page.id === pageId);
        const want = wanted();
        if (started && i >= 0 && want && want.includes(pages[i])) go(i, false);
        else pickNow();
      }
      paint();
    }

    /**
     * A Flow brings this widget type forward until `until` (ms, this screen's time: mount.js corrects the Homey's
     * clock); it moves even while the stack holds still.
     */
    function request(type, until) {
      if (!(until > now())) return;
      requests.set(type, until);
      pausedUntil = 0;
      pickNow();
      paint();
    }

    function resume() {
      requests.clear();
      paint();
    }

    /**
     * The requests still running, from a refresh (`until` in this screen's time). One that's new here (its event was
     * missed) acts like `request()`: it moves the stack even while the user holds it.
     */
    function setRequests(list) {
      const before = new Map(requests);
      requests.clear();
      for (const r of list || []) if (r && r.until > now()) requests.set(r.type, r.until);
      if ([...requests.keys()].some(type => !before.has(type))) pausedUntil = 0;
      pickNow();
      paint();
    }

    return {
      t,
      setPages,
      setMessage,
      setAttention,
      request,
      resume,
      setRequests,
      measure,
      tick,
      go: (i) => { userMoved(); go(i, false, true); },
      current: () => (pages[current] ? pages[current].page : null),
      destroy: () => { clearInterval(timer); if (observer) observer.disconnect(); },
    };
  }

  /**
   * Quick Actions' tap: a touch that ends within 10 px of where it started (a drag scrolls the dashboard), or a
   * click for mouse and keyboard.
   */
  function onTap(el, fn) {
    let start = null;
    let touched = 0;
    el.addEventListener('touchstart', (e) => {
      const p = e.touches[0];
      start = { x: p.clientX, y: p.clientY };
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      const p = e.changedTouches[0];
      if (start && Math.hypot(p.clientX - start.x, p.clientY - start.y) < 10) {
        touched = Date.now();
        e.preventDefault();
        fn();
      }
      start = null;
    });
    el.addEventListener('click', () => { if (Date.now() - touched > 600) fn(); });
  }

  window.createStackWidget = createStackWidget;
  window.createStackAttentionWatcher = createAttentionWatcher;
  window.stackAttention = stackAttention;
  window.STACK_TYPES = TYPES;
  window.STACK_KEY_PROBLEMS = KEY_PROBLEMS;
})();
