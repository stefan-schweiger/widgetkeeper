---
paths:
  - "widgets/textline/**"
  - "test/textline-*.test.ts"
  - "dev/textline-preview.html"
  - "lib/TextLineService.ts"
  - ".homeycompose/flow/actions/textline_*.json"
---
# Notes widget (id `textline`)

- A short message (wk-044: a user asked for a text line; the user's brief: a normal tile, or a realistic Post-it stuck on the dashboard in handwriting; then the name Notes and a message typed in the settings). Transparent. `lib/TextLineService.ts` keeps the Flows' texts. The id, Flow card ids, app setting and events keep `textline`; only what users read says Notes / note.
- `source` (`Text from`): `typed` (default), `flow` or `variable`. `message` (a textarea) is the typed note; with `flow` or `variable` it shows while they have no text (else a muted `No message`). Typed and empty: `Type your note in the widget settings.` A typed note makes no requests.
- Named notes ("boards" in the code; names, because a Flow can't address a widget instance): `board` (`Note name`, default `Note`), keyed by `boardKey()` (trimmed, lower-cased; `window.textLineBoardKey`). The app setting `textLines` `{[key]: {name, text, color, updatedAt}}`: at most 50 (the oldest go), text cut at 500, a cleared note deleted. Realtime `textline:state {key, name, text, color, updatedAt}`.
- Flow cards (`.homeycompose/flow/actions/textline_*.json`; `app.ts` `registerTextLineFlows()`): `textline_set` "Write [[text]] on the note [[board]]" (resets the colour), `textline_set_color` "… in [[color]]" (the user asked; `TILE_COLORS`), `textline_clear` "Clear the note [[board]]". `board` autocompletes `listBoards()` (`Note`, the notes with a text, then what's typed as a new note; the id is the name). A Flow's colour wins over the widget's own.
- `variable` autocompletes `listVariables(query, {types: ['string']})`, read through Variables' `getState()` with the app's token (its tracking and `variables:state`).
- `GET /state?board=|variable=` → `{language, board, variable}`. Flow and variable notes refetch every 5 min and when the page becomes visible. Diagnostics' `textLines`: counts only, never texts.
- Tile (`style: tile`): Variables' row with an optional 20 px icon (`icon`, `listIcons(…, {none: true})`; the kit's `icons`) and one line (a typed line break becomes a space). `size`: small 14/20 regular, default 17/24 medium, large 24/32 bold. `align`. `overflow`: `ellipsis` or `scroll` (only when it doesn't fit: to the end and back at 40 px/s with 15 % pauses and 8 px soft edges; off with reduced motion). `color`: Device Values' 22 % tint.
- Post-it (`style: postit`): `.tl-note` holds the tilt (2–3.5° either way from the instance id, `textLineTilt()`; the user asked for more than the first 0.6–1.8°) and the paper's shadow as a `drop-shadow` filter, so it follows the cut corner. `.tl-paper` is cut diagonally at the bottom right by a `mask-image` (`--tl-fold`), and its `::after` is the folded ear (the user's request). No line across the top (the user disliked the glue strip). Yellow by default, or the colour's paper (red → pink, purple → lavender …); blue-black ink in both modes. Up to 3 lines of handwriting (`-webkit-line-clamp`, `white-space: pre-line`): `fitNote()` steps the size down until it fits, measured with the clamp lifted and by `offsetHeight` (the tilted note's `getBoundingClientRect()` is ~10 px taller, which shrank every three-line note). No icon.
- Font: **Caveat** (SIL OFL, `widgets/textline/public/fonts/` with `OFL.txt`; Latin, Latin Extended and Cyrillic, weight 500, from `@fontsource/caveat` 5.2.6) as `Widgetkeeper Caveat`; Korean and Arabic fall back to the system font. **Fonts are local only** (the user: no Google Fonts). `mount.js` asks `document.fonts.load()` before `ready` (≤ 1 s); the note refits once fonts are in.
- Not yet tried in the phone apps: font loading in their WebViews, and the Android text zoom against the note's px sizes.
