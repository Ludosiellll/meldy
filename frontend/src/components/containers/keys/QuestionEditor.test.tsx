import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import QuestionEditor from './QuestionEditor';
import { EDITOR, nb } from '../copyImport';
import { EXPLANATION_MAX, type TestItem } from '../../../types/container';

const C = '11111111-2222-4333-8444-555555555555';

const ITEM: TestItem = {
  id: 'i1',
  container_id: C,
  subject_id: 's1',
  position: 116,
  file_no: '116',
  topic: null,
  kind: 'single',
  stem: 'Что означает стрелка слева?',
  options: ['Вход', 'Управление', 'Выход'],
  correct: [0],
  answers: [],
  key_source: 'bold',
  code: false,
  keep_order: false,
  flags: [],
  rev: 1,
  updated_at: '2026-10-16T00:00:00Z',
  images: null,
};

afterEach(cleanup);

/** The words as the screen shows them (numbers glued to their words). */
const shown = (text: string) => nb(text);
/** The words with plain spaces (text matchers read a no-break space as one). */
const plain = (text: string) => text.replace(/\u00a0/g, ' ');
/** The live line under the options. */
const line = () => document.querySelector('.qe-kind-line p') as HTMLElement;

function setup(over: Partial<Parameters<typeof QuestionEditor>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const upload = vi.fn(async () => 'kept' as const);
  render(<QuestionEditor containerId={C} item={ITEM} context="Вариант 1 · № 116" group={false} onSave={onSave} onCancel={onCancel} upload={upload} {...over} />);
  return { onSave, onCancel, upload };
}

describe('QuestionEditor', () => {
  it('shows the question and saves the new words', () => {
    const { onSave } = setup();
    const stem = screen.getByLabelText(EDITOR.stem) as HTMLTextAreaElement;
    expect(stem.value).toBe('Что означает стрелка слева?');
    expect((screen.getByLabelText(EDITOR.option('В')) as HTMLTextAreaElement).value).toBe('Выход');
    fireEvent.change(stem, { target: { value: 'Что означает стрелка, входящая в блок слева?' } });
    fireEvent.click(screen.getByRole('button', { name: EDITOR.save }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stem: 'Что означает стрелка, входящая в блок слева?', correct: [0] }));
  });

  it('does not save when nothing changed', () => {
    const { onSave } = setup();
    expect(screen.getByRole('button', { name: EDITOR.save })).toBeDisabled();
    expect(screen.getByText(EDITOR.nothing)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('takes the key away with its option', () => {
    setup();
    expect(screen.getByText(EDITOR.ticked([0], false))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: EDITOR.removeOption('А') }));
    expect(screen.getByText(EDITOR.ticked([], false))).toBeInTheDocument();
    expect(screen.getByText(EDITOR.noKey)).toBeInTheDocument();
    expect((screen.getByLabelText(EDITOR.option('А')) as HTMLTextAreaElement).value).toBe('Управление');
  });

  it('says the missing key in the page’s own words when it gives them', () => {
    setup({ item: { ...ITEM, correct: [] }, noKeyNote: 'Не отмечен верный ответ.' });
    expect(screen.getByText('Не отмечен верный ответ.')).toBeInTheDocument();
    expect(screen.queryByText(EDITOR.noKey)).toBeNull();
  });

  it('warns the group before a key change', () => {
    setup({ group: true });
    fireEvent.click(screen.getByLabelText(EDITOR.right('В')));
    expect(screen.getByText(EDITOR.resets)).toBeInTheDocument();
  });

  it('puts a pasted picture under the option it was pasted into', async () => {
    const { upload } = setup();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'shot.png', { type: 'image/png' });
    fireEvent.paste(screen.getByLabelText(EDITOR.option('Б')), { clipboardData: { files: [file] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const calls = upload.mock.calls as unknown as Array<[string, unknown]>;
    expect(calls[0][0]).toMatch(new RegExp(`^${C}/[0-9a-f]{64}\\.png$`));
    await waitFor(() => expect(screen.getByRole('list', { name: EDITOR.option('Б') })).toBeInTheDocument());
    expect(screen.queryByRole('list', { name: EDITOR.pictures })).toBeNull();
  });

  it('keeps pasted words as words', () => {
    const { upload } = setup();
    fireEvent.paste(screen.getByLabelText(EDITOR.stem), { clipboardData: { files: [] } });
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses to save a question with one option and says why', () => {
    setup({ item: null, context: 'Новый вопрос' });
    fireEvent.change(screen.getByLabelText(EDITOR.stem), { target: { value: 'Что такое шлюз?' } });
    fireEvent.change(screen.getByLabelText(EDITOR.option('А')), { target: { value: 'Узел' } });
    expect(screen.getByText(EDITOR.problems.option_empty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EDITOR.add })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(EDITOR.option('Б')), { target: { value: 'Поток' } });
    expect(screen.getByRole('button', { name: EDITOR.add })).toBeEnabled();
  });

  it('lets a new question be a short answer', () => {
    const { onSave } = setup({ item: null, context: 'Новый вопрос' });
    fireEvent.click(screen.getByLabelText(EDITOR.kindShort));
    fireEvent.change(screen.getByLabelText(EDITOR.stem), { target: { value: 'Как называется ромб в BPMN?' } });
    fireEvent.change(screen.getByLabelText(EDITOR.forms), { target: { value: 'Шлюз; gateway' } });
    fireEvent.click(screen.getByRole('button', { name: EDITOR.add }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ short: true, forms: 'Шлюз; gateway' }));
  });

  it('shows the saved explanation and saves a new one without warning the group', () => {
    const { onSave } = setup({ group: true, item: { ...ITEM, explanation: 'Слева входит то, что блок меняет.' } });
    const field = screen.getByLabelText(EDITOR.explanation) as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.value).toBe('Слева входит то, что блок меняет.');
    fireEvent.change(field, { target: { value: 'Слева — вход.\nСверху — управление.' } });
    // An explanation never restarts the question.
    expect(screen.queryByText(EDITOR.resets)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: EDITOR.save }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ explanation: 'Слева — вход.\nСверху — управление.' }));
  });

  it('the explanation may stay empty; a new question saves without one', () => {
    const { onSave } = setup({ item: null, context: 'Новый вопрос' });
    expect((screen.getByLabelText(EDITOR.explanation) as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByLabelText(EDITOR.stem), { target: { value: 'Что такое шлюз?' } });
    fireEvent.change(screen.getByLabelText(EDITOR.option('А')), { target: { value: 'Узел' } });
    fireEvent.change(screen.getByLabelText(EDITOR.option('Б')), { target: { value: 'Поток' } });
    fireEvent.click(screen.getByRole('button', { name: EDITOR.add }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ explanation: '' }));
  });

  it('counts the characters near the limit and says when the explanation is too long', () => {
    setup();
    const field = screen.getByLabelText(EDITOR.explanation);
    fireEvent.change(field, { target: { value: 'я'.repeat(100) } });
    expect(screen.queryByText(EDITOR.explanationCount(100, EXPLANATION_MAX))).toBeNull();
    fireEvent.change(field, { target: { value: 'я'.repeat(1900) } });
    expect(screen.getByText(EDITOR.explanationCount(1900, EXPLANATION_MAX))).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription(EDITOR.explanationCount(1900, EXPLANATION_MAX));
    expect(screen.getByRole('button', { name: EDITOR.save })).toBeEnabled();
    fireEvent.change(field, { target: { value: 'я'.repeat(EXPLANATION_MAX + 5) } });
    expect(screen.getByText(EDITOR.explanationCount(EXPLANATION_MAX + 5, EXPLANATION_MAX))).toHaveAttribute('data-over');
    expect(screen.getByText(EDITOR.problems.explanation_long)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: EDITOR.save })).toBeDisabled();
  });

  it('cancels', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: EDITOR.cancel }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('QuestionEditor: the options as compact rows (release 47, M3–M5)', () => {
  const field = (l: string) => screen.getByLabelText(EDITOR.option(l)) as HTMLTextAreaElement;

  it('each row has its tick, its field, a picture button and «×», named for screen readers', () => {
    setup();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    for (const [index, l] of ['А', 'Б', 'В'].entries()) {
      expect(screen.getByRole('checkbox', { name: EDITOR.right(l) })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: EDITOR.optionPicture(l) }).closest('li')).toBe(rows[index]);
      expect(screen.getByRole('button', { name: EDITOR.removeOption(l) }).closest('li')).toBe(rows[index]);
    }
    // The words of the hint stay in the page; a touch screen hides them (keys.css, pointer: coarse).
    expect(screen.getByText(EDITOR.pasteHint)).toHaveClass('qe-hint');
  });

  it('Enter goes to the next option, adds one after the last, Shift+Enter is left to the field', () => {
    setup();
    field('А').focus();
    expect(fireEvent.keyDown(field('А'), { key: 'Enter' })).toBe(false);
    expect(field('Б')).toHaveFocus();
    // Shift+Enter breaks the line: the editor does not take it.
    expect(fireEvent.keyDown(field('Б'), { key: 'Enter', shiftKey: true })).toBe(true);
    expect(field('Б')).toHaveFocus();
    fireEvent.keyDown(field('Б'), { key: 'Enter' });
    expect(field('В')).toHaveFocus();
    fireEvent.keyDown(field('В'), { key: 'Enter' });
    expect(field('Г')).toHaveValue('');
    expect(field('Г')).toHaveFocus();
  });

  it('Enter in the last of eight options goes on to the explanation', () => {
    setup({ item: { ...ITEM, options: ['1', '2', '3', '4', '5', '6', '7', '8'] } });
    fireEvent.keyDown(field('З'), { key: 'Enter' });
    expect(screen.queryByLabelText(EDITOR.option('И'))).toBeNull();
    expect(screen.getByLabelText(EDITOR.explanation)).toHaveFocus();
  });

  it('grows every field to its text on each input', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this instanceof HTMLTextAreaElement ? 44 + 23 * (this.value.split('\n').length - 1) : 0;
    });
    setup();
    expect(field('А').style.height).toBe('44px');
    fireEvent.change(field('А'), { target: { value: 'Вход\nслева\nв блок' } });
    expect(field('А').style.height).toBe('90px');
    expect(field('Б').style.height).toBe('44px');
    height.mockRestore();
  });

  it('the line under the options says what is ticked and what the student does', () => {
    setup();
    expect(line()).toHaveTextContent(plain(EDITOR.ticked([0], false)));
    fireEvent.click(screen.getByLabelText(EDITOR.right('В')));
    // The author chose one answer and ticked two: the question is saved with several, and the line says so.
    expect(line()).toHaveTextContent(plain(EDITOR.ticked([0, 2], false, true)));
    expect(line().textContent).toMatch(/^Отмечено\s2\sверных — ученик выберет несколько\. Вопрос сохранится как «Несколько ответов»$/);
  });

  it('keeps «несколько ответов» with one tick, and offers one answer back', () => {
    const { onSave } = setup({ item: { ...ITEM, kind: 'multiple', correct: [0, 1] } });
    fireEvent.click(screen.getByLabelText(EDITOR.right('Б')));
    expect(line().textContent).toMatch(/^Отмечен\s1\sверный — ученик может отметить несколько$/);
    fireEvent.click(screen.getByRole('button', { name: EDITOR.save }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ correct: [0], multiple: true }));
    fireEvent.click(screen.getByRole('button', { name: EDITOR.makeSingle }));
    expect(line()).toHaveTextContent(plain(EDITOR.ticked([0], false)));
    expect(screen.queryByRole('button', { name: EDITOR.makeSingle })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: EDITOR.save }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ correct: [0], multiple: false }));
  });

  it('«верно / неверно»: one tick at a time, two fixed options without pictures', () => {
    const { onSave } = setup({ item: { ...ITEM, options: ['Верно', 'Неверно'], correct: [], keep_order: true }, trueFalse: true });
    const right = screen.getByRole('radio', { name: EDITOR.right('А') });
    const wrong = screen.getByRole('radio', { name: EDITOR.right('Б') });
    fireEvent.click(right);
    expect(right).toBeChecked();
    fireEvent.click(wrong);
    expect(wrong).toBeChecked();
    expect(right).not.toBeChecked();
    expect(screen.queryByRole('button', { name: EDITOR.optionPicture('А') })).toBeNull();
    expect(screen.queryByRole('button', { name: EDITOR.removeOption('А') })).toBeNull();
    expect(screen.queryByRole('button', { name: EDITOR.addOption })).toBeNull();
    expect(line()).toHaveTextContent(plain(EDITOR.ticked([1], false)));
    // Enter in the last option goes on to the explanation: no third option.
    fireEvent.keyDown(field('Б'), { key: 'Enter' });
    expect(screen.queryByLabelText(EDITOR.option('В'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: EDITOR.save }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ correct: [1] }));
  });
});

describe('QuestionEditor: changes not saved (release 47, B3) and the writing loop (M2)', () => {
  it('tells the page when it holds changes and when it no longer does', () => {
    const onDirty = vi.fn();
    setup({ onDirty });
    expect(onDirty).toHaveBeenLastCalledWith(false);
    fireEvent.change(screen.getByLabelText(EDITOR.stem), { target: { value: 'Другой текст' } });
    expect(onDirty).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByLabelText(EDITOR.stem), { target: { value: ITEM.stem } });
    expect(onDirty).toHaveBeenLastCalledWith(false);
  });

  it('asks inside itself; «Не сохранять» lets the changes go', () => {
    const onDiscard = vi.fn();
    const { onSave } = setup({ onDiscard, onSaveNext: vi.fn(), unsaved: EDITOR.unsaved(3) });
    const ask = screen.getByRole('group', { name: shown(EDITOR.unsaved(3)) });
    expect(ask).toHaveTextContent(/^В вопросе\s3\sесть несохранённые правки/);
    // In place of the editor's own buttons; nothing changed here, so «Сохранить» waits and the focus is on «Не сохранять».
    expect(screen.queryByRole('button', { name: EDITOR.cancel })).toBeNull();
    expect(screen.queryByRole('button', { name: EDITOR.saveNext })).toBeNull();
    expect(within(ask).getByRole('button', { name: EDITOR.save })).toBeDisabled();
    expect(within(ask).getByRole('button', { name: EDITOR.discard })).toHaveFocus();
    fireEvent.click(within(ask).getByRole('button', { name: EDITOR.discard }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a question with changes: «Сохранить» takes the focus when asked and saves (not «и следующий»)', () => {
    const onSave = vi.fn();
    const onSaveNext = vi.fn();
    const props = { containerId: C, item: ITEM, context: 'Вопрос 1', group: false, onSave, onSaveNext, onCancel: vi.fn(), upload: vi.fn(async () => 'kept' as const) };
    const { rerender } = render(<QuestionEditor {...props} unsaved={null} />);
    fireEvent.change(screen.getByLabelText(EDITOR.stem), { target: { value: 'Что означает стрелка справа?' } });
    rerender(<QuestionEditor {...props} unsaved={EDITOR.unsaved(1)} />);
    const save = within(screen.getByRole('group', { name: shown(EDITOR.unsaved(1)) })).getByRole('button', { name: EDITOR.save });
    expect(save).toHaveFocus();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stem: 'Что означает стрелка справа?' }));
    expect(onSaveNext).not.toHaveBeenCalled();
  });

  it('a new question of «Конструктор»: «Сохранить и следующий» is the blue pill, «Сохранить» stays beside it', () => {
    const onSaveNext = vi.fn();
    const { onSave } = setup({ onSaveNext });
    fireEvent.change(screen.getByLabelText(EDITOR.stem), { target: { value: 'Что означает стрелка справа?' } });
    const next = screen.getByRole('button', { name: EDITOR.saveNext });
    expect(next).toHaveClass('sf-primary');
    expect(next).toHaveAttribute('type', 'submit');
    fireEvent.click(next);
    expect(onSaveNext).toHaveBeenCalledWith(expect.objectContaining({ stem: 'Что означает стрелка справа?' }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: EDITOR.save }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Enter (⌘+Enter) in any field takes the blue pill’s step; plain Enter in the stem stays a line break', () => {
    const onSaveNext = vi.fn();
    const { onSave } = setup({ onSaveNext });
    const stem = screen.getByLabelText(EDITOR.stem);
    fireEvent.change(stem, { target: { value: 'Что означает стрелка справа?' } });
    expect(fireEvent.keyDown(stem, { key: 'Enter' })).toBe(true);
    expect(onSaveNext).not.toHaveBeenCalled();
    // In the last option: no new option, the question goes.
    fireEvent.keyDown(screen.getByLabelText(EDITOR.option('В')), { key: 'Enter', ctrlKey: true });
    expect(onSaveNext).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(EDITOR.option('Г'))).toBeNull();
    fireEvent.keyDown(screen.getByLabelText(EDITOR.explanation), { key: 'Enter', metaKey: true });
    expect(onSaveNext).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});
