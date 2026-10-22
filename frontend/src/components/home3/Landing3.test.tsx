import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Landing3, { PHONE_QUERY } from './Landing3';
import { BUILD_URL } from './Builder';
import { BUILDER_SECTION, CTA, FINAL, GAME_SECTION, HEADLINE, LEAD, NAV, SAMPLE_TEST_URL, TILES, bind } from './copy3';
import { GAME_ALT, GAME_URL } from './Sections';
import { LANDING_EXAM_PHONE, LANDING_EXAM_WIDE, LANDING_LECTURE_PHONE, LANDING_LECTURE_WIDE, LANDING_ORAL, STAND_RUN, STAND_RUN_PHONE } from '../../lib/footage';
import { returnToFromSearch } from '../../lib/returnTo';

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));

const auth = vi.hoisted(() => ({ requestSession: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: null, requestSession: auth.requestSession }),
}));

class SilentObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

/** An IntersectionObserver that says at once that everything is on screen (every player near and in view). */
class SeenObserver {
  constructor(private callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
  observe() {
    this.callback([{ isIntersecting: true }]);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function Where() {
  const { pathname } = useLocation();
  return <p>Адрес: {pathname}</p>;
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing3 />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** matchMedia answering `phone` for the page's phone width and no to everything else (reduced motion included). */
function stubScreen(phone: boolean) {
  const asked: string[] = [];
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      asked.push(query);
      return { matches: phone && query === PHONE_QUERY, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() };
    }),
  );
  return asked;
}

/** The page before the window's load event (jsdom's document is already complete). */
function beforeLoad() {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'interactive' });
  return () => {
    delete (document as unknown as { readyState?: string }).readyState;
    act(() => {
      window.dispatchEvent(new Event('load'));
    });
  };
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', SilentObserver);
  vi.stubGlobal('ResizeObserver', SilentObserver);
  stubScreen(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as unknown as { readyState?: string }).readyState;
  document.documentElement.classList.remove('sh-off');
  document.getElementById('static-hero')?.remove();
});

describe('the landing «D — Плитки»', () => {
  it('says the headline and the lead and offers the example and the public test first', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 1, name: bind(HEADLINE) })).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === bind(LEAD))).toBeInTheDocument();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    expect(within(hero).getByRole('link', { name: CTA.example })).toHaveAttribute('href', '/try');
    expect(within(hero).getByRole('link', { name: CTA.test })).toHaveAttribute('href', SAMPLE_TEST_URL);
  });

  it('takes the static first screen’s place and unhides the app', () => {
    const shell = document.createElement('div');
    shell.id = 'static-hero';
    document.body.appendChild(shell);
    renderLanding();
    expect(document.getElementById('static-hero')).toBeNull();
    expect(document.documentElement.classList.contains('sh-off')).toBe(true);
  });

  it('follows its inner links through the router', () => {
    renderLanding();
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')!;
    fireEvent.click(within(hero).getByRole('link', { name: CTA.example }));
    expect(screen.getByText('Адрес: /try')).toBeInTheDocument();
  });

  it('has its tiles in the prototype’s order, headings one level under the headline, the constructor before the end', () => {
    renderLanding();
    const names = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    // the drawn arrows (glyphs.tsx) are pictures with a label, not text
    const plain = (text: string) => bind(text).replace(/ → /g, '  ');
    expect(names).toEqual(
      [TILES.oral, TILES.lecture.title, TILES.exam.title, GAME_SECTION.title, TILES.link, TILES.telegram, BUILDER_SECTION.title, FINAL.title].map(plain),
    );
    expect(screen.getByRole('heading', { level: 2, name: TILES.lecture.title })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // the 48 s reel is no longer on the page
    expect(document.querySelector('.r3, .h3-reel-slot, .h3-reel-wait')).toBeNull();
  });

  it('sends the top line’s links to their tiles: the lecture, the exam and the constructor', () => {
    renderLanding();
    const nav = screen.getByRole('navigation', { name: 'Главное меню' });
    const expected = { lecture: TILES.lecture.title, exam: TILES.exam.title, builder: BUILDER_SECTION.title };
    for (const item of NAV) {
      const link = within(nav).getByRole('link', { name: item.label });
      expect(link).toHaveAttribute('href', `#${item.id}`);
      const target = document.getElementById(item.id)!;
      expect(target, item.id).not.toBeNull();
      expect(within(target).getAllByRole('heading', { level: 2 })[0]).toHaveAccessibleName(bind(expected[item.id]));
    }
  });

  it('shows a recorded screen in the lecture’s and the exam’s tiles, as decoration the tile’s words explain', () => {
    renderLanding();
    for (const [id, cut] of [
      ['lecture', LANDING_LECTURE_WIDE],
      ['exam', LANDING_EXAM_WIDE],
    ] as const) {
      const tile = document.getElementById(id)!;
      const frame = tile.querySelector('.p3-clip-frame') as HTMLElement;
      expect(frame.dataset.variant).toBe('wide');
      expect(frame.style.aspectRatio).toBe(`${cut.width} / ${cut.height}`);
      expect(frame.querySelector('.fo')).toHaveAttribute('aria-hidden', 'true');
      expect(frame.querySelector('.fo-poster')).toHaveAttribute('src', cut.poster);
      expect(tile.querySelector('.p3-tile-p')!.textContent).toBe(bind(id === 'lecture' ? TILES.lecture.text : TILES.exam.text));
    }
    // nothing fetched or played while the tiles are not near (the observer has not said so)
    expect(document.querySelectorAll('video')).toHaveLength(0);
  });

  it('takes the phone’s 4:5 cuts on a phone, chosen once when the page opens', () => {
    const asked = stubScreen(true);
    renderLanding();
    expect(asked).toContain(PHONE_QUERY);
    for (const [id, cut] of [
      ['lecture', LANDING_LECTURE_PHONE],
      ['exam', LANDING_EXAM_PHONE],
    ] as const) {
      const frame = document.getElementById(id)!.querySelector('.p3-clip-frame') as HTMLElement;
      expect(frame.dataset.variant).toBe('phone');
      expect(frame.style.aspectRatio).toBe(`${cut.width} / ${cut.height}`);
      expect(cut.width / cut.height).toBeCloseTo(4 / 5, 3);
      expect(frame.querySelector('.fo-poster')).toHaveAttribute('src', cut.poster);
    }
  });

  it('shows the game in class on its dark tile: the recorded projector, the phone in the same game, one link (owner, 21.10)', () => {
    renderLanding();
    const section = document.getElementById('game')!;
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent(GAME_SECTION.title);
    expect(section.querySelector('.p3-tile-p')!.textContent).toBe(bind(GAME_SECTION.text));
    // the projector is the recorded game, said in words; the phone beside it is its own footage, nothing drawn over it
    const projector = within(section).getByRole('img', { name: GAME_ALT });
    expect(projector).toHaveClass('p3-proj');
    expect(projector.querySelector('.fo-poster')).toHaveAttribute('src', STAND_RUN.poster);
    const phone = section.querySelector('.p3-gphone')!;
    expect(phone).toHaveAttribute('aria-hidden', 'true');
    expect(phone.querySelector('.fo-poster')).toHaveAttribute('src', STAND_RUN_PHONE.poster);
    expect(phone.textContent).toBe('');
    for (const img of section.querySelectorAll('img')) expect(img).toHaveAttribute('loading', 'lazy');
    expect(section.querySelectorAll('video')).toHaveLength(0);
    // nothing to press but its one link: sign up, then «Тесты», where every test has «Провести игру»
    expect(section.querySelectorAll('button')).toHaveLength(0);
    const links = within(section).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(CTA.game);
    expect(links[0]).toHaveAttribute('href', GAME_URL);
    expect(returnToFromSearch(GAME_URL.slice(GAME_URL.indexOf('?')))).toBe('/exams?view=tests');
    fireEvent.click(links[0]);
    expect(screen.getByText('Адрес: /register')).toBeInTheDocument();
  });

  it('says the two facts as headings beside the game', () => {
    renderLanding();
    const facts = document.querySelector('.p3-facts')!;
    expect(within(facts as HTMLElement).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([bind(TILES.link), bind(TILES.telegram)]);
    for (const icon of facts.querySelectorAll('svg')) expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('fetches no part of any video before the window’s load event; then the phone answering aloud joins its poster', () => {
    vi.stubGlobal('IntersectionObserver', SeenObserver);
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    const fetchMock = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    const load = beforeLoad();
    renderLanding();
    // posters only: the static screen's own <img> in the blue tile, no player over it yet, nothing fetched
    const phone = document.querySelector('.h3-oral-phone')!;
    expect(phone.querySelector('.h3-oral-poster')).toHaveAttribute('src', LANDING_ORAL.poster);
    expect(phone.querySelector('.fo')).toBeNull();
    expect(document.querySelectorAll('.fo').length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
    load();
    expect(phone.querySelector('.fo')).toHaveAttribute('aria-hidden', 'true');
    const fetched = fetchMock.mock.calls.map((call) => (call as unknown[])[0]);
    expect(fetched).toEqual(expect.arrayContaining([...LANDING_ORAL.parts, ...STAND_RUN.parts, ...LANDING_LECTURE_WIDE.parts]));
    // one of the two cuts of a tile, never both: a computer's screen fetches no phone cut
    for (const part of [...LANDING_LECTURE_PHONE.parts, ...LANDING_EXAM_PHONE.parts]) expect(fetched).not.toContain(part);
  });

  it('on a phone fetches the phone’s cuts and none of the wide ones', () => {
    stubScreen(true);
    vi.stubGlobal('IntersectionObserver', SeenObserver);
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    const fetchMock = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    renderLanding();
    const fetched = fetchMock.mock.calls.map((call) => (call as unknown[])[0]);
    expect(fetched).toEqual(expect.arrayContaining([...LANDING_LECTURE_PHONE.parts, ...LANDING_EXAM_PHONE.parts]));
    for (const part of [...LANDING_LECTURE_WIDE.parts, ...LANDING_EXAM_WIDE.parts]) expect(fetched).not.toContain(part);
    // (the loader keeps a cut's load for the page's life, so the players themselves say which cuts they were given)
    const posters = [...document.querySelectorAll('.fo-poster')].map((img) => img.getAttribute('src'));
    for (const wide of [LANDING_LECTURE_WIDE, LANDING_EXAM_WIDE]) expect(posters).not.toContain(wide.poster);
  });

  it('ends on the example: one heading, one link', () => {
    renderLanding();
    const end = screen.getByRole('heading', { level: 2, name: bind(FINAL.title) }).closest('section')!;
    const links = within(end).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(CTA.example);
    expect(links[0]).toHaveAttribute('href', '/try');
  });

  it('offers «Собрать свой тест» beside the sample test: sign up, then the quick test (UX audit 21.10)', () => {
    renderLanding();
    expect(BUILD_URL).toBe('/register?next=/tests/quick');
    expect(screen.getByRole('link', { name: CTA.build })).toHaveAttribute('href', BUILD_URL);
  });

  it('says under the two pills that the test can be played as a game in class (owner, 21.10)', () => {
    renderLanding();
    const line = document.querySelector('.p3-game') as HTMLElement;
    expect(line.textContent).toBe(bind(BUILDER_SECTION.game));
    const card = line.closest('.p3-card-text')!;
    // The two pills stay as they were.
    expect(card.querySelectorAll('.p3-ctas a')).toHaveLength(2);
    expect(card.querySelector('.p3-ctas')!.nextElementSibling).toBe(line);
    expect(BUILDER_SECTION.game).toMatch(/игру в классе/);
  });

  it('says where the participant’s view is: on the right of a wider screen, the studio’s tab on a phone (owner, 22.10)', async () => {
    renderLanding();
    const lead = document.querySelector('.p3-try .p3-p') as HTMLElement;
    expect(lead.querySelector('.p3-try-wide')!.textContent).toBe(bind(BUILDER_SECTION.tryText));
    expect(lead.querySelector('.p3-try-phone')!.textContent).toBe(bind(BUILDER_SECTION.tryTextPhone));
    // home3.css shows one of the two, at the width where the studio turns into its phone layout (miniStudio.css)
    const fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
    const dir = HERE.slice(0, HERE.lastIndexOf('/'));
    const css = fs.readFileSync(`${dir}/home3.css`, 'utf8');
    expect(css).toMatch(/\n\.p3-try-phone \{\n {2}display: none;\n\}/);
    expect(css).toMatch(/@media \(max-width: 699px\) \{\n {2}\.p3-try-wide \{\n {4}display: none;\n {2}\}\n {2}\.p3-try-phone \{\n {4}display: inline;\n {2}\}/);
    expect(fs.readFileSync(`${dir}/miniStudio.css`, 'utf8')).toMatch(/@media \(max-width: 699px\) \{\n {2}\.ms \{\n {4}--ms-pad/);
  });

  it('keeps its stylesheets light to paint: no blur, no backdrop filter, no drop shadow, the phone width the page’s', async () => {
    const fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
    const dir = HERE.slice(0, HERE.lastIndexOf('/'));
    for (const name of ['home3.css', 'hero3.css']) {
      const css = fs.readFileSync(`${dir}/${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, name).not.toMatch(/filter|blur/);
      for (const shadow of css.match(/box-shadow:[^;}]*/g) ?? []) expect(shadow, `${name}: ${shadow}`).toMatch(/inset 0 0 0 1px/);
      expect(css, name).toContain(`max-width:${name === 'hero3.css' ? '' : ' '}640px`);
    }
    expect(PHONE_QUERY).toBe('(max-width: 640px)');
  });
});

describe('the session on the landing', () => {
  it('asks for the session when the visitor leaves the landing, not before', () => {
    auth.requestSession.mockClear();
    renderLanding();
    expect(auth.requestSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('link', { name: CTA.signIn })[0]);
    expect(screen.getByText('Адрес: /login')).toBeInTheDocument();
    expect(auth.requestSession).toHaveBeenCalledTimes(1);
  });
});
