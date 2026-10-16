/*
 * Wires createStackWidget to Homey: reads the dashboard's pages, loads each page's widget files (from its own folder
 * next to this one, `../<widget>/`), and mounts each widget into its slide with a Homey of the stack's making. A
 * page's requests go through the stack's `/call`, to that widget's own API, so the app answers as if the page
 * were the widget itself (`getWidgetInstanceId()` is the dashboard widget's id: a Timers page shares its timer).
 * `frame` is the element whose height Homey gets.
 */
window.mountStackWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // re-reads the pages (a widget added to the dashboard) and the smart-rotate state
  const OTHERS_AFTER_MS = 2000; // the pages not on screen are mounted once it has drawn, or this long after
  const ATTENTION_AFTER_MS = 3000; // the first smart-rotate read, after the pages' own requests
  const SEEN_FRESH_MS = 60e3; // a page whose own state came this recently isn't read again for smart rotate

  // Load marks for the app's diagnostics log, sent with the first request only.
  let perf = '';
  function loadMarks(sdkAt) {
    const nav = /** @type {PerformanceNavigationTiming | null} */ (performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null);
    return [Math.round(performance.timeOrigin), nav ? Math.round(nav.responseEnd) : -1,
      Math.round(sdkAt), Math.round(performance.now())].join(',');
  }

  const sdkAt = performance.now();
  const settings = Homey.getSettings() || {};
  // `none`: the autocomplete's item that says an API key is needed (StackService.listDashboards()).
  const dashboardId = settings.dashboard && settings.dashboard.id && settings.dashboard.id !== 'none' ? settings.dashboard.id : null;
  const interval = Number(settings.interval);
  let readySent = false;
  let loaded = null; // what the pages were built from: a change rebuilds the stack
  let built = false; // pages are mounted: from then on, any other set of pages reloads the frame
  const mounted = new Map(); // page id → what its mount returned
  let slides = []; // the pages' slides, once built
  let watcher = null;

  const widget = window.createStackWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    intervalMs: settings.interval === 'never' ? 0 : (interval > 0 ? interval : 30) * 1000,
    smart: settings.smart !== false,
    resumeAfterMs: (Number(settings.resumeAfter) || 60) * 1000,
    showDots: settings.showDots !== false,
    dotsPosition: settings.dotsPosition === 'above' ? 'above' : 'below',
    dotsSize: settings.dotsSize === 'large' ? 'large' : 'small',
    onHaptic: () => {
      try { if (Homey.hapticFeedback) Homey.hapticFeedback(); } catch (e) { /* not on every platform */ }
    },
    onVisible: (page, visible) => {
      // A page brought on screen before the others were mounted (a Flow request) is mounted now.
      const s = visible ? slides.find(x => x.page.id === page.id) : null;
      if (s) mountSlide(s);
      const m = mounted.get(page.id);
      if (m && typeof m.setVisible === 'function') m.setVisible(visible);
      if (visible) checkFirstPage();
    },
    onHeight: () => {
      if (!readySent) return;
      Homey.setHeight(bodyHeight());
    },
  });

  function bodyHeight() {
    return Math.ceil(frame.getBoundingClientRect().height);
  }

  // Shown once the text font has loaded and the first page has drawn itself (at most 3 s).
  let readyStarted = false;
  let firstPageReady = null;
  const firstPage = new Promise((resolve) => { firstPageReady = resolve; });
  const readyPages = new Set(); // pages that have drawn themselves (their widget called ready, or failed)
  /** Resolves `firstPage` once the page on screen has drawn itself. */
  function checkFirstPage() {
    const current = widget.current();
    if (current && readyPages.has(current.id)) firstPageReady();
  }
  async function ready(waitForPage) {
    if (readyStarted) return;
    readyStarted = true;
    const waits = [];
    if (document.fonts && document.fonts.ready) waits.push(document.fonts.ready);
    if (waitForPage) waits.push(firstPage);
    await Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, 3000))]);
    readySent = true;
    widget.measure();
    Homey.ready({ height: bodyHeight() });
  }

  /** A page's request, sent through the stack to the page's own widget API. */
  function call(type, method, path, query, body) {
    return Homey.api('POST', '/call', { type, method, path, query: query || {}, body: body || {} });
  }

  /** The Homey a page's widget gets: its own settings, devices and instance id; requests through `/call`. */
  function pageHomey(page) {
    return {
      api: (method, path, body) => {
        const [p, qs] = String(path).split('?');
        const query = {};
        // perf= is the frame's load marks (loadMarks()): the stack frame's, not the page's, so it's left out.
        new URLSearchParams(qs || '').forEach((v, k) => { if (k !== 'perf') query[k] = v; });
        const res = call(page.type, method, p, query, body);
        // A page's own state also says whether it wants attention (smart rotate), so the watcher needn't read it too.
        if (method === 'GET' && p === '/state') res.then((r) => { if (watcher) watcher.seen(page, query, r); }, () => {});
        return res;
      },
      on: (event, fn) => Homey.on(event, fn),
      __: (key, tokens) => Homey.__(key, tokens),
      getSettings: () => page.settings || {},
      getDeviceIds: () => page.deviceIds || [],
      getWidgetInstanceId: () => page.id,
      setHeight: () => widget.measure(),
      ready: () => { widget.measure(); readyPages.add(page.id); checkFirstPage(); },
      hapticFeedback: () => { if (Homey.hapticFeedback) Homey.hapticFeedback(); },
      popup: (url) => { if (Homey.popup) Homey.popup(url); },
    };
  }

  /**
   * The files a widget's index.html loads before its own, as `<widget>/<name>` (both a .css and a .js): the chart
   * module, which Charts loads from the Electricity Overview's folder, and the presets module, which Variable
   * Presets loads from Thermostat Presets'. test/widget-html.test.ts checks this against the index.html files.
   */
  const DEPS = {
    electricity: ['electricity/chart'],
    charts: ['electricity/chart'],
    thermostat: ['thermostat/presets'],
    varpresets: ['thermostat/presets'],
  };

  /**
   * Each page's widget files, once per widget type: its `DEPS` (once per page), then `../<type>/widget.css`,
   * `widget.js` and `mount.js`.
   */
  const depsLoaded = new Map();
  function loadAssets(types) {
    const load = (tag, attrs) => new Promise((resolve) => {
      const el = document.createElement(tag);
      Object.assign(el, attrs);
      el.onload = () => resolve(true);
      el.onerror = () => resolve(false);
      document.head.appendChild(el);
    });
    // All at once: scripts added with `async: false` still run in the order they were added (deps, widget.js,
    // mount.js), so no file waits for another to arrive before it's asked for.
    const loads = [];
    for (const type of types) {
      if (window[window.STACK_TYPES[type]]) continue; // already there (the previews load them up front)
      for (const dep of DEPS[type] || []) {
        if (!depsLoaded.has(dep)) {
          depsLoaded.set(dep, Promise.all([
            load('link', { rel: 'stylesheet', href: `../${dep}.css` }),
            load('script', { src: `../${dep}.js`, async: false }),
          ]));
        }
        loads.push(depsLoaded.get(dep));
      }
      loads.push(
        load('link', { rel: 'stylesheet', href: `../${type}/widget.css` }),
        load('script', { src: `../${type}/widget.js`, async: false }),
        load('script', { src: `../${type}/mount.js`, async: false }),
      );
    }
    return Promise.all(loads);
  }

  /** What the pages are built from; when it changes (a widget added, a setting changed) the stack is rebuilt. */
  const signature = (pages) => JSON.stringify(pages.map(p => [p.id, p.type, p.settings, p.deviceIds]));

  /** Mounts a page's widget into its slide, once; a page that fails says so there. */
  function mountSlide(s) {
    if (mounted.has(s.page.id)) return;
    const mount = window[window.STACK_TYPES[s.page.type]];
    try {
      if (typeof mount !== 'function') throw new Error(`No widget for ${s.page.type}`);
      mounted.set(s.page.id, mount(pageHomey(s.page), { root: s.root, frame: s.frame }) || {});
    } catch (err) {
      console.error(err);
      mounted.set(s.page.id, {});
      s.root.className = 'sk-message error';
      s.root.textContent = widget.t('pageFailed');
      readyPages.add(s.page.id);
    }
    // A page that isn't on screen: a camera page stops its snapshots.
    const m = mounted.get(s.page.id);
    const current = widget.current();
    if (typeof m.setVisible === 'function') m.setVisible(!!current && current.id === s.page.id);
  }

  async function build(pages) {
    await loadAssets([...new Set(pages.map(p => p.type))]);
    watcher = window.createStackAttentionWatcher(pages, {
      call: (type, method, path, query) => call(type, method, path, query),
      on: (event, fn) => Homey.on(event, fn),
      onChange: (pageId, on) => widget.setAttention(pageId, on),
      // The media widget remembers the speaker this screen switched to (its mount.js, per widget instance).
      speakerOf: (page) => {
        try { return page.settings.switchSpeakers !== false ? localStorage.getItem(`widgetkeeper.media.speaker.${page.id}`) : null; } catch (e) { return null; }
      },
    });
    slides = widget.setPages(pages);
    // The page on screen first, the others once it has drawn itself (or OTHERS_AFTER_MS on), so its requests don't
    // wait behind theirs.
    const current = widget.current();
    const first = slides.find(s => current && s.page.id === current.id) || slides[0];
    if (first) mountSlide(first);
    built = true;
    checkFirstPage();
    Promise.race([firstPage, new Promise(r => setTimeout(r, OTHERS_AFTER_MS))]).then(() => {
      for (const s of slides) mountSlide(s);
      // Most watched pages' attention comes with their own state (`seen`); this reads the rest (a camera page's
      // alarms) once the pages' own requests have gone out.
      setTimeout(() => watcher.refresh(SEEN_FRESH_MS), ATTENTION_AFTER_MS);
    });
  }

  /**
   * Flow requests carry the Homey's clock (`until`, with its `now`); this screen's clock may differ, so each is moved
   * into this screen's time.
   */
  const localRequests = (list, homeyNow) => (list || []).map(r => ({ type: r.type, until: toLocal(r.until, homeyNow) }));
  const toLocal = (until, homeyNow) => (Number(homeyNow) > 0 ? until - homeyNow + Date.now() : until);

  async function load() {
    if (!dashboardId) {
      widget.setMessage(widget.t('selectDashboard'));
      ready(false);
      return;
    }
    try {
      const marks = perf ? `&perf=${perf}` : '';
      perf = '';
      const res = await Homey.api('GET', `/pages?dashboardId=${encodeURIComponent(dashboardId)}${marks}`);
      if (res && res.ok === false) {
        if (!loaded) widget.setMessage(widget.t(window.STACK_KEY_PROBLEMS.includes(res.reason) ? res.reason : 'error'), true);
        ready(false);
        return;
      }
      const pages = (res && res.pages) || [];
      if (((res && res.missing) || !pages.length) && !built) {
        widget.setMessage(widget.t(res && res.missing ? 'dashboardMissing' : 'noPages'), !!(res && res.missing));
      }
      if ((res && res.missing) || !pages.length) {
        // The mounted pages would keep running behind the message: start again from a clean frame.
        if (built) { location.reload(); return; }
        loaded = null;
        ready(false);
        return;
      }
      const sig = signature(pages);
      if (loaded === null) {
        loaded = sig;
        await build(pages);
        widget.setRequests(localRequests(res.requests, res.now));
        ready(true);
      } else if (loaded !== sig) {
        // A page was added, removed or changed on the dashboard: start again with the new pages.
        location.reload();
      } else {
        widget.setRequests(localRequests(res.requests, res.now));
        if (watcher) watcher.refresh(SEEN_FRESH_MS);
      }
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the pages; only a failed first load shows the error.
      if (!loaded) widget.setMessage(widget.t('error'), true);
      ready(false);
    }
  }

  Homey.on('stack:show', (data) => { if (data && data.type) widget.request(data.type, toLocal(data.until, data.now)); });
  Homey.on('stack:resume', () => widget.resume());

  perf = loadMarks(sdkAt);
  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body. */
window.mountStackWidget.frameClass = 'homey-widget-full';
