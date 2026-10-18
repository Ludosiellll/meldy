import { describe, expect, it } from 'vitest';
import { item, subject, summary } from '../containers/testkit/fixtures';
import {
  copyInput, defaultSubject, insertAfter, isKeyed, itemFromInput, moveIds, numbered, orderItems, takesItems, templateItem, typeOf,
} from './buildModel';

const SUBJECT = 'subject-1';

describe('buildModel: the builder’s rules (spec 2026-10-18 §47.2)', () => {
  it('names a question’s kind; «верно / неверно» is one answer with exactly those two options', () => {
    expect(typeOf({ kind: 'single', options: ['3', '4'] })).toBe('single');
    expect(typeOf({ kind: 'single', options: ['Верно', 'Неверно'] })).toBe('truefalse');
    expect(typeOf({ kind: 'single', options: ['Неверно', 'Верно'] })).toBe('single');
    expect(typeOf({ kind: 'multiple', options: ['Верно', 'Неверно'] })).toBe('multiple');
    expect(typeOf({ kind: 'short', options: [] })).toBe('short');
  });

  it('starts each kind from its own empty question, nothing keyed', () => {
    const single = templateItem('single', SUBJECT, 'c-1');
    expect(single).toMatchObject({ kind: 'single', options: ['', '', '', ''], correct: [], answers: [], keep_order: false, stem: '', explanation: '' });
    expect(templateItem('multiple', SUBJECT, 'c-1')).toMatchObject({ kind: 'multiple', options: ['', '', '', ''], correct: [] });
    expect(templateItem('short', SUBJECT, 'c-1')).toMatchObject({ kind: 'short', options: [], answers: [] });
    expect(templateItem('truefalse', SUBJECT, 'c-1')).toMatchObject({ kind: 'single', options: ['Верно', 'Неверно'], correct: [], keep_order: true });
  });

  it('copies the content under a new ref and number, the explanation and pictures with it', () => {
    const original = item({
      id: 'q-1',
      subject_id: SUBJECT,
      stem: 'Сколько будет 2 + 2?',
      options: ['3', '4'],
      correct: [1],
      topic: 2,
      key_source: 'manual',
      code: true,
      keep_order: true,
      flags: ['several_marked'],
      images: { stem: ['c-1/a.png'], options: [[], ['c-1/b.png']] },
      explanation: 'Два и два — четыре.',
    });
    expect(copyInput(original, '7', 'man:x')).toEqual({
      ref: 'man:x',
      stem: 'Сколько будет 2 + 2?',
      options: ['3', '4'],
      correct: [1],
      kind: 'single',
      file_no: '7',
      topic: 2,
      key_source: 'manual',
      code: true,
      keep_order: true,
      flags: ['several_marked'],
      images: { stem: ['c-1/a.png'], options: [[], ['c-1/b.png']] },
      explanation: 'Два и два — четыре.',
    });
    const short = copyInput(item({ id: 'q-2', kind: 'short', options: [], correct: [], answers: ['Париж', 'Paris'], images: null, explanation: '' }), '8', 'man:y');
    expect(short).toMatchObject({ kind: 'short', options: [], correct: [], answers: ['Париж', 'Paris'] });
    expect(short).not.toHaveProperty('images');
    expect(short).not.toHaveProperty('explanation');
  });

  it('draws an added question from its input until the next read', () => {
    const input = copyInput(item({ id: 'q-1', subject_id: SUBJECT, explanation: 'Потому что.' }), '3', 'man:z');
    expect(itemFromInput(input, 'new-id', 9, SUBJECT, 'c-1')).toMatchObject({
      id: 'new-id',
      subject_id: SUBJECT,
      container_id: 'c-1',
      position: 9,
      file_no: '3',
      stem: 'Вопрос',
      correct: [0],
      explanation: 'Потому что.',
      rev: 1,
    });
  });

  it('moves one place up or down, and not past the ends', () => {
    expect(moveIds(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveIds(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveIds(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(moveIds(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(moveIds(['a', 'b'], 'x', 1)).toBeNull();
  });

  it('puts added ids right after a question, or at the end', () => {
    expect(insertAfter(['a', 'b', 'c'], 'a', ['n'])).toEqual(['a', 'n', 'b', 'c']);
    expect(insertAfter(['a', 'b', 'c', 'n'], 'b', ['n'])).toEqual(['a', 'b', 'n', 'c']);
    expect(insertAfter(['a', 'b'], 'b', ['n', 'm'])).toEqual(['a', 'b', 'n', 'm']);
    expect(insertAfter(['a', 'b'], 'x', ['n'])).toEqual(['a', 'b', 'n']);
  });

  it('numbers a batch after the subject’s largest whole number, keeping numbers already given', () => {
    const items = [item({ id: '1', subject_id: SUBJECT, file_no: '4' }), item({ id: '2', subject_id: SUBJECT, file_no: '12а' }), item({ id: '3', subject_id: 'other', file_no: '40' })];
    const inputs = [copyInput(items[0], '', 'man:1'), copyInput(items[0], '9', 'man:2'), copyInput(items[0], '', 'man:3')];
    expect(numbered(inputs, items, SUBJECT).map((input) => input.file_no)).toEqual(['5', '9', '6']);
    expect(numbered([copyInput(items[0], '', 'man:4')], [], SUBJECT)[0].file_no).toBe('1');
  });

  it('orders by the author’s order of this visit, the rest after it by position', () => {
    const list = [item({ id: 'a', position: 1 }), item({ id: 'b', position: 2 }), item({ id: 'c', position: 3 }), item({ id: 'd', position: 4 })];
    expect(orderItems([...list].reverse()).map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(orderItems(list, ['c', 'a', 'b']).map((entry) => entry.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(orderItems(list, ['gone', 'b']).map((entry) => entry.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('opens on the first subject with questions, else the first; an oral-only subject takes none', () => {
    const one = subject({ id: 's-1' });
    const two = subject({ id: 's-2' });
    expect(defaultSubject([one, two], [{ subject_id: 's-2' }])?.id).toBe('s-2');
    expect(defaultSubject([one, two], [])?.id).toBe('s-1');
    expect(defaultSubject([], [])).toBeNull();
    expect(takesItems(subject({ oral: { exam_id: 'e', questions: 30 }, kinds: { single: 0, multiple: 0, short: 0 } }))).toBe(false);
    expect(takesItems(subject({ oral: { exam_id: 'e', questions: 30 }, kinds: { single: 3, multiple: 0, short: 0 } }))).toBe(true);
    expect(takesItems(summary().subjects[0])).toBe(true);
  });

  it('a question has its key with a ticked option or an accepted form', () => {
    expect(isKeyed({ correct: [0], answers: [] })).toBe(true);
    expect(isKeyed({ correct: [], answers: ['Париж'] })).toBe(true);
    expect(isKeyed({ correct: [], answers: [] })).toBe(false);
  });
});
