import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../../api/social', () => ({ getProfile: vi.fn(async () => null), markOnboardingTourSeen: vi.fn(async () => undefined) }));
vi.mock('../../lib/telemetry', () => ({ track: vi.fn() }));

import GuidePanel from './GuidePanel';
import { GuideProvider, useGuide } from './GuideContext';
import { GUIDE_CHAPTERS, type GuideChapterId } from './chapters';
import { STEP_CLIPS } from '../clips';

/* The guide's chapters with more than one clip (the owner, 18.10): «Экзамены» with «Перенести экзамен» and the bot's
   «Экзамены», the new «Тесты» with the studio and the test as the student gets it. */

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function Opener({ chapter }: { chapter: GuideChapterId }) {
  const guide = useGuide();
  useEffect(() => {
    guide?.start(chapter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function open(chapter: GuideChapterId) {
  window.localStorage.setItem('meldy_guide_seen', '1');
  render(
    <MemoryRouter initialEntries={['/exams']}>
      <GuideProvider userId="user-1" seenInProfile>
        <Opener chapter={chapter} />
        <GuidePanel />
      </GuideProvider>
    </MemoryRouter>,
  );
}

const panel = () => document.querySelector('section.gd') as HTMLElement;
const reels = () => within(panel()).getByRole('group', { name: 'Ролики раздела' });
const reel = (name: string) => within(reels()).getByRole('button', { name });
const heading = () => within(panel()).getByRole('heading').textContent;
const caption = () => document.querySelector('.sc-cap-t')?.textContent;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
  stubReducedMotion(false);
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('the chapters’ clips', () => {
  it('«Экзамены» keeps its own clip first and gains «Перенести» and «В Telegram», each with its title and text', async () => {
    open('exams');
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(within(reels()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Новый экзамен', 'Перенести', 'В Telegram']);
    expect(reel('Новый экзамен')).toHaveAttribute('aria-pressed', 'true');
    expect(heading()).toBe('Экзамены');
    expect(panel().querySelector('.gd-clip')).not.toHaveAttribute('data-step');

    fireEvent.click(reel('Перенести'));
    expect(reel('Перенести')).toHaveAttribute('aria-pressed', 'true');
    expect(reel('Новый экзамен')).toHaveAttribute('aria-pressed', 'false');
    expect(heading()).toBe('Перенести экзамен');
    expect(panel()).toHaveAccessibleDescription(/Перенести экзамен/);
    expect(panel().querySelector('.gd-clip')).toHaveAttribute('data-step');
    await waitFor(() => expect(caption()).toBe(STEP_CLIPS.move.steps[0].caption));
    expect(screen.getByText(`Раздел 4 из ${GUIDE_CHAPTERS.length}: Перенести экзамен`)).toBeInTheDocument();

    fireEvent.click(reel('В Telegram'));
    expect(heading()).toBe('Экзамены в Telegram');
    await waitFor(() => expect(caption()).toBe(STEP_CLIPS.botExams.steps[0].caption));
    expect(panel().textContent).toContain('/settings');
  });

  it('«Тесты» comes after «Экзамены»: the studio first, «Как это видит ученик» the test by its link; another chapter starts on its first clip', async () => {
    open('exams');
    await waitFor(() => expect(panel()).not.toBeNull());
    fireEvent.click(reel('Перенести'));
    fireEvent.click(within(panel()).getByRole('button', { name: /Дальше/ }));
    expect(heading()).toBe('Тесты');
    expect(within(reels()).getAllByRole('button').map((button) => button.textContent)).toEqual(['Свой тест', 'Как это видит ученик']);
    expect(reel('Свой тест')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(caption()).toBe(STEP_CLIPS.studio.steps[0].caption));
    expect(panel().textContent).toContain('«Новый тест»');

    fireEvent.click(reel('Как это видит ученик'));
    expect(heading()).toBe('Тест по ссылке');
    await waitFor(() => expect(caption()).toBe(STEP_CLIPS.quizLink.steps[0].caption));

    // Back on «Экзамены» the chapter's own clip again.
    fireEvent.click(within(panel()).getByRole('button', { name: 'Назад' }));
    expect(heading()).toBe('Экзамены');
    expect(reel('Новый экзамен')).toHaveAttribute('aria-pressed', 'true');
  });

  it('is all in reach of the keyboard: the clips’ buttons, «Следующий шаг», «Пауза», «Дальше»', async () => {
    open('tests');
    await waitFor(() => expect(caption()).toBe(STEP_CLIPS.studio.steps[0].caption));
    const names = Array.from(panel().querySelectorAll<HTMLElement>('button, a[href]')).map((el) => el.getAttribute('aria-label') ?? el.textContent);
    expect(names).toEqual(expect.arrayContaining(['Закрыть', 'Следующий шаг', 'Пауза', 'Свой тест', 'Как это видит ученик', 'Назад']));
    expect(names.some((name) => /Дальше/.test(name ?? ''))).toBe(true);
    for (const button of Array.from(panel().querySelectorAll('button'))) expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(screen.getByRole('button', { name: 'Следующий шаг' }));
    expect(caption()).toBe(STEP_CLIPS.studio.steps[1].caption);
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(panel().querySelector('.sc')).toHaveAttribute('data-playing', 'false');
  });

  it('with reduced motion the chapter’s clip stands on its first step with its line until «Смотреть»', async () => {
    stubReducedMotion(true);
    open('tests');
    await waitFor(() => expect(caption()).toBe(STEP_CLIPS.studio.steps[0].caption));
    expect(panel().querySelector('.sc')).toHaveAttribute('data-playing', 'false');
    expect(within(panel()).getByRole('button', { name: /Смотреть/ })).toBeInTheDocument();
  });
});
