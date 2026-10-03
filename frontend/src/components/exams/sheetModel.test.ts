import { describe, expect, it } from 'vitest';
import type { ExamQuestion } from '../../api/exams';
import {
  NOT_ENOUGH_CONFIDENCE,
  caveatSentence,
  confidenceSentence,
  confirmedSentence,
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

  it('writes «там же» while the lecture stays the same, and names it again after a section, a hand mark or another lecture', () => {
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
    expect(text(3)).toBe('там же, фрагменты 5, 6');
    expect(text(4)).toBe('отмечено вами');
    expect(text(5)).toBe('Нейронные сети и глубокое обучение, фрагмент 7');
    expect(text(6)).toBe('Инфляция, фрагмент 1');
    expect(text(7)).toBe('Инфляция, фрагмент 2');
    expect(text(8)).toBe('там же, фрагмент 9');
  });

  it('cuts a long lecture title at a word so that the fragment still fits in two lines', () => {
    const long = 'Денежно-кредитная политика центрального банка в условиях открытой экономики и плавающего курса';
    const [view] = marginNotes([{ section: null, footnote: { title: long, fragments: 'фрагмент 12', manual: false, materialId: 'm1' } }]);
    expect(view?.lead.endsWith('…')).toBe(true);
    expect(`${view?.lead}, ${view?.fragments}`.length).toBeLessThanOrEqual(56);
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
  it('says «Подтверждено ответами — 6 из 40.» only after answers, with no date after the number', () => {
    expect(plain(confirmedSentence({ total: 40, confirmed: 6, once: 2, notPassed: 1, untested: 31, since: '2026-10-07' }))).toBe(
      'Подтверждено ответами — 6 из 40.',
    );
    // «0 из 40, с 1 окт.» read as a claim about the date; the date of a change is peak 3's.
    expect(plain(confirmedSentence({ total: 40, confirmed: 0, once: 1, notPassed: 0, untested: 39, since: '2026-10-01' }))).toBe(
      'Подтверждено ответами — 0 из 40.',
    );
    expect(confirmedSentence({ total: 40, confirmed: 0, once: 0, notPassed: 0, untested: 40, since: null })).toBeNull();
  });

  it('compares «знаю» with answers only with enough data', () => {
    expect(confidenceSentence({ ratedKnow: 18, ratedKnowAnswered: 2, ratedKnowPassed: 1, enoughData: false })).toBe(NOT_ENOUGH_CONFIDENCE);
    expect(confidenceSentence({ ratedKnow: 18, ratedKnowAnswered: 10, ratedKnowPassed: 8, enoughData: true })).toBe(
      'Вы отметили «знаю» у 18 вопросов. Из 10 таких, на которые вы ответили вслух, зачтено 8.',
    );
    expect(confidenceSentence({ ratedKnow: 21, ratedKnowAnswered: 3, ratedKnowPassed: 3, enoughData: true })).toContain('у 21 вопроса.');
  });
});
