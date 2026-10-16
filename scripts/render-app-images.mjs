// Renders the App Store images (assets/images/) from the widget previews, as dev/app-images.json lays them out.
// Usage: `npm run app-images`. `npm run previews` runs it too when it rendered a preview the images use.
import { renderAppImages } from './app-images.mjs';

for (const out of await renderAppImages()) console.log('wrote', out);
