/*
 * Wires createMediaWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountMediaWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscription alive and resyncs state

  // Load marks for the app's diagnostics log, sent with the first request only.
  let perf = '';
  function loadMarks(sdkAt) {
    const nav = /** @type {PerformanceNavigationTiming | null} */ (performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null);
    return [Math.round(performance.timeOrigin), nav ? Math.round(nav.responseEnd) : -1,
      Math.round(sdkAt), Math.round(performance.now())].join(',');
  }
  function perfParam() {
    const p = perf ? `&perf=${perf}` : '';
    perf = '';
    return p;
  }

  perf = loadMarks(performance.now());
  const settings = Homey.getSettings() || {};
  // The speaker in the settings is the default; with switching, each screen remembers the one it picked last
  // (per widget instance, in this screen's storage; it can come back empty, which means the default).
  const defaultId = (settings.device && settings.device.id) || null;
  const canSwitch = settings.switchSpeakers !== false;
  let instanceId = 'default';
  try { instanceId = Homey.getWidgetInstanceId() || 'default'; } catch (e) { /* older apps */ }
  const storeKey = `widgetkeeper.media.speaker.${instanceId}`;
  const store = {
    get() { try { return localStorage.getItem(storeKey); } catch (e) { return null; } },
    set(id) {
      try { if (id && id !== defaultId) localStorage.setItem(storeKey, id); else localStorage.removeItem(storeKey); } catch (e) { /* no storage */ }
    },
  };
  let deviceId = defaultId && canSwitch ? store.get() || defaultId : defaultId;
  let loadSeq = 0;
  const maxVolume = Number(settings.maxVolume);
  let readySent = false;
  let loaded = false;

  const widget = window.createMediaWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    buttons: window.mediaButtonsFromSettings(settings),
    volumeStep: Number(settings.volumeStep || 5) / 100,
    maxVolume: maxVolume > 0 && maxVolume < 100 ? maxVolume / 100 : 1,
    showShuffle: settings.showShuffle === true,
    showProgress: settings.showProgress !== false,
    canSwitch: canSwitch && !!defaultId,
    onListSpeakers: async () => (await Homey.api('GET', '/speakers')).speakers,
    onSwitch: (id) => {
      deviceId = id;
      store.set(id);
      load();
    },
    volumeLayout: settings.volumeLayout === 'buttons' ? 'buttons' : 'line',
    onSet: (capabilityId, value) => Homey.api('POST', '/set', {
      deviceId, capabilityId, value, maxVolume: maxVolume > 0 && maxVolume < 100 ? maxVolume / 100 : 1,
    }),
    onButton: async (id) => {
      const res = await Homey.api('POST', '/button', { deviceId, id });
      // No usable API key: the widget says what to do (see the app settings).
      if (res && res.ok === false) throw Object.assign(new Error(res.reason), { reason: res.reason });
    },
    onArt: () => Homey.api('GET', `/art?deviceId=${encodeURIComponent(deviceId)}`),
    onReport: (text) => { Homey.api('POST', '/report', { text }).catch(() => {}); },
    onHaptic: () => {
      try { if (Homey.hapticFeedback) Homey.hapticFeedback(); } catch (e) { /* not on every platform */ }
    },
    // The widget reports its own height; Homey needs the body's, which adds the widget padding.
    onHeight: () => {
      if (!readySent) return;
      Homey.setHeight(bodyHeight());
    },
  });

  function bodyHeight() {
    return Math.ceil(frame.getBoundingClientRect().height);
  }

  // Shown once the text font has loaded (at most 1 s), so the text doesn't pop in after the icons.
  let readyStarted = false;
  async function ready() {
    if (readyStarted) return;
    readyStarted = true;
    if (document.fonts && document.fonts.ready) {
      await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1000))]);
    }
    readySent = true;
    Homey.ready({ height: bodyHeight() });
  }

  async function load() {
    if (!deviceId) {
      widget.setMessage(widget.t('selectDevice'));
      ready();
      return;
    }
    const seq = ++loadSeq;
    const id = deviceId;
    try {
      // A switched-to speaker also says which of its own actions it has, for the buttons picked for the default.
      const cards = id !== defaultId ? '&cards=1' : '';
      const state = await Homey.api('GET', `/state?deviceId=${encodeURIComponent(id)}${cards}${perfParam()}`);
      if (seq !== loadSeq) return; // switched again meanwhile
      if (state && state.missing && id !== defaultId) {
        // The speaker picked on this screen is gone: back to the default.
        deviceId = defaultId;
        store.set(null);
        load();
        return;
      }
      widget.setState(state);
      loaded = true;
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error(err);
      // A failed refresh keeps the card; only a failed first load replaces it with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Homey.on('media:state', (data) => {
    if (data && data.deviceId === deviceId) widget.pushChange(data);
  });
  Homey.on('media:art', (data) => {
    if (data && data.deviceId === deviceId) widget.pushArt(data.art);
  });
  // A tablet waking up: the track has probably changed since.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && loaded) load(); });

  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountMediaWidget.frameClass = 'homey-widget mw-frame';
