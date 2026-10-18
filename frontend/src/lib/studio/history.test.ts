import { describe, expect, it } from 'vitest';
import type { TestDoc } from '../../types/testDoc';
import { emptyDoc } from './doc';
import { amend, canRedo, canUndo, COALESCE_MS, HISTORY_LIMIT, record, redo, startHistory, typingKey, undo } from './history';

const page = (title: string): TestDoc => emptyDoc(title);
const titles = (docs: readonly TestDoc[]) => docs.map((doc) => doc.title);

describe('history', () => {
  it('starts with nothing to take back or bring back', () => {
    const history = startHistory(page('А'), 5);
    expect(history).toEqual({ past: [], present: page('А'), future: [], key: null, at: 5 });
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
    expect(startHistory(page('А')).at).toBe(0);
  });

  it('records a step per change and takes it back and brings it back', () => {
    let history = startHistory(page('А'));
    history = record(history, page('Б'), 100);
    history = record(history, page('В'), 200);
    expect(titles(history.past)).toEqual(['А', 'Б']);
    expect(history.present.title).toBe('В');
    history = undo(history);
    expect(history.present.title).toBe('Б');
    expect(titles(history.future)).toEqual(['В']);
    expect(canRedo(history)).toBe(true);
    history = undo(history);
    expect(history.present.title).toBe('А');
    expect(canUndo(history)).toBe(false);
    history = redo(history);
    history = redo(history);
    expect(history.present.title).toBe('В');
    expect(canRedo(history)).toBe(false);
  });

  it('records nothing when the page did not change (the same object or an equal one)', () => {
    const history = startHistory(page('А'));
    expect(record(history, history.present, 10)).toBe(history);
    expect(record(history, page('А'), 10)).toBe(history);
  });

  it('a new change after «Отменить» drops what «Повторить» could bring back', () => {
    let history = record(startHistory(page('А')), page('Б'), 10);
    history = undo(history);
    history = record(history, page('В'), 20);
    expect(titles(history.past)).toEqual(['А']);
    expect(history.future).toEqual([]);
  });

  it('typing into one block within a second is one step', () => {
    const key = typingKey('block1');
    let history = startHistory(page('А'));
    history = record(history, page('Б'), 1000, key);
    history = record(history, page('Бу'), 1000 + COALESCE_MS - 1, key);
    history = record(history, page('Бук'), 1000 + 2 * COALESCE_MS - 2, key);
    expect(titles(history.past)).toEqual(['А']);
    expect(history.present.title).toBe('Бук');
    expect(undo(history).present.title).toBe('А');
  });

  it('a pause, another block, another kind of change or an older clock starts a new step', () => {
    const key = typingKey('block1');
    let history = record(startHistory(page('А')), page('Б'), 1000, key);
    history = record(history, page('В'), 1000 + COALESCE_MS, key);
    expect(titles(history.past)).toEqual(['А', 'Б']);
    history = record(history, page('Г'), 2100, typingKey('block2'));
    expect(titles(history.past)).toEqual(['А', 'Б', 'В']);
    history = record(history, page('Д'), 2200);
    history = record(history, page('Е'), 2300);
    expect(titles(history.past)).toEqual(['А', 'Б', 'В', 'Г', 'Д']);
    history = record(history, page('Ж'), 2400, key);
    history = record(history, page('З'), 2300, key);
    expect(titles(history.past)).toEqual(['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж']);
  });

  it('typing right after «Отменить» is a new step', () => {
    const key = typingKey('block1', 'title');
    expect(key).toBe('type:block1:title');
    let history = record(startHistory(page('А')), page('Б'), 1000, key);
    history = undo(history);
    history = record(history, page('В'), 1100, key);
    expect(titles(history.past)).toEqual(['А']);
    expect(history.present.title).toBe('В');
  });

  it('keeps the last 100 steps', () => {
    let history = startHistory(page('0'));
    for (let step = 1; step <= 150; step += 1) history = record(history, page(String(step)), step * 10_000);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0].title).toBe('50');
    for (let step = 0; step < 200; step += 1) history = undo(history);
    expect(history.present.title).toBe('50');
    expect(history.future).toHaveLength(HISTORY_LIMIT);
  });

  it('amend replaces the present page without a step', () => {
    let history = record(startHistory(page('А')), page('Б'), 10);
    history = undo(history);
    const amended = amend(history, page('А2'));
    expect(amended.present.title).toBe('А2');
    expect(amended.future).toBe(history.future);
    expect(amend(amended, amended.present)).toBe(amended);
  });
});
