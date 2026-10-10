// Renders the app store PNGs (the hero photo, cropped to 10:7) from dev/app-images.html with headless Edge.
// Usage: `npm run app-images` (set EDGE to the browser path if it isn't the default).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { edge } from './headless.mjs';

const page = pathToFileURL(resolve('dev/app-images.html')).href;
const OUT = {
  'assets/images/small.png': [250, 175],
  'assets/images/large.png': [500, 350],
  'assets/images/xlarge.png': [1000, 700],
};

for (const [out, [w, h]] of Object.entries(OUT)) {
  edge(['--force-device-scale-factor=1', `--window-size=${w},${h}`, `--screenshot=${resolve(out)}`, page], { virtualTime: null });
  console.log('wrote', out);
}
