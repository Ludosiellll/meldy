import { describe, expect, it } from 'vitest';
import { codePointSpan, focusWindow, fragmentView, readableTableText, splitFragmentHeading, type Span } from './fragmentText';

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

/** The live run of 07.10, Q6 «Ограничения целостности»: a fragment of 849 characters, the answer near its end. */
const Q6 =
  'составлен из этих внешних ключей. Связь M:N тем самым распадается на две связи 1:N: «студент — его оценки» и «дисциплина — оценки по ней». В связующее отношение естественно помещаются атрибуты самой связи: дата экзамена, оценка. Кроме вида, у связи есть обязательность. Если каждый студент обязан состоять в группе, связь со стороны студента обязательная, и внешний ключ объявляют NOT NULL. Если у дисциплины может не быть закреплённого преподавателя, связь необязательная, и внешний ключ допускает NULL. 7. Ограничения целостности Ограничения целостности — правила, которым должны удовлетворять данные в любой момент времени. СУБД проверяет их сама при каждой вставке, изменении и удалении и отклоняет операцию, которая их нарушает. Различают: 1. Целостность сущностей — у каждого отношения есть первичный ключ, его значения уникальны и не содержат';
/** evidence[].focus the server stores for the quote «Ограничения целостности — правила, … в любой момент времени». */
const Q6_FOCUS = [532, 625];

const marked = (value: string, span: Span | null) => (span ? value.slice(span[0], span[1]) : null);

describe('fragmentView: the fragment as shown, and where the verified quote is', () => {
  it('splits the heading and joins the lines exactly as splitFragmentHeading does', () => {
    for (const excerpt of [
      'Обучение нейронной сети\nОбучение сети заключается в подборе весов и смещений.',
      'Сравнение. При росте цен\nспрос падает,\n\nа предложение растёт.',
      '  \n',
      Q6,
    ]) {
      const view = fragmentView(excerpt);
      expect({ heading: view.heading, body: view.body }).toEqual(splitFragmentHeading(excerpt));
      expect(view.headingFocus).toBeNull();
      expect(view.bodyFocus).toBeNull();
    }
  });

  it('maps the focus of the stored text onto the shown one: spaces, line breaks, the closing quote', () => {
    const excerpt = 'Ограничения целостности\nОграничения  целостности — правила, которым должны\n удовлетворять «данные».';
    // The server's focus runs from the first to the last word of the quote: «Ограничения» … «данные».
    const start = excerpt.indexOf('Ограничения  ');
    const view = fragmentView(excerpt, [start, excerpt.indexOf('».')]);
    expect(view.heading).toBe('Ограничения целостности');
    expect(view.body).toBe('Ограничения целостности — правила, которым должны удовлетворять «данные».');
    expect(marked(view.body, view.bodyFocus)).toBe('Ограничения целостности — правила, которым должны удовлетворять «данные»');
    expect(view.headingFocus).toBeNull();
  });

  it('marks the heading too when the quote starts in it', () => {
    const excerpt = '7. Ограничения целостности\nОграничения целостности — правила, которым удовлетворяют данные.';
    const start = excerpt.indexOf('целостности');
    const view = fragmentView(excerpt, [start, excerpt.indexOf(' — ')]);
    expect(view.heading).toBe('7. Ограничения целостности');
    expect(marked(view.heading ?? '', view.headingFocus)).toBe('целостности');
    expect(marked(view.body, view.bodyFocus)).toBe('Ограничения целостности');
  });

  it('counts the focus in code points, as the server does: «𝑥» is one point here and two UTF-16 units', () => {
    const excerpt = '𝑥 и 𝑦 — переменные, функция растёт быстро.';
    expect(codePointSpan(excerpt, [20, 41])).toEqual([22, 43]);
    expect(marked(fragmentView(excerpt, [20, 41]).body, fragmentView(excerpt, [20, 41]).bodyFocus)).toBe('функция растёт быстро');
  });

  it('ignores a focus that does not fit the text', () => {
    for (const focus of [null, undefined, [5], [3, 3], [7, 2], [-1, 4], [0, 999], ['0', '4'], [0.5, 4], { 0: 1, 1: 4 }]) {
      expect(codePointSpan('Короткий текст.', focus)).toBeNull();
      expect(fragmentView('Короткий текст.', focus).bodyFocus).toBeNull();
    }
  });

  it('reads a table row as «ячейка — ячейка; …» and keeps the rows apart from the next sentence', () => {
    const excerpt =
      'Уровни изоляции:\nУровень изоляции | «Грязное» чтение | Фантомное чтение\nREAD UNCOMMITTED | возможно | возможно\nSERIALIZABLE | нет | нет\nНи на одном уровне две транзакции не меняют одну строку.';
    expect(fragmentView(excerpt).body).toBe(
      'Уровни изоляции: Уровень изоляции — «Грязное» чтение — Фантомное чтение; READ UNCOMMITTED — возможно — возможно; SERIALIZABLE — нет — нет. Ни на одном уровне две транзакции не меняют одну строку.',
    );
    // A quote that runs across cells keeps the dash between them; the text in the database stays as it is.
    const start = excerpt.indexOf('READ UNCOMMITTED');
    const view = fragmentView(excerpt, [start, excerpt.indexOf('\nSERIALIZABLE')]);
    expect(marked(view.body, view.bodyFocus)).toBe('READ UNCOMMITTED — возможно — возможно');
  });

  it('reads a table that lost its line breaks and a row cut at the fragment end', () => {
    const excerpt = 'Чем выше уровень, тем меньше аномалий: Уровень изоляции | «Грязное» чтение | Фантомное чтение READ UNCOMMITTED | возможно |';
    expect(fragmentView(excerpt).body).toBe(
      'Чем выше уровень, тем меньше аномалий: Уровень изоляции — «Грязное» чтение — Фантомное чтение READ UNCOMMITTED — возможно',
    );
    expect(readableTableText('| нет | возможно')).toBe('нет — возможно');
  });

  it('leaves a quote without a table as it is', () => {
    expect(readableTableText('Цитата  без таблицы | и всё')).toBe('Цитата без таблицы — и всё');
    expect(readableTableText('Цитата  без таблицы, |x| < 1')).toBe('Цитата  без таблицы, |x| < 1');
  });
});

describe('focusWindow: a long fragment around the place of the answer', () => {
  const window = (value: string, focus: Span) => {
    const [start, end] = focusWindow(value, focus, 600);
    return { start, end, text: value.slice(start, end) };
  };

  it('shows Q6 of the live run around «Ограничения целостности», in whole sentences', () => {
    const view = fragmentView(Q6, Q6_FOCUS);
    expect(marked(view.body, view.bodyFocus)).toBe('Ограничения целостности — правила, которым должны удовлетворять данные в любой момент времени');
    const shown = window(view.body, view.bodyFocus as Span);
    expect(shown.text.length).toBeLessThanOrEqual(600);
    expect(shown.start).toBeLessThanOrEqual((view.bodyFocus as Span)[0]);
    expect(shown.end).toBeGreaterThanOrEqual((view.bodyFocus as Span)[1]);
    expect(view.body.slice(shown.start - 2, shown.start)).toBe('. '); // begins a sentence
    expect(shown.text).toMatch(/^Если /);
    expect(shown.end).toBe(view.body.length); // the answer runs on to the end of the fragment
    expect(shown.text).toContain('7. Ограничения целостности');
  });

  it('keeps a list number with its item: «1. Целостность…» is not cut after «1.»', () => {
    const value = `${'Вводное предложение о моделях данных. '.repeat(12)}Различают: 1. Целостность сущностей — ключ уникален. 2. Ссылочная целостность — ссылка на строку есть.`;
    const focusStart = value.indexOf('Целостность сущностей');
    const shown = window(value, [focusStart, focusStart + 'Целостность сущностей'.length]);
    expect(shown.text).toContain('Различают: 1. Целостность сущностей');
    expect(shown.text.length).toBeLessThanOrEqual(600);
  });

  it('cuts by words around the answer when its sentence is longer than the window', () => {
    const words = Array.from({ length: 160 }, (_, index) => `слово${index}`);
    const value = words.join(' ');
    const focusStart = value.indexOf('слово100');
    const shown = window(value, [focusStart, focusStart + 'слово100 слово101'.length]);
    expect(shown.text.length).toBeLessThanOrEqual(600);
    expect(shown.text).toContain('слово100 слово101');
    expect(shown.text.startsWith('слово')).toBe(true);
    expect(/слово\d+$/.test(shown.text)).toBe(true);
    expect(value[shown.start - 1]).toBe(' ');
  });

  it('shows a text no longer than the window whole', () => {
    expect(focusWindow('Короткий текст.', [0, 8], 600)).toEqual([0, 15]);
  });
});
