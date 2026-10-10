// The showcase's fixed clock: Tuesday 6 October 2026, 18:40 local time, still ticking from there so the widgets'
// timers behave. Loaded first (before showcase-data.js builds its data) by showcase.html, screenshots.html and
// clips.html, so every render is the same.
(() => {
  const Real = Date;
  const offset = new Real(2026, 9, 6, 18, 40, 0).getTime() - Real.now();
  class FixedDate extends Real {
    constructor(...args) { if (args.length) super(...args); else super(Real.now() + offset); }
    static now() { return Real.now() + offset; }
  }
  window.Date = FixedDate;
})();
