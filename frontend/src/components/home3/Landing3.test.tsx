import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Landing3 from './Landing3';
import { BUILD_URL } from './Builder';
import { BUILDER_SECTION, CTA, EXAMPLE, EXAM_SECTION, GAME, GAME_SECTION, GROUP_SECTION, HEADLINE, LEAD, LECTURE_SECTION, PICTURES, SAMPLE_TEST_URL, bind } from './copy3';
import { GAME_ALT, GAME_URL } from './Sections';
import { STAND_RUN, STAND_RUN_PHONE } from '../../lib/footage';
import { reelPart } from './reelPart';
import { returnToFromSearch } from '../../lib/returnTo';

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

function Where() {
  const { pathname } = useLocation();
  return <p>Адрес: {pathname}</p>;
}

/** Whether a text of a Swap is the one on screen (all of them are in the markup; the others are hidden). */
function shown(text: string, root: HTMLElement = document.body): boolean {
  const spans = within(root)
    .getAllByText(text)
    .filter((el) => el.parentElement?.classList.contains('p3-swap'));
  expect(spans.length, text).toBe(1);
  return spans[0].classList.contains('is-on') && !spans[0].hasAttribute('aria-hidden');
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

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', SilentObserver);
  vi.stubGlobal('ResizeObserver', SilentObserver);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('sh-off');
  document.getElementById('static-hero')?.remove();
});

describe('the landing v3', () => {
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

  it('has the sections in the reel’s order, the constructor last before the end', () => {
    renderLanding();
    const titles = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(titles.slice(0, 5)).toEqual([LECTURE_SECTION.title, EXAM_SECTION.title, GROUP_SECTION.title, GAME_SECTION.title, BUILDER_SECTION.title].map(bind));
  });

  it('shows the game in class after the group: the recorded game, the bot’s post, a phone, one link (owner, 21.10)', () => {
    renderLanding();
    const section = document.getElementById('game')!;
    expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent(GAME_SECTION.title);
    expect(section.querySelector('.p3-text')!.textContent).toBe(bind(GAME_SECTION.text));
    for (const line of ['на проекторе', 'с телефона', 'проваливается', 'в Telegram']) expect(GAME_SECTION.text).toContain(line);
    // The projector is the recorded game, said in words: its player comes with the reel's late file, and fetches its
    // poster and its parts only as the section comes near (no video here, no picture before the player). The post and
    // the phone are pictures beside it; the phone's screen is its own footage, so nothing on it is drawn over it.
    const projector = within(section).getByRole('img', { name: GAME_ALT });
    expect(projector).toHaveClass('p3-proj');
    expect(projector.querySelector('video')).toBeNull();
    expect(STAND_RUN.parts.every((part) => part.startsWith('/game/footage/'))).toBe(true);
    for (const img of section.querySelectorAll('img')) expect(img).toHaveAttribute('loading', 'lazy');
    for (const picture of section.querySelectorAll('.p3-gpost, .p3-gphone')) expect(picture).toHaveAttribute('aria-hidden', 'true');
    expect(section.querySelector('.p3-gpost')).toHaveTextContent(GAME.play);
    expect(section.querySelector('.p3-gphone')!.textContent).toBe('');
    // Nothing to press but its one link: sign up, then «Тесты», where every test has «Провести игру».
    expect(section.querySelectorAll('button')).toHaveLength(0);
    const links = within(section).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(CTA.game);
    expect(links[0]).toHaveAttribute('href', GAME_URL);
    expect(returnToFromSearch(GAME_URL.slice(GAME_URL.indexOf('?')))).toBe('/exams?view=tests');
    fireEvent.click(links[0]);
    expect(screen.getByText('Адрес: /register')).toBeInTheDocument();
  });

  it('puts the projector’s footage and the phone’s in the game once the player has come, posters only until near (owner, 21.10)', async () => {
    renderLanding();
    await act(async () => {
      await reelPart.load();
    });
    const section = document.getElementById('game')!;
    // Two players of one moment: the projector's cut and the phone's, frame for frame the same game.
    const projector = section.querySelector('.p3-proj .fo-poster')!;
    const phone = section.querySelector('.p3-gphone .fo-poster')!;
    expect(projector).toHaveAttribute('src', STAND_RUN.poster);
    expect(phone).toHaveAttribute('src', STAND_RUN_PHONE.poster);
    for (const poster of [projector, phone]) expect(poster).toHaveAttribute('loading', 'lazy');
    // Not near yet (the observer has not said so): nothing is fetched, no video, and no words drawn over the phone.
    expect(section.querySelectorAll('video')).toHaveLength(0);
    expect(section.querySelector('.p3-gphone')!.textContent).toBe('');
    expect(reelPart.current()?.phone).toBe(STAND_RUN_PHONE);
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

  it('switches the lecture’s materials', () => {
    renderLanding();
    fireEvent.click(screen.getByRole('tab', { name: /Тест/ }));
    expect(screen.getByRole('tab', { name: /Тест/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText(EXAMPLE.testStem).length).toBeGreaterThan(0);
  });

  it('moves the exam by two weeks and back', () => {
    renderLanding();
    expect(shown(PICTURES.examDate[0])).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: EXAM_SECTION.plan.move }));
    expect(shown(PICTURES.examDate[1])).toBe(true);
    expect(shown(PICTURES.examDate[0])).toBe(false);
    expect(shown(PICTURES.today[1])).toBe(true);
    expect(screen.getByText(PICTURES.moved)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: EXAM_SECTION.plan.back }));
    expect(shown(PICTURES.examDate[0])).toBe(true);
    expect(screen.queryByText(PICTURES.moved)).toBeNull();
  });

  it('answers a press in the session: the right one is learned and closes its topic, a wrong one names the answer', () => {
    renderLanding();
    const session = screen.getByText(PICTURES.question).closest('.p3-sess') as HTMLElement;
    expect(shown(EXAM_SECTION.session.idle, session)).toBe(true);
    fireEvent.click(within(session).getByRole('button', { name: /Вырастет/ }));
    expect(shown(EXAM_SECTION.session.right, session)).toBe(true);
    expect(shown('147', session)).toBe(true);
    expect(shown('17 тем из 24', session)).toBe(true);
    expect(within(session).getByText('Эластичность и выручка').closest('.p3-topic')).toHaveClass('is-done');
    fireEvent.click(within(session).getByRole('button', { name: EXAM_SECTION.session.again }));
    expect(shown('146', session)).toBe(true);
    fireEvent.click(within(session).getByRole('button', { name: /Снизится/ }));
    expect(shown(EXAM_SECTION.session.wrong, session)).toBe(true);
    expect(EXAM_SECTION.session.wrong).toContain(`«${EXAMPLE.testOptions[EXAMPLE.testRight]}»`);
    expect(within(session).getByText('Эластичность и выручка').closest('.p3-topic')).not.toHaveClass('is-done');
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
