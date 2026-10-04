import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_EXAM,
  EXAMPLE_LECTURES,
  EXAMPLE_QUESTIONS,
  FRAGMENT_CHARS,
  answerableQuestions,
  exampleExamQuestion,
  exampleQuestion,
  exampleRubric,
  exampleRubricResponse,
  exampleTicket,
  fragmentText,
  lectureOf,
} from './index';
import { namedPoints, normalize, probablyNamed, variantPositions, words } from '../../lib/oral/rubricMatch';
import { parseRubricResponse } from '../../lib/oral/oralApi';
import { splitFragmentHeading } from '../../utils/fragmentText';

// ── The server's rules for a rubric (backend/oral.py validate_rubric, _RUBRIC_PROMPT) ─────────────

const MIN_POINTS = 3;
const MAX_POINTS = 5; // the brief: 3–5 points (the server allows up to 6)
const QUOTE_MIN_LETTERS = 12;
const QUOTE_MAX_CHARS = 220;
const TITLE_CHARS = 90; // the prompt's limit (the server cuts at 120)
const FOLLOWUP_QUESTION_CHARS = 150; // the prompt's limit (the server drops a point over 200)
const FOLLOWUP_EXPECTED_CHARS = 200;
const MAX_GROUPS = 4;
const MAX_VARIANTS = 4;
const MAX_VARIANT_PARTS = 3;
const MAX_VARIANT_CHARS = 40;
const MIN_PART_CHARS = 3;
/** backend/oral.py GENERAL_STEMS */
const GENERAL_STEMS = ['являет', 'процесс', 'данн', 'котор', 'можн', 'важн', 'очен', 'такж'];
/** backend/retrieval.py STOPWORDS */
const STOPWORDS = new Set(
  `и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне
  было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него
  до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы
  тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому
  этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех
  никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них
  какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя
  такой им более всегда конечно всю между это также который которая которое которые которого
  которой котором которым которых является являются каждый каждая каждое каждого`.split(/\s+/),
);

/** backend/oral.py _general_part: a stopword, or a word beginning tied to a general stem. */
function generalPart(part: string): boolean {
  if (STOPWORDS.has(part)) return true;
  return GENERAL_STEMS.some((stem) => stem.startsWith(part) || (part.startsWith(stem) && part.length - stem.length <= 3));
}

const letters = (text: string) => Array.from(text).filter((char) => /\p{L}/u.test(char)).length;

/** Answers in a student's own words (not copied from the lectures) that name every point. */
const FULL_ANSWERS: Record<string, string> = {
  q1: 'Спрос — это сколько товара покупатели готовы купить по разным ценам за какой-то период. Закон спроса: чем выше цена, тем меньше покупают. На графике кривая спроса идёт вниз, у неё отрицательный наклон. Величина спроса — это количество при одной конкретной цене.',
  q2: 'Кроме цены на спрос влияют доходы и вкусы покупателей, цены товаров-заменителей и дополняющих товаров, ожидания. Если меняется цена самого товара, мы просто движемся вдоль кривой спроса. А если меняется неценовой фактор, вся кривая сдвигается: вправо, когда спрос растёт, и влево, когда падает.',
  q3: 'Закон предложения: чем выше цена, тем больше товара продавцы готовы продать. Продавать по высокой цене выгоднее, поэтому производители выпускают больше и на рынок приходят новые продавцы. Кривая предложения идёт вверх. Ещё предложение зависит от цен на ресурсы, технологий, налогов и субсидий — они сдвигают кривую.',
  q4: 'Равновесие — это точка, где пересекаются кривые спроса и предложения. При равновесной цене величина спроса равна величине предложения. Если цена ниже равновесной, возникает дефицит: спрос превышает предложение. Если цена выше, возникает излишек, и продавцы снижают цену. В итоге цена сама приходит к равновесию.',
  q5: 'Ценовая эластичность спроса показывает, на сколько процентов изменится спрос, если цена изменится на один процент. Считают её как отношение процентного изменения спроса к процентному изменению цены. Если эластичность по модулю больше единицы — спрос эластичный, если меньше единицы — неэластичный. Знак обычно отрицательный. Крайние случаи — совершенно эластичный и совершенно неэластичный спрос, который вообще не зависит от цены.',
  q6: 'Эластичность зависит от того, есть ли у товара заменители: чем их больше, тем эластичнее спрос. Важна доля товара в бюджете: на дорогие покупки спрос эластичнее. Товары первой необходимости вроде лекарств имеют неэластичный спрос, а роскошь — эластичный. И со временем спрос становится эластичнее.',
  q7: 'Выручка — это цена, умноженная на количество проданного товара. Если спрос эластичный, выгодно снижать цену: продажи вырастут, и выручка тоже. Если спрос неэластичный, выручку увеличивает повышение цены. При единичной эластичности выручка не меняется.',
  q8: 'Перекрёстная эластичность показывает, как спрос на один товар реагирует на цену другого товара. У заменителей она положительная, у дополняющих товаров — отрицательная. Эластичность по доходу у нормальных товаров положительная, а у низших товаров отрицательная.',
  q9: 'Явные издержки — это прямые платежи: зарплата, аренда, сырьё. Неявные издержки — это альтернативная стоимость собственных ресурсов владельца, например упущенная зарплата. Бухгалтерская прибыль — это выручка минус явные издержки. Экономическая прибыль учитывает ещё и неявные, поэтому она меньше. Если экономическая прибыль нулевая, её называют нормальной.',
  q10: 'Постоянные издержки не зависят от объёма выпуска, например аренда. Переменные растут вместе с выпуском — это сырьё и материалы. Вместе они дают общие издержки, это их сумма. Средние издержки — это издержки на единицу продукции. Предельные издержки — это прирост издержек, когда выпускаешь ещё одну единицу.',
  q11: 'Прибыль — это разница между выручкой и издержками. Предельная выручка — прирост выручки от продажи ещё одной единицы. Пока предельная выручка больше предельных издержек, выпуск выгодно увеличивать. Максимальная прибыль там, где предельная выручка равна предельным издержкам.',
};

describe('the example lectures', () => {
  it('are three lectures of 2,500–4,000 characters with the course titles', () => {
    expect(EXAMPLE_LECTURES.map((lecture) => lecture.title)).toEqual(['Спрос и предложение', 'Эластичность спроса', 'Издержки и прибыль фирмы']);
    for (const lecture of EXAMPLE_LECTURES) {
      expect(lecture.text.length).toBeGreaterThanOrEqual(2500);
      expect(lecture.text.length).toBeLessThanOrEqual(4000);
      expect(lecture.text).toBe(lecture.text.trim());
    }
  });

  it('split into fragments S01… like the backend: paragraphs under 850 characters, each with its heading line', () => {
    for (const lecture of EXAMPLE_LECTURES) {
      expect(lecture.fragments.length).toBeGreaterThanOrEqual(5);
      lecture.fragments.forEach((fragment, index) => {
        expect(fragment.id).toBe(`S${String(index + 1).padStart(2, '0')}`);
        expect(fragment.text.length).toBeLessThanOrEqual(FRAGMENT_CHARS);
        expect(lecture.text).toContain(fragment.text);
        // The first fragment opens with the lecture's title, the others with their own headings.
        const { heading, body } = splitFragmentHeading(fragment.text);
        expect(heading).toBeTruthy();
        expect(body.length).toBeGreaterThan(200);
      });
      expect(splitFragmentHeading(lecture.fragments[0].text).heading).toBe(lecture.title);
    }
  });

  it('have unique material ids and keys M1–M3', () => {
    expect(EXAMPLE_LECTURES.map((lecture) => lecture.key)).toEqual(['M1', 'M2', 'M3']);
    expect(new Set(EXAMPLE_LECTURES.map((lecture) => lecture.materialId)).size).toBe(3);
  });
});

describe('the example list of questions', () => {
  it('has twelve numbered questions: nine in the lectures, two partly, one not at all', () => {
    expect(EXAMPLE_QUESTIONS).toHaveLength(12);
    expect(EXAMPLE_QUESTIONS.map((question) => question.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(EXAMPLE_QUESTIONS.map((question) => question.id)).size).toBe(12);
    const count = (coverage: string) => EXAMPLE_QUESTIONS.filter((question) => question.coverage === coverage).length;
    expect([count('full'), count('partial'), count('none')]).toEqual([9, 2, 1]);
    expect(answerableQuestions()).toHaveLength(11);
  });

  it('backs every «есть» and «частично» with quotes cut word for word from the named fragment', () => {
    for (const question of EXAMPLE_QUESTIONS.filter((item) => item.coverage !== 'none')) {
      expect(question.evidence.length, question.id).toBeGreaterThan(0);
      expect(question.reason, question.id).not.toBe('');
      for (const item of question.evidence) {
        const lecture = lectureOf(item.lecture);
        expect(lecture.text, `${question.id} ${item.quote}`).toContain(item.quote);
        expect(fragmentText(item.lecture, item.fragment), `${question.id} ${item.fragment}`).toContain(item.quote);
      }
    }
  });

  it('says what a partial question lacks, and the lectures really lack it', () => {
    const partial = EXAMPLE_QUESTIONS.filter((question) => question.coverage === 'partial');
    expect(partial.map((question) => question.id)).toEqual(['q8', 'q11']);
    for (const question of partial) {
      expect(question.missing).not.toBe('');
      expect(question.coverageNote).not.toBe('');
    }
    const everything = EXAMPLE_LECTURES.map((lecture) => normalize(lecture.text)).join(' ');
    expect(everything).not.toContain('гиффен');
    expect(everything).not.toContain('закрыт');
  });

  it('leaves the question that is in no lecture without evidence, with its nearest fragment and the words they really share', () => {
    const none = EXAMPLE_QUESTIONS.filter((question) => question.coverage === 'none');
    expect(none.map((question) => question.id)).toEqual(['q12']);
    const [question] = none;
    expect(question.evidence).toEqual([]);
    expect(question.points).toEqual([]);
    expect(question.lecture).toBeNull();
    expect(exampleRubric(question)).toBeNull();
    const nearest = question.nearest!;
    // The words of the question that a fragment also has (service words aside).
    const asked = new Set(words(question.text).filter((word) => !STOPWORDS.has(word)));
    const shared = (text: string) => Array.from(new Set(words(text).filter((word) => asked.has(word))));
    expect(shared(fragmentText(nearest.lecture, nearest.fragment)).sort()).toEqual([...nearest.matched].sort());
    // Nearest means nearest: no other fragment of the three lectures shares more of the question's words.
    for (const lecture of EXAMPLE_LECTURES) {
      for (const fragment of lecture.fragments) expect(shared(fragment.text).length, `${lecture.key}:${fragment.id}`).toBeLessThanOrEqual(nearest.matched.length);
    }
    // The subject itself is in no lecture: the labour market and wages.
    const everything = EXAMPLE_LECTURES.map((lecture) => normalize(lecture.text)).join(' ');
    for (const phrase of ['рынок труда', 'рынка труда', 'рынке труда', 'спрос на труд', 'заработн']) expect(everything).not.toContain(phrase);
  });
});

describe('the answer points of every question', () => {
  for (const question of answerableQuestions()) {
    describe(`${question.id}: ${question.text}`, () => {
      const rubric = exampleRubric(question)!;
      const lecture = lectureOf(question.lecture!);

      it('has 3–5 points p1…, 2–4 of them essential, with titles and quotes word for word from the lecture', () => {
        expect(rubric.points.length).toBeGreaterThanOrEqual(MIN_POINTS);
        expect(rubric.points.length).toBeLessThanOrEqual(MAX_POINTS);
        expect(rubric.points.map((point) => point.id)).toEqual(rubric.points.map((_, index) => `p${index + 1}`));
        const essential = rubric.points.filter((point) => point.essential).length;
        expect(essential).toBeGreaterThanOrEqual(2);
        expect(essential).toBeLessThanOrEqual(4);
        for (const point of rubric.points) {
          expect(point.title.length, point.title).toBeLessThanOrEqual(TITLE_CHARS);
          expect(point.title).toBe(point.title.trim());
          // A continuous piece of the lecture, cut by code: exact characters, 12–220, no ellipsis.
          expect(lecture.text, point.source_quote).toContain(point.source_quote);
          const sourceText = point.source_ids.map((id) => fragmentText(lecture.key, id.split(':')[1])).join(' ');
          expect(sourceText, point.source_quote).toContain(point.source_quote);
          expect(point.source_quote.length).toBeLessThanOrEqual(QUOTE_MAX_CHARS);
          expect(letters(point.source_quote)).toBeGreaterThanOrEqual(QUOTE_MIN_LETTERS);
          expect(point.source_quote).not.toMatch(/…|\.\.\./);
          expect(point.source_ids.every((id) => new RegExp(`^${lecture.key}:S\\d{2}$`).test(id))).toBe(true);
        }
        expect(new Set(rubric.points.map((point) => normalize(point.source_quote))).size).toBe(rubric.points.length);
      });

      it('gives every point anchors the server keeps: 2–4 groups of 1–4 word beginnings, none shared, the notion in its fragment', () => {
        const owners = new Map<string, string>();
        for (const point of rubric.points) {
          expect(point.anchors.length, point.id).toBeGreaterThanOrEqual(2);
          expect(point.anchors.length, point.id).toBeLessThanOrEqual(MAX_GROUPS);
          for (const group of point.anchors) {
            expect(group.length).toBeGreaterThanOrEqual(1);
            expect(group.length).toBeLessThanOrEqual(MAX_VARIANTS);
            for (const variant of group) {
              expect(normalize(variant), variant).toBe(variant);
              expect(variant.length).toBeLessThanOrEqual(MAX_VARIANT_CHARS);
              const parts = variant.split(' ');
              expect(parts.length).toBeLessThanOrEqual(MAX_VARIANT_PARTS);
              for (const part of parts) expect(Array.from(part).length, variant).toBeGreaterThanOrEqual(MIN_PART_CHARS);
              expect(parts.every(generalPart), `${point.id} «${variant}» is a general word`).toBe(false);
              expect(owners.get(variant), `«${variant}» is in ${owners.get(variant)} and ${point.id}`).toBeUndefined();
              owners.set(variant, point.id);
            }
          }
          // The server's check: the first variant of group 0 begins a word of the point's fragments.
          const fragmentWords = point.source_ids.flatMap((id) => words(fragmentText(lecture.key, id.split(':')[1])));
          expect(variantPositions(point.anchors[0][0], fragmentWords).length, `${point.id} ${point.anchors[0][0]}`).toBeGreaterThan(0);
        }
      });

      it('lets the lecture itself name each point by its key words', () => {
        for (const point of rubric.points) {
          const fragmentWords = point.source_ids.flatMap((id) => words(fragmentText(lecture.key, id.split(':')[1])));
          expect(probablyNamed(point.anchors, fragmentWords), `${point.id} ${point.title}`).toBe(true);
        }
      });

      it('has a short follow-up of the examiner and what a good answer to it says for every point', () => {
        for (const point of rubric.points) {
          expect(point.followup.question.length).toBeGreaterThan(10);
          expect(point.followup.question.length).toBeLessThanOrEqual(FOLLOWUP_QUESTION_CHARS);
          expect(point.followup.question.endsWith('?'), point.followup.question).toBe(true);
          expect(point.followup.expected.length).toBeGreaterThan(5);
          expect(point.followup.expected.length).toBeLessThanOrEqual(FOLLOWUP_EXPECTED_CHARS);
        }
      });

      it('passes the client’s own check of a rubric from the server unchanged (oralApi.parseRubricResponse)', () => {
        const parsed = parseRubricResponse(JSON.parse(JSON.stringify(exampleRubricResponse(question))));
        expect(parsed.rubric.points).toEqual(rubric.points);
        expect(parsed.rubric.coverage).toBe(question.coverage);
        expect(parsed.rubric.coverage_note).toBe(question.coverageNote);
        expect(parsed.rubric.materials).toEqual([{ key: lecture.key, material_id: lecture.materialId, title: lecture.title }]);
        expect(parsed.rubric.question).toBe(question.text);
      });

      it('lights every point up for an answer in a student’s own words, and none for an unrelated one', () => {
        const answer = FULL_ANSWERS[question.id];
        expect(answer, 'a sample answer').toBeTruthy();
        expect(namedPoints(rubric.points, answer)).toEqual(rubric.points.map((point) => point.id));
        expect(namedPoints(rubric.points, 'Честно говоря, не помню. Кажется, что-то было про погоду и футбол.')).toEqual([]);
        // Reading the question aloud is not an answer.
        expect(namedPoints(rubric.points, question.text).length).toBeLessThan(rubric.points.length);
      });
    });
  }
});

describe('the example in the app’s shapes', () => {
  it('is an exam with one question per ticket and the department’s heading', () => {
    expect(EXAMPLE_EXAM.title).toBe('Микроэкономика');
    expect(EXAMPLE_EXAM.sheetTitle).toBe('Вопросы к экзамену по микроэкономике');
    expect(EXAMPLE_EXAM.layout).toEqual({ mode: 'random', per_ticket: 1 });
  });

  it('gives the sheet ExamQuestion rows with the lecture title, the fragment and the quote', () => {
    const row = exampleExamQuestion(exampleQuestion('q3')!);
    expect(row).toMatchObject({ id: 'q3', position: 3, label: '3', coverage: 'full', section: null });
    expect(row.evidence).toEqual([
      { material_id: 'example-lecture-1', material_title: 'Спрос и предложение', source_id: 'S04', excerpt: expect.stringContaining('Закон предложения') },
      { material_id: 'example-lecture-1', material_title: 'Спрос и предложение', source_id: 'S05', excerpt: expect.stringContaining('неценовые факторы') },
    ]);
    const none = exampleExamQuestion(exampleQuestion('q12')!);
    expect(none.nearest).toEqual([
      { material_id: 'example-lecture-1', material_title: 'Спрос и предложение', source_id: 'S01', excerpt: fragmentText('M1', 'S01'), matched: ['рынок', 'спрос'] },
    ]);
    expect(exampleExamQuestion(exampleQuestion('q8')!).missing_note).toBe('товаров Гиффена');
  });

  it('gives the answer screen its exam and question', () => {
    const { exam, question } = exampleTicket(exampleQuestion('q5')!);
    expect(exam).toEqual({ id: 'example-microeconomics', title: 'Микроэкономика', kind: 'exam', layout: { mode: 'random', tickets: [] } });
    expect(question).toMatchObject({ id: 'q5', position: 5, label: '5', coverage: 'full', question_hash: '' });
    expect(exampleQuestion('nope')).toBeNull();
  });
});
