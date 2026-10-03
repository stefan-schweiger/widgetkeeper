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
    return await cachedSvg(/^https?:/.test(path) ? path : `${await api.baseUrl}${path}`);
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
