/*
 * Keypad: up to three buttons behind an optional code, each starting a Flow or setting the state the widget shows (a
 * Logic variable or a device value). The state is on the left, the buttons are stacked on the right, and the code pad
 * takes the right half (compact: the whole widget). The app checks the code: the widget only knows its length, and
 * sends what was typed with the code's id. Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const DEFAULT_STRINGS = {
    title: 'Keypad',
    selectButtons: 'Pick the buttons in the widget settings.',
    missing: 'Not found',
    error: 'Could not load the state.',
    failed: 'Could not run __name__.',
    notSetable: 'This can’t be set from here: give the button a Flow.',
    flowMissing: 'Flow not found',
    flowDisabled: '__name__ is turned off.',
    flowNotTriggerable: "__name__ can't be started by hand.",
    wrongCode: 'Wrong code',
    triesLeft: 'Wrong code. Tries left: __n__',
    lockedOut: 'Too many tries. Try again in __s__ s.',
    codeReset: 'Set the code again in the widget settings.',
    needsCode: 'Needs the code',
    close: 'Close',
    delete: 'Delete',
    yes: 'Yes',
    no: 'No',
    on: 'On',
    off: 'Off',
    locked: 'Locked',
    unlocked: 'Unlocked',
    open: 'Open',
    closed: 'Closed',
    noKey: 'To use this button, add an API key in the app settings.',
    keyScope: 'The API key may not do this: it needs Start Flows, or Variables for a variable.',
    keyInvalid: 'The API key was not accepted.',
  };

  const { el, onTap, touchGuard, messageLine, applyColors, formatValue, KEY_PROBLEMS } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  const ICONS = window.WidgetkeeperKit.icons;
  const SVG = 'http://www.w3.org/2000/svg';

  /** The `colorN` settings: kit.css's palette, and grey, which keeps the key's own colours. */
  const COLORS = [...window.WidgetkeeperKit.COLORS, 'grey'];
  /** A value's types; `typeof` a value of each is the type's name. */
  const TYPES = ['boolean', 'number', 'string'];

  /** The widget's own marks, 24 px paths drawn with a round stroke. */
  const MARKS = {
    check: 'M5 12.5l4.5 4.5L19 7.5',
    code: 'M6 6.5h.01M12 6.5h.01M18 6.5h.01M6 12h.01M12 12h.01M18 12h.01M12 17.5h.01', // a keypad's dots
    close: 'M6 6l12 12M18 6L6 18',
    back: 'M9 6h10.5A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-6-6 6-6zM12 9.5l5 5M17 9.5l-5 5',
  };

  /**
   * The words a yes/no capability's values are shown with, where On/Off would read wrong (`BOOLEAN_WORDS` in
   * lib/KeypadService.ts, which names the settings' values alike; test/keypad-widget.test.ts checks they match).
   */
  const BOOLEAN_WORDS = {
    locked: ['locked', 'unlocked'],
    garagedoor_closed: ['closed', 'open'],
    windowcoverings_closed: ['closed', 'open'],
    alarm_contact: ['open', 'closed'],
  };

  /** The buttons a capability gets without any set up: an icon and a colour for the values we know. */
  const KNOWN = {
    homealarm_state: { armed: ['shield', 'red'], partially_armed: ['home', 'orange'], disarmed: ['unlock', 'green'] },
    locked: { true: ['lock', 'green'], false: ['unlock', 'red'] },
  };
  const MAX_AUTO = 4;

  const DONE_MS = 1500; // the tick after a button worked
  const MIN_BUSY_MS = 400; // the spinner, at least: a quick answer still shows something happened
  const OPTIMISTIC_MS = 10e3; // a set value shows until the state reports it, or this long
  const WRONG_MS = 700; // the red dots after a wrong code, then they empty
  const IDLE_CLOSE_MS = 30e3; // the pad closes when left alone

  /** An icon (the kit's `{d, fill}` or a mark's path) as an inline SVG in `currentColor`. */
  function glyph(icon, cls) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', icon.fill ? `${cls} filled` : cls);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', icon.d);
    svg.appendChild(path);
    return svg;
  }

  /** The state has a button's value: numbers within floating-point noise, the rest exactly. */
  function sameValue(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    return a === b;
  }

  /**
   * The widget's settings: the state's id (`var:<id>` or `cap:<deviceId>:<capabilityId>`), the code (`{id, digits}`,
   * never the digits themselves), and the buttons with a Flow or a value, in order.
   */
  function keypadSettings(settings) {
    const s = settings || {};
    const sourceId = s.state && typeof s.state.id === 'string' && /^(var|cap):./.test(s.state.id) ? s.state.id : null;
    const c = s.code;
    const code = c && typeof c.id === 'string' && /^code:/.test(c.id) && Number.isInteger(c.digits) && c.digits >= 3 && c.digits <= 6
      ? { id: c.id, digits: c.digits } : null;
    const buttons = [];
    for (const n of [1, 2, 3]) {
      const f = s[`flow${n}`];
      const flow = f && typeof f.id === 'string' && /^(flow|advanced):./.test(f.id) ? f.id : null;
      const v = s[`value${n}`];
      const value = v && typeof v === 'object' && v.id !== 'none' && TYPES.includes(v.type) && typeof v.value === v.type
        && (v.type !== 'number' || isFinite(v.value)) ? { value: v.value, type: v.type, name: typeof v.name === 'string' ? v.name : '' } : null;
      if (!flow && !value) continue;
      const label = s[`label${n}`];
      const icon = s[`icon${n}`] && typeof s[`icon${n}`].id === 'string' && Object.prototype.hasOwnProperty.call(ICONS, s[`icon${n}`].id) ? s[`icon${n}`].id : null;
      buttons.push({
        n,
        flow,
        flowName: flow && typeof f.name === 'string' ? f.name : '',
        value,
        label: typeof label === 'string' ? label.trim() : '',
        icon,
        color: COLORS.includes(s[`color${n}`]) ? s[`color${n}`] : 'blue',
        needsCode: s[`code${n}`] !== false,
      });
    }
    return { sourceId, code, buttons };
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string, layout?: string, colorStyle?: string,
   *   title?: string, sourceId?: string | null, code?: { id: string, digits: number } | null, buttons?: any[],
   *   onPress?: (body: object) => Promise<any>, onHaptic?: () => void, onHeight?: () => void }} opts
   */
  function createKeypadWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`keypad.${key}`, tokens) : null;
      if (s && s !== `keypad.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const numberFmt = new Intl.NumberFormat(opts.locale, { maximumFractionDigits: 3 });
    const title = typeof opts.title === 'string' ? opts.title.trim() : '';
    const sourceId = opts.sourceId || null;
    const code = opts.code || null;
    const own = Array.isArray(opts.buttons) ? opts.buttons : [];
    const compact = opts.layout === 'compact';
    const guard = touchGuard();
    const doc = root.ownerDocument;

    let source = null; // the state from /state: a variable or a capability, or `{missing: true}`
    let flows = new Map(); // the buttons' flows, by id
    let optimistic = null; // { value, until }: a value just set, until the state reports it
    const busy = new Map(); // button n → 'running' | 'done'
    let lasting = null; // a message in place of everything
    let pad = null; // { n, typed, checking, error, dead }
    let lockedUntil = 0; // the app's lock after too many wrong codes
    let idleTimer = null;
    let lockTimer = null;

    root.classList.add('kp');
    root.classList.toggle('kp-compact', compact);
    applyColors(root, { style: opts.colorStyle });

    const left = el('div', { class: 'kp-left' }, root);
    const stack = el('div', { class: 'kp-stack' }, root);
    const padNode = el('div', { class: 'kp-pad' }, root);
    const only = el('div', { class: 'kp-only', dir: 'auto' }, root);
    const message = messageLine(render);

    let stackKey = null;
    const nodes = new Map(); // button n → its node
    let padTop = null;
    let padSub = null;
    let padDots = null;
    let padKeys = null;

    /** The buttons: the ones set up, or else one per value of a list or yes/no state. */
    function buttons() {
      return own.length ? own : autoButtons();
    }

    function autoButtons() {
      if (!source || source.missing) return [];
      const known = source.kind === 'capability' ? KNOWN[source.capabilityId] || {} : {};
      const make = (value, type, name, i) => {
        const [icon, color] = known[String(value)] || [null, 'grey'];
        return { n: i + 1, flow: null, flowName: '', value: { value, type, name }, label: '', icon, color, needsCode: true, auto: true };
      };
      const cap = source.kind === 'capability' ? source.capability || {} : null;
      if (cap && cap.type === 'enum') return (cap.values || []).slice(0, MAX_AUTO).map((v, i) => make(v.id, 'string', v.title, i));
      if (cap ? cap.type === 'boolean' : source.type === 'boolean') return [true, false].map((v, i) => make(v, 'boolean', valueText(v), i));
      return [];
    }

    const needsCode = b => !!code && b.needsCode;

    /** What the state has now: a value just set until it's reported, else the state's; undefined when unknown. */
    function current() {
      if (optimistic && Date.now() < optimistic.until) return optimistic.value;
      return source && !source.missing ? source.value : undefined;
    }

    /** A state value as text: yes/no in the capability's words, a capability's value as the tiles show it. */
    function valueText(v) {
      if (v == null || v === '') return '–';
      if (typeof v === 'boolean') {
        const words = source && source.kind === 'capability' ? BOOLEAN_WORDS[source.capabilityId] || ['on', 'off'] : ['yes', 'no'];
        return t(v ? words[0] : words[1]);
      }
      if (source && source.kind === 'capability') return formatValue(source.capability || {}, v, t);
      if (typeof v === 'number') return numberFmt.format(v);
      return String(v);
    }

    function labelOf(b) {
      if (b.label) return b.label;
      const f = b.flow ? flows.get(b.flow) : null;
      if (b.flow) return (f && !f.missing && f.name) || b.flowName || '–';
      return b.value.name || valueText(b.value.value);
    }

    function render() {
      root.classList.toggle('kp-message-only', !!lasting);
      only.textContent = lasting || '';
      if (!lasting) {
        const list = buttons();
        const now = current();
        const lit = now === undefined ? null : list.find(b => b.value && sameValue(now, b.value.value)) || null;
        renderLeft(list, lit, now);
        renderStack(list, lit);
        renderPad();
      }
      root.classList.toggle('pad-open', !!pad && !lasting);
      if (opts.onHeight) opts.onHeight();
    }

    function renderLeft(list, lit, now) {
      if (lit && lit.color !== 'grey') left.dataset.wkColor = lit.color;
      else delete left.dataset.wkColor;
      const icon = lit ? lit.icon : (list.find(b => b.icon) || {}).icon;
      const parts = icon ? [glyph(ICONS[icon], 'kp-icon')] : [];
      let big;
      let sub;
      if (!sourceId) {
        big = title || t('title');
        sub = '';
      } else {
        big = source && !source.missing ? valueText(now) : '–';
        sub = source && source.missing ? t('missing') : title || (source && source.name) || '';
      }
      const text = message.text || '';
      const titles = el('div', { class: 'kp-titles' });
      el('span', { class: 'kp-state', dir: 'auto', text: big }, titles);
      el('span', { class: text || (source && source.missing) ? 'kp-sub error' : 'kp-sub', dir: 'auto', text: text || sub }, titles);
      parts.push(titles);
      left.replaceChildren(...parts);
    }

    function renderStack(list, lit) {
      const key = list.map(b => `${b.n}${b.auto ? 'a' : ''}`).join(',');
      if (key !== stackKey) {
        stackKey = key;
        nodes.clear();
        stack.replaceChildren();
        for (const b of list) {
          const node = el('div', { class: 'kp-btn', role: 'button', tabindex: '0' }, stack);
          onTap(node, () => press(b.n), { guard });
          nodes.set(b.n, node);
        }
      }
      for (const b of list) paint(nodes.get(b.n), b, b === lit);
    }

    function paint(node, b, on) {
      if (b.color !== 'grey') node.dataset.wkColor = b.color;
      else delete node.dataset.wkColor;
      const f = b.flow ? flows.get(b.flow) : null;
      const state = busy.get(b.n);
      const label = labelOf(b);
      node.classList.toggle('on', on);
      node.classList.toggle('missing', !!(f && f.missing));
      node.classList.toggle('unavailable', !!(f && !f.missing && (!f.enabled || !f.triggerable)));
      node.setAttribute('aria-label', needsCode(b) ? `${label} (${t('needsCode')})` : label);
      node.setAttribute('aria-pressed', on ? 'true' : 'false');
      const lead = state === 'running' ? el('span', { class: 'kp-spin' })
        : b.icon ? glyph(ICONS[b.icon], 'kp-glyph') : el('span', { class: 'kp-glyph kp-initial', text: label.charAt(0) });
      const end = el('span', { class: 'kp-end' });
      if (state === 'done' || (on && !state)) end.appendChild(glyph({ d: MARKS.check }, 'kp-mark'));
      else if (needsCode(b) && !state) end.appendChild(glyph({ d: MARKS.code }, 'kp-mark code'));
      node.replaceChildren(lead, el('span', { class: 'kp-label', dir: 'auto', text: label }), end);
    }

    function shake(node) {
      if (!node) return;
      node.classList.remove('shake');
      void node.offsetWidth; // restart the animation
      node.classList.add('shake');
      setTimeout(() => node.classList.remove('shake'), 400);
    }

    function refuse(b, text) {
      message.set(text, true);
      shake(nodes.get(b.n));
    }

    function press(n) {
      const b = buttons().find(x => x.n === n);
      if (!b || pad || busy.get(n) === 'running') return;
      const f = b.flow ? flows.get(b.flow) : null;
      if (f && f.missing) return refuse(b, t('flowMissing'));
      if (f && !f.enabled) return refuse(b, t('flowDisabled', { name: labelOf(b) }));
      if (f && !f.triggerable) return refuse(b, t('flowNotTriggerable', { name: labelOf(b) }));
      if (opts.onHaptic) opts.onHaptic();
      if (needsCode(b)) openPad(b);
      else run(b);
    }

    /** The press's request: the Flow, or the state and the value to set it to; with the code when typed. */
    function body(b, typed) {
      const out = b.flow ? { flow: b.flow } : { source: sourceId, value: b.value.value };
      if (typed != null) Object.assign(out, { codeId: code.id, code: typed });
      return out;
    }

    async function send(b, typed) {
      try {
        return { res: opts.onPress ? await opts.onPress(body(b, typed)) : { ok: true, result: 'done' } };
      } catch (err) {
        console.error(err);
        return { res: null };
      }
    }

    /** A button without the code: the spinner (at least MIN_BUSY_MS), then the tick or why not. */
    async function run(b) {
      busy.set(b.n, 'running');
      render();
      const started = Date.now();
      const { res } = await send(b, null);
      const wait = MIN_BUSY_MS - (Date.now() - started);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      busy.delete(b.n);
      finish(b, res);
    }

    function finish(b, res) {
      if (res && res.ok !== false && res.result === 'done') {
        if (!b.flow) {
          optimistic = { value: b.value.value, until: Date.now() + OPTIMISTIC_MS };
          setTimeout(render, OPTIMISTIC_MS + 50);
        }
        busy.set(b.n, 'done');
        setTimeout(() => {
          if (busy.get(b.n) !== 'done') return;
          busy.delete(b.n);
          render();
        }, DONE_MS);
        render();
        return;
      }
      render();
      const text = res && res.ok === false && KEY_PROBLEMS.includes(res.reason) ? t(res.reason)
        : res && res.result === 'notSetable' ? t('notSetable') : t('failed', { name: labelOf(b) });
      refuse(b, text);
    }

    // ---------------------------------------------------------------- the pad

    function openPad(b) {
      buildPad(b);
      pad = { n: b.n, typed: '', checking: false, error: false, dead: false };
      armIdle();
      doc.addEventListener('keydown', onKey);
      message.set(null); // renders
      if (Date.now() < lockedUntil) tickLock();
    }

    function closePad() {
      if (!pad || pad.checking) return;
      pad = null;
      clearTimeout(idleTimer);
      doc.removeEventListener('keydown', onKey);
      message.set(null);
    }

    function armIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!pad || pad.checking) return armIdle();
        closePad();
        render();
      }, IDLE_CLOSE_MS);
    }

    function buildPad(b) {
      padNode.replaceChildren();
      padTop = el('div', { class: 'kp-pad-top' }, padNode);
      if (b.color !== 'grey') padTop.dataset.wkColor = b.color;
      if (b.icon) padTop.appendChild(glyph(ICONS[b.icon], 'kp-pad-glyph'));
      el('span', { class: 'kp-pad-label', dir: 'auto', text: labelOf(b) }, padTop);
      padSub = el('span', { class: 'kp-pad-sub', dir: 'auto' }, padTop);
      padDots = el('div', { class: 'kp-dots', 'aria-hidden': 'true' }, padTop);
      const close = el('button', { type: 'button', class: 'kp-close', 'aria-label': t('close') }, padTop);
      close.appendChild(glyph({ d: MARKS.close }, ''));
      onTap(close, () => {
        closePad();
        render();
      }, { keys: false, guard });
      padKeys = el('div', { class: 'kp-keys' }, padNode);
      const order = compact
        ? ['1', '2', '3', '4', '5', 'back', '6', '7', '8', '9', '0', '']
        : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
      for (const k of order) {
        if (!k) {
          el('span', { class: 'kp-key blank' }, padKeys);
          continue;
        }
        const key = el('button', { type: 'button', class: k === 'back' ? 'kp-key fn' : 'kp-key', 'aria-label': k === 'back' ? t('delete') : k }, padKeys);
        if (k === 'back') key.appendChild(glyph({ d: MARKS.back }, ''));
        else key.textContent = k;
        onTap(key, () => typeKey(k), { keys: false, guard });
      }
    }

    function renderPad() {
      if (!pad) return;
      const off = pad.checking || pad.dead || Date.now() < lockedUntil;
      for (const key of padKeys.querySelectorAll('button')) key.disabled = off;
      padDots.replaceChildren(...Array.from({ length: code.digits }, (_, i) => el('span', { class: i < pad.typed.length ? 'kp-dot f' : 'kp-dot' })));
      padDots.classList.toggle('err', pad.error);
      padDots.classList.toggle('checking', pad.checking);
      padSub.textContent = message.text || title || (source && !source.missing && source.name) || '';
      padSub.classList.toggle('error', !!message.text);
    }

    function onKey(e) {
      if (!pad) return;
      if (/^[0-9]$/.test(e.key)) typeKey(e.key);
      else if (e.key === 'Backspace') typeKey('back');
      else if (e.key === 'Escape') {
        closePad();
        render();
      } else return;
      e.preventDefault();
    }

    function typeKey(k) {
      if (!pad || pad.checking || pad.dead || Date.now() < lockedUntil) return;
      armIdle();
      if (opts.onHaptic) opts.onHaptic();
      if (pad.error) {
        pad.error = false;
        pad.typed = '';
      }
      if (k === 'back') pad.typed = pad.typed.slice(0, -1);
      else if (pad.typed.length < code.digits) pad.typed += k;
      render();
      if (pad.typed.length === code.digits) submit();
    }

    async function submit() {
      const b = buttons().find(x => x.n === pad.n);
      if (!b) {
        closePad();
        render();
        return;
      }
      pad.checking = true;
      render();
      const { res } = await send(b, pad.typed);
      pad.checking = false;
      if (res && res.ok !== false && refused(res)) return;
      closePad();
      finish(b, res);
    }

    /** A code the app turned down: the pad stays and says why. False for any other answer. */
    function refused(res) {
      if (res.result === 'wrongCode') {
        pad.error = true;
        message.set(res.left <= 2 ? t('triesLeft', { n: res.left }) : t('wrongCode'), true);
        setTimeout(() => {
          if (!pad || !pad.error) return;
          pad.error = false;
          pad.typed = '';
          render();
        }, WRONG_MS);
        return true;
      }
      if (res.result === 'locked') {
        lockedUntil = Date.now() + (Number(res.retryAfter) || 30) * 1000;
        pad.typed = '';
        tickLock();
        return true;
      }
      if (res.result === 'codeReset') {
        pad.dead = true;
        pad.typed = '';
        message.set(t('codeReset'), true);
        return true;
      }
      return false;
    }

    /** The lock's countdown, while the pad is open. */
    function tickLock() {
      clearTimeout(lockTimer);
      const leftMs = lockedUntil - Date.now();
      if (!pad) return;
      if (leftMs <= 0) {
        message.set(null);
        return;
      }
      message.set(t('lockedOut', { s: Math.ceil(leftMs / 1000) }), true);
      lockTimer = setTimeout(tickLock, Math.min(1000, leftMs));
    }

    // ---------------------------------------------------------------- state

    /** `/state`: `{source, flows}`. Flows that couldn't be read (`null`) keep the last ones. */
    function setState(state) {
      lasting = null;
      source = state && state.source ? state.source : null;
      if (state && Array.isArray(state.flows)) flows = new Map(state.flows.map(f => [f.id, f]));
      if (optimistic && source && !source.missing && sameValue(source.value, optimistic.value)) optimistic = null;
      if (!buttons().length) lasting = t('selectButtons');
      render();
    }

    /** A realtime change of the state's value. */
    function pushValue(value) {
      if (!source || source.missing) return;
      source = { ...source, value };
      if (optimistic && sameValue(value, optimistic.value)) optimistic = null;
      render();
    }

    /** A lasting message replaces everything (a failed first load); a transient one shows a while (a failed refresh). */
    function setMessage(text, transient) {
      if (transient) message.set(text, true);
      else {
        lasting = text;
        render();
      }
    }

    return { setState, pushValue, setMessage, render, t };
  }

  window.createKeypadWidget = createKeypadWidget;
  window.keypadSettings = keypadSettings;
  window.keypadBooleanWords = BOOLEAN_WORDS;
})();
