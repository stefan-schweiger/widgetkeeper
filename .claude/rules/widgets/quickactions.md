---
paths:
  - "widgets/quickactions/**"
  - "test/quickactions-*.test.ts"
  - "dev/quickactions-preview.html"
  - "lib/QuickActionService.ts"
---
# Device Quick Actions widget (`quickactions`)

- Half-height tiles (62 px; the user asked for less tall), 3 per row; `lib/QuickActionService.ts`; transparent, so each tile sits on the dashboard like a native one.
- The whole tile triggers the device's quick action and shows its state. `activeStyle`: `tint` (default; a blue-tinted tile and icons) or `lighter` (a lighter grey tile). No circle around the action icon.
- The name is 14/20 bold, like the native temperature tiles (measured). The 20 px device icon is masked `left center` so narrow icons line up with the name, the 18 px action icon `right center`. The built-in glyphs' viewBoxes are cropped to their ink, with a 1.2 stroke, to match the library icons' ~1 px line.
- The quick action is `ui.quickActionOverride` (the user's choice; `.none` turns it off), else `ui.quickAction`; locks only have the override (`locked`). Only settable booleans; `button*` capabilities are momentary (always `true`, and the tile flashes). Tiles do nothing in the dashboard's edit mode.
- Standard capabilities have `iconObj: null` (the Homey app draws them), so the widget has built-in power/padlock/play/button glyphs; a custom capability's own icon (e.g. the Roborock's `clean_full`) is used when present.
- `press` ("Activate with", after `colorStyle`: `single` (default), `double` or `long`, the user's ask, 2026-10-20, so a stray tap can't unlock a door) with `pressFor` (`  – Tiles`: `all`, default, or `locks`: quick actions `locked` and `garagedoor_closed`, `SECURE`). A tile it doesn't guard acts on a tap as before.
  - Double: Locks' Open pattern. The first tap only marks the tile (`.confirm`, `CONFIRM_MS` 3 s): the name becomes `Tap again`, the action icon shows what the second tap will do (an open padlock), Locks' red tint and red text (Vivid the red shade with `--wk-on-red`), whatever `activeStyle`; the tile drops `.active` meanwhile. The second tap within 3 s acts. A realtime change of value in between drops it, and a second tap that finds another value than the first (an optimistic value ran out) asks again, so it can't do the opposite of what was asked.
  - Long: the tile fills from the left while held (`.holding`, `::before` scaled over `HOLD_MS` 600 ms, `--qa-hold` set from widget.js; under the content through the tile's `isolation`), then acts with a haptic (`onHaptic`, `Homey.hapticFeedback`). Let go sooner and it's a tap: the name says `Hold` for 1.5 s (`HINT_MS`). Touch (a drag past `TAP_SLOP` or a `touchcancel` stops it), the mouse (`mousedown`, `mouseup`/`mouseleave`; the click after a hold that acted is skipped) and Enter/Space (`keydown`/`keyup`, their own click kept back with `preventDefault`). `contextmenu` is prevented and `-webkit-touch-callout: none` set, for Android's and iOS's long-press menus. **Not tried in the phone apps:** Homey's Android app takes a touch it may scroll ~100 ms in (see the Electricity Overview); if it does that to a still finger too, a long press can't work there and Double is the one to use.
- `POST /trigger {deviceId, value}` only ever sets the quick-action capability. Realtime `quickactions:state`. Diagnostics list each device's quick action, override, type and icon.
- Colour style (`colorStyle`, Muted/Vivid; CLAUDE.md *Widget styling*, `kit.css`): after `activeStyle`, with `color` (the on tint, blue by default; `--qa-accent` is `--wk-c`; in dark mode its icon is the colour lifted 72 % towards white, blue keeping `#5AA6FF`). Vivid: a tile that's on is the shade, solid, with its text and icons in `--wk-on`; `activeStyle: lighter` keeps its grey.
