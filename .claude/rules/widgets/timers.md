---
paths:
  - "widgets/timers/**"
  - "test/timers-*.test.ts"
  - "dev/timers-preview.html"
  - "lib/TimerService.ts"
  - ".homeycompose/flow/triggers/timers_*.json"
---
# Timers widget (`timers`)

- Kitchen timers: up to four presets with a blue play icon (`minutesN`, 0 hides it, decimals allowed; `labelN`; defaults 5/10/15/30 min; `timerPresetsFromSettings()`), or the running timer in their place. One timer per widget (the user asked, so the widget always takes the same 56 px row); starting replaces the instance's timer (two screens at once: the last start wins). Transparent, Flow Buttons' tile style. `lib/TimerService.ts`.
- Timers run in the app per widget instance (`Homey.getWidgetInstanceId()`, else `default`), so every screen sees the same ones, and the trigger card `timers_finished` ("A timer finished", tokens `timer`, the name or e.g. `10 min`, and `minutes`) fires with no dashboard open (`app.ts` `timerFinished()`). Not yet checked that every screen showing one dashboard gets the same instance id, which is the point.
- A timer: `{id, label, duration, endsAt | null, remaining | null, doneAt | null}` (ms; running has `endsAt`, paused `remaining`). Actions: `pause`, `resume`, `add` (+1 min, to `duration` too), `cancel`, `dismiss`. At most 24 h. A finished timer stays (red) until dismissed, or 10 min. Kept in the app setting `timers` (saved 2 s after a change) and rescheduled at app start; one that ran out while the app was stopped finishes then and fires the card only if it ended at most 5 min ago.
- `GET /state?instance=`, `POST /start {instance, minutes, label}`, `POST /action {instance, id, action}`, each answering `{instance, timers, now}`; realtime `timers:state` with the same after every change (the widget keeps its own instance's). Refetch every 5 min and when the page becomes visible (a tablet waking up). Diagnostics' `timers`: counts only.
- The widget corrects for the Homey's clock (`now`). It applies a start or action at once (a `local-…` timer until the answer comes); a failed start brings the presets back, a failed action restores the timer (unless something replaced it), and the row shakes with `Could not change the timer.` Actions on a `local-…` timer queue until `/start` answers with its id.
- A row: the round button (pause, play or a ringing bell), the name (else the duration: `10 min`, `1 h 30 min`, `30 s`) over `Ends 18:48` / `Paused` / `Done`, the time left (tabular; `formatRemaining()` rounds up), then `+1` (hidden below 280 px) and `✕`. The row fills from the left with the time left (grey while paused); a finished one is red and pulses. A tap on the row pauses, resumes or dismisses; the buttons' `onTap` stops propagation, touchstart included.
- `sound` (on): three 880 Hz beeps every 2 s for a minute through Web Audio, unlocked by the first tap on the widget (a WebView only plays sound after a touch). Haptics on every tap and when a timer finishes. Not yet tried in the phone apps.
- Colour style (`colorStyle`, Default/Deep; CLAUDE.md *Widget styling*, `kit.css`): first, with `color` (a running timer and the presets' play icons, blue by default; `--tm-color` is `--wk-c`, the button's icon `--tm-on`). Deep: the time left in the shade and the rest of the row 55 % darker (paler on yellow), with `--wk-on` text and translucent buttons; a finished timer pulses between the red shade and a darker red (`tm-ring-deep`).
