import { describe, expect, it } from 'vitest';
import type { ExamQuestion } from '../../api/exams';
import {
  CONFIRMED_MEANING,
  FILTER_NAMES,
  NOT_ENOUGH_CONFIDENCE,
  SHEET_FILTERS,
  caveatSentence,
  closePartialLine,
  closedPartialShares,
  confirmedAgeSentence,
  coverageCounts as countsOf,
  noneFigureName,
  noneLabel,
  noneTicketsLine,
  questionShareText,
  readinessWords,
  sheetFilterOf,
  confidenceSentence,
  confirmedSentence,
  knowPassedSentence,
  coverageCounts,
  coverageShares,
  endSentence,
  footnoteOf,
  marginNotes,
  glue,
  layoutPhrase,
  matchesFilter,
  numberOf,
  ratingCounts,
  shareText,
  shortenTitle,
  unmappedSentence,
  unverifiedSentence,
  type ShareSubject,
} from './sheetModel';
import type { SheetCoverage } from './marks';

const plain = (text: string | null) => (text ?? '').replace(/ /g, ' ');

function subjects(spec: Array<[SheetCoverage, number]>): ShareSubject[] {
  const out: ShareSubject[] = [];
  for (const [coverage, count] of spec) {
    for (let i = 0; i < count; i += 1) out.push({ id: `q${out.length + 1}`, section: null, coverage });
  }
  return out;
}

describe('typesetting', () => {
  it('keeps a number with its word and never starts a line with «·»', () => {
    expect(glue('9 лекций · 40 вопросов')).toBe('9 лекций · 40 вопросов');
    expect(glue('35 %')).toBe('35 %');
  });

  it('ends a sentence once', () => {
    expect(endSentence('с 7 окт.')).toBe('с 7 окт.');
    expect(endSentence('с 7 мая')).toBe('с 7 мая.');
  });
});

describe('ticket shares by coverage', () => {
  const layout = { mode: 'random' as const, per_ticket: 2 };

  it('counts only «есть» and gives 35 % of tickets for 24 of 40', () => {
    const shares = coverageShares(subjects([['full', 24], ['partial', 7], ['none', 9]]), layout);
    expect(plain(shareText(shares, 'all'))).toBe('35 %');
    expect(plain(shareText(shares, 'atLeastOne'))).toBe('85 %');
    expect(plain(caveatSentence(shares, 40))).toBe('Это доля билетов, а не вероятность сдать: считаем, что билет — два случайных вопроса из 40.');
  });

  it('turns questions found by words, not mapped yet or being checked into a range, not a gap', () => {
    for (const unknown of ['unverified', 'unmapped', 'checking'] as SheetCoverage[]) {
      const shares = coverageShares(subjects([['full', 24], [unknown, 4], ['none', 12]]), layout);
      expect(shares.isRange).toBe(true);
      expect(plain(shareText(shares, 'all'))).toBe('35–48 %');
    }
    const shares = coverageShares(subjects([['full', 24], ['unverified', 3], ['none', 13]]), layout);
    expect(plain(unverifiedSentence(3, shares))).toBe('3 вопроса проверены только по словам — доля билетов: 35–45 %.');
    expect(plain(unmappedSentence(21, shares))).toBe('21 вопрос ещё не сверен с лекциями — доля билетов: 35–45 %.');
  });

  it('words the layout', () => {
    expect(layoutPhrase(40, layout)).toBe('40 вопросов, в билете два');
    expect(layoutPhrase(21, { mode: 'sections', per_ticket: 2 })).toBe('21 вопрос, в билете по вопросу из каждого раздела');
    expect(layoutPhrase(40, { mode: 'fixed', per_ticket: 2, tickets: [{ number: 1, question_ids: ['a', 'b'] }, { number: 2, question_ids: ['c'] }] })).toBe(
      '40 вопросов, 2 билета по списку кафедры',
    );
  });
});

describe('rows', () => {
  const base: Pick<ExamQuestion, 'coverage' | 'coverage_method' | 'evidence'> = { coverage: 'full', coverage_method: 'llm', evidence: [] };

  it('notes the lecture and its fragments on the margin, «отмечено вами» for a hand mark, nothing for a gap', () => {
    expect(
      footnoteOf({
        ...base,
        evidence: [
          { material_id: 'm1', material_title: 'Денежный рынок', source_id: 'S05', excerpt: '' },
          { material_id: 'm1', material_title: 'Денежный рынок', source_id: 'M1:S01', excerpt: '' },
          { material_id: 'm2', material_title: 'Другая', source_id: 'S09', excerpt: '' },
        ],
      }),
    ).toEqual({ title: 'Денежный рынок', fragments: 'фрагменты 1, 5', manual: false, materialId: 'm1' });
    expect(footnoteOf({ ...base, coverage_method: 'manual' })).toEqual({ title: 'отмечено вами', fragments: '', manual: true, materialId: '' });
    expect(footnoteOf({ ...base, coverage: 'none' })).toBeNull();
  });

  it('writes «там же» while the lecture stays the same, and names it again after a section, a row without a note, a hand mark or another lecture', () => {
    const note = (materialId: string, fragments: string, title = materialId === 'm1' ? 'Нейронные сети и глубокое обучение' : 'Инфляция') => ({
      title,
      fragments,
      manual: false,
      materialId,
    });
    const views = marginNotes([
      { section: 1, footnote: note('m1', 'фрагмент 3') },
      { section: 1, footnote: note('m1', 'фрагмент 4') },
      { section: 1, footnote: null },
      { section: 1, footnote: note('m1', 'фрагменты 5, 6') },
      { section: 1, footnote: { title: 'отмечено вами', fragments: '', manual: true, materialId: '' } },
      { section: 1, footnote: note('m1', 'фрагмент 7') },
      { section: 1, footnote: note('m2', 'фрагмент 1') },
      { section: 2, footnote: note('m2', 'фрагмент 2') },
      { section: 2, footnote: note('m2', 'фрагмент 9') },
    ]);
    const text = (index: number) => {
      const view = views[index];
      return view ? `${view.lead}${view.fragments ? `, ${view.fragments}` : ''}` : null;
    };
    expect(text(0)).toBe('Нейронные сети и глубокое обучение, фрагмент 3');
    expect(views[0]?.named).toBe(true);
    expect(text(1)).toBe('там же, фрагмент 4');
    expect(views[1]?.named).toBe(false);
    expect(text(2)).toBeNull();
    // «Там же» means the line right above: after a row without a note the lecture is named again
    // (redesign critique 7, round 2: «там же» used to sit right under the selected dash of № 17).
    expect(text(3)).toBe('Нейронные сети и глубокое обучение, фрагменты 5, 6');
    expect(views[3]?.named).toBe(true);
    expect(text(4)).toBe('отмечено вами');
    expect(text(5)).toBe('Нейронные сети и глубокое обучение, фрагмент 7');
    expect(text(6)).toBe('Инфляция, фрагмент 1');
    expect(text(7)).toBe('Инфляция, фрагмент 2');
    expect(text(8)).toBe('там же, фрагмент 9');
  });

  it('names the lecture whole when it fits; cuts only a very long title, at a word, never after «и» or «в»', () => {
    // The owner's laptop, 2026-10-08: «Реляционная модель данных: ключи и…, фрагменты 3, 4» on a wide sheet.
    const [whole] = marginNotes([
      { section: null, footnote: { title: 'Реляционная модель данных: ключи и связи', fragments: 'фрагменты 3, 4', manual: false, materialId: 'm1' } },
    ]);
    expect(whole?.lead).toBe('Реляционная модель данных: ключи и связи');
    const long = 'Денежно-кредитная политика центрального банка в условиях открытой экономики и плавающего курса национальной валюты';
    const [view] = marginNotes([{ section: null, footnote: { title: long, fragments: 'фрагмент 12', manual: false, materialId: 'm1' } }]);
    expect(view?.lead.endsWith('…')).toBe(true);
    expect(`${view?.lead}, ${view?.fragments}`.length).toBeLessThanOrEqual(90);
    expect(view?.lead).toBe('Денежно-кредитная политика центрального банка в условиях открытой экономики…');
    // A cut that would end on a conjunction or a preposition steps back to the word before it.
    expect(shortenTitle('Модели данных и их связи между собой', 20)).toBe('Модели данных…');
    expect(shortenTitle('Нормализация отношений и функциональные зависимости', 30)).toBe('Нормализация отношений…');
    expect(shortenTitle('Короткое название', 40)).toBe('Короткое название');
  });

  it('numbers a question by the department’s label, else by position', () => {
    expect(numberOf({ label: '12.', position: 3 })).toBe('12');
    expect(numberOf({ label: '', position: 3 })).toBe('3');
  });

  it('filters by coverage, readiness and self-rating', () => {
    const item = { coverage: 'checking' as SheetCoverage, readiness: 'once' as const, selfRating: null };
    expect(matchesFilter('cov:unmapped', item)).toBe(true);
    expect(matchesFilter('cov:full', item)).toBe(false);
    expect(matchesFilter('rd:once', item)).toBe(true);
    expect(matchesFilter('sr:none', item)).toBe(true);
    expect(matchesFilter('sr:know', { ...item, selfRating: 'know' })).toBe(true);
    expect(coverageCounts([{ coverage: 'full' }, { coverage: 'checking' }])).toMatchObject({ total: 2, full: 1, checking: 1 });
    expect(ratingCounts([{ selfRating: 'know' }, { selfRating: null }])).toEqual({ know: 1, unsure: 0, dont_know: 0, none: 1 });
  });
});

describe('answers and confidence', () => {
  it('says «Выучено — 6 из 40.» only after answers, with no date after the number', () => {
    expect(plain(confirmedSentence({ total: 40, confirmed: 6, once: 2, notPassed: 1, untested: 31, since: '2026-10-07' }))).toBe(
      'Выучено 6 из 40.',
    );
    // «0 из 40, с 1 окт.» read as a claim about the date; the date of a change is peak 3's.
    expect(plain(confirmedSentence({ total: 40, confirmed: 0, once: 1, notPassed: 0, untested: 39, since: '2026-10-01' }))).toBe(
      'Выучено 0 из 40.',
    );
    expect(confirmedSentence({ total: 40, confirmed: 0, once: 0, notPassed: 0, untested: 40, since: null })).toBeNull();
  });

  it('compares «знаю» with answers only with enough data; a typed answer counts, a passed one «named enough» (no «засчитано», Ф1)', () => {
    expect(confidenceSentence({ ratedKnow: 18, ratedKnowAnswered: 2, ratedKnowPassed: 1, enoughData: false })).toBe(NOT_ENOUGH_CONFIDENCE);
    expect(confidenceSentence({ ratedKnow: 18, ratedKnowAnswered: 10, ratedKnowPassed: 8, enoughData: true })).toBe(
      'Вы отметили «знаю» у 18 вопросов. Из 10 таких, на которые вы ответили, полный ответ в 8.',
    );
    expect(confidenceSentence({ ratedKnow: 21, ratedKnowAnswered: 3, ratedKnowPassed: 3, enoughData: true })).toContain('у 21 вопроса.');
    expect(CONFIRMED_MEANING).toBe('Вопрос выучен, когда вы дважды, в разные дни, ответили на него полно.');
    expect(knowPassedSentence({ ratedKnowAnswered: 1, ratedKnowPassed: 1 }, true)).toBe('Из 1 вопроса с отметкой «знаю», на которые вы ответили, полный ответ в 1.');
  });

  it('names the readiness filters with the new words', () => {
    expect(FILTER_NAMES['rd:once']).toBe('ответ полный, ещё не выучено');
    expect(FILTER_NAMES['rd:not_passed']).toBe('ответ неполный');
    expect(FILTER_NAMES['rd:confirmed']).toBe('выучено');
    for (const name of Object.values(FILTER_NAMES)) expect(name).not.toMatch(/зачт[её]н|в один день|вслух/);
  });
});

describe('the address filter (?filter=)', () => {
  it('takes a known filter and shows every question for anything else', () => {
    expect(sheetFilterOf('cov:none')).toBe('cov:none');
    expect(sheetFilterOf('rd:once')).toBe('rd:once');
    expect(sheetFilterOf('sr:know')).toBe('sr:know');
    expect(sheetFilterOf('garbage')).toBe('all');
    expect(sheetFilterOf('cov:')).toBe('all');
    expect(sheetFilterOf(null)).toBe('all');
    expect(sheetFilterOf(undefined)).toBe('all');
    expect(SHEET_FILTERS).toContain('cov:partial');
    expect(SHEET_FILTERS).toHaveLength(14);
  });
});

describe('peak 1: from the gap to an action (Jury_Check item 10)', () => {
  /** The seeded stage list: 24 «есть», 7 «частично», 9 «нет»; sections 13 · 4 · 3 and 11 · 3 · 6. */
  const NONE = new Set([5, 8, 17, 22, 26, 29, 35, 38, 40]);
  const PARTIAL = new Set([3, 9, 14, 19, 24, 33, 37]);
  function seeded(unknown: Set<number> = new Set()): ShareSubject[] {
    return Array.from({ length: 40 }, (_, index) => {
      const position = index + 1;
      const coverage: SheetCoverage = unknown.has(position) ? 'unverified' : NONE.has(position) ? 'none' : PARTIAL.has(position) ? 'partial' : 'full';
      return { id: `q${position}`, section: position <= 20 ? 1 : 2, coverage };
    });
  }
  const tickets = Array.from({ length: 20 }, (_, index) => ({ number: index + 1, question_ids: [`q${index + 1}`, `q${index + 21}`] }));

  it('names the questions in no lecture beside the figure, and the figure as a filter', () => {
    expect(noneLabel(9)).toBe('вопросов нет ни в одной лекции');
    expect(noneLabel(1)).toBe('вопроса нет ни в одной лекции');
    expect(noneLabel(21)).toBe('вопроса нет ни в одной лекции');
    expect(noneFigureName(9)).toBe('9 вопросов нет ни в одной лекции. Показать их');
    expect(noneFigureName(1)).toBe('1 вопроса нет ни в одной лекции. Показать его');
  });

  it('random pairs: 35 % of tickets, «в 15 % билетов нет ни одного вопроса с отметкой «есть»», closing «частично» gives 60 %', () => {
    const layout = { mode: 'random' as const, per_ticket: 2 };
    const shares = coverageShares(seeded(), layout);
    expect(plain(shareText(shares, 'all'))).toBe('35 %');
    expect(plain(noneTicketsLine(shares))).toBe('в 15 % билетов нет ни одного вопроса с отметкой «есть»');
    const line = closePartialLine(7, shares, closedPartialShares(seeded(), layout));
    // «Закройте 7 вопросов» read as «закройте окно» (audit 2026-10-08): the line says what to do, the link first.
    expect(plain(line?.text ?? null)).toBe('7 вопросов «частично»: добавьте к ним материал — тогда оба вопроса будут в лекциях в 60 % билетов.');
    expect(line?.link).toBe('7 вопросов «частично»');
    expect(plain(line?.rest ?? null)).toBe(': добавьте к ним материал — тогда оба вопроса будут в лекциях в 60 % билетов.');
  });

  it('one question per section: 13/20 × 11/20 → 36 %, «в 16 %», closing «частично» → 60 %', () => {
    const layout = { mode: 'sections' as const, per_ticket: 2 };
    const shares = coverageShares(seeded(), layout);
    expect(plain(shareText(shares, 'all'))).toBe('36 %');
    expect(plain(noneTicketsLine(shares))).toBe('в 16 % билетов нет ни одного вопроса с отметкой «есть»');
    expect(plain(closePartialLine(7, shares, closedPartialShares(seeded(), layout))?.text ?? null)).toBe(
      '7 вопросов «частично»: добавьте к ним материал — тогда оба вопроса будут в лекциях в 60 % билетов.',
    );
  });

  it('the department’s tickets: direct counts', () => {
    const layout = { mode: 'fixed' as const, per_ticket: 2, tickets };
    const shares = coverageShares(seeded(), layout);
    expect(plain(noneTicketsLine(shares))).toBe('в 2 из 20 билетов нет ни одного вопроса с отметкой «есть»');
    expect(plain(closePartialLine(7, shares, closedPartialShares(seeded(), layout))?.text ?? null)).toBe(
      '7 вопросов «частично»: добавьте к ним материал — тогда все вопросы будут в лекциях в 11 из 20 билетов.',
    );
  });

  it('gives ranges while some questions are unknown', () => {
    const layout = { mode: 'random' as const, per_ticket: 2 };
    const unknown = new Set([1, 2, 4, 6]);
    const shares = coverageShares(seeded(unknown), layout);
    // Four «есть» became unknown: 20 to 24 «есть». «Ни одного» is widest when the unknown ones are
    // absent: C(20, 2) = 190 of 780 (24 %), and C(16, 2) = 120 of 780 (15 %) when they are there.
    expect(plain(noneTicketsLine(shares))).toBe('в 15–24 % билетов нет ни одного вопроса с отметкой «есть»');
    // With «частично» closed: C(27, 2) = 351 (45 %) to C(31, 2) = 465 (60 %).
    expect(plain(closePartialLine(7, shares, closedPartialShares(seeded(unknown), layout))?.text ?? null)).toBe(
      '7 вопросов «частично»: добавьте к ним материал — тогда оба вопроса будут в лекциях в 45–60 % билетов.',
    );
    const fixed = coverageShares(seeded(unknown), { mode: 'fixed', per_ticket: 2, tickets });
    expect(plain(noneTicketsLine(fixed))).toMatch(/^в \d+–\d+ из 20 билетов нет ни одного вопроса с отметкой «есть»$/);
  });

  it('hides the action line without «частично» or without a gain; one question per ticket speaks of questions', () => {
    const layout = { mode: 'random' as const, per_ticket: 2 };
    const shares = coverageShares(seeded(), layout);
    expect(closePartialLine(0, shares, closedPartialShares(seeded(), layout))).toBeNull();
    // Closing «частично» in a list where a ticket can never be complete raises nothing.
    const tiny = subjects([['full', 1], ['partial', 1], ['none', 38]]);
    expect(closePartialLine(1, coverageShares(tiny, { mode: 'random', per_ticket: 3 }), closedPartialShares(tiny, { mode: 'random', per_ticket: 3 }))).toBeNull();
    const single = { mode: 'random' as const, per_ticket: 1 };
    const singleShares = coverageShares(seeded(), single);
    expect(noneTicketsLine(singleShares)).toBeNull();
    expect(plain(closePartialLine(7, singleShares, closedPartialShares(seeded(), single))?.text ?? null)).toBe(
      '7 вопросов «частично»: добавьте к ним материал — тогда в лекциях будет 78 % вопросов.',
    );
    const one = closePartialLine(1, singleShares, closedPartialShares(seeded(), single));
    expect(one?.link).toBe('1 вопрос «частично»');
    expect(one?.rest.startsWith(': добавьте к нему материал — тогда')).toBe(true);
  });

  it('shows the question share as a range with unverified and unmapped questions: 17 «есть» and 10 «только по словам» of 40 → 43–68 %', () => {
    const counts = countsOf([
      ...Array.from({ length: 17 }, () => ({ coverage: 'full' as SheetCoverage })),
      ...Array.from({ length: 10 }, () => ({ coverage: 'unverified' as SheetCoverage })),
      ...Array.from({ length: 13 }, () => ({ coverage: 'none' as SheetCoverage })),
    ]);
    expect(plain(questionShareText(counts))).toBe('43–68 %');
    const unmapped = countsOf([
      ...Array.from({ length: 24 }, () => ({ coverage: 'full' as SheetCoverage })),
      ...Array.from({ length: 4 }, () => ({ coverage: 'unmapped' as SheetCoverage })),
      ...Array.from({ length: 12 }, () => ({ coverage: 'none' as SheetCoverage })),
    ]);
    expect(plain(questionShareText(unmapped))).toBe('60–70 %');
    expect(plain(questionShareText(countsOf(seeded().map((item) => ({ coverage: item.coverage })))))).toBe('60 %');
  });
});

describe('the age of a confirmation', () => {
  const now = new Date(2026, 9, 5, 12, 0);
  const state = (lastPassDate: string, stale = false) => ({ readiness: 'confirmed' as const, lastPassDate, stale });

  it('counts from the last passed answer', () => {
    expect(plain(confirmedAgeSentence(state('2026-10-03'), now))).toBe('Выучено 3 октября, 2 дня назад.');
    expect(confirmedAgeSentence(state('2026-10-05'), now)).toBe('Выучено сегодня.');
    expect(confirmedAgeSentence(state('2026-10-04'), now)).toBe('Выучено вчера.');
    expect(plain(confirmedAgeSentence(state('2026-09-19', true), now))).toBe('Выучено 16 дней назад. Пора проверить.');
    expect(confirmedAgeSentence({ readiness: 'once', lastPassDate: '2026-10-03', stale: false }, now)).toBeNull();
  });

  it('gives a screen reader the same age after the number', () => {
    expect(readinessWords(state('2026-10-03'), now)).toBe('выучено 2 дня назад');
    expect(readinessWords(state('2026-10-05'), now)).toBe('выучено сегодня');
    expect(readinessWords(state('2026-09-19', true), now)).toBe('выучено 16 дней назад, пора проверить');
    expect(readinessWords({ readiness: 'once', lastPassDate: null, stale: false }, now)).toBe('ответ полный, ещё не выучено');
    expect(readinessWords({ readiness: 'not_passed', lastPassDate: null, stale: false }, now)).toBe('ответ неполный');
    expect(readinessWords({ readiness: 'untested', lastPassDate: null, stale: false }, now)).toBe('');
  });
});
