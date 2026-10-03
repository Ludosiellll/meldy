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
  partMatch,
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

  it('underlines only final words of named points', () => {
    const named = new Set(['p1']);
    const finalText = 'Подбор весов минимизирует потери, прямой проход';
    const marked = underlinedFinalWords(points, named, finalText);
    const finalWords = words(finalText);
    expect(Array.from(marked).map((index) => finalWords[index]).sort()).toEqual(['весов', 'минимизирует', 'потери']);
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
