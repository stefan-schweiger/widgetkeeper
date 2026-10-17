import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Flow Buttons' icon paths (`ICONS` in the kit), read as `npm run flow-icons` reads them: the generated previews must match. */
const win: any = {};
const context = vm.createContext({ window: win });
vm.runInContext(readFileSync('widgets/spacer/public/kit.js', 'utf8'), context);
export const FLOW_ICON_PATHS: Record<string, { d: string, fill?: boolean }> = win.WidgetkeeperKit.icons;
