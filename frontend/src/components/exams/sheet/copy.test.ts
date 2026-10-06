import { describe, expect, it } from 'vitest';
import type { LineStatus } from '../../../lib/exams/cheatSheet';
import { blockNote, changeSentence, counterDetails, protocolSheetLine, counterLabel, erasableSentence, historyLine, lineLabel, lineNote, priceLine } from './copy';

const NBSP = ' ';
const plain = (text: string | null) => (text ?? '').replace(/ /g, ' ');

function status(extra: Partial<LineStatus>): LineStatus {
  return {
    state: 'fresh',
    history: [],
    erasableFrom: null,
    erasedAt: null,
    erasedOn: null,
    lastNamedAt: null,
    dueAt: null,
    wasErasedOn: null,
    peekedToday: false,
    checks: 0,
    ...extra,
  };
}

describe('cheat sheet words', () => {
  it('counts lines in Russian', () => {
    expect(plain(counterLabel({ left: 39, total: 47 }))).toBe('строк осталось из 47');
    expect(plain(counterLabel({ left: 21, total: 47 }))).toBe('строка осталась из 47');
    expect(plain(counterLabel({ left: 3, total: 47 }))).toBe('строки осталось из 47');
  });

  it('lists what else matters under the counter, leaving out empty parts', () => {
    const counts = { total: 47, left: 39, essentialTotal: 30, essentialLeft: 21, rubbed: 5, erased: 3, due: 3, readable: 34, learned: 1, withoutLines: 9, gaps: 3, unwritten: 6, rebuilt: 0, unmapped: 0, unverified: 0, questions: 40 };
    expect(plain(counterDetails(counts))).toBe('главных — 21 · пора проверить — 3 · 9 вопросов без пунктов');
    expect(counterDetails({ ...counts, due: 0, withoutLines: 0, essentialTotal: 47 })).toBe('');
  });

  it('writes the history in the protocol’s words with the day and time', () => {
    const line = historyLine({ at: new Date(2026, 9, 5, 19, 40).toISOString(), date: '2026-10-05', outcome: 'missed', word: 'mentioned', sessionId: null });
    expect(plain(line)).toBe('5 окт., 19:40 — только упомянут');
  });

  it('puts a note only under readable lines, never «забыли» and never «завтра»', () => {
    const missed = status({ state: 'missed', history: [{ at: '', date: '2026-10-06', outcome: 'missed', word: 'missing', sessionId: null }] });
    expect(plain(lineNote(missed))).toBe('6 окт. не назван');
    const returned = status({ state: 'returned', wasErasedOn: '2026-10-02', history: [{ at: '', date: '2026-10-09', outcome: 'missed', word: 'mentioned', sessionId: null }] });
    expect(plain(lineNote(returned))).toBe('была стёрта 2 окт. · 9 окт. только упомянут');
    expect(plain(lineNote(status({ state: 'due', erasedOn: '2026-09-20' })))).toBe('стёрта 20 сент. · пора проверить');
    expect(lineNote(status({ state: 'rubbed' }))).toBeNull();
    expect(lineNote(status({ state: 'fresh' }))).toBeNull();
    expect(lineNote(status({ state: 'rubbed' }), true)).toBe('Подсмотрели — сегодня эта строка не сотрётся');
    expect(lineNote(status({ state: 'rubbed', peekedToday: true }))).toBe('подсмотрели — сегодня не сотрётся');
    expect(lineNote(status({ state: 'fresh', peekedToday: true }))).toBe('подсмотрели — сегодня не сотрётся');
    expect(plain(lineNote(missed))).toBe(plain(lineNote({ ...missed, peekedToday: true })));
  });

  it('prints the notes of «Вопросы» under questions without lines, and what a partial question lacks', () => {
    const base = { coverage: 'none' as const, coverageMethod: 'llm' as const, coverageReason: '', missing: '', partial: false };
    expect(plain(blockNote({ ...base, kind: 'gap' }, 9))).toBe('Ни в одной из 9 лекций нет фрагмента об этом');
    expect(plain(blockNote({ ...base, kind: 'gap', coverageReason: 'Ни одного фрагмента с этими словами' }, 1))).toBe('Ни в одной из 1 лекции нет фрагмента с этими словами');
    expect(blockNote({ ...base, kind: 'gap', coverageReason: 'Нет подтверждающего фрагмента' }, 3)).toBe('Нет фрагмента, который подтверждает ответ');
    expect(blockNote({ ...base, kind: 'gap', coverage: 'full' }, 3)).toBe('В лекциях не нашлось пунктов ответа');
    expect(blockNote({ ...base, kind: 'unmapped', coverage: null }, 3)).toBe('Вопрос ещё не сверен с лекциями');
    expect(blockNote({ ...base, kind: 'unverified', coverage: 'unverified' }, 3)).toBe('Проверено только по словам — сверьте ещё раз');
    expect(blockNote({ ...base, kind: 'rebuilt', coverage: 'full' }, 3)).toBe('Пункты пересобраны — строки надо написать заново');
    expect(blockNote({ ...base, kind: 'unwritten', coverage: 'full' }, 3)).toBeNull();
    expect(blockNote({ ...base, kind: 'lines', coverage: 'full' }, 3)).toBeNull();
    expect(blockNote({ ...base, kind: 'lines', coverage: 'partial', partial: true, missing: 'товаров Гиффена' }, 3)).toBe('Не хватает: товаров Гиффена');
    expect(blockNote({ ...base, kind: 'lines', coverage: 'partial', partial: true }, 3)).toBe('В лекциях не всё');
    expect(blockNote({ ...base, kind: 'lines', coverage: 'full', coverageMethod: 'manual' }, 3)).toBe('Отмечено вами — Meldy этого не проверял');
  });

  it('says when a rubbed line can be erased, by moment — and no moment once it has come', () => {
    const rubbed = status({ state: 'rubbed', erasableFrom: new Date(2026, 9, 6, 15, 40).toISOString() });
    expect(plain(erasableSentence(rubbed, new Date(2026, 9, 6, 9, 0).getTime()))).toBe('Сотрётся, если назовёте снова после 6 окт., 15:40.');
    expect(erasableSentence(rubbed, new Date(2026, 9, 6, 15, 41).getTime())).toBe('Назовёте в ответе снова — сотрётся.');
    expect(plain(lineLabel('цена ↑', rubbed, true, new Date(2026, 9, 6, 9, 0).getTime()))).toBe('Главный пункт стёрт наполовину; сотрётся, если назовёте снова после 6 окт., 15:40. Подсмотреть');
    expect(lineLabel('цена ↑', rubbed, true, new Date(2026, 9, 7, 9, 0).getTime())).toBe('Главный пункт стёрт наполовину; назовёте в ответе снова — сотрётся. Подсмотреть');
    expect(erasableSentence(status({ state: 'fresh' }))).toBeNull();
  });

  it('gives a screen reader the words only where the eye can read them', () => {
    expect(lineLabel('цена ↑ → спрос ↓', status({ state: 'fresh' }), true)).toBe('Главный пункт: цена ↑ → спрос ↓');
    const rubbed = lineLabel('цена ↑ → спрос ↓', status({ state: 'rubbed' }), false);
    expect(rubbed).not.toContain('цена');
    expect(rubbed).toContain('Подсмотреть');
    expect(plain(lineLabel('x', status({ state: 'erased', erasedOn: '2026-10-04' }), false))).toBe('Пункт стёрт 4 окт.');
  });

  it('tells what an answer did, the noun once', () => {
    expect(plain(changeSentence({ erased: 2, rubbed: 3, returned: 1, due: 0, missed: 0 }))).toBe('После ответа: 2 строки стёрлись, 3 — наполовину, 1 вернулась.');
    expect(plain(changeSentence({ erased: 0, rubbed: 1, returned: 0, due: 0, missed: 2 }))).toBe('После ответа: 1 строка — наполовину, 2 не прозвучали.');
    expect(plain(changeSentence({ erased: 21, rubbed: 0, returned: 0, due: 0, missed: 0 }))).toBe('После ответа: 21 строка стёрлась.');
    expect(changeSentence({ erased: 0, rubbed: 0, returned: 0, due: 0, missed: 0 })).toBeNull();
    // A due line named again: it passed its check (and is erased again).
    expect(plain(changeSentence({ erased: 1, rubbed: 0, returned: 0, due: 0, missed: 0, checked: 2 }))).toBe('После ответа: 1 строка стёрлась, 2 прошли проверку.');
    expect(plain(changeSentence({ erased: 0, rubbed: 0, returned: 0, due: 0, missed: 0, checked: 1 }))).toBe('После ответа: 1 строка прошла проверку.');
  });

  it('says the change on the answer’s protocol, or why nothing changed', () => {
    expect(plain(protocolSheetLine({ erased: 2, rubbed: 1, returned: 0, missed: 0 }))).toBe('На шпаргалке: 2 строки стёрлись, 1 — наполовину');
    expect(plain(protocolSheetLine({ erased: 0, rubbed: 0, returned: 0, missed: 0 }))).toBe('На шпаргалке строки не изменились: стирает только пункт, названный в другой день');
  });

  it('states the price in units', () => {
    expect(plain(priceLine(31, 31, 87))).toBe('31 вопрос — 31 единица ИИ · сегодня осталось 87');
    expect(priceLine(2, 2, null)).toBe(`2${NBSP}вопроса — 2${NBSP}единицы ИИ`);
  });
});
