import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ parsePaste: vi.fn() }));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  parsePaste: api.parsePaste,
}));

import TextView from '../studio/TextView';
import type { Studio } from '../studio/useStudio';
import { STUDIO } from '../studio/copyStudio';
import { checkTest } from '../../lib/studio/checker';
import { emptyDoc } from '../../lib/studio/doc';
import { fromText } from '../../lib/studio/textFormat';
import type { TestDoc } from '../../types/testDoc';
import { STUDIO_PASTE } from './copyQuick';
import { looksLikeQuestion, questionParagraphs, replaceParagraphs, studioMarkup } from './studioPaste';
import { bankItem, bankResult, CHEMISTRY } from './testkit';

/* The studio's Word paste that gave no questions (UX audit of 21.10, P3; mockup m6). */

const WORD = ['1. Сколько будет 2 + 2?', 'а) 3', 'б) 4', 'в) 5', '', '2. Столица Франции?', 'а) Берлин', 'б) Париж', 'в) Рим'].join('\n');

describe('looksLikeQuestion', () => {
  it('a numbered question with variants or an answer line', () => {
    expect(looksLikeQuestion('1. Сколько будет 2 + 2?\nа) 3\nб) 4')).toBe(true);
    expect(looksLikeQuestion('2) Формула воды?\na) H2O   b) HO')).toBe(true);
    expect(looksLikeQuestion('3. Сколько атомов?\nОтвет: 2')).toBe(true);
    expect(looksLikeQuestion('Вопрос 4. Самая большая планета?\nА) Земля\nБ) Юпитер')).toBe(true);
  });
  it('not a paragraph of words, a list without variants, one line', () => {
    expect(looksLikeQuestion('Ответьте на все вопросы. Время — урок.')).toBe(false);
    expect(looksLikeQuestion('1. Купить хлеб\n2. Позвонить маме')).toBe(false);
    expect(looksLikeQuestion('1. Сколько будет 2 + 2? а) 3 б) 4')).toBe(false);
  });
});

describe('studioMarkup and replaceParagraphs', () => {
  it('writes the questions in the marks of «Текст», which reads them back as questions', () => {
    const made = studioMarkup(CHEMISTRY);
    expect(made).toMatchObject({ found: 4, noKey: 1 });
    expect(made.markup.split('\n\n')[0]).toBe('Удачи!');
    expect(made.markup).toContain('Какой индикатор краснеет в кислой среде?\n- фенолфталеин\n+ лакмус\n- метилоранж');
    expect(made.markup).toContain('Сколько атомов водорода в молекуле воды?\n= 2');
    const keyed = studioMarkup(bankResult(CHEMISTRY.items.slice(0, 3)));
    const read = fromText(keyed.markup, emptyDoc('Т'), []);
    expect(read.problems).toEqual([]);
    expect(read.adds).toHaveLength(3);
  });

  it('a question with neither variants nor answer stays a paragraph; a line that would read as a mark is kept as words', () => {
    const made = studioMarkup(bankResult([bankItem({ text: '# не заголовок' }), bankItem({ text: 'Вопрос?', options: ['да', 'нет'], correct: [0] })]));
    expect(made.found).toBe(1);
    expect(made.markup.split('\n\n')[0]).toBe('\\# не заголовок');
  });

  it('the pasted paragraphs give way to the questions where the first of them stood', () => {
    const text = `# Тест\n\n${WORD}\n\nУдачи!\n`;
    const paragraphs = WORD.split('\n\n');
    expect(replaceParagraphs(text, paragraphs, 'ВОПРОСЫ')).toBe('# Тест\n\nВОПРОСЫ\n\nУдачи!\n');
    expect(replaceParagraphs('', ['нет такого'], 'ВОПРОСЫ')).toBe('ВОПРОСЫ\n');
  });

  it('questionParagraphs: only new paragraphs, and only when they read like questions', () => {
    const before = emptyDoc('Т');
    const after = fromText(WORD, before, []).doc;
    expect(questionParagraphs(before, after)).toEqual(WORD.split('\n\n'));
    const words = fromText('Просто текст.\n\nИ ещё абзац.', before, []).doc;
    expect(questionParagraphs(before, words)).toEqual([]);
    expect(questionParagraphs(after, after)).toEqual([]);
  });
});

describe('«Проверка теста» on a page without questions', () => {
  it('says there is no question with its answer instead of «ничего не нашла»', () => {
    const doc: TestDoc = fromText('Просто текст.', emptyDoc('Кислоты'), []).doc;
    expect(checkTest(doc, []).map((hint) => [hint.id, hint.level, hint.message])).toEqual([['no_keyed', 'fix', STUDIO_PASTE.checkNoKeyed]]);
    expect(checkTest(emptyDoc('Кислоты'), [])).toEqual([]);
  });
});

describe('TextView: «Применить» on Word text', () => {
  let studio: Studio;
  beforeEach(() => {
    api.parsePaste.mockReset();
    studio = { doc: emptyDoc('Т'), applyText: vi.fn().mockResolvedValue(undefined) } as unknown as Studio;
  });
  afterEach(() => cleanup());

  const field = () => screen.getByLabelText(STUDIO.textLabel) as HTMLTextAreaElement;

  it('asks before turning the questions into paragraphs; «Сделать вопросами» applies them as questions', async () => {
    api.parsePaste.mockResolvedValue(
      bankResult([
        bankItem({ text: 'Сколько будет 2 + 2?', options: ['3', '4', '5'], correct: [1] }),
        bankItem({ text: 'Столица Франции?', options: ['Берлин', 'Париж', 'Рим'], correct: [1] }),
      ]),
    );
    render(<TextView studio={studio} items={[]} start="" />);
    fireEvent.change(field(), { target: { value: WORD } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO.textApply }));
    expect(screen.getByText(STUDIO_PASTE.noneTitle)).toBeInTheDocument();
    expect(studio.applyText).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: STUDIO_PASTE.make }));
    });
    await waitFor(() => expect(studio.applyText).toHaveBeenCalledTimes(1));
    expect(api.parsePaste).toHaveBeenCalledWith(WORD);
    const applied = (studio.applyText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(applied.adds).toHaveLength(2);
    expect(applied.problems).toEqual([]);
  });

  it('a question without its answer: the text keeps it, and its problem line says where to put «+»', async () => {
    api.parsePaste.mockResolvedValue(bankResult([bankItem({ text: 'Сколько будет 2 + 2?', options: ['3', '4', '5'] })]));
    render(<TextView studio={studio} items={[]} start="" />);
    fireEvent.change(field(), { target: { value: WORD.split('\n\n')[0] } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO.textApply }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: STUDIO_PASTE.make }));
    });
    expect(field().value).toContain('Сколько будет 2 + 2?\n- 3\n- 4\n- 5');
    expect(await screen.findByText(/нет верного варианта/)).toBeInTheDocument();
    expect(studio.applyText).not.toHaveBeenCalled();
  });

  it('«Оставить текстом» applies the paragraphs as they are', async () => {
    render(<TextView studio={studio} items={[]} start="" />);
    fireEvent.change(field(), { target: { value: WORD } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO.textApply }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: STUDIO_PASTE.asText }));
    });
    await waitFor(() => expect(studio.applyText).toHaveBeenCalledTimes(1));
    expect(api.parsePaste).not.toHaveBeenCalled();
  });

  it('nothing found: says how to write a question', async () => {
    api.parsePaste.mockResolvedValue(bankResult([]));
    render(<TextView studio={studio} items={[]} start="" />);
    fireEvent.change(field(), { target: { value: WORD } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO.textApply }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: STUDIO_PASTE.make }));
    });
    expect(await screen.findByText(STUDIO_PASTE.notFound)).toBeInTheDocument();
  });

  it('text in the marks is applied at once, as before', async () => {
    render(<TextView studio={studio} items={[]} start="" />);
    fireEvent.change(field(), { target: { value: 'Сколько будет 2 + 2?\n- 3\n+ 4' } });
    fireEvent.click(screen.getByRole('button', { name: STUDIO.textApply }));
    await waitFor(() => expect(studio.applyText).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(STUDIO_PASTE.noneTitle)).toBeNull();
  });
});
