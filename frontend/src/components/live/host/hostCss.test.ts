import { describe, expect, it } from 'vitest';

// Vitest turns CSS imports into empty modules: the stylesheet is read from disk (as in art.test.tsx).
const NODE_FS: string = 'node:fs';
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const read = async (file: string): Promise<string> =>
  ((await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(p: string, e: 'utf8'): string }).readFileSync(`${HERE.slice(0, HERE.lastIndexOf('/'))}/${file}`, 'utf8');

describe('host.css', () => {
  it('animates only transform and opacity (keyframes and transitions)', async () => {
    const css = await read('host.css');
    const frames = css.match(/@keyframes[^{]+\{([\s\S]*?\}\s*)\}/g) ?? [];
    expect(frames.length).toBeGreaterThan(10);
    for (const block of frames) {
      const body = block.replace(/^@keyframes[^{]+\{/, '');
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(props.every((p) => p === 'transform' || p === 'opacity' || p === 'animation-timing-function'), block.slice(0, 40)).toBe(true);
    }
    const transitions = [...css.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]);
    expect(transitions.length).toBeGreaterThan(3);
    for (const raw of transitions) {
      const t = raw.replace(/\([^)]*\)/g, '').replace(/!important/g, '').trim();
      expect(t === 'none' || t.split(',').every((part) => /^(opacity|transform)\b/.test(part.trim())), raw).toBe(true);
    }
  });

  it('a character looks the same under a resting mouse (no hover look), names are cut with «…» and step out for a walk', async () => {
    const css = await read('host.css');
    expect(css).not.toMatch(/line-through/);
    expect(css).not.toMatch(/\.lvh-slot[^{]*:hover/);
    const name = /\.lvh-name \{([^}]*)\}/.exec(css)![1];
    expect(name).toMatch(/text-overflow: ellipsis/);
    expect(name).toMatch(/white-space: nowrap/);
    expect(name).toMatch(/font: 600 24px/);
    // at once: no half-faded names crossing each other (r2, N7)
    expect(css).toMatch(/\.lvh-crowd\[data-walk\] \.lvh-name \{ opacity: 0; transition: [^}]*opacity 0s; \}/);
    expect(css).toMatch(/\.lvh-panel--late \{ animation-delay: 0\.6s; \}/);
  });

  it('the question’s three are big enough for the back row (≥ 2.5 % of 900 units)', async () => {
    const css = await read('host.css');
    const size = Number(/\.lvh-strike li \{[^}]*font: \d+ (\d+)px/.exec(css)![1]);
    expect(size).toBeGreaterThanOrEqual(0.025 * 900);
    expect(size).toBeGreaterThanOrEqual(30);
  });

  it('the lobby’s post list opens at --tg-pop-x (over the panel), not over the QR code', async () => {
    const css = await read('host.css');
    expect(css).toMatch(/\.lvh-lobby-foot \.lvh-tg \{ position: static; \}/);
    expect(css).toMatch(/\.lvh-lobby-foot \.lvh-tg-pop \{ left: var\(--tg-pop-x/);
  });

  it('has no glow, gradients or blur in the chrome, and stands still for reduced motion', async () => {
    const css = await read('host.css');
    expect(css).not.toMatch(/gradient\(|text-shadow|drop-shadow|blur\(|backdrop-filter|filter:/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});
