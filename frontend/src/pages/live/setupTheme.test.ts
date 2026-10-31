import { describe, expect, it } from 'vitest';

// Vitest turns CSS imports into empty modules: the stylesheet is read from disk (as hostCss.test.ts does).
const NODE_FS: string = 'node:fs';
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const read = async (file: string): Promise<string> =>
  ((await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(p: string, e: 'utf8'): string }).readFileSync(`${HERE.slice(0, HERE.lastIndexOf('/'))}/${file}`, 'utf8');

/**
 * The setup pages under /live (/live/new, /live/challenge) follow the site's theme (the bug of 31.10: /live/new stayed
 * light in the dark theme); the projector's screen (.lvh) keeps the game's light palette.
 */
describe('the setup pages follow the site’s theme', () => {
  it('.dark .lvs takes the site’s dark tokens, and a picked option stays readable', async () => {
    const css = await read('../../components/live/host/host.css');
    const dark = /\.dark \.lvs \{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const [token, value] of [['--lvh-ink', '#f3f3f0'], ['--lvh-canvas', '#0b0f16'], ['--lvh-card', '#141a24'], ['--lvh-line', '#262e3b']]) {
      expect(dark, token).toMatch(new RegExp(`${token}: ${value};`));
    }
    expect(dark).toMatch(/color-scheme: dark/);
    expect(css).toMatch(/\.dark \.lvs-seg button\[aria-checked='true'\] \{ background: var\(--lvh-ink\); color: var\(--lvh-canvas\); \}/);
    // the projector is not darkened
    expect(css).not.toMatch(/\.dark \.lvh\b/);
  });
});
