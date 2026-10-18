/*
 * Notes: a short text, typed in the widget's settings, written by a Flow card (a named note) or read from a Logic
 * text variable. As a tile (one line, cut off with … or scrolling) or as a Post-it note stuck on the dashboard, in
 * handwriting, wrapping up to three lines. Plain browser JS (served as-is).
 */
(function () {
  const { el, applyColors } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
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

  /** The tile's optional icon: Flow Buttons' (the kit's; the `icon` setting lists them, listIcons()). */
  const ICONS = window.WidgetkeeperKit.icons;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** A board's key: its name trimmed and lower-cased, none for a reserved name (boardKey() in lib/TextLineService.ts). */
  function boardKey(name) {
    const n = typeof name === 'string' ? name.trim() : '';
    const key = (n || DEFAULT_BOARD).toLowerCase().slice(0, 60);
    return key === '__proto__' || key === 'constructor' || key === 'prototype' ? '' : key;
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
   * @param {{ colorStyle?: string, style?: string, source?: string, align?: string, size?: string, overflow?: string, icon?: string | null,
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
    applyColors(root, { style: opts.colorStyle });
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
  window.textLineTilt = noteTilt;
})();
