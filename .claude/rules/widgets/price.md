---
paths:
  - "widgets/price/**"
  - "test/price-*.test.ts"
  - "dev/price-preview.html"
---
# Energy Price Strip widget (`price`)

- The price now and the coming hours as bars in one transparent tile (Device Values' fill, radius and rim; 68 px). Direction "B" of seven shown to the user (2026-10-10; the mockups were `temp/price-directions.html`); it replaced three label-over-value cells the user disliked. No service: `GET /price` returns `app.electricity.getSnapshot(null)`'s `{prices, quarters, fixedPrice, currency, language}`, so the prices, their cache and the fixed-price check are the Electricity Overview's, and no meter is tracked.
- Left (`.pb-now`): the level word after a lightning bolt (the level colour; muted with a fixed price or `tint` off) over the price and unit.
- Right (`.pb-chart`): a bar per hour from the current one (`hours`: 12 default, 24, 36; made once). Heights 20–100 % of the window's range (60 % when flat); each bar's level is in its own local day (`dayPrices()`, so tomorrow is coloured against tomorrow), mixed 50 % into the tile, the current one full. A dot over the cheapest (`lowestSlot(slots, i, hours - 1)`, the electricity footer's; none when flat). An hour without a price is a stub (`.none`), so the time scale stays fixed. The axis: `Now`, then hours every 3/6/12 h (`TICK_STEP`), midnight as the short weekday.
- 36 hours: `/price?hours=36` → `getSnapshot(null, {futureHours: 36})`, 61 slots (index 24 still the current hour; clamped to 24…36). The day after tomorrow's failure is only debug-logged.
- Level (`priceLevel()`, `window.electricityPriceLevel`): within a local day, the lowest third of the range is `low`, the highest `high`, the rest (and a flat day) `medium`. `data-level` on `.pb-tile` and each bar sets `--pb-level` (Homey's green and red, yellow `#F5C518`); `tint` off (`.no-tint`, "Colour by price level"; the id is from the old tile tint) makes every bar blue.
- Settings: `hours`, `priceCosts`, `tint` (on); the old `showNext`/`nextLow` are ignored. A fixed price shows only `Fixed price` and the price. Without a price for the current hour: `No electricity prices. Set them up in Homey Energy.` (the Electricity Overview stays silent, but here the price is all it shows). A failed read isn't that: `priceError` (today's prices threw) makes `/price` fail, so the widget shows its error, or keeps the last prices on a refresh.
- 15-minute prices: the price and level now are the current quarter's, with a bar per quarter (the user's choice: 48/96/144; `ensureBars()` remakes them when the count changes; `data-quarters`: 1 px gaps at 12 h, none from 24 h), axis labels on whole hours only.
- The current slot is found by time (`slotAt()`); it re-renders when the slot ends and refetches every 5 min. `opts.now` replaces the clock.
- Colour style (`colorStyle`, Default/Deep; CLAUDE.md *Widget styling*, `kit.css`): after `tint`. Deep: the bars in the shades at full strength (low green-700, medium yellow, high red-600, no tint blue-600), the current hour in today's bright colour; the label is unchanged.
