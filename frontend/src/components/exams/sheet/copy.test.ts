import { describe, expect, it } from 'vitest';
import type { LineStatus } from '../../../lib/exams/cheatSheet';
import {
  blockNote,
  changeNote,
  changeSentence,
  counterDetails,
  protocolSheetLine,
  counterLabel,
  erasableSentence,
  historyLine,
  lineLabel,
  lineNote,
  priceLine,
  writeStatusNote,
  writtenLabel,
} from './copy';

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
    // While the first lines are written: how many there are, not «6 из 6 осталось».
    expect(writtenLabel(6)).toBe('строк написано');
    expect(writtenLabel(21)).toBe('строка написана');
    expect(writtenLabel(3)).toBe('строки написаны');
  });

  it('lists what else matters under the counter: the main lines left of all main ones, the half-erased, the due, the questions without points', () => {
    const counts = { total: 47, left: 39, essentialTotal: 30, essentialLeft: 21, rubbed: 5, erased: 3, due: 3, readable: 34, learned: 1, withoutLines: 9, gaps: 3, unwritten: 6, rebuilt: 0, unmapped: 0, unverified: 0, questions: 40 };
    // «Без пунктов» are the questions the lectures do not answer (and the unchecked ones): the 6 still to
    // be written are counted by «Дописать 6 вопросов».
    expect(plain(counterDetails(counts))).toBe('главных — 21 из 30 · стёрты наполовину — 5 · пора проверить — 3 · 3 вопроса без пунктов');
    expect(plain(counterDetails({ ...counts, gaps: 1, unmapped: 1, unverified: 1, rubbed: 0 }))).toBe('главных — 21 из 30 · пора проверить — 3 · 3 вопроса без пунктов');
    // Every part holds together; a row breaks only after a dot.
    expect(counterDetails(counts)).toContain(`стёрты${NBSP}наполовину${NBSP}—${NBSP}5${NBSP}· `);
    expect(counterDetails({ ...counts, due: 0, rubbed: 0, gaps: 0, essentialTotal: 47 })).toBe('');
  });

  it('notes on unwritten questions only once some of the sheet is written; «В лекции» for the only lecture', () => {
    const base = { coverage: 'full' as const, coverageMethod: 'llm' as const, coverageReason: '', missing: '', partial: false };
    expect(blockNote({ ...base, kind: 'unwritten' }, 3)).toBeNull();
    expect(blockNote({ ...base, kind: 'unwritten' }, 3, { anyWritten: true })).toBe('Ещё не написано');
    expect(plain(blockNote({ ...base, kind: 'gap', coverage: 'none' }, 1))).toBe('В лекции нет фрагмента об этом');
    expect(plain(blockNote({ ...base, kind: 'gap', coverage: 'none' }, 9))).toBe('Ни в одной из 9 лекций нет фрагмента об этом');
  });

  it('promises nothing the sheet does not do when a question was not written', () => {
    expect(writeStatusNote('busy')).toBe('ИИ был занят — вопрос не написан. Допишите его позже.');
    expect(writeStatusNote('limit', '3:00')).toBe('Дневной лимит ИИ кончился. Дописать можно после 3:00.');
    expect(writeStatusNote('limit')).toBe('Дневной лимит ИИ кончился. Дописать можно после его обновления.');
  });

  it('writes the history in the protocol’s words with the day and time', () => {
    const line = historyLine({ at: new Date(2026, 9, 5, 19, 40).toISOString(), date: '2026-10-05', outcome: 'missed', word: 'mentioned', sessionId: null });
    expect(plain(line)).toBe('5 окт., 19:40 — только упомянут');
    // The dash never starts a row.
    expect(line).toContain(`19:40${NBSP}—`);
  });

  it('puts a note only under readable lines, never «забыли» and never «завтра»', () => {
    const missed = status({ state: 'missed', history: [{ at: '', date: '2026-10-06', outcome: 'missed', word: 'missing', sessionId: null }] });
    expect(plain(lineNote(missed))).toBe('6 окт. не назван');
    const returned = status({ state: 'returned', wasErasedOn: '2026-10-02', history: [{ at: '', date: '2026-10-09', outcome: 'missed', word: 'mentioned', sessionId: null }] });
    // «пункт» keeps the two subjects apart: the line was erased, the point was only mentioned.
    expect(plain(lineNote(returned))).toBe('была стёрта 2 окт. · 9 окт. пункт только упомянут');
    expect(plain(lineNote({ ...returned, history: [] }))).toBe('была стёрта 2 окт. · пункт не назван');
    expect(plain(lineNote(status({ state: 'due', erasedOn: '2026-09-20' })))).toBe('стёрта 20 сент. · пора проверить');
    expect(lineNote(status({ state: 'rubbed' }))).toBeNull();
    expect(lineNote(status({ state: 'fresh' }))).toBeNull();
    // The same words as the note of a line peeked at earlier today.
    expect(lineNote(status({ state: 'rubbed' }), true)).toBe('подсмотрели — сегодня не сотрётся');
    expect(lineNote(status({ state: 'rubbed', peekedToday: true }))).toBe('подсмотрели — сегодня не сотрётся');
    expect(lineNote(status({ state: 'fresh', peekedToday: true }))).toBe('подсмотрели — сегодня не сотрётся');
    expect(plain(lineNote(missed))).toBe(plain(lineNote({ ...missed, peekedToday: true })));
  });

  it('prints the notes of «Вопросы» under questions without lines, and what a partial question lacks', () => {
    const base = { coverage: 'none' as const, coverageMethod: 'llm' as const, coverageReason: '', missing: '', partial: false };
    expect(plain(blockNote({ ...base, kind: 'gap' }, 9))).toBe('Ни в одной из 9 лекций нет фрагмента об этом');
    expect(plain(blockNote({ ...base, kind: 'gap', coverageReason: 'Ни одного фрагмента с этими словами' }, 1))).toBe('В лекции нет фрагмента с этими словами');
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

  it('says when a rubbed line can be erased completely, by moment — and no moment once it has come', () => {
    const rubbed = status({ state: 'rubbed', erasableFrom: new Date(2026, 9, 6, 15, 40).toISOString() });
    expect(plain(erasableSentence(rubbed, new Date(2026, 9, 6, 9, 0).getTime()))).toBe('Сотрётся совсем, если назовёте пункт снова после 6 окт., 15:40.');
    expect(erasableSentence(rubbed, new Date(2026, 9, 6, 15, 41).getTime())).toBe('Назовёте пункт в ответе снова — сотрётся совсем.');
    expect(plain(lineLabel('цена ↑', rubbed, true, new Date(2026, 9, 6, 9, 0).getTime()))).toBe(
      'Строка главного пункта стёрта наполовину; сотрётся совсем, если назовёте пункт снова после 6 окт., 15:40. Подсмотреть',
    );
    expect(lineLabel('цена ↑', rubbed, true, new Date(2026, 9, 7, 9, 0).getTime())).toBe('Строка главного пункта стёрта наполовину; назовёте пункт в ответе снова — сотрётся совсем. Подсмотреть');
    expect(erasableSentence(status({ state: 'fresh' }))).toBeNull();
  });

  it('names a day, not «0:00», when the line waits for the next day (after a peek, or the 20 hours ending at midnight)', () => {
    const nextDay = status({ state: 'rubbed', erasableFrom: new Date(2026, 9, 8, 0, 0).toISOString() });
    expect(plain(erasableSentence(nextDay, new Date(2026, 9, 7, 9, 0).getTime()))).toBe('Сотрётся совсем, если назовёте пункт снова 8 окт. или позже.');
    expect(plain(lineLabel('x', nextDay, false, new Date(2026, 9, 7, 9, 0).getTime()))).toBe(
      'Строка пункта стёрта наполовину; сотрётся совсем, если назовёте пункт снова 8 окт. или позже. Подсмотреть',
    );
    expect(erasableSentence(nextDay, new Date(2026, 9, 8, 0, 1).getTime())).toBe('Назовёте пункт в ответе снова — сотрётся совсем.');
  });

  it('gives a screen reader the words only where the eye can read them', () => {
    expect(lineLabel('цена ↑ → спрос ↓', status({ state: 'fresh' }), true)).toBe('Главный пункт: цена ↑ → спрос ↓');
    const rubbed = lineLabel('цена ↑ → спрос ↓', status({ state: 'rubbed' }), false);
    expect(rubbed).not.toContain('цена');
    expect(rubbed).toContain('Подсмотреть');
    // A line is erased, a point is named.
    expect(plain(lineLabel('x', status({ state: 'erased', erasedOn: '2026-10-04' }), false))).toBe('Строка пункта стёрта 4 окт.');
    expect(plain(lineLabel('x', status({ state: 'due', erasedOn: '2026-09-20' }), true))).toBe('Строка главного пункта стёрта 20 сент., пора проверить. Подсмотреть');
  });

  const none = { erased: 0, rubbed: 0, checked: 0, returned: 0, stayed: 0 };

  it('tells what an answer did, the noun once; «— наполовину» only after «стёрлись»', () => {
    expect(plain(changeSentence({ ...none, erased: 2, rubbed: 3, returned: 1 }))).toBe('После ответа: 2 строки стёрлись, 3 — наполовину, 1 вернулась.');
    // The first answer: nothing erased yet, the half-erased say so in full; the lines it did not name did not change.
    expect(plain(changeSentence({ ...none, rubbed: 3, stayed: 2 }))).toBe('После ответа: 3 строки стёрлись наполовину, 2 не стёрлись.');
    expect(plain(changeSentence({ ...none, rubbed: 1, stayed: 1 }))).toBe('После ответа: 1 строка стёрлась наполовину, 1 не стёрлась.');
    expect(plain(changeSentence({ ...none, erased: 21 }))).toBe('После ответа: 21 строка стёрлась.');
    // A due line named again: it passed its check (and is erased again).
    expect(plain(changeSentence({ ...none, erased: 1, checked: 2 }))).toBe('После ответа: 1 строка стёрлась, 2 прошли проверку.');
    expect(plain(changeSentence({ ...none, checked: 1 }))).toBe('После ответа: 1 строка прошла проверку.');
    // «— наполовину» never breaks away from its number.
    expect(changeSentence({ ...none, erased: 1, rubbed: 1 })).toContain(`1${NBSP}—${NBSP}наполовину`);
    expect(changeSentence(none)).toBe('После ответа строки не изменились.');
  });

  it('explains, in a note of its own, the named lines an answer left as they were', () => {
    const now = new Date(2026, 9, 6, 9, 0).getTime();
    const from = new Date(2026, 9, 6, 15, 40).toISOString();
    // Named again less than 20 hours after the first naming, on another day: the moment it can be erased.
    expect(plain(changeNote({ ...none, rubbed: 1 }, { kind: 'wait', from, count: 1, why: 'hours' }, now))).toBe(
      '1 строка названа снова меньше чем через 20 часов: сотрётся совсем, если назовёте её после 6 окт., 15:40.',
    );
    // The moment has come by the time the show is watched: no moment in the past.
    expect(plain(changeNote(none, { kind: 'wait', from, count: 1, why: 'hours' }, new Date(2026, 9, 6, 16, 0).getTime()))).toBe(
      '1 строка названа снова меньше чем через 20 часов: назовёте её ещё раз — сотрётся совсем.',
    );
    // Named again the same day: the next day, said as a day.
    const tomorrow = new Date(2026, 9, 7, 0, 0).toISOString();
    expect(plain(changeNote(none, { kind: 'wait', from: tomorrow, count: 3, why: 'day' }, now))).toBe(
      '3 строки названы снова в тот же день: сотрутся совсем, если назовёте их 7 окт. или позже.',
    );
    expect(plain(changeNote({ ...none, erased: 2 }, { kind: 'wait', from, count: 2, why: 'both' }, now))).toBe(
      '2 строки названы снова в тот же день или меньше чем через 20 часов: сотрутся совсем, если назовёте их после 6 окт., 15:40.',
    );
    expect(changeNote({ ...none, rubbed: 1 }, { kind: 'peek' })).toBe('Подсмотренное сегодня ответ не стирает.');
    // Lines named when already erased need a word only when nothing else changed.
    expect(changeNote(none, { kind: 'erased' })).toBe('Названные пункты уже стёрты.');
    expect(changeNote({ ...none, rubbed: 1 }, { kind: 'erased' })).toBeNull();
    expect(changeNote({ ...none, rubbed: 1 }, null)).toBeNull();
  });

  it('says the change on the answer’s protocol, or that nothing changed and why, briefly', () => {
    const from = new Date(2026, 9, 6, 15, 40).toISOString();
    expect(plain(protocolSheetLine({ ...none, erased: 2, rubbed: 1 }))).toBe('На шпаргалке: 2 строки стёрлись, 1 — наполовину');
    expect(plain(protocolSheetLine({ ...none, rubbed: 3, returned: 1 }))).toBe('На шпаргалке: 3 строки стёрлись наполовину, 1 вернулась');
    // A change says itself; why some named lines stayed is the sheet's to tell.
    expect(plain(protocolSheetLine({ ...none, rubbed: 1 }, { kind: 'wait', from, count: 1, why: 'hours' }))).toBe('На шпаргалке: 1 строка стёрлась наполовину');
    expect(protocolSheetLine(none)).toBe('На шпаргалке строки не изменились');
    expect(protocolSheetLine(none, { kind: 'wait', from, count: 1, why: 'day' })).toBe('На шпаргалке строки не изменились: названо снова в тот же день');
    expect(protocolSheetLine(none, { kind: 'wait', from, count: 2, why: 'hours' })).toBe('На шпаргалке строки не изменились: названо снова меньше чем через 20 часов');
    expect(protocolSheetLine(none, { kind: 'peek' })).toBe('На шпаргалке строки не изменились: подсмотренное в тот же день не стирается');
    expect(protocolSheetLine(none, { kind: 'erased' })).toBe('На шпаргалке строки не изменились: названные пункты уже стёрты');
  });

  it('states the price in units', () => {
    expect(plain(priceLine(31, 31, 87))).toBe('31 вопрос — 31 единица ИИ · сегодня осталось 87');
    expect(priceLine(2, 2, null)).toBe(`2${NBSP}вопроса — 2${NBSP}единицы ИИ`);
  });
});
