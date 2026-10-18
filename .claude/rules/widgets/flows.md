---
paths:
  - "widgets/flows/**"
  - "test/flows-*.test.ts"
  - "dev/flows-preview.html"
  - "lib/FlowService.ts"
  - "lib/flowIconImages.ts"
  - "scripts/render-flow-icons.mjs"
---
# Flow Buttons widget (`flows`)

- Flows and Advanced Flows as rows the size of Variables' (a user's request): a 32 px round button in the row's colour with an 18 px icon, then the name (14/20 bold, 2 lines). A tap on the row (`onTap()`, or Enter/Space) starts it, with `Homey.hapticFeedback()`. `lib/FlowService.ts`; transparent.
- Settings (33): `columns` (`"1"`/`"2"`; 1 below 300 px), then per button N = 1…8: `flowN` (autocompletes `listFlows()`: `None`, then every `triggerable` flow by name, described `Flow · <folder>` or `Advanced Flow`, id `flow:<id>` or `advanced:<id>`, `parseFlowId()`), `colorN` (`blue` default, `red`, `orange`, `yellow`, `green`, `purple`, `grey`), `iconN` and `nameN` (replaces the flow's name on the row and in its messages).
- `iconN` autocompletes `listIcons()`: `FLOW_ICONS` (44, named in `flows.icons.<id>`), sorted in Homey's language, each with an `image` (`iconImage()`: a 96 px PNG data URL of the white glyph on a blue circle; the iOS app left an SVG data URL blank, 2026-10-08). `npm run flow-icons` (`scripts/render-flow-icons.mjs`, sharp) pre-renders them from the kit into the generated `lib/flowIconImages.ts`; a test fails when a path changed without re-rendering. No icon is `play`.
- Icons: the kit's `icons` (`ICONS` in `widgets/spacer/public/kit.js`; Days Since, Notes, Variable Presets and Media's buttons use them too), 24 px paths with a 2 px round stroke (`play` filled), inline SVG in `currentColor`: white on the colours, `#1A1B21` on yellow and green, the text colour on grey. The settings offer the generated previews' ids (`FLOW_ICONS`).
- Feedback: `running` (a spinning ring, at least 400 ms), then `done` (a check mark for 1.5 s); a failure shakes the row with `KEY_PROBLEMS`' message or `Could not start …`. Taps while running are ignored.
- `triggerable` is Homey's flag, not "has *This Flow is started*": 32 of 33 flows on the test Homey had it, device and time triggers included (2026-10-08). Starting one by hand runs its conditions, then its actions. A disabled or not triggerable flow is dimmed (`.unavailable`; a tap only shows a message); a deleted one is `missing` (a hollow ring, `Flow not found`).
- Starting uses the personal API key (`flow.triggerFlow({id})` / `flow.triggerAdvancedFlow({id})`); reading uses the app's token (`getFlows`, `getAdvancedFlows`, `getFlowFolders`). Not yet started from the widget on the real Homey.
- `GET /state?ids=` (`{id, name, enabled, triggerable, advanced}` or missing), `POST /trigger {id}` (`{ok: true}` or `{ok: false, reason}`). No realtime: one read of all flows is shared for 60 s (the autocomplete's for 5 s), and widgets refetch every 5 min. Diagnostics' `flows`: counts and the last error, never names.
- `dev/flows-preview.html` (`Broken flow` fails).
- Colour style (`colorStyle`, Default/Deep; CLAUDE.md *Widget styling*, `kit.css`): after `columns`. `--fb-c-*` are the palette's. Deep: each row is its colour's shade, solid, with the text in its `--wk-on-<colour>`, the round button 20 % of that and the spinner in it; grey rows and missing flows are unchanged.
