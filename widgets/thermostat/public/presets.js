/*
 * Preset buttons: a header (an icon, a name and a subtitle) over a segmented row of buttons, a button lit while the
 * state matches its preset. Shared by Thermostat Presets and Variable Presets, which loads it from ../thermostat/
 * (Homey serves each widget's folder separately). Each widget gives it hooks for what a preset shows, matches and
 * sets; the markup keeps the thermostat's `tw-` classes (presets.css). Plain browser JS (served as-is).
 */
(function () {
  'use strict';
  const { el } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first

  const OPTIMISTIC_MS = 10e3; // how long a tapped button stays lit while waiting for the state to follow
  const MESSAGE_MS = 8000; // how long a transient message stays

  /**
   * @param {HTMLElement} root
   * @param {{ text: (preset: any, state: any) => { big: string, mode?: string | null, kind?: string, extras?: string[] },
   *   matches: (preset: any, state: any) => boolean, usable?: (preset: any, state: any) => boolean,
   *   apply?: ((preset: any, state: any) => Promise<any>) | null, failed: (err: any) => string,
   *   current: (state: any, presets: any[]) => string, layout?: string, fallbackIcon?: boolean,
   *   onHeight?: (h: number) => void }} hooks `state` has the header's `name` and `icon` (a URL for the mask);
   *   the rest is the widget's own. A preset that isn't `usable` is a disabled button. Without an icon the box shows a
   *   rounded square, or nothing with `fallbackIcon: false`.
   */
  function createPresets(root, hooks) {
    const usable = (p, s) => !hooks.usable || hooks.usable(p, s);

    let presets = [];
    let state = null;
    let optimistic = null; // { index, until }
    let messageTimer = null;
    let errorText = null;

    root.classList.add('tw');
    // Compact: a one-line header and one-line buttons; the markup is the same, only the CSS differs.
    root.classList.toggle('tw-compact', hooks.layout === 'compact');
    const header = el('div', { class: 'tw-header' }, root);
    const iconBox = el('div', { class: 'tw-device-icon' }, header);
    const titles = el('div', { class: 'tw-titles' }, header);
    const nameEl = el('div', { class: 'tw-name', dir: 'auto' }, titles);
    const subEl = el('div', { class: 'tw-sub', dir: 'auto' }, titles);
    const row = el('div', { class: 'tw-row' }, root);
    let tiles = [];

    function setButtons(list) {
      presets = list;
      optimistic = null;
      while (row.firstChild) row.removeChild(row.firstChild);
      row.style.setProperty('--tw-count', String(Math.max(1, presets.length)));
      tiles = presets.map((p, i) => {
        const b = el('button', { type: 'button', class: 'tw-btn' }, row);
        b.addEventListener('click', () => press(i));
        return b;
      });
      render();
    }

    function setState(s) {
      state = s;
      errorText = null;
      render();
    }

    /** A message in place of the subtitle. Persistent messages also clear the state. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      errorText = text;
      if (transient) messageTimer = setTimeout(() => { errorText = null; render(); }, MESSAGE_MS);
      else state = null;
      render();
    }

    async function press(index) {
      const preset = presets[index];
      if (!state || !preset || !usable(preset, state) || !hooks.apply) return;
      optimistic = { index, until: Date.now() + OPTIMISTIC_MS };
      render();
      setTimeout(render, OPTIMISTIC_MS + 50);
      try {
        await hooks.apply(preset, state);
      } catch (err) {
        console.error(err);
        optimistic = null;
        if (tiles[index]) {
          tiles[index].classList.remove('shake');
          void tiles[index].offsetWidth; // restart the animation
          tiles[index].classList.add('shake');
        }
        setMessage(hooks.failed(err), true);
      }
    }

    function activeSet() {
      if (optimistic) {
        const p = presets[optimistic.index];
        if (Date.now() > optimistic.until || !p || (state && hooks.matches(p, state))) optimistic = null;
        else return new Set([optimistic.index]);
      }
      const on = new Set();
      if (state) presets.forEach((p, i) => { if (hooks.matches(p, state)) on.add(i); });
      return on;
    }

    let lastIcon;
    let lastHeight = 0;
    function render() {
      const active = activeSet();

      const icon = state && state.icon;
      if (icon !== lastIcon) {
        lastIcon = icon;
        iconBox.style.setProperty('--tw-icon', icon ? `url("${icon}")` : '');
        iconBox.classList.toggle('fallback', !icon);
      }
      iconBox.style.display = state && (icon || hooks.fallbackIcon !== false) ? '' : 'none';
      nameEl.textContent = state ? state.name : '';
      nameEl.style.display = state ? '' : 'none';
      const sub = errorText || (state && !active.size ? hooks.current(state, presets) : '');
      subEl.textContent = sub;
      subEl.style.display = sub ? '' : 'none';
      subEl.classList.toggle('error', !!errorText && !!state);
      header.classList.toggle('has-sub', !!sub && !errorText);
      header.classList.toggle('message-only', !state);

      row.style.display = state || !errorText ? '' : 'none';
      tiles.forEach((b, i) => {
        const text = hooks.text(presets[i], state);
        while (b.firstChild) b.removeChild(b.firstChild);
        el('span', { class: 'tw-big', text: text.big }, b);
        if (text.mode) el('span', { class: 'tw-modetext', text: text.mode }, b);
        for (const x of text.extras || []) el('span', { class: 'tw-extra', text: x }, b);
        b.dataset.kind = text.kind || 'other';
        b.classList.toggle('active', active.has(i));
        b.disabled = !state || !usable(presets[i], state);
      });

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (hooks.onHeight) hooks.onHeight(h); }
    }

    return { setButtons, setState, setMessage, render, getState: () => state, presets: () => presets };
  }

  window.WidgetkeeperPresets = { create: createPresets };
})();
