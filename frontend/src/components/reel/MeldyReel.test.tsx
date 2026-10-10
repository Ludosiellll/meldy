import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MeldyReel, { CAPTIONS, REEL_SECONDS, SEGMENTS } from './MeldyReel';
import { OUTRO_CTA_LABEL } from './scenes/Outro';
import { CHAPTERS, POSTER_AT, TOTAL } from './timeline';

type Callback = (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;

let observed: Callback[] = [];
let reduced = false;

class FakeIntersectionObserver {
  constructor(callback: Callback) {
    observed.push(callback);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

function showReel(visible = true) {
  act(() => {
    for (const callback of observed) callback([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]);
  });
}

const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ');
/** The bar's segment that holds a moment. */
const segmentOf = (t: number) => SEGMENTS.find((segment) => t >= segment.from && t < segment.to)!;

beforeEach(() => {
  observed = [];
  reduced = false;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MeldyReel', () => {
  it('is a captioned figure whose moving stage is hidden from screen readers, with a transcript instead', () => {
    const { container } = render(<MeldyReel />);
    expect(screen.getByRole('figure', { name: 'Ролик о Meldy, 48 секунд, без звука.' })).toBeInTheDocument();
    expect(REEL_SECONDS).toBe(Math.round(TOTAL / 1000));
    expect(container.querySelector('.mr-stage')).toHaveAttribute('aria-hidden', 'true');
    const transcript = Array.from(container.querySelectorAll('ol.mr-sr li'), (item) => plain(item.textContent));
    expect(transcript).toHaveLength(8);
    // The chapters say what the stage shows: the session's files, the plan, the «занятие», the sheet, the group and the bot.
    expect(transcript[0]).toContain('960 вопросов. 18 дней. С чего начать?');
    expect(transcript[2]).toContain('Нашли 4 предмета и 960 вопросов');
    expect(transcript[2]).toContain('Ключей ИИ не придумывает.');
    expect(transcript[3]).toContain('До экзамена 18 дней.');
    expect(transcript[4]).toContain('Вернётся через пару вопросов и в понедельник.');
    expect(transcript[4]).toContain('Теперь 147 из 960 — верно в два разных дня');
    expect(transcript[5]).toContain('Шпаргалка: строки стирают только ответы.');
    expect(transcript[6]).toContain('В экзамене 24 участника');
    expect(transcript[6]).toContain('План на день в Telegram.');
    expect(transcript[7]).toContain(`${OUTRO_CTA_LABEL}.`);
    // Nothing of the story it replaced, and no grade.
    const text = transcript.join(' ');
    expect(text).not.toMatch(/Билет|Тянуть|Засчитано|Проверено|пекарн|кофейн/i);
  });

  it('plays only while it is on screen', () => {
    render(<MeldyReel />);
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
    showReel(true);
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
    showReel(false);
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
  });

  it('goes by the latest of several changes the observer reports at once', () => {
    render(<MeldyReel />);
    // A full-page resize and back: «off screen» and «on screen» come in one call.
    act(() => {
      for (const callback of observed)
        callback([
          { isIntersecting: false, intersectionRatio: 0 },
          { isIntersecting: true, intersectionRatio: 1 },
        ]);
    });
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('shows its poster until it first plays, then starts from its first frame', () => {
    render(<MeldyReel />);
    // Off screen at first: the poster, the «занятие».
    showReel(false);
    const poster = segmentOf(POSTER_AT);
    expect(poster.label).toBe('Занятие');
    expect(screen.getByRole('button', { name: `Перейти: ${poster.label}` })).toHaveAttribute('aria-current', 'step');
    // On screen: from the beginning.
    showReel(true);
    expect(screen.getByRole('button', { name: 'Перейти: Начало' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('pauses and resumes from its button', () => {
    render(<MeldyReel />);
    showReel(true);
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть' }));
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('jumps to a chapter from the bar and marks it as the current one', () => {
    render(<MeldyReel />);
    expect(SEGMENTS.map((segment) => segment.label)).toEqual(['Начало', 'Вопросы', 'План', 'Занятие', 'Шпаргалка', 'Группа', 'Итог']);
    expect(SEGMENTS.slice(1, -1).map((segment) => segment.id)).toEqual(CHAPTERS.map((chapter) => chapter.id));
    expect(SEGMENTS[0].from).toBe(0);
    expect(SEGMENTS[SEGMENTS.length - 1].to).toBe(TOTAL);
    for (let i = 1; i < SEGMENTS.length; i += 1) expect(SEGMENTS[i].from).toBe(SEGMENTS[i - 1].to);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Перейти: Занятие' }));
    });
    expect(screen.getByRole('button', { name: 'Перейти: Занятие' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Перейти: Вопросы' })).not.toHaveAttribute('aria-current');
  });

  it('a chapter asked for before the first play is where the reel starts, not its first frame', () => {
    render(<MeldyReel />);
    showReel(false);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Перейти: Группа' }));
    });
    showReel(true);
    expect(screen.getByRole('button', { name: 'Перейти: Группа' })).toHaveAttribute('aria-current', 'step');
  });

  it('sizes each chapter by its length beyond its label, and names the chapter in a line of page text under the bar (audit PUB-10, PUB-11)', () => {
    const { container } = render(<MeldyReel />);
    const chapters = Array.from(container.querySelectorAll<HTMLElement>('.mr-chapter'));
    expect(chapters.map((chapter) => Number(chapter.style.getPropertyValue('--mr-grow')))).toEqual(SEGMENTS.map((segment) => segment.to - segment.from));
    expect(CAPTIONS).toHaveLength(SEGMENTS.length);
    // Outside the stage, hidden from screen readers (they have the transcript), in step with the bar.
    const caption = container.querySelector('.mr-caption') as HTMLElement;
    expect(container.querySelector('.mr-stage')?.contains(caption)).toBe(false);
    expect(caption).toHaveAttribute('aria-hidden', 'true');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Перейти: Шпаргалка' }));
    });
    expect(plain(caption.textContent)).toBe(`Шпаргалка. ${plain(CAPTIONS[4])}`);
    // No numbers of its own: the film's numbers stay in the film.
    for (const line of CAPTIONS) expect(line).not.toMatch(/\d/);
  });

  it('keeps only «MELDY» in the corners: no brackets, chapter label, timecode or chapter dots', () => {
    const { container } = render(<MeldyReel />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Перейти: Шпаргалка' }));
    });
    expect(container.querySelector('.mr-hud')?.textContent).toBe('MELDY');
    expect(container.querySelectorAll('.mr-hud > *')).toHaveLength(1);
  });

  it('with reduced motion waits on its poster until asked to play, then plays from the start', () => {
    reduced = true;
    render(<MeldyReel />);
    showReel(true);
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Перейти: ${segmentOf(POSTER_AT).label}` })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть ролик' }));
    expect(screen.queryByRole('button', { name: 'Смотреть ролик' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перейти: Начало' })).toHaveAttribute('aria-current', 'step');
  });

  it('offers the frame exporter a clock it can step, and does not play by itself then', async () => {
    window.__MELDY_REEL_EXPORT__ = true;
    try {
      render(<MeldyReel />);
      showReel(true);
      expect(window.__meldyReel?.total).toBe(TOTAL);
      expect(screen.queryByRole('button', { name: 'Пауза' })).not.toBeInTheDocument();
    } finally {
      delete window.__MELDY_REEL_EXPORT__;
    }
  });
});
