import { describe, expect, it } from 'vitest';
import type { ExamQuestion, ParseResult } from '../../api/exams';
import {
  chosenLayout,
  defaultLayoutMode,
  draftQuestions,
  filledSectionCount,
  insertQuestion,
  keepSavedQuestions,
  layoutFits,
  listProblem,
  mergeWithNext,
  previewFromExam,
  previewFromParse,
  questionCount,
  removeRow,
  rowIndexOfQuestion,
  rowProblem,
  sectionTitles,
  skippedLines,
  splitPoint,
  splitRow,
  suggestedMaterialIds,
  suggestionReason,
  suggestedTitle,
  toggleSection,
} from './previewModel';

const PARSE: ParseResult = {
  method: 'regex',
  questions: [
    { position: 1, label: '1', text: 'Предмет и метод макроэкономики.', section: 1, flags: [] },
    { position: 2, label: '2', text: 'Система национальных счетов.', section: 1, flags: [] },
    { position: 3, label: '3', text: 'Инфляция: виды и причины.', section: 2, flags: [] },
    { position: 4, label: '4', text: 'Рынок труда и безработица.', section: 2, flags: ['long'] },
  ],
  sections: [
    { index: 1, title: 'Раздел 1. Введение' },
    { index: 2, title: 'Раздел 2. Деньги и труд' },
  ],
  tickets: [
    { number: 1, positions: [1, 3] },
    { number: 2, positions: [2, 4] },
  ],
  warnings: [{ code: 'unparsed_lines', message: 'Пропустили 3 строки.' }],
  source_text: [
    'Вопросы к экзамену по курсу «Макроэкономика»',
    'Раздел 1. Введение',
    '1. Предмет и метод макроэкономики.',
    'Сюда попала лишняя строка без номера',
    '2. Система национальных счетов.',
    'Экзаменационный билет № 1',
    'Раздел 2. Деньги и труд',
    '3. Инфляция: виды и причины.',
    'Колонка | Колонка',
    '4. Рынок труда и безработица.',
  ].join('\n'),
};

const texts = (state: ReturnType<typeof previewFromParse>) => state.rows.map((row) => `${row.kind === 'section' ? '#' : ''}${row.text}`);

describe('previewFromParse', () => {
  it('lays out headings and questions and points known tickets at the rows', () => {
    const state = previewFromParse(PARSE);
    expect(texts(state)).toEqual([
      '#Раздел 1. Введение',
      'Предмет и метод макроэкономики.',
      'Система национальных счетов.',
      '#Раздел 2. Деньги и труд',
      'Инфляция: виды и причины.',
      'Рынок труда и безработица.',
    ]);
    expect(state.tickets).toEqual([
      { number: 1, keys: ['p1', 'p3'] },
      { number: 2, keys: ['p2', 'p4'] },
    ]);
    expect(questionCount(state)).toBe(4);
    expect(filledSectionCount(state)).toBe(2);
    expect(sectionTitles(state)).toEqual(['Раздел 1. Введение', 'Раздел 2. Деньги и труд']);
    expect(draftQuestions(state).map((question) => [question.key, question.section])).toEqual([
      ['p1', 1],
      ['p2', 1],
      ['p3', 2],
      ['p4', 2],
    ]);
  });
});

describe('editing the preview keeps the tickets consistent', () => {
  it('deleting a question keeps the other question of its ticket; an emptied ticket goes away', () => {
    let state = removeRow(previewFromParse(PARSE), 'p3');
    expect(state.tickets).toEqual([
      { number: 1, keys: ['p1'] },
      { number: 2, keys: ['p2', 'p4'] },
    ]);
    state = removeRow(state, 'p1');
    expect(state.tickets).toEqual([{ number: 2, keys: ['p2', 'p4'] }]);
  });

  it('merging hands the next row’s place in its ticket to the merged row', () => {
    const state = mergeWithNext(previewFromParse(PARSE), 'p1');
    expect(texts(state)[1]).toBe('Предмет и метод макроэкономики. Система национальных счетов.');
    expect(state.tickets).toEqual([
      { number: 1, keys: ['p1', 'p3'] },
      { number: 2, keys: ['p1', 'p4'] },
    ]);
    // A heading is never merged into a question.
    expect(mergeWithNext(state, 'p1')).toBe(state);
  });

  it('splits a question at the sentence end nearest to the middle, or at the caret', () => {
    expect(splitPoint('Деньги и их функции. Денежные агрегаты и денежная масса.')).toBe(20);
    expect(splitPoint('одно')).toBe(-1);
    const state = previewFromParse(PARSE);
    const merged = mergeWithNext(state, 'p1');
    const split = splitRow(merged, 'p1');
    expect(texts(split).slice(1, 3)).toEqual(['Предмет и метод макроэкономики.', 'Система национальных счетов.']);
    const atCaret = splitRow(state, 'p3', 'Инфляция:'.length);
    expect(texts(atCaret).slice(4, 6)).toEqual(['Инфляция:', 'виды и причины.']);
    expect(atCaret.rows[5].label).toBe('');
  });

  it('a question turned into a heading leaves its ticket and starts a section', () => {
    const state = toggleSection(previewFromParse(PARSE), 'p2');
    expect(state.tickets).toEqual([
      { number: 1, keys: ['p1', 'p3'] },
      { number: 2, keys: ['p4'] },
    ]);
    expect(draftQuestions(state).map((question) => [question.key, question.section])).toEqual([
      ['p1', 1],
      ['p3', 3],
      ['p4', 3],
    ]);
    expect(texts(toggleSection(state, 'p2'))[2]).toBe('Система национальных счетов.');
  });

  it('inserts a typed question at the place of a skipped line', () => {
    const state = previewFromParse(PARSE);
    expect(rowIndexOfQuestion(state, 0)).toBe(1);
    expect(rowIndexOfQuestion(state, 2)).toBe(4);
    expect(rowIndexOfQuestion(state, 9)).toBe(state.rows.length);
    const next = insertQuestion(state, rowIndexOfQuestion(state, 1), '  Лишняя строка  ');
    expect(texts(next)[2]).toBe('Лишняя строка');
    expect(questionCount(next)).toBe(5);
  });

  it('says what blocks saving', () => {
    const state = previewFromParse(PARSE);
    expect(listProblem(state)).toBeNull();
    expect(rowProblem({ key: 'x', id: null, kind: 'question', label: '', text: 'аб', flags: [] })).toBe('Слишком короткий вопрос: допишите или удалите строку.');
    expect(rowProblem({ key: 'x', id: null, kind: 'section', label: '', text: ' ', flags: [] })).toBe('Пустой заголовок раздела.');
    expect(listProblem({ rows: [], tickets: [] })).toBe('В списке нет ни одного вопроса.');
    expect(listProblem(insertQuestion(state, 0, 'аб'))).toBe('Исправьте строки, отмеченные в списке.');
  });
});

describe('a saved exam', () => {
  const saved = (id: string, position: number, text: string, section: number | null = null): ExamQuestion => ({
    id,
    exam_id: 'exam-1',
    position,
    label: String(position),
    section,
    text,
    question_hash: null,
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    evidence: [],
    nearest: [],
    materials_fingerprint: null,
    mapping_version: null,
    mapped_at: null,
    created_at: '2026-10-01T10:00:00Z',
  });

  it('is shown by question id with its section titles and tickets', () => {
    const state = previewFromExam(
      [saved('q2', 2, 'Инфляция.', 2), saved('q1', 1, 'Деньги.', 1)],
      { mode: 'fixed', per_ticket: 2, tickets: [{ number: 5, question_ids: ['q1', 'q2', 'gone'] }], section_titles: ['Основы', 'Деньги'] },
    );
    expect(texts(state)).toEqual(['#Основы', 'Деньги.', '#Деньги', 'Инфляция.']);
    expect(state.tickets).toEqual([{ number: 5, keys: ['q1', 'q2'] }]);
  });

  it('keeps the ids of unchanged questions when the list is pasted again', () => {
    const state = keepSavedQuestions(previewFromParse(PARSE), [saved('q-old', 3, 'инфляция — виды и причины')]);
    const row = state.rows.find((item) => item.text === 'Инфляция: виды и причины.');
    expect(row).toMatchObject({ key: 'q-old', id: 'q-old' });
    expect(state.tickets[0]).toEqual({ number: 1, keys: ['p1', 'q-old'] });
  });
});

describe('what the parser dropped', () => {
  it('reports lines without a number at their place, not headings, tickets or table rows', () => {
    expect(skippedLines(PARSE).map((line) => [line.text, line.beforeQuestion])).toEqual([
      ['Вопросы к экзамену по курсу «Макроэкономика»', 0],
      ['Сюда попала лишняя строка без номера', 1],
    ]);
    expect(skippedLines({ ...PARSE, warnings: [] })).toEqual([]);
    expect(skippedLines(PARSE, 1)).toHaveLength(1);
  });
});

describe('suggestions', () => {
  it('takes the exam title from the list’s header', () => {
    expect(suggestedTitle(PARSE)).toBe('Макроэкономика');
    expect(suggestedTitle({ source_text: 'Вопросы к зачёту по дисциплине "Финансы и кредит".\n1. Деньги' })).toBe('Финансы и кредит');
    expect(suggestedTitle({ source_text: '1. Деньги\n2. Кредит' })).toBe('');
  });

  it('ticks lectures that share a word with the title and text-only imports, all lectures with text when none does', () => {
    const materials = [
      { id: 'm1', title: 'Денежный рынок', subject: 'Макроэкономика', textLength: 4000 },
      { id: 'm2', title: 'Лекция 3', subject: '', textLength: 9000 },
      { id: 'm3', title: 'Скан макроэкономики', subject: 'Макроэкономика', textLength: 0 },
      { id: 'm4', title: 'Механика', subject: 'Физика', textLength: 5000 },
    ];
    // m2 is a text-only import (no subject): nothing says it is from another course.
    expect(suggestedMaterialIds(materials, 'Макроэкономика')).toEqual(['m1', 'm2']);
    expect(suggestedMaterialIds(materials, 'Физика')).toEqual(['m2', 'm4']);
    expect(suggestedMaterialIds(materials, 'История')).toEqual(['m1', 'm2', 'm4']);
    expect(suggestedMaterialIds(materials, '')).toEqual(['m1', 'm2', 'm4']);
    // What the editor says about the ticks: no title yet, by the title's words, or nothing matched.
    expect(suggestionReason(materials, '')).toBe('no-title');
    expect(suggestionReason(materials, 'Макроэкономика')).toBe('by-title');
    expect(suggestionReason(materials, 'История')).toBe('no-match');
    // A scan shares the word but gives the mapping nothing: it does not count as a match.
    expect(suggestionReason([materials[2]], 'Макроэкономика')).toBe('no-match');
  });

  it('keeps the whole demo course when the title comes from the list header', () => {
    const analysed = [1, 2, 3].map((n) => ({ id: `a${n}`, title: `Лекция ${n}`, subject: 'Микроэкономика', textLength: 6000 }));
    const textOnly = [4, 5, 6, 7, 8, 9].map((n) => ({ id: `t${n}`, title: `Лекция ${n}. Тема ${n}`, subject: '', textLength: 7000 }));
    const course = [...analysed, ...textOnly];
    expect(suggestedMaterialIds(course, '')).toHaveLength(9);
    expect(suggestedMaterialIds(course, suggestedTitle({ source_text: 'Вопросы к экзамену по курсу «Микроэкономика»\n1. Спрос' }))).toEqual(
      course.map((material) => material.id),
    );
  });
});

describe('ticket layout of the editor (Jury_Check item 10)', () => {
  const withTickets = previewFromParse(PARSE);
  const sectionsOnly = previewFromParse({ ...PARSE, tickets: [] });
  const plain = previewFromParse({
    ...PARSE,
    questions: PARSE.questions.map((question) => ({ ...question, section: null })),
    sections: [],
    tickets: [],
  });
  const oneSection = previewFromParse({
    ...PARSE,
    questions: PARSE.questions.map((question) => ({ ...question, section: 1 })),
    tickets: [],
  });

  it('defaults to the department’s tickets, then to one question per section, then to random tickets', () => {
    expect(defaultLayoutMode(withTickets, 2)).toBe('fixed');
    expect(defaultLayoutMode(sectionsOnly, 2)).toBe('sections');
    expect(defaultLayoutMode(sectionsOnly, 3)).toBe('random');
    expect(defaultLayoutMode(plain, 2)).toBe('random');
    // One section is the same as random tickets: «по одному из каждого раздела» would only confuse.
    expect(defaultLayoutMode(oneSection, 1)).toBe('random');
  });

  it('says which layouts fit the list', () => {
    expect(layoutFits('random', plain, 2)).toBe(true);
    expect(layoutFits('fixed', withTickets, 2)).toBe(true);
    expect(layoutFits('fixed', sectionsOnly, 2)).toBe(false);
    expect(layoutFits('sections', sectionsOnly, 2)).toBe(true);
    expect(layoutFits('sections', sectionsOnly, 3)).toBe(false);
    expect(layoutFits('sections', plain, 2)).toBe(false);
  });

  it('keeps an explicit or stored choice while it fits and falls back to the default when it does not', () => {
    expect(chosenLayout(null, sectionsOnly, 2)).toBe('sections');
    expect(chosenLayout('random', sectionsOnly, 2)).toBe('random');
    expect(chosenLayout('random', withTickets, 2)).toBe('random');
    expect(chosenLayout('sections', withTickets, 2)).toBe('sections');
    // A choice that no longer fits gives way to the default, and comes back when it fits again.
    expect(chosenLayout('sections', sectionsOnly, 3)).toBe('random');
    expect(chosenLayout('sections', sectionsOnly, 2)).toBe('sections');
    expect(chosenLayout('fixed', sectionsOnly, 2)).toBe('sections');
    // Removing the second section's questions turns «sections» into random tickets.
    const shrunk = removeRow(removeRow(sectionsOnly, 'p3'), 'p4');
    expect(chosenLayout(null, shrunk, 2)).toBe('random');
  });
});
