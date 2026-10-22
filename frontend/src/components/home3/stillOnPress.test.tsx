/**
 * Nothing on the landing moves when a picture is pressed (owner, 2026-10-21: «при нажатии на блоки (например на выбор
 * ответа) другие блоки чуть вниз сьезжают»). Two halves hold it without a browser:
 *   1. a press changes no element and no text of a section, only which of the texts already there is shown
 *      (every text a press can show is laid out from the start, in one grid cell with the others);
 *   2. the stylesheet's rules that answer a state (a class is-…, data-reveal, data-speaker, data-view…) set no
 *      property that takes or gives room: only opacity, transform, visibility, colours, shadows and the like.
 * A browser check of the same (heights and positions before and after a press, every size) is in the release notes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing3 from './Landing3';
import MiniStudio from './MiniStudio';

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));

async function sheet(name: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
  return fs.readFileSync(HERE.slice(0, HERE.lastIndexOf('/')) + '/' + name, 'utf8');
}

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, requestSession: vi.fn() }) }));

class SilentObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', SilentObserver);
  vi.stubGlobal('ResizeObserver', SilentObserver);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('sh-off');
});

/**
 * What takes room in a part of the page: every element (its tag and its classes but the state ones, is-…) and every
 * text, in order. The screen readers' line (.p3-sr) is left out: it stands outside the flow and its words change.
 */
function layout(root: Element): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim()) out.push(`"${node.textContent}"`);
      return;
    }
    if (!(node instanceof Element) || node.classList.contains('p3-sr')) return;
    const classes = [...node.classList].filter((name) => !name.startsWith('is-')).join('.');
    out.push(`<${node.tagName.toLowerCase()}${classes ? `.${classes}` : ''}>`);
    node.childNodes.forEach(walk);
    out.push('</>');
  };
  walk(root);
  return out.join('');
}

describe('a press on the landing moves nothing', () => {
  it('in every part with a button, every button: the same elements and the same words before and after', () => {
    render(
      <MemoryRouter>
        <Landing3 />
      </MemoryRouter>,
    );
    // The tiles have no button (their videos are pictures, their one link is a link); the constructor has its own.
    for (const id of ['lecture', 'exam', 'game']) expect(document.getElementById(id)!.querySelectorAll('button'), id).toHaveLength(0);
    const section = document.getElementById('builder')!;
    const before = layout(section);
    const buttons = [...section.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      fireEvent.click(button);
      expect(layout(section), `builder: «${button.textContent}»`).toBe(before);
    }
  });

  it('in the studio: the view switch shows one of two parts that are both always there', () => {
    const { container } = render(<MiniStudio />);
    const studio = container.querySelector('.ms') as HTMLElement;
    const before = layout(studio);
    fireEvent.click(screen.getByRole('button', { name: 'Как видит участник' }));
    expect(studio.dataset.view).toBe('take');
    expect(layout(studio)).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Страница' }));
    expect(studio.dataset.view).toBe('page');
  });
});

/** Properties that change no box: a rule that answers a state may set only these. */
const STILL = new Set([
  'opacity',
  'transform',
  'transform-origin',
  'visibility',
  'color',
  'background',
  'background-color',
  'box-shadow',
  'transition',
  'transition-delay',
  'animation',
  'pointer-events',
  'cursor',
]);
const STATE = /\.is-[\w-]+|\[data-(?:reveal|speaker|playing|fading|view)|\[aria-selected|:disabled/;

function stateRules(css: string): Array<{ selector: string; props: string[] }> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<{ selector: string; props: string[] }> = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    if (!STATE.test(selector)) continue;
    const props = match[2]
      .split(';')
      .map((part) => part.split(':')[0].trim().toLowerCase())
      .filter(Boolean);
    out.push({ selector, props });
  }
  return out;
}

describe('the rules that answer a state take no room', () => {
  it('home3.css: the sections', async () => {
    const rules = stateRules(await sheet('home3.css'));
    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const rule of rules) for (const prop of rule.props) expect(STILL.has(prop), `${rule.selector} { ${prop} }`).toBe(true);
  });

  it('miniStudio.css: the phone view switch', async () => {
    const rules = stateRules(await sheet('miniStudio.css')).filter((rule) => rule.selector.includes('data-view'));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) for (const prop of rule.props) expect(STILL.has(prop), `${rule.selector} { ${prop} }`).toBe(true);
  });
});
