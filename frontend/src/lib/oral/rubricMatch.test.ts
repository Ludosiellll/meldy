import { describe, expect, it } from 'vitest';
import vectors from '../../test/fixtures/oral_match_vectors.json';
import {
  NAMED_WINDOW,
  anchorWordIndexes,
  explicitMiss,
  followupFallback,
  liveMarks,
  markedRuns,
  namedPoints,
  need,
  normalize,
  openingMatch,
  partMatch,
  quoteMarks,
  rowQuoteGroups,
  sharedGroups,
  probablyNamed,
  segmentText,
  underlinedFinalWords,
  variantPositions,
  words,
} from './rubricMatch';

describe('shared vectors (contracts §7.4)', () => {
  it.each(vectors.normalize)('normalize «$in»', ({ in: input, out }) => {
    expect(normalize(input)).toBe(out);
  });

  it.each(vectors.part_match)('part «$part» vs word «$word» → $match', ({ part, word, match }) => {
    expect(partMatch(normalize(part), normalize(word))).toBe(match);
  });

  it.each(vectors.variant_positions)('variant «$variant» in «$text»', ({ variant, text, positions }) => {
    expect(variantPositions(variant, words(text))).toEqual(positions);
  });

  for (const testCase of vectors.points) {
    const textWords = words(testCase.transcript);
    const anchors = testCase.anchors as Record<string, string[][]>;
    const expected = testCase.expect as Record<string, { named: boolean; explicit_miss: boolean }>;
    it.each(Object.keys(anchors))(`${testCase.name}: %s`, (pointId) => {
      expect({ named: probablyNamed(anchors[pointId], textWords), explicit_miss: explicitMiss(anchors[pointId], textWords) }).toEqual(
        expected[pointId],
      );
    });
  }

  it.each(vectors.followup_fallback)('follow-up fallback for «$answer» → $status', ({ question, anchors, answer, status }) => {
    expect(followupFallback(anchors, question, answer)).toBe(status);
  });
});

describe('matching rules', () => {
  it('needs ceil(3G/5) groups', () => {
    expect([1, 2, 3, 4, 5, 6].map(need)).toEqual([1, 2, 2, 3, 3, 4]);
  });

  it('never matches parts shorter than three letters and caps three-letter parts at five-letter words', () => {
    expect(partMatch('ит', 'итог')).toBe(false);
    expect(partMatch('ток', 'токов')).toBe(true);
    expect(partMatch('ток', 'токовый')).toBe(false);
    expect(partMatch('вес', 'вес')).toBe(true);
  });

  it('wants group 0 and the other groups inside one window of 40 words', () => {
    const anchors = [['градиент'], ['спуск']];
    const filler = Array.from({ length: NAMED_WINDOW }, (_, i) => `слово${i}`).join(' ');
    expect(probablyNamed(anchors, words(`градиент ${filler} спуск`))).toBe(false);
    expect(probablyNamed(anchors, words(`градиентный спуск ${filler}`))).toBe(true);
    // Without group 0 the other groups are not enough.
    expect(probablyNamed([['градиент'], ['спуск'], ['шаг']], words('спуск и шаг'))).toBe(false);
  });

  it('reads an explicit miss only when group 0 is absent and too few groups matched', () => {
    const anchors = [['скорост обуч'], ['осцилл', 'колеб'], ['медлен']];
    expect(explicitMiss(anchors, words('сеть обучается'))).toBe(true);
    expect(explicitMiss(anchors, words('будут колебания и медленно'))).toBe(false);
    expect(explicitMiss(anchors, words('скорость обучения велика'))).toBe(false);
  });

  it('matches a two-part variant only when the second part is at most three words away', () => {
    expect(variantPositions('обратн распростр', words('обратное распространение'))).toEqual([0]);
    expect(variantPositions('обратн распростр', words('обратное и быстрое распространение'))).toEqual([0]);
    expect(variantPositions('обратн распростр', words('обратное и очень быстрое распространение'))).toEqual([]);
  });
});

describe('live marks', () => {
  const points = [
    { id: 'p1', anchors: [['потер', 'ошибк'], ['минимиз', 'уменьш'], ['вес']] },
    { id: 'p2', anchors: [['прям проход'], ['слои', 'слоя'], ['предсказ']] },
  ];

  it('opens a row from interim words and never closes it when the interim text changes', () => {
    const first = liveMarks(points, '', 'подбор весов которые минимизируют функцию потерь');
    expect(Array.from(first)).toEqual(['p1']);
    const second = liveMarks(points, '', 'подбор', first);
    expect(Array.from(second)).toEqual(['p1']);
    const third = liveMarks(points, 'подбор весов', 'прямой проход через слои', second);
    expect(Array.from(third).sort()).toEqual(['p1', 'p2']);
  });

  it('lists named points in rubric order', () => {
    expect(namedPoints(points, 'прямой проход через слои; минимизируем потери весов')).toEqual(['p1', 'p2']);
  });

  it('underlines only the words that named a point, in final words of named points', () => {
    const named = new Set(['p1']);
    const finalText = 'Подбор весов минимизирует потери, прямой проход';
    const marked = underlinedFinalWords(points, named, finalText);
    const finalWords = words(finalText);
    // The notion itself (group 0) opened p1; the other key words stay plain (redesign critique 4).
    expect(Array.from(marked).map((index) => finalWords[index])).toEqual(['потери']);
  });

  it('underlines a word said three times once', () => {
    const gradient = [{ id: 'p1', anchors: [['градиент'], ['вес'], ['производн']] }];
    const finalText = 'Считаем градиент по каждому весу через производную. Градиент, ещё раз градиент.';
    const named = new Set(namedPoints(gradient, finalText));
    expect(named.has('p1')).toBe(true);
    const finalWords = words(finalText);
    const marked = Array.from(underlinedFinalWords(gradient, named, finalText));
    expect(marked).toEqual([finalWords.indexOf('градиент')]);
    // The demo answer: one underline per named point, never a repeat.
    const anchors = vectors.points[0].anchors as Record<string, string[][]>;
    const demo = Object.entries(anchors).map(([id, value]) => ({ id, anchors: value }));
    const transcript = vectors.points[0].transcript;
    const demoWords = words(transcript);
    const demoMarked = Array.from(underlinedFinalWords(demo, new Set(namedPoints(demo, transcript)), transcript)).map((index) => demoWords[index]);
    expect(new Set(demoMarked).size).toBe(demoMarked.length);
    expect(demoMarked.length).toBeLessThanOrEqual(6);
  });

  it('puts at most five underlines on the transcript, earliest first', () => {
    const many = Array.from({ length: 6 }, (_, index) => ({ id: `p${index + 1}`, anchors: [[`слово${'абвгде'[index]}`]] }));
    const finalText = many.map((point) => point.anchors[0][0]).join(' ');
    const marked = underlinedFinalWords(many, new Set(many.map((point) => point.id)), finalText);
    expect(Array.from(marked).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('finds the opening words inside a window that names the point', () => {
    const anchors = [['потер'], ['минимиз'], ['вес']];
    // The first «потери» stands alone, 50 words before the rest: it did not name the point.
    const filler = Array.from({ length: 50 }, (_, index) => `слово${index}`).join(' ');
    const textWords = words(`потери ${filler} подбор весов минимизирует потери`);
    expect(openingMatch(anchors, textWords)).toEqual([textWords.length - 1]);
    expect(openingMatch(anchors, words('ничего похожего'))).toBeNull();
  });

  it('underlines at most two key words in a quote, the longest of two groups, or only the shared groups', () => {
    const anchors = [['потер', 'ошибк'], ['минимиз', 'уменьш'], ['вес']];
    const quote = 'Обучение сети заключается в подборе весов, минимизирующих функцию потерь';
    const quoteWords = words(quote);
    const marked = (indexes: Set<number>) => Array.from(indexes).map((index) => quoteWords[index]).sort();
    expect(marked(quoteMarks(anchors, quote))).toEqual(['минимизирующих', 'потерь']);
    expect(Array.from(sharedGroups(anchors, 'подбор весов', quote))).toEqual([2]);
    expect(marked(quoteMarks(anchors, quote, sharedGroups(anchors, 'подбор весов', quote)))).toEqual(['весов']);
    expect(sharedGroups(anchors, '', quote).size).toBe(0);
    expect(quoteMarks(anchors, quote, new Set()).size).toBe(0);
  });

  it('underlines one group in a named row: the notion that named it, else what the student said', () => {
    const anchors = [['потер', 'ошибк'], ['минимиз', 'уменьш'], ['вес']];
    const said = 'Подбираем веса, чтобы минимизировать функцию потерь';
    // The quote has the notion: its words are the ones underlined, like in the transcript.
    expect(Array.from(rowQuoteGroups(anchors, said, 'Обучение — подбор весов, минимизирующих функцию потерь'))).toEqual([0]);
    // No notion in the quote: the longest group the student said too.
    expect(Array.from(rowQuoteGroups(anchors, said, 'подбор весов, которые минимизируют сумму'))).toEqual([1]);
    expect(rowQuoteGroups(anchors, 'совсем о другом', 'подбор весов, которые минимизируют сумму').size).toBe(0);
  });

  it('underlines every part of a multi-part variant', () => {
    const textWords = words('потом обратное распространение ошибки');
    expect(Array.from(anchorWordIndexes([['обратн распростр']], textWords))).toEqual([1, 2]);
  });
});

describe('display segments', () => {
  it('lines word runs up with the normalised words', () => {
    const text = 'Ёлка — это «дерево», 2 раза!';
    const segments = segmentText(text);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
    const indexes = segments.flatMap((segment) => segment.words);
    expect(indexes).toEqual(words(text).map((_, index) => index));
  });

  it('joins neighbouring marked words into one run and keeps punctuation outside', () => {
    const text = 'Считают процентное изменение, а потом цену.';
    const textWords = words(text);
    const marked = new Set([textWords.indexOf('процентное'), textWords.indexOf('изменение'), textWords.indexOf('цену')]);
    expect(markedRuns(text, marked)).toEqual([
      { text: 'Считают ', marked: false },
      { text: 'процентное изменение', marked: true },
      { text: ', а потом ', marked: false },
      { text: 'цену', marked: true },
      { text: '.', marked: false },
    ]);
  });
});
