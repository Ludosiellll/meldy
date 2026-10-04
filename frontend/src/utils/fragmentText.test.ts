import { describe, expect, it } from 'vitest';
import { splitFragmentHeading } from './fragmentText';

describe('splitFragmentHeading: a heading on its own line', () => {
  it('splits a plain heading from the sentence below', () => {
    expect(
      splitFragmentHeading('Обучение нейронной сети\nОбучение сети заключается в подборе весов и смещений.'),
    ).toEqual({
      heading: 'Обучение нейронной сети',
      body: 'Обучение сети заключается в подборе весов и смещений.',
    });
  });

  it('keeps a numbered heading even when it is as long as the next line', () => {
    expect(splitFragmentHeading('1.2. Эластичность спроса\nЭластичность показывает…')).toEqual({
      heading: '1.2. Эластичность спроса',
      body: 'Эластичность показывает…',
    });
    expect(splitFragmentHeading('3) Методы оценки риска\nОценка ведётся по трём шкалам.')).toEqual({
      heading: '3) Методы оценки риска',
      body: 'Оценка ведётся по трём шкалам.',
    });
  });

  it('accepts a heading that starts with «, ends with a closing quote or bracket, or a blank line before the body', () => {
    expect(
      splitFragmentHeading('«Невидимая рука» рынка\n\nАдам Смит описал, как частные интересы ведут к общему благу.'),
    ).toEqual({
      heading: '«Невидимая рука» рынка',
      body: 'Адам Смит описал, как частные интересы ведут к общему благу.',
    });
    expect(
      splitFragmentHeading('Модель IS-LM (Хикс)\nМодель связывает рынок товаров и рынок денег в одной точке.').heading,
    ).toBe('Модель IS-LM (Хикс)');
  });

  it('drops leading empty lines and collapses whitespace in the heading and body', () => {
    expect(
      splitFragmentHeading('\n\n  Обучение   нейронной сети  \r\n  Обучение сети   заключается\tв подборе весов  \n  и смещений.  '),
    ).toEqual({
      heading: 'Обучение нейронной сети',
      body: 'Обучение сети заключается в подборе весов и смещений.',
    });
  });
});

describe('splitFragmentHeading: no heading', () => {
  it('rejects the critique’s false headings that start with «…»', () => {
    for (const text of [
      '…составил\n7 % при инфляции около пяти процентов годовых.',
      '…динамику ставки\nЦБ повышает ставку, когда инфляция растёт быстрее прогноза.',
      '…предложил\nКейнс, объясняя безработицу недостатком совокупного спроса.',
    ]) {
      const result = splitFragmentHeading(text);
      expect(result.heading, text).toBeNull();
      expect(result.body, text).toBe(text.replace('\n', ' '));
    }
  });

  it('rejects the same three as full-width wrapped lines starting with a capital (ratio rule)', () => {
    for (const text of [
      'По итогам года рост валового внутреннего продукта в номинальном выражении составил\n7 % при инфляции около пяти процентов, что выше прогноза.',
      'Аналитики банка в обзоре за прошлый месяц отдельно разобрали динамику ставки\nЦБ повышает ставку, когда инфляция растёт быстрее прогноза.',
      'Объяснение безработицы через недостаток совокупного спроса впервые предложил\nКейнс в «Общей теории занятости, процента и денег».',
    ]) {
      const result = splitFragmentHeading(text);
      expect(result.heading, text).toBeNull();
      expect(result.body, text).toBe(text.replace('\n', ' '));
    }
  });

  it('does not take a mid-fragment excerpt window for a heading', () => {
    expect(splitFragmentHeading('нейронной сети\nОбучение сети заключается в подборе весов.').heading).toBeNull();
    expect(
      splitFragmentHeading('весов и смещений.\nДалее сеть проверяют на отложенной выборке.').heading,
    ).toBeNull();
  });

  it('joins a PDF hard wrap into one sentence', () => {
    expect(splitFragmentHeading('Обучение сети заключается в подборе\nвесов и смещений.')).toEqual({
      heading: null,
      body: 'Обучение сети заключается в подборе весов и смещений.',
    });
    expect(splitFragmentHeading('Обучение нейронной сети\nвесов и смещений, которые подбирают по данным.').heading).toBeNull();
  });

  it('rejects a first line ending with punctuation, a colon or a dash', () => {
    for (const ending of ['.', '…', '!', '?', ':', ';', ',', ' —', ' –', '-']) {
      const text = `Эластичность спроса${ending}\nЭластичность показывает, насколько меняется спрос при изменении цены.`;
      expect(splitFragmentHeading(text).heading, ending).toBeNull();
    }
    expect(
      splitFragmentHeading('Что такое «эластичность?»\nЭластичность показывает, насколько меняется спрос при изменении цены.').heading,
    ).toBeNull();
    expect(
      splitFragmentHeading('Эластичность (см. рис. 2.)\nЭластичность показывает, насколько меняется спрос при изменении цены.').heading,
    ).toBeNull();
  });

  it('rejects a first line that is too short, too long or too wordy', () => {
    expect(splitFragmentHeading('А\nЭластичность показывает, насколько меняется спрос.').heading).toBeNull();
    const longLine = `Заголовок ${'очень '.repeat(25).trim()}`;
    expect(splitFragmentHeading(`${longLine}\n${'Текст лекции. '.repeat(30)}`).heading).toBeNull();
    const fourteen = 'Один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать четырнадцать';
    const body = 'Текст лекции идёт дальше. '.repeat(10);
    expect(splitFragmentHeading(`${fourteen}\n${body}`).heading).toBe(fourteen);
    expect(splitFragmentHeading(`${fourteen} пятнадцать\n${body}`).heading).toBeNull();
  });

  it('does not treat a year as a section number', () => {
    expect(
      splitFragmentHeading('2023. Год перелома в экономике\nРост замедлился до двух процентов.').heading,
    ).toBeNull();
  });

  it('returns a single line or heading-only text as the body', () => {
    expect(splitFragmentHeading('Обучение нейронной сети')).toEqual({ heading: null, body: 'Обучение нейронной сети' });
    expect(splitFragmentHeading('  Обучение нейронной сети \n\n  ')).toEqual({
      heading: null,
      body: 'Обучение нейронной сети',
    });
    expect(splitFragmentHeading('')).toEqual({ heading: null, body: '' });
    expect(splitFragmentHeading(' \n \n')).toEqual({ heading: null, body: '' });
  });
});
