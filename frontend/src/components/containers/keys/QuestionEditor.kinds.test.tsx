import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The editor's fields of the kinds of release 48 and the draft it hands to the page (release 51/52): what the author
 * types is what the page gets, field by field, and the lines that follow the words (the range of a number, the gaps of
 * a cloze) follow them.
 */

const lectures = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));
vi.mock('../../../api/materials', () => ({ listLectures: lectures.list }));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

import QuestionEditor from './QuestionEditor';
import { EDITOR } from '../copyImport';
import { draftOf, emptyDraft, type Draft } from './editorModel';
import type { TestItem } from '../../../types/container';

const C = '11111111-2222-4333-8444-555555555555';

const ITEM: TestItem = {
  id: 'i1',
  container_id: C,
  subject_id: 's1',
  position: 3,
  file_no: '3',
  topic: null,
  kind: 'single',
  stem: 'Что означает стрелка слева?',
  options: ['Вход', 'Управление', 'Выход'],
  correct: [0],
  answers: [],
  key_source: 'manual',
  code: false,
  keep_order: false,
  flags: [],
  rev: 1,
  updated_at: '2026-10-16T00:00:00Z',
  images: null,
};

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof QuestionEditor>[0]> = {}) {
  const onSave = vi.fn();
  render(<QuestionEditor containerId={C} item={null} context="Новый вопрос" group={false} onSave={onSave} onCancel={vi.fn()} upload={vi.fn(async () => 'kept' as const)} {...over} />);
  return { onSave };
}

const type = (label: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });
const valueOf = (label: string) => (screen.getByRole('textbox', { name: label }) as HTMLInputElement).value;
const save = () => fireEvent.click(screen.getByRole('button', { name: EDITOR.add }));

describe('QuestionEditor: the kinds of release 48', () => {
  it('«Число»: the numbers, the tolerance and the unit as typed, the range line following them', () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByLabelText('Число'));
    type(EDITOR.stem, 'Ускорение свободного падения?');
    type('Верное число', '9,8');
    expect(screen.getByText('Засчитаем ровно 9,8.')).toBeInTheDocument();
    type('Допуск, ±', '0,1');
    type('Единица', 'м/с²');
    expect(screen.getByText('Засчитаем от 9,7 до 9,9 м/с².')).toBeInTheDocument();
    type('Верное число', '');
    expect(screen.queryByText(/^Засчитаем/)).toBeNull();
    type('Верное число', '9,81; 9,8');
    save();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toEqual({
      ...emptyDraft(),
      stem: 'Ускорение свободного падения?',
      kind: 'number',
      options: [],
      numbers: '9,81; 9,8',
      tolerance: '0,1',
      unit: 'м/с²',
      rights: [],
      extras: [],
      gaps: [],
      materialIds: [],
      partial: false,
    } satisfies Draft);
  });

  it('«Порядок»: the items typed and moved keep their words', () => {
    const order: TestItem = { ...ITEM, kind: 'order', stem: 'Расставьте по порядку', options: ['Вход', 'Управление', 'Выход'], correct: [], partial: false };
    const { onSave } = setup({ item: order });
    type('Пункт 2', 'Управление и связь');
    fireEvent.click(screen.getByRole('button', { name: 'Пункт 2 выше' }));
    expect([valueOf('Пункт 1'), valueOf('Пункт 2'), valueOf('Пункт 3')]).toEqual(['Управление и связь', 'Вход', 'Выход']);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать пункт 2' }));
    expect([valueOf('Пункт 1'), valueOf('Пункт 2')]).toEqual(['Управление и связь', 'Выход']);
    fireEvent.click(screen.getByRole('button', { name: 'Добавить пункт' }));
    expect(valueOf('Пункт 3')).toBe('');
    type('Пункт 3', 'Итог');
    fireEvent.click(screen.getByRole('checkbox', { name: /Частичный балл/ }));
    fireEvent.click(screen.getByRole('button', { name: EDITOR.save }));
    expect(onSave.mock.calls[0][0]).toEqual({
      ...draftOf(order),
      options: [
        { text: 'Управление и связь', pictures: [] },
        { text: 'Выход', pictures: [] },
        { text: 'Итог', pictures: [] },
      ],
      partial: true,
    });
  });

  it('«Соответствие»: the pairs, their right items and the extras as typed; a pair taken out takes its right item', () => {
    const match: TestItem = { ...ITEM, kind: 'match', stem: 'Сопоставьте', options: ['Вход', 'Выход'], answers: ['слева', 'справа', 'сверху'], correct: [] };
    const { onSave } = setup({ item: match });
    expect([valueOf('Пара строки 1'), valueOf('Пара строки 2'), valueOf('Лишний ответ 1')]).toEqual(['слева', 'справа', 'сверху']);
    type('Пара строки 2', 'справа, из блока');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить пару' }));
    type('Строка 3', 'Управление');
    type('Пара строки 3', 'сверху');
    type('Лишний ответ 1', 'снизу');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить лишний ответ' }));
    type('Лишний ответ 2', 'сбоку');
    fireEvent.click(screen.getByRole('button', { name: 'Убрать пару 1' }));
    expect([valueOf('Строка 1'), valueOf('Пара строки 1'), valueOf('Строка 2'), valueOf('Пара строки 2')]).toEqual(['Выход', 'справа, из блока', 'Управление', 'сверху']);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать лишний ответ 1' }));
    expect(valueOf('Лишний ответ 1')).toBe('сбоку');
    fireEvent.click(screen.getByRole('button', { name: EDITOR.save }));
    expect(onSave.mock.calls[0][0]).toEqual({
      ...draftOf(match),
      options: [
        { text: 'Выход', pictures: [] },
        { text: 'Управление', pictures: [] },
      ],
      rights: ['справа, из блока', 'сверху'],
      extras: ['сбоку'],
    });
  });

  it('«Пропуски в тексте»: a gap typed into the text brings its field; a gap taken out and put back keeps its forms', () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByLabelText('Пропуски в тексте'));
    expect(screen.getByText('В тексте пока нет пропуска.')).toBeInTheDocument();
    type(EDITOR.stem, 'Столица Франции — ___.');
    expect(screen.queryByText('В тексте пока нет пропуска.')).toBeNull();
    type('Пропуск 1: верные ответы', 'Париж; Paris');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить пропуск в конец текста' }));
    expect(valueOf(EDITOR.stem)).toBe('Столица Франции — ___. ___');
    expect(valueOf('Пропуск 2: верные ответы')).toBe('');
    type('Пропуск 2: верные ответы', 'Сена');
    type(EDITOR.stem, 'Столица Франции — Париж.');
    expect(screen.queryByRole('textbox', { name: 'Пропуск 1: верные ответы' })).toBeNull();
    type(EDITOR.stem, 'Столица Франции — ___, река — ___.');
    expect([valueOf('Пропуск 1: верные ответы'), valueOf('Пропуск 2: верные ответы')]).toEqual(['Париж; Paris', 'Сена']);
    type('Пропуск 1: верные ответы', 'Париж');
    save();
    expect(onSave.mock.calls[0][0]).toEqual({
      ...emptyDraft(),
      stem: 'Столица Франции — ___, река — ___.',
      kind: 'cloze',
      options: [],
      numbers: '',
      tolerance: '',
      unit: '',
      rights: [],
      extras: [],
      gaps: ['Париж', 'Сена'],
      materialIds: [],
      partial: false,
    } satisfies Draft);
  });

  it('«Развёрнутый ответ»: the lectures ticked go with the draft', async () => {
    lectures.list.mockResolvedValue([
      { id: 'l1', title: 'Лекция 1' },
      { id: 'l2', title: 'Лекция 2' },
    ]);
    const { onSave } = setup();
    fireEvent.click(screen.getByLabelText('Развёрнутый ответ'));
    type(EDITOR.stem, 'Объясните, что такое шлюз.');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Лекция 2' }));
    save();
    expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ kind: 'essay', stem: 'Объясните, что такое шлюз.', materialIds: ['l2'] }));
  });

  it('a kind switched keeps the words of the question and the explanation typed', () => {
    setup();
    type(EDITOR.stem, 'Сколько будет 2 + 2?');
    type(EDITOR.explanation, 'Два и два — четыре.');
    fireEvent.click(screen.getByLabelText('Число'));
    expect(valueOf(EDITOR.stem)).toBe('Сколько будет 2 + 2?');
    expect(valueOf(EDITOR.explanation)).toBe('Два и два — четыре.');
    fireEvent.click(screen.getByLabelText(EDITOR.kindShort));
    type(EDITOR.forms, 'четыре; 4');
    fireEvent.click(screen.getByLabelText(EDITOR.kindChoice));
    expect(valueOf(EDITOR.option('А'))).toBe('');
    expect(valueOf(EDITOR.stem)).toBe('Сколько будет 2 + 2?');
  });
});

describe('QuestionEditor: the draft the page keeps (release 51/52: initialDraft, onDraft, handle)', () => {
  it('takes the page’s draft, tells every change, and never the first draft', () => {
    const kept: Draft = { ...draftOf(ITEM), stem: 'Что означает стрелка справа?' };
    const onDraft = vi.fn();
    const onDirty = vi.fn();
    setup({ item: ITEM, initialDraft: kept, onDraft, onDirty });
    expect(valueOf(EDITOR.stem)).toBe('Что означает стрелка справа?');
    expect(onDraft).not.toHaveBeenCalled();
    expect(onDirty).toHaveBeenLastCalledWith(true);
    type(EDITOR.option('Б'), 'Управление и связь');
    expect(onDraft).toHaveBeenLastCalledWith({ ...kept, options: [kept.options[0], { text: 'Управление и связь', pictures: [] }, kept.options[2]] });
    fireEvent.click(screen.getByLabelText(EDITOR.right('В')));
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ correct: [0, 2] }));
    type(EDITOR.stem, ITEM.stem);
    type(EDITOR.option('Б'), 'Управление');
    fireEvent.click(screen.getByLabelText(EDITOR.right('В')));
    expect(onDraft).toHaveBeenLastCalledWith(draftOf(ITEM));
    expect(onDirty).toHaveBeenLastCalledWith(false);
  });

  it('the page’s «Сохранить» (handle) saves what was typed last, and answers true when nothing is left', async () => {
    const handle = { current: null as null | { save: () => Promise<boolean> } };
    const onSave = vi.fn(async () => true);
    setup({ item: ITEM, onSave, handle });
    expect(await handle.current!.save()).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    type(EDITOR.explanation, 'Слева входит то, что блок меняет.');
    let saved = false;
    await act(async () => {
      saved = await handle.current!.save();
    });
    expect(saved).toBe(true);
    expect(onSave).toHaveBeenCalledWith({ ...draftOf(ITEM), explanation: 'Слева входит то, что блок меняет.' });
    // A problem stops it: the stem emptied.
    type(EDITOR.stem, '');
    await act(async () => {
      saved = await handle.current!.save();
    });
    expect(saved).toBe(false);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(within(document.querySelector('.qe-notes') as HTMLElement).getByText(EDITOR.problems.stem)).toBeInTheDocument();
  });
});
