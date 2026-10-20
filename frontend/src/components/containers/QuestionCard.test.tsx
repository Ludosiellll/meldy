import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TestItem } from '../../types/container';

const pictures = vi.hoisted(() => ({ pictureUrl: vi.fn() }));
vi.mock('../../api/itemPictures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/itemPictures')>()),
  pictureUrl: pictures.pictureUrl,
}));

import QuestionCard from './QuestionCard';
import * as copy from './copy';

const C = '11111111-2222-4333-8444-555555555555';
const path = (char: string) => `${C}/${char.repeat(64)}.png`;

function item(patch: Partial<TestItem> = {}): TestItem {
  return {
    id: 'i1', container_id: C, subject_id: 's1', position: 1, file_no: '17', topic: null, kind: 'single',
    stem: 'Вопрос на картинке', options: ['Рисунок А', 'Рисунок Б', 'Вход'], correct: [1], answers: [], key_source: 'bold',
    code: false, keep_order: false, flags: [], rev: 1, updated_at: '', images: { stem: [path('a')], options: [[path('b')], [path('c')], []] },
    ...patch,
  };
}

function card(entry: TestItem) {
  return render(
    <QuestionCard
      item={entry}
      order={[0, 1, 2]}
      context="Схемы"
      mode="learn"
      answered={null}
      ticked={[]}
      text=""
      onPick={() => undefined}
      onText={() => undefined}
      onSubmitText={() => undefined}
    />,
  );
}

beforeEach(() => {
  pictures.pictureUrl.mockReset();
});
afterEach(cleanup);

describe('a question with pictures (owner, 2026-10-14: «а если вопрос является картинкой»)', () => {
  it('shows the stem’s and the options’ pictures; the stand-in words are for screen readers only', async () => {
    pictures.pictureUrl.mockImplementation(async (p: string) => `blob:${p.slice(37, 38)}`);
    const { container } = card(item());
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(3));
    expect([...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual(['blob:a', 'blob:b', 'blob:c']);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Вопрос на картинке');
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('sr-only');
    const options = screen.getAllByRole('button');
    expect(options[0]).toHaveTextContent('Рисунок А');
    expect(options[0].querySelector('.sr-only')).toHaveTextContent('Рисунок А');
    expect(options[2].querySelector('.sr-only')).toBeNull();
    expect(options[2]).toHaveTextContent('Вход');
  });

  it('words with a picture stay visible; a picture that did not load says so and tries again', async () => {
    pictures.pictureUrl.mockRejectedValueOnce(new Error('offline')).mockResolvedValue('blob:ok');
    const { container } = card(item({ stem: 'Что означает выделенная стрелка?', images: { stem: [path('a')], options: [] } }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Что означает выделенная стрелка?');
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveClass('sr-only');
    await screen.findByText(copy.PICTURE_FAILED);
    fireEvent.click(screen.getByRole('button', { name: copy.PICTURE_RETRY }));
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'blob:ok'));
    expect(pictures.pictureUrl).toHaveBeenCalledTimes(2);
  });

  it('a question without pictures renders as before', () => {
    const { container } = card(item({ stem: 'Сколько бит в байте?', options: ['8', '16'], correct: [0], images: null }));
    expect(container.querySelector('.ct-pics')).toBeNull();
    expect(pictures.pictureUrl).not.toHaveBeenCalled();
  });
});

describe('the next question gets buttons of its own (owner, 2026-10-20: a lighter option on the next question)', () => {
  // A phone keeps :hover on the button it tapped; a button kept for the next question kept it, and keyed by the file's
  // place it was the option at the place of the key just tapped. Both keys here are the file's first option.
  const first = item({ id: 'q1', stem: 'Первый', options: ['Ключ 1', 'Нет 1', 'Нет 1б'], correct: [0], images: null });
  const second = item({ id: 'q2', stem: 'Второй', options: ['Ключ 2', 'Нет 2', 'Нет 2б'], correct: [0], images: null });
  const props = { order: [0, 1, 2], context: 'Тест', ticked: [], text: '', onPick: () => undefined, onText: () => undefined, onSubmitText: () => undefined };

  it.each(['learn', 'mock'] as const)('%s: no option of the last question is reused', (mode) => {
    const { rerender } = render(<QuestionCard item={first} mode={mode} answered={null} {...props} />);
    const before = screen.getAllByRole('button');
    rerender(<QuestionCard item={second} mode={mode} answered={null} {...props} />);
    const after = screen.getAllByRole('button');
    expect(after.map((b) => b.textContent)).toEqual(['АКлюч 2', 'БНет 2', 'ВНет 2б']);
    expect(after.some((b) => before.includes(b))).toBe(false);
  });

  it('a short answer’s field too', () => {
    const short = (id: string) => item({ id, kind: 'short', stem: id, options: [], correct: [], answers: ['x'], images: null });
    const { rerender } = render(<QuestionCard item={short('s1')} mode="learn" answered={null} {...props} order={[]} />);
    const field = screen.getByRole('textbox');
    rerender(<QuestionCard item={short('s2')} mode="learn" answered={null} {...props} order={[]} />);
    expect(screen.getByRole('textbox')).not.toBe(field);
  });
});
