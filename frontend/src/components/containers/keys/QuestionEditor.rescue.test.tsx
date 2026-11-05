import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import QuestionEditor from './QuestionEditor';
import { EDITOR } from '../copyImport';
import { rescuedFor, sessionLost } from '../../../lib/draftRescue';
import type { TestItem } from '../../../types/container';

const C = '11111111-2222-4333-8444-555555555555';
const ITEM: TestItem = {
  id: 'i1',
  container_id: C,
  subject_id: 's1',
  position: 1,
  file_no: '1',
  topic: null,
  kind: 'single',
  stem: 'Что измеряет тонометр?',
  options: ['Температуру', 'Давление'],
  correct: [1],
  answers: [],
  key_source: 'bold',
  code: false,
  keep_order: false,
  flags: [],
  rev: 1,
  updated_at: '2026-11-05T00:00:00Z',
  images: null,
};

function open(item: TestItem = ITEM) {
  const onSave = vi.fn();
  render(<QuestionEditor containerId={C} item={item} context="№ 1" group={false} onSave={onSave} onCancel={vi.fn()} />);
  return { onSave, stem: () => screen.getByLabelText(EDITOR.stem) as HTMLTextAreaElement };
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('QuestionEditor: changes kept when the login ran out (lib/draftRescue)', () => {
  it('keeps the words typed and gives them back in the editor of the same question, with a line saying so', () => {
    const first = open();
    fireEvent.change(first.stem(), { target: { value: 'Что измеряет тонометр на плече?' } });
    sessionLost();
    cleanup();
    expect(rescuedFor(C).map((kept) => kept.itemId)).toEqual(['i1']);

    const again = open();
    expect(again.stem().value).toBe('Что измеряет тонометр на плече?');
    expect(screen.getByText(EDITOR.rescued)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: EDITOR.save }));
    expect(again.onSave).toHaveBeenCalledWith(expect.objectContaining({ stem: 'Что измеряет тонометр на плече?' }));
    // taken once: a third editor opens on the question as it is
    cleanup();
    open();
    expect(screen.queryByText(EDITOR.rescued)).toBeNull();
  });

  it('gives nothing back when the question changed meanwhile, and keeps nothing for an editor without changes', () => {
    open();
    fireEvent.change(screen.getByLabelText(EDITOR.stem), { target: { value: 'Мои правки' } });
    sessionLost();
    cleanup();
    const changed = open({ ...ITEM, stem: 'Вопрос, изменённый в другой вкладке', rev: 2 });
    expect(changed.stem().value).toBe('Вопрос, изменённый в другой вкладке');
    expect(screen.queryByText(EDITOR.rescued)).toBeNull();
    cleanup();

    open();
    sessionLost();
    cleanup();
    expect(rescuedFor(C)).toEqual([]);
  });
});
