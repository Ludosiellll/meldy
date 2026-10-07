import { afterEach, describe, expect, it } from 'vitest';
import { answerQuote, drawExampleQuestion, exampleFollowup, judgeFollowupAnswer, keywordEvaluation, resetExampleDraws, STUDENT_QUOTE_CHARS } from './exampleFlow';
import { exampleQuestion, exampleRubric } from '../../data/example';
import { liveMarks } from '../../lib/oral/rubricMatch';
import { gradeAnswer } from '../../lib/oral/oralGrade';

const rubricOf = (id: string) => exampleRubric(exampleQuestion(id)!)!;

/** The example's check end to end: live marks → statuses → follow-up → the app's grade. */
function check(id: string, answer: string) {
  const rubric = rubricOf(id);
  const live = liveMarks(rubric.points, answer, '');
  const evaluation = keywordEvaluation(rubric.points, live, answer);
  return { rubric, live, evaluation, followup: exampleFollowup(rubric.points, answer, evaluation) };
}

function grade(id: string, answer: string, followup: { status: 'covered' | 'partial' | 'missing' | 'wrong'; judgedBy: 'keywords' | null } | null) {
  const { rubric, evaluation, followup: choice } = check(id, answer);
  const statuses = new Map(evaluation.points.map((point) => [point.id, point.status]));
  return gradeAnswer(
    rubric.points.map((point) => ({ id: point.id, essential: point.essential, status: statuses.get(point.id) ?? 'unrated' })),
    choice && followup ? { point_id: choice.pointId, ...followup } : null,
  );
}

const Q1_PARTIAL = 'Закон спроса такой: когда цена растёт, люди покупают меньше. Кривая спроса на графике идёт вниз.';

afterEach(() => resetExampleDraws());

describe('answerQuote: the student’s words for the protocol', () => {
  const anchors = rubricOf('q1').points[1].anchors; // «Закон спроса: чем выше цена, тем меньше…»

  it('is the sentence in which the point was named', () => {
    expect(answerQuote(`Начну с главного. ${Q1_PARTIAL}`, anchors)).toBe('Закон спроса такой: когда цена растёт, люди покупают меньше');
  });

  it('is a window of words around the match in long speech without punctuation, marked with «…»', () => {
    const speech = `ну вот ${'значит есть рынок и на нём продают товары '.repeat(4)}закон спроса говорит что чем выше цена тем меньше покупают ${'и это видно на любом рынке если подумать '.repeat(4)}`;
    const quote = answerQuote(speech, anchors);
    expect(quote.length).toBeLessThanOrEqual(STUDENT_QUOTE_CHARS);
    expect(quote.startsWith('…')).toBe(true);
    expect(quote.endsWith('…')).toBe(true);
    expect(quote).toContain('закон спроса говорит что чем выше цена тем меньше');
  });

  it('is empty when the text does not name the point', () => {
    expect(answerQuote('Кривая спроса идёт вниз.', anchors)).toBe('');
    expect(answerQuote('', anchors)).toBe('');
  });
});

describe('keywordEvaluation: the key words in place of the AI', () => {
  it('calls the points named during the answer «раскрыт» with the student’s words, the rest «не назван», never «ошибка»', () => {
    const { live, evaluation } = check('q1', Q1_PARTIAL);
    expect(Array.from(live)).toEqual(['p2', 'p3']);
    expect(evaluation.points.map((point) => point.status)).toEqual(['missing', 'covered', 'covered', 'missing']);
    expect(evaluation.points[1].student_quote).toBe('Закон спроса такой: когда цена растёт, люди покупают меньше');
    expect(evaluation.points[2].student_quote).toBe('Кривая спроса на графике идёт вниз');
    expect(evaluation.points[0].student_quote).toBe('');
    expect(evaluation.errors).toEqual([]);
  });

  it('takes the words from the text in which a point lit up when the final answer lost them', () => {
    const rubric = rubricOf('q1');
    const earlier = 'Закон спроса: чем выше цена, тем меньше покупают';
    const evaluation = keywordEvaluation(rubric.points, new Set(['p2']), 'Что-то другое.', { p2: earlier });
    expect(evaluation.points[1]).toMatchObject({ status: 'covered', student_quote: earlier });
  });
});

describe('exampleFollowup: followup.ts with the key-word statuses', () => {
  it('asks about the first main point that was not named, in rubric order', () => {
    const { followup, rubric } = check('q1', Q1_PARTIAL);
    expect(followup).toEqual({ pointId: 'p1', chosenBy: 'check' });
    expect(rubric.points[0].followup.question).toBe('Что экономисты называют спросом?');
  });

  it('prefers the browser’s candidate: a main point with no key word at all', () => {
    // p1 (явные) and p3 (бухгалтерская) are named; p2 (неявные) is never mentioned — an explicit miss.
    const { followup } = check('q9', 'Явные издержки — это прямые платежи фирмы: зарплата, аренда, сырьё. Бухгалтерская прибыль — это выручка минус явные издержки.');
    expect(followup).toEqual({ pointId: 'p2', chosenBy: 'check' });
  });

  it('asks about a point that is not main when every main point is named', () => {
    const { followup, rubric } = check('q1', 'Спрос — это сколько товара покупатели готовы купить. Закон спроса: чем выше цена, тем меньше покупают. Кривая спроса идёт вниз.');
    expect(followup?.pointId).toBe('p4');
    expect(rubric.points[3].essential).toBe(false);
  });

  it('asks nothing when every point was named', () => {
    const { followup } = check(
      'q4',
      'Равновесие — это точка, где пересекаются кривые спроса и предложения. При равновесной цене величина спроса равна величине предложения. Если цена ниже равновесной, возникает дефицит: спрос превышает предложение. Если цена выше, возникает излишек, и продавцы снижают цену. В итоге цена сама приходит к равновесию.',
    );
    expect(followup).toBeNull();
  });
});

describe('judgeFollowupAnswer: the answer to the examiner', () => {
  const point = rubricOf('q1').points[0];
  const question = point.followup.question;

  it('takes «не знаю» said or typed as the button: not counted, trusted', () => {
    expect(judgeFollowupAnswer(point, question, 'Ну, не знаю')).toEqual({ status: 'missing', judgedBy: null });
  });

  it('gives a real answer «частично» by key words at most, and says so', () => {
    expect(judgeFollowupAnswer(point, question, 'Это когда покупатели готовы купить определённое количество товара при каждой цене')).toEqual({
      status: 'partial',
      judgedBy: 'keywords',
    });
  });

  it('does not count an echo of the question', () => {
    expect(judgeFollowupAnswer(point, question, 'Экономисты называют спросом спрос')).toEqual({ status: 'missing', judgedBy: 'keywords' });
  });
});

describe('the grade: the app’s formula over the example’s check', () => {
  it('scores a partial answer with a partial answer to the follow-up: (0,5 + 2 + 1 + 0) / 6 = 58 → 3', () => {
    const result = grade('q1', Q1_PARTIAL, { status: 'partial', judgedBy: 'keywords' });
    expect(result).toMatchObject({ score: 58, grade: 3, sumWeighted: 3.5, sumWeights: 6 });
    expect(result.terms.map((term) => term.weight * term.credit)).toEqual([0.5, 2, 1, 0]);
  });

  it('applies the cap for a main point the examiner asked about and «не знаю» (a trusted verdict)', () => {
    const result = grade('q1', 'Спрос — это сколько товара покупатели готовы купить. Кривая спроса идёт вниз, а величина спроса — количество при конкретной цене.', {
      status: 'missing',
      judgedBy: null,
    });
    // p1, p3, p4 named; p2 (essential) asked and not recovered: 2 + 0 + 1 + 1 = 4 of 6 → 67 → 4, capped at 3.
    expect(result.score).toBe(67);
    expect(result.grade).toBe(3);
    expect(result.cap).toBe('essential_unrecovered');
  });

  it('gives a 5 to an answer that names every point', () => {
    const result = grade(
      'q7',
      'Выручка — это цена, умноженная на количество проданного товара. Если спрос эластичный, выгодно снижать цену. Если спрос неэластичный, выручку увеличивает повышение цены. При единичной эластичности выручка не меняется.',
      null,
    );
    expect(result).toMatchObject({ score: 100, grade: 5 });
  });
});

describe('drawExampleQuestion: «Тянуть билет» of the example', () => {
  it('draws only questions the lectures cover and never repeats the last three', () => {
    const zero = () => 0;
    const drawn = [1, 2, 3, 4].map(() => drawExampleQuestion(zero)!.id);
    expect(drawn).toEqual(['q1', 'q2', 'q3', 'q4']);
    resetExampleDraws();
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) seen.add(drawExampleQuestion()!.id);
    expect(seen.has('q12')).toBe(false);
    expect(seen.size).toBe(11);
  });
});
