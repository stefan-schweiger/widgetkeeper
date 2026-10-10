/*
 * Media: one speaker as a compact card. The album art, the track and the speaker's name, with a ⋯ button that
 * opens an overlay of buttons for the speaker's own Flow cards (Set source to TV …) or flows; previous, play/pause
 * and next with mute on the right; the volume as − bar + on its own line (`volumeLayout: 'line'`), or only − and +
 * around mute next to the transport (`'buttons'`, the level as a ring on mute). Each −/+ tap moves the volume at
 * once and a burst is sent once, so it never overshoots, and `maxVolume` caps it. On TV or line-in the card says so
 * instead of greying out: mute and the volume are what matter there. With `canSwitch`, a tap on the speaker's name
 * (its device icon, the name and a ⌄) lists every speaker, and picking one switches the card to it.
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
  const PANEL_IDLE_MS = 8e3; // the overlay closes after this long without a touch
  const PANEL_CLOSE_MS = 600; // after a button's check mark, the overlay closes this much later
  const SPEAKERS_IDLE_MS = 15e3; // the speaker list closes after this long without a touch
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
    more: 'More',
    close: 'Close',
    speakers: 'Speakers',
    switchSpeaker: 'Switch speaker',
    speakersError: 'Could not load the speakers.',
    loading: 'Loading…',
    noKey: 'To use this button, add an API key in the app settings.',
    keyScope: 'The API key may not run this. Speaker actions need permission to manage flows.',
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
    more: { fill: true, d: 'M6 10.25a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5zM12 10.25a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5zM18 10.25a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5z' },
    close: { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' },
    chevron: { d: 'M7 10l5 5 5-5' },
    device: { d: 'M7.5 3h9A1.5 1.5 0 0 1 18 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3zM12 11.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM12 6.5h.01' },
  };

  /**
   * The buttons' optional icons: a copy of Flow Buttons' `ICONS` (Homey serves each widget's files separately; a
   * test checks the two are equal). The ids are the `buttonNIcon` setting's, Flow Buttons' `listIcons()`.
   */
  const BUTTON_ICONS = {
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
    door: { d: 'M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M4 21h16M14.5 12h.01' },
    window: { d: 'M5.5 3h13A1.5 1.5 0 0 1 20 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3zM12 3v18M4 12h16' },
    blinds: { d: 'M3 3.5h18M5 3.5V20h14V3.5M5 8h14M5 12h14M5 16h14' },
    garage: { d: 'M3 21V9l9-5.5L21 9v12M7 21v-9h10v9M7 15h10M7 18h10' },
    car: { d: 'M5 16H3.5v-3.5l2-5A1.5 1.5 0 0 1 6.9 6.5h10.2a1.5 1.5 0 0 1 1.4 1l2 5V16H19M9 16h6M3.5 12.5h17M7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z' },
    sofa: { d: 'M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3.5 11A1.5 1.5 0 0 1 5 12.5V14h14v-1.5a1.5 1.5 0 0 1 3 0V18H2v-5.5A1.5 1.5 0 0 1 3.5 11zM5 18v2M19 18v2' },
    coffee: { d: 'M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 2.5v3M12 2.5v3' },
    utensils: { d: 'M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2 1-3.5 3.5-3.5 7.5V13H17' },
    washer: { d: 'M5.5 3h13A1.5 1.5 0 0 1 20 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3zM12 9a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM7.5 6h.01M10.5 6h.01' },
    vacuum: { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 9h10M12 13.5h.01' },
    trash: { d: 'M4 6.5h16M9 6.5V4h6v2.5M6 6.5l1 13A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5l1-13M10 10.5v6M14 10.5v6' },
    thermometer: { d: 'M14 14.76V4.5a2 2 0 0 0-4 0v10.26a4 4 0 1 0 4 0zM12 18v-6' },
    plug: { d: 'M9 2.5V7M15 2.5V7M6 7h12v4a6 6 0 0 1-12 0V7zM12 17v4.5' },
    wifi: { d: 'M2.5 8.5a14 14 0 0 1 19 0M5.5 12a9.5 9.5 0 0 1 13 0M8.5 15.5a5 5 0 0 1 7 0M12 19.5h.01' },
    camera: { d: 'M4.5 7h3l1.5-2.5h6L16.5 7h3A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-10A1.5 1.5 0 0 1 4.5 7zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z' },
    speaker: { d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11' },
    mute: { d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5zM16 9.5l5 5M21 9.5l-5 5' },
    umbrella: { d: 'M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v6.5a2 2 0 0 1-4 0' },
    leaf: { d: 'M5 19C5 10 11 5 20 4c-1 9-6 15-15 15zM5 19l8-8' },
    paw: { d: 'M12 13c-2.5 0-5 3-5 5a2.5 2.5 0 0 0 2.5 2.5c1 0 1.5-.5 2.5-.5s1.5.5 2.5.5A2.5 2.5 0 0 0 17 18c0-2-2.5-5-5-5zM5.5 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM15 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM18.5 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z' },
    briefcase: { d: 'M4.5 7.5h15A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5zM9 7.5V5h6v2.5M3 13h18' },
    gift: { d: 'M4 8.5h16V12H4zM5.5 12v8.5h13V12M12 8.5v12M12 8.5S11 4 8.5 4a2.25 2.25 0 0 0 0 4.5M12 8.5S13 4 15.5 4a2.25 2.25 0 0 1 0 4.5' },
    sparkles: { d: 'M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8L11 3zM18.5 15v5M16 17.5h5' },
  };

  function glyph(name, cls) {
    return svgGlyph(GLYPHS[name], cls);
  }

  function svgGlyph(g, cls) {
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

  /**
   * The buttons from the widget settings: `buttonN` (an autocomplete's `{id, name}`) with an optional `buttonNName`
   * and `buttonNIcon` (one of BUTTON_ICONS, else no icon).
   */
  function mediaButtonsFromSettings(settings) {
    const out = [];
    for (let n = 1; n <= 4; n++) {
      const b = settings && settings[`button${n}`];
      const id = b && typeof b.id === 'string' ? b.id : '';
      if (!id || id === 'none') continue;
      const custom = settings[`button${n}Name`];
      const name = typeof custom === 'string' && custom.trim() ? custom.trim() : String(b.name || id);
      const pick = settings[`button${n}Icon`];
      const icon = pick && Object.prototype.hasOwnProperty.call(BUTTON_ICONS, pick.id) ? pick.id : null;
      out.push({ id, name, icon });
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

  /**
   * A device icon: Homey's SVG (a data URL from the app) as a mask in the text colour, or the drawn speaker.
   * @param {string|null|undefined} icon @param {string} cls
   */
  function deviceIcon(icon, cls) {
    if (!icon) return glyph('device', cls);
    const span = document.createElement('span');
    span.className = `${cls} mw-mask`;
    span.style.setProperty('--mw-icon', `url("${icon}")`);
    return span;
  }

  /** `<card>` of a `card:homey:device:<id>:<card>` button id, or null for a flow. */
  function buttonCard(id) {
    const m = /^card:homey:device:[^:]+:(.+)$/.exec(id || '');
    return m ? m[1] : null;
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
   *   buttons?: {id: string, name: string, icon?: string | null}[], volumeStep?: number, maxVolume?: number, showShuffle?: boolean,
   *   volumeLayout?: 'line' | 'buttons', showProgress?: boolean, now?: () => number,
   *   canSwitch?: boolean, onListSpeakers?: () => Promise<any[]>, onSwitch?: (id: string) => void }} opts
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
    /** `buttons`: − and + around mute in the transport row, no bar. Anything else is the bar on its own line. */
    const volumeButtons = opts.volumeLayout === 'buttons';
    /** The clock the position counts on with (the README screenshot fixes it). */
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

    /** @type {{id: string, name?: string, icon?: string|null, caps?: Record<string, any>, art?: any, cards?: string[], missing?: boolean} | null} */
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
    root.classList.toggle('mw-volume-buttons', volumeButtons);
    const card = el('div', { class: 'mw-card' }, root);
    // The main view and the overlay share one grid cell, so the card is as tall as the taller of the two and
    // opening the overlay never changes the widget's height.
    const main = el('div', { class: 'mw-main' }, card);
    const nowPlaying = el('div', { class: 'mw-now' }, main);
    const artBox = el('div', { class: 'mw-art' }, nowPlaying);
    const artImg = el('div', { class: 'mw-art-img' }, artBox);
    let artGlyphName = null;
    const info = el('div', { class: 'mw-info' }, nowPlaying);
    // The speaker: its device icon, the name and, with switching, a ⌄. A tap opens the speaker list.
    const canSwitch = !!opts.canSwitch && typeof opts.onListSpeakers === 'function' && typeof opts.onSwitch === 'function';
    const who = el(canSwitch ? 'button' : 'div', canSwitch
      ? { type: 'button', class: 'mw-who switch', 'aria-label': t('switchSpeaker'), 'aria-expanded': 'false' }
      : { class: 'mw-who' }, info);
    let whoIcon = el('span', { class: 'mw-who-icon' }, who);
    let whoIconKey;
    const nameEl = el('span', { class: 'mw-name', dir: 'auto' }, who);
    if (canSwitch) who.appendChild(glyph('chevron', 'mw-chevron'));
    const titleEl = el('div', { class: 'mw-title', dir: 'auto' }, info);
    const subEl = el('div', { class: 'mw-sub', dir: 'auto' }, info);
    const progress = el('div', { class: 'mw-progress' }, info);
    const progressFill = el('div', { class: 'mw-progress-fill' }, progress);
    const progressText = el('div', { class: 'mw-progress-text' }, info);
    const moreBtn = el('button', { type: 'button', class: 'mw-btn mw-more', 'aria-label': t('more'), 'aria-expanded': 'false' }, nowPlaying);
    moreBtn.appendChild(glyph('more'));

    const controls = el('div', { class: 'mw-controls' }, main);
    const control = (name, label, cls) => {
      const b = el('button', { type: 'button', class: `mw-btn ${cls || ''}`, 'aria-label': t(label), 'data-control': name }, controls);
      b.appendChild(glyph(name));
      return b;
    };
    // With the volume as buttons the row has no room for shuffle and repeat: they go in the overlay.
    const shuffleInPanel = volumeButtons;
    const shuffleBtn = opts.showShuffle && !shuffleInPanel ? control('shuffle', 'shuffle', 'mw-small') : null;
    const prevBtn = control('previous', 'previous', 'mw-transport');
    const playBtn = control('play', 'play', 'mw-transport mw-play');
    const nextBtn = control('next', 'next', 'mw-transport');
    const repeatBtn = opts.showShuffle && !shuffleInPanel ? control('repeat', 'repeat', 'mw-small') : null;
    if (repeatBtn) el('span', { class: 'mw-badge', text: '1' }, repeatBtn);
    el('span', { class: 'mw-spacer' }, controls);
    const downBtn = el('button', { type: 'button', class: 'mw-btn mw-step', 'aria-label': t('volumeDown') });
    downBtn.appendChild(glyph('minus'));
    const upBtn = el('button', { type: 'button', class: 'mw-btn mw-step', 'aria-label': t('volumeUp') });
    upBtn.appendChild(glyph('plus'));
    if (volumeButtons) controls.appendChild(downBtn);
    const muteBtn = control('speaker', 'mute', 'mw-mute');
    if (volumeButtons) controls.appendChild(upBtn);
    let playGlyph = 'play';
    let muteGlyph = 'speaker';

    // The volume line: − bar +. With `volumeButtons` it isn't in the card (and the bar isn't used).
    const volume = el('div', { class: 'mw-volume' }, volumeButtons ? null : main);
    const bar = el('div', { class: 'mw-bar', role: 'slider', tabindex: '0', 'aria-label': t('volume'), 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(maxVolume * 100)) });
    const track = el('div', { class: 'mw-track' }, bar);
    el('div', { class: 'mw-fill' }, track);
    el('div', { class: 'mw-knob' }, bar);
    if (!volumeButtons) volume.append(downBtn, bar, upBtn);

    // The overlay (⋯): the buttons as Flow Variables' grey pills, plus shuffle and repeat with the volume as buttons.
    const panel = el('div', { class: 'mw-panel', 'aria-hidden': 'true' }, card);
    const chips = el('div', { class: 'mw-chips' }, panel);
    const chipEls = buttons.map((b, i) => {
      const chip = el('button', { type: 'button', class: 'mw-chip', dir: 'auto' }, chips);
      if (b.icon && BUTTON_ICONS[b.icon]) chip.appendChild(svgGlyph(BUTTON_ICONS[b.icon]));
      el('span', { class: 'mw-chip-text', text: b.name }, chip);
      onTap(chip, (e) => { e.stopPropagation(); runButton(i); });
      return chip;
    });
    const toggleChip = (name) => {
      const chip = el('button', { type: 'button', class: 'mw-chip mw-toggle', 'data-control': name }, chips);
      chip.appendChild(glyph(name));
      el('span', { class: 'mw-chip-text', text: t(name) }, chip);
      if (name === 'repeat') el('span', { class: 'mw-badge', text: '1' }, chip);
      return chip;
    };
    const shuffleChip = opts.showShuffle && shuffleInPanel ? toggleChip('shuffle') : null;
    const repeatChip = opts.showShuffle && shuffleInPanel ? toggleChip('repeat') : null;
    const closeBtn = el('button', { type: 'button', class: 'mw-btn mw-close', 'aria-label': t('close') }, panel);
    closeBtn.appendChild(glyph('close'));
    // The speaker list: in the same grid cell, but only laid out while open, so a long list grows the card then.
    const speakersPanel = el('div', { class: 'mw-speakers', 'aria-hidden': 'true' }, card);
    const speakersHead = el('div', { class: 'mw-speakers-head' }, speakersPanel);
    el('span', { class: 'mw-speakers-title', text: t('speakers') }, speakersHead);
    const speakersClose = el('button', { type: 'button', class: 'mw-btn mw-close', 'aria-label': t('close') }, speakersHead);
    speakersClose.appendChild(glyph('close'));
    const speakersList = el('div', { class: 'mw-speakers-list' }, speakersPanel);
    const messageEl = el('div', { class: 'mw-message', dir: 'auto' }, root);
    let panelOpen = false;
    let panelTimer = null;
    let speakersOpen = false;
    let speakersTimer = null;
    /** @type {any[] | null} the last list read, shown at once the next time */
    let speakers = null;
    let speakersError = false;

    function setState(d) {
      const next = d && typeof d === 'object' ? d : null;
      // Another speaker: nothing of the previous one's may carry over (a volume burst would go to the new one).
      if (device && next && next.id !== device.id) {
        optimistic.clear();
        if (volumeTimer) clearTimeout(volumeTimer);
        volumeTimer = null;
        busy.clear();
        flashes.clear();
        drag = null;
        panelOpen = false;
      }
      device = next;
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

    /**
     * A card button runs on the widget's speaker: on the one it was picked for, or a switched-to speaker that has a
     * card of the same kind (`device.cards`, sent only for a switched-to speaker). Flows always run.
     */
    function buttonAvailable(b) {
      const cardPart = buttonCard(b.id);
      if (!cardPart || !device || !Array.isArray(device.cards)) return true;
      return device.cards.includes(cardPart);
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
      poke();
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
        setPanel(false);
        shake();
        setMessage(KEY_PROBLEMS.includes(error.reason) ? t(error.reason) : t('buttonFailed', { name: b.name }), true);
        return;
      }
      busy.set(index, 'done');
      render();
      // The check mark shows a moment, then the overlay closes, so the card shows what changed (TV …).
      setTimeout(() => { if (busy.get(index) === 'done' && panelOpen) setPanel(false); }, PANEL_CLOSE_MS);
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
        fn(e);
      });
      node.addEventListener('touchcancel', unpress);
      node.addEventListener('click', (e) => {
        if (Date.now() - lastTouchTap < 800) return;
        fn(e);
      });
    }

    onTap(playBtn, togglePlay);
    onTap(prevBtn, () => skip('previous'));
    onTap(nextBtn, () => skip('next'));
    onTap(muteBtn, toggleMute);
    if (shuffleBtn) onTap(shuffleBtn, toggleShuffle);
    if (repeatBtn) onTap(repeatBtn, cycleRepeat);
    if (shuffleChip) onTap(shuffleChip, (e) => { e.stopPropagation(); poke(); toggleShuffle(); });
    if (repeatChip) onTap(repeatChip, (e) => { e.stopPropagation(); poke(); cycleRepeat(); });
    onTap(downBtn, () => stepVolume(-1));
    onTap(upBtn, () => stepVolume(1));
    onTap(moreBtn, () => { haptic(); setPanel(!panelOpen); });
    if (canSwitch) onTap(who, () => { haptic(); setSpeakers(!speakersOpen); });
    onTap(speakersClose, (e) => { e.stopPropagation(); setSpeakers(false); });
    onTap(speakersPanel, () => setSpeakers(false));
    onTap(closeBtn, (e) => { e.stopPropagation(); setPanel(false); });
    // A tap on the overlay outside its buttons closes it, as Sensor Dots' overlay.
    onTap(panel, () => setPanel(false));

    /** Opens or closes the speaker list, reading it again each time (the last read shows meanwhile). */
    async function setSpeakers(open) {
      speakersOpen = !!open && canSwitch;
      if (speakersTimer) clearTimeout(speakersTimer);
      speakersTimer = null;
      if (speakersOpen) {
        panelOpen = false;
        pokeSpeakers();
      }
      render();
      if (!speakersOpen) return;
      try {
        const list = await opts.onListSpeakers();
        speakers = Array.isArray(list) ? list : [];
        speakersError = false;
      } catch (err) {
        console.error(err);
        speakersError = true;
      }
      if (speakersOpen) render();
    }

    function pokeSpeakers() {
      if (speakersTimer) clearTimeout(speakersTimer);
      speakersTimer = setTimeout(() => { speakersTimer = null; setSpeakers(false); }, SPEAKERS_IDLE_MS);
    }

    function pickSpeaker(id) {
      haptic();
      setSpeakers(false);
      if (!device || id !== device.id) opts.onSwitch(id);
    }

    /** What a speaker in the list plays: TV, line-in, the track and artist, or nothing. */
    function speakerSummary(sp) {
      const caps = sp.caps || {};
      const source = mediaSource(caps);
      if (source) return { text: t(source), playing: true };
      const track = caps.speaker_track && caps.speaker_track.value;
      const artist = caps.speaker_artist && caps.speaker_artist.value;
      const playing = !!(caps.speaker_playing && caps.speaker_playing.value === true);
      if (typeof track === 'string' && track) {
        return { text: [track, artist].filter(x => typeof x === 'string' && x).join(' · '), playing };
      }
      return { text: sp.zone || '', playing: false };
    }

    function renderSpeakers() {
      const rows = [];
      if (speakers && speakers.length) {
        for (const sp of speakers) {
          const current = !!device && sp.id === device.id;
          const row = el('button', { type: 'button', class: `mw-spk${current ? ' current' : ''}`, 'aria-current': current ? 'true' : null });
          row.appendChild(deviceIcon(sp.icon, 'mw-spk-icon'));
          const text = el('span', { class: 'mw-spk-text' }, row);
          el('span', { class: 'mw-spk-name', dir: 'auto', text: sp.name }, text);
          const sum = speakerSummary(sp);
          if (sum.text) el('span', { class: `mw-spk-sub${sum.playing ? ' playing' : ''}`, dir: 'auto', text: sum.text }, text);
          if (current) row.appendChild(glyph('check', 'mw-spk-check'));
          onTap(row, (e) => { e.stopPropagation(); pickSpeaker(sp.id); });
          rows.push(row);
        }
      } else {
        rows.push(el('div', { class: 'mw-spk-empty', text: t(speakersError ? 'speakersError' : 'loading') }));
      }
      speakersList.replaceChildren(...rows);
    }

    /** Opens or closes the overlay; it closes by itself after PANEL_IDLE_MS without a touch. */
    function setPanel(open) {
      panelOpen = !!open;
      if (panelOpen && speakersOpen) { speakersOpen = false; if (speakersTimer) clearTimeout(speakersTimer); speakersTimer = null; }
      if (panelTimer) clearTimeout(panelTimer);
      panelTimer = null;
      if (panelOpen) poke();
      render();
    }

    /** Restarts the overlay's idle timer; a button still running there keeps it open. */
    function poke() {
      if (panelTimer) clearTimeout(panelTimer);
      panelTimer = setTimeout(() => {
        panelTimer = null;
        if ([...busy.values()].includes('running')) { poke(); return; }
        setPanel(false);
      }, PANEL_IDLE_MS);
    }

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
        // Kept for switching: a speaker that's gone can still be switched away from.
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

        // The cover, or a glyph: the TV or line-in, or the speaker's own icon while there's no art.
        updateArt(device.art, source);
        const fallback = source || `icon:${device.icon || ''}`;
        if (artGlyphName !== fallback) {
          artGlyphName = fallback;
          const old = artBox.querySelector('.mw-art-glyph');
          if (old) old.remove();
          artBox.insertBefore(source ? glyph(source, 'mw-art-glyph') : deviceIcon(device.icon, 'mw-art-glyph'), artImg);
        }
        artBox.classList.toggle('external', !!source);

        // Progress: Homey's speaker_position and speaker_duration are seconds.
        const dur = shown('speaker_duration');
        let pos = shown('speaker_position');
        const showProgress = opts.showProgress !== false && !source && !!trackName && typeof dur === 'number' && dur > 0 && typeof pos === 'number';
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

        // Volume: the bar (or, with the volume as buttons, the ring around mute) runs to `maxVolume`.
        const v = volumeValue();
        const x = drag != null ? drag : v != null ? Math.min(1, v / maxVolume) : 0;
        const pct = drag != null ? Math.round(drag * maxVolume * 100) : v != null ? Math.round(v * 100) : null;
        volume.style.display = has('volume_set') ? '' : 'none';
        volume.classList.toggle('muted', muted);
        root.style.setProperty('--mw-x', String(x));
        bar.setAttribute('aria-valuenow', String(pct == null ? 0 : pct));
        if (volumeButtons) {
          downBtn.style.display = upBtn.style.display = has('volume_set') ? '' : 'none';
          muteBtn.classList.toggle('ring', has('volume_set'));
        }
        upBtn.disabled = !settable('volume_set') || (v != null && v >= maxVolume - 0.001);
        downBtn.disabled = !settable('volume_set') || (v != null && v <= 0.001);

        // Buttons: a TV/line-in button is lit while the speaker plays from it (by its name, the only clue).
        let anyLit = false;
        buttons.forEach((b, i) => {
          const chip = chipEls[i];
          chip.style.display = buttonAvailable(b) ? '' : 'none';
          const state = busy.get(i) || null;
          chip.classList.toggle('running', state === 'running');
          chip.classList.toggle('done', state === 'done');
          const lit = (source === 'tv' && /\b(tv|hdmi)\b/i.test(b.name)) || (source === 'lineIn' && /line/i.test(b.name));
          chip.classList.toggle('on', lit);
          if (lit) anyLit = true;
        });
        // ⋯ is tinted while a button in it is lit, so the TV source shows without opening it.
        moreBtn.classList.toggle('on', anyLit);
        if (shuffleChip) {
          const on = shown('speaker_shuffle') === true;
          shuffleChip.style.display = has('speaker_shuffle') ? '' : 'none';
          shuffleChip.classList.toggle('on', on);
          shuffleChip.setAttribute('aria-pressed', String(on));
        }
        if (repeatChip) {
          const r = shown('speaker_repeat');
          repeatChip.style.display = has('speaker_repeat') ? '' : 'none';
          repeatChip.classList.toggle('on', !!r && r !== 'none');
          repeatChip.classList.toggle('one', r === 'track');
        }
      }
      const panelItems = ok ? buttons.filter(buttonAvailable).length
        + (shuffleChip && has('speaker_shuffle') ? 1 : 0) + (repeatChip && has('speaker_repeat') ? 1 : 0) : 0;
      if (panelOpen && !panelItems) {
        panelOpen = false;
        if (panelTimer) clearTimeout(panelTimer);
        panelTimer = null;
      }
      moreBtn.style.display = panelItems ? '' : 'none';
      moreBtn.setAttribute('aria-expanded', String(panelOpen));
      card.classList.toggle('panel-open', panelOpen);
      panel.setAttribute('aria-hidden', String(!panelOpen));
      panel.style.display = panelItems ? '' : 'none';
      controls.style.display = ok ? '' : 'none';
      if (!ok) volume.style.display = 'none';

      // The speaker: its icon (as the list shows it) and the switcher.
      const iconKey = device && !device.missing ? device.icon || '' : '';
      if (iconKey !== whoIconKey) {
        whoIconKey = iconKey;
        const next = deviceIcon(iconKey, 'mw-who-icon');
        whoIcon.replaceWith(next);
        whoIcon = next;
      }
      who.style.display = device && (ok || canSwitch) ? '' : 'none';
      if (!ok && device) nameEl.textContent = canSwitch ? t('switchSpeaker') : '';
      if (speakersOpen && !device) speakersOpen = false;
      if (canSwitch) who.setAttribute('aria-expanded', String(speakersOpen));
      card.classList.toggle('speakers-open', speakersOpen);
      speakersPanel.setAttribute('aria-hidden', String(!speakersOpen));
      if (speakersOpen) renderSpeakers();

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    return { setState, pushChange, pushArt, setMessage, render, t, setPanel, setSpeakers };
  }

  window.createMediaWidget = createMediaWidget;
  window.mediaSource = mediaSource;
  window.mediaButtonsFromSettings = mediaButtonsFromSettings;
  window.MEDIA_BUTTON_ICON_PATHS = BUTTON_ICONS;
})();
