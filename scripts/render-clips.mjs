// Records the README clips (docs/clips/<id>.webp): dev/clips.html?c=<id> in headless Edge, driven by real touch events
// through the DevTools protocol, captured as screenshots and joined into an animated WebP (sharp) that GitHub plays
// inline. Like the screenshots: Homey's dark mode, 358 px wide (a phone's widget), here at 2x, on a transparent page.
// Usage: `npm run clips [-- lights stack]` (set EDGE to the browser path if it isn't the default).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { downloadIcons, EDGE, freshProfile, HEADLESS } from './headless.mjs';

const page = pathToFileURL(resolve('dev/clips.html')).href;
const WIDTH = 358;
const SCALE = 2;
/** A clip that grows (`window.clip.grow`) is recorded this tall, then cropped to the tallest content of any frame. */
const GROW_HEIGHT = 900;
/** The longest a frame is held in the WebP; a capture that took longer is still one frame. */
const MAX_FRAME_MS = 200;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Each clip: what the finger does, step by step. `tap`/`drag` take a CSS selector and the match's index (`i`), and
 * points as fractions of its box (`x`, `y`, default the middle). `say` sets the callout under the widget (with an
 * `icon`: rotate, swipe, tap, drag, colour, bell, volume, next, mute, more, plus, pause, dots or speaker); `run` calls a page control.
 */
const CLIPS = {
  lights: [
    { say: 'Tap a light to turn it on or off', icon: 'tap' },
    { wait: 900 },
    { tap: '.lc-tile', i: 4, y: 0.3 },
    { wait: 1300 },
    { say: 'Drag the bar to dim it', icon: 'drag' },
    { wait: 700 },
    { drag: '.lc-bar', i: 0, from: { x: 0.55 }, to: { x: 0.12 }, ms: 1100 },
    { wait: 900 },
    { drag: '.lc-bar', i: 0, from: { x: 0.12 }, to: { x: 0.8 }, ms: 900 },
    { wait: 1100 },
    { say: 'The chip picks a colour or a white', icon: 'colour' },
    { wait: 700 },
    { tap: '.lc-chip', i: 1 },
    { wait: 1200 },
    { tap: '.lc-swatch', i: 4 },
    { wait: 1300 },
    { tap: '.lc-chip', i: 0 },
    { wait: 1100 },
    { tap: '.lc-swatch', i: 0 }, // the coolest white (a whites-only light), so the change shows
    { wait: 1800 },
  ],
  media: [
    { wait: 500 },
    { say: 'Tap + as often as you like: no overshoot', icon: 'volume' },
    { wait: 1100 },
    { tap: '.mw-step', i: 1 },
    { wait: 250 },
    { tap: '.mw-step', i: 1 },
    { wait: 250 },
    { tap: '.mw-step', i: 1 },
    { wait: 1500 },
    { say: 'Skip to the next track', icon: 'next' },
    { wait: 900 },
    { tap: '[data-control="next"]' },
    { wait: 1900 },
    { say: 'Mute with one tap', icon: 'mute' },
    { wait: 800 },
    { tap: '.mw-mute' },
    { wait: 1400 },
    { tap: '.mw-mute' },
    { wait: 1000 },
    { say: 'Buttons behind ⋯, like TV as the source', icon: 'more' },
    { wait: 900 },
    { tap: '.mw-more' },
    { wait: 1300 },
    { tap: '.mw-chip', i: 0 },
    { wait: 2600 },
    { say: 'Tap the name to switch speaker', icon: 'speaker' },
    { wait: 900 },
    { tap: '.mw-who' },
    { wait: 1700 },
    { tap: '.mw-spk', i: 1 },
    { wait: 2600 },
  ],
  timers: [
    { say: 'Tap a preset to start a timer', icon: 'tap' },
    { wait: 1000 },
    { tap: '.tm-preset', i: 1 },
    { wait: 2200 },
    { say: '+1 for a minute more', icon: 'plus' },
    { wait: 800 },
    { tap: '.tm-add' },
    { wait: 1600 },
    { say: 'Tap the timer to pause or resume it', icon: 'pause' },
    { wait: 800 },
    { tap: '.tm-row', x: 0.3 },
    { wait: 1800 },
    { tap: '.tm-row', x: 0.3 },
    { wait: 1400 },
    { say: 'When it runs out, it turns red and beeps', icon: 'bell' },
    { run: 'almostDone' },
    { wait: 6500 },
    { say: 'Tap to dismiss it', icon: 'tap' },
    { wait: 800 },
    { tap: '.tm-row', x: 0.3 },
    { wait: 1800 },
  ],
  sensordots: [
    { say: 'A dot lights up while a sensor is active', icon: 'dots' },
    { wait: 900 },
    { run: 'comeHome' },
    { wait: 5200 },
    { say: 'Tap a dot for its name and since when', icon: 'tap' },
    { wait: 900 },
    { tap: '.sd-cell', i: 3 },
    { wait: 2200 },
    { tap: '.sd-panel' },
    { wait: 700 },
    { tap: '.sd-cell', i: 8 },
    { wait: 2400 },
    { tap: '.sd-panel' },
    { wait: 1200 },
  ],
  stack: [
    { say: 'Turns on its own (every 30 s, sped up here)', icon: 'rotate' },
    { wait: 6600 },
    { say: 'Swipe, or tap a dot, to move by hand', icon: 'swipe' },
    { wait: 600 },
    // Headless Edge scrolls half as far as dispatched touch moves go, so the finger runs on past the left edge.
    { drag: '.sk-track', i: 0, from: { x: 0.97, y: 0.5 }, to: { x: -0.25, y: 0.5 }, ms: 600, hold: 30 },
    { wait: 1500 },
    { tap: '.sk-dot', i: 0 },
    { wait: 2600 },
    { say: 'Someone at the door: cameras come forward', icon: 'bell' },
    { wait: 900 },
    { run: 'doorbell' },
    { wait: 3500 },
  ],
};

// ---------------------------------------------------------------- Edge and the DevTools protocol

async function launch() {
  const profile = freshProfile();
  const proc = spawn(EDGE, [...HEADLESS, '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(`${msg.error.message}`)); else res(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    pending.set(++id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const close = () => { ws.close(); proc.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); };
  return { send, close };
}

/** Evaluates `expr` in the page (awaiting a promise) and returns its value. */
async function evaluate(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}

/** A point in an element's box: `x`/`y` as fractions (default the middle). */
async function pointIn(send, selector, i = 0, { x = 0.5, y = 0.5 } = {}) {
  const box = await evaluate(send, `(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${i}];
    if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  if (!box) throw new Error(`No ${selector} #${i}`);
  return { x: box.left + box.width * x, y: box.top + box.height * y };
}

const touch = (send, type, p) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y }] });

async function step(send, s) {
  if (s.wait) return sleep(s.wait);
  if (s.say) return evaluate(send, `window.clip.say(${JSON.stringify(s.say)}, ${JSON.stringify(s.icon || null)})`);
  if (s.run) return evaluate(send, `window.clip[${JSON.stringify(s.run)}]()`);
  // A value from the page, printed (for working out a clip's steps): `{ probe: 'expression' }`.
  if (s.probe) return console.log('probe', s.probe, '→', JSON.stringify(await evaluate(send, s.probe)));
  if (s.tap) {
    const p = await pointIn(send, s.tap, s.i, s);
    await touch(send, 'touchStart', p);
    await sleep(240); // long enough for the finger to show in a few frames (still well under a long press)
    return touch(send, 'touchEnd', p);
  }
  if (s.swipe) {
    // A native scroll by touch (the browser's own gesture: dispatched touch moves only scroll half as far at 2x).
    const a = await pointIn(send, s.swipe, s.i, s.from);
    const b = await pointIn(send, s.swipe, s.i, s.to);
    return send('Input.synthesizeScrollGesture', {
      x: a.x, y: a.y, xDistance: b.x - a.x, yDistance: b.y - a.y, gestureSourceType: 'touch', speed: s.speed ?? 600,
    });
  }
  if (s.drag) {
    const a = await pointIn(send, s.drag, s.i, s.from);
    const b = await pointIn(send, s.drag, s.i, s.to);
    await touch(send, 'touchStart', a);
    await sleep(120);
    const n = Math.max(6, Math.round(s.ms / 30));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      await touch(send, 'touchMove', { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      await sleep(s.ms / n);
    }
    await sleep(s.hold ?? 80); // a held finger: the page's scrolling catches up with the moves before the lift
    return touch(send, 'touchEnd', b);
  }
  throw new Error(`Unknown step ${JSON.stringify(s)}`);
}

// ---------------------------------------------------------------- recording

async function record(id) {
  const { send, close } = await launch();
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1200, deviceScaleFactor: 1, mobile: true }); // 1x: touch moves 1:1; the screenshots render at 2x (clip.scale)
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send('Page.navigate', { url: `${page}?c=${id}` });
    for (let i = 0; i < 100; i++) {
      if (await evaluate(send, 'document.readyState === "complete" && !!window.clipReady').catch(() => false)) break;
      await sleep(100);
    }
    const grow = await evaluate(send, 'window.clipReady.then(() => !!window.clip.grow)');
    let height = grow ? GROW_HEIGHT : await evaluate(send, 'window.clipReady');
    // A clip may be wider than a widget (the stack's backdrop around it).
    const width = (await evaluate(send, 'window.clip.width')) || WIDTH;
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1200, deviceScaleFactor: 1, mobile: true });

    // Screenshots as fast as they come, each with the time it was taken; the steps run meanwhile.
    const frames = [];
    let recording = true;
    const capture = (async () => {
      while (recording) {
        const at = Date.now();
        const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: SCALE } });
        frames.push({ at, png: Buffer.from(data, 'base64') });
      }
    })();
    for (const s of CLIPS[id]) await step(send, s);
    recording = false;
    await capture;

    if (grow) {
      // The lowest content row of any frame (the page is transparent below it).
      let bottom = 0;
      for (const f of frames) {
        const { info } = await sharp(f.png).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).toBuffer({ resolveWithObject: true });
        bottom = Math.max(bottom, -info.trimOffsetTop + info.height);
      }
      const h = Math.ceil(bottom / SCALE) * SCALE;
      for (const f of frames) f.png = await sharp(f.png).extract({ left: 0, top: 0, width: width * SCALE, height: h }).png().toBuffer();
      height = h / SCALE;
    }
    const delays = frames.map((f, i) => Math.min(MAX_FRAME_MS, Math.max(20, (frames[i + 1]?.at ?? f.at + 100) - f.at)));
    const out = `docs/clips/${id}.webp`;
    await sharp(frames.map(f => f.png), { join: { animated: true } })
      .webp({ loop: 0, delay: delays, quality: 80, effort: 6, smartSubsample: true })
      .toFile(out);
    const seconds = delays.reduce((a, b) => a + b, 0) / 1000;
    console.log('wrote', out, `(${frames.length} frames, ${seconds.toFixed(1)} s, ${width}×${height} @${SCALE}x)`);
  } finally {
    close();
  }
}

await downloadIcons();
mkdirSync('docs/clips', { recursive: true });
const only = process.argv.slice(2);
for (const id of Object.keys(CLIPS).filter(c => !only.length || only.includes(c))) await record(id);
process.exit(0);
