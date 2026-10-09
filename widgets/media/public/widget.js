/*
 * Media: one speaker as a card. The album art, the track and the speaker's name; previous, play/pause and next
 * with mute on the right; the volume as − bar + (each tap moves the number at once and a burst is sent once, so it
 * never overshoots, and `maxVolume` caps it); then buttons for the speaker's own Flow cards (Set source to TV …)
 * or flows. On TV or line-in the card says so instead of greying out: mute and the volume are what matter there.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const OPTIMISTIC_MS = 10e3; // how long a control shows its new value while waiting for the speaker
  const VOLUME_DELAY = 400; // ms after the last −/+ tap before the volume is sent, so +++ sends once
  const VOLUME_SETTLE_MS = 4e3; // after a volume send, reports that don't match it are older ones on their way
  const MIN_RUNNING_MS = 400; // a button's spinner shows at least this long, so a fast run still registers
  const DONE_MS = 1500;
  const FLASH_MS = 300; // next/previous light up this long
  const TAP_SLOP = 10; // px a finger may move and still count as a tap
  const KEY_PROBLEMS = ['noKey', 'keyScope', 'keyInvalid'];

  const DEFAULT_STRINGS = {
    selectDevice: 'Select a speaker in the widget settings.',
    error: 'Could not load the speaker.',
    failed: 'Could not change __name__.',
    buttonFailed: 'Could not run __name__.',
    missing: 'Speaker not found',
    nothingPlaying: 'Nothing playing',
    tv: 'TV',
    lineIn: 'Line-in',
    muted: 'Muted',
    play: 'Play',
    pause: 'Pause',
    next: 'Next',
    previous: 'Previous',
    mute: 'Mute',
    unmute: 'Unmute',
    shuffle: 'Shuffle',
    repeat: 'Repeat',
    volumeDown: 'Volume down',
    volumeUp: 'Volume up',
    volume: 'Volume',
    noKey: 'To use this button, add an API key in the app settings.',
    keyScope: 'The API key may not run this button. Speaker actions need permission to manage flows.',
    keyInvalid: 'The API key was not accepted.',
  };

  /** 24 px glyphs: a 2 px round stroke, or filled (`fill`). */
  const GLYPHS = {
    play: { fill: true, d: 'M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z' },
    pause: { fill: true, d: 'M7.5 5h2.5a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5H7.5a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5zM14 5h2.5a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5H14a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5z' },
    next: { fill: true, d: 'M5 6.3v11.4a.8.8 0 0 0 1.25.66l8.3-5.7a.8.8 0 0 0 0-1.32l-8.3-5.7A.8.8 0 0 0 5 6.3zM17.5 5.5h1a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5z' },
    previous: { fill: true, d: 'M19 6.3v11.4a.8.8 0 0 1-1.25.66l-8.3-5.7a.8.8 0 0 1 0-1.32l8.3-5.7A.8.8 0 0 1 19 6.3zM6.5 5.5h-1a.5.5 0 0 0-.5.5v12a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V6a.5.5 0 0 0-.5-.5z' },
    speaker: { d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11' },
    mute: { d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5zM16 9.5l5 5M21 9.5l-5 5' },
    shuffle: { d: 'M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1.1 1.7 2.3 2.7 4.3 2.7H21M18 14l3 3-3 3M3 17h3.5c1.3 0 2.3-.5 3-1.2M14.5 8.2c.7-.7 1.7-1.2 3-1.2H21M18 4l3 3-3 3' },
    repeat: { d: 'M4 11V9a2 2 0 0 1 2-2h13M16 4l3 3-3 3M20 13v2a2 2 0 0 1-2 2H5M8 20l-3-3 3-3' },
    minus: { d: 'M6 12h12' },
    plus: { d: 'M6 12h12M12 6v12' },
    music: { d: 'M9 18V5.5l11-2V16M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
    tv: { d: 'M4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6zM8 21h8M9 2.5 12 6l3-3.5' },
    lineIn: { d: 'M9 2.5V7M15 2.5V7M6 7h12v4a6 6 0 0 1-12 0V7zM12 17v4.5' },
    check: { d: 'M5 12.5l4.5 4.5L19 7.5' },
  };

  function glyph(name, cls) {
    const g = GLYPHS[name];
    const paint = g.fill
      ? 'fill="currentColor"'
      : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const span = document.createElement('span');
    span.className = cls || 'mw-glyph';
    span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${g.d}" ${paint}/></svg>`;
    return span;
  }

  const clamp01 = x => Math.min(1, Math.max(0, x));

  /**
   * What the speaker plays from: `tv`, `lineIn` or null (music, or unknown). The Athom Sonos app reports TV as the
   * track `HDMI`; the forum says LocalAPI shows `TV/HDMI`. LocalAPI's `sonos_sound_input` only counts while there's
   * no track, since a soundbar's input may stay HDMI while it streams.
   * @param {Record<string, {value: any}>} caps
   */
  function mediaSource(caps) {
    const read = id => (caps && caps[id] && typeof caps[id].value === 'string' ? caps[id].value.trim() : '');
    const kind = (s) => {
      if (/^(tv|hdmi|tv\s*\/\s*hdmi|hdmi\s*arc|earc|spdif|optical|tv audio)$/i.test(s)) return 'tv';
      if (/^(line[\s-]?in|audio[\s-]?in|analog(ue)?( in)?)$/i.test(s)) return 'lineIn';
      return null;
    };
    const track = read('speaker_track');
    if (track) return kind(track);
    return kind(read('sonos_sound_input'));
  }

  /** The buttons from the widget settings: `buttonN` (an autocomplete's `{id, name}`) with an optional `buttonNName`. */
  function mediaButtonsFromSettings(settings) {
    const out = [];
    for (let n = 1; n <= 4; n++) {
      const b = settings && settings[`button${n}`];
      const id = b && typeof b.id === 'string' ? b.id : '';
      if (!id || id === 'none') continue;
      const custom = settings[`button${n}Name`];
      const name = typeof custom === 'string' && custom.trim() ? custom.trim() : String(b.name || id);
      out.push({ id, name });
    }
    return out;
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

  /** `0:42`, `3:15`, `1:02:03` from seconds. */
  function clock(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string,
   *   onSet?: (capabilityId: string, value: any) => Promise<any>,
   *   onButton?: (id: string) => Promise<any>,
   *   onArt?: () => Promise<{type: string, data: string}>,
   *   onReport?: (text: string) => void, onHaptic?: () => void, onHeight?: (h: number) => void,
   *   buttons?: {id: string, name: string}[], volumeStep?: number, maxVolume?: number, showShuffle?: boolean,
   *   now?: () => number }} opts
   */
  function createMediaWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`media.${key}`, tokens) : null;
      if (s && s !== `media.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const step = [0.02, 0.05, 0.1].includes(opts.volumeStep) ? opts.volumeStep : 0.05;
    /** The volume limit (0–1): the bar's right end, and `+` stops there. */
    const maxVolume = typeof opts.maxVolume === 'number' && opts.maxVolume > 0 && opts.maxVolume < 1 ? opts.maxVolume : 1;
    const buttons = Array.isArray(opts.buttons) ? opts.buttons : [];
    /** The clock the position counts on with (the README screenshot fixes it). */
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

    /** @type {{id: string, name?: string, icon?: string|null, caps?: Record<string, any>, art?: any, missing?: boolean} | null} */
    let device = null;
    const optimistic = new Map(); // capabilityId → { value, until }
    let volumeTimer = null; // a −/+ burst waiting to be sent
    let volumeSending = 0; // volume sends on their way
    let drag = null; // the bar's fraction while a finger or the mouse is on it
    let positionAt = 0; // when speaker_position was last read (ms), to count on from it while playing
    const busy = new Map(); // button index → 'running' | 'done'
    const flashes = new Set(); // 'next' / 'previous' while lit
    let messageText = null;
    let messageTimer = null;
    let lastTouchTap = 0;
    let progressTimer = null;

    // Album art: the direct route (the frame loads `/api/image/…` itself), or the app's after it failed once.
    let artRoute = 'direct';
    let artKey = null; // what's shown (or loading): url + cache buster
    let artShown = null; // the image URL on screen

    root.classList.add('mw');
    const card = el('div', { class: 'mw-card' }, root);
    const nowPlaying = el('div', { class: 'mw-now' }, card);
    const artBox = el('div', { class: 'mw-art' }, nowPlaying);
    const artImg = el('div', { class: 'mw-art-img' }, artBox);
    let artGlyphName = null;
    const info = el('div', { class: 'mw-info' }, nowPlaying);
    const nameEl = el('div', { class: 'mw-name', dir: 'auto' }, info);
    const titleEl = el('div', { class: 'mw-title', dir: 'auto' }, info);
    const subEl = el('div', { class: 'mw-sub', dir: 'auto' }, info);
    const progress = el('div', { class: 'mw-progress' }, info);
    const progressFill = el('div', { class: 'mw-progress-fill' }, progress);
    const progressText = el('div', { class: 'mw-progress-text' }, info);

    const controls = el('div', { class: 'mw-controls' }, card);
    const control = (name, label, cls) => {
      const b = el('button', { type: 'button', class: `mw-btn ${cls || ''}`, 'aria-label': t(label), 'data-control': name }, controls);
      b.appendChild(glyph(name));
      return b;
    };
    const shuffleBtn = opts.showShuffle ? control('shuffle', 'shuffle', 'mw-small') : null;
    const prevBtn = control('previous', 'previous', 'mw-transport');
    const playBtn = control('play', 'play', 'mw-transport mw-play');
    const nextBtn = control('next', 'next', 'mw-transport');
    const repeatBtn = opts.showShuffle ? control('repeat', 'repeat', 'mw-small') : null;
    if (repeatBtn) el('span', { class: 'mw-badge', text: '1' }, repeatBtn);
    el('span', { class: 'mw-spacer' }, controls);
    const muteBtn = control('speaker', 'mute', 'mw-mute');
    let playGlyph = 'play';
    let muteGlyph = 'speaker';

    const volume = el('div', { class: 'mw-volume' }, card);
    const downBtn = el('button', { type: 'button', class: 'mw-btn mw-step', 'aria-label': t('volumeDown') }, volume);
    downBtn.appendChild(glyph('minus'));
    const bar = el('div', { class: 'mw-bar', role: 'slider', tabindex: '0', 'aria-label': t('volume'), 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(maxVolume * 100)) }, volume);
    const track = el('div', { class: 'mw-track' }, bar);
    el('div', { class: 'mw-fill' }, track);
    el('div', { class: 'mw-knob' }, bar);
    const upBtn = el('button', { type: 'button', class: 'mw-btn mw-step', 'aria-label': t('volumeUp') }, volume);
    upBtn.appendChild(glyph('plus'));
    const volumeText = el('span', { class: 'mw-volume-text' }, volume);

    const chips = el('div', { class: 'mw-chips' }, card);
    const chipEls = buttons.map((b, i) => {
      const chip = el('button', { type: 'button', class: 'mw-chip', dir: 'auto' }, chips);
      el('span', { class: 'mw-chip-text', text: b.name }, chip);
      onTap(chip, () => runButton(i));
      return chip;
    });
    const messageEl = el('div', { class: 'mw-message', dir: 'auto' }, root);

    function setState(d) {
      device = d && typeof d === 'object' ? d : null;
      positionAt = now();
      messageText = null;
      render();
    }

    function pushChange({ capabilityId, value }) {
      if (!device || !device.caps || !device.caps[capabilityId]) return;
      device.caps[capabilityId].value = value;
      if (capabilityId === 'speaker_position') positionAt = now();
      const o = optimistic.get(capabilityId);
      if (capabilityId === 'volume_set' && o) {
        // During a −/+ burst, and just after it, older reports are still arriving: only the value sent clears it.
        const busyVolume = volumeTimer || volumeSending || Date.now() < (o.settle || 0);
        if (busyVolume && !(typeof value === 'number' && Math.abs(value - o.value) < 0.011)) { render(); return; }
      }
      optimistic.delete(capabilityId);
      render();
    }

    /** New album art from the app (it re-reads the speaker after a track change). */
    function pushArt(art) {
      if (!device || device.missing) return;
      device.art = art || null;
      render();
    }

    /** A message under the card. Persistent messages also clear it. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else device = null;
      render();
    }

    function shown(capabilityId) {
      const o = optimistic.get(capabilityId);
      if (o && Date.now() < o.until) return o.value;
      optimistic.delete(capabilityId);
      const c = device && device.caps && device.caps[capabilityId];
      return c ? c.value : null;
    }

    const has = id => !!(device && device.caps && device.caps[id]);
    const settable = id => has(id) && device.caps[id].setable !== false;

    function shake() {
      card.classList.remove('shake');
      void card.offsetWidth; // restart the animation
      card.classList.add('shake');
    }

    function haptic() {
      if (opts.onHaptic) opts.onHaptic();
    }

    /** Sends one control, showing `value` meanwhile; a failure puts it back, shakes the card and says so. */
    async function send(capabilityId, value, hope = true) {
      if (!opts.onSet) return;
      if (hope) {
        optimistic.set(capabilityId, { value, until: Date.now() + OPTIMISTIC_MS });
        setTimeout(render, OPTIMISTIC_MS + 50);
      }
      render();
      try {
        await opts.onSet(capabilityId, value);
      } catch (err) {
        console.error(err);
        optimistic.delete(capabilityId);
        shake();
        setMessage(t('failed', { name: device && device.name ? device.name : '' }), true);
      }
    }

    function togglePlay() {
      if (!settable('speaker_playing') || root.classList.contains('mw-external')) return;
      haptic();
      send('speaker_playing', shown('speaker_playing') !== true);
    }

    function skip(which) {
      const id = which === 'next' ? 'speaker_next' : 'speaker_prev';
      if (!settable(id) || root.classList.contains('mw-external')) return;
      haptic();
      flashes.add(which);
      setTimeout(() => { flashes.delete(which); render(); }, FLASH_MS);
      send(id, true, false);
    }

    function toggleMute() {
      if (!settable('volume_mute')) return;
      haptic();
      send('volume_mute', shown('volume_mute') !== true);
    }

    function toggleShuffle() {
      if (!settable('speaker_shuffle')) return;
      haptic();
      send('speaker_shuffle', shown('speaker_shuffle') !== true);
    }

    /** Repeat cycles off → the whole list → one track → off, over the values the speaker has. */
    function cycleRepeat() {
      if (!settable('speaker_repeat')) return;
      const values = (device.caps.speaker_repeat.values || []).map(v => v.id);
      const order = ['none', 'playlist', 'track'].filter(v => !values.length || values.includes(v));
      const i = order.indexOf(shown('speaker_repeat'));
      haptic();
      send('speaker_repeat', order[(i + 1) % order.length]);
    }

    /** The volume as shown (0–1), or null. */
    function volumeValue() {
      const v = shown('volume_set');
      return typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : null;
    }

    /** Sets the shown volume now and sends it once the taps stop (`delay`), capped at `maxVolume`. */
    function setVolume(value, delay) {
      if (!settable('volume_set')) return;
      value = Math.round(Math.min(maxVolume, clamp01(value)) * 100) / 100;
      optimistic.set('volume_set', { value, until: Date.now() + OPTIMISTIC_MS });
      setTimeout(render, OPTIMISTIC_MS + 50);
      // Unmuting with the volume, as a remote does: you can't hear a change while muted.
      if (shown('volume_mute') === true && settable('volume_mute')) send('volume_mute', false);
      render();
      if (volumeTimer) clearTimeout(volumeTimer);
      volumeTimer = setTimeout(async () => {
        volumeTimer = null;
        volumeSending++;
        try {
          await send('volume_set', value);
        } finally {
          volumeSending--;
          const o = optimistic.get('volume_set');
          if (o) o.settle = Date.now() + VOLUME_SETTLE_MS;
        }
      }, delay);
    }

    function stepVolume(dir) {
      const v = volumeValue();
      if (v == null) return;
      haptic();
      // Snap to the step's grid first (23 % + 5 → 25 %), so the numbers stay round.
      const next = dir > 0 ? Math.floor(v / step + 1e-6) * step + step : Math.ceil(v / step - 1e-6) * step - step;
      setVolume(next, VOLUME_DELAY);
    }

    async function runButton(index) {
      const b = buttons[index];
      if (!b || busy.get(index) === 'running') return;
      haptic();
      busy.set(index, 'running');
      render();
      const began = Date.now();
      let error = null;
      try {
        if (opts.onButton) await opts.onButton(b.id);
      } catch (err) {
        error = err || new Error('failed');
      }
      const wait = MIN_RUNNING_MS - (Date.now() - began);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      if (error) {
        console.error(error);
        busy.delete(index);
        shake();
        setMessage(KEY_PROBLEMS.includes(error.reason) ? t(error.reason) : t('buttonFailed', { name: b.name }), true);
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

    /** Taps: a touch that ends within TAP_SLOP, or a click (mouse, keyboard). Drags scroll the dashboard. */
    function onTap(node, fn) {
      let start = null;
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
        const isTap = !!start;
        unpress();
        if (!isTap) return;
        e.preventDefault(); // no click after it
        lastTouchTap = Date.now();
        fn();
      });
      node.addEventListener('touchcancel', unpress);
      node.addEventListener('click', () => {
        if (Date.now() - lastTouchTap < 800) return;
        fn();
      });
    }

    onTap(playBtn, togglePlay);
    onTap(prevBtn, () => skip('previous'));
    onTap(nextBtn, () => skip('next'));
    onTap(muteBtn, toggleMute);
    if (shuffleBtn) onTap(shuffleBtn, toggleShuffle);
    if (repeatBtn) onTap(repeatBtn, cycleRepeat);
    onTap(downBtn, () => stepVolume(-1));
    onTap(upBtn, () => stepVolume(1));

    /**
     * The volume bar, as Light Controls' and Curtains' bar: a drag moves it live and sends when let go; a tap sets it
     * where it lands. The bar runs from 0 to `maxVolume`. Homey's Android app takes a drag after ~100 ms
     * (touchcancel), so there only a tap (or −/+) works.
     */
    (function wireBar() {
      const at = (clientX) => {
        const r = bar.getBoundingClientRect();
        return r.width ? clamp01((clientX - r.left) / r.width) : 0;
      };
      const move = (clientX) => { drag = at(clientX); render(); };
      const end = (commitIt) => {
        if (drag == null) return;
        const x = drag;
        drag = null;
        bar.classList.remove('dragging');
        if (commitIt) setVolume(x * maxVolume, 0);
        else render();
      };
      bar.addEventListener('touchstart', (e) => {
        if (!settable('volume_set')) return;
        e.preventDefault();
        bar.classList.add('dragging');
        move(e.changedTouches[0].clientX);
      }, { passive: false });
      bar.addEventListener('touchmove', (e) => {
        if (drag == null) return;
        e.preventDefault();
        move(e.changedTouches[0].clientX);
      }, { passive: false });
      bar.addEventListener('touchend', (e) => {
        e.preventDefault();
        lastTouchTap = Date.now();
        end(true);
      });
      bar.addEventListener('touchcancel', () => end(false));
      bar.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || !settable('volume_set')) return;
        e.preventDefault();
        if (bar.setPointerCapture) bar.setPointerCapture(e.pointerId);
        bar.classList.add('dragging');
        move(e.clientX);
      });
      bar.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch' || drag == null) return;
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
      bar.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); stepVolume(1); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); stepVolume(-1); }
      });
    })();

    // ---------------------------------------------------------------- album art

    function artUrl(art) {
      // The track in the cache buster too: some drivers keep the image's lastUpdated while the picture changes.
      const tag = [art.lastUpdated || '', shown('speaker_track') || '', shown('speaker_artist') || ''].join('|');
      let h = 0;
      for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
      return `${art.url}${art.url.includes('?') ? '&' : '?'}t=${(h >>> 0).toString(36)}`;
    }

    function preload(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(src);
        img.onerror = () => reject(new Error('Album art did not load'));
        img.src = src;
      });
    }

    function showArt(src) {
      artShown = src;
      artImg.style.backgroundImage = src ? `url("${src}")` : '';
      artBox.classList.toggle('has-art', !!src);
    }

    /** Loads the art for `key` and swaps it in once decoded, so the old cover stays until then (no flash). */
    async function loadArt(art, key) {
      if (/^data:/.test(art.url)) { showArt(art.url); return; }
      try {
        let src;
        if (artRoute === 'direct') {
          try {
            src = await preload(key);
          } catch (err) {
            if (!opts.onArt) throw err;
            artRoute = 'app';
            if (opts.onReport) opts.onReport('album art does not load directly; using the app route');
          }
        }
        if (!src) {
          const res = await opts.onArt();
          src = await preload(`data:${res.type};base64,${res.data}`);
        }
        if (artKey === key) showArt(src);
      } catch (err) {
        console.error(err);
        if (artKey === key) showArt(null);
      }
    }

    function updateArt(art, source) {
      if (!art || source) {
        artKey = null;
        if (artShown) showArt(null);
        return;
      }
      const key = artUrl(art);
      if (key === artKey) return;
      artKey = key;
      loadArt(art, key);
    }

    // ---------------------------------------------------------------- render

    function setGlyph(button, name, current) {
      if (current === name) return current;
      button.replaceChildren(glyph(name));
      if (button === repeatBtn) el('span', { class: 'mw-badge', text: '1' }, button);
      return name;
    }

    /** Counts the position on while playing, once a second, and only while the page is visible. */
    function scheduleProgress(on) {
      if (on && !progressTimer && !document.hidden) progressTimer = setInterval(render, 1000);
      if ((!on || document.hidden) && progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    }
    document.addEventListener('visibilitychange', () => render());

    let lastHeight = 0;
    function render() {
      const ok = !!device && !device.missing && !!device.caps;
      card.style.display = device ? '' : 'none';
      card.classList.toggle('missing', !!device && !ok);
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && !!device);
      if (device && !ok) {
        nameEl.textContent = '';
        titleEl.textContent = t('missing');
        subEl.textContent = '';
        progress.style.display = 'none';
        progressText.style.display = 'none';
        updateArt(null, null);
        scheduleProgress(false);
      }
      if (ok) {
        const source = mediaSource(device.caps);
        const playing = shown('speaker_playing') === true;
        const muted = shown('volume_mute') === true;
        const trackName = shown('speaker_track');
        const artist = shown('speaker_artist');
        const album = shown('speaker_album');
        root.classList.toggle('mw-external', !!source);
        root.classList.toggle('mw-playing', playing && !source);

        nameEl.textContent = device.name || '';
        if (source) {
          titleEl.textContent = t(source);
          subEl.textContent = muted ? t('muted') : '';
        } else if (trackName) {
          titleEl.textContent = trackName;
          subEl.textContent = [artist, album].filter(x => typeof x === 'string' && x).join(' · ');
        } else {
          titleEl.textContent = t('nothingPlaying');
          subEl.textContent = '';
        }
        subEl.style.display = subEl.textContent ? '' : 'none';

        // The cover, or a glyph: the TV or line-in, or a note while there's no art.
        updateArt(device.art, source);
        const fallback = source || 'music';
        if (artGlyphName !== fallback) {
          artGlyphName = fallback;
          const old = artBox.querySelector('.mw-art-glyph');
          if (old) old.remove();
          artBox.insertBefore(glyph(fallback, 'mw-art-glyph'), artImg);
        }
        artBox.classList.toggle('external', !!source);

        // Progress: Homey's speaker_position and speaker_duration are seconds.
        const dur = shown('speaker_duration');
        let pos = shown('speaker_position');
        const showProgress = !source && !!trackName && typeof dur === 'number' && dur > 0 && typeof pos === 'number';
        if (showProgress) {
          if (playing) pos += (now() - positionAt) / 1000;
          pos = Math.min(dur, Math.max(0, pos));
          progressFill.style.width = `${(pos / dur) * 100}%`;
          progressText.textContent = `${clock(pos)} / ${clock(dur)}`;
        }
        progress.style.display = showProgress ? '' : 'none';
        progressText.style.display = showProgress ? '' : 'none';
        scheduleProgress(showProgress && playing);

        // Controls
        playGlyph = setGlyph(playBtn, playing ? 'pause' : 'play', playGlyph);
        playBtn.setAttribute('aria-label', t(playing ? 'pause' : 'play'));
        playBtn.disabled = !settable('speaker_playing');
        prevBtn.disabled = !settable('speaker_prev');
        nextBtn.disabled = !settable('speaker_next');
        prevBtn.classList.toggle('flash', flashes.has('previous'));
        nextBtn.classList.toggle('flash', flashes.has('next'));
        for (const b of [prevBtn, playBtn, nextBtn]) b.style.display = has(b === playBtn ? 'speaker_playing' : b === prevBtn ? 'speaker_prev' : 'speaker_next') ? '' : 'none';
        muteGlyph = setGlyph(muteBtn, muted ? 'mute' : 'speaker', muteGlyph);
        muteBtn.classList.toggle('on', muted);
        muteBtn.setAttribute('aria-label', t(muted ? 'unmute' : 'mute'));
        muteBtn.setAttribute('aria-pressed', String(muted));
        muteBtn.style.display = has('volume_mute') ? '' : 'none';
        if (shuffleBtn) {
          shuffleBtn.style.display = has('speaker_shuffle') ? '' : 'none';
          shuffleBtn.classList.toggle('on', shown('speaker_shuffle') === true);
        }
        if (repeatBtn) {
          const r = shown('speaker_repeat');
          repeatBtn.style.display = has('speaker_repeat') ? '' : 'none';
          repeatBtn.classList.toggle('on', !!r && r !== 'none');
          repeatBtn.classList.toggle('one', r === 'track');
        }

        // Volume: the bar runs to `maxVolume`.
        const v = volumeValue();
        const x = drag != null ? drag : v != null ? Math.min(1, v / maxVolume) : 0;
        const pct = drag != null ? Math.round(drag * maxVolume * 100) : v != null ? Math.round(v * 100) : null;
        volume.style.display = has('volume_set') ? '' : 'none';
        volume.classList.toggle('muted', muted);
        volume.style.setProperty('--mw-x', String(x));
        volumeText.textContent = pct == null ? '–' : `${pct}%`;
        bar.setAttribute('aria-valuenow', String(pct == null ? 0 : pct));
        upBtn.disabled = !settable('volume_set') || (v != null && v >= maxVolume - 0.001);
        downBtn.disabled = !settable('volume_set') || (v != null && v <= 0.001);

        // Buttons: a TV/line-in button is lit while the speaker plays from it (by its name, the only clue).
        buttons.forEach((b, i) => {
          const chip = chipEls[i];
          const state = busy.get(i) || null;
          chip.classList.toggle('running', state === 'running');
          chip.classList.toggle('done', state === 'done');
          const lit = (source === 'tv' && /\b(tv|hdmi)\b/i.test(b.name)) || (source === 'lineIn' && /line/i.test(b.name));
          chip.classList.toggle('on', lit);
        });
      }
      chips.style.display = ok && buttons.length ? '' : 'none';
      controls.style.display = ok ? '' : 'none';
      if (!ok) volume.style.display = 'none';

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    return { setState, pushChange, pushArt, setMessage, render, t };
  }

  window.createMediaWidget = createMediaWidget;
  window.mediaSource = mediaSource;
  window.mediaButtonsFromSettings = mediaButtonsFromSettings;
})();
