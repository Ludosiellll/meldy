import { describe, expect, it } from 'vitest';
import type { TestItem } from '../../types/container';
import type { TestDoc } from '../../types/testDoc';
import { emptyDoc } from './doc';
import { fromText, toText } from './textFormat';

const EXAM = '11111111-2222-3333-4444-555555555555';
const row = (id: string, partial: Partial<TestItem>): TestItem => ({
  id, container_id: EXAM, subject_id: 's', position: 1, file_no: '1', topic: null, kind: 'single', stem: 'Вопрос',
  options: ['а', 'б'], correct: [0], answers: [], key_source: 'manual', code: false, keep_order: false, flags: [], rev: 1,
  updated_at: '', images: null, explanation: '', ...partial,
});
const MATCH = row('m1', { kind: 'match', stem: 'Соедините страны и столицы', options: ['Франция', 'Германия'], correct: [], answers: ['Париж', 'Берлин', 'Рим'] });
const NUMBER = row('n1', { kind: 'number', stem: 'Чему равно g?', options: [], correct: [], answers: ['9.8'], tolerance: 0.1, unit: 'м/с²', explanation: 'У поверхности Земли.' });
const SINGLE = row('s1', { stem: 'Да или нет?', options: ['да', 'нет'], correct: [0] });
const doc = (): TestDoc => ({
  ...emptyDoc('Тест'),
  blocks: [
    { type: 'question', id: 'blockm0001', item_id: MATCH.id, points: 1, required: false },
    { type: 'question', id: 'blockn0001', item_id: NUMBER.id, points: 2, required: false },
    { type: 'question', id: 'blocks0001', item_id: SINGLE.id, points: 1, required: false },
  ],
});
const items = [MATCH, NUMBER, SINGLE];

describe('«Текст» keeps the new kinds', () => {
  it('writes a new kind as its stem and its tag', () => {
    const text = toText(doc(), items);
    expect(text).toContain('Соедините страны и столицы\n[соответствие] ключ — на холсте');
    expect(text).toContain('Чему равно g?\n[число] ключ — на холсте\n> У поверхности Земли.');
    expect(text).toContain('Да или нет?\n+ да\n- нет');
  });
  it('reads its own text back without a change', () => {
    const result = fromText(toText(doc(), items), doc(), items);
    expect(result.problems).toEqual([]);
    expect(result.updates).toEqual([]);
    expect(result.adds).toEqual([]);
    expect(result.removes).toEqual([]);
    expect(result.doc).toEqual(doc());
  });
  it('takes a new stem and explanation of a new kind, and nothing of its key', () => {
    const text = toText(doc(), items).replace('Чему равно g?', 'Чему равно ускорение g?').replace('> У поверхности Земли.', '> На уровне моря.');
    const result = fromText(text, doc(), items);
    expect(result.problems).toEqual([]);
    expect(result.updates).toEqual([{ id: NUMBER.id, patch: { stem: 'Чему равно ускорение g?', explanation: 'На уровне моря.' } }]);
  });
  it('refuses a tag the text adds or changes', () => {
    const added = `${toText(doc(), items)}\nНовый вопрос\n[порядок]\n`;
    expect(fromText(added, doc(), items).problems.map((p) => p.message)).toEqual([expect.stringContaining('добавьте на холсте')]);
    expect(fromText(added, doc(), items).adds).toEqual([]);
  });
});
