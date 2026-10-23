/*
 * The Popups widget (wk-084): invisible on a Homey dashboard, it opens the popups that Flows send to its screen name
 * (or everywhere) in the phone app's in-app browser, through `opts.open(url)` (`Homey.popup()`): the prompt page
 * `settings/popup.html#id=&t=`, which needs no login (the popup's token lets it in). A widget can't draw over the
 * dashboard itself (CLAUDE.md, Homey API facts). Each popup opens once per device, however many Popups widgets the
 * open dashboards have and however often the frame reloads (the ids are kept in `localStorage`).
 */
(function () {
  const DEFAULT_SCREEN = 'Screen';
  const MAX_NAME = 60;
  const OPENED_KEY = 'widgetkeeper.popups.opened';
  const MAX_OPENED = 50;

  /** A screen name's key, as `screenKey()` in lib/PopupService.ts: trimmed and lower-cased, `Screen` when empty. */
  function popupsScreenKey(name) {
    const n = typeof name === 'string' ? name.trim() : '';
    return (n || DEFAULT_SCREEN).toLowerCase().slice(0, MAX_NAME);
  }
  window.popupsScreenKey = popupsScreenKey;

  /**
   * A quiet row, a bell and the screen name, so the widget has a real height (the iOS app kept its loading
   * placeholder over a 0 or 1 px widget, 2026-10-23) and can be found on the dashboard. The name needs no translation.
   */
  function drawLabel(root, name) {
    const NS = 'http://www.w3.org/2000/svg';
    const row = document.createElement('div');
    row.className = 'pu-label';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'pu-icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', window.WidgetkeeperKit.icons.bell.d);
    svg.appendChild(path);
    const text = document.createElement('span');
    text.className = 'pu-name';
    text.dir = 'auto';
    text.textContent = name;
    row.append(svg, text);
    root.replaceChildren(row);
  }

  const localStore = {
    getItem(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  /**
   * `opts`: `name` (the screen name), `page` (the prompt page's address, without the hash), `open(url)`, and for tests
   * `now()` and `storage`. Returns `setState({popups, now})` for `/state` and `show(popup)` for `popups:show`.
   * @param {HTMLElement} root
   * @param {any} opts
   */
  window.createPopupsWidget = function (root, opts) {
    const key = popupsScreenKey(opts.name);
    drawLabel(root, typeof opts.name === 'string' && opts.name.trim() ? opts.name.trim() : DEFAULT_SCREEN);
    const now = opts.now || (() => Date.now());
    const storage = opts.storage || localStore;

    function opened() {
      try {
        const list = JSON.parse(storage.getItem(OPENED_KEY) || '[]');
        return Array.isArray(list) ? list : [];
      } catch (e) {
        return [];
      }
    }

    /** Opens a popup meant for this screen that's still open and wasn't opened on this device before. */
    function offer(p, skew) {
      if (!p || typeof p.id !== 'string' || typeof p.token !== 'string') return;
      if (p.target !== 'all' && p.target !== `name:${key}`) return;
      if (typeof p.until === 'number' && p.until - skew <= now()) return;
      const seen = opened();
      if (seen.includes(p.id)) return;
      storage.setItem(OPENED_KEY, JSON.stringify(seen.concat(p.id).slice(-MAX_OPENED)));
      opts.open(`${opts.page}#id=${encodeURIComponent(p.id)}&t=${encodeURIComponent(p.token)}`);
    }

    return {
      key,
      /** `/state`'s answer: Homey's clock (`now`) gives the skew between it and this device's. */
      setState(state) {
        const skew = state && typeof state.now === 'number' ? state.now - now() : 0;
        for (const p of (state && Array.isArray(state.popups) ? state.popups : [])) offer(p, skew);
      },
      show(p) {
        offer(p, p && typeof p.now === 'number' ? p.now - now() : 0);
      },
    };
  };
})();
