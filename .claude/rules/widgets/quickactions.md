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
- `POST /trigger {deviceId, value}` only ever sets the quick-action capability. Realtime `quickactions:state`. Diagnostics list each device's quick action, override, type and icon.
