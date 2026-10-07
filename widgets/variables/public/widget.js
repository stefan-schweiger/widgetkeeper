/*
 * Flow Variables: Homey's Logic variables as compact rows, 1 or 2 per line, each with the full name and
 * a control: a switch for a yes/no variable, − value + for a number, the text for a string. A tap on the
 * value of a number or string opens an input for it.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const OPTIMISTIC_MS = 10e3; // how long a changed value shows while waiting for Homey's update
  const STEP_DELAY = 700; // ms after the last −/+ tap before the value is sent, so +++ sends once
  const TAP_SLOP = 10; // px a finger may move and still count as a tap

  const DEFAULT_STRINGS = {
    selectSlots: 'Pick variables in the widget settings.',
    error: 'Could not load the variables.',
    failed: 'Could not change __name__.',
    missing: 'Variable not found',
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

  /** Digits after the decimal point (at most 6). */
  function decimalsOf(n) {
    const s = String(n);
    const e = s.match(/e-(\d+)$/);
    if (e) return Math.min(6, Number(e[1]));
    return Math.min(6, (s.split('.')[1] || '').length);
  }

  /** `value + dir × step`, without floating-point noise (0.1 + 0.2). */
  function stepValue(value, step, dir) {
    const base = typeof value === 'number' && isFinite(value) ? value : 0;
    const d = Math.max(decimalsOf(step), decimalsOf(base));
    return Number((base + dir * step).toFixed(d));
  }

  /** A number typed by the user (a decimal comma too), or null. */
  function parseNumber(text) {
    const s = String(text).trim().replace(/\s/g, '').replace(',', '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }

  function formatNumber(n) {
    return typeof n === 'number' && isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '–';
  }

  /**
   * A tap: a touch that ends within TAP_SLOP of where it started (a drag is left to the dashboard, so it
   * still scrolls), or a click from a mouse or keyboard. Quick Actions' logic.
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
      e.stopPropagation(); // a −/+ tap isn't also a tap on its row
      lastTouchTap = Date.now();
      fn(e);
    });
    node.addEventListener('touchcancel', unpress);
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() - lastTouchTap < 800) return;
      fn(e);
    });
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, columns?: number|string, step?: number|string,
   *   onSet?: (id: string, value: boolean|number|string) => Promise<any>,
   *   onHeight?: (h: number) => void }} opts
   */
  function createVariablesWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`variables.${key}`, tokens) : null;
      if (s && s !== `variables.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const step = Number(opts.step) > 0 ? Number(opts.step) : 1;

    let vars = []; // [{ id, name, type, value } | { id, missing }], one per slot
    const optimistic = new Map(); // variable id → { value, until }
    const stepTimers = new Map(); // variable id → timer of a pending −/+ send
    /** @type {{index: number, id: string, input: HTMLInputElement, cancelled: boolean} | null} */
    let editing = null;
    let messageText = null;
    let messageTimer = null;

    root.classList.add('vr');
    root.dataset.columns = String(opts.columns) === '2' ? '2' : '1';
    const grid = el('div', { class: 'vr-grid' }, root);
    const messageEl = el('div', { class: 'vr-message', dir: 'auto' }, root);
    /** @type {{row: HTMLElement, name: HTMLElement, control: HTMLElement, kind: string|null, value?: HTMLElement}[]} */
    const rows = [];

    function setState(list) {
      vars = Array.isArray(list) ? list : [];
      messageText = null;
      render();
    }

    /** A realtime update: `{id, name, type, value}` or `{id, missing}`. */
    function pushChange(data) {
      if (!data || typeof data.id !== 'string') return;
      let hit = false;
      vars = vars.map(v => {
        if (v.id !== data.id) return v;
        hit = true;
        return data.missing ? { id: v.id, missing: true } : { ...v, ...data };
      });
      if (!hit) return;
      const o = optimistic.get(data.id);
      if (o && o.value === data.value && !stepTimers.has(data.id)) optimistic.delete(data.id);
      render();
    }

    /** A message under the rows. Persistent messages also clear the rows. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else vars = [];
      render();
    }

    function shownValue(v) {
      const o = optimistic.get(v.id);
      if (o && Date.now() < o.until) return o.value;
      optimistic.delete(v.id);
      return v.value;
    }

    function shake(id) {
      vars.forEach((v, i) => {
        if (v.id !== id || !rows[i]) return;
        const row = rows[i].row;
        row.classList.remove('shake');
        void row.offsetWidth; // restart the animation
        row.classList.add('shake');
      });
    }

    async function send(v, value) {
      if (!opts.onSet) return;
      try {
        await opts.onSet(v.id, value);
      } catch (err) {
        console.error(err);
        optimistic.delete(v.id);
        shake(v.id);
        setMessage(t('failed', { name: v.name }), true);
      }
    }

    /** Shows a value at once and keeps it for OPTIMISTIC_MS (plus `extra`) unless Homey reports it first. */
    function setOptimistic(id, value, extra = 0) {
      optimistic.set(id, { value, until: Date.now() + OPTIMISTIC_MS + extra });
      setTimeout(render, OPTIMISTIC_MS + extra + 50);
    }

    function toggle(index) {
      const v = vars[index];
      if (!v || v.missing || v.type !== 'boolean') return;
      const value = !shownValue(v);
      setOptimistic(v.id, value);
      render();
      send(v, value);
    }

    function stepBy(index, dir) {
      const v = vars[index];
      if (!v || v.missing || v.type !== 'number') return;
      const value = stepValue(shownValue(v), step, dir);
      setOptimistic(v.id, value, STEP_DELAY);
      render();
      clearTimeout(stepTimers.get(v.id));
      stepTimers.set(v.id, setTimeout(() => {
        stepTimers.delete(v.id);
        send(v, value);
      }, STEP_DELAY));
    }

    /** Swaps the value for an input: Enter or leaving it sends, Escape cancels. */
    function edit(index) {
      const v = vars[index];
      const r = rows[index];
      if (!v || v.missing || (v.type !== 'number' && v.type !== 'string') || !r || editing) return;
      const current = shownValue(v);
      const input = el('input', {
        class: 'vr-input', type: 'text', dir: 'auto', enterkeyhint: 'done',
        inputmode: v.type === 'number' ? 'decimal' : 'text',
        'aria-label': v.name,
      });
      input.value = v.type === 'number' ? (typeof current === 'number' ? String(current) : '') : String(current ?? '');
      editing = { index, id: v.id, input, cancelled: false };
      r.control.replaceChildren(input);
      r.row.classList.add('editing');
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); if (editing) editing.cancelled = true; input.blur(); }
      });
      input.addEventListener('blur', () => finishEdit());
      // A touch inside the input mustn't count as a row tap.
      for (const ev of ['touchend', 'click']) input.addEventListener(ev, e => e.stopPropagation());
      input.focus();
      input.select();
      render();
    }

    function finishEdit() {
      if (!editing) return;
      const { index, id, input, cancelled } = editing;
      editing = null;
      const r = rows[index];
      if (r) { r.row.classList.remove('editing'); r.kind = null; } // rebuilt by render()
      const v = vars[index];
      if (!cancelled && v && v.id === id && !v.missing) {
        if (v.type === 'number') {
          const n = parseNumber(input.value);
          if (n == null) { if (input.value.trim() !== '') shake(id); }
          else if (n !== shownValue(v)) { setOptimistic(id, n); send(v, n); }
        } else if (input.value !== shownValue(v)) {
          setOptimistic(id, input.value);
          send(v, input.value);
        }
      }
      render();
    }

    function rowAt(index) {
      if (rows[index]) return rows[index];
      const row = el('div', { class: 'vr-row' });
      const r = { row, name: el('span', { class: 'vr-name', dir: 'auto' }, row), control: el('span', { class: 'vr-control' }, row), kind: null };
      // A tap on the row: toggles a yes/no variable, opens the input for a number or text.
      onTap(row, () => {
        const v = vars[index];
        if (!v || v.missing) return;
        if (v.type === 'boolean') toggle(index);
        else edit(index);
      });
      rows[index] = r;
      return r;
    }

    /** The control's elements for the variable's type, rebuilt only when the type changes. */
    function buildControl(r, index, kind) {
      r.kind = kind;
      r.control.replaceChildren();
      r.value = undefined;
      r.row.dataset.type = kind;
      if (kind === 'boolean') {
        r.value = el('span', { class: 'vr-switch', role: 'switch' }, r.control);
        el('span', { class: 'vr-knob' }, r.value);
      } else if (kind === 'number') {
        const minus = el('button', { type: 'button', class: 'vr-step', 'data-dir': '-1', 'aria-label': '−', text: '−' }, r.control);
        r.value = el('span', { class: 'vr-value' }, r.control);
        const plus = el('button', { type: 'button', class: 'vr-step', 'data-dir': '1', 'aria-label': '+', text: '+' }, r.control);
        onTap(minus, () => stepBy(index, -1));
        onTap(plus, () => stepBy(index, 1));
      } else {
        r.value = el('span', { class: 'vr-value', dir: 'auto' }, r.control);
      }
    }

    let lastHeight = 0;
    function render() {
      for (let i = rows.length - 1; i >= vars.length; i--) { rows[i].row.remove(); rows.pop(); }
      vars.forEach((v, i) => {
        const r = rowAt(i);
        grid.appendChild(r.row); // keeps the order; a no-op when already in place
        if (editing && editing.index === i) {
          r.name.textContent = v.missing ? t('missing') : v.name;
          return; // the input stays as typed
        }
        const kind = v.missing ? 'missing' : v.type;
        if (r.kind !== kind) buildControl(r, i, kind);
        r.row.classList.toggle('missing', !!v.missing);
        r.name.textContent = v.missing ? t('missing') : v.name;
        r.row.title = v.missing ? '' : v.name;
        if (v.missing) return;
        const value = shownValue(v);
        if (kind === 'boolean') {
          r.row.classList.toggle('active', value === true);
          r.value.setAttribute('aria-checked', String(value === true));
          r.value.setAttribute('aria-label', v.name);
        } else {
          r.row.classList.remove('active');
          r.value.textContent = kind === 'number' ? formatNumber(value) : String(value ?? '');
        }
      });
      grid.style.display = vars.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && vars.length > 0);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    return { setState, pushChange, setMessage, render, t };
  }

  window.createVariablesWidget = createVariablesWidget;
  window.variableStepValue = stepValue;
  window.parseVariableNumber = parseNumber;
})();
