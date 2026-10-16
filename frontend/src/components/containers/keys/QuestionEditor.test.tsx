import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import QuestionEditor from './QuestionEditor';
import { EDITOR } from '../copyImport';
import type { TestItem } from '../../../types/container';

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
  key_source: 'file',
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
    expect(screen.getByText(EDITOR.rightWord)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: EDITOR.removeOption('А') }));
    expect(screen.queryByText(EDITOR.rightWord)).toBeNull();
    expect(screen.getByText(EDITOR.noKey)).toBeInTheDocument();
    expect((screen.getByLabelText(EDITOR.option('А')) as HTMLTextAreaElement).value).toBe('Управление');
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

  it('cancels', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: EDITOR.cancel }));
    expect(onCancel).toHaveBeenCalled();
  });
});
