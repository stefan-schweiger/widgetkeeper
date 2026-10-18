---
paths:
  - "widgets/locks/**"
  - "test/locks-*.test.ts"
  - "dev/locks-preview.html"
  - "lib/LockService.ts"
---
# Locks and Doors widget (`locks`)

- Locks (`locked`), door and window contacts (`alarm_contact`) and garage doors (`garagedoor_closed`) in one tile: Activity Dots' tile, with Sensor Alarms' red tint when anything isn't secure (only while the list is closed: the user found the tinted list messy). Transparent. `lib/LockService.ts`.
- Secure is `locked: true`, `alarm_contact: false`, `garagedoor_closed: true` (`LOCK_CAPS`). `lockLevel()`: `insecure` (any capability), `secure` (every one), `unknown` (one hasn't reported: a closed door with an unreported lock isn't known to be locked) or `missing`.
- The summary: a padlock (closed and green, open and red, muted while unknown), the title over the detail (muted, or red when something isn't secure) and a chevron.
  - All secure: `All locked`, `All closed` or `All locked and closed`, with `Since 18:12` (the newest change). One not: its name, with `Unlocked since 18:12` (only what isn't secure). Several: `__count__ unlocked`, `__count__ open` or `__count__ open or unlocked`, with their names.
  - Nothing insecure, but a device without status: its name over `No status yet`, or `__count__ without status` over their names (the padlock muted); never `All locked` while one is unknown. Missing devices add `· 1 unavailable`. Times as `formatSince()`.
- The list (a tap on the summary, or always with `view: list`): a row per device: the muted icon, the name over the state, the button on the right. The state is the row's only colour: `Locked · Closed` in green when secure, else only what isn't in red (a user's request, so the offending door stands out); muted while unknown.
  - An insecure lock or garage door gets `Lock` or `Close`; with two or more, `Lock all` sits in the summary row before the chevron (while the list shows). `onTap()` stops `touchstart` from bubbling, and a busy Lock all keeps its pointer events (it skips busy devices), so it never toggles the summary. With `allowUnlock` (off) a secure one gets `Unlock` or `Open`. Every button is Variables' grey pill (the user found blue pills and a full-width `Lock all` under the list too busy). A contact sensor never has a button.
  - A button pulses until the device reports the new value, or for 15 s; a failure shakes the row with `Could not change __name__.`
- `GET /state` → `{devices: [{id, name, icon, caps: {locked?, alarm_contact?, garagedoor_closed?: {value, setable, lastUpdated}}} | missing], language}` (a device with none of the three is missing); `POST /set {deviceId, capabilityId, value}` only sets `locked` or `garagedoor_closed`. The unlock setting is the widget's alone (the app API needs the user's session anyway). Realtime `locks:state {deviceId, capabilityId, value, t}`.
- Colour style (`colorStyle`, Default/Deep; CLAUDE.md *Widget styling*, `kit.css`): after `allowUnlock`. Deep: the insecure summary is the red shade, solid, with white text; the list keeps the tile colour, as in Default.
