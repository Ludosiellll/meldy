import { describe, expect, it } from 'vitest';
import { examStatus, isNothingFound, mappingLimitLine, statusTitleText, type ExamStatus, type ExamStatusInput } from './examStatus';
import type { CoverageCounts } from './sheetModel';

type Overrides = Partial<Omit<ExamStatusInput, 'mapping' | 'sheet' | 'answers' | 'coverage'>> & {
  coverage?: Partial<CoverageCounts>;
  mapping?: Partial<ExamStatusInput['mapping']>;
  sheet?: Partial<ExamStatusInput['sheet']>;
  answers?: Partial<ExamStatusInput['answers']>;
};

/** The owner's exam of 2026-10-07 by default: 18 questions, one lecture «ПР 9», every question «нет». */
function input(overrides: Overrides = {}): ExamStatusInput {
  const total = overrides.total ?? 18;
  const coverage: CoverageCounts = { total, full: 0, partial: 0, none: 0, unverified: 0, unmapped: 0, checking: 0, ...overrides.coverage };
  if (!overrides.coverage) coverage.none = total;
  return {
    total,
    lectures: overrides.lectures ?? [{ id: 'm1', title: 'ПР 9' }],
    copy: overrides.copy ?? false,
    coverage,
    mapping: { phase: 'idle', progress: null, message: null, added: 0, removed: 0, cost: 10, limit: null, ...overrides.mapping },
    sheet: {
      state: 'ready',
      written: 0,
      toWrite: 0,
      units: 0,
      writing: null,
      unitsLeft: 100,
      resetAt: '3:00',
      lines: { left: 0, total: 0 },
      erasable: 0,
      nextErasable: null,
      ...overrides.sheet,
    },
    answers: { state: 'ready', answered: 0, untested: total, confirmed: 0, ...overrides.answers },
    drawLabel: overrides.drawLabel ?? 'Тянуть билет',
    lectureFit: overrides.lectureFit,
  };
}

/** 14 of 18 found (11 «есть», 3 «частично»), 4 «нет»: a normal mapped exam. */
const MAPPED = { full: 11, partial: 3, none: 4 };

const title = (status: ExamStatus) => statusTitleText(status);

describe('examStatus: the owner’s exam (one unrelated lecture, every question «нет»)', () => {
  it('says what was found and in which lecture, and sends to the exam’s lectures — «Тянуть билет» is only a quiet link', () => {
    const status = examStatus(input());
    expect(status.key).toBe('nothing-found');
    expect(title(status)).toBe('В лекции «ПР 9» нет ответов на эти вопросы');
    expect(status.title.mark).toBe('нет ответов');
    expect(status.text).toBe(
      'Meldy сверил с ней все 18 вопросов и не нашёл ни одного ответа. Выберите лекции по темам вопросов или добавьте новые, потом сверьте заново.',
    );
    expect(status.action).toEqual({ kind: 'lectures', label: 'Выбрать или добавить лекции' });
    // No answer anywhere: a ticket would have no points to check against, so it is not offered (live check 07.10).
    expect(status.draw).toBe(false);
    expect(status.hideCoverage).toBe(true);
    expect(status.quietGaps).toBe(true);
    // Something found: the ticket stays as a quiet link.
    expect(examStatus(input({ coverage: { full: 2, none: 16 } })).draw).toBe(true);
  });

  it('names no lecture when there are several, and says «почти» when a few were found (70 % «нет» and more)', () => {
    const lectures = [
      { id: 'a', title: 'Тема 4.3 Использование роли пользователей и формальные цели' },
      { id: 'b', title: 'Вар 1' },
      { id: 'c', title: 'Что такое PGP' },
    ];
    const none = examStatus(input({ lectures }));
    expect(title(none)).toBe('В выбранных лекциях нет ответов на эти вопросы');
    expect(none.text).toMatch(/^Meldy сверил с 3 лекциями все 18 вопросов и не нашёл ни одного ответа\./);

    const almost = examStatus(input({ lectures, coverage: { full: 2, partial: 1, none: 15 } }));
    expect(almost.key).toBe('nothing-found');
    expect(title(almost)).toBe('В выбранных лекциях почти нет ответов на эти вопросы');
    expect(almost.text).toBe('Ответ нашёлся только для 3 вопросов из 18. Выберите лекции по темам остальных или добавьте новые, потом сверьте заново.');

    // A long title is cut in the headline.
    expect(title(examStatus(input({ lectures: [lectures[0]] })))).toBe('В лекции «Тема 4.3 Использование роли…» нет ответов на эти вопросы');
  });

  it('keeps the ordinary states below 70 % «нет» and while nothing is attached or checked', () => {
    expect(isNothingFound(input({ coverage: { full: 6, none: 12 } }))).toBe(false); // 66 %
    expect(isNothingFound(input({ coverage: { full: 5, none: 13 } }))).toBe(true); // 72 %
    expect(isNothingFound(input({ lectures: [] }))).toBe(false);
    expect(isNothingFound(input({ coverage: { none: 17, unmapped: 1 } }))).toBe(false);
    expect(examStatus(input({ coverage: { full: 6, none: 12 }, sheet: { toWrite: 6, units: 6 } })).key).toBe('write-sheet');
  });

  it('says it the member’s way on a copy from a group link: the author chose the lecture; add your own or ask for a new link', () => {
    const status = examStatus(input({ copy: true }));
    expect(status.key).toBe('nothing-found');
    expect(status.flag).toBe('Лекции из ссылки');
    expect(title(status)).toBe('В лекции «ПР 9» нет ответов на эти вопросы');
    expect(status.text).toBe(
      'Эту лекцию выбрал автор ссылки, и Meldy не нашёл в ней ни одного ответа. Добавьте свои лекции по темам вопросов и сверьте заново (10 единиц ИИ) — или попросите у автора новую ссылку.',
    );
    expect(status.action).toEqual({ kind: 'lectures', label: 'Добавить свои лекции' });
    const several = examStatus(input({ copy: true, lectures: [{ id: 'a', title: 'А' }, { id: 'b', title: 'Б' }] }));
    expect(title(several)).toBe('В лекциях из ссылки нет ответов на эти вопросы');
    expect(several.text).toMatch(/^Эти лекции выбрал автор ссылки, и Meldy не нашёл в них ни одного ответа\./);
  });

  it('takes the lecture-fit answer when the page has one: «подходят …» or «подходящих нет»', () => {
    const some = examStatus(input({ lectureFit: { state: 'some', titles: ['Тема 4.3 Использование роли пользователей и формальные цели', 'Вар 1', 'Что такое PGP'] } }));
    expect(some.text).toBe(
      'Meldy сверил с ней все 18 вопросов и не нашёл ни одного ответа. Подходят ваши лекции «Тема 4.3 Использование роли…» и «Вар 1» и ещё 1: выберите их и сверьте заново.',
    );
    expect(some.action).toEqual({ kind: 'lectures', label: 'Выбрать лекции' });
    const none = examStatus(input({ lectureFit: { state: 'none' } }));
    expect(none.text).toBe('Meldy сверил с ней все 18 вопросов и не нашёл ни одного ответа. Среди ваших лекций подходящих нет. Добавьте лекции по темам вопросов и сверьте заново.');
    expect(none.action).toEqual({ kind: 'lectures', label: 'Добавить лекции' });
  });

  it('one lecture that fits is named in the singular', () => {
    const one = examStatus(input({ lectureFit: { state: 'some', titles: ['Тема 1. Информация'] } }));
    expect(one.text).toBe('Meldy сверил с ней все 18 вопросов и не нашёл ни одного ответа. Подходит ваша лекция «Тема 1. Информация»: выберите её и сверьте заново.');
    expect(one.action).toEqual({ kind: 'lectures', label: 'Выбрать лекцию' });
  });

  it('a copy keeps the author’s new link as the other way out, whatever the student’s own lectures say', () => {
    const some = examStatus(input({ copy: true, lectureFit: { state: 'some', titles: ['Тема 1. Информация', 'Тема 2'] } }));
    expect(some.text).toBe(
      'Эту лекцию выбрал автор ссылки, и Meldy не нашёл в ней ни одного ответа. Подходят ваши лекции «Тема 1. Информация» и «Тема 2»: выберите их и сверьте заново — или попросите у автора новую ссылку.',
    );
    const none = examStatus(input({ copy: true, lectureFit: { state: 'none' } }));
    expect(none.text).toBe(
      'Эту лекцию выбрал автор ссылки, и Meldy не нашёл в ней ни одного ответа. Добавьте свои лекции по темам вопросов и сверьте заново (10 единиц ИИ) — или попросите у автора новую ссылку.',
    );
    expect(none.action).toEqual({ kind: 'lectures', label: 'Добавить свои лекции' });
  });
});

describe('examStatus: before and during the mapping', () => {
  it('an empty list asks for the questions, with nothing to draw', () => {
    const status = examStatus(input({ total: 0, lectures: [] }));
    expect(status.key).toBe('empty');
    expect(title(status)).toBe('В экзамене пока нет вопросов');
    expect(status.action).toEqual({ kind: 'list', label: 'Добавить вопросы' });
    expect(status.draw).toBe(false);
  });

  it('no lectures: what Meldy needs them for and «Добавить лекции»', () => {
    const status = examStatus(input({ lectures: [], coverage: { unmapped: 18 } }));
    expect(status.key).toBe('no-lectures');
    expect(title(status)).toBe('К экзамену не добавлены лекции');
    expect(status.text).toBe('Meldy ищет ответы на вопросы в ваших лекциях. Добавьте лекции по этому предмету, и он отметит, на какие вопросы в них есть ответ.');
    expect(status.action).toEqual({ kind: 'lectures', label: 'Добавить лекции' });
    expect(status.hideCoverage).toBe(true);
  });

  it('not checked yet: what «Сверить с лекциями» does and what it costs; the daily limit leaves it unavailable', () => {
    const one = examStatus(input({ coverage: { unmapped: 18 } }));
    expect(one.key).toBe('unmapped');
    expect(title(one)).toBe('Вопросы ещё не сверены с лекциями');
    expect(one.text).toBe('Meldy проверит каждый из 18 вопросов по лекции «ПР 9» и отметит, где в ней есть ответ. Это стоит 10 единиц ИИ.');
    expect(one.action).toEqual({ kind: 'map', label: 'Сверить с лекциями' });
    expect(one.blocked).toBeNull();
    const two = examStatus(input({ lectures: [{ id: 'a', title: 'А' }, { id: 'b', title: 'Б' }], coverage: { unmapped: 18 } }));
    expect(two.text).toBe('Meldy проверит каждый из 18 вопросов по 2 лекциям и отметит, где в них есть ответ. Это стоит 10 единиц ИИ.');
    const limited = examStatus(input({ coverage: { unmapped: 18 }, mapping: { limit: { remaining: 4, resetAt: '3:00' } } }));
    expect(limited.blocked).toBe('Сегодня осталось 4 единицы ИИ, а сверка расходует 10. Лимит обновится в 3:00.');
    expect(mappingLimitLine({ remaining: 0, resetAt: '3:00' }, 10)).toBe('Дневной лимит ИИ на сегодня исчерпан. Он обновится в 3:00.');
    expect(mappingLimitLine({ remaining: 1, resetAt: '3:00' }, 10)).toBe('Сегодня осталась 1 единица ИИ, а сверка расходует 10. Лимит обновится в 3:00.');
  });

  it('a run going on, a run elsewhere: what is happening, no action, «Тянуть билет» quiet', () => {
    const running = examStatus(input({ coverage: { unmapped: 11, full: 7 }, mapping: { phase: 'running', progress: { checked: 7, total: 18 } } }));
    expect(running.key).toBe('mapping');
    expect(title(running)).toBe('Meldy сверяет вопросы с лекциями');
    expect(running.text).toBe('Проверено 7 из 18. Пометки появляются в списке по ходу проверки; не закрывайте вкладку, пока сверка не закончится.');
    expect(running.action).toBeNull();
    expect(running.tone).toBe('meldy');
    const waiting = examStatus(input({ coverage: { unmapped: 18 }, mapping: { phase: 'waiting' } }));
    expect(waiting.key).toBe('waiting');
    expect(title(waiting)).toBe('Сверка уже идёт');
    expect(waiting.text).toBe('Её запустили в другой вкладке или на другом устройстве. Список обновится сам, когда она закончится.');
    expect(waiting.action).toBeNull();
  });

  it('a run that stopped: how far it got and «Продолжить сверку» with the price', () => {
    const half = examStatus(input({ coverage: { full: 7, unmapped: 11 }, mapping: { phase: 'interrupted', progress: { checked: 7, total: 18 } } }));
    expect(half.key).toBe('interrupted');
    expect(title(half)).toBe('Сверка прервалась');
    expect(half.text).toBe('Проверено 7 из 18. Продолжите — Meldy проверит оставшиеся 11 вопросов за 10 единиц ИИ.');
    expect(half.action).toEqual({ kind: 'map', label: 'Продолжить сверку' });
    const last = examStatus(input({ coverage: { full: 17, unmapped: 1 }, mapping: { phase: 'interrupted', progress: { checked: 17, total: 18 } } }));
    expect(last.text).toBe('Проверено 17 из 18. Продолжите — Meldy проверит оставшийся вопрос за 10 единиц ИИ.');
    const before = examStatus(input({ coverage: { unmapped: 18 }, mapping: { phase: 'interrupted', progress: null } }));
    expect(before.text).toBe('Проверка не успела начаться. Запустите сверку ещё раз за 10 единиц ИИ.');
    const done = examStatus(input({ coverage: MAPPED, mapping: { phase: 'interrupted', progress: { checked: 18, total: 18 }, cost: 0 } }));
    expect(done.text).toBe('Проверено 18 из 18, но сверка не успела завершиться. Запустите её ещё раз.');
  });

  it('a failed run: the server’s first sentence as the headline, the rest under it, «Повторить сверку»', () => {
    const status = examStatus(
      input({ coverage: { unmapped: 18 }, mapping: { phase: 'failed', message: 'Дневной лимит ИИ исчерпан: сверка с лекциями не запущена. Лимит обновится в 3:00.' } }),
    );
    expect(status.key).toBe('failed');
    expect(title(status)).toBe('Дневной лимит ИИ исчерпан: сверка с лекциями не запущена');
    expect(status.text).toBe('Лимит обновится в 3:00.');
    expect(status.action).toEqual({ kind: 'map', label: 'Повторить сверку' });
    const plain = examStatus(input({ coverage: { unmapped: 18 }, mapping: { phase: 'failed', message: 'Сервис ИИ перегружен' } }));
    expect(title(plain)).toBe('Сервис ИИ перегружен');
    expect(plain.text).toBe('Повторите сверку через минуту.');
  });

  it('lectures changed after the mapping: «Сверить заново» (before «nothing found»: that is how the owner fixes it)', () => {
    const added = examStatus(input({ lectures: [{ id: 'a', title: 'ПР 9' }, { id: 'b', title: 'Б' }], mapping: { added: 1 } }));
    expect(added.key).toBe('lectures-changed');
    expect(title(added)).toBe('После сверки добавлена 1 лекция');
    expect(added.text).toBe('Пометки в списке сделаны без неё. Сверьте заново — Meldy проверит вопросы и по новой лекции. Это стоит 10 единиц ИИ.');
    expect(added.action).toEqual({ kind: 'map', label: 'Сверить заново' });
    const two = examStatus(input({ coverage: MAPPED, mapping: { added: 2 } }));
    expect(title(two)).toBe('После сверки добавлено 2 лекции');
    expect(two.text).toMatch(/без них\. Сверьте заново — Meldy проверит вопросы и по новым лекциям\./);
    const removed = examStatus(input({ coverage: MAPPED, mapping: { removed: 1, cost: 0 } }));
    expect(title(removed)).toBe('После сверки убрана 1 лекция');
    expect(removed.text).toBe('В списке остались пометки по убранной лекции. Сверьте заново, чтобы они совпадали с лекциями экзамена.');
    const both = examStatus(input({ coverage: MAPPED, mapping: { added: 1, removed: 1 } }));
    expect(title(both)).toBe('После сверки лекции изменились');
    // The owner's fix in progress: the old marks are all «нет», so the share and the notes stay quiet until the new run.
    expect(added.hideCoverage).toBe(true);
    expect(added.quietGaps).toBe(true);
    expect(two.hideCoverage).toBe(false);
  });

  it('questions added after the mapping: how many and «Сверить с лекциями»', () => {
    const three = examStatus(input({ coverage: { full: 11, partial: 1, none: 3, unmapped: 3 } }));
    expect(three.key).toBe('some-unmapped');
    expect(title(three)).toBe('3 вопроса ещё не сверены с лекциями');
    expect(three.text).toBe('Их добавили или изменили после сверки. Meldy проверит только их — это стоит 10 единиц ИИ.');
    const one = examStatus(input({ coverage: { full: 14, none: 3, unmapped: 1 } }));
    expect(title(one)).toBe('1 вопрос ещё не сверен с лекциями');
    expect(one.text).toBe('Его добавили или изменили после сверки. Meldy проверит только его — это стоит 10 единиц ИИ.');
  });

  it('questions found only by words: «Проверить снова» with its own price, until the answers begin', () => {
    const status = examStatus(input({ coverage: { full: 14, unverified: 4 } }));
    expect(status.key).toBe('unverified');
    expect(title(status)).toBe('4 вопроса проверены только по словам');
    expect(status.text).toBe('Сервис был занят, и Meldy сравнил их с лекциями только по совпадению слов. Проверьте их снова — это стоит 10 единиц ИИ.');
    expect(status.action).toEqual({ kind: 'recheck', label: 'Проверить снова' });
    expect(examStatus(input({ coverage: { full: 14, unverified: 4 }, answers: { answered: 2 } })).key).toBe('answering');
  });
});

describe('examStatus: the cheat sheet and the answers', () => {
  it('found but not written: what was found and «Написать шпаргалку» with its price', () => {
    const status = examStatus(input({ coverage: MAPPED, sheet: { toWrite: 14, units: 14 } }));
    expect(status.key).toBe('write-sheet');
    expect(title(status)).toBe('В лекциях есть ответы на 14 вопросов из 18');
    expect(status.text).toBe('Теперь Meldy выпишет из лекций пункты ответа — получится шпаргалка, строки которой стирают ваши ответы. Это стоит 14 единиц ИИ.');
    expect(status.action).toEqual({ kind: 'write', label: 'Написать шпаргалку', count: null });
    expect(title(examStatus(input({ coverage: { full: 18 }, sheet: { toWrite: 18, units: 18 } })))).toBe('В лекциях есть ответы на все 18 вопросов');
  });

  it('the units left decide how much is written now; none left — the action waits for the limit', () => {
    const some = examStatus(input({ coverage: MAPPED, sheet: { toWrite: 14, units: 14, unitsLeft: 6 } }));
    expect(some.action).toEqual({ kind: 'write', label: 'Написать 6 вопросов', count: 6 });
    expect(some.text).toMatch(/Сегодня хватит на 6 вопросов, остальные — после 3:00\.$/);
    const none = examStatus(input({ coverage: MAPPED, sheet: { toWrite: 14, units: 14, unitsLeft: 0 } }));
    expect(none.blocked).toBe('Дневной лимит ИИ на сегодня кончился. Написать шпаргалку можно после 3:00.');
  });

  it('written in part, before the first answer: «Дописать шпаргалку»; once answering, the answers lead', () => {
    const status = examStatus(input({ coverage: MAPPED, sheet: { written: 10, toWrite: 4, units: 4, lines: { left: 30, total: 30 } } }));
    expect(title(status)).toBe('Шпаргалка написана не полностью');
    expect(status.text).toBe('У 4 вопросов ещё нет пунктов ответа. Допишите их. Это стоит 4 единицы ИИ.');
    expect(status.action).toEqual({ kind: 'write', label: 'Дописать шпаргалку', count: null });
    expect(examStatus(input({ coverage: MAPPED, sheet: { written: 10, toWrite: 4, units: 4 }, answers: { answered: 3 } })).key).toBe('answering');
  });

  it('while the sheet is written: progress, no action', () => {
    const status = examStatus(input({ coverage: MAPPED, sheet: { toWrite: 14, writing: { done: 5, total: 14 } } }));
    expect(status.key).toBe('writing');
    expect(title(status)).toBe('Meldy пишет шпаргалку');
    expect(status.text).toBe('Готово 5 из 14. Страницу можно закрыть — шпаргалка допишется.');
    expect(status.action).toBeNull();
  });

  it('while the sheet or the answers are read: no words yet, «Тянуть билет» in its place', () => {
    for (const status of [examStatus(input({ coverage: MAPPED, sheet: { state: 'loading' } })), examStatus(input({ coverage: MAPPED, answers: { state: 'loading' } }))]) {
      expect(status.key).toBe('loading');
      expect(status.action).toEqual({ kind: 'draw', label: 'Тянуть билет' });
      expect(status.text).toBeNull();
    }
  });

  it('ready, no answers yet: «Тянуть билет» and how the lines are erased (answers on different days)', () => {
    const status = examStatus(input({ coverage: MAPPED, sheet: { written: 14, lines: { left: 42, total: 42 } } }));
    expect(status.key).toBe('ready');
    expect(title(status)).toBe('Шпаргалка готова — можно отвечать');
    expect(status.text).toBe('Тяните билет и отвечайте вслух: названный пункт стирает строку наполовину, названный снова в другой день — совсем.');
    expect(status.action).toEqual({ kind: 'draw', label: 'Тянуть билет' });
    expect(status.hideCoverage).toBe(false);
    const single = examStatus(input({ coverage: MAPPED, drawLabel: 'Тянуть вопрос', sheet: { written: 14, lines: { left: 42, total: 42 } } }));
    expect(single.text).toMatch(/^Тяните вопрос и отвечайте вслух/);
    const noSheet = examStatus(input({ coverage: MAPPED, sheet: { state: 'error' } }));
    expect(title(noSheet)).toBe('Можно отвечать на билеты');
    expect(noSheet.text).toBe('Тяните билет и отвечайте вслух — Meldy проверит ответ по вашим лекциям.');
  });

  it('a copy from a group link, ready: its own words, no mapping and no units', () => {
    const status = examStatus(input({ copy: true, coverage: MAPPED, sheet: { written: 14, lines: { left: 42, total: 42 } } }));
    expect(status.key).toBe('ready');
    expect(status.flag).toBe('Из ссылки группы');
    expect(title(status)).toBe('Экзамен из ссылки группы готов');
    expect(status.text).toBe(
      'Вопросы уже сверены с лекциями автора, шпаргалка написана. Тяните билет и отвечайте вслух: названный пункт стирает строку наполовину, названный снова в другой день — совсем.',
    );
    expect(`${title(status)} ${status.text}`).not.toMatch(/единиц|сверьте|Сверить/);
  });

  it('answering: what can be erased today, else when the next lines can be, else how many lines are left', () => {
    const erase = examStatus(input({ coverage: MAPPED, sheet: { written: 14, lines: { left: 40, total: 42 }, erasable: 3 }, answers: { answered: 3, untested: 15 } }));
    expect(erase.key).toBe('answering');
    expect(title(erase)).toBe('Сегодня можно стереть строки шпаргалки у 3 вопросов');
    expect(erase.text).toBe('Их пункты вы уже называли в другой день. Назовёте снова — строки сотрутся совсем.');
    expect(erase.action).toEqual({ kind: 'awaiting', label: 'Тянуть билет из них' });
    const later = examStatus(
      input({ coverage: MAPPED, sheet: { written: 14, lines: { left: 40, total: 42 }, nextErasable: 'Следующие строки можно стереть после 9 окт., 15:40.' }, answers: { answered: 3, untested: 15 } }),
    );
    expect(title(later)).toBe('Следующие строки можно стереть после 9 окт., 15:40');
    expect(later.text).toBe('А пока отвечайте на вопросы, которых ещё не было: их 15.');
    expect(later.action).toEqual({ kind: 'draw', label: 'Тянуть билет' });
    const left = examStatus(input({ coverage: MAPPED, sheet: { written: 14, lines: { left: 21, total: 42 } }, answers: { answered: 18, untested: 0 } }));
    expect(title(left)).toBe('На шпаргалке осталась 21 строка из 42');
    const bare = examStatus(input({ coverage: MAPPED, sheet: { state: 'error' }, answers: { answered: 5, confirmed: 2 } }));
    expect(title(bare)).toBe('Подтверждено ответами: 2 из 18');
  });

  it('never puts a percentage in the status block', () => {
    const inputs: Overrides[] = [
      {},
      { copy: true },
      { coverage: { unmapped: 18 } },
      { coverage: MAPPED, sheet: { toWrite: 14, units: 14 } },
      { coverage: MAPPED, sheet: { written: 14, lines: { left: 42, total: 42 } } },
      { coverage: MAPPED, sheet: { written: 14, lines: { left: 40, total: 42 }, erasable: 2 }, answers: { answered: 2 } },
      { coverage: { full: 3, none: 15 } },
    ];
    for (const overrides of inputs) {
      const status = examStatus(input(overrides));
      expect(`${title(status)} ${status.text ?? ''} ${status.blocked ?? ''}`).not.toContain('%');
    }
  });
});

describe('examStatus: a phone’s one line (Phone_Declutter_2026-10-08)', () => {
  const brief = (overrides: Overrides) => examStatus(input(overrides)).brief;

  it('says what to do in one short line and keeps every price and limit', () => {
    expect(brief({ total: 0 })).toBe('Вставьте список вопросов кафедры.');
    expect(brief({ lectures: [] })).toBe('Meldy ищет ответы на вопросы в ваших лекциях.');
    expect(brief({ coverage: { unmapped: 18 } })).toBe('Сверка стоит 10 единиц ИИ.');
    expect(brief({ coverage: { unmapped: 18 }, mapping: { cost: 0 } })).toBe('Meldy отметит, где в лекциях есть ответ.');
    expect(brief({ coverage: { unmapped: 18 }, mapping: { phase: 'running', progress: { checked: 7, total: 18 } } })).toBe('Проверено 7 из 18. Не закрывайте вкладку.');
    expect(brief({ coverage: { unmapped: 18 }, mapping: { phase: 'waiting' } })).toBe('Список обновится сам, когда она закончится.');
    expect(brief({ coverage: { full: 7, unmapped: 11 }, mapping: { phase: 'interrupted', progress: { checked: 7, total: 18 } } })).toBe('Проверено 7 из 18. Продолжение стоит 10 единиц ИИ.');
    expect(brief({ coverage: MAPPED, mapping: { added: 2 } })).toBe('Сверьте заново — это стоит 10 единиц ИИ.');
    expect(brief({ coverage: { ...MAPPED, none: 1, unmapped: 3 } })).toBe('Meldy проверит только их — это стоит 10 единиц ИИ.');
    expect(brief({ coverage: { ...MAPPED, none: 0, unverified: 4 } })).toBe('Проверьте их снова — это стоит 10 единиц ИИ.');
    expect(brief({ coverage: MAPPED, sheet: { toWrite: 14, units: 14 } })).toBe('Meldy выпишет из них пункты ответа. Это стоит 14 единиц ИИ.');
    expect(brief({ coverage: MAPPED, sheet: { toWrite: 14, units: 14, unitsLeft: 5 } })).toBe(
      'Meldy выпишет из них пункты ответа. Это стоит 14 единиц ИИ. Сегодня хватит на 5 вопросов, остальные — после 3:00.',
    );
    expect(brief({ coverage: MAPPED, sheet: { writing: { done: 5, total: 14 } } })).toBe('Готово 5 из 14. Страницу можно закрыть.');
    expect(brief({ coverage: MAPPED, sheet: { lines: { left: 40, total: 40 } } })).toBe('Тяните билет и отвечайте вслух.');
    expect(brief({ coverage: MAPPED, sheet: { lines: { left: 40, total: 40 }, erasable: 4 }, answers: { answered: 6 } })).toBe('Назовите их пункты снова в ответе.');
    expect(brief({ coverage: MAPPED, sheet: { lines: { left: 30, total: 40 } }, answers: { answered: 6 } })).toBe('Отвечайте дальше: ответы стирают строки.');
  });

  it('keeps every word where they all matter: a server’s message, nothing found', () => {
    expect(brief({ coverage: { unmapped: 18 }, mapping: { phase: 'failed', message: 'Сервис ИИ сейчас перегружен. Повторите через минуту.' } })).toBeNull();
    expect(brief({})).toBeNull();
    // The full text stays the computer's.
    expect(examStatus(input({ coverage: MAPPED, sheet: { lines: { left: 40, total: 40 }, erasable: 4 }, answers: { answered: 6 } })).text).toBe(
      'Их пункты вы уже называли в другой день. Назовёте снова — строки сотрутся совсем.',
    );
  });
});
