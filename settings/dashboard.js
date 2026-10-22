/*
 * The web dashboards page (`settings/dashboard.html`): our widgets in any browser on the home network, laid out
 * on the page itself. Served by the Homey at `/app/<appId>/settings/dashboard.html`, with no login; everything it
 * reads or changes goes through the app's API with the personal API key the user pastes (kept in this browser).
 * When the app settings set a password, the browser also signs in with it, and every request carries the session
 * token that gives (`?session=`).
 *
 * Each widget runs in an iframe of its own, unchanged `index.html` (`../widgets/<id>/index.html`, into which the
 * Homey puts its widget SDK, as on a Homey dashboard). The SDK talks to its parent frame with Homey's crossframe
 * messages (`CF2_MESSAGE` + UTF-16 hex JSON, `{type: 'tx', event, data, callbackId}`, answered by
 * `{type: 'cb', args: [err, result], callbackId}`), so this page answers them as Homey's dashboard does:
 * `getInitialData` (the widget's settings, devices, strings, dark mode), `api` (through the app's `/web/call`, to
 * the widget's own API), `registerRealtimeListener` (our app's realtime events, from Homey's realtime socket),
 * `ready`/`setHeight` (the frame's height), `popup` and `shortPressHapticFeedback`.
 *
 * Other apps' widgets (`homey:app:<appId>:<widgetId>`) run the same way from `/app/<appId>/widgets/<id>/`, but talk to
 * Homey directly with this page's key: Homey's list of them, their own API, autocompletes, strings and realtime.
 * Their frames are sandboxed (an opaque origin: they can't read this page's `localStorage`, where the key is) unless
 * the user trusts one.
 */
(function () {
  'use strict';

  /** English, also the fallback while the app's strings haven't loaded (they're `web.*` in locales/<lang>.json). */
  const DEFAULT_STRINGS = {
    title: 'Web Dashboards',
    keyTitle: 'Connect to your Homey',
    keyText: 'Paste a personal API key. Make one in the Homey web app under Settings → API Keys, with the permissions Widgetkeeper\'s app settings list for the widgets that change things. It stays in this browser.',
    keyPlaceholder: 'API key',
    connect: 'Connect',
    keyRejected: 'Homey didn\'t accept this key.',
    forgetKey: 'Forget the key',
    loadFailed: 'Could not reach Widgetkeeper on your Homey.',
    retry: 'Try again',
    off: 'Web dashboards are turned off. Turn them on in the Widgetkeeper app settings in the Homey app.',
    offAway: 'Remote access is turned off. Turn it on in the Widgetkeeper app settings in the Homey app, or open this page on your home network.',
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
    darkLight: 'Dark or light',
    background: 'Background',
    bgDefault: 'Default',
    bgBlack: 'Black/White',
    bgSlate: 'Slate',
    bgOcean: 'Ocean',
    bgForest: 'Forest',
    bgPlum: 'Plum',
    bgBerry: 'Berry',
    bgSand: 'Sand',
    arrangeHint: 'Drag the dashboards to change their order.',
    showWidgets: 'Show on the front page',
    duplicate: 'Duplicate',
    copyName: '__name__ (copy)',
    tooManyDashboards: 'At most __max__ dashboards.',
    pageSettings: 'Settings',
    thisBrowser: 'This browser',
    forgetKeyText: 'Signs this browser out: it asks for an API key again.',
    keepAwake: 'Keep screen on',
    keepAwakeLock: 'The screen stays on while this page is open.',
    keepAwakeVideo: 'Uses a silent video to keep the screen on. If it still sleeps, turn off sleep in the device\'s settings.',
    dim: 'Dim',
    dimOff: 'Off',
    dimText: 'Darkens the whole page, as if the screen were turned down.',
    backupTitle: 'Backup',
    backupText: 'The dashboards you choose in one file: their layouts, widgets, settings and the names typed on tiles. A restore brings back the ones you tick and leaves the others.',
    backupDownload: 'Download backup',
    backupRestore: 'Restore backup',
    backupSummary: '__dashboards__ dashboards, __widgets__ widgets, saved __date__.',
    backupConfirm: 'Tap again to restore',
    backupRestored: 'Restored: __dashboards__ dashboards, __widgets__ widgets.',
    backupInvalid: 'This file is not a Widgetkeeper web dashboards backup.',
    backupDownloadCount: 'Download __count__',
    backupRestoreCount: 'Restore __count__',
    backupReplaces: 'Replaces yours',
    backupNew: 'New',
    backupTooMany: 'At most 64 dashboards: untick __count__ new ones',
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
    width: 'Width',
    widthHint: 'How many columns it spans.',
    resize: 'Drag to change the width',
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
    passwordText: 'Enter the web dashboards password from the Widgetkeeper app settings.',
    passwordPlaceholder: 'Password',
    signIn: 'Sign in',
    passwordWrong: 'Wrong password.',
    passwordLocked: 'Too many tries. Try again in __seconds__ s.',
    sessionEnded: 'You were signed out. The password may have changed.',
    yourDashboards: 'Your dashboards',
    widgetsTitle: 'Widgets',
    widgetsText: 'Everything you can put on a dashboard.',
    previous: 'Previous',
    next: 'Next',
    chooseDevices: 'Choose devices',
    chooseDevice: 'Choose a device',
    changeDevices: 'Change devices',
    changeDevice: 'Change device',
    noneChosen: 'None chosen yet.',
    missingDevice: 'Device not found',
    allRooms: 'All rooms',
    chosen: 'Chosen',
    noRoom: 'No room',
    selectAll: 'Select all',
    clearAll: 'Clear all',
    chosenCount: '__count__ chosen',
    dragToOrder: 'Drag to change the order.',
    chooseValue: 'Choose a value',
    changeValue: 'Change the value',
    allDevices: 'All devices',
    noValues: 'No matching values.',
    valueOn: 'On',
    valueOff: 'Off',
    missingValue: 'Value not found',
    otherApps: 'Other apps',
    otherAppsKey: 'Other apps\' widgets need an API key with full access (Homey) in this browser.',
    otherAppsFailed: 'Could not read other apps\' widgets.',
    notInstalled: '__name__ isn\'t installed.',
    trustTitle: 'Trust this widget',
    trustHint: 'Runs it outside the sandbox, for a widget that doesn\'t work in it. A trusted widget can read this browser\'s API key.',
    popupYes: 'Yes',
    popupNo: 'No',
    popupElsewhereYes: 'Answered on another screen: Yes',
    popupElsewhereNo: 'Answered on another screen: No',
    popupClose: 'Close',
    popupPictureFailed: 'The picture could not be loaded',
    popupAnswerFailed: 'The answer didn\'t reach Homey',
    about: {
      electricity: 'Live power, the day\'s prices and your usage in charts.',
      thermostat: 'Three preset buttons for a thermostat or an aircon.',
      quickactions: 'Small tiles that switch a device with one tap.',
      sensoralarms: 'Tiles that turn red when a sensor raises an alarm.',
      sensordots: 'Motion, doors and cameras as a grid of dots.',
      roomhealth: "Each room's temperature, humidity and air at a glance, yellow to red when one is off.",
      valuematrix: 'Devices or rooms against chosen values, green, orange or red by their range.',
      weather: 'The next 36 hours, hour by hour.',
      pollen: "Today's pollen and the UV peak, for Europe.",
      heatmap: 'A week of any value as a weekday × hour heatmap.',
      cameras: 'Camera snapshots, with live video on a tap.',
      values: 'Any device value as a compact tile.',
      lights: 'Light tiles with brightness and colour at hand.',
      sparklines: 'Values with a small chart of their recent history.',
      charts: 'One or two charts of any value, like the electricity ones.',
      variables: 'Variables as rows you can switch or change.',
      varpresets: 'Buttons that set a variable to preset values.',
      flows:'Start flows with a tap, in your colours and icons.',
      price: 'The electricity price now and in the coming hours.',
      timers: 'Kitchen timers that keep running on your Homey.',
      locks: 'Every lock and door at a glance.',
      curtains: 'Open, close or set curtains and blinds.',
      media: 'A speaker\'s music, volume and sources in one card.',
      clock: 'The time and date, with the weather now if you like.',
      textline: 'A note on a tile or a Post-it, typed in or written by your Flows.',
      spacer: 'Empty space to line up widgets in columns.',
      dayssince: "Days since a chore was done, turning red when it's due.",
      stack: 'Widgets from another dashboard, taking turns.',
      shortcuts: 'Jump to your other web dashboards, in your colours and icons.',
      webpage: 'Any web page, scaled to fill the widget.',
    },
  };

  const KEY_STORAGE = 'widgetkeeper.web.key';
  /** The session token from signing in with the web dashboards password (when one is set), on top of the key. */
  const SESSION_STORAGE = 'widgetkeeper.web.session';
  /** This browser's own dark or light (the bar's button), over the dashboard's theme; none follows the dashboard. */
  const THEME_STORAGE = 'widgetkeeper.web.theme';
  /** Keep screen on (`'1'`), this browser's choice in Settings; absent lets the screen sleep. */
  const AWAKE_STORAGE = 'widgetkeeper.web.awake';
  /** Dim, this browser's choice in Settings: a percentage (5 … `MAX_DIM`); absent is off. */
  const DIM_STORAGE = 'widgetkeeper.web.dim';
  /** The most the page dims: never black, so the bar's pen and Settings stay findable. */
  const MAX_DIM = 80;
  const PREFIX = 'CF2_MESSAGE';
  const ACK_TIMEOUT_MS = 10e3;
  /** After a realtime outage this long, the frames reload: they may have missed changes (they re-read every 5 min). */
  const STALE_AFTER_MS = 30e3;
  const CONFIRM_MS = 3000;
  /** A popup's camera picture is read again this often while it shows. */
  const CAMERA_REFRESH_MS = 3000;
  /** How long "Answered on another screen" shows before the popup closes. */
  const ELSEWHERE_MS = 2000;
  /** A press on a widget's bar that moves this far is a drag. */
  const DRAG_SLOP = 6;
  /** Near the window's top or bottom edge, a drag scrolls the page. */
  const EDGE_PX = 64;
  /** Wide widgets' columns (settings/dashboard-layout.js, loaded first). */
  const LAYOUT = window.WidgetkeeperLayout;
  /** The most dashboards the app keeps (`MAX_DASHBOARDS` in lib/WebDashboardService.ts). */
  const MAX_DASHBOARDS = 64;

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

  /**
   * A button that needs a second tap within 3 s (no browser dialog, which would block a wall tablet). `text` may be an
   * icon (an element): it stays, and only the button's class and label say it's armed.
   */
  function confirmButton(className, text, onConfirm, confirmText, label) {
    let armed = 0;
    const iconOnly = typeof text !== 'string';
    const say = (words) => {
      if (!iconOnly) { b.textContent = words; return; }
      b.title = words;
      b.setAttribute('aria-label', words);
    };
    const b = button(className, iconOnly ? '' : text, () => {
      if (Date.now() - armed < CONFIRM_MS) { onConfirm(); return; }
      armed = Date.now();
      b.classList.add('armed');
      say(confirmText);
      setTimeout(() => {
        if (!b.isConnected) return;
        b.classList.remove('armed');
        say(iconOnly ? label : text);
      }, CONFIRM_MS);
    }, label);
    if (iconOnly) b.append(text);
    return b;
  }

  // Every frame's `getInitialData` carries the app's strings (~25 KB, ~100 KB encoded): a table, not toString(16) per
  // character.
  const HEX = Array.from({ length: 256 }, (_, i) => (i < 16 ? '0' : '') + i.toString(16));
  function hexEncode(input) {
    const out = new Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      out[i] = HEX[c >> 8] + HEX[c & 255];
    }
    return out.join('');
  }
  function hexDecode(input) {
    let out = '';
    for (const hex of input.match(/.{1,4}/g) || []) out += String.fromCharCode(parseInt(hex, 16));
    return out;
  }

  /** The app's logomark (assets/icon.svg): three rounded squares and a sparkle, stroked and filled in currentColor. */
  const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3">'
    + '<rect x="11.5" y="11.5" width="17" height="17" rx="5"/><rect x="11.5" y="35.5" width="17" height="17" rx="5"/>'
    + '<rect x="35.5" y="35.5" width="17" height="17" rx="5"/></g>'
    + '<path d="M44 11Q44 20 53 20Q44 20 44 29Q44 20 35 20Q44 20 44 11Z" fill="currentColor"/></svg>';

  /** The bar's icons: 24 px paths, stroked in the text colour. */
  const ICONS = {
    pen: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4zM13.5 6.5l4 4',
    fullScreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    fullScreenExit: 'M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5',
    moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
    plus: 'M12 5v14M5 12h14',
    left: 'M15 5l-7 7 7 7',
    right: 'M9 5l7 7-7 7',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    close: 'M6 6l12 12M18 6L6 18',
    down: 'M6 9l6 6 6-6',
    sliders: 'M4 6h9M17 6h3M15 4v4M4 12h3M11 12h9M9 10v4M4 18h11M19 18h1M17 16v4',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
    copy: 'M10 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM16 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  };

  /**
   * A colour setting's values drawn as swatches: the widgets' palette (kit.css's bright colours, which `swatch()`'s `wk`
   * class defines), plus Flow Buttons' grey. `default` and `neutral` are the widget's own colour, an outlined swatch.
   */
  const SWATCHES = {
    ...Object.fromEntries(window.WidgetkeeperKit.COLORS.map(c => [c, `var(--wk-${c}-bright)`])),
    grey: '#8E8F99', default: null, neutral: null,
  };

  /**
   * A dashboard's backdrops (`background`; the ids are `WEB_BACKGROUNDS` in lib/WebDashboardService.ts): calm tints,
   * each [light, dark], so the dashboard's theme still decides and transparent widgets' text stays readable. Default
   * is the page's own `--wd-bg` (dashboard.css).
   */
  const BACKGROUNDS = {
    default: ['#F4F4FA', '#111217'],
    black: ['#FFFFFF', '#000000'],
    slate: ['#E6EBF2', '#141A24'],
    ocean: ['#E1ECF9', '#0B1A2E'],
    forest: ['#E4F0E6', '#0F1C14'],
    plum: ['#EEE6F5', '#1C1226'],
    berry: ['#F6E6EA', '#24121A'],
    sand: ['#F3EEE4', '#1F1A13'],
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
  /** Opened away from home, through Homey's cloud relay: the app only answers then with Remote access on. */
  const AWAY = /\.connect\.athom\.com$/i.test(location.hostname);

  /** Another app's widget type (`homey:app:<appId>:<widgetId>`, its id on Homey's dashboards), split; null for ours. */
  function appWidget(type) {
    const m = /^homey:app:([A-Za-z0-9._-]{1,100}):([A-Za-z0-9_-]{1,60})$/.exec(String(type));
    return m && m[1] !== APP_ID ? { appId: m[1], widgetId: m[2] } : null;
  }

  /** What another app's widget frame may do: no `allow-same-origin`, so it can't read this page or its key. */
  const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';

  /** A text from another app's manifest: a string, or one per language. */
  function appText(text, language) {
    if (typeof text === 'string') return text;
    if (text && typeof text === 'object') return text[language] || text.en || '';
    return '';
  }

  /** `settings[device][id]=…`: settings as bracketed query keys, as Homey's autocomplete route reads them. */
  function bracketQuery(params, value, prefix) {
    for (const k of Object.keys(value || {})) {
      const v = value[k];
      const name = prefix ? `${prefix}[${k}]` : k;
      if (v == null) continue;
      if (typeof v === 'object') bracketQuery(params, v, name);
      else params.append(name, String(v));
    }
    return params;
  }

  /**
   * A 2-second black 16 × 16 H.264 video, played muted on a loop where the browser has no Wake Lock (it only has one
   * over HTTPS; the home address is http://). Made with ffmpeg 9: `-f lavfi -i color=black:s=16x16:r=1 -t 2 -c:v libx264
   * -profile:v baseline -pix_fmt yuv420p -an -movflags +faststart -map_metadata -1 -fflags +bitexact -flags:v +bitexact`.
   */
  const KEEP_AWAKE_VIDEO = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMGbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHNbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABeG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAThzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZHsBEAAADAAQAAAMACDxImSABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAApAAAAAAAAAABhzdHRzAAAAAAAAAAEAAAACAABAAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAACAAAAAQAAABxzdHN6AAAAAAAAAAAAAAACAAAChgAAAAoAAAAUc3RjbwAAAAAAAAABAAADNgAAAD11ZHRhAAAANW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAACGlsc3QAAAAIZnJlZQAAAphtZGF0AAACcAYF//9s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMyAwNDgwY2IwIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA5liIQFv///D0UAAU9/gAAAAAZBmjgK+oA=';

  /**
   * Keep screen on (this browser's choice in Settings): the Screen Wake Lock where the browser has it (HTTPS: away from
   * home through Homey's cloud), else a silent video playing on a loop, the NoSleep.js idea, which iOS and some others
   * keep the screen on for. The lock goes while the page is hidden, or when the system takes it, so it's asked for
   * again; a refused lock (a battery saver, a policy) falls back to the video. A video the browser won't start without
   * a tap (iOS in Low Power Mode) starts on the next tap or key, in the page or in a widget's frame (`watch()`).
   */
  const keepAwake = (() => {
    const nav = /** @type {any} */ (navigator);
    /** 'lock' or 'video', how it's kept on here. */
    let how = nav.wakeLock && typeof nav.wakeLock.request === 'function' ? 'lock' : 'video';
    let on = false;
    let lock = null;
    let asking = false;
    let video = null;
    /** A refused `play()` waits for a tap. */
    let waiting = false;

    async function holdLock() {
      if (!on || lock || asking || document.visibilityState !== 'visible') return;
      asking = true;
      try {
        const sentinel = await nav.wakeLock.request('screen');
        // Released by the system while the page shows (hidden is `visibilitychange`'s): asked for again.
        sentinel.addEventListener('release', () => { if (lock === sentinel) { lock = null; holdLock(); } });
        lock = sentinel;
        if (!on) release();
      } catch (e) {
        how = 'video';
        if (on) playVideo();
      }
      asking = false;
    }

    function release() {
      if (lock) { const held = lock; lock = null; held.release().catch(() => {}); }
      if (video) { video.pause(); video.remove(); video = null; }
    }

    function retry() {
      if (!waiting) return;
      waiting = false;
      if (on) playVideo();
    }

    /**
     * Retries a refused video on a tap or key in `win`: the page, or a widget's frame (same origin), where most taps
     * land and never reach the page. The events a browser counts as a user's.
     */
    function watch(win) {
      for (const type of ['pointerup', 'touchend', 'keydown']) win.addEventListener(type, retry, true);
    }
    watch(window);

    function playVideo() {
      if (!video) {
        video = document.createElement('video');
        video.className = 'wd-awake';
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('aria-hidden', 'true');
        video.src = KEEP_AWAKE_VIDEO;
        document.body.append(video);
      }
      const played = video.play();
      if (played && played.catch) played.catch(() => { waiting = true; });
    }

    document.addEventListener('visibilitychange', () => {
      if (!on || document.visibilityState !== 'visible') return;
      if (how === 'lock') holdLock(); else if (video && video.paused) playVideo();
    });

    return {
      /** How it's kept on here: 'lock' or 'video' (after a refused lock too). */
      get how() { return how; },
      get on() { return on; },
      /** Turns it on or off; the promise settles once a lock is held or refused. */
      async set(value) {
        on = !!value;
        if (!on) { release(); return; }
        if (how === 'lock') await holdLock(); else playVideo();
      },
      watch,
      retry,
    };
  })();

  /** This browser's Dim (0 is off), in steps of 5. */
  function dimLevel() {
    const v = Math.round(Number(storageGet(DIM_STORAGE)) / 5) * 5;
    return Number.isFinite(v) ? Math.min(MAX_DIM, Math.max(0, v)) : 0;
  }

  /**
   * Dims the page as if the screen were turned down: a black layer over everything, the widgets' frames included, that
   * lets taps through. Outside the page's root, so a redraw keeps it; the dialogs are in the top layer, above it.
   */
  let dimLayer = null;
  function applyDim(level) {
    if (!dimLayer) {
      if (!level) return;
      dimLayer = document.createElement('div');
      dimLayer.className = 'wd-dim';
      dimLayer.setAttribute('aria-hidden', 'true');
      document.body.append(dimLayer);
    }
    dimLayer.hidden = !level;
    dimLayer.style.opacity = String(level / 100);
  }

  /**
   * `opts.mountWidget(widget, wrap)`, when given, draws a widget into `wrap` in place of its iframe (the dev renders,
   * `dev/web-showcase.html`, mount the widgets with made-up data; `dashboard.html` never passes it).
   */
  window.mountWebDashboards = function (root, opts = {}) {
    let key = storageGet(KEY_STORAGE);
    let session = storageGet(SESSION_STORAGE);
    let setup = null; // `/web/setup`: {appId, homeyId, language, strings, widgets, dashboards}
    let types = new Map(); // widget id → its type (name, settings, devices …)
    let foreign = new Map(); // another app's widget (`homey:app:<appId>:<id>`) → its type, from Homey's list
    let foreignState = null; // that list: 'ok', 'noScope' (this key may not read it) or 'failed'
    const appLocales = new Map(); // app id → Promise of its strings
    const typeOf = (type) => types.get(type) || foreign.get(type);
    let dashboards = [];
    let frontPage = { widgets: true }; // the front page's choices (`/web/setup`'s `front`), made in its edit mode
    let current = null; // {dashboard, editing, grid, widgets: Map<widget id, {el, sig}>, covers: Map<`<id>@<column>`, el>}
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
      const params = [];
      if (session) params.push(`session=${encodeURIComponent(session)}`);
      if (AWAY) params.push('away=1');
      const url = params.length ? `${path}${path.includes('?') ? '&' : '?'}${params.join('&')}` : path;
      return fetchJson(method, `/api/app/${APP_ID}${url}`, body, true);
    }

    /**
     * Homey's own API (`/api<path>`) with the key: other apps' widget lists, routes, autocompletes and strings. A 403
     * there is a permission this key lacks (`scope`), not a rejected key.
     */
    function homeyRequest(method, path, body) {
      return fetchJson(method, `/api${path}`, body, false);
    }

    async function fetchJson(method, url, body, ours) {
      const headers = { Authorization: `Bearer ${key}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(url, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (res.status === 401 || (ours && res.status === 403)) {
        throw Object.assign(new Error((data && data.error) || `HTTP ${res.status}`), { unauthorized: true });
      }
      if (res.status === 403) throw Object.assign(new Error((data && data.error) || `HTTP ${res.status}`), { scope: true });
      if (!res.ok) {
        const err = new Error((data && (data.error || data.message)) || (typeof data === 'string' && data) || `HTTP ${res.status}`);
        // Signed out of the password (it changed, or was set meanwhile): ask for it again.
        if (/password required/.test(err.message)) { passwordLost(); throw Object.assign(err, { handled: true }); }
        throw err;
      }
      return data;
    }

    /** The password's session no longer counts: the socket stops, and the page asks for the password. */
    function passwordLost() {
      if (setup && setup.passwordRequired) return; // already asking (several frames' requests fail at once)
      const had = !!session;
      session = null;
      storageSet(SESSION_STORAGE, null);
      stopSocket();
      setLive(false);
      setup = setup && Object.assign({}, setup, { passwordRequired: true });
      renderPassword(had ? t('sessionEnded') : '');
    }

    async function loadSetup() {
      setup = await request('GET', '/web/setup');
      types = new Map((setup.widgets || []).map(w => [w.type, w]));
      dashboards = setup.dashboards || [];
      frontPage = setup.front || { widgets: true };
      if (setup.language) document.documentElement.lang = setup.language;
      if (setup.disabled || setup.passwordRequired) return; // turned off, or the password first: `route()` says so
      setPopups(setup.popups && setup.popups.popups, setup.popups && setup.popups.now);
      if (!socketStarted) {
        socketStarted = true;
        connectSocket();
      }
    }

    /**
     * Other apps' widgets, from Homey's list of every app's (`getAppWidgets()`, which needs `homey.dashboard.readonly`:
     * only a key with full access). Without it the dashboards still show them; only adding and editing them can't.
     */
    async function loadAll() {
      // Asked at once, read once the setup (with Homey's language) is in.
      const list = homeyRequest('GET', '/manager/dashboards/appwidget').then(all => ({ all, err: null }), err => ({ all: null, err }));
      await loadSetup();
      const { all, err } = await list;
      foreign = new Map();
      if (err) {
        if (err.unauthorized) throw err;
        foreignState = err.scope ? 'noScope' : 'failed';
        return;
      }
      const language = (setup && setup.language) || 'en';
      for (const w of Object.values(all || {})) {
        const at = w && appWidget(w.id);
        if (at) foreign.set(w.id, foreignType(w, at, language));
      }
      foreignState = 'ok';
    }

    /** Another app's widget as the editor offers it, like ours from `/web/setup` (`widgetTypes()`). */
    function foreignType(w, at, language) {
      const settings = (Array.isArray(w.settings) ? w.settings : []).filter(s => s && typeof s.id === 'string' && s.id).map((s) => {
        const title = appText(s.title, language) || s.id;
        const units = appText(s.units, language);
        return {
          id: s.id,
          type: s.type,
          title,
          // A number's unit goes after its field, from the label's `(…)` (`splitUnit()`).
          label: s.type === 'number' && units ? `${title} (${units})` : title,
          hint: appText(s.hint, language) || null,
          value: s.value === undefined ? null : s.value,
          min: typeof s.min === 'number' ? s.min : undefined,
          max: typeof s.max === 'number' ? s.max : undefined,
          values: Array.isArray(s.values) ? s.values.map(v => ({ id: String(v.id), title: appText(v.title, language) || String(v.id) })) : undefined,
        };
      });
      const filter = (w.devices && w.devices.filter) || {};
      const anyOf = (v) => (Array.isArray(v) ? v.join('|') : v == null ? '' : String(v));
      return {
        type: w.id,
        app: at,
        name: appText(w.name, language) || at.widgetId,
        ownerName: appText(w.ownerName, language) || at.appId,
        // A number, or a percentage of the width (`'100%'` is square: WidgetBoard's clocks, Network Visualizer).
        height: typeof w.height === 'number' || (typeof w.height === 'string' && /^\d+(\.\d+)?%$/.test(w.height)) ? w.height : null,
        transparent: w.transparent === true,
        devices: w.devices ? { singular: w.devices.singular === true, app: w.devices.type === 'app', class: anyOf(filter.class), capabilities: anyOf(filter.capabilities) } : null,
        settings,
        // Other apps' titles don't follow ours (CLAUDE.md, *Widget settings*): one card of them.
        sections: settings.length ? [{ kind: 'plain', ids: settings.map(s => s.id) }] : [],
        deprecated: w.deprecated === true,
      };
    }

    /** Another app's strings in Homey's language, as Homey gives its widget frames (`Homey.__`); `{}` when they can't be read. */
    function stringsOf(appId) {
      let p = appLocales.get(appId);
      if (!p) {
        p = homeyRequest('GET', `/manager/apps/app/${encodeURIComponent(appId)}/locale`).then(s => (s && typeof s === 'object' ? s : {}), () => {
          appLocales.delete(appId); // tried again by the next frame
          return {};
        });
        appLocales.set(appId, p);
      }
      return p;
    }

    // ---- Realtime: Homey's socket (socket.io v2), as homey-api connects ------------------------------------

    let socketGen = 0;
    let retryMs = 2000;
    let lostAt = null;
    let activeSocket = null;
    let activeNs = null; // its `/api` namespace, once subscribed
    const otherApps = new Set(); // the other apps whose events their widgets' frames listen to
    let retryTimer = null;

    /** Closes a socket with its connection: closing the root socket alone left the `/api` namespace's open. */
    function closeSocket(socket) {
      try { socket.io.close(); } catch (e) { /* closed */ }
      try { socket.close(); } catch (e) { /* closed */ }
    }

    /** Closes the socket and stops its retries (a rejected key). */
    function stopSocket() {
      socketGen++;
      socketStarted = false;
      retryMs = 2000;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      activeNs = null;
      if (activeSocket) closeSocket(activeSocket);
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
        activeNs = null;
        closeSocket(socket);
        setLive(false);
        if (lostAt == null) lostAt = Date.now();
        retryTimer = setTimeout(() => { retryTimer = null; connectSocket(); }, retryMs);
        retryMs = Math.min(retryMs * 2, 60e3);
      };
      try {
        const connected = waitFor(socket, 'connect');
        socket.open();
        await connected;
        const res = await ack(socket, 'handshakeClient', { token: key, homeyId: setup.homeyId });
        const ns = socket.io.socket(res && res.namespace ? res.namespace : '/api');
        const uri = `homey:app:${APP_ID}`;
        ns.on(uri, (event, data) => dispatch(uri, event, data));
        if (!ns.connected) {
          const nsConnected = waitFor(ns, 'connect');
          ns.open();
          await nsConnected;
        }
        await ack(ns, 'subscribe', uri);
        socket.on('disconnect', () => fail('disconnected'));
        ns.on('disconnect', () => fail('namespace disconnected'));
        if (failed) return;
        if (gen !== socketGen) { closeSocket(socket); return; } // stopped meanwhile
        activeNs = ns;
        for (const appId of otherApps) subscribeApp(ns, appId);
        retryMs = 2000;
        setLive(true);
        if (lostAt != null && Date.now() - lostAt > STALE_AFTER_MS) reloadFrames();
        if (lostAt != null) refreshPopups();
        lostAt = null;
      } catch (err) {
        fail(err);
      }
    }

    function setLive(on) {
      live = on;
      for (const node of root.querySelectorAll('.wd-live')) /** @type {HTMLElement} */ (node).hidden = on;
    }

    /** Another app's realtime events (`homey:app:<appId>`), for its widgets' frames; one that fails just stays quiet. */
    function subscribeApp(ns, appId) {
      const uri = `homey:app:${appId}`;
      ns.on(uri, (event, data) => dispatch(uri, event, data));
      ack(ns, 'subscribe', uri).catch(err => console.warn(`Realtime ${uri}:`, err && err.message ? err.message : err));
    }

    /** Subscribes to an app's events once its first widget frame listens (and again on every new socket). */
    function listenToApp(appId) {
      if (otherApps.has(appId)) return;
      otherApps.add(appId);
      if (activeNs && activeNs.connected) subscribeApp(activeNs, appId);
    }

    /** Listeners are per app and event (`homey:app:<appId>\n<event>`): two apps may both send `state`. */
    const listenerKey = (uri, event) => `${uri}\n${event}`;

    function dispatch(uri, event, data) {
      for (const fn of listeners.get(listenerKey(uri, event)) || []) {
        try { fn(data); } catch (e) { console.error(e); }
      }
    }

    // ---- The widget frames: Homey's crossframe protocol, parent side ----------------------------------------

    function post(frame, message) {
      const win = frame.iframe.contentWindow;
      // A sandboxed frame (another app's widget) has an opaque origin, which no target origin but `*` matches.
      if (win) win.postMessage(PREFIX + hexEncode(JSON.stringify(message)), frame.sandboxed ? '*' : location.origin);
    }

    function reply(frame, callbackId, err, result) {
      if (callbackId == null) return;
      const error = err ? { type: 'Error', data: String(err && err.message ? err.message : err) } : null;
      post(frame, { type: 'cb', args: [error, result === undefined ? null : result], callbackId });
    }

    /** This browser's own choice from the bar's button (`dark` or `light`), or null. */
    function ownTheme() {
      const v = storageGet(THEME_STORAGE);
      return v === 'dark' || v === 'light' ? v : null;
    }

    /** Whether a dashboard theme (`auto`, `dark`, `light`) shows dark, without this browser's own choice. */
    function themeIsDark(theme) {
      return theme === 'dark' || (theme !== 'light' && !!(darkQuery && darkQuery.matches));
    }

    function isDark() {
      const own = ownTheme();
      return own ? own === 'dark' : themeIsDark(current ? current.dashboard.theme : 'auto');
    }

    /** A backdrop's colour in the page's mode. */
    function backdrop(background) {
      const pair = BACKGROUNDS[background] || BACKGROUNDS.default;
      return pair[isDark() ? 1 : 0];
    }

    function setFrameHeight(frame, height) {
      const h = Number(height);
      if (Number.isFinite(h) && h >= 0) frame.iframe.style.height = `${Math.ceil(h)}px`;
    }

    /**
     * Another app's widget's own request (`Homey.api(method, path, body)`), straight to that widget's API on the
     * Homey (`/api/app/<appId>/widget/<widgetId>/api<path>`, as Homey's dashboard calls it) with this page's key.
     * Only below that: a path that leaves it (`..`) is refused, or a sandboxed widget could use the key for anything.
     */
    function appApi(app, method, path, qs, body) {
      const base = `/app/${encodeURIComponent(app.appId)}/widget/${encodeURIComponent(app.widgetId)}/api`;
      const rel = `${base}${String(path).startsWith('/') ? '' : '/'}${path}`;
      const url = new URL(`/api${rel}`, location.origin);
      if (url.pathname !== `/api${rel}` || !url.pathname.startsWith(`/api${base}/`)) return Promise.reject(new Error(`Not a widget route: ${path}`));
      const withBody = method !== 'GET' && method !== 'DELETE';
      return homeyRequest(method, `${rel}${qs ? `?${qs}` : ''}`, withBody ? (body == null ? {} : body) : undefined);
    }

    /**
     * The dashboard id a widget's `popup(url)` links to (`#/d/<id>`, Dashboard Shortcuts), or null. The SDK may hand the
     * URL on as given or resolved against the frame, so a link to this page or to the frame's own document counts.
     */
    function dashboardLink(url, frame) {
      let u;
      try { u = new URL(url, location.href); } catch (e) { return null; }
      const m = u.hash.match(/^#\/d\/([A-Za-z0-9_-]+)$/);
      if (!m || u.origin !== location.origin) return null;
      const own = [location.pathname, new URL(frame.iframe.src, location.href).pathname];
      return own.includes(u.pathname) ? m[1] : null;
    }

    function handle(frame, msg) {
      const id = msg.callbackId;
      const w = frame.widget;
      const def = typeOf(w.type);
      switch (msg.event) {
        case 'getInitialData': {
          // A new document in the frame (it reloads when it's moved): the old one's listeners and pending answers go.
          dropListeners(frame);
          const gen = ++frame.gen;
          const strings = frame.app ? stringsOf(frame.app.appId) : Promise.resolve((setup && setup.strings) || {});
          strings.then((locales) => {
            if (frame.gen !== gen) return;
            reply(frame, id, null, {
              settings: clone(w.settings || {}),
              deviceIds: (w.deviceIds || []).slice(),
              transparent: !!(def && def.transparent),
              locales,
              language: (setup && setup.language) || 'en',
              devmode: false,
              fontScale: 1,
              isDarkMode: isDark(),
            });
          });
          break;
        }
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
          const method = String(data.method || 'GET').toUpperCase();
          (frame.app ? appApi(frame.app, method, path, qs, data.body) : request('POST', '/web/call', { type: w.type, method, path, query, body: data.body == null ? {} : data.body, key }))
            .then(result => { if (frame.gen === gen) reply(frame, id, null, result); }, (err) => {
              if (frame.gen === gen) reply(frame, id, err);
              // A rejected key, or the dashboards turned off, is the page's to handle, as for its own requests.
              if (err && (err.unauthorized || /turned off/.test(String(err.message)))) failed(err);
            });
          break;
        }
        case 'registerRealtimeListener': {
          const event = listenerKey(`homey:app:${frame.app ? frame.app.appId : APP_ID}`, String(msg.data || ''));
          if (frame.app) listenToApp(frame.app.appId);
          const fn = (data) => post(frame, { type: 'cb', args: [data], callbackId: id });
          frame.subs.set(id, { event, fn });
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event).add(fn);
          break;
        }
        case 'popup': {
          const url = msg.data && typeof msg.data.url === 'string' ? msg.data.url : null;
          const dashboard = url && !frame.app ? dashboardLink(url, frame) : null;
          // Dashboard Shortcuts: another dashboard opens here (not from the editor, where a tap shouldn't leave it).
          if (dashboard) {
            if (!/\/edit$/.test(location.hash)) location.hash = `#/d/${dashboard}`;
          } else if (url) {
            window.open(url, '_blank', 'noopener');
          }
          reply(frame, id, null, null);
          break;
        }
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
      if (!msg || msg.type !== 'tx') return;
      // A sandboxed widget's tap only reaches the page as its message (an `api` call); the browser counts the tap
      // for the page too, so a refused Keep screen on video may start now.
      if (frame.sandboxed) keepAwake.retry();
      handle(frame, msg);
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

    /** The browser title: `Widgetkeeper - <dashboard name>` on a dashboard, else `Widgetkeeper Web Dashboards`. */
    function setTitle(dashboard) {
      document.title = dashboard ? `Widgetkeeper - ${dashboard.name || t('untitled')}` : brandName();
    }

    /** `Widgetkeeper Web Dashboards`: the app's name, then the page's (`web.title`, in Homey's language). */
    function brandName() {
      return `Widgetkeeper ${t('title')}`;
    }

    /** The front page's title: the app icon (the logomark, white on the brand colour) and the name. */
    function brand() {
      const node = el('h1', 'wd-brand');
      const mark = el('span', 'wd-logo');
      mark.innerHTML = LOGO;
      node.append(mark, el('span', 'wd-brand-name', brandName()));
      return node;
    }

    function clearRoot() {
      if (drag) endDrag(false);
      if (resizing) endResize(false);
      sizes.disconnect();
      setTitle(null);
      root.classList.remove('editing');
      root.textContent = '';
      current = null;
      sweepFrames();
    }

    /** The page's mode (this browser's own choice, else the theme) and the dashboard's backdrop (none: the page's). */
    function applyTheme(theme, background) {
      const html = document.documentElement;
      const own = ownTheme();
      const dark = own ? own === 'dark' : themeIsDark(theme);
      html.classList.toggle('homey-dark-mode', dark);
      const pair = background && background !== 'default' && BACKGROUNDS[background];
      if (pair) html.style.setProperty('--wd-bg', pair[dark ? 1 : 0]);
      else html.style.removeProperty('--wd-bg');
    }

    /** The bar's dark/light button: this browser only; back to following the theme when that shows the same. */
    function themeButton() {
      const b = button('wd-icon', '', () => {
        const dark = !isDark();
        storageSet(THEME_STORAGE, dark === themeIsDark(current ? current.dashboard.theme : 'auto') ? null : (dark ? 'dark' : 'light'));
        route(); // redraws the bar and the frames (their signature has the mode), or the front page's previews
      }, t('darkLight'));
      b.append(icon(isDark() ? 'sun' : 'moon'));
      return b;
    }

    // Full screen: the dashboard's bar keeps only the exit button, the dark/light one and the live note (dashboard.css).
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
      document.addEventListener(type, () => {
        const page = /** @type {any} */ (document);
        const full = !!(page.fullscreenElement || page.webkitFullscreenElement);
        document.documentElement.classList.toggle('wd-full', full);
        for (const b of root.querySelectorAll('.wd-full-toggle')) b.replaceChildren(icon(full ? 'fullScreenExit' : 'fullScreen'));
      });
    }

    if (darkQuery && darkQuery.addEventListener) {
      darkQuery.addEventListener('change', () => {
        if (ownTheme() || (current && current.dashboard.theme !== 'auto')) return;
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
          await loadAll();
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

    /** The web dashboards password (set in the app settings): asked after the key, before anything else. */
    function renderPassword(message) {
      clearRoot();
      applyTheme('auto');
      const input = el('input', 'wd-input');
      input.type = 'password';
      input.autocomplete = 'current-password';
      input.placeholder = t('passwordPlaceholder');
      const error = el('p', 'wd-error', message || '');
      const go = button('wd-btn primary', t('signIn'), async () => {
        if (!input.value) return;
        go.disabled = true;
        error.textContent = '';
        try {
          const res = await request('POST', '/web/login', { password: input.value });
          if (res && res.reason === 'notSet') { start(); return; } // the password was removed meanwhile: none needed
          if (!res || !res.ok) {
            go.disabled = false;
            error.textContent = res && res.reason === 'locked'
              ? t('passwordLocked', { seconds: res.retryAfter || 60 }) : t('passwordWrong');
            input.select();
            return;
          }
          session = res.token;
          storageSet(SESSION_STORAGE, session);
          start();
        } catch (err) {
          go.disabled = false;
          if (err && err.handled) return;
          if (err && (err.unauthorized || /turned off/.test(String(err.message)))) { failed(err); return; }
          error.textContent = t('loadFailed');
        }
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
      const form = el('div', 'wd-row');
      form.append(input, go);
      const forget = button('wd-btn quiet', t('forgetKey'), () => {
        storageSet(KEY_STORAGE, null);
        location.reload();
      });
      root.append(centered(el('h1', 'wd-h1', t('title')), el('p', 'wd-muted', t('passwordText')), form, error, forget));
      input.focus();
    }

    function renderOff() {
      clearRoot();
      applyTheme('auto');
      root.append(centered(
        el('h1', 'wd-h1', t('title')),
        el('p', 'wd-muted', t(setup && setup.away ? 'offAway' : 'off')),
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

    /** A widget type's short description (`web.about.<type>`); another app's widget's is its app's name. */
    function about(type) {
      const other = foreign.get(type);
      if (other) return other.ownerName;
      const strings = setup && setup.strings && setup.strings.web;
      const own = strings && strings.about && strings.about[type];
      return (typeof own === 'string' && own) || DEFAULT_STRINGS.about[type] || '';
    }

    /** Where the Homey serves a widget's files (`index.html`, the previews): ours beside this page, another app's under it. */
    function widgetFolder(type) {
      const app = appWidget(type);
      return app
        ? `/app/${encodeURIComponent(app.appId)}/widgets/${encodeURIComponent(app.widgetId)}`
        : `../widgets/${encodeURIComponent(type)}`;
    }

    /** A widget type's own preview (as Homey's widget picker shows it), served beside its files, in the page's theme. */
    function preview(type, className) {
      const img = el('img', className);
      img.src = `${widgetFolder(type)}/preview-${isDark() ? 'dark' : 'light'}.png`;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      return img;
    }

    /**
     * The front page: the dashboards as cards with a miniature of their columns, then a carousel of the widgets.
     * `editing` (`#/edit`, the pen in its bar): the cards are dragged into order, the carousel can be turned off, and
     * Forget the key is there (a user wanted it out of the way).
     */
    function renderList(editing = false) {
      clearRoot();
      applyTheme('auto');
      const page = el('div', `wd-home${editing ? ' arranging' : ''}`);

      const head = el('div', 'wd-section-head');
      const titles = el('div', 'wd-section-titles');
      titles.append(el('h1', 'wd-h1', t('yourDashboards')));
      if (editing) titles.append(el('p', 'wd-muted', t('arrangeHint')));
      head.append(titles);
      const grid = el('div', 'wd-dashboards');
      for (const d of dashboards) grid.append(dashboardCard(d, editing));
      if (editing) {
        arrangeCards(grid);
        page.append(head, grid);
        if (types.size) page.append(widgetCarousel(true));
        const settings = button('wd-btn quiet', '', () => pageSettings(), t('pageSettings'));
        settings.append(icon('sliders'), el('span', 'wd-bar-label', t('pageSettings')));
        const done = el('a', 'wd-btn primary', t('done'));
        done.href = '#/';
        root.append(bar(brand(), el('span', 'wd-spacer'), settings, done), page);
        return;
      }
      const add = button('wd-dash wd-dash-new', '', async () => {
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
      const plus = el('span', 'wd-dash-plus');
      plus.append(icon('plus'));
      add.append(plus, el('span', 'wd-dash-new-text', t('newDashboard')));
      grid.append(add);
      page.append(head, grid);
      if (types.size && frontPage.widgets) page.append(widgetCarousel());

      const edit = el('a', 'wd-icon');
      edit.href = '#/edit';
      edit.title = t('edit');
      edit.setAttribute('aria-label', t('edit'));
      edit.append(icon('pen'));
      root.append(bar(brand(), el('span', 'wd-spacer'), liveNote(), themeButton(), edit), page);
    }

    /** Saves the front page's choices (`order`, `widgets`) after the saves already queued; keeps what the app answers. */
    function saveFront(change) {
      saving = saving.then(async () => {
        try {
          const res = await request('PUT', '/web/front', change);
          if (res && Array.isArray(res.dashboards)) dashboards = res.dashboards;
          if (res && res.front) frontPage = res.front;
        } catch (err) {
          failed(err);
        }
      });
    }

    /** The front page's edit mode: Settings in its bar, a dialog with the backup, then this browser's Keep screen on, Dim and Forget the key. */
    function pageSettings() {
      const { d, body } = dialog(t('pageSettings'));
      d.classList.add('wd-page-settings');
      const browser = el('section', 'wd-page-section');
      const forget = button('wd-btn', t('forgetKey'), async () => {
        forget.disabled = true;
        if (session) await request('POST', '/web/logout', {}).catch(() => {});
        storageSet(KEY_STORAGE, null);
        storageSet(SESSION_STORAGE, null);
        location.reload();
      });
      // This browser's settings as the editor's rows: the label and a hint on the left, the control on the right.
      const setRow = (label, hint, control, id) => {
        const row = el('div', 'wd-set-row inline');
        const head = el('div', 'wd-set-text');
        const l = el(id ? 'label' : 'span', 'wd-set-label', label);
        if (id) l.htmlFor = id;
        head.append(l, el('p', 'wd-hint', hint));
        row.append(head, control);
        return row;
      };
      const box = el('input', 'wd-switch');
      box.type = 'checkbox';
      box.id = 'wd-keep-awake';
      box.setAttribute('role', 'switch');
      box.checked = keepAwake.on;
      const howText = () => t(keepAwake.how === 'lock' ? 'keepAwakeLock' : 'keepAwakeVideo');
      const awake = setRow(t('keepAwake'), howText(), box, box.id);
      awake.classList.add('switch');
      box.addEventListener('change', () => {
        storageSet(AWAKE_STORAGE, box.checked ? '1' : null);
        // In the tap, so a video may start; a refused lock turns to the video, and the hint says so.
        keepAwake.set(box.checked).then(() => { awake.querySelector('.wd-hint').textContent = howText(); });
      });
      // Dim: the page behind the dialog darkens while the slider moves; stored when it's let go. The slider spans the row.
      const slider = el('input', 'wd-dim-slider');
      slider.id = 'wd-dim-level';
      slider.type = 'range';
      slider.min = '0';
      slider.max = String(MAX_DIM);
      slider.step = '5';
      slider.value = String(dimLevel());
      const amount = el('span', 'wd-dim-value');
      const show = () => {
        const level = Number(slider.value);
        amount.textContent = level ? `${level} %` : t('dimOff');
        applyDim(level);
      };
      slider.addEventListener('input', show);
      slider.addEventListener('change', () => {
        show();
        storageSet(DIM_STORAGE, Number(slider.value) ? slider.value : null);
      });
      show();
      const dim = setRow(t('dim'), t('dimText'), amount, slider.id);
      dim.classList.add('wd-dim-row');
      dim.append(slider);
      const card = el('div', 'wd-set-card');
      card.append(awake, dim, setRow(t('keyPlaceholder'), t('forgetKeyText'), forget));
      browser.append(el('h3', 'wd-h2', t('thisBrowser')), card);
      body.append(backupSection(), browser);
      d.showModal();
    }

    /**
     * The Settings dialog's backup: the dashboards the user ticks as one file (`GET /web/backup?ids=`: the dashboards, the
     * front page's choices and their widgets' tile names), and a restore of the ones ticked in such a file, which replaces
     * those with the same id and adds the rest after a second tap; the others stay. Each opens a list in place of the
     * buttons (`backupChecklist()`). Here, not on the app settings page: my.homey.app runs that in a frame sandboxed
     * without downloads (2026-10-20).
     */
    function backupSection() {
      const section = el('section', 'wd-page-section');
      const status = el('p', 'wd-muted wd-backup-status');
      status.setAttribute('role', 'status');
      const file = el('input');
      file.type = 'file';
      file.accept = '.json,application/json';
      file.hidden = true;
      const row = el('div', 'wd-row wd-backup-row');
      let open = null; // the list shown in place of the buttons, under the file's summary
      const show = (list) => {
        if (open) open.remove();
        open = list;
        row.hidden = !!list;
        if (list) status.after(list);
      };
      const widgetsOf = d => (d && Array.isArray(d.columns)
        ? d.columns.reduce((m, c) => m + (Array.isArray(c) ? c.length : 0), 0) : 0);
      const download = button('wd-btn', t('backupDownload'), () => {
        status.textContent = '';
        const all = dashboards.slice();
        show(backupChecklist({
          items: all.map(d => ({ name: d.name, widgets: widgetsOf(d) })),
          action: count => t('backupDownloadCount', { count }),
          onCancel: () => show(null),
          onDone: async (chosen, list) => {
            list.busy(true);
            try {
              const picked = chosen.map(i => all[i]);
              const backup = await request('GET', `/web/backup?ids=${picked.map(d => encodeURIComponent(d.id)).join(',')}`);
              saveFile(backup, picked.length === 1 ? (picked[0].name || t('untitled')) : '');
              show(null);
            } catch (err) {
              list.busy(false);
              failed(err);
            }
          },
        }));
      });
      const restore = button('wd-btn', t('backupRestore'), () => {
        show(null);
        status.textContent = '';
        file.value = '';
        file.click();
      });
      file.addEventListener('change', async () => {
        const chosenFile = file.files && file.files[0];
        if (!chosenFile) return;
        let backup = null;
        try { backup = JSON.parse(await chosenFile.text()); } catch (e) { backup = null; }
        if (!backup || backup.format !== 'widgetkeeper-web-dashboards' || !Array.isArray(backup.dashboards)) {
          show(null);
          status.textContent = t('backupInvalid');
          return;
        }
        const inFile = backup.dashboards.filter(d => d && typeof d === 'object');
        const widgets = inFile.reduce((n, d) => n + widgetsOf(d), 0);
        const date = new Date(backup.exportedAt);
        status.textContent = t('backupSummary', {
          dashboards: inFile.length, widgets, date: Number.isNaN(date.getTime()) ? '?' : date.toLocaleString(),
        });
        const stored = new Set(dashboards.map(d => d.id));
        show(backupChecklist({
          items: inFile.map(d => ({
            name: typeof d.name === 'string' ? d.name : '', widgets: widgetsOf(d),
            tag: t(stored.has(d.id) ? 'backupReplaces' : 'backupNew'),
          })),
          action: count => t('backupRestoreCount', { count }),
          confirm: true,
          // A new dashboard (or a repeated id, which gets a new one) needs room under 64.
          problem: (chosen) => {
            const seen = new Set();
            let added = 0;
            for (const i of chosen) {
              const id = inFile[i].id;
              if (seen.has(id) || !stored.has(id)) added++;
              seen.add(id);
            }
            const over = added - (MAX_DASHBOARDS - dashboards.length);
            return over > 0 ? t('backupTooMany', { count: over }) : '';
          },
          onCancel: () => { show(null); status.textContent = ''; },
          onDone: (chosen, list) => {
            list.busy(true);
            const body = {
              format: backup.format, version: backup.version, app: backup.app, exportedAt: backup.exportedAt,
              front: backup.front, tileNames: backup.tileNames,
              dashboards: chosen.map(i => inFile[i]), complete: chosen.length === inFile.length,
            };
            saving = saving.then(async () => {
              try {
                const res = await request('PUT', '/web/backup', body);
                await loadSetup(); // the dashboards and the front page's choices as restored
                if (location.hash === '#/edit') renderList(true); // behind the dialog
                show(null);
                status.textContent = t('backupRestored', { dashboards: res.dashboards, widgets: res.widgets });
              } catch (err) {
                list.busy(false);
                if (/Not a Widgetkeeper backup/.test(String(err && err.message))) {
                  show(null);
                  status.textContent = t('backupInvalid');
                } else {
                  failed(err);
                }
              }
            });
          },
        }));
      });
      row.append(download, restore);
      section.append(el('h3', 'wd-h2', t('backupTitle')), el('p', 'wd-muted', t('backupText')), row, status, file);
      return section;
    }

    /** Downloads a backup as `widgetkeeper-web-dashboards-<date>.json`, or `widgetkeeper-web-<name>-<date>.json` for one. */
    function saveFile(backup, name) {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      // What a file name can't hold goes; spaces become dashes.
      const safe = name.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 40);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const a = el('a');
      a.href = url;
      a.download = `widgetkeeper-web-${safe || 'dashboards'}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60e3);
    }

    /**
     * The backup's list of dashboards (`items`: `{name, widgets, tag?}`), every one ticked: the count with Select all or
     * Clear all, a checkbox per dashboard, then `action(count)`'s button and Cancel. The button is disabled while none is
     * ticked or `problem(chosen)` says why (shown under the list); with `confirm` it asks for a second tap within 10 s
     * (`backupConfirm`). `onDone(chosen, list)` gets the ticked items' indexes in order; `list.busy(on)` disables it.
     * @param {{items: {name: string, widgets: number, tag?: string}[], action: (count: number) => string, confirm?: boolean,
     *   problem?: (chosen: number[]) => string, onDone: (chosen: number[], list: {busy: (on: boolean) => void}) => void,
     *   onCancel: () => void}} opts
     */
    function backupChecklist({ items, action, confirm = false, problem = () => '', onDone, onCancel }) {
      const box = el('div', 'wd-backup-pick');
      const chosen = new Set(items.map((_, i) => i));
      const ordered = () => items.map((_, i) => i).filter(i => chosen.has(i));
      const head = el('div', 'wd-backup-head');
      const count = el('span', 'wd-muted');
      const toggle = button('wd-btn quiet small', '', () => {
        const all = chosen.size === items.length;
        boxes.forEach((input, i) => {
          input.checked = !all;
          if (all) chosen.delete(i); else chosen.add(i);
        });
        draw();
      });
      head.append(count, toggle);
      const list = el('div', 'wd-backup-list');
      const boxes = items.map((item, i) => {
        const label = el('label', 'wd-backup-item');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = true;
        input.addEventListener('change', () => {
          if (input.checked) chosen.add(i); else chosen.delete(i);
          draw();
        });
        const text = el('span', 'wd-backup-item-text');
        const name = el('span', 'wd-backup-item-name', item.name || t('untitled'));
        name.dir = 'auto';
        text.append(name, el('span', 'wd-muted', t('widgetCount', { count: item.widgets })));
        label.append(input, text);
        if (item.tag) label.append(el('span', 'wd-backup-tag', item.tag));
        list.append(label);
        return input;
      });
      const note = el('p', 'wd-backup-note');
      note.setAttribute('role', 'status');
      let armed = false;
      let timer = 0;
      let busy = false;
      const go = button('wd-btn primary', '', () => {
        if (confirm && !armed) {
          armed = true;
          go.classList.add('armed');
          go.textContent = t('backupConfirm');
          timer = setTimeout(() => { if (box.isConnected) draw(); }, 10e3);
          return;
        }
        draw();
        onDone(ordered(), handle);
      });
      const cancel = button('wd-btn', t('cancel'), onCancel);
      const foot = el('div', 'wd-row wd-backup-foot');
      foot.append(go, cancel);
      /** The count, the toggle's words and what may be pressed; disarms the button. */
      function draw() {
        clearTimeout(timer);
        armed = false;
        go.classList.remove('armed');
        const why = problem(ordered());
        count.textContent = t('chosenCount', { count: chosen.size });
        toggle.textContent = t(chosen.size === items.length ? 'clearAll' : 'selectAll');
        toggle.disabled = busy || !items.length;
        note.textContent = why;
        go.textContent = action(chosen.size);
        go.disabled = busy || !chosen.size || !!why;
        cancel.disabled = busy;
        for (const input of boxes) input.disabled = busy;
      }
      const handle = { busy(on) { busy = on; draw(); } };
      box.append(head, list, note, foot);
      draw();
      return box;
    }

    /**
     * Deletes a dashboard after the saves already queued, and no save of it after (a name field's change can fire on the
     * way); then `done()`.
     */
    function deleteDashboard(id, done) {
      deleted.add(id);
      saving = saving.then(async () => {
        try {
          await request('DELETE', `/web/dashboards/${encodeURIComponent(id)}`);
          dashboards = dashboards.filter(x => x.id !== id);
          done();
        } catch (err) {
          deleted.delete(id);
          failed(err);
        }
      });
    }

    /**
     * The front page's edit mode: copies a dashboard (after the saves already queued); the app puts the copy right after
     * it, with the widgets' tile names. The copy is then shown, focused and marked for a moment.
     */
    function duplicate(id) {
      const tooMany = () => toast(t('tooManyDashboards', { max: MAX_DASHBOARDS }));
      if (dashboards.length >= MAX_DASHBOARDS) { tooMany(); return; }
      for (const b of root.querySelectorAll('.wd-dash-copy')) /** @type {HTMLButtonElement} */ (b).disabled = true;
      saving = saving.then(async () => {
        try {
          const res = await request('POST', `/web/dashboards/${encodeURIComponent(id)}/copy`, {});
          if (res && Array.isArray(res.dashboards)) dashboards = res.dashboards;
          if (location.hash !== '#/edit' || !res || !res.dashboard) return;
          renderList(true);
          const card = /** @type {HTMLElement} */ (root.querySelector(`.wd-dash[data-id="${res.dashboard.id}"]`));
          if (!card) return;
          card.classList.add('fresh');
          card.addEventListener('animationend', () => card.classList.remove('fresh'), { once: true });
          card.focus({ preventScroll: true });
          card.scrollIntoView({ block: 'nearest' });
        } catch (err) {
          if (/At most/.test(String(err && err.message))) tooMany(); else failed(err);
          if (location.hash === '#/edit') renderList(true);
        }
      });
    }

    /**
     * The front page's edit mode: a card is dragged (pointer events, so by touch too; the grid holds the capture, as
     * the card itself moves) and the others make room at once; arrow keys move a focused one. Escape puts them back.
     */
    function arrangeCards(grid) {
      const cards = () => [...grid.querySelectorAll('.wd-dash[data-id]')];
      const order = () => cards().map(c => /** @type {HTMLElement} */ (c).dataset.id);
      let move = null; // {card, pointerId, x0, y0, active, before: the order when it started}
      const finish = (keep) => {
        if (!move) return;
        const { card, active, before } = move;
        move = null;
        if (!active) return;
        card.classList.remove('lifted');
        root.classList.remove('dragging');
        const now = order();
        if (!keep) {
          for (const id of before) grid.append(cards().find(c => /** @type {HTMLElement} */ (c).dataset.id === id));
        } else if (now.join() !== before.join()) {
          saveFront({ order: now });
        }
      };
      grid.addEventListener('pointerdown', (e) => {
        const card = /** @type {Element} */ (e.target).closest('.wd-dash[data-id]');
        // A card's own button (Duplicate) is pressed, not dragged: the grid's capture would take its click.
        if (move || !card || e.button !== 0 || /** @type {Element} */ (e.target).closest('button')) return;
        move = { card, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, before: order() };
        try { grid.setPointerCapture(e.pointerId); } catch (err) { /* moves still come while over the grid */ }
        e.preventDefault();
      });
      grid.addEventListener('pointermove', (e) => {
        if (!move || e.pointerId !== move.pointerId) return;
        if (!move.active) {
          if (Math.hypot(e.clientX - move.x0, e.clientY - move.y0) < DRAG_SLOP) return;
          move.active = true;
          move.card.classList.add('lifted');
          root.classList.add('dragging');
        }
        const h = window.innerHeight;
        if (e.clientY < EDGE_PX) window.scrollBy(0, -16);
        else if (e.clientY > h - EDGE_PX) window.scrollBy(0, 16);
        const all = cards();
        const over = all.find((c) => {
          if (c === move.card) return false;
          const r = c.getBoundingClientRect();
          return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        });
        if (!over) return;
        const after = all.indexOf(over) > all.indexOf(move.card);
        grid.insertBefore(move.card, after ? over.nextSibling : over);
      });
      grid.addEventListener('pointerup', (e) => { if (move && e.pointerId === move.pointerId) finish(true); });
      grid.addEventListener('pointercancel', () => finish(false));
      grid.addEventListener('lostpointercapture', () => finish(true));
      grid.addEventListener('keydown', (e) => {
        const card = /** @type {HTMLElement} */ (e.target);
        const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
        if (!step || !card.matches('.wd-dash[data-id]')) return;
        e.preventDefault();
        const all = cards();
        const other = all[all.indexOf(card) + step];
        if (!other) return;
        grid.insertBefore(card, step > 0 ? other.nextSibling : other);
        card.focus();
        saveFront({ order: order() });
      });
      window.addEventListener('keydown', function escape(e) {
        if (!grid.isConnected) { window.removeEventListener('keydown', escape); return; }
        if (e.key === 'Escape' && move) finish(false);
      });
    }

    /**
     * A dashboard's card: a miniature of its columns (each widget as its preview), its name and widget count. While
     * the front page is edited it opens nothing: it's dragged (a grip in place of the pen), and it has Duplicate and Delete
     * (a second tap).
     */
    function dashboardCard(d, editing = false) {
      const card = el('div', 'wd-dash');
      card.dataset.id = d.id;
      const art = el('div', 'wd-dash-art');
      if (d.background && d.background !== 'default') art.style.setProperty('--wd-bg', backdrop(d.background));
      const columns = d.columns.length ? d.columns : [[]];
      for (const column of columns) {
        const col = el('div', 'wd-dash-col');
        for (const w of column.slice(0, 3)) col.append(preview(w.type, 'wd-dash-thumb'));
        if (!column.length) col.append(el('span', 'wd-dash-thumb empty'));
        art.append(col);
      }
      const link = el('a', 'wd-dash-link');
      if (!editing) link.href = `#/d/${d.id}`;
      const count = d.columns.reduce((n, c) => n + c.length, 0);
      const info = el('span', 'wd-dash-info');
      info.append(el('span', 'wd-dash-name', d.name || t('untitled')), el('span', 'wd-muted wd-dash-count', t('widgetCount', { count })));
      link.append(info);
      if (editing) {
        card.tabIndex = 0;
        card.setAttribute('aria-roledescription', t('drag'));
        card.setAttribute('aria-label', d.name || t('untitled'));
        const grip = el('span', 'wd-icon wd-dash-edit');
        grip.append(icon('grip'));
        const copy = button('wd-icon wd-dash-copy', '', () => duplicate(d.id), t('duplicate'));
        copy.append(icon('copy'));
        copy.disabled = dashboards.length >= MAX_DASHBOARDS;
        const remove = confirmButton('wd-icon wd-dash-delete', icon('trash'), () => deleteDashboard(d.id, () => {
          if (location.hash === '#/edit') renderList(true);
        }), t('tapAgain'), t('deleteDashboard'));
        card.append(art, link, remove, copy, grip);
        return card;
      }
      const edit = el('a', 'wd-icon wd-dash-edit');
      edit.href = `#/d/${d.id}/edit`;
      edit.title = t('edit');
      edit.setAttribute('aria-label', t('edit'));
      edit.append(icon('pen'));
      card.append(art, link, edit);
      return card;
    }

    /**
     * The widgets as a carousel: a native scroll-snap track (swipes and trackpads scroll it), arrows and dots, and it
     * moves on by itself every 5 s, except while the pointer or focus is on it, for 15 s after a touch, while the page
     * is hidden, and not at all with reduced motion.
     */
    function widgetCarousel(editing = false) {
      // One widget at a time in a small card under the dashboards (a user found a row of large previews took the
      // attention away from them): its preview, name and description, ‹ › and a count. It moves on every 6 s, but not
      // while the mouse or focus is on it, for 15 s after a tap, while the page is hidden, or with reduced motion.
      const section = el('section', 'wd-carousel');
      section.setAttribute('aria-label', t('widgetsTitle'));
      const head = el('div', 'wd-carousel-head');
      head.append(el('h2', 'wd-carousel-title', t('widgetsTitle')), el('span', 'wd-muted wd-carousel-text', t('widgetsText')));
      if (editing) {
        const label = el('label', 'wd-carousel-show');
        const box = el('input', 'wd-switch');
        box.type = 'checkbox';
        box.setAttribute('role', 'switch');
        box.checked = frontPage.widgets;
        section.classList.toggle('off', !box.checked);
        box.addEventListener('change', () => {
          section.classList.toggle('off', !box.checked);
          saveFront({ widgets: box.checked });
        });
        label.append(el('span', null, t('showWidgets')), box);
        head.append(label);
      }
      const sorted = [...types.values()].sort((a, b) => a.name.localeCompare(b.name));

      const card = el('article', 'wd-spot');
      const art = el('div', 'wd-spot-art');
      const text = el('div', 'wd-spot-text');
      const name = el('h3', 'wd-spot-name');
      const desc = el('p', 'wd-muted wd-spot-about');
      text.append(name, desc);
      const nav = el('div', 'wd-spot-nav');
      const prev = button('wd-icon wd-nav', '', () => { hold(); show(i - 1); }, t('previous'));
      prev.append(icon('left'));
      const next = button('wd-icon wd-nav', '', () => { hold(); show(i + 1); }, t('next'));
      next.append(icon('right'));
      const count = el('span', 'wd-spot-count');
      nav.append(prev, count, next);
      card.append(art, text, nav);
      section.append(head, card);

      let i = 0;
      function show(n) {
        i = (n + sorted.length) % sorted.length;
        const def = sorted[i];
        card.classList.add('swap');
        // The new content fades in (CSS); the image is swapped once loaded, so it doesn't blink.
        requestAnimationFrame(() => {
          art.textContent = '';
          art.append(preview(def.type, 'wd-spot-img'));
          name.textContent = def.name;
          desc.textContent = about(def.type);
          count.textContent = `${i + 1} / ${sorted.length}`;
          requestAnimationFrame(() => card.classList.remove('swap'));
        });
      }
      show(0);

      let heldUntil = 0;
      let hovered = false;
      let focused = false;
      function hold() { heldUntil = Date.now() + 15e3; }
      section.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hovered = true; });
      section.addEventListener('pointerleave', () => { hovered = false; });
      section.addEventListener('focusin', () => { focused = true; });
      section.addEventListener('focusout', () => { focused = false; });
      card.addEventListener('pointerdown', hold);
      const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const timer = setInterval(() => {
        if (!section.isConnected) { clearInterval(timer); return; }
        if (still || hovered || focused || document.hidden || Date.now() < heldUntil) return;
        show(i + 1);
      }, 6000);
      return section;
    }

    function renderMissing() {
      clearRoot();
      applyTheme('auto');
      const back = el('a', 'wd-btn', t('dashboards'));
      back.href = '#/';
      root.append(centered(el('p', 'wd-muted', t('missing')), back));
    }

    /** The widget ids' frame signature: a change (settings, devices, title, theme) reloads that frame. */
    const signature = (w) => JSON.stringify([w.type, w.title, w.settings, w.deviceIds, w.trusted === true, isDark()]);

    function renderDashboard(dashboard, editing) {
      clearRoot();
      setTitle(dashboard);
      applyTheme(dashboard.theme, dashboard.background);
      current = { dashboard: editable(dashboard), editing, widgets: new Map(), covers: new Map(), grid: el('main', 'wd-grid') };
      root.classList.toggle('editing', editing);
      root.append(editing ? editBar() : viewBar(), current.grid);
      sizes.observe(current.grid);
      syncGrid();
    }

    /**
     * A dashboard as the page edits it: a cover (`{cover: <id>}`) in each column a wide widget covers, where it sits in
     * that column (`settings/dashboard-layout.js`), so moving, adding and removing widgets carries them along.
     */
    function editable(d) {
      const copy = clone(d);
      copy.columns = LAYOUT.expand(copy.columns);
      return copy;
    }

    /** And as it's stored: each wide widget's place in the columns it covers as its `at`. */
    function stored(d) {
      const copy = clone(d);
      copy.columns = LAYOUT.collapse(copy.columns);
      return copy;
    }

    function viewBar() {
      const d = current.dashboard;
      const back = el('a', 'wd-btn quiet wd-back', '‹');
      back.href = '#/';
      back.title = t('dashboards');
      back.setAttribute('aria-label', t('dashboards'));
      const items = [back, el('span', 'wd-bar-title', d.name || t('untitled')), el('span', 'wd-spacer'), liveNote(), themeButton()];
      // Safari on an iPad only has the webkit-prefixed calls.
      const doc = /** @type {any} */ (document.documentElement);
      const page = /** @type {any} */ (document);
      if (doc.requestFullscreen || doc.webkitRequestFullscreen) {
        const full = button('wd-icon wd-full-toggle', '', () => {
          if (page.fullscreenElement || page.webkitFullscreenElement) {
            (page.exitFullscreen || page.webkitExitFullscreen).call(page);
          } else {
            (doc.requestFullscreen || doc.webkitRequestFullscreen).call(doc);
          }
        }, t('fullScreen'));
        full.append(icon(page.fullscreenElement || page.webkitFullscreenElement ? 'fullScreenExit' : 'fullScreen'));
        items.push(full);
      }
      const edit = el('a', 'wd-icon wd-bar-edit');
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
      // current.dashboard, not d, when it changes: a save the app corrected swaps it for the app's copy.
      name.addEventListener('change', () => { const dash = current.dashboard; dash.name = name.value.trim(); setTitle(dash); persist(); });

      const cols = el('span', 'wd-stepper');
      const count = el('span', 'wd-count', String(d.columns.length));
      cols.append(
        button('wd-btn small', '−', () => setColumns(current.dashboard.columns.length - 1), t('columns')),
        count,
        button('wd-btn small', '+', () => setColumns(current.dashboard.columns.length + 1), t('columns')),
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
        current.dashboard.theme = theme.value;
        storageSet(THEME_STORAGE, null); // this browser's own dark or light would hide the choice
        applyTheme(theme.value, current.dashboard.background);
        persist();
        syncGrid();
        drawBackground();
      });

      // The backdrop: a button with the current one's swatch, opening the palette under it.
      const bgPick = el('span', 'wd-bgpick');
      const bgButton = button('wd-btn small', '', () => (pop.hidden ? openPalette() : closePalette()), t('background'));
      bgButton.setAttribute('aria-haspopup', 'true');
      bgButton.setAttribute('aria-expanded', 'false');
      const pop = el('div', 'wd-bgpop');
      pop.hidden = true;
      bgPick.append(bgButton, pop);
      const backgrounds = Object.keys(BACKGROUNDS).map(id => ({ id, title: t(`bg${id[0].toUpperCase()}${id.slice(1)}`) }));
      function drawBackground() {
        bgButton.replaceChildren(swatch(backdrop(current.dashboard.background), 'small'), t('background'));
        // Each swatch shows both its shades (the dark tints alone look alike): the theme picks one.
        const colours = Object.fromEntries(backgrounds.map(b => [b.id, `linear-gradient(135deg, ${BACKGROUNDS[b.id][0]} 50%, ${BACKGROUNDS[b.id][1]} 50%)`]));
        pop.replaceChildren(choiceGroup(null, backgrounds, current.dashboard.background || 'default', (id) => {
          current.dashboard.background = id;
          applyTheme(current.dashboard.theme, id);
          persist();
          drawBackground();
          closePalette();
          bgButton.focus();
        }, true, colours));
      }
      const outside = (e) => { if (!bgPick.contains(/** @type {Node} */ (e.target))) closePalette(); };
      const escape = (e) => { if (e.key === 'Escape') { closePalette(); bgButton.focus(); } };
      function openPalette() {
        pop.hidden = false;
        pop.style.left = '';
        const over = pop.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
        if (over > 0) pop.style.left = `${-over}px`; // kept inside a narrow window
        bgButton.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', escape, true);
        const on = pop.querySelector('.on');
        if (on) /** @type {HTMLElement} */ (on).focus();
      }
      function closePalette() {
        pop.hidden = true;
        bgButton.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', escape, true);
      }
      drawBackground();

      const remove = confirmButton('wd-btn danger', t('deleteDashboard'), () => deleteDashboard(d.id, () => { location.hash = '#/'; }), t('tapAgain'));

      const done = el('a', 'wd-btn primary', t('done'));
      done.href = `#/d/${d.id}`;
      return bar(name, cols, theme, bgPick, el('span', 'wd-spacer'), remove, done);
    }

    function setColumns(n) {
      const d = current.dashboard;
      if (n < 1 || n > 6) return;
      while (d.columns.length < n) d.columns.push([]);
      while (d.columns.length > n) {
        const last = d.columns.pop();
        d.columns[d.columns.length - 1].push(...last.filter(e => !e.cover)); // its widgets stay, in the column before
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
      if (resizing) endResize(false);
      tidyCovers();
      const { dashboard, grid, widgets, covers, editing } = current;
      const count = dashboard.columns.length;
      grid.style.setProperty('--cols', String(count));
      while (grid.children.length < count) grid.append(el('section', 'wd-col'));
      while (grid.children.length > count) grid.lastChild.remove();
      const seen = new Set();
      const coversSeen = new Set();
      dashboard.columns.forEach((column, c) => {
        const col = grid.children[c];
        const nodes = column.map((w, i) => {
          if (w.cover) {
            // The room a wide widget from the left takes in this column (`layoutWide()` sizes it).
            const key = `${w.cover}@${c}`;
            coversSeen.add(key);
            if (!covers.has(key)) covers.set(key, el('div', 'wd-cover'));
            return covers.get(key);
          }
          seen.add(w.id);
          const sig = signature(w);
          let entry = widgets.get(w.id);
          if (!entry || entry.sig !== sig) {
            if (entry) { entry.el.remove(); sizes.unobserve(entry.el); }
            entry = { el: widgetElement(w), sig };
            widgets.set(w.id, entry);
            sizes.observe(entry.el);
          }
          const span = LAYOUT.spanOf(w, c, count);
          entry.el.classList.toggle('wide', span > 1);
          if (span > 1) entry.el.style.setProperty('--span', String(span));
          else entry.el.style.removeProperty('--span');
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
        // Only what's out of place moves: what left the column goes first, so the widgets after it stay put (a moved
        // frame reloads).
        for (const child of [...col.children]) if (!nodes.includes(child)) child.remove();
        nodes.forEach((node, i) => { if (col.children[i] !== node) col.insertBefore(node, col.children[i] || null); });
      });
      for (const [id, entry] of widgets) {
        if (seen.has(id)) continue;
        entry.el.remove();
        sizes.unobserve(entry.el);
        widgets.delete(id);
      }
      for (const key of covers.keys()) if (!coversSeen.has(key)) covers.delete(key);
      sweepFrames();
      layoutWide();
    }

    /**
     * Keeps the covers in line with the widgets: a span no further than the last column, one cover in each column a
     * wide widget covers (a missing one at the column's end), none elsewhere.
     */
    function tidyCovers() {
      const columns = current.dashboard.columns;
      const wide = new Map();
      columns.forEach((column, c) => column.forEach((w) => {
        if (w.cover) return;
        const span = LAYOUT.spanOf(w, c, columns.length);
        if (span > 1) { w.span = span; wide.set(w.id, { c, span }); } else { delete w.span; delete w.at; }
      }));
      columns.forEach((column, k) => {
        const seen = new Set();
        const keep = column.filter((e) => {
          if (!e.cover) return true;
          const o = wide.get(e.cover);
          if (!o || k <= o.c || k >= o.c + o.span || seen.has(e.cover)) return false;
          seen.add(e.cover);
          return true;
        });
        for (const [id, o] of wide) if (k > o.c && k < o.c + o.span && !seen.has(id)) keep.push({ cover: id });
        column.splice(0, column.length, ...keep);
      });
    }

    // ---- Wide widgets: a cover in each column they cover takes their room; `place()` says how far down. --------

    /** Sizes the dashboard as it is: what changed, a widget's height, the window's width (a wide widget's height). */
    const sizes = new ResizeObserver(() => scheduleLayout());
    let layoutQueued = false;
    function scheduleLayout() {
      if (layoutQueued) return;
      layoutQueued = true;
      requestAnimationFrame(() => { layoutQueued = false; layoutWide(); });
    }

    /**
     * Moves the wide widgets and their covers down to where `place()` puts them (a top margin) and gives each cover
     * its widget's height. In one column (a phone) the wide widgets are as wide as the rest and the covers hidden (the
     * CSS), so the margins go.
     */
    function layoutWide() {
      if (!current) return;
      const { dashboard, grid, widgets, covers } = current;
      const cols = [...grid.children];
      const stacked = cols.length < 2 || /** @type {HTMLElement} */ (cols[1]).offsetLeft === /** @type {HTMLElement} */ (cols[0]).offsetLeft;
      const any = dashboard.columns.some((col, c) => col.some(w => !w.cover && LAYOUT.spanOf(w, c, cols.length) > 1));
      const nodeOf = (e, k) => (e.cover ? covers.get(`${e.cover}@${k}`) : widgets.get(e.id) && widgets.get(e.id).el);
      if (stacked || !any) {
        dashboard.columns.forEach((col, k) => col.forEach((e) => {
          const node = nodeOf(e, k);
          if (!node) return;
          node.style.marginTop = '';
          if (e.cover) node.style.height = '';
        }));
        return;
      }
      const gap = parseFloat(getComputedStyle(cols[0]).rowGap) || 0;
      const placed = LAYOUT.place(dashboard.columns, (e) => { const node = nodeOf(e, 0); return node ? node.offsetHeight : 0; }, gap);
      placed.forEach((col, k) => col.forEach(({ entry, margin, height, hidden }) => {
        const node = nodeOf(entry, k);
        if (!node) return;
        node.hidden = hidden;
        node.style.marginTop = margin ? `${margin}px` : '';
        if (entry.cover) node.style.height = `${height}px`;
      }));
    }

    /**
     * Puts a wide widget's covers at `y` (a top, in the window): in each column it covers, under the entries whose
     * middle is above it. From what's on screen, so every column agrees on which wide widget comes first.
     */
    function placeCovers(id, c, y) {
      const columns = current.dashboard.columns;
      const w = columns[c].find(e => e.id === id);
      for (let k = 0; k < columns.length; k++) {
        const i = columns[k].findIndex(e => e.cover === id);
        if (i >= 0) columns[k].splice(i, 1);
      }
      const span = LAYOUT.spanOf(w, c, columns.length);
      for (let k = c + 1; k < c + span; k++) columns[k].splice(indexAt(k, y, id), 0, { cover: id });
    }

    /** How many of column `k`'s entries (not `id`'s own) are above `y`: their middle is. */
    function indexAt(k, y, id) {
      const column = current.dashboard.columns[k];
      let i = 0;
      for (const e of column) {
        if ((e.cover || e.id) === id) continue;
        const node = e.cover ? current.covers.get(`${e.cover}@${k}`) : current.widgets.get(e.id) && current.widgets.get(e.id).el;
        const r = node && !node.hidden ? node.getBoundingClientRect() : null;
        if (r && r.top + r.height / 2 >= y) break;
        i++;
      }
      return i;
    }

    /** A widget's top on screen (where its covers line up). */
    const topOf = (id) => current.widgets.get(id).el.getBoundingClientRect().top;

    function widgetElement(w) {
      const app = appWidget(w.type);
      // Another app's widget still shows when this key can't read Homey's list (its defaults then: a card, no height).
      const def = typeOf(w.type) || (app && foreignState !== 'ok' ? { name: app.widgetId, height: null, transparent: false } : null);
      const node = el('article', 'wd-widget');
      node.dataset.id = w.id;
      if (current.editing) node.append(dragHandle(el('div', 'wd-tools')), resizeHandle(node));
      if (w.title) node.append(el('h2', 'wd-title', w.title));
      if (!def) {
        node.append(el('p', 'wd-error', app ? t('notInstalled', { name: app.appId }) : w.type));
        return node;
      }
      if (app && opts.mountWidget) return node; // the dev renders draw only ours
      const wrap = el('div', def.transparent ? 'wd-frame' : 'wd-frame card');
      if (opts.mountWidget) {
        node.append(wrap);
        opts.mountWidget(clone(w), wrap);
        return node;
      }
      const iframe = document.createElement('iframe');
      iframe.title = w.title || def.name;
      // A percentage height keeps that share of the width until the widget sets its own (`ready`/`setHeight`).
      if (typeof def.height === 'string') iframe.style.aspectRatio = `100 / ${parseFloat(def.height)}`;
      else iframe.style.height = `${def.height || 120}px`;
      iframe.setAttribute('allow', 'autoplay; fullscreen');
      // A frame far below the window loads when it's scrolled near, so the ones on screen get the Homey to themselves.
      iframe.loading = 'lazy';
      // The dashboard and widget ids: a Timers widget keeps its own timer, a Media widget its speaker choice.
      const instance = `web-${current.dashboard.id}-${w.id}`;
      // Another app's widget is sandboxed (no `allow-same-origin`: it can't read the key) unless the user trusts it.
      const sandboxed = !!app && w.trusted !== true;
      if (sandboxed) iframe.setAttribute('sandbox', SANDBOX);
      // Keep screen on's refused video retries on a tap in the widget too (each load is a new window).
      else iframe.addEventListener('load', () => { try { keepAwake.watch(iframe.contentWindow); } catch (e) { /* not ours */ } });
      iframe.src = `${widgetFolder(w.type)}/index.html?widgetInstanceId=${encodeURIComponent(instance)}`;
      wrap.append(iframe);
      node.append(wrap);
      frames.add({ widget: clone(w), iframe, subs: new Map(), gen: 0, app, sandboxed });
      return node;
    }

    /** The edit tools over a widget: its name, settings, moves and remove. */
    function setTools(node, w, c, i, n) {
      const tools = node.querySelector(':scope > .wd-tools');
      if (!tools) return;
      const def = typeOf(w.type);
      const cols = current.dashboard.columns.length;
      tools.textContent = '';
      const grip = el('span', 'wd-grip', '⠿');
      grip.title = t('drag');
      grip.setAttribute('aria-hidden', 'true');
      tools.append(
        grip,
        el('span', 'wd-tools-name', (def && def.name) || (appWidget(w.type) || { widgetId: w.type }).widgetId),
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
      right.disabled = c + LAYOUT.spanOf(w, c, cols) >= cols;
      const handle = node.querySelector(':scope > .wd-resize');
      if (handle) handle.hidden = cols - c < 2 && LAYOUT.spanOf(w, c, cols) < 2;
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
      if (LAYOUT.spanOf(at.widget, at.c, columns.length) > 1) {
        // A wide widget: past the entry above or below it in its own column, its covers at that height; or a column
        // over, lining up with its top.
        if (dc) {
          moveWide(id, at.c + dc, topOf(id));
          return;
        }
        const past = columns[at.c][at.i + di];
        if (!past) return;
        const node = past.cover ? current.covers.get(`${past.cover}@${at.c}`) : current.widgets.get(past.id).el;
        const r = node.getBoundingClientRect();
        columns[at.c].splice(at.i, 1);
        columns[at.c].splice(at.i + di, 0, at.widget);
        placeCovers(id, at.c, di < 0 ? r.top : r.bottom);
        persist();
        syncGrid();
        return;
      }
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

    /**
     * Puts a wide widget in column `c` (moved left so its span fits) with its top at `y` (in the window): in each of its
     * columns, under the entries whose middle is above `y`.
     */
    function moveWide(id, c, y) {
      const at = find(id);
      const columns = current.dashboard.columns;
      if (!at) return;
      const span = LAYOUT.spanOf(at.widget, at.c, columns.length);
      const to = Math.max(0, Math.min(c, columns.length - span));
      const i = indexAt(to, y, id);
      columns[at.c].splice(at.i, 1);
      columns[to].splice(Math.min(i, columns[to].length), 0, at.widget);
      placeCovers(id, to, y);
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
      const def = at && typeOf(at.widget.type);
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
      // A wide widget goes no further right than its span fits; the line is as wide as it.
      const columns = current.dashboard.columns;
      const at = find(drag.id);
      const span = at ? LAYOUT.spanOf(at.widget, at.c, columns.length) : 1;
      if (span > 1) c = Math.min(c, columns.length - span);
      const col = current.grid.children[c];
      if (!col) return;
      // Its own covers aren't places to go; other wide widgets' covers are: above or below them in this column.
      const own = [...current.covers.entries()].filter(([key]) => key.startsWith(`${drag.id}@`)).map(([, node]) => node);
      const others = [...col.children].filter(n => (n.classList.contains('wd-widget') || (n.classList.contains('wd-cover') && !n.hidden))
        && n !== drag.node && !own.includes(n));
      let i = 0;
      while (i < others.length) {
        const r = others[i].getBoundingClientRect();
        if (drag.y < r.top + r.height / 2) break;
        i++;
      }
      const prev = others[i - 1];
      drag.target = { c, i, y: prev ? prev.getBoundingClientRect().bottom + 1 : col.getBoundingClientRect().top };
      drag.marker.classList.toggle('wide', span > 1);
      if (span > 1) drag.marker.style.setProperty('--span', String(span));
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
      if (!drop || !active || !target || !current) return;
      const at = find(id);
      if (at && LAYOUT.spanOf(at.widget, at.c, current.dashboard.columns.length) > 1) moveWide(id, target.c, target.y);
      else moveTo(id, target.c, target.i);
    }

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (drag) endDrag(false);
      if (resizing) endResize(false);
    });

    // ---- Resizing (editing): a handle on a widget's right edge sets how many columns it spans. The width follows
    // the pointer a column at a time (a column counts once the pointer is past its middle); the covers follow on
    // release, at the widget's top. ------------------------------------------------------------------------------

    let resizing = null; // {id, node, pointerId, c, span, from}

    function resizeHandle(node) {
      const handle = el('div', 'wd-resize');
      handle.title = t('resize');
      handle.setAttribute('aria-hidden', 'true'); // the Width row in its settings is the keyboard's way
      handle.addEventListener('pointerdown', (e) => {
        if (drag || resizing || !current || !current.editing || e.button !== 0) return;
        const at = find(node.dataset.id);
        if (!at) return;
        const span = LAYOUT.spanOf(at.widget, at.c, current.dashboard.columns.length);
        resizing = { id: at.widget.id, node, pointerId: e.pointerId, c: at.c, span, from: span };
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* moves still come while over the handle */ }
        root.classList.add('resizing');
        e.preventDefault();
      });
      handle.addEventListener('pointermove', (e) => {
        if (!resizing || e.pointerId !== resizing.pointerId) return;
        const cols = [...current.grid.children];
        let span = 1;
        for (let k = resizing.c + 1; k < cols.length; k++) {
          const r = cols[k].getBoundingClientRect();
          if (e.clientX > r.left + r.width / 2) span = k - resizing.c + 1;
        }
        if (span === resizing.span) return;
        resizing.span = span;
        node.classList.toggle('wide', span > 1);
        node.style.setProperty('--span', String(span));
      });
      handle.addEventListener('pointerup', (e) => { if (resizing && e.pointerId === resizing.pointerId) endResize(true); });
      handle.addEventListener('pointercancel', () => endResize(false));
      handle.addEventListener('lostpointercapture', () => endResize(false));
      return handle;
    }

    function endResize(keep) {
      if (!resizing) return;
      const { id, node, c, span, from } = resizing;
      resizing = null;
      root.classList.remove('resizing');
      if (!keep || span === from) {
        node.classList.toggle('wide', from > 1);
        if (from > 1) node.style.setProperty('--span', String(from));
        else node.style.removeProperty('--span');
        return;
      }
      setSpan(id, c, span);
    }

    /** A widget's span (1: one column), its covers lined up with its top; saved. */
    function setSpan(id, c, span) {
      const at = find(id);
      if (!at) return;
      if (span > 1) at.widget.span = span;
      else { delete at.widget.span; delete at.widget.at; }
      placeCovers(id, c, topOf(id));
      persist();
      syncGrid();
    }

    function removeWidget(id) {
      const at = find(id);
      if (!at) return;
      current.dashboard.columns[at.c].splice(at.i, 1);
      for (const column of current.dashboard.columns) {
        const i = column.findIndex(e => e.cover === id);
        if (i >= 0) column.splice(i, 1);
      }
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
      const snapshot = stored(current.dashboard);
      saving = saving.then(async () => {
        if (deleted.has(snapshot.id)) return;
        try {
          const saved = await request('PUT', '/web/dashboards', snapshot);
          if (deleted.has(saved.id)) return;
          const i = dashboards.findIndex(d => d.id === saved.id);
          if (i >= 0) dashboards[i] = saved; else dashboards.push(saved);
          if (current && current.dashboard.id === saved.id
            && JSON.stringify(stored(current.dashboard)) === JSON.stringify(snapshot)
            && JSON.stringify(saved) !== JSON.stringify(snapshot)) {
            current.dashboard = editable(saved);
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
      if (err && err.handled) return; // the password screen is up
      if (err && err.unauthorized) { if (key) { forgetKey(); renderKey(t('keyRejected')); } return; } // once for several frames
      if (err && /turned off/.test(String(err.message))) { start(); return; } // turned off meanwhile
      toast(message || t('loadFailed'));
    }

    function toast(text) {
      const node = el('div', 'wd-toast', text);
      document.body.append(node);
      setTimeout(() => node.remove(), 4000);
    }

    // ---- Dialogs: choose a widget, a widget's settings -------------------------------------------------------

    /** A dialog with a title (and for a widget's settings its preview and description) and ✕. */
    function dialog(title, type) {
      const d = el('dialog', 'wd-dialog');
      const head = el('div', 'wd-dialog-head');
      if (type) {
        const who = el('div', 'wd-dialog-who');
        const text = el('div', 'wd-dialog-titles');
        text.append(el('h2', 'wd-h1', title), el('p', 'wd-muted', about(type)));
        who.append(preview(type, 'wd-dialog-preview'), text);
        head.append(who);
      } else {
        head.append(el('h2', 'wd-h2', title));
      }
      head.append(button('wd-tool', '✕', () => d.close(), t('cancel')));
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
      for (const def of [...types.values()].sort((a, b) => a.name.localeCompare(b.name))) list.append(typeButton(def));
      body.append(list);
      // Then other apps' widgets, by app (only what Homey still offers: not a deprecated one).
      const others = [...foreign.values()].filter(f => !f.deprecated)
        .sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.name.localeCompare(b.name));
      if (others.length || foreignState !== 'ok') {
        const head = el('div', 'wd-types-head');
        head.append(el('h3', 'wd-h2', t('otherApps')));
        if (foreignState === 'noScope') head.append(el('p', 'wd-muted', t('otherAppsKey')));
        else if (foreignState === 'failed') head.append(el('p', 'wd-error', t('otherAppsFailed')));
        body.append(head);
      }
      if (others.length) {
        const more = el('div', 'wd-types');
        for (const def of others) more.append(typeButton(def));
        body.append(more);
      }
      d.showModal();

      function typeButton(def) {
        const b = button('wd-type', '', () => {
          d.close();
          const settings = {};
          for (const s of def.settings) settings[s.id] = clone(s.value);
          const w = { id: newId(), type: def.type, title: '', settings, deviceIds: [] };
          current.dashboard.columns[column].push(w);
          persist();
          syncGrid();
          editWidget(w.id, { pickDevices: true });
        });
        const text = el('span', 'wd-type-text');
        text.append(el('span', 'wd-type-name', def.name), el('span', 'wd-type-about', about(def.type)));
        b.append(preview(def.type, 'wd-type-preview'), text);
        return b;
      }
    }

    /**
     * A widget's settings, laid out in cards by the sections the app gives (`settingSections()`: the titles' groups):
     * the devices, the general settings with the title, each group (a numbered one folds, with a summary of its
     * values in its header) and the slots. `pickDevices` (a widget just added) opens its device picker at once.
     */
    function editWidget(id, { pickDevices = false } = {}) {
      const at = find(id);
      if (!at) return;
      const w = at.widget;
      const def = typeOf(w.type);
      if (!def) return;
      const draft = { title: w.title || '', settings: clone(w.settings || {}), deviceIds: (w.deviceIds || []).slice() };
      const trust = { settings: { trusted: w.trusted === true } }; // another app's widget: run it unsandboxed
      for (const s of def.settings) if (!(s.id in draft.settings)) draft.settings[s.id] = clone(s.value);
      const { d, body } = dialog(def.name, def.type);
      d.classList.add('wd-settings');
      const byId = new Map(def.settings.map(s => [s.id, s]));
      const updates = []; // what follows the draft: the groups' summaries, the rows a switch turns off
      const changed = () => { for (const f of updates) f(); };
      let n = 0;
      const uid = () => `wd-f${++n}`;
      const card = (className) => el('section', `wd-set-card${className ? ` ${className}` : ''}`);
      const rows = (ids, label, hints = true) => ids.map(sid => settingRow(def, byId.get(sid), draft, changed, uid(), label ? label(byId.get(sid)) : undefined, hints));

      if (def.devices) body.append(devicePicker(def, draft, pickDevices));

      const title = el('input', 'wd-input');
      title.id = uid();
      title.value = draft.title;
      title.addEventListener('input', () => { draft.title = title.value; });
      const titleRow = el('div', 'wd-set-row inline');
      const titleText = el('div', 'wd-set-text');
      const titleLabel = el('label', 'wd-set-label', t('widgetTitle'));
      titleLabel.htmlFor = title.id;
      titleText.append(titleLabel, el('p', 'wd-hint', t('widgetTitleHint')));
      titleRow.append(titleText, title);

      // Its width in columns, as far as the columns to its right go (the resize handle's keyboard and touch twin).
      const count = current.dashboard.columns.length;
      const width = { span: LAYOUT.spanOf(w, at.c, count) };
      let widthRow = null;
      if (count - at.c > 1) {
        widthRow = el('div', 'wd-set-row inline');
        const widthText = el('div', 'wd-set-text');
        widthText.append(el('span', 'wd-set-label', t('width')), el('p', 'wd-hint', t('widthHint')));
        const spans = Array.from({ length: count - at.c }, (_, k) => ({ id: String(k + 1), title: String(k + 1) }));
        const seg = choiceGroup(null, spans, String(width.span), (v) => { width.span = Number(v); }, false);
        seg.setAttribute('aria-label', t('width'));
        widthRow.append(widthText, seg);
      }

      const sections = def.sections || [{ kind: 'plain', ids: def.settings.map(s => s.id) }];
      // A run of numbered groups (Flow Buttons' eight buttons) shares a card; one of more than two starts folded.
      const numbered = (sec) => sec && sec.kind === 'group' && sec.numbered;
      const runOf = sections.map((sec, i) => {
        if (!numbered(sec)) return 0;
        let a = i;
        let b = i;
        while (numbered(sections[a - 1])) a--;
        while (numbered(sections[b + 1])) b++;
        return b - a + 1;
      });

      let general = null;
      let stack = null;
      sections.forEach((sec, i) => {
        if (!numbered(sec)) stack = null;
        if (sec.kind === 'plain') {
          const c = card();
          if (i === 0) { c.append(titleRow); if (widthRow) c.append(widthRow); general = c; }
          c.append(...rows(sec.ids));
          body.append(c);
        } else if (sec.kind === 'slots') {
          // The slots' hint (on the first) goes above them, beside their narrow labels it would be a column.
          const c = card('wd-set-slots');
          const hint = sec.ids.map(sid => byId.get(sid).hint).find(Boolean);
          if (hint) c.append(el('p', 'wd-hint wd-set-note', hint));
          c.append(...rows(sec.ids, null, false));
          body.append(c);
        } else if (sec.numbered) {
          if (!stack) body.append(stack = card('wd-set-stack'));
          stack.append(groupCard(sec, runOf[i] <= 2));
        } else {
          const head = byId.get(sec.ids[0]);
          const c = card('wd-set-group');
          if (head.type === 'checkbox') {
            // A switch with its settings under it (the Smart Stack's page dots): they fade while it's off.
            c.append(...rows([head.id]));
            const sub = el('div', 'wd-set-sub');
            sub.append(...rows(sec.ids.slice(1)));
            c.append(sub);
            updates.push(() => { const off = draft.settings[head.id] !== true; sub.classList.toggle('off', off); sub.inert = off; });
          } else {
            c.append(el('h3', 'wd-set-title wd-set-caption', sec.title), ...rows(sec.ids));
          }
          body.append(c);
        }
      });
      if (!general) {
        general = card();
        general.append(titleRow);
        if (widthRow) general.append(widthRow);
        body.insertBefore(general, body.querySelector(':scope > .wd-set-card:not(.wd-set-devices)') || null);
      }
      if (def.app) {
        const c = card();
        c.append(settingRow(def, { id: 'trusted', type: 'checkbox', title: t('trustTitle'), hint: t('trustHint') }, trust, () => {}, uid()));
        body.append(c);
      }

      /** A numbered group (`Button 1`): a header that folds it, with what its values are; its rows under it. */
      function groupCard(sec, open) {
        const c = el('div', 'wd-set-fold');
        const inner = el('div', 'wd-set-rows');
        inner.id = uid();
        const head = button('wd-set-head', '', () => setOpen(!open));
        head.setAttribute('aria-controls', inner.id);
        const summary = el('span', 'wd-set-summary');
        const chevron = el('span', 'wd-set-chevron');
        chevron.append(icon('down'));
        head.append(el('span', 'wd-set-title', sec.title), summary, chevron);
        // The head's own label is the group's title when its title has no colon (Media's `Button 1`): not twice.
        inner.append(...rows(sec.ids, s => (s.label === sec.title ? '' : s.label)));
        c.append(head, inner);
        const setOpen = (on) => {
          open = on;
          c.classList.toggle('open', open);
          head.setAttribute('aria-expanded', String(open));
          inner.hidden = !open;
        };
        setOpen(open);
        updates.push(() => {
          const { parts, empty } = groupSummary(sec);
          summary.textContent = '';
          c.classList.toggle('empty', empty);
          if (empty) return; // its title is dimmed
          parts.forEach((p, k) => {
            if (k) summary.append(' · ');
            if (p.swatch !== undefined) summary.append(swatch(p.swatch, 'small'));
            summary.append(p.text);
          });
        });
        return c;
      }

      /** What a group's values are, for its header: the choices' names, the dropdowns' titles, the texts. */
      function groupSummary(sec) {
        const parts = [];
        let empty = false;
        sec.ids.forEach((sid, k) => {
          const s = byId.get(sid);
          const v = draft.settings[sid];
          if (s.type === 'autocomplete') {
            if (v && v.name) parts.push({ text: v.name });
            else if (k === 0) empty = true;
          } else if (s.type === 'dropdown') {
            const opt = (s.values || []).find(o => o.id === String(v));
            if (opt) parts.push(isSwatches(s) ? { text: opt.title, swatch: SWATCHES[opt.id] } : { text: opt.title });
          } else if (s.type === 'number') {
            if (k === 0 && v != null) parts.push({ text: `${v} ${splitUnit(s.title.slice(s.title.indexOf(':') + 1).trim()).label}`.trim() }); // `5 minutes`
          } else if (s.type === 'text' || s.type === 'textarea') {
            if (typeof v === 'string' && v.trim()) parts.push({ text: v.trim() });
          }
        });
        return { parts, empty };
      }

      changed();
      const actions = el('div', 'wd-actions');
      actions.append(
        button('wd-btn quiet', t('cancel'), () => d.close()),
        button('wd-btn primary', t('save'), () => {
          const now = find(id);
          if (now) {
            now.widget.title = draft.title.trim();
            now.widget.settings = draft.settings;
            now.widget.deviceIds = draft.deviceIds;
            if (trust.settings.trusted === true) now.widget.trusted = true;
            else delete now.widget.trusted;
            if (width.span !== LAYOUT.spanOf(now.widget, now.c, current.dashboard.columns.length)) {
              setSpan(id, now.c, width.span); // saves it all
              d.close();
              return;
            }
            persist();
            syncGrid();
          }
          d.close();
        }),
      );
      d.append(actions);
      d.showModal();
    }

    /** `Amber after (days)` → `Amber after` and `days`: a number's unit goes after its field. */
    function splitUnit(label) {
      const m = /^(.*\S)\s*\(([^()]{1,16})\)$/.exec(label || '');
      return m ? { label: m[1], unit: m[2] } : { label: label || '', unit: '' };
    }

    /** A dropdown of the widgets' colours, drawn as swatches. */
    const isSwatches = (s) => (s.values || []).length > 1 && s.values.every(v => v.id in SWATCHES) && s.values.some(v => SWATCHES[v.id]);

    function swatch(colour, className) {
      const dot = el('span', `wd-swatch-dot wk${className ? ` ${className}` : ''}${colour ? '' : ' plain'}`); // wk: kit.css's colours
      if (colour) dot.style.background = colour;
      return dot;
    }

    /**
     * One setting as a row: its label and hint, and its control, beside them (`inline`: a switch, a number, a short
     * choice, a text) or under them (a list, a search, a long text).
     */
    function settingRow(def, s, draft, changed, fid, label = s.label || s.title, withHint = true) {
      const { node, inline, labelable = true } = settingControl(def, s, draft, changed, fid);
      let text = label;
      if (s.type === 'number') {
        const split = splitUnit(label);
        text = split.label;
        if (split.unit) node.append(el('span', 'wd-unit', split.unit));
      }
      const row = el('div', `wd-set-row${inline ? ' inline' : ''}${s.type === 'checkbox' ? ' switch' : ''}`);
      const head = el('div', 'wd-set-text');
      if (text) {
        const l = el(labelable ? 'label' : 'span', 'wd-set-label', text);
        if (labelable) l.htmlFor = fid;
        else l.id = `${fid}-label`;
        head.append(l);
      }
      if (s.hint && withHint) head.append(el('p', 'wd-hint', s.hint));
      if (!labelable) node.setAttribute(text ? 'aria-labelledby' : 'aria-label', text ? `${fid}-label` : s.title);
      if (head.childElementCount) row.append(head);
      row.append(node);
      return row;
    }

    /** A setting's control, writing to the draft: a switch, swatches, a segmented choice, a select, a field, a picker. */
    function settingControl(def, s, draft, changed, fid) {
      const set = (v) => { draft.settings[s.id] = v; changed(); };
      const value = draft.settings[s.id];
      switch (s.type) {
        case 'checkbox': {
          const box = el('input', 'wd-switch');
          box.type = 'checkbox';
          box.id = fid;
          box.setAttribute('role', 'switch');
          box.checked = value === true;
          box.addEventListener('change', () => set(box.checked));
          return { node: box, inline: true };
        }
        case 'number': {
          const wrap = el('span', 'wd-num');
          const input = el('input', 'wd-input');
          input.type = 'number';
          input.id = fid;
          input.step = 'any';
          if (s.min != null) input.min = String(s.min);
          if (s.max != null) input.max = String(s.max);
          input.value = value == null ? '' : String(value);
          input.addEventListener('input', () => {
            const v = input.value.trim();
            set(v === '' ? null : Number(v));
          });
          wrap.append(input);
          return { node: wrap, inline: true };
        }
        case 'textarea': {
          const area = el('textarea', 'wd-input');
          area.id = fid;
          area.rows = 4;
          area.value = String(value ?? '');
          area.addEventListener('input', () => set(area.value));
          return { node: area, inline: false };
        }
        case 'dropdown': {
          const values = s.values || [];
          if (isSwatches(s) || (values.length <= 3 && values.reduce((sum, v) => sum + v.title.length, 0) <= 24)) {
            return { node: choiceGroup(s, values, value, set, isSwatches(s)), inline: true, labelable: false };
          }
          const select = el('select', 'wd-input');
          select.id = fid;
          for (const v of values) {
            const o = el('option', null, v.title);
            o.value = v.id;
            select.append(o);
          }
          select.value = String(value ?? '');
          select.addEventListener('change', () => set(select.value));
          return { node: select, inline: true };
        }
        case 'autocomplete': {
          const node = s.picker === 'capability' ? valuePicker(def, s, draft, changed) : autocompletePicker(def, s, draft, changed);
          node.id = fid;
          return { node, inline: false, labelable: false };
        }
        default: { // text
          const input = el('input', 'wd-input');
          input.id = fid;
          input.value = String(value ?? '');
          input.addEventListener('input', () => set(input.value));
          return { node: input, inline: true };
        }
      }
    }

    /** A short dropdown as one row of choices (`1 | 2`, `Standard | Compact`), or a colour's as swatches. */
    /** @param {Record<string, string | null>} [colours] a swatch's colour per value (the widgets' palette) */
    function choiceGroup(s, values, value, set, swatches, colours = SWATCHES) {
      const group = el('div', swatches ? 'wd-swatches' : 'wd-seg');
      group.setAttribute('role', 'radiogroup');
      const name = el('span', 'wd-swatch-name');
      const draw = (current) => {
        for (const b of group.querySelectorAll('button')) {
          const on = b.dataset.id === current;
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on || (!values.some(v => v.id === current) && b === group.querySelector('button')) ? 0 : -1;
        }
        const opt = values.find(v => v.id === current);
        name.textContent = opt ? opt.title : '';
      };
      for (const v of values) {
        const b = button(swatches ? 'wd-swatch' : 'wd-seg-option', swatches ? '' : v.title, () => { set(v.id); draw(v.id); });
        b.dataset.id = v.id;
        b.setAttribute('role', 'radio');
        if (swatches) {
          b.title = v.title;
          b.setAttribute('aria-label', v.title);
          b.append(swatch(colours[v.id]));
        }
        group.append(b);
      }
      // The arrow keys move the choice, as in a radio group.
      group.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const all = [...group.querySelectorAll('button')];
        const i = Math.max(0, all.findIndex(b => b.classList.contains('on')));
        const next = all[(i + step + all.length) % all.length];
        next.click();
        next.focus();
      });
      if (swatches) group.append(name);
      draw(String(value ?? ''));
      return group;
    }

    /** A device's icon: Homey's own drawing (a black glyph, inverted in dark mode), else a rounded square. */
    function deviceIcon(dev, className) {
      const box = el('span', `wd-devicon${className ? ` ${className}` : ''}`);
      if (dev && dev.icon) {
        const img = el('img');
        img.src = dev.icon;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => img.remove());
        box.append(img);
      }
      return box;
    }

    /** `Kitchen`, or `Ground floor › Kitchen` when the room sits under another zone. */
    const roomLabel = (dev) => (dev.zone ? [...dev.zone.path, dev.zone.name].join(' › ') : t('noRoom'));

    /**
     * The widget's devices in its settings: the chosen ones in their order (the widget's tiles follow it; drag the
     * grip to change it, ✕ to drop one) and a button that opens the device picker.
     */
    function devicePicker(def, draft, openAtOnce) {
      const singular = def.devices.singular;
      const wrap = el('section', 'wd-set-card wd-set-devices');
      const head = el('div', 'wd-set-cardhead');
      const count = el('span', 'wd-set-count');
      const list = el('div', 'wd-devlist');
      const hint = el('p', 'wd-hint', t('dragToOrder'));
      let byId = null; // id → device, once loaded
      // Another app's widget sends its filter: only this page can read that app's manifest.
      const filter = def.app ? `&class=${encodeURIComponent(def.devices.class)}&capabilities=${encodeURIComponent(def.devices.capabilities)}${def.devices.app ? '&app=1' : ''}` : '';
      const loading = request('GET', `/web/devices?type=${encodeURIComponent(def.type)}${filter}`).then((items) => {
        byId = new Map((items || []).map(d => [d.id, d]));
        draw();
        return items || [];
      });
      loading.catch((err) => { list.textContent = ''; list.append(el('p', 'wd-error', String(err.message || err))); });
      const choose = button('wd-btn small', '', async () => {
        let items;
        try { items = await loading; } catch (e) { return; }
        chooseDevices(def, items, draft.deviceIds, (ids) => { draft.deviceIds = ids; draw(); });
      });
      const caption = el('h3', 'wd-set-title', singular ? t('device') : t('devices'));
      head.append(caption, count, el('span', 'wd-spacer'), choose);
      wrap.append(head, list, hint);

      function draw() {
        list.textContent = '';
        const ids = draft.deviceIds;
        choose.textContent = t(ids.length ? (singular ? 'changeDevice' : 'changeDevices') : (singular ? 'chooseDevice' : 'chooseDevices'));
        hint.hidden = singular || ids.length < 2;
        count.textContent = singular || !ids.length ? '' : String(ids.length);
        if (!ids.length) { list.append(el('p', 'wd-hint wd-devnone', t('noneChosen'))); return; }
        for (const id of ids) {
          const dev = (byId && byId.get(id)) || { id, name: byId ? t('missingDevice') : '…', zone: null, icon: null, missing: !!byId };
          const row = el('div', `wd-devrow${dev.missing ? ' missing' : ''}`);
          row.dataset.id = id;
          if (!singular && ids.length > 1) {
            const grip = el('span', 'wd-devgrip');
            grip.title = t('drag');
            grip.append(icon('grip'));
            reorderBy(grip, row);
            row.append(grip);
          }
          const text = el('span', 'wd-devtext');
          text.append(el('span', 'wd-devname', dev.name));
          if (byId && !dev.missing) text.append(el('span', 'wd-hint', roomLabel(dev)));
          const remove = button('wd-icon wd-devremove', '', () => {
            draft.deviceIds = draft.deviceIds.filter(x => x !== id);
            draw();
          }, t('remove'));
          remove.append(icon('close'));
          row.append(deviceIcon(dev), text, remove);
          list.append(row);
        }
      }

      /** Drag a row by its grip (pointer events, so touch works): the rows move as it passes their middles. */
      function reorderBy(grip, row) {
        grip.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          grip.setPointerCapture(e.pointerId);
          row.classList.add('lifted');
          const move = (ev) => {
            const rows = [...list.querySelectorAll('.wd-devrow')].filter(r => r !== row);
            const before = rows.find(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
            if (before) { if (row.nextSibling !== before) list.insertBefore(row, before); } else if (list.lastChild !== row) list.append(row);
          };
          const up = () => {
            grip.removeEventListener('pointermove', move);
            grip.removeEventListener('pointerup', up);
            grip.removeEventListener('pointercancel', up);
            row.classList.remove('lifted');
            draft.deviceIds = [...list.querySelectorAll('.wd-devrow')].map(r => r.dataset.id);
            draw();
          };
          grip.addEventListener('pointermove', move);
          grip.addEventListener('pointerup', up);
          grip.addEventListener('pointercancel', up);
        });
      }

      draw();
      if (openAtOnce && !draft.deviceIds.length) setTimeout(() => choose.click(), 0);
      return wrap;
    }

    /**
     * The device picker: a wide dialog over the settings, with a search, the rooms as filters and the devices grouped
     * by room as tiles. One device: a tap picks it. Several: taps tick them (in that order), a room's Select all ticks
     * the room, and Done keeps it.
     */
    function chooseDevices(def, items, current, onDone) {
      const singular = def.devices.singular;
      let chosen = current.slice();
      const { d, body } = dialog(t(singular ? 'chooseDevice' : 'chooseDevices'));
      d.classList.add('wide', 'tall');
      const tools = el('div', 'wd-devtools');
      const search = el('input', 'wd-input');
      search.type = 'search';
      search.placeholder = t('search');
      const rooms = el('div', 'wd-rooms');
      tools.append(search, rooms);
      const groupsBox = el('div', 'wd-devgroups');
      body.append(tools, groupsBox);
      const count = el('span', 'wd-muted wd-devcount');
      const actions = el('div', 'wd-actions');
      if (singular) {
        actions.append(button('wd-btn quiet', t('cancel'), () => d.close()));
      } else {
        actions.append(count, el('span', 'wd-spacer'), button('wd-btn quiet', t('cancel'), () => d.close()),
          button('wd-btn primary', t('done'), () => { onDone(chosen); d.close(); }));
      }
      d.append(actions);

      // The rooms, in the order of their place in the home (`Ground floor › Kitchen`), devices without one last.
      const groups = new Map();
      for (const dev of items) {
        const key = dev.zone ? dev.zone.id : '';
        if (!groups.has(key)) groups.set(key, { key, label: dev.zone ? dev.zone.name : t('noRoom'), path: dev.zone ? dev.zone.path : [], devices: [] });
        groups.get(key).devices.push(dev);
      }
      const sortKey = (g) => (g.key ? [...g.path, g.label].join('\u0000').toLowerCase() : '\uffff');
      const ordered = [...groups.values()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      let room = 'all'; // 'all', 'chosen' or a zone id ('' for no room)

      function drawRooms() {
        rooms.textContent = '';
        const chip = (id, label, n) => {
          const b = button(`wd-room${room === id ? ' on' : ''}`, '', () => { room = id; drawRooms(); draw(); });
          b.append(el('span', null, label), el('span', 'wd-room-count', String(n)));
          b.setAttribute('aria-pressed', String(room === id));
          rooms.append(b);
        };
        chip('all', t('allRooms'), items.length);
        if (!singular) chip('chosen', t('chosen'), chosen.length);
        if (ordered.length > 1) for (const g of ordered) chip(g.key, g.label, g.devices.length);
      }

      function draw() {
        const q = search.value.trim().toLowerCase();
        const scroll = groupsBox.scrollTop;
        groupsBox.textContent = '';
        count.textContent = t('chosenCount', { count: chosen.length });
        let shown = 0;
        for (const g of ordered) {
          if (room !== 'all' && room !== 'chosen' && room !== g.key) continue;
          const devices = g.devices.filter(dev => (room !== 'chosen' || chosen.includes(dev.id))
            && (!q || `${dev.name} ${roomLabel(dev)}`.toLowerCase().includes(q)));
          if (!devices.length) continue;
          shown += devices.length;
          const group = el('section', 'wd-devgroup');
          const head = el('div', 'wd-devgroup-head');
          const title = el('div', 'wd-devgroup-title');
          if (g.path.length) title.append(el('span', 'wd-hint', g.path.join(' › ')));
          title.append(el('h3', 'wd-h2', g.label));
          head.append(title);
          if (!singular) {
            const all = devices.every(dev => chosen.includes(dev.id));
            head.append(button('wd-btn quiet small', t(all ? 'clearAll' : 'selectAll'), () => {
              if (all) chosen = chosen.filter(id => !devices.some(dev => dev.id === id));
              else for (const dev of devices) if (!chosen.includes(dev.id)) chosen.push(dev.id);
              drawRooms();
              draw();
            }));
          }
          const tiles = el('div', 'wd-devtiles');
          for (const dev of devices) {
            const on = chosen.includes(dev.id);
            const tile = button(`wd-devtile${on ? ' on' : ''}`, '', () => {
              if (singular) { onDone([dev.id]); d.close(); return; }
              chosen = on ? chosen.filter(id => id !== dev.id) : [...chosen, dev.id];
              drawRooms();
              draw();
            });
            tile.setAttribute('aria-pressed', String(on));
            const mark = el('span', 'wd-devcheck');
            mark.append(icon('check'));
            const order = chosen.indexOf(dev.id);
            if (!singular && on && chosen.length > 1) mark.dataset.n = String(order + 1);
            tile.append(deviceIcon(dev, 'large'), el('span', 'wd-devtile-name', dev.name), mark);
            tiles.append(tile);
          }
          group.append(head, tiles);
          groupsBox.append(group);
        }
        if (!shown) groupsBox.append(el('p', 'wd-hint', t('noDevices')));
        groupsBox.scrollTop = scroll;
      }

      search.addEventListener('input', draw);
      drawRooms();
      draw();
      d.showModal();
      search.focus();
    }

    /**
     * The devices with the values a widget's slots may show (`/web/values`), shared by its slots while they're open
     * and read again after 30 s, so a dialog shows current readings.
     */
    const valueLists = new Map(); // type → {at, promise}
    function valueDevices(type) {
      const hit = valueLists.get(type);
      if (hit && Date.now() - hit.at < 30e3) return hit.promise;
      const promise = request('GET', `/web/values?type=${encodeURIComponent(type)}`).then(items => items || []);
      promise.catch(() => valueLists.delete(type));
      valueLists.set(type, { at: Date.now(), promise });
      return promise;
    }

    /** A value as its tile shows it (the kit's `formatValue()`, which the page loads first). */
    function formatReading(cap) {
      return window.WidgetkeeperKit.formatValue(cap, cap.value, key => t(key === 'on' ? 'valueOn' : 'valueOff'));
    }

    /** What a slot keeps (as its autocomplete's item, `listCapabilitySlots()`): the widgets read the id. */
    function slotItem(dev, cap) {
      const description = [dev.zone && dev.zone.name, cap.units].filter(Boolean).join(' · ');
      return { id: `${dev.id}:${cap.id}`, name: `${dev.name} · ${cap.title}`, ...(description ? { description } : {}) };
    }

    /**
     * A device value slot (Device Values' and Sparklines' tiles): the chosen value as a row (the device's icon, the
     * value's name over the device and room; a tap changes it, ✕ empties the tile), or a button that opens the picker.
     */
    function valuePicker(def, s, draft, changed = () => {}) {
      const wrap = el('div', 'wd-valsel');
      let devices = null;
      valueDevices(def.type).then((list) => { devices = list; draw(); }, () => {});

      const find = (id) => {
        const i = typeof id === 'string' ? id.indexOf(':') : -1;
        if (i < 0 || !devices) return null;
        const dev = devices.find(x => x.id === id.slice(0, i));
        const cap = dev && dev.caps.find(c => c.id === id.slice(i + 1));
        return cap ? { dev, cap } : null;
      };
      const open = async () => {
        let list;
        try { list = await valueDevices(def.type); } catch (err) { toast(String(err.message || err)); return; }
        devices = list;
        const v = draft.settings[s.id];
        chooseValue(list, v && v.id, (item) => { draft.settings[s.id] = item; draw(); changed(); });
      };

      function draw() {
        wrap.textContent = '';
        const v = draft.settings[s.id];
        const id = v && typeof v.id === 'string' && v.id.includes(':') ? v.id : null;
        if (!id) {
          wrap.append(button('wd-btn', t('chooseValue'), open));
          return;
        }
        const hit = find(id);
        const row = button(`wd-valrow${devices && !hit ? ' missing' : ''}`, '', open);
        row.title = t('changeValue');
        const text = el('span', 'wd-devtext');
        if (hit) {
          text.append(el('span', 'wd-devname', hit.cap.title),
            el('span', 'wd-hint', [hit.dev.name, hit.dev.zone && hit.dev.zone.name].filter(Boolean).join(' · ')));
        } else {
          text.append(el('span', 'wd-devname', v.name || id), el('span', 'wd-hint', devices ? t('missingValue') : '…'));
        }
        row.append(deviceIcon(hit && hit.dev), text);
        if (hit) row.append(el('span', 'wd-valreading', formatReading(hit.cap)));
        const remove = button('wd-icon wd-devremove', '', () => { draft.settings[s.id] = null; draw(); changed(); }, t('clear'));
        remove.append(icon('close'));
        const line = el('div', 'wd-valline');
        line.append(row, remove);
        wrap.append(line);
      }

      draw();
      return wrap;
    }

    /**
     * The device value picker: the device picker's dialog (a search, the rooms as filters, each room's devices as
     * tiles), where a device opens its values with their readings and a tap on one picks it. A search also lists the
     * matching values straight away (`temperature` gives every temperature), so one tap is enough.
     */
    function chooseValue(devices, currentId, onDone) {
      const { d, body } = dialog(t('chooseValue'));
      d.classList.add('wide', 'tall');
      const tools = el('div', 'wd-devtools');
      const search = el('input', 'wd-input');
      search.type = 'search';
      search.placeholder = t('search');
      const rooms = el('div', 'wd-rooms');
      tools.append(search, rooms);
      const box = el('div', 'wd-devgroups');
      body.append(tools, box);
      const actions = el('div', 'wd-actions');
      actions.append(el('span', 'wd-spacer'), button('wd-btn quiet', t('cancel'), () => d.close()));
      d.append(actions);

      const pick = (dev, cap) => { onDone(slotItem(dev, cap)); d.close(); };

      // The rooms, in the order of their place in the home, devices without one last (as the device picker).
      const groups = new Map();
      for (const dev of devices) {
        const key = dev.zone ? dev.zone.id : '';
        if (!groups.has(key)) groups.set(key, { key, label: dev.zone ? dev.zone.name : t('noRoom'), path: dev.zone ? dev.zone.path : [], devices: [] });
        groups.get(key).devices.push(dev);
      }
      const sortKey = (g) => (g.key ? [...g.path, g.label].join('\u0000').toLowerCase() : '\uffff');
      const ordered = [...groups.values()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      let room = 'all';
      // The device whose values show, or null for the rooms; opens at the current choice's device.
      const sep = typeof currentId === 'string' ? currentId.indexOf(':') : -1;
      let device = sep > 0 ? devices.find(x => x.id === currentId.slice(0, sep)) || null : null;

      function drawRooms() {
        rooms.textContent = '';
        rooms.hidden = !!device || ordered.length < 2;
        const chip = (id, label, n) => {
          const b = button(`wd-room${room === id ? ' on' : ''}`, '', () => { room = id; drawRooms(); draw(); });
          b.append(el('span', null, label), el('span', 'wd-room-count', String(n)));
          b.setAttribute('aria-pressed', String(room === id));
          rooms.append(b);
        };
        chip('all', t('allRooms'), devices.length);
        for (const g of ordered) chip(g.key, g.label, g.devices.length);
      }

      /** A value's row: its title over the device (with the device's icon when `withDevice`), and its reading. */
      function valueRow(dev, cap, withDevice) {
        const on = `${dev.id}:${cap.id}` === currentId;
        const row = button(`wd-valoption${on ? ' on' : ''}`, '', () => pick(dev, cap));
        const text = el('span', 'wd-devtext');
        text.append(el('span', 'wd-devname', cap.title));
        if (withDevice) text.append(el('span', 'wd-hint', dev.name));
        if (withDevice) row.append(deviceIcon(dev));
        row.append(text, el('span', 'wd-valreading', formatReading(cap)));
        const mark = el('span', 'wd-valcheck');
        if (on) mark.append(icon('check'));
        row.append(mark);
        return row;
      }

      function groupHead(g, extra) {
        const head = el('div', 'wd-devgroup-head');
        const title = el('div', 'wd-devgroup-title');
        if (g.path.length) title.append(el('span', 'wd-hint', g.path.join(' › ')));
        title.append(el('h3', 'wd-h2', g.label));
        head.append(title);
        if (extra) head.append(extra);
        return head;
      }

      function draw() {
        box.textContent = '';
        drawRooms();
        if (device) { drawDevice(); return; }
        const q = search.value.trim().toLowerCase();
        let shown = 0;
        for (const g of ordered) {
          if (room !== 'all' && room !== g.key) continue;
          const section = el('section', 'wd-devgroup');
          if (!q) {
            // The devices as tiles; a tap opens its values.
            const tiles = el('div', 'wd-devtiles');
            for (const dev of g.devices) {
              const chosen = sep > 0 && dev.id === currentId.slice(0, sep);
              const tile = button(`wd-devtile${chosen ? ' on' : ''}`, '', () => { device = dev; box.scrollTop = 0; draw(); });
              tile.append(deviceIcon(dev, 'large'), el('span', 'wd-devtile-name', dev.name),
                el('span', 'wd-hint wd-valnames', dev.caps.map(c => c.title).join(', ')));
              tiles.append(tile);
            }
            shown += g.devices.length;
            section.append(groupHead(g), tiles);
          } else {
            // A search lists the values: all of a device whose name or room matches, else those whose title does.
            const list = el('div', 'wd-vallist');
            for (const dev of g.devices) {
              const whole = `${dev.name} ${roomLabel(dev)}`.toLowerCase().includes(q);
              for (const cap of dev.caps) {
                if (!whole && !`${cap.title} ${cap.id}`.toLowerCase().includes(q)) continue;
                list.append(valueRow(dev, cap, true));
                shown++;
              }
            }
            if (!list.childElementCount) continue;
            section.append(groupHead(g), list);
          }
          box.append(section);
        }
        if (!shown) box.append(el('p', 'wd-hint', t(q ? 'noValues' : 'noDevices')));
      }

      /** One device's values, with a way back to the rooms. */
      function drawDevice() {
        const head = el('div', 'wd-valhead');
        const back = button('wd-btn quiet small wd-valback', '', () => { device = null; draw(); search.focus(); });
        back.append(icon('left'), el('span', null, t('allDevices')));
        const who = el('div', 'wd-valwho');
        const text = el('span', 'wd-devtext');
        text.append(el('span', 'wd-devname', device.name), el('span', 'wd-hint', roomLabel(device)));
        who.append(deviceIcon(device, 'large'), text);
        head.append(back, who);
        const list = el('div', 'wd-vallist');
        for (const cap of device.caps) list.append(valueRow(device, cap, false));
        box.append(head, list);
      }

      // Typing goes back to the rooms, where the search lists the matching values.
      search.addEventListener('input', () => { device = null; draw(); });
      draw();
      d.showModal();
      if (!device) search.focus();
    }

    /** An autocomplete setting: the choice, and a search through the app's own listener (with the draft's settings). */
    function autocompletePicker(def, s, draft, changed = () => {}) {
      const wrap = el('div', 'wd-picker');
      const head = el('div', 'wd-row');
      const pick = button('wd-btn wd-choice', '', () => toggle());
      const clear = button('wd-btn quiet small', t('clear'), () => {
        draft.settings[s.id] = null;
        label();
        changed();
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
          // The page's key goes along: the Smart Stack's dashboards are read with the app's stored key. Another app's
          // autocomplete is Homey's to ask that app (it needs a key with full access, as Homey's list of them does).
          const items = def.app
            ? await homeyRequest('GET', `/manager/dashboards/appwidget/${encodeURIComponent(def.type)}/autocomplete?${bracketQuery(new URLSearchParams({ settingId: s.id, query: search.value }), draft.settings, 'settings')}`)
            : await request('POST', '/web/autocomplete', { type: def.type, setting: s.id, query: search.value, settings: draft.settings, key });
          if (mine !== seq) return;
          list.textContent = '';
          if (!items || !items.length) list.append(el('p', 'wd-hint', t('nothingFound')));
          for (const item of items || []) {
            const row = button('wd-option', '', () => {
              const chosen = {};
              for (const k in item) if (k !== 'image') chosen[k] = item[k];
              draft.settings[s.id] = chosen;
              label();
              changed();
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

    // ---- Popups (wk-084): a Flow's message or Yes/No question, over everything ----------------------------------

    /**
     * The open popups (`lib/PopupService.ts`), oldest first, each with `localUntil` (its end on this browser's clock).
     * One shows at a time, in a modal dialog (the top layer: above the dim layer, full screen and the frames): a
     * dashboard shows those sent to it and to everywhere, the front page only everywhere's, the editor none.
     */
    const popups = new Map();
    const dismissed = new Set(); // messages tapped away on this screen (the others keep theirs)
    let shownPopup = null; // {id, d, close(note)}

    /** Takes the open popups as Homey lists them (`/web/setup`, `/web/popups`), its clock beside them. */
    function setPopups(list, now) {
      const skew = typeof now === 'number' ? now - Date.now() : 0;
      const ids = new Set();
      for (const p of Array.isArray(list) ? list : []) {
        ids.add(p.id);
        if (!popups.has(p.id)) addPopup(p, skew);
      }
      for (const id of [...popups.keys()]) if (!ids.has(id)) removePopup(id, null, 'closed');
      syncPopups();
    }

    function addPopup(p, skew) {
      const localUntil = p.until - skew;
      if (localUntil <= Date.now()) return;
      const timer = setTimeout(() => removePopup(p.id, null, 'expired'), localUntil - Date.now());
      popups.set(p.id, Object.assign({}, p, { localUntil, timer }));
    }

    function removePopup(id, answer, reason) {
      const p = popups.get(id);
      if (p) clearTimeout(p.timer);
      popups.delete(id);
      dismissed.delete(id);
      if (shownPopup && shownPopup.id === id) {
        // Another screen's answer: said for a moment, so this screen sees what happened.
        const note = reason === 'answered' && !shownPopup.answeredHere && answer != null
          ? t(answer ? 'popupElsewhereYes' : 'popupElsewhereNo') : null;
        shownPopup.close(note);
      }
      syncPopups();
    }

    /** Whether a popup belongs on the view now open. */
    function popupHere(p) {
      if (!setup || setup.disabled || setup.passwordRequired || !key) return false;
      const m = location.hash.match(/^#\/d\/([A-Za-z0-9_-]+)(\/edit)?$/);
      if (m) return !m[2] && (p.target === 'all' || p.target === `web:${m[1]}`);
      return p.target === 'all' && location.hash !== '#/edit';
    }

    /** Shows the oldest popup that belongs here, or closes the one shown when it no longer does (another view). */
    function syncPopups() {
      if (shownPopup) {
        const p = popups.get(shownPopup.id);
        if (p && !popupHere(p)) shownPopup.close(null);
        return;
      }
      for (const p of popups.values()) {
        if (!dismissed.has(p.id) && popupHere(p)) { showPopup(p); return; }
      }
    }

    function showPopup(p) {
      const d = el('dialog', 'wd-dialog wd-popup');
      d.classList.toggle('ask', p.kind === 'ask');
      const box = el('div', 'wd-popup-box');
      d.append(box);
      const timers = [];
      let closed = false;
      const shown = { id: p.id, d, answeredHere: false, close: null };

      if (p.picture) {
        const frame = el('div', 'wd-popup-picture loading');
        const img = el('img');
        img.alt = '';
        frame.append(img);
        box.append(frame);
        const load = async () => {
          if (closed) return;
          if (!document.hidden) {
            try {
              const res = await request('GET', `/web/popups/${encodeURIComponent(p.id)}/image`);
              if (closed) return;
              img.src = `data:${res.type};base64,${res.data}`;
              frame.classList.remove('loading', 'failed');
            } catch (err) {
              if (closed) return;
              if (frame.classList.contains('loading')) {
                frame.classList.replace('loading', 'failed');
                frame.append(el('p', 'wd-muted', t('popupPictureFailed')));
              }
            }
          }
          // A camera's snapshot is read again while it shows; a kept picture once.
          if (p.picture.source === 'camera') timers.push(setTimeout(load, CAMERA_REFRESH_MS));
        };
        load();
      }
      if (p.text) {
        const text = el('p', 'wd-popup-text', p.text);
        text.dir = 'auto';
        box.append(text);
      }
      const status = el('p', 'wd-popup-status');
      status.setAttribute('role', 'status');

      if (p.kind === 'ask') {
        const actions = el('div', 'wd-popup-actions');
        const send = async (answer) => {
          for (const b of actions.querySelectorAll('button')) b.disabled = true;
          shown.answeredHere = true;
          status.textContent = '';
          try {
            const res = await request('POST', `/web/popups/${encodeURIComponent(p.id)}/answer`, { answer });
            if (res && res.ok === false && res.reason === 'closed') {
              // Someone else was first: say what they answered.
              shown.answeredHere = false;
              removePopup(p.id, res.answer, res.answer == null ? 'closed' : 'answered');
            } else {
              removePopup(p.id, answer, 'answered');
            }
          } catch (err) {
            shown.answeredHere = false;
            status.textContent = t('popupAnswerFailed');
            for (const b of actions.querySelectorAll('button')) b.disabled = false;
          }
        };
        actions.append(
          button('wd-btn wd-popup-no', t('popupNo'), () => send(false)),
          button('wd-btn primary wd-popup-yes', t('popupYes'), () => send(true)),
        );
        box.append(actions, status);
      } else {
        // A message: a bar runs down to its end; a tap anywhere closes it on this screen.
        const bar = el('div', 'wd-popup-bar');
        const fill = el('span');
        bar.append(fill);
        box.append(bar);
        const left = Math.max(0, p.localUntil - Date.now());
        const total = Math.max(left, p.until - p.createdAt);
        fill.style.transform = `scaleX(${left / total})`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          fill.style.transition = `transform ${left}ms linear`;
          fill.style.transform = 'scaleX(0)';
        }));
        d.addEventListener('click', () => { dismissed.add(p.id); shown.close(null); });
        d.setAttribute('aria-label', p.text || t('popupClose'));
      }

      // Escape closes it here (a question stays open on the other screens).
      d.addEventListener('cancel', (e) => { e.preventDefault(); dismissed.add(p.id); shown.close(null); });
      shown.close = (note) => {
        if (closed) return;
        closed = true;
        for (const timer of timers) clearTimeout(timer);
        const done = () => {
          if (shownPopup === shown) shownPopup = null;
          d.close();
          d.remove();
          syncPopups();
        };
        if (note) {
          for (const b of d.querySelectorAll('button')) b.disabled = true;
          status.textContent = note;
          if (!status.isConnected) box.append(status);
          setTimeout(done, ELSEWHERE_MS);
        } else {
          done();
        }
      };
      shownPopup = shown;
      document.body.append(d);
      d.showModal();
      const yes = d.querySelector('.wd-popup-yes');
      if (yes) /** @type {HTMLElement} */ (yes).focus();
    }

    /** The open popups again, after a reconnect: a screen that was offline missed their events. */
    function refreshPopups() {
      request('GET', '/web/popups').then(res => setPopups(res && res.popups, res && res.now), () => { /* the next reconnect tries again */ });
    }

    {
      const uri = `homey:app:${APP_ID}`;
      const on = (event, fn) => {
        const k = listenerKey(uri, event);
        if (!listeners.has(k)) listeners.set(k, new Set());
        listeners.get(k).add(fn);
      };
      on('popups:show', (data) => {
        if (!data || typeof data.id !== 'string' || popups.has(data.id)) return;
        addPopup(data, typeof data.now === 'number' ? data.now - Date.now() : 0);
        syncPopups();
      });
      on('popups:close', (data) => {
        if (data && typeof data.id === 'string') removePopup(data.id, data.answer == null ? null : data.answer === true, data.reason);
      });
    }

    // ---- Routing: #/ the list, #/d/<id> a dashboard, #/d/<id>/edit editing it ---------------------------------

    function route() {
      queueMicrotask(syncPopups); // once this view is drawn: its popups show, another view's close
      if (!key) { renderKey(); return; }
      if (!setup) { start(); return; }
      if (setup.disabled) { renderOff(); return; }
      if (setup.passwordRequired) { renderPassword(); return; }
      if (location.hash === '#/edit') { renderList(true); return; }
      const m = location.hash.match(/^#\/d\/([A-Za-z0-9_-]+)(\/edit)?$/);
      if (!m) { renderList(); return; }
      const dashboard = dashboards.find(d => d.id === m[1]);
      if (!dashboard) { renderMissing(); return; }
      renderDashboard(dashboard, !!m[2]);
    }

    async function start() {
      if (!key) { renderKey(); return; }
      try {
        await loadAll();
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
    keepAwake.set(storageGet(AWAKE_STORAGE) === '1');
    applyDim(dimLevel());
    start();
  };
})();
