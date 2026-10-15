/*
 * Notes: a short text, typed in the widget's settings, written by a Flow card (a named note) or read from a Logic
 * text variable. As a tile (one line, cut off with … or scrolling) or as a Post-it note stuck on the dashboard, in
 * handwriting, wrapping up to three lines. Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const DEFAULT_STRINGS = {
    noMessage: 'No message',
    typeNote: 'Type your note in the widget settings.',
    variableMissing: 'Variable not found',
    selectVariable: 'Pick a text variable in the widget settings.',
    error: 'Could not load the text.',
    boardInUse: 'Has a text',
    boardNew: 'New note',
  };

  /** The note a widget shows unless its `board` setting names another (DEFAULT_BOARD in lib/TextLineService.ts). */
  const DEFAULT_BOARD = 'Note';
  const COLORS = ['yellow', 'orange', 'red', 'purple', 'blue', 'green'];
  const SIZES = ['small', 'default', 'large'];
  const ALIGNS = ['left', 'center', 'right'];
  /** The Post-it's handwriting in px per size, and the smaller steps it may take to fit three lines. */
  const NOTE_FONT = { small: 24, default: 30, large: 38 };
  const NOTE_STEPS = [1, 0.86, 0.74, 0.64];
  const NOTE_LINES = 3;
  /** The scrolling text moves this many px a second, after a pause at each end. */
  const SCROLL_SPEED = 40;

  /**
   * The tile's optional icon: a copy of Flow Buttons' `ICONS` (Homey serves each widget's files separately; a test
   * checks the two are equal). The ids are the `icon` setting's, Flow Buttons' `listIcons()`.
   */
  const ICONS = {
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
  const SVG_NS = 'http://www.w3.org/2000/svg';

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

  /** A board's key: its name trimmed and lower-cased (boardKey() in lib/TextLineService.ts). */
  function boardKey(name) {
    const n = typeof name === 'string' ? name.trim() : '';
    return (n || DEFAULT_BOARD).toLowerCase().slice(0, 60);
  }

  /** A small number from a string, the same every time: the note's tilt per widget. */
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  /** The note's tilt in degrees: 2–3.5 one way or the other, picked by `seed` (the user asked for more than 0.6–1.8). */
  function noteTilt(seed) {
    const h = hash(String(seed || 'default'));
    const deg = 2 + (h % 16) / 10;
    return Math.round(((h >>> 8) & 1 ? deg : -deg) * 10) / 10;
  }

  /**
   * What the widget shows: `{text, muted}`. The typed message; or the note's text (a Flow's) or the variable's value,
   * with the typed message (else a muted "No message") while that's empty.
   */
  function textLineContent({ source, board, variable, variableChosen, message }, t) {
    const typed = typeof message === 'string' && message.trim() ? message.trim() : '';
    if (source === 'typed') return typed ? { text: typed, muted: false } : { text: t('typeNote'), muted: true };
    const empty = () => (typed ? { text: typed, muted: false } : { text: t('noMessage'), muted: true });
    if (source === 'variable') {
      if (!variableChosen) return { text: t('selectVariable'), muted: true };
      if (!variable) return { text: '', muted: true };
      if (variable.missing) return { text: t('variableMissing'), muted: true };
      const v = variable.value == null ? '' : String(variable.value);
      return v.trim() ? { text: v, muted: false } : empty();
    }
    const text = board && typeof board.text === 'string' ? board.text : '';
    return text.trim() ? { text, muted: false } : empty();
  }

  /**
   * @param {HTMLElement} root
   * @param {{ style?: string, source?: string, align?: string, size?: string, overflow?: string, icon?: string | null,
   *   color?: string, message?: string, variableChosen?: boolean, seed?: string, reducedMotion?: boolean,
   *   t?: (key: string, tokens?: Record<string, unknown>) => string | null, onHeight?: (h: number) => void }} opts
   */
  function createTextLineWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`textline.${key}`, tokens) : null;
      if (s && s !== `textline.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const postit = opts.style === 'postit';
    const source = ['flow', 'variable'].includes(opts.source) ? opts.source : 'typed';
    const size = SIZES.includes(opts.size) ? opts.size : 'default';
    const align = ALIGNS.includes(opts.align) ? opts.align : 'left';
    const scroll = !postit && opts.overflow === 'scroll';
    const ownColor = COLORS.includes(opts.color) ? opts.color : null;
    const icon = !postit && opts.icon && Object.prototype.hasOwnProperty.call(ICONS, opts.icon) ? ICONS[opts.icon] : null;
    const reducedMotion = opts.reducedMotion != null ? opts.reducedMotion
      : !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    let board = null;
    let variable = null;
    let error = null;
    let loaded = false;

    root.classList.add('tl');
    root.dataset.style = postit ? 'postit' : 'tile';
    root.dataset.size = size;
    root.dataset.align = align;

    const box = el('div', { class: postit ? 'tl-note' : 'tl-tile' }, root);
    if (postit) box.style.setProperty('--tl-tilt', `${noteTilt(opts.seed)}deg`);
    if (icon) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'tl-icon');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', icon.d);
      if (icon.fill) path.setAttribute('class', 'filled');
      svg.appendChild(path);
      box.appendChild(svg);
    }
    // The note's paper sits inside it, so the curl's shadow (the note's ::after) goes under the paper.
    const wrap = el('div', { class: 'tl-wrap' }, postit ? el('div', { class: 'tl-paper' }, box) : box);
    const textEl = el('span', { class: 'tl-text', dir: 'auto' }, wrap);

    /** `/state`'s answer (`{language, board, variable}`), or a realtime entry under `board` or `variable`. */
    function setState(state) {
      if (!state) return;
      if ('board' in state) board = state.board;
      if ('variable' in state) variable = state.variable;
      error = null;
      loaded = true;
      render();
    }

    /** A failed first load shows the error; a failed refresh keeps the text. */
    function setError(message) {
      if (loaded) return;
      error = message || t('error');
      render();
    }

    function render() {
      const content = error ? { text: error, muted: true }
        : textLineContent({ source, board, variable, variableChosen: opts.variableChosen !== false, message: opts.message }, t);
      if (textEl.textContent !== content.text) textEl.textContent = content.text;
      root.classList.toggle('muted', content.muted);
      const flowColor = source === 'flow' && board && COLORS.includes(board.color) ? board.color : null;
      const color = flowColor || ownColor;
      if (color) box.dataset.color = color;
      else if (postit) box.dataset.color = 'yellow';
      else delete box.dataset.color;
      layout();
    }

    /** Fits the note's handwriting into three lines, or sets the tile's scroll. Then reports a changed height. */
    function layout() {
      if (postit) fitNote();
      else if (scroll) setScroll();
      reportHeight();
    }

    function fitNote() {
      const base = NOTE_FONT[size];
      // Measured with the clamp lifted: under -webkit-line-clamp the height is already cut to three lines.
      const s = textEl.style;
      s.setProperty('display', 'block');
      s.setProperty('-webkit-line-clamp', 'none');
      s.setProperty('overflow', 'visible');
      for (const step of NOTE_STEPS) {
        const px = Math.round(base * step);
        s.fontSize = `${px}px`;
        const lineHeight = px * 1.1;
        // The layout height: getBoundingClientRect() is of the tilted note's box, a few px taller than the text.
        const h = textEl.offsetHeight;
        if (!h || h <= lineHeight * NOTE_LINES + 1) break;
      }
      for (const p of ['display', '-webkit-line-clamp', 'overflow']) s.removeProperty(p);
    }

    function setScroll() {
      wrap.classList.remove('scrolling');
      textEl.style.removeProperty('--tl-shift');
      if (reducedMotion) return;
      const over = textEl.scrollWidth - wrap.clientWidth;
      if (!(over > 2)) return;
      textEl.style.setProperty('--tl-shift', `${-over}px`);
      // The pauses at the ends (15 % each) come on top of the move.
      textEl.style.setProperty('--tl-scroll-s', `${Math.max(4, (over / SCROLL_SPEED) / 0.7).toFixed(1)}s`);
      wrap.classList.add('scrolling');
    }

    let lastHeight = 0;
    function reportHeight() {
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) {
        lastHeight = h;
        if (opts.onHeight) opts.onHeight(h);
      }
    }

    if (typeof ResizeObserver === 'function') {
      let width = 0;
      new ResizeObserver(() => {
        const w = Math.round(root.getBoundingClientRect().width);
        if (w === width) return;
        width = w;
        layout();
      }).observe(root);
    }
    // The handwriting's metrics only count once the font is in.
    if (postit && document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout());

    render();
    return { setState, setError, render };
  }

  window.createTextLineWidget = createTextLineWidget;
  window.textLineBoardKey = boardKey;
  window.textLineContent = textLineContent;
  window.textLineTilt = noteTilt;
  window.TEXTLINE_ICON_PATHS = ICONS;
})();
