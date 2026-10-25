/*
 * Device Quick Actions: a grid of half-height device tiles. The whole tile triggers the device's
 * quick action (the action of the native tile's round button) and shows its state.
 * Plain browser JS (served as-is).
 */
(function () {
  const { el, tileNames, applyColors, onTap, touchGuard, messageLine } =
    window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  ("use strict");

  const OPTIMISTIC_MS = 10e3; // how long a tapped tile shows its new state while waiting for the device
  const PRESS_MS = 600; // how long a momentary (button) action lights the tile
  const TAP_SLOP = 10; // px a finger may move and still count as a tap
  const CONFIRM_MS = 3e3; // how long a tile that asks for a second tap waits for it
  const HOLD_MS = 600; // how long a long press holds the tile before it acts
  const HINT_MS = 1500; // how long a tile that wants a long press says so after a short tap
  const SECURE = ["locked", "garagedoor_closed"]; // the quick actions `pressFor: locks` guards

  const DEFAULT_STRINGS = {
    selectDevices: "Select devices in the widget settings.",
    error: "Could not load the devices.",
    failed: "Could not change __name__.",
    unavailable: "Unavailable",
    renameFailed: "Could not save the name.",
    tapAgain: "Tap again",
    hold: "Hold",
  };

  // Homey's standard capabilities carry no icon of their own (the Homey app draws them), so these
  // stand in for the quick-action icon unless the capability has one. Each viewBox is cropped to the ink
  // (plus half the stroke), so the glyph fills its box like the library icons do and its edge lines up with
  // the tile's padding. The thin stroke matches the library icons' line (about 1 px).
  const svg = (viewBox, body) =>
    `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
  const LOCK_BOX = "4.4 2.4 15.2 19.2"; // both padlocks, so the body doesn't move when it toggles
  const GLYPHS = {
    power: svg(
      "3.4 2.4 17.2 18.6",
      '<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    ),
    locked: svg(
      LOCK_BOX,
      '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    ),
    unlocked: svg(
      LOCK_BOX,
      '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    ),
    play: svg("7.4 4.4 12.2 15.2", '<path d="M8 5v14l11-7z" fill="#000"/>'),
    pause: svg("8 4 8 16", '<path d="M9 5v14M15 5v14" stroke-width="2"/>'),
    button: svg(
      "3.4 3.4 17.2 17.2",
      '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="#000"/>',
    ),
  };

  /** The built-in glyph for a capability and its current value. */
  function glyph(capabilityId, value) {
    const base = capabilityId.split(".")[0];
    if (base === "locked") return value ? GLYPHS.locked : GLYPHS.unlocked;
    if (base === "speaker_playing") return value ? GLYPHS.pause : GLYPHS.play;
    if (base === "button") return GLYPHS.button;
    return GLYPHS.power;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, activeStyle?: 'tint' | 'lighter',
   *   color?: string, colorStyle?: string, press?: 'single' | 'double' | 'long', pressFor?: 'all' | 'locks',
   *   onTrigger?: (deviceId: string, value: boolean) => Promise<any>, onHaptic?: () => void,
   *   renameTiles?: boolean, onRename?: (key: string, name: string) => Promise<any>,
   *   onHeight?: (h: number) => void }} opts
   */
  function createQuickActionsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`quickactions.${key}`, tokens) : null;
      if (s && s !== `quickactions.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) =>
        tokens && tokens[k] != null ? tokens[k] : "",
      );
    };

    let devices = []; // [{ id, name, icon, quickAction } | { id, missing }]
    const optimistic = new Map(); // deviceId → { value, until }
    const pressed = new Map(); // deviceId → until (momentary actions)
    // What failed: a lasting message replaces the content, a transient one goes by itself.
    const message = messageLine(() => render(), {
      clear: () => {
        devices = [];
      },
    });
    const confirming = new Map(); // deviceId → { from, timer }: waiting for the second tap
    const hints = new Map(); // deviceId → timer: a short tap on a tile that wants a long press
    let messageText = null;
    let messageTimer = null;

    root.classList.add("qa");
    const names = tileNames(
      opts,
      () => render(),
      (key) => {
        shake(key);
        setMessage(t("renameFailed"), true);
      },
    );
    root.classList.toggle("renaming", names.renaming);
    root.dataset.activeStyle =
      opts.activeStyle === "lighter" ? "lighter" : "tint";
    applyColors(root, {
      style: opts.colorStyle,
      color: opts.color,
      fallback: "blue",
    });
    root.style.setProperty("--qa-hold", `${HOLD_MS}ms`); // the long press's fill
    const grid = el("div", { class: "qa-grid" }, root);
    const messageEl = el("div", { class: "qa-message", dir: "auto" }, root);
    const touches = touchGuard(); // the tiles' taps
    /** @type {Map<string, {button: HTMLButtonElement, icon: HTMLElement, action: HTMLElement, name: HTMLElement}>} */
    const tiles = new Map();

    function setState(list) {
      devices = Array.isArray(list) ? list : [];
      message.reset();
      render();
    }

    function pushChange({ deviceId, capabilityId, value }) {
      const d = devices.find((x) => x.id === deviceId);
      if (!d || !d.quickAction || d.quickAction.capabilityId !== capabilityId)
        return;
      d.quickAction.value = value;
      const o = optimistic.get(deviceId);
      if (o && o.value === value) optimistic.delete(deviceId);
      const c = confirming.get(deviceId);
      if (c && c.from !== value) clearConfirm(deviceId); // changed elsewhere: a second tap would no longer do what was asked
      render();
    }

    /** A message under the tiles. Persistent messages also clear the tiles. */
    function setMessage(text, transient) {
      message.set(text, transient);
    }

    function shownValue(d) {
      const o = optimistic.get(d.id);
      if (o && Date.now() < o.until) return o.value;
      optimistic.delete(d.id);
      return d.quickAction.value;
    }

    /** Whether the `press` setting (double or long) applies to a quick action: every tile, or locks and garage doors. */
    function guarded(qa) {
      return (
        opts.pressFor !== "locks" ||
        SECURE.includes(qa.capabilityId.split(".")[0])
      );
    }

    /** Whether a tap only asks for a second one (`press: double`). */
    const asksConfirm = (qa) => opts.press === "double" && guarded(qa);

    /** Whether the tile acts on a long press only (`press: long`). */
    function holds(id) {
      const d = devices.find((x) => x.id === id);
      return (
        opts.press === "long" &&
        !names.renaming &&
        !!d &&
        !!d.quickAction &&
        d.quickAction.actionable &&
        guarded(d.quickAction)
      );
    }

    /** A tap: on a tile that wants a long press it only says *Hold*. */
    function tap(id) {
      if (!holds(id)) {
        press(id);
        return;
      }
      clearTimeout(hints.get(id));
      hints.set(
        id,
        setTimeout(() => {
          hints.delete(id);
          render();
        }, HINT_MS),
      );
      render();
    }

    function clearConfirm(id) {
      const c = confirming.get(id);
      if (c) clearTimeout(c.timer);
      confirming.delete(id);
    }

    async function press(id) {
      const d = devices.find((x) => x.id === id);
      if (
        !d ||
        !d.quickAction ||
        !d.quickAction.actionable ||
        !opts.onTrigger ||
        names.renaming
      )
        return;
      // The first tap asks for a second (*Tap again*, CONFIRM_MS), so a stray tap on the dashboard can't unlock a door.
      // A change of state in between asks again: the second tap would otherwise do the opposite of what was asked.
      if (asksConfirm(d.quickAction)) {
        const c = confirming.get(id);
        clearConfirm(id);
        if (!c || c.from !== shownValue(d)) {
          confirming.set(id, {
            from: shownValue(d),
            timer: setTimeout(() => {
              confirming.delete(id);
              render();
            }, CONFIRM_MS),
          });
          render();
          return;
        }
      }
      const value = d.quickAction.momentary ? true : !shownValue(d);
      if (d.quickAction.momentary) {
        pressed.set(id, Date.now() + PRESS_MS);
        setTimeout(render, PRESS_MS + 20);
      } else {
        optimistic.set(id, { value, until: Date.now() + OPTIMISTIC_MS });
        setTimeout(render, OPTIMISTIC_MS + 50);
      }
      render();
      try {
        await opts.onTrigger(id, value);
      } catch (err) {
        console.error(err);
        optimistic.delete(id);
        pressed.delete(id);
        shake(id);
        setMessage(t("failed", { name: names.name(d.id, d.name) }), true);
      }
    }

    function shake(id) {
      const tile = tiles.get(id);
      if (!tile) return;
      tile.button.classList.remove("shake");
      void tile.button.offsetWidth; // restart the animation
      tile.button.classList.add("shake");
    }

    function tileFor(id) {
      let tile = tiles.get(id);
      if (!tile) {
        // Renaming: a plain tile, as a text field can't sit in a button.
        const button = names.renaming
          ? el("div", { class: "qa-tile", "data-device": id })
          : el("button", {
              type: "button",
              class: "qa-tile",
              "data-device": id,
            });
        const top = el("div", { class: "qa-top" }, button);
        tile = {
          button,
          icon: el("span", { class: "qa-icon" }, top),
          action: el("span", { class: "qa-action" }, top),
          name: el("span", { class: "qa-name", dir: "auto" }, button),
        };

        // Taps are handled from the touch events, so the pressed state also shows on iOS (where :active
        // needs a touch listener) and the dashboard's own touch handling can't swallow the click. A tap is
        // a touch that ends within TAP_SLOP of where it started; a drag is left to the dashboard, so
        // dragging over the tiles still scrolls it.
        let start = null;
        let holdTimer = null;
        let held = false; // a long press acted: the click that may follow isn't a tap
        const unpress = () => {
          start = null;
          clearTimeout(holdTimer);
          holdTimer = null;
          button.classList.remove("pressing", "holding");
        };
        // A long press (`press: long`): the tile fills while held and acts once full; let go sooner, it's a tap.
        const hold = () => {
          held = false;
          if (!holds(id)) return;
          clearTimeout(hints.get(id));
          hints.delete(id);
          button.classList.add("holding");
          holdTimer = setTimeout(() => {
            unpress();
            held = true;
            if (opts.onHaptic) opts.onHaptic();
            press(id);
          }, HOLD_MS);
          render();
        };
        button.addEventListener(
          "touchstart",
          (e) => {
            const p = e.changedTouches[0];
            start = { x: p.clientX, y: p.clientY };
            button.classList.add("pressing");
            hold();
          },
          { passive: true },
        );
        button.addEventListener(
          "touchmove",
          (e) => {
            const p = e.changedTouches[0];
            if (
              start &&
              Math.hypot(p.clientX - start.x, p.clientY - start.y) > TAP_SLOP
            )
              unpress();
          },
          { passive: true },
        );
        button.addEventListener("touchend", (e) => {
          const wasTap = !!start; // not after a drag, or a long press that acted
          unpress();
          held = false;
          // Every touch: one that moved past TAP_SLOP can still get the browser's click.
          lastTouchTap = Date.now();
          if (!wasTap) return;
          e.preventDefault(); // no click after it
          tap(id);
        });
        button.addEventListener("touchcancel", unpress);
        // A long press would open Android's context menu.
        button.addEventListener("contextmenu", (e) => {
          if (holds(id)) e.preventDefault();
        });
        // Mouse and keyboard: a click is a tap; a long press holds the button or Enter/Space (whose own click is kept back).
        button.addEventListener("mousedown", (e) => {
          if (e.button === 0 && Date.now() - lastTouchTap >= 800) hold();
        });
        button.addEventListener("mouseup", unpress);
        button.addEventListener("mouseleave", unpress);
        button.addEventListener("keydown", (e) => {
          if ((e.key !== "Enter" && e.key !== " ") || !holds(id)) return;
          e.preventDefault();
          if (!e.repeat && !holdTimer) hold();
        });
        button.addEventListener("keyup", (e) => {
          if ((e.key !== "Enter" && e.key !== " ") || (!holdTimer && !held))
            return;
          e.preventDefault();
          const early = !!holdTimer;
          unpress();
          held = false;
          if (early) tap(id);
        });
        button.addEventListener("click", () => {
          if (Date.now() - lastTouchTap < 800) return;
          if (held) {
            held = false;
            return;
          }
          tap(id);
        });
        tiles.set(id, tile);
      }
      return tile;
    }

    const setMask = (node, url) =>
      window.WidgetkeeperKit.setMask(node, url, "--qa-mask");

    let lastHeight = 0;
    function render() {
      const ids = new Set(devices.map((d) => d.id));
      for (const [id, tile] of tiles) {
        if (!ids.has(id)) {
          tile.button.remove();
          tiles.delete(id);
        }
      }
      let placed = null;
      for (const d of devices) {
        const tile = tileFor(d.id);
        // Keeps the order, moving only what is out of place: a moved node loses the focus of a field in it.
        const want = placed ? placed.nextSibling : grid.firstChild;
        if (tile.button !== want) grid.insertBefore(tile.button, want);
        placed = tile.button;
        const qa = !("missing" in d) ? d.quickAction : null;
        const until = pressed.get(d.id);
        const isPressed = !!until && Date.now() < until;
        if (!isPressed) pressed.delete(d.id);
        const value = qa ? shownValue(d) : null;
        const confirm = !!qa && confirming.has(d.id) && !names.renaming;

        const hint = !!qa && hints.has(d.id) && !names.renaming;
        tile.name.textContent =
          "missing" in d
            ? t("unavailable")
            : hint
              ? t("hold")
              : confirm
                ? t("tapAgain")
                : names.name(d.id, d.name);
        if (names.renaming && !("missing" in d)) {
          const field = names.field(d.id, d.name);
          if (field.previousSibling !== tile.name) tile.name.after(field);
        }
        tile.button.classList.toggle("missing", "missing" in d);
        setMask(tile.icon, "missing" in d ? null : d.icon);
        tile.icon.classList.toggle("fallback", "missing" in d || !d.icon);
        // While asking for the second tap, the action icon shows what it will do (an open padlock to unlock).
        setMask(
          tile.action,
          qa
            ? qa.icon ||
                glyph(
                  qa.capabilityId,
                  confirm && !qa.momentary ? !value : value,
                )
            : null,
        );
        tile.action.style.display = qa ? "" : "none";
        tile.button.classList.toggle("confirm", confirm);
        tile.button.classList.toggle(
          "active",
          qa && !confirm ? (qa.momentary ? isPressed : value === true) : false,
        );
        tile.button.disabled = !qa || !qa.actionable;
        tile.button.dataset.capability = qa ? qa.capabilityId : "";
      }
      grid.style.display = devices.length ? "" : "none";
      messageEl.textContent = message.text || "";
      messageEl.style.display = message.text ? "" : "none";
      messageEl.classList.toggle("error", !!message.text && devices.length > 0);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) {
        lastHeight = h;
        if (opts.onHeight) opts.onHeight(h);
      }
    }

    return { setState, setNames: names.set, pushChange, setMessage, render, t };
  }

  window.createQuickActionsWidget = createQuickActionsWidget;
})();
