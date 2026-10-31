import { describe, expect, it } from 'vitest';

/**
 * The bottom bars and the system's bars (owner, 31.10: DuckDuckGo on an Android phone, dark theme — an empty band of about
 * 50 px under the five tabs, above the system's navigation bar). The site's viewport has no viewport-fit=cover, so the
 * browser keeps the page above the system's bars and there is no inset to keep; that WebView (Android 15, edge to edge)
 * still reported env(safe-area-inset-bottom), and every bar that added it stood that much too high. The bars add
 * --sf-safe-b instead: 0 on the site, Telegram's inset in Telegram mode (which does go edge to edge).
 *
 * The styles are read from disk: Vitest turns every CSS import into an empty module.
 */
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>;
}
const NODE_FS: string = 'node:fs';
const nodeFs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const SRC = HERE.slice(0, HERE.lastIndexOf('/src/') + '/src/'.length);

/**
 * The live game's own pages (components/live: the projector's setup and the phone's /play) keep their insets: the phone's
 * game is laid out by the live game's own rules. telegram.css is where the Telegram inset is made from env() on purpose.
 */
const OWN_INSETS = [/^components\/live\//, /^styles\/telegram\.css$/];

async function sources(): Promise<Array<{ path: string; text: string }>> {
  const fs = await nodeFs();
  const out: Array<{ path: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(`${SRC}${dir}`, { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) walk(`${path}/`);
      else if (/\.(css|tsx|ts)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push({ path, text: fs.readFileSync(`${SRC}${path}`, 'utf8') });
    }
  };
  walk('');
  return out;
}

const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the bottom safe area', () => {
  it('no bar of the site adds env(safe-area-inset-bottom) itself: every one adds --sf-safe-b', async () => {
    const offenders = (await sources())
      .filter(({ path }) => !OWN_INSETS.some((own) => own.test(path)))
      .filter(({ text }) => /env\(\s*safe-area-inset-bottom/.test(withoutComments(text)))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('is 0 on the site and Telegram’s inset in Telegram mode', async () => {
    const fs = await nodeFs();
    const index = withoutComments(fs.readFileSync(`${SRC}index.css`, 'utf8'));
    const root = /:root\s*\{([^}]*)\}/.exec(index)?.[1] ?? '';
    expect(root).toMatch(/--sf-safe-b:\s*0px;/);
    // Nothing else on the site sets it.
    const setters = (await sources()).filter(({ text }) => /--sf-safe-b\s*:/.test(withoutComments(text))).map(({ path }) => path);
    expect(setters.sort()).toEqual(['index.css', 'styles/telegram.css']);
    const telegram = withoutComments(fs.readFileSync(`${SRC}styles/telegram.css`, 'utf8'));
    const tg = /html\.tg-mode\s*\{([^}]*)\}/.exec(telegram)?.[1] ?? '';
    expect(tg).toMatch(/--tg-bottom:\s*max\(env\(safe-area-inset-bottom\), var\(--tg-safe-area-inset-bottom, 0px\)\);/);
    expect(tg).toMatch(/--sf-safe-b:\s*var\(--tg-bottom\);/);
  });

  it('the tab bar on a phone: its 62 px and the safe area, as the variable says', async () => {
    const fs = await nodeFs();
    const layout = withoutComments(fs.readFileSync(`${SRC}components/layout.css`, 'utf8'));
    expect(layout).toMatch(/\.sf-shell \.sf-tabbar \{[^}]*height: calc\(var\(--sf-tabs-h\) \+ var\(--sf-safe-b\)\);[^}]*padding: 0 6px var\(--sf-safe-b\);/);
    expect(layout).toMatch(/\.sf-shell\[data-tabs\] \.sf-main \{ padding-bottom: calc\(var\(--sf-tabs-h\) \+ var\(--sf-safe-b\)\); \}/);
  });
});
