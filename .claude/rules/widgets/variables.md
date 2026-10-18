---
paths:
  - "widgets/variables/**"
  - "test/variables-*.test.ts"
  - "dev/variables-preview.html"
  - "lib/VariableService.ts"
---
# Variables widget (`variables`)

- Homey's Logic variables as compact rows, for flow flags (a user's request: the built-in variable widget gives each a big tile and cuts the name). `lib/VariableService.ts`; transparent, Quick Actions' tile style.
- Settings: `columns` (`"1"`/`"2"`; 2 falls back to 1 below 340 px, `@container vr`), `readOnly` (off; wk-045, a user who only shows information: `.vr-readonly`, no row taps, inputs or `onSet`, so no API key needed; numbers right-aligned without −/+, yes/no as an 8 px dot (blue for yes, a ring for `null`) and `variables.yes`/`no`, strings up to 60 %), `step` (1), `min`/`max` (empty: no limit; wk-030, 0–1 percentages in steps of 0.05; `limitOf()` treats `null`/`''` as none, min > max is swapped), `slot1`…`slot10` (the user chose slots over a name filter; every variable by name, described `Yes/No · No`, `None` first). Rows are named with `renameTiles` (first; see *Tile names*), which replaced the `nameN` settings in 1.0.0 (on Homey's dashboards their names are lost; see *Tile names*).
- A row (48 px min): the name (14/20 bold, up to 2 lines) and the control on the right.
  - Boolean: a switch (blue when on); a tap anywhere on the row toggles it.
  - Number: `−` value `+` (32 px round buttons). A burst of taps is sent once, 700 ms after the last (`variableStepValue()` rounds away float noise). A tap on the row opens an input (`inputmode="decimal"`; a decimal comma works, `parseVariableNumber()`). `min`/`max` clamp in the widget only (the app's `/set` doesn't know them, and a Flow may set anything): − or + at its limit is dimmed (`.at-limit`, `aria-disabled`), a value outside moves to the nearer limit, a typed number is clamped.
  - String: the text, muted, ellipsized at half the row; a tap opens a text input. Enter or leaving it sends, Escape cancels; realtime doesn't overwrite an open input.
- Optimistic values 10 s; a failure shakes the row with a transient message.
- homey-api (read from its source): `api.logic.getVariables()` → `{[id]: {id, name, type: boolean|number|string, value}}`, `updateVariable({id, variable: {value}})`. Realtime needs `api.logic.connect()` first (`on()` doesn't connect); the events are `variable.update`/`create` (an item when cached, else raw, possibly partial data, so the service merges) and `variable.delete` (`{id}`). **The app's token can't write variables** (2026-10-07: `homey.logic.readonly`, not `homey.logic`; `Missing Scopes`), so writes use the personal API key; reads, events and autocompletes use the app's token.
- The service connects on the first `/state` and disconnects after 10 min without one. It re-reads every variable at most every 4 min (`$cache: false`) in case an event was missed; a variable changed meanwhile keeps the newer value. `set` checks the type (finite numbers, strings up to 1000 characters).
- `GET /state?ids=a,b` (`{id, name, type, value}` or missing, in order), `POST /set {id, value}`. Realtime `variables:state`, only for ids asked for in the last 10 min. Diagnostics' `variables`: connection and counts, never values.
- `dev/variables-preview.html` (`Broken flag` fails). The Energy and Security showcases have one.
- Colour style (`colorStyle`, Default/Deep; CLAUDE.md *Widget styling*, `kit.css`): after `columns`, with `color` (the switch and the read-only dot, blue by default; `--vr-accent` is `--wk-c`). Deep: a row that's on is the shade, solid, with `--wk-on` text, a 40 % switch track and the dot in `--wk-on`.
