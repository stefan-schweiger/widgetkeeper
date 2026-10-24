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
   * An empty row: nothing shows, but the widget has a real height (the iOS app kept its loading placeholder over a 0
   * or 1 px widget, 2026-10-23). It showed a bell and the screen name until the user wanted it blank (2026-10-24).
   */
  function drawBlank(root) {
    const row = document.createElement('div');
    row.className = 'pu-blank';
    row.setAttribute('aria-hidden', 'true');
    root.replaceChildren(row);
  }

  const localStore = {
    getItem(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  /**
   * `opts`: `name` (the screen name), `page` (the prompt page's address, without the hash), `countdown` (the page
   * shows a message's bar running down: off by default, as the in-app browser doesn't close by itself), `open(url)`, and for tests
   * `now()` and `storage`. Returns `setState({popups, now})` for `/state` and `show(popup)` for `popups:show`.
   * @param {HTMLElement} root
   * @param {any} opts
   */
  window.createPopupsWidget = function (root, opts) {
    const key = popupsScreenKey(opts.name);
    drawBlank(root);
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

    /** Whether a popup is meant for this screen, still open and not opened on this device before. */
    function wanted(p, skew) {
      if (!p || typeof p.id !== 'string') return false;
      if (p.target !== 'all' && p.target !== `name:${key}`) return false;
      if (typeof p.until === 'number' && p.until - skew <= now()) return false;
      return !opened().includes(p.id);
    }

    /** Opens a wanted popup that came with its token (only `/state` sends it). */
    function offer(p, skew) {
      if (!wanted(p, skew) || typeof p.token !== 'string') return;
      storage.setItem(OPENED_KEY, JSON.stringify(opened().concat(p.id).slice(-MAX_OPENED)));
      opts.open(`${opts.page}#id=${encodeURIComponent(p.id)}&t=${encodeURIComponent(p.token)}${opts.countdown ? '&countdown=1' : ''}`);
    }

    const skewOf = p => (p && typeof p.now === 'number' ? p.now - now() : 0);

    return {
      key,
      /** `/state`'s answer: Homey's clock (`now`) gives the skew between it and this device's. */
      setState(state) {
        const skew = state && typeof state.now === 'number' ? state.now - now() : 0;
        for (const p of (state && Array.isArray(state.popups) ? state.popups : [])) offer(p, skew);
      },
      show(p) {
        offer(p, skewOf(p));
      },
      /**
       * Whether a `popups:show` is one to open here. It carries no token (anyone who may listen to the app's realtime
       * would get it), so the mount then asks `/state`, which has it.
       */
      wants(p) {
        return wanted(p, skewOf(p));
      },
    };
  };
})();
