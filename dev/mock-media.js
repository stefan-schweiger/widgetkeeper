/*
 * Mock speakers for the Media widget's dev preview and the README screenshot: drawn album covers (SVG, so no
 * real album art goes in the repo), made-up tracks and a simulated speaker that answers the widget's changes.
 */
(function () {
  'use strict';

  /** Drawn covers: gradients and shapes, nothing real. */
  const COVERS = [
    ['#FFB054', '#E2457A', '#5B3FD9', '#1E1446'],
    ['#7BE0C3', '#2F8DF6', '#173A6B', '#0B1630'],
    ['#F5C518', '#F2761E', '#8A2B12', '#2A0E06'],
  ];
  function cover(i) {
    const [a, b, c, d] = COVERS[i % COVERS.length];
    return 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${d}"/></linearGradient>
      <radialGradient id="r1" cx=".3" cy=".3" r=".5"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
      <radialGradient id="r2" cx=".75" cy=".7" r=".55"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient></defs>
      <rect width="120" height="120" fill="url(#g)"/><rect width="120" height="120" fill="url(#r1)"/><rect width="120" height="120" fill="url(#r2)"/>
      <circle cx="60" cy="60" r="22" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3"/></svg>`);
  }

  const TRACKS = [
    ['Northern Lights', 'The Harbour Kites', 'Low Tide'],
    ['Paper Boats', 'Mira Holm', 'Small Hours'],
    ['Summer Static', 'Velvet Antennas', 'Long Wave'],
  ];

  const cap = (value, setable = true) => ({ value, setable });

  /**
   * A speaker as `/state` returns it. `o.track` null: nothing playing; `'HDMI'`: the TV.
   * @param {string} name @param {number} i @param {object} [o]
   */
  function mockSpeaker(name, i, o = {}) {
    const [track, artist, album] = TRACKS[i % TRACKS.length];
    const t = o.track === undefined ? track : o.track;
    const external = t === 'HDMI';
    const icons = window.ICONS || {};
    return {
      id: `speaker-${i}-${name}`, name, icon: (external ? icons.tv : icons.speaker) || null,
      art: o.art === false || !t ? null : { url: cover(i), lastUpdated: 1 },
      caps: {
        speaker_playing: cap(o.playing !== false),
        speaker_track: cap(t, false),
        speaker_artist: cap(t && !external ? artist : null, false),
        speaker_album: cap(t && !external ? album : null, false),
        speaker_position: cap(t && !external ? 74 : 0, false),
        speaker_duration: cap(t && !external ? 213 : null, false),
        speaker_prev: cap(null),
        speaker_next: cap(null),
        speaker_shuffle: cap(true),
        speaker_repeat: { value: 'playlist', setable: true, values: [{ id: 'none' }, { id: 'track' }, { id: 'playlist' }] },
        volume_set: cap(o.volume != null ? o.volume : 0.35),
        volume_mute: cap(o.muted === true),
      },
    };
  }

  /** The made-up house's speakers, for the switcher: [name, track index, options]. */
  const HOUSE = [['Bathroom', 0, { track: null, playing: false }], ['Kitchen', 0], ['Living room', 1, { playing: false }], ['TV', 2, { track: 'HDMI' }]];

  /** The switcher's list, as `/speakers` returns it. */
  function mockSpeakerList() {
    return HOUSE.map(([name, i, o]) => {
      const sp = mockSpeaker(name, i, o);
      const pick = ['speaker_playing', 'speaker_track', 'speaker_artist'];
      return { id: sp.id, name, icon: sp.icon, zone: name === 'TV' ? 'Living room' : name, caps: Object.fromEntries(pick.map(k => [k, { value: sp.caps[k].value }])) };
    });
  }

  /**
   * Mounts a widget on a simulated speaker: changes come back as reports after 300 ms; next/prev change the track.
   * With `canSwitch` the switcher lists the made-up house's speakers.
   */
  function mountMockMedia(root, speaker, opts = {}) {
    let w;
    let n = 0;
    const report = (capabilityId, value) => w.pushChange({ deviceId: speaker.id, capabilityId, value });
    const onSet = (capabilityId, value) => new Promise(resolve => setTimeout(() => {
      if (capabilityId === 'speaker_next' || capabilityId === 'speaker_prev') {
        n += capabilityId === 'speaker_next' ? 1 : TRACKS.length - 1;
        const [track, artist, album] = TRACKS[n % TRACKS.length];
        report('speaker_track', track);
        report('speaker_artist', artist);
        report('speaker_album', album);
        report('speaker_position', 0);
        w.pushArt({ url: cover(n), lastUpdated: Date.now() });
      } else {
        report(capabilityId, value);
      }
      resolve();
    }, 300));
    const onButton = id => new Promise(resolve => setTimeout(() => {
      if (id === 'card:tv') { report('speaker_track', 'HDMI'); w.pushArt(null); }
      if (id === 'card:line') report('speaker_track', 'Line-In');
      resolve();
    }, 500));
    const onListSpeakers = () => new Promise(resolve => setTimeout(() => resolve(mockSpeakerList()), 200));
    const onSwitch = (id) => {
      const found = HOUSE.find(([name, i, o]) => mockSpeaker(name, i, o).id === id);
      if (found) setTimeout(() => w.setState(mockSpeaker(...found)), 300);
    };
    w = createMediaWidget(root, { onSet, onButton, onListSpeakers, onSwitch, ...opts });
    w.setState(speaker);
    return w;
  }

  window.mockSpeaker = mockSpeaker;
  window.mountMockMedia = mountMockMedia;
  window.mockSpeakerList = mockSpeakerList;
})();
