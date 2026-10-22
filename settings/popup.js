/*
 * The prompt page (popup.html, wk-084): a Flow's message or Yes/No question in the phone app's in-app browser, which a
 * Popups widget opened with `Homey.popup()`. It has no login: `#id=&t=` name the popup and its token, which the app's
 * public routes take in the body (`POST /api/app/<appId>/popup/:id`, `/image`, `/answer`). It polls every 2 s, so it
 * says when another screen answered first or the time ran out; the in-app browser is closed by the user.
 */
(function () {
  'use strict';

  /** English, also the fallback before the app's strings arrive (they're `popups.*` in locales/<lang>.json). */
  const DEFAULT_STRINGS = {
    everywhere: 'Everywhere',
    everywhereHint: 'Every web dashboard and Popups widget',
    webDashboard: 'Web dashboard',
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
    answeredYes: 'Answered: Yes',
    answeredNo: 'Answered: No',
    elsewhereYes: 'Answered on another screen: Yes',
    elsewhereNo: 'Answered on another screen: No',
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
    const appId = (location.pathname.match(/\/app\/([^/]+)\//) || [])[1] || 'com.thomassidor.widgetkeeper';
    let strings = {};
    const t = key => (typeof strings[key] === 'string' && strings[key]) || DEFAULT_STRINGS[key] || key;

    let card = null;
    let status = null;
    let answeredHere = null; // the answer this page sent, once Homey took it
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

    /** How a closed popup ended, in words. */
    function ending(data) {
      if (data.reason === 'answered' && data.answer != null) {
        if (answeredHere != null) return t(answeredHere ? 'answeredYes' : 'answeredNo');
        return t(data.answer ? 'elsewhereYes' : 'elsewhereNo');
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
              answeredHere = answer;
              finish(t(answer ? 'answeredYes' : 'answeredNo'));
            } else {
              finish(res && res.answer != null ? t(res.answer ? 'elsewhereYes' : 'elsewhereNo') : t('closed'));
            }
          } catch (err) {
            if (err.notFound) { finish(t('notFound')); return; }
            status.textContent = t('failed');
            for (const b of actions.querySelectorAll('button')) b.disabled = false;
          }
        };
        const no = el('button', 'pp-btn', t('no'));
        const yes = el('button', 'pp-btn primary', t('yes'));
        no.type = 'button';
        yes.type = 'button';
        no.addEventListener('click', () => send(false));
        yes.addEventListener('click', () => send(true));
        actions.append(no, yes);
        card.append(actions, status);
      } else {
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
        const data = await call('');
        useStrings(data);
        if (data.closed) { finish(ending(data)); return; }
        render(data);
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
