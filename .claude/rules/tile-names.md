---
paths:
  - "lib/TileNameService.ts"
  - "test/tile-names*.test.ts"
  - "dev/rename-preview.html"
  - "widgets/spacer/public/kit.js"
  - "widgets/lights/**"
  - "widgets/curtains/**"
  - "widgets/quickactions/**"
  - "widgets/sensoralarms/**"
  - "widgets/roomhealth/**"
  - "widgets/valuematrix/**"
  - "widgets/values/**"
  - "widgets/sparklines/**"
  - "widgets/locks/**"
  - "widgets/cameras/**"
  - "widgets/variables/**"
  - "widgets/shortcuts/**"
---
# Tile names (wk-024)

- The user's brief: name the tiles where you see them, since widget settings can't list the picked devices. The checkbox `renameTiles` ("Rename tiles", first, off; its hint spells out the phone's steps: turn it on and save the widget, leave the dashboard's edit mode, type on the tiles, then turn it off again) in Light Controls, Curtains, Quick Actions, Sensor Alarms, Room Health, Value Matrix, Device Values, Sparklines, Locks and Doors, Cameras, Variables (wk-065: it replaced Variables' ten `nameN` settings) and Dashboard Shortcuts (web dashboards only, 2026-10-19). It also replaced Device Values' `nameN` and Sensor Alarms' `names` textarea (both shipped in 0.9.0, removed in 1.0.0 with no carry-over, the user's choice, 2026-10-18; the changelog and README say to retype them).
- `lib/TileNameService.ts` (`app.tileNames`): the app setting `tileNames` `{[instance]: {names: {[tile key]: name}, updatedAt}}`; names trimmed and cut at 60, an empty one deleted; ids and keys `__proto__`/`constructor`/`prototype` refused (the setting is read by its own keys only); ≤ 60 keys per instance and ≤ 300 instances (the oldest `updatedAt` go: nothing tells the app a widget was removed). Realtime `tilenames:state {instance, names}`. `tileNameRoutes` (`POST /names {instance, key, name}`; the names come with `/state`) is spread into the twelve `api.ts` and declared in their manifests, so the stack's `/call` and `/web/call` take them (no API key). Diagnostics' `tileNames`: counts.
- The instance is `Homey.getWidgetInstanceId()`, so every screen showing a dashboard widget shares its names, and so does a stack page of it (`page.id`); a web dashboard widget (`web-<dashboard>-<widget>`) has its own. Tile keys: the tile id in Lights and Curtains (device id or `zone:<zoneId>`), the room in Room Health and Value Matrix (`zone:<zoneId>`, else the device id; Value Matrix's devices rows the device id), the device id in Quick Actions, Sensor Alarms, Locks and Cameras, `<deviceId>:<capabilityId>` in Device Values and Sparklines, the dashboard id in Dashboard Shortcuts (no repeats: two pills of one dashboard share a name) and the variable id in Variables (then `#2`, `#3` for repeats; `nameKeys()`, the same source with each widget's `keyOf`; `repeatKeys()` is the app's twin), so reordering slots keeps the names.
- Variables' old names (`name1`…`name10`, shipped in 0.9.0): the phone app leaves a removed setting out of `getSettings()` (see Homey API facts), so on Homey's dashboards they're lost and have to be retyped on the rows (the user accepted that, 2026-10-16; the changelog and README say so). Where a widget does get them (a Smart Stack page, whose settings are the raw `data.settings`; it adopts into the dashboard widget's own instance), `mount.js` sends `&oldNames=<JSON {key: name}>` with `/state` until a read goes through, and `withTileNames()` hands them to `adopt()`: once per instance (`adopted: true`, kept even when every name is cleared, so a cleared name doesn't come back), a key with a typed name keeps it, a bad `oldNames` is logged and never fails `/state`. Web dashboards' `normalize()` drops unknown settings when read, so `app.ts` (`adoptOldTileNames()`) takes them over at every start from the raw saved dashboards (`WebDashboardService.oldVariableNames()`); seen working on the Homey 2026-10-16, as was `/state` with `oldNames` through `/web/call`.
- Front end: The kit's `tileNames(opts, render, failed)`: `name(key, own)` is the typed name, else `own` (the device's, the room's or the variable's). `field(key, own)` is the rename-mode `<input class="wk-rename">` after the name element, which CSS hides (`.renaming` on the root): it saves on change, Escape puts it back, a focused field isn't overwritten, its touches, clicks and keys stop at it; a failed save puts the name back (unless the app's names came meanwhile), shakes the tile and says `<ns>.renameFailed`. The kit's `wireTileNames(Homey, setNames)` asks `/state` with `&instance=`, which answers `{state, tileNames}` (`withTileNames()`; without `instance`, as the stack's attention reads, as before), and listens to `tilenames:state`; a missing or throwing `getWidgetInstanceId` falls back to `default`.
- Rename mode: the tile's own taps do nothing; Light Controls hides the chip and bar, Curtains the pill and bar (`visibility`, keeping the height); Quick Actions' tile is a `div` meanwhile (an input can't sit in a button); Locks shows the list without buttons; Variables hides the control (`display: none`, so the field takes the row; read only too); the 24 px field fits each name's line.
- The README's *Tile names* section has the `rename` clip (Light Controls by room, a stand-in sheet for the phone's widget settings, `#sheet`/`openSettings`); each widget's Settings line links to it. `dev/rename-preview.html`: all twelve, dark and light (a name with "fail" in it fails). `npm run test-dashboards` adds a "Rename tiles" widget to each, with a name typed. Checked on the Homey 2026-10-15 through `/web/call` and the stack's `/call`; not yet typed on a phone.
