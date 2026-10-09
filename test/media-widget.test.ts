// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('media'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const cap = (value: unknown, setable = true) => ({ value, setable });
function speaker(caps: object = {}) {
  return {
    id: 'k', name: 'Kitchen', icon: null, art: null,
    caps: {
      speaker_playing: cap(true),
      speaker_track: cap('Hey Jude', false),
      speaker_artist: cap('The Beatles', false),
      speaker_album: cap('1', false),
      speaker_position: cap(30, false),
      speaker_duration: cap(240, false),
      speaker_prev: cap(null),
      speaker_next: cap(null),
      speaker_shuffle: cap(false),
      speaker_repeat: { value: 'none', setable: true, values: [{ id: 'none' }, { id: 'track' }, { id: 'playlist' }] },
      volume_set: cap(0.3),
      volume_mute: cap(false),
      ...caps,
    },
  };
}

function widget(device: any = speaker(), opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSet = vi.fn(async (_id: string, _value: unknown) => {});
  const onButton = vi.fn(async (_id: string) => {});
  const w = win.createMediaWidget(root, { onSet, onButton, ...opts });
  w.setState(device);
  const q = (sel: string) => root.querySelector<HTMLElement>(sel)!;
  const click = (sel: string) => q(sel).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  return { w, root, q, click, onSet, onButton };
}

describe('mediaSource', () => {
  const caps = (track: unknown, input?: string) => ({ speaker_track: { value: track }, ...(input ? { sonos_sound_input: { value: input } } : {}) });
  it('reads TV and line-in from the track, else from the Sonos input', () => {
    expect(win.mediaSource(caps('HDMI'))).toBe('tv');
    expect(win.mediaSource(caps('TV/HDMI'))).toBe('tv');
    expect(win.mediaSource(caps('Line-In'))).toBe('lineIn');
    expect(win.mediaSource(caps('Hey Jude'))).toBeNull();
    expect(win.mediaSource(caps(null, 'TV'))).toBe('tv');
    // A soundbar streaming music may still report its HDMI input: the track wins.
    expect(win.mediaSource(caps('Hey Jude', 'HDMI'))).toBeNull();
  });
});

describe('mediaButtonsFromSettings', () => {
  it('takes the picked buttons with their names, skipping empty ones', () => {
    expect(win.mediaButtonsFromSettings({
      button1: { id: 'card:homey:device:k:tv', name: 'Set source to TV' },
      button1Name: 'TV',
      button2: { id: 'none', name: 'None' },
      button3: { id: 'flow:f1', name: 'Movie time' },
      button3Name: '  ',
    })).toEqual([{ id: 'card:homey:device:k:tv', name: 'TV' }, { id: 'flow:f1', name: 'Movie time' }]);
  });
});

describe('render', () => {
  it('shows the speaker, the track, the progress and the volume', () => {
    const { q } = widget();
    expect(q('.mw-name').textContent).toBe('Kitchen');
    expect(q('.mw-title').textContent).toBe('Hey Jude');
    expect(q('.mw-sub').textContent).toBe('The Beatles · 1');
    expect(q('.mw-progress-text').textContent).toBe('0:30 / 4:00');
    expect(q('.mw-bar').getAttribute('aria-valuenow')).toBe('30');
    expect(q('.mw-volume-text')).toBeNull();
    expect(q('.mw-play').getAttribute('aria-label')).toBe('Pause');
  });

  it('leaves out the progress bar and time with showProgress off', () => {
    const { q } = widget(speaker(), { showProgress: false });
    expect(q('.mw-progress').style.display).toBe('none');
    expect(q('.mw-progress-text').style.display).toBe('none');
  });

  it('counts the position on while playing', () => {
    const { q } = widget();
    vi.advanceTimersByTime(5000);
    expect(q('.mw-progress-text').textContent).toBe('0:35 / 4:00');
  });

  it('says TV instead of greying out, with the transport stepped back and mute still there', () => {
    const { root, q } = widget(speaker({ speaker_track: cap('HDMI', false), volume_mute: cap(true) }));
    expect(q('.mw-title').textContent).toBe('TV');
    expect(q('.mw-sub').textContent).toBe('Muted');
    expect(root.classList.contains('mw-external')).toBe(true);
    expect(q('.mw-art').classList.contains('external')).toBe(true);
    expect(q('.mw-progress').style.display).toBe('none');
    expect(q('.mw-mute').classList.contains('on')).toBe(true);
  });

  it('says nothing is playing without a track', () => {
    const { q } = widget(speaker({ speaker_track: cap(null, false), speaker_playing: cap(false) }));
    expect(q('.mw-title').textContent).toBe('Nothing playing');
  });

  it('shows a missing speaker', () => {
    const { q } = widget({ id: 'k', missing: true });
    expect(q('.mw-title').textContent).toBe('Speaker not found');
    expect(q('.mw-controls').style.display).toBe('none');
  });
});

describe('controls', () => {
  it('toggles play and mute at once, then sends', () => {
    const { q, click, onSet } = widget();
    click('.mw-play');
    expect(onSet).toHaveBeenCalledWith('speaker_playing', false);
    expect(q('.mw-play').getAttribute('aria-label')).toBe('Play');
    click('.mw-mute');
    expect(onSet).toHaveBeenCalledWith('volume_mute', true);
    expect(q('.mw-mute').classList.contains('on')).toBe(true);
  });

  it('sends next and previous', () => {
    const { click, onSet } = widget();
    click('[data-control="next"]');
    click('[data-control="previous"]');
    expect(onSet.mock.calls).toEqual([['speaker_next', true], ['speaker_prev', true]]);
  });

  it('does nothing with play on TV', () => {
    const { click, onSet } = widget(speaker({ speaker_track: cap('HDMI', false) }));
    click('.mw-play');
    expect(onSet).not.toHaveBeenCalled();
  });
});

describe('volume', () => {
  it('moves the number on every tap and sends a burst once', async () => {
    const { q, onSet } = widget(speaker(), { volumeStep: 0.05 });
    const up = q('.mw-step[aria-label="Volume up"]');
    for (let i = 0; i < 3; i++) up.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(q('.mw-bar').getAttribute('aria-valuenow')).toBe('45');
    expect(onSet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(450);
    expect(onSet.mock.calls).toEqual([['volume_set', 0.45]]);
  });

  it('keeps the burst on screen while older reports arrive, until the value sent is reported', async () => {
    const { w, q } = widget(speaker(), { volumeStep: 0.05 });
    const up = q('.mw-step[aria-label="Volume up"]');
    up.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    up.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    w.pushChange({ capabilityId: 'volume_set', value: 0.35 }); // a report of an earlier step
    expect(q('.mw-bar').getAttribute('aria-valuenow')).toBe('40');
    await vi.advanceTimersByTimeAsync(450);
    w.pushChange({ capabilityId: 'volume_set', value: 0.35 });
    expect(q('.mw-bar').getAttribute('aria-valuenow')).toBe('40');
    w.pushChange({ capabilityId: 'volume_set', value: 0.4 });
    // Changed elsewhere afterwards: shown as reported.
    vi.advanceTimersByTime(5000);
    w.pushChange({ capabilityId: 'volume_set', value: 0.1 });
    expect(q('.mw-bar').getAttribute('aria-valuenow')).toBe('10');
  });

  it('stops at the maximum volume', async () => {
    const { q, onSet } = widget(speaker({ volume_set: cap(0.38) }), { volumeStep: 0.05, maxVolume: 0.4 });
    const up = q('.mw-step[aria-label="Volume up"]');
    up.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(q('.mw-bar').getAttribute('aria-valuenow')).toBe('40');
    expect((up as HTMLButtonElement).disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(450);
    expect(onSet.mock.calls).toEqual([['volume_set', 0.4]]);
  });

  it('snaps a step to round numbers', () => {
    const { q } = widget(speaker({ volume_set: cap(0.23) }), { volumeStep: 0.05 });
    q('.mw-step[aria-label="Volume down"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(q('.mw-bar').getAttribute('aria-valuenow')).toBe('20');
  });

  it('unmutes when the volume changes', async () => {
    const { q, onSet } = widget(speaker({ volume_mute: cap(true) }));
    q('.mw-step[aria-label="Volume up"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(onSet).toHaveBeenCalledWith('volume_mute', false);
  });

  it('sets the volume where the bar is tapped, scaled to the maximum', async () => {
    const { q, onSet } = widget(speaker(), { maxVolume: 0.5 });
    const bar = q('.mw-bar');
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 36, right: 100, bottom: 36 }) as DOMRect;
    const ev = (type: string) => new win.PointerEvent(type, { pointerType: 'mouse', clientX: 50, bubbles: true });
    bar.dispatchEvent(ev('pointerdown'));
    bar.dispatchEvent(ev('pointerup'));
    await vi.advanceTimersByTimeAsync(10);
    expect(onSet.mock.calls).toEqual([['volume_set', 0.25]]);
  });
});

describe('volume as buttons', () => {
  it('puts − mute + in the transport row, with no bar or volume line', async () => {
    const { root, q, onSet } = widget(speaker(), { volumeLayout: 'buttons', volumeStep: 0.05 });
    expect(root.querySelector('.mw-volume')).toBeNull();
    const row = [...q('.mw-controls').querySelectorAll('.mw-btn')].map(b => b.getAttribute('aria-label'));
    expect(row).toEqual(['Previous', 'Pause', 'Next', 'Volume down', 'Mute', 'Volume up']);
    expect(q('.mw-mute').classList.contains('ring')).toBe(true);
    expect(root.style.getPropertyValue('--mw-x')).toBe('0.3');
    q('.mw-step[aria-label="Volume up"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(450);
    expect(onSet.mock.calls).toEqual([['volume_set', 0.35]]);
  });

  it('moves shuffle and repeat into the overlay', () => {
    const { root, q, onSet } = widget(speaker(), { volumeLayout: 'buttons', showShuffle: true });
    expect(q('.mw-controls').querySelector('[data-control="shuffle"]')).toBeNull();
    expect(q('.mw-more').style.display).toBe('');
    root.querySelector<HTMLElement>('.mw-panel [data-control="shuffle"]')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(onSet).toHaveBeenCalledWith('speaker_shuffle', true);
  });

  it('keeps shuffle and repeat in the row with the volume line', () => {
    const { q } = widget(speaker(), { showShuffle: true });
    expect(q('.mw-controls').querySelector('[data-control="shuffle"]')).toBeTruthy();
    expect(q('.mw-more').style.display).toBe('none');
  });
});

describe('buttons', () => {
  const buttons = [{ id: 'card:homey:device:k:tv', name: 'TV' }, { id: 'flow:f1', name: 'Movie time' }];

  it('keeps the buttons in an overlay that ⋯ opens', () => {
    const { q, click } = widget(speaker(), { buttons });
    expect(q('.mw-card').classList.contains('panel-open')).toBe(false);
    click('.mw-more');
    expect(q('.mw-card').classList.contains('panel-open')).toBe(true);
    expect(q('.mw-more').getAttribute('aria-expanded')).toBe('true');
    click('.mw-close');
    expect(q('.mw-card').classList.contains('panel-open')).toBe(false);
  });

  it('closes the overlay after a tap beside the buttons, or after a while', () => {
    const { q, click } = widget(speaker(), { buttons });
    click('.mw-more');
    click('.mw-panel');
    expect(q('.mw-card').classList.contains('panel-open')).toBe(false);
    click('.mw-more');
    vi.advanceTimersByTime(8100);
    expect(q('.mw-card').classList.contains('panel-open')).toBe(false);
  });

  it('hides ⋯ without buttons', () => {
    const { q } = widget(speaker());
    expect(q('.mw-more').style.display).toBe('none');
  });

  it('runs a button, closes the overlay and lights the TV one (and ⋯) while the speaker plays from it', async () => {
    const { root, q, click, onButton, w } = widget(speaker(), { buttons });
    click('.mw-more');
    const chips = root.querySelectorAll<HTMLElement>('.mw-chip');
    expect([...chips].map(c => c.textContent)).toEqual(['TV', 'Movie time']);
    chips[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(onButton).toHaveBeenCalledWith('card:homey:device:k:tv');
    expect(q('.mw-card').classList.contains('panel-open')).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(chips[0].classList.contains('done')).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(q('.mw-card').classList.contains('panel-open')).toBe(false);
    w.pushChange({ capabilityId: 'speaker_track', value: 'HDMI' });
    expect(chips[0].classList.contains('on')).toBe(true);
    expect(chips[1].classList.contains('on')).toBe(false);
    expect(q('.mw-more').classList.contains('on')).toBe(true);
  });

  it('says what to do without a usable API key', async () => {
    const onButton = vi.fn(async () => { throw Object.assign(new Error('keyScope'), { reason: 'keyScope' }); });
    const { root, q } = widget(speaker(), { buttons, onButton });
    root.querySelector<HTMLElement>('.mw-chip')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect(q('.mw-message').textContent).toMatch(/permission to manage flows/);
  });
});

describe('album art', () => {
  it('loads the art with a cache buster that changes with the track', async () => {
    const { w, q } = widget(speaker(), {});
    w.pushArt({ url: '/api/image/a', lastUpdated: 1 });
    const first = q('.mw-art').querySelector('.mw-art-img') as HTMLElement;
    // happy-dom doesn't load images: the swap happens once decoded, so check what is requested instead.
    const created: string[] = [];
    const Img = win.Image;
    win.Image = class extends Img { set src(v: string) { created.push(v); } };
    w.pushChange({ capabilityId: 'speaker_track', value: 'Let It Be' });
    win.Image = Img;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatch(/^\/api\/image\/a\?t=/);
    expect(first).toBeTruthy();
  });

  it('shows the TV glyph, not stale art, on TV', () => {
    const { q, w } = widget(speaker({ speaker_track: cap('HDMI', false) }));
    w.pushArt({ url: '/api/image/a', lastUpdated: 1 });
    expect(q('.mw-art').classList.contains('has-art')).toBe(false);
    expect(q('.mw-art').classList.contains('external')).toBe(true);
  });
});

describe('switching speaker', () => {
  const list = [
    { id: 'b', name: 'Bedroom', icon: null, zone: 'Upstairs', caps: { speaker_playing: { value: true }, speaker_track: { value: 'Let It Be' }, speaker_artist: { value: 'The Beatles' } } },
    { id: 'k', name: 'Kitchen', icon: 'data:image/svg+xml;base64,PHN2Zy8+', zone: 'Kitchen', caps: {} },
    { id: 't', name: 'TV', icon: null, zone: 'Living room', caps: { speaker_track: { value: 'HDMI' } } },
  ];
  const switching = (extra: object = {}) => {
    const onSwitch = vi.fn();
    const onListSpeakers = vi.fn(async () => list);
    return { ...widget(speaker(), { canSwitch: true, onSwitch, onListSpeakers, ...extra }), onSwitch, onListSpeakers };
  };

  it('opens the list from the speaker’s name, with what each one plays', async () => {
    const { q, click, onListSpeakers } = switching();
    expect(q('.mw-who').tagName).toBe('BUTTON');
    click('.mw-who');
    expect(q('.mw-card').classList.contains('speakers-open')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onListSpeakers).toHaveBeenCalled();
    const rows = [...document.querySelectorAll('.mw-spk')];
    expect(rows.map(r => r.querySelector('.mw-spk-name')!.textContent)).toEqual(['Bedroom', 'Kitchen', 'TV']);
    expect(rows.map(r => r.querySelector('.mw-spk-sub')?.textContent)).toEqual(['Let It Be · The Beatles', 'Kitchen', 'TV']);
    expect(rows[1].classList.contains('current')).toBe(true);
    expect(rows[1].querySelector('.mw-mask')).toBeTruthy();
  });

  it('switches when another speaker is picked, and only closes for the current one', async () => {
    const { q, click, onSwitch } = switching();
    click('.mw-who');
    await vi.advanceTimersByTimeAsync(0);
    document.querySelectorAll<HTMLElement>('.mw-spk')[1].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(onSwitch).not.toHaveBeenCalled();
    expect(q('.mw-card').classList.contains('speakers-open')).toBe(false);
    click('.mw-who');
    await vi.advanceTimersByTimeAsync(0);
    document.querySelectorAll<HTMLElement>('.mw-spk')[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(onSwitch).toHaveBeenCalledWith('b');
    expect(q('.mw-card').classList.contains('speakers-open')).toBe(false);
  });

  it('drops a volume burst meant for the previous speaker', async () => {
    const { w, q, onSet } = switching({ volumeStep: 0.05 });
    q('.mw-step[aria-label="Volume up"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    w.setState({ ...speaker(), id: 'b', name: 'Bedroom' });
    await vi.advanceTimersByTimeAsync(450);
    expect(onSet).not.toHaveBeenCalled();
    expect(q('.mw-name').textContent).toBe('Bedroom');
  });

  it('is a plain label without switching', () => {
    const { q } = widget();
    expect(q('.mw-who').tagName).toBe('DIV');
    expect(q('.mw-chevron')).toBeNull();
  });

  it('hides the card buttons a switched-to speaker doesn’t have', () => {
    const buttons = [{ id: 'card:homey:device:k:cloud_play_home_theater', name: 'TV' }, { id: 'flow:f1', name: 'Movie time' }];
    const { w, root } = widget(speaker(), { buttons });
    const chips = () => [...root.querySelectorAll<HTMLElement>('.mw-chip')].map(c => c.style.display);
    expect(chips()).toEqual(['', '']);
    w.setState({ ...speaker(), id: 'b', cards: ['cloud_leave_current_group'] });
    expect(chips()).toEqual(['none', '']);
    w.setState({ ...speaker(), id: 'a', cards: ['cloud_play_home_theater'] });
    expect(chips()).toEqual(['', '']);
  });

  it('shows the device icon in place of missing album art', () => {
    const { q } = widget({ ...speaker(), icon: 'data:image/svg+xml;base64,PHN2Zy8+' });
    expect(q('.mw-art .mw-art-glyph').classList.contains('mw-mask')).toBe(true);
    expect(q('.mw-who .mw-who-icon').classList.contains('mw-mask')).toBe(true);
  });
});
