/*
 * The prompt page (popup.html, wk-084): a Flow's message or question in the phone app's in-app browser, which a
 * Popups widget opened with `Homey.popup()`. It has no login: `#id=&t=` name the popup and its token, which the app's
 * public routes take in the body (`POST /api/app/<appId>/popup/:id`, `/image`, `/answer`); the first call also asks for
 * the strings (`strings: true`). `&countdown=1` (the widget's Countdown) shows a message's bar running down. It polls
 * every 2 s, so it says when another screen answered first or the time ran out; the in-app browser is closed by the user.
 */
(function () {
  'use strict';

  /** English, also the fallback before the app's strings arrive (they're `popups.*` in locales/<lang>.json). */
  const DEFAULT_STRINGS = {
    everywhere: 'Everywhere',
    everywhereHint: 'Every web dashboard and Popups widget',
    screenName: 'Popups widget',
    screenNew: 'New screen name',
    noPicture: 'No picture',
    pictureUrl: 'Picture from this address',
    dashboardMissing: 'Dashboard not found',
    empty: 'Nothing to show: no text or picture',
    pictureTooLarge: 'The picture is larger than 3 MB',
    pictureBadUrl: 'Not a picture address',
    pictureFailed: 'The picture could not be loaded',
    yes: 'Yes',
    no: 'No',
    answered: 'Answered: __button__',
    elsewhere: 'Answered on another screen: __button__',
    expired: 'Time is up',
    closed: 'Closed',
    closeWindow: 'You can close this window',
    notFound: 'This popup is gone',
    failed: 'Could not reach Homey',
    title: 'Popup',
  };
  window.POPUP_PAGE_STRINGS = DEFAULT_STRINGS;

  const POLL_MS = 2000;
  const CAMERA_MS = 3000;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** `opts.fetch` and `opts.hash` are for tests. */
  window.mountPopupPage = function (root, opts = {}) {
    const fetchFn = opts.fetch || window.fetch.bind(window);
    const params = new URLSearchParams(String(opts.hash != null ? opts.hash : location.hash).replace(/^#/, ''));
    const id = params.get('id') || '';
    const token = params.get('t') || '';
    // A message's bar running down to its end, only when the Popups widget's Countdown is on: this window doesn't
    // close by itself when the time is up.
    const countdown = params.get('countdown') === '1';
    const appId = (location.pathname.match(/\/app\/([^/]+)\//) || [])[1] || 'com.thomassidor.widgetkeeper';
    let strings = {};
    function t(key, tokens) {
      let s = (typeof strings[key] === 'string' && strings[key]) || DEFAULT_STRINGS[key] || key;
      for (const k in tokens || {}) s = s.split(`__${k}__`).join(String(tokens[k]));
      return s;
    }

    let card = null;
    let status = null;
    let answeredHere = false; // whether Homey took this page's answer
    let finished = false;
    const timers = [];

    async function call(path, body) {
      const res = await fetchFn(`/api/app/${appId}/popup/${encodeURIComponent(id)}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ t: token }, body || {})),
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (!res.ok) {
        const message = (data && (data.error || data.message)) || (typeof data === 'string' && data) || `HTTP ${res.status}`;
        throw Object.assign(new Error(message), { notFound: res.status === 404 || /not found/i.test(message) });
      }
      return data;
    }

    function useStrings(data) {
      if (data && data.strings && typeof data.strings === 'object') strings = data.strings;
      if (data && data.language) document.documentElement.lang = data.language;
      document.title = t('title');
    }

    /** How a closed popup ended, in words: the button pressed (here or on another screen), or why it closed. */
    function ending(data) {
      if (data.reason === 'answered' && data.button != null) {
        return t(answeredHere ? 'answered' : 'elsewhere', { button: data.button });
      }
      if (data.reason === 'expired' && data.kind === 'ask') return t('expired');
      return t('closed');
    }

    /** The popup is over: its result, and that the window may close (it tries to close itself too). */
    function finish(text) {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      if (!card) {
        card = el('section', 'pp-card');
        root.append(card);
      }
      for (const b of card.querySelectorAll('button')) b.disabled = true;
      const bar = card.querySelector('.pp-bar');
      if (bar) bar.remove();
      if (status) status.remove();
      card.append(el('p', 'pp-result', text), el('p', 'pp-status', t('closeWindow')));
      setTimeout(() => { try { window.close(); } catch (e) { /* the in-app browser decides */ } }, 1500);
    }

    function render(p) {
      card = el('section', 'pp-card');
      if (p.picture) {
        const frame = el('div', 'pp-picture loading');
        const img = el('img');
        img.alt = '';
        frame.append(img);
        card.append(frame);
        const load = async () => {
          if (finished) return;
          if (!document.hidden) {
            try {
              const res = await call('/image');
              if (finished) return;
              img.src = `data:${res.type};base64,${res.data}`;
              frame.classList.remove('loading', 'failed');
            } catch (err) {
              if (finished) return;
              if (frame.classList.contains('loading')) {
                frame.classList.replace('loading', 'failed');
                frame.append(el('p', 'pp-status', t('pictureFailed')));
              }
            }
          }
          if (p.picture.source === 'camera') timers.push(setTimeout(load, CAMERA_MS));
        };
        load();
      }
      if (p.text) {
        const text = el('p', 'pp-text', p.text);
        text.dir = 'auto';
        card.append(text);
      }
      status = el('p', 'pp-status');
      status.setAttribute('role', 'status');
      if (p.kind === 'ask') {
        const actions = el('div', 'pp-actions');
        const send = async (answer) => {
          for (const b of actions.querySelectorAll('button')) b.disabled = true;
          status.textContent = '';
          try {
            const res = await call('/answer', { answer });
            if (res && res.ok) {
              answeredHere = true;
              finish(t('answered', { button: res.button }));
            } else {
              finish(res && res.button != null ? t('elsewhere', { button: res.button }) : t('closed'));
            }
          } catch (err) {
            if (err.notFound) { finish(t('notFound')); return; }
            status.textContent = t('failed');
            for (const b of actions.querySelectorAll('button')) b.disabled = false;
          }
        };
        // The Flow's buttons in its order, the first highlighted (it answers yes); Yes and No unless it named others.
        const buttons = Array.isArray(p.buttons) && p.buttons.length ? p.buttons : [t('yes'), t('no')];
        buttons.forEach((label, i) => {
          const b = el('button', i === 0 ? 'pp-btn primary' : 'pp-btn', label);
          b.type = 'button';
          b.dir = 'auto';
          b.addEventListener('click', () => send(i === 0));
          actions.append(b);
        });
        card.append(actions, status);
      } else if (countdown) {
        const bar = el('div', 'pp-bar');
        const fill = el('span');
        bar.append(fill);
        card.append(bar, status);
        const left = Math.max(0, p.until - p.now);
        fill.style.transform = 'scaleX(1)';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          fill.style.transition = `transform ${left}ms linear`;
          fill.style.transform = 'scaleX(0)';
        }));
      } else {
        card.append(status);
      }
      root.append(card);
    }

    /** Asks how the popup stands: still open, or how it ended. A passing failure only says so and tries again. */
    async function poll() {
      if (finished) return;
      try {
        const data = await call('');
        useStrings(data);
        if (data.closed) { finish(ending(data)); return; }
        if (status && status.textContent === t('failed')) status.textContent = '';
      } catch (err) {
        if (err.notFound) { finish(t('notFound')); return; }
        if (status) status.textContent = t('failed');
      }
      timers.push(setTimeout(poll, POLL_MS));
    }

    async function start() {
      if (!id || !token) { finish(t('notFound')); return; }
      try {
        // The strings once; the polls only ask how it stands.
        const data = await call('', { strings: true });
        useStrings(data);
        if (data.closed) { finish(ending(data)); return; }
        render(data);
        // The in-app browser opens this page without a tap, so it may refuse the sound.
        if (data.sound && window.WidgetkeeperKit) window.WidgetkeeperKit.sound.play(data.sound);
      } catch (err) {
        if (err.notFound) { finish(t('notFound')); return; }
        status = el('p', 'pp-status', t('failed'));
        card = el('section', 'pp-card');
        card.append(status);
        root.append(card);
        timers.push(setTimeout(() => { card.remove(); card = null; status = null; start(); }, POLL_MS));
        return;
      }
      timers.push(setTimeout(poll, POLL_MS));
    }

    start();
  };
})();
