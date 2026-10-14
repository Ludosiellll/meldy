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
