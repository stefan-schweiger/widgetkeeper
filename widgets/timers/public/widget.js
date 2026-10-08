/*
 * Timers: a kitchen timer started from preset buttons. One timer at a time: while it runs, its row takes the
 * presets' place, so the widget keeps its height. The row shows the time left, filling down as it runs; a tap
 * pauses or resumes it, +1 adds a minute and ✕ cancels it (the presets come back). When it runs out the row turns
 * red and it beeps (when allowed) until it's dismissed with a tap. The timer runs in the app.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const TAP_SLOP = 10; // px a finger may move and still count as a tap
  const MINUTE = 60e3;
  const BEEP_EVERY = 2000; // ms between the beeps of a ringing timer
  const BEEP_FOR = 60e3; // how long a finished timer beeps

  const DEFAULT_STRINGS = {
    selectPresets: 'Set up timers in the widget settings.',
    error: 'Could not load the timers.',
    failed: 'Could not change the timer.',
    minutes: '__minutes__ min',
    hours: '__hours__ h',
    seconds: '__seconds__ s',
    endsAt: 'Ends __time__',
    paused: 'Paused',
    done: 'Done',
    pause: 'Pause',
    resume: 'Resume',
    dismiss: 'Dismiss',
    addMinute: 'Add a minute',
    cancel: 'Cancel',
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** 24 px glyphs with a 2 px round stroke (Flow Buttons' style); `fill` for a filled shape. */
  const GLYPHS = {
    pause: { fill: true, d: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' },
    play: { fill: true, d: 'M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z' },
    bell: { d: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 21h4' },
    close: { d: 'M7 7l10 10M17 7 7 17' },
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

  function glyph(name) {
    const g = GLYPHS[name];
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'tm-glyph');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', g.d);
    if (g.fill) path.setAttribute('class', 'filled');
    svg.appendChild(path);
    return svg;
  }

  /**
   * A tap: a touch that ends within TAP_SLOP of where it started (a drag is left to the dashboard, so it
   * still scrolls), or a click from a mouse or keyboard. Quick Actions' logic; a button's tap isn't also its row's.
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
      e.stopPropagation();
      lastTouchTap = Date.now();
      fn(e);
    });
    node.addEventListener('touchcancel', unpress);
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() - lastTouchTap < 800) return;
      fn(e);
    });
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      fn(e);
    });
  }

  /** Time left as `4:05`, or `1:02:03` from an hour; rounded up, so it shows 0:00 only once it's done. */
  function formatRemaining(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  /** The presets from the widget settings: `minutesN` (a number; 0 or empty hides it) and `labelN`, N = 1…4. */
  function timerPresetsFromSettings(settings) {
    const out = [];
    for (const n of [1, 2, 3, 4]) {
      const minutes = Number(settings && settings[`minutes${n}`]);
      if (!(minutes > 0) || minutes > 24 * 60) continue;
      const label = settings[`label${n}`];
      out.push({ minutes, label: typeof label === 'string' ? label.trim() : '' });
    }
    return out;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string,
   *   presets?: {minutes: number, label: string}[], sound?: boolean,
   *   onStart?: (minutes: number, label: string) => Promise<any>,
   *   onAction?: (id: string, action: string) => Promise<any>,
   *   onHaptic?: () => void, now?: () => number, onHeight?: (h: number) => void }} opts
   */
  function createTimersWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`timers.${key}`, tokens) : null;
      if (s && s !== `timers.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const presets = Array.isArray(opts.presets) ? opts.presets.slice(0, 4) : [];
    const nf = v => v.toLocaleString(opts.locale || undefined, { maximumFractionDigits: 1 });

    /** `10 min`, `1 h 30 min`, `30 s`. */
    function durationText(minutes) {
      if (minutes < 1) return t('seconds', { seconds: nf(Math.round(minutes * 60)) });
      if (minutes < 60) return t('minutes', { minutes: nf(minutes) });
      const h = Math.floor(minutes / 60);
      const m = minutes - h * 60;
      return m ? `${t('hours', { hours: nf(h) })} ${t('minutes', { minutes: nf(m) })}` : t('hours', { hours: nf(h) });
    }

    let timers = []; // at most one, as lib/TimerService.ts: { id, label, duration, endsAt, remaining, doneAt }
    let offset = 0; // the Homey's clock minus ours
    let messageText = null;
    let messageTimer = null;
    let localId = 0;
    const clock = opts.now || (() => Date.now()); // the screen's clock (the previews fix it)
    const serverNow = () => clock() + offset;

    root.classList.add('tm');
    const presetsEl = el('div', { class: 'tm-presets' }, root);
    presetsEl.style.setProperty('--tm-presets', String(Math.max(1, presets.length)));
    for (const p of presets) {
      const chip = el('div', { class: 'tm-preset', role: 'button', tabindex: '0' }, presetsEl);
      const top = el('div', { class: 'tm-preset-top' }, chip);
      top.appendChild(glyph('play'));
      el('span', { class: 'tm-preset-name', dir: 'auto', text: p.label || durationText(p.minutes) }, top);
      if (p.label) el('div', { class: 'tm-preset-time', text: durationText(p.minutes) }, chip);
      onTap(chip, () => start(p));
    }
    const list = el('div', { class: 'tm-list' }, root);
    const messageEl = el('div', { class: 'tm-message', dir: 'auto' }, root);
    /** @type {Map<string, {row: HTMLElement, button: HTMLElement, name: HTMLElement, sub: HTMLElement, time: HTMLElement, glyph: string}>} */
    const rows = new Map();

    const isDone = (tm, now) => tm.doneAt != null || (tm.endsAt != null && tm.endsAt <= now);
    const remainingOf = (tm, now) => (tm.remaining != null ? tm.remaining : tm.endsAt != null ? tm.endsAt - now : 0);

    /** `/state`'s answer (or a realtime event): `{timers, now}`. */
    function setState(state) {
      if (!state || !Array.isArray(state.timers)) return;
      if (typeof state.now === 'number') offset = state.now - clock();
      timers = state.timers.slice(-1).map(x => ({ ...x }));
      render();
    }

    /** A message under the timers. Persistent messages also clear them. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 6000);
      else timers = [];
      render();
    }

    function haptic() {
      try { if (opts.onHaptic) opts.onHaptic(); } catch (err) { /* not on every platform */ }
    }

    async function start(preset) {
      unlockAudio();
      haptic();
      const now = serverNow();
      // Shown at once, in the presets' place; the app's answer replaces it.
      const before = timers;
      const local = { id: `local-${++localId}`, label: preset.label, duration: preset.minutes * MINUTE,
        endsAt: now + preset.minutes * MINUTE, remaining: null, doneAt: null };
      timers = [local];
      render();
      try {
        const state = opts.onStart ? await opts.onStart(preset.minutes, preset.label) : null;
        if (state) setState(state);
      } catch (err) {
        console.error(err);
        if (timers[0] === local) timers = before;
        setMessage(t('failed'), true);
      }
    }

    /** Applies an action at once (as the app will), then sends it; the app's answer replaces the timers. */
    async function act(id, action) {
      unlockAudio();
      haptic();
      const tm = timers.find(x => x.id === id);
      if (!tm) return;
      const now = serverNow();
      if (action === 'pause' && tm.endsAt != null) { tm.remaining = Math.max(0, tm.endsAt - now); tm.endsAt = null; }
      if (action === 'resume' && tm.remaining != null) { tm.endsAt = now + tm.remaining; tm.remaining = null; }
      if (action === 'add') {
        tm.duration += MINUTE;
        if (tm.endsAt != null) tm.endsAt += MINUTE;
        if (tm.remaining != null) tm.remaining += MINUTE;
      }
      if (action === 'cancel' || action === 'dismiss') timers = timers.filter(x => x !== tm);
      render();
      if (String(id).startsWith('local-')) return; // not in the app yet
      try {
        const state = opts.onAction ? await opts.onAction(id, action) : null;
        if (state) setState(state);
      } catch (err) {
        console.error(err);
        const row = rows.get(id);
        if (row) {
          row.row.classList.remove('shake');
          void row.row.offsetWidth;
          row.row.classList.add('shake');
        }
        setMessage(t('failed'), true);
      }
    }

    /** The row tap: pause a running timer, resume a paused one, dismiss a finished one. */
    function primary(id) {
      const tm = timers.find(x => x.id === id);
      if (!tm) return;
      if (isDone(tm, serverNow())) act(id, 'dismiss');
      else act(id, tm.endsAt != null ? 'pause' : 'resume');
    }

    function rowFor(tm) {
      let r = rows.get(tm.id);
      if (r) return r;
      const row = el('div', { class: 'tm-row', role: 'button', tabindex: '0', 'data-id': tm.id });
      const button = el('div', { class: 'tm-button' }, row);
      const text = el('div', { class: 'tm-text' }, row);
      const name = el('div', { class: 'tm-name', dir: 'auto' }, text);
      const sub = el('div', { class: 'tm-sub', dir: 'auto' }, text);
      const time = el('div', { class: 'tm-time' }, row);
      const add = el('div', { class: 'tm-small tm-add', role: 'button', tabindex: '0', 'aria-label': t('addMinute') }, row);
      el('span', { class: 'tm-add-text', text: '+1' }, add);
      const cancel = el('div', { class: 'tm-small tm-cancel', role: 'button', tabindex: '0', 'aria-label': t('cancel') }, row);
      cancel.appendChild(glyph('close'));
      onTap(row, () => primary(tm.id));
      onTap(add, () => act(tm.id, 'add'));
      onTap(cancel, () => act(tm.id, 'cancel'));
      r = { row, button, name, sub, time, glyph: '' };
      rows.set(tm.id, r);
      return r;
    }

    const pad2 = n => String(n).padStart(2, '0');
    /** A Homey time as the local clock time; the offset only matters for what's left. */
    const clockTime = ms => { const d = new Date(ms - offset); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

    /** Time left, the fill, the sub text and the button of one row. */
    function paint(tm, now) {
      const r = rowFor(tm);
      const done = isDone(tm, now);
      const state = done ? 'done' : tm.endsAt == null ? 'paused' : 'running';
      r.row.dataset.state = state;
      r.name.textContent = tm.label || durationText(tm.duration / MINUTE);
      const left = done ? 0 : remainingOf(tm, now);
      r.time.textContent = formatRemaining(left);
      r.sub.textContent = done ? t('done') : state === 'paused' ? t('paused') : t('endsAt', { time: clockTime(tm.endsAt) });
      r.row.style.setProperty('--tm-left', `${tm.duration > 0 ? Math.min(100, Math.max(0, left / tm.duration * 100)) : 0}%`);
      const g = done ? 'bell' : state === 'paused' ? 'play' : 'pause';
      if (r.glyph !== g) {
        r.glyph = g;
        r.button.textContent = '';
        r.button.appendChild(glyph(g));
      }
      r.row.setAttribute('aria-label', `${r.name.textContent}: ${r.time.textContent}, ${done ? t('dismiss') : state === 'paused' ? t('resume') : t('pause')}`);
      return done;
    }

    let lastHeight = 0;
    let ringing = new Set(); // ids that were done at the last paint, to beep and buzz once each
    function render() {
      const now = serverNow();
      const ids = new Set(timers.map(x => x.id));
      for (const [id, r] of rows) {
        if (!ids.has(id)) { r.row.remove(); rows.delete(id); }
      }
      const done = new Set();
      for (const tm of timers) {
        const r = rowFor(tm);
        list.appendChild(r.row);
        if (paint(tm, now)) done.add(tm.id);
      }
      for (const id of done) if (!ringing.has(id)) { haptic(); startBeeping(); }
      ringing = done;
      if (!done.size) stopBeeping();
      // One row: the presets, or the timer in their place.
      list.style.display = timers.length ? '' : 'none';
      presetsEl.style.display = presets.length && !timers.length ? '' : 'none';
      const text = messageText || (!presets.length && !timers.length ? t('selectPresets') : null);
      messageEl.textContent = text || '';
      messageEl.style.display = text ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && (presets.length > 0 || timers.length > 0));
      scheduleTick();

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    // Repaints the running timers four times a second (only their text and fill; the rows stay).
    let ticker = null;
    function scheduleTick() {
      const running = timers.some(x => x.endsAt != null && x.doneAt == null);
      if (running && !ticker) {
        ticker = setInterval(() => {
          const now = serverNow();
          let newlyDone = false;
          for (const tm of timers) {
            if (tm.endsAt == null || tm.doneAt != null) continue;
            if (paint(tm, now) && !ringing.has(tm.id)) newlyDone = true;
          }
          if (newlyDone) render(); // rings, until the app's own "done" arrives
        }, 250);
      } else if (!running && ticker) {
        clearInterval(ticker);
        ticker = null;
      }
    }

    // ---------------------------------------------------------------- sound
    // A WebView only plays sound after a touch, so the audio is unlocked by the first tap on the widget.
    let audio = null;
    let beepTimer = null;
    let beepUntil = 0;
    function unlockAudio() {
      if (opts.sound === false) return;
      try {
        const Ctx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
        if (!audio && Ctx) audio = new Ctx();
        if (audio && audio.state === 'suspended') audio.resume();
      } catch (err) { audio = null; }
    }
    function beep() {
      if (!audio || audio.state !== 'running') return;
      try {
        for (let i = 0; i < 3; i++) {
          const at = audio.currentTime + i * 0.22;
          const osc = audio.createOscillator();
          const gain = audio.createGain();
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
          osc.connect(gain).connect(audio.destination);
          osc.start(at);
          osc.stop(at + 0.16);
        }
      } catch (err) { /* no sound */ }
    }
    function startBeeping() {
      if (opts.sound === false) return;
      beepUntil = Date.now() + BEEP_FOR;
      if (beepTimer) return;
      beep();
      beepTimer = setInterval(() => {
        if (Date.now() > beepUntil) stopBeeping();
        else beep();
      }, BEEP_EVERY);
    }
    function stopBeeping() {
      if (beepTimer) clearInterval(beepTimer);
      beepTimer = null;
    }

    render();
    return { setState, setMessage, render, t };
  }

  window.createTimersWidget = createTimersWidget;
  window.formatTimerRemaining = formatRemaining;
  window.timerPresetsFromSettings = timerPresetsFromSettings;
})();
