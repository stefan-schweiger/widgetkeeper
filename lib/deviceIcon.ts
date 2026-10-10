/** A path Homey serves (`/api/image/<id>`, `/api/icon/<id>`) as a URL the app can fetch; a full URL stays as it is. */
export async function homeyUrl(api: any, path: string): Promise<string> {
  return /^https?:/.test(path) ? path : `${await api.baseUrl}${path}`;
}

/** An image Homey keeps for a device (`device.images`: `{type, id, title, imageObj: {id, url, lastUpdated}}`). */
export type DeviceImage = { id: string, url: string, lastUpdated: number | null };

/** The device's first image of `type` (`camera` snapshots, `media` album art …); with `anyType`, else its first image. */
export function deviceImage(device: any, type: string, { anyType = false } = {}): DeviceImage | null {
  const images: any[] = Array.isArray(device?.images) ? device.images : [];
  const img = images.find(i => i?.type === type && i.imageObj?.url) || (anyType ? images.find(i => i?.imageObj?.url) : undefined);
  if (!img) return null;
  const o = img.imageObj;
  return { id: o.id, url: o.url, lastUpdated: typeof o.lastUpdated === 'number' ? o.lastUpdated : null };
}

/** An image fetched as base64 (`what` names it in the errors: `Snapshot HTTP 404`, `Album art is text/html`). */
export async function fetchImageBase64(api: any, path: string, what: string): Promise<{ type: string, data: string }> {
  const res = await fetch(await homeyUrl(api, path));
  if (!res.ok) throw new Error(`${what} HTTP ${res.status}`);
  const type = res.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) throw new Error(`${what} is ${type}`);
  return { type, data: Buffer.from(await res.arrayBuffer()).toString('base64') };
}

/**
 * Device and capability icons are served by Homey's web server, which a widget can't reach itself,
 * so the app fetches them and hands the widget an SVG data URL (used as a CSS mask).
 */
export async function fetchSvgIcon(
  api: any,
  iconObj: { id?: string, url?: string } | null | undefined,
  label: string,
  log: (...args: any[]) => void,
): Promise<string | null> {
  const obj = iconObj || {};
  const path = obj.url || (obj.id ? `/api/icon/${obj.id}` : null);
  if (!path) return null;
  try {
    return await cachedSvg(await homeyUrl(api, path));
  } catch (err) {
    log(`Could not load icon for ${label} (${JSON.stringify(iconObj)})`, err);
    return null;
  }
}

/**
 * The icon the Homey app shows for a device. A user-picked icon (`iconOverride`, e.g. `lock`) comes
 * from Homey's icon library, served publicly by the web app at my.homey.app/img/devices/<name>.svg
 * (that's where its own bundle loads it from); otherwise it's the driver's icon.
 */
export async function fetchDeviceIcon(api: any, device: any, log: (...args: any[]) => void): Promise<string | null> {
  const override = device?.iconOverride;
  if (typeof override === 'string' && /^[\w-]+$/.test(override)) {
    try {
      return await cachedSvg(`https://my.homey.app/img/devices/${override}.svg`);
    } catch (err) {
      log(`Could not load icon ${override} for ${device.name}, using the driver's`, err);
    }
  }
  return fetchSvgIcon(api, device?.iconObj, device?.name, log);
}

/**
 * Icons are shared by many devices and hardly ever change, so each URL is fetched once per app run
 * (a failed fetch is retried next time). Fetching them took ~150-450 ms per widget load.
 */
const icons = new Map<string, Promise<string>>();

function cachedSvg(url: string): Promise<string> {
  let p = icons.get(url);
  if (!p) {
    p = fetchSvg(url);
    icons.set(url, p);
    p.catch(() => icons.delete(url));
  }
  return p;
}

async function fetchSvg(url: string): Promise<string> {
  if (typeof fetch !== 'function') throw new Error('No fetch');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const svg = await res.text();
  if (!svg.includes('<svg')) throw new Error('Not an SVG');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
