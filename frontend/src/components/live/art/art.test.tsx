import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BODIES, COLOURS, EYES, HATS, LOCKED } from '../../../lib/live/rules';
import type { Look } from '../../../lib/live/types';
import { Boss } from './Boss';
import { Character } from './Character';
import LiveArtPreview from './LiveArtPreview';
import { COLOUR_PARTS, HAT_PARTS } from './parts';

// Vitest turns every CSS import into an empty module (`?raw` too): the stylesheet is read from disk
// (the pattern of components/resultsPanelLayout.test.ts; the project has no Node types).
const NODE_FS: string = 'node:fs';
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const readCss = async (): Promise<string> =>
  ((await import(/* @vite-ignore */ NODE_FS)) as { readFileSync(p: string, e: 'utf8'): string }).readFileSync(`${HERE.slice(0, HERE.lastIndexOf('/'))}/live-art.css`, 'utf8');

function geometry(root: HTMLElement): string {
  return [...root.querySelectorAll('path, circle, ellipse, rect')]
    .map((n) => ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'transform'].map((a) => n.getAttribute(a) ?? '').join(' '))
    .join('|');
}

describe('live art', () => {
  it('draws every body × eyes × hat × expression with finite numbers', () => {
    for (const body of BODIES)
      for (const eyes of EYES)
        for (const hat of HATS) {
          const look: Look = { body, colour: 'orange', eyes, hat };
          const { container, unmount } = render(<Character look={look} size={64} />);
          const g = geometry(container);
          expect(g).not.toMatch(/NaN|undefined|Infinity/);
          expect(container.querySelectorAll('.lv-char__face')).toHaveLength(4);
          unmount();
        }
  });

  it('switches the expression and the ice by attributes, names the character for screen readers', () => {
    render(<Character look={{ body: 'round', colour: 'blue', eyes: 'dots', hat: 'none' }} size={58} frozen name="Дима" />);
    const el = screen.getByRole('img', { name: 'Дима' });
    expect(el).toHaveAttribute('data-face', 'frozen');
    expect(el).toHaveAttribute('data-frozen', 'true');
    expect(el.querySelector('.lv-move-idle')).not.toBeNull();
  });

  it('a long name stays one line within its width, the full name in its title', async () => {
    render(<Character look={{ body: 'round', colour: 'blue', eyes: 'dots', hat: 'none' }} size={58} name="Катя Смирнова-Остроумова" />);
    const label = screen.getByText('Катя Смирнова-Остроумова');
    expect(label).toHaveAttribute('title', 'Катя Смирнова-Остроумова');
    const rule = /\.lv-char__name \{([^}]*)\}/.exec(await readCss())![1];
    expect(rule).toMatch(/max-width:/);
    expect(rule).toMatch(/text-overflow: ellipsis/);
    expect(rule).toMatch(/overflow: hidden/);
  });

  it('marks the locked parts the contract names, and only them', () => {
    const lockedColours = COLOURS.filter((c) => COLOUR_PARTS[c].lock);
    const lockedHats = HATS.filter((h) => HAT_PARTS[h].lock);
    expect([...lockedColours, ...lockedHats].sort()).toEqual([...LOCKED].sort());
  });

  it('draws the boss in each phase, hurt or not', () => {
    for (const phase of [0, 1, 2] as const)
      for (const hurt of [false, true]) {
        const { container, unmount } = render(<Boss size={300} phase={phase} hurt={hurt} />);
        expect(geometry(container)).not.toMatch(/NaN|undefined/);
        expect(container.querySelector('[data-phase]')).toHaveAttribute('data-phase', String(phase));
        unmount();
      }
  });

  it('the preview page renders every part', () => {
    render(<LiveArtPreview />);
    expect(screen.getByRole('heading', { name: 'Живая игра: персонажи и монстр' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Дедлайн' })).toHaveLength(2);
  });

  it('animates only transform and opacity', async () => {
    const css = await readCss();
    const frames = css.match(/@keyframes[^{]+\{([\s\S]*?\}\s*)\}/g) ?? [];
    expect(frames.length).toBeGreaterThan(5);
    for (const block of frames) {
      const props = [...block.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(props.every((p) => p === 'transform' || p === 'opacity')).toBe(true);
    }
    const transitions = [...css.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]);
    for (const raw of transitions) {
      const t = raw.replace(/\([^)]*\)/g, '').replace(/!important/g, '').trim();
      expect(t === 'none' || t.split(',').every((part) => /^(opacity|transform)\b/.test(part.trim()))).toBe(true);
    }
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});
