// Mock cameras for the dev previews and screenshots: flat 16:9 SVG scenes (no real camera images in the repo),
// each with a camera-style timestamp. `mockCameras()` returns the widget's /state for six cameras;
// `mockCameraScene()` draws one with another timestamp (dev/showcase-data.js).
(function () {
  const W = 640, H = 360;
  const stamp = text => `<text x="14" y="26" font-family="monospace" font-size="15" fill="#fff" opacity=".85">${text}</text>`;
  // `dusk` darkens the scene with a blue evening light.
  const scene = (body, text = '2026-10-04 14:32:08', dusk = 0) => 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${body}${dusk ? `<rect width="640" height="360" fill="#141B33" opacity="${dusk}"/>` : ''}${stamp(text)}</svg>`);
  const BODIES = {};

  const DRIVEWAY = scene(BODIES.DRIVEWAY = `
    <rect width="640" height="360" fill="#9FB8C9"/><rect y="150" width="640" height="210" fill="#6E7F5A"/>
    <path d="M250 360 L330 150 L380 150 L560 360Z" fill="#8C8A85"/>
    <rect x="40" y="70" width="190" height="120" fill="#B9A58A"/><path d="M30 75 L135 20 L240 75Z" fill="#6B4E3D"/>
    <rect x="80" y="120" width="60" height="70" fill="#5B5550"/><rect x="160" y="105" width="45" height="35" fill="#D9E4EA"/>
    <rect x="390" y="230" width="150" height="62" rx="14" fill="#33465C"/><rect x="410" y="205" width="100" height="40" rx="12" fill="#3E5670"/>
    <circle cx="420" cy="292" r="15" fill="#222"/><circle cx="510" cy="292" r="15" fill="#222"/>
    <circle cx="600" cy="120" r="55" fill="#4F6B3E"/><rect x="594" y="160" width="12" height="40" fill="#5A4636"/>`);
  const GARDEN = scene(BODIES.GARDEN = `
    <rect width="640" height="360" fill="#B7CEDB"/><rect y="170" width="640" height="190" fill="#7A9A55"/>
    <circle cx="120" cy="130" r="80" fill="#4E7340"/><rect x="112" y="190" width="16" height="50" fill="#5A4636"/>
    <circle cx="520" cy="110" r="95" fill="#5C8048"/><rect x="510" y="190" width="18" height="60" fill="#5A4636"/>
    <rect x="250" y="210" width="150" height="10" fill="#8A6F55"/><rect x="262" y="220" width="8" height="40" fill="#8A6F55"/><rect x="380" y="220" width="8" height="40" fill="#8A6F55"/>
    <path d="M0 330 Q160 300 320 330 T640 320 L640 360 L0 360Z" fill="#68884A"/>
    <circle cx="200" cy="300" r="10" fill="#E3B54C"/><circle cx="225" cy="310" r="8" fill="#D9675B"/><circle cx="450" cy="305" r="9" fill="#E3B54C"/>`);
  const FRONT_DOOR = scene(BODIES.FRONT_DOOR = `
    <rect width="640" height="360" fill="#C9C1B4"/><rect x="0" y="300" width="640" height="60" fill="#8F8B84"/>
    <rect x="240" y="60" width="160" height="240" fill="#2F4A3F"/><rect x="255" y="75" width="130" height="95" fill="#3A5A4D"/>
    <rect x="255" y="185" width="130" height="100" fill="#3A5A4D"/><circle cx="375" cy="190" r="7" fill="#C9A44A"/>
    <rect x="80" y="90" width="110" height="130" fill="#DCE6EC"/><rect x="450" y="90" width="110" height="130" fill="#DCE6EC"/>
    <rect x="270" y="315" width="100" height="30" rx="4" fill="#6B5A47"/>
    <rect x="430" y="250" width="44" height="54" rx="6" fill="#A0663F"/><circle cx="452" cy="230" r="24" fill="#5C8048"/>`);
  const LIVING_ROOM = scene(BODIES.LIVING_ROOM = `
    <rect width="640" height="360" fill="#D8D0C4"/><rect y="250" width="640" height="110" fill="#A88B6C"/>
    <rect x="380" y="60" width="200" height="140" fill="#9CB8CC"/><path d="M380 60h200v140H380z" fill="none" stroke="#F2EEE8" stroke-width="8"/>
    <rect x="60" y="170" width="250" height="90" rx="18" fill="#56677A"/><rect x="60" y="140" width="250" height="55" rx="18" fill="#62758A"/>
    <rect x="340" y="265" width="160" height="14" rx="4" fill="#7A5E44"/><rect x="350" y="279" width="10" height="40" fill="#7A5E44"/><rect x="480" y="279" width="10" height="40" fill="#7A5E44"/>
    <rect x="560" y="200" width="40" height="70" rx="6" fill="#B07A50"/><circle cx="580" cy="180" r="30" fill="#5E8350"/>
    <rect x="120" y="60" width="120" height="70" fill="#C99B6A"/>`);
  const SHED = scene(BODIES.SHED = `
    <rect width="640" height="360" fill="#A9C1CF"/><rect y="200" width="640" height="160" fill="#6F8B52"/>
    <rect x="200" y="90" width="260" height="170" fill="#8E5B3C"/><path d="M185 95 L330 30 L475 95Z" fill="#4A3A33"/>
    <rect x="290" y="150" width="80" height="110" fill="#6E4630"/><rect x="220" y="130" width="50" height="40" fill="#CFDDE5"/>
    <path d="M0 260 h640" stroke="#7D6A57" stroke-width="6"/><path d="M40 230v60M120 230v60M520 230v60M600 230v60" stroke="#7D6A57" stroke-width="8"/>
    <circle cx="80" cy="120" r="60" fill="#4E7340"/>`);
  const NIGHT = scene(BODIES.NIGHT = `
    <rect width="640" height="360" fill="#2E3238"/><rect y="220" width="640" height="140" fill="#3A3F45"/>
    <rect x="80" y="90" width="220" height="150" fill="#464C53"/><rect x="120" y="140" width="60" height="100" fill="#3A3F45"/>
    <rect x="220" y="130" width="50" height="40" fill="#C9B77A" opacity=".6"/>
    <path d="M360 360 L420 220 L470 220 L600 360Z" fill="#50565D"/>
    <circle cx="560" cy="120" r="70" fill="#3C4A3A"/>`);

  const svg = body => 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`);
  const CAMERA = svg('<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3"/>');

  const cam = (id, name, image, video = true) => ({
    id, name, icon: CAMERA,
    image: image ? { id: `img-${id}`, url: image, lastUpdated: 0 } : null,
    video: video ? `vid-${id}` : null,
  });

  window.mockCameras = () => [
    cam('drive', 'Driveway', DRIVEWAY),
    cam('door', 'Front door', FRONT_DOOR),
    cam('garden', 'Garden', GARDEN),
    cam('living', 'Living room', LIVING_ROOM),
    cam('shed', 'Shed', SHED),
    cam('side', 'Side path', NIGHT, false),
  ];
  window.mockCameraScenes = { DRIVEWAY, GARDEN, FRONT_DOOR, LIVING_ROOM, SHED, NIGHT };
  /** One of the scenes (DRIVEWAY, GARDEN …) with its own timestamp and evening light (0–1). */
  window.mockCameraScene = (name, text, dusk = 0) => scene(BODIES[name], text, dusk);
})();
