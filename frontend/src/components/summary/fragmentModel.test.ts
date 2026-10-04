import { describe, expect, it } from 'vitest';
import { buildSections, markedFragmentNumbers, nearestFragments, stemsOf, stripSourceMarkers, underlineStems } from './fragmentModel';

const SOURCES = [
  { id: 'S01', text: 'Нейронная сеть состоит из слоёв: входного, скрытых и выходного. Каждый слой передаёт сигнал дальше.' },
  { id: 'S02', text: 'Обучение сети — подбор весов. Ошибка распространяется назад от выходного слоя к входному.' },
  { id: 'S03', text: 'Функция активации решает, передаст ли нейрон сигнал: сигмоида, ReLU, гиперболический тангенс.' },
];

describe('stripSourceMarkers', () => {
  it('drops single marks, runs of marks and marks with several fragments', () => {
    expect(stripSourceMarkers('Выходной слой выдаёт результат. [S02]')).toBe('Выходной слой выдаёт результат.');
    expect(stripSourceMarkers('Градиент [S01][S03] и шаг [S04], [S05] обучения.')).toBe('Градиент и шаг обучения.');
    expect(stripSourceMarkers('Информация на двух щитах [S01, S02].')).toBe('Информация на двух щитах.');
    expect(stripSourceMarkers('Текст [S1; S3] и [ S04 ,S05 ] дальше.')).toBe('Текст и дальше.');
  });

  it('keeps brackets that are not fragment marks', () => {
    expect(stripSourceMarkers('Массив [i] и ссылка [Source] остаются.')).toBe('Массив [i] и ссылка [Source] остаются.');
    expect(stripSourceMarkers('Отрезок [1, 2] и [S] тоже.')).toBe('Отрезок [1, 2] и [S] тоже.');
  });
});

describe('markedFragmentNumbers', () => {
  it('reads the numbers in order without repeats', () => {
    expect(markedFragmentNumbers('А [S01, S02]. Б [S02]. В [S10][S3].')).toEqual([1, 2, 10, 3]);
    expect(markedFragmentNumbers('Без меток.')).toEqual([]);
  });
});

describe('nearestFragments', () => {
  it('ranks fragments by shared word stems and needs at least two', () => {
    const near = nearestFragments('Как обучается сеть: веса подбираются, ошибка идёт назад.', SOURCES, 2);
    expect(near[0].id).toBe('S02');
    expect(near[0].shared.length).toBeGreaterThanOrEqual(2);
    expect(nearestFragments('Инфляция и денежная масса.', SOURCES)).toEqual([]);
  });
});

describe('buildSections', () => {
  it('takes the marks of a section as its fragments and the nearest ones otherwise', () => {
    const sections = buildSections(
      'Вступление без заголовка [S01].\n\n## 📌 Слои сети\n\nВходной и выходной слой [S01, S03].\n\n## Обучение\n\nВеса подбираются, ошибка идёт назад от выходного слоя.',
      SOURCES,
    );
    expect(sections.map((section) => section.title)).toEqual([null, 'Слои сети', 'Обучение']);
    expect(sections[0].refs).toEqual(['S01']);
    expect(sections[1]).toMatchObject({ refs: ['S01', 'S03'], refKind: 'marked', body: 'Входной и выходной слой.' });
    expect(sections[2].refKind).toBe('near');
    expect(sections[2].refs[0]).toBe('S02');
  });

  it('ignores marks of fragments the lecture does not have and finds no fragments without sources', () => {
    expect(buildSections('## Раздел\n\nТекст [S09].', SOURCES)[0].refs).not.toContain('S09');
    expect(buildSections('## Раздел\n\nТекст [S01].', [])[0]).toMatchObject({ refs: [], refKind: null, body: 'Текст.' });
  });
});

describe('underlineStems', () => {
  it('underlines only stems the section shares, longest first', () => {
    const section = [...stemsOf('Ошибка распространяется, инфляция растёт.')];
    const stems = [...underlineStems(SOURCES[1].text, section, 6)];
    expect(stems).toHaveLength(2);
    expect(stems[0].length).toBeGreaterThanOrEqual(stems[1].length);
    expect(stems).not.toContain([...stemsOf('инфляция')][0]);
    expect([...underlineStems(SOURCES[1].text, section, 1)]).toEqual([stems[0]]);
  });
});
