import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ExamBundle, ExamDraft, ExamQuestion, ParseResult, PickerMaterial } from '../api/exams';

const mocks = vi.hoisted(() => ({
  parseQuestionList: vi.fn(),
  listPickerMaterials: vi.fn(),
  createExam: vi.fn(),
  saveExamEdits: vi.fn(),
  loadExamBundle: vi.fn(),
  importTextOnlyMaterial: vi.fn(),
  deleteExam: vi.fn(),
  startMapping: vi.fn(),
  verifyEnergy: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../hooks/useEnergyConfirm', () => ({ useEnergyConfirm: () => ({ verifyEnergy: mocks.verifyEnergy }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm, alert: vi.fn() }) }));
vi.mock('../api/exams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/exams')>();
  return {
    ...actual,
    parseQuestionList: mocks.parseQuestionList,
    listPickerMaterials: mocks.listPickerMaterials,
    createExam: mocks.createExam,
    saveExamEdits: mocks.saveExamEdits,
    loadExamBundle: mocks.loadExamBundle,
    importTextOnlyMaterial: mocks.importTextOnlyMaterial,
    deleteExam: mocks.deleteExam,
  };
});
vi.mock('../components/exams/mapJobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/exams/mapJobs')>();
  return { ...actual, startMapping: mocks.startMapping };
});

import ExamEditor from './ExamEditor';

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
  warnings: [{ code: 'unparsed_lines', message: 'Пропустили 1 строку.' }],
  source_text:
    'Вопросы к экзамену по курсу «Макроэкономика»\nРаздел 1. Введение\n1. Предмет и метод макроэкономики.\n2. Система национальных счетов.\nРаздел 2. Деньги и труд\n3. Инфляция: виды и причины.\n4. Рынок труда и безработица.',
};

function material(id: string, title: string, subject: string, overrides: Partial<PickerMaterial> = {}): PickerMaterial {
  return { id, title, subject, created_at: '2026-10-01T10:00:00Z', textLength: 4000, fragments: 12, textOnly: false, ...overrides };
}

const MATERIALS = [
  material('m1', 'Денежный рынок', 'Макроэкономика'),
  material('m2', 'Лекция 3', '', { textOnly: true, fragments: 30 }),
  material('m3', 'Скан лекции', '', { textLength: 0, fragments: 0 }),
  material('m4', 'Механика', 'Физика'),
];

function savedQuestion(id: string, position: number, text: string, overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  return {
    id,
    exam_id: 'exam-1',
    position,
    label: String(position),
    section: null,
    text,
    question_hash: 'd'.repeat(32),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    evidence: [],
    nearest: [],
    materials_fingerprint: 'fp',
    mapping_version: 1,
    mapped_at: '2026-10-02T10:00:00Z',
    created_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

function savedBundle(overrides: Partial<ExamBundle['exam']> = {}): ExamBundle {
  return {
    exam: {
      id: 'exam-1',
      title: 'Макроэкономика',
      kind: 'exam',
      exam_date: '2026-10-20',
      source_kind: 'paste',
      source_text: '1. …',
      ticket_layout: { mode: 'random', per_ticket: 2 },
      mapping_state: 'done',
      mapping_started_at: null,
      mapped_at: '2026-10-02T10:00:00Z',
      mapped_material_ids: ['m1'],
      created_at: '2026-10-01T10:00:00Z',
      ...overrides,
    },
    questions: [savedQuestion('q1', 1, 'Предмет и метод.'), savedQuestion('q2', 2, 'Инфляция.'), savedQuestion('q3', 3, 'Рынок труда.')],
    materialIds: ['m1'],
    materials: [{ id: 'm1', title: 'Денежный рынок' }],
  };
}

function renderEditor(path = '/exams/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams" element={<h1>Список экзаменов</h1>} />
        <Route path="/exams/new" element={<ExamEditor />} />
        <Route path="/exams/:id/edit" element={<ExamEditor />} />
        <Route path="/exams/:id" element={<h1>Лист экзамена</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ');

async function pasteAndParse() {
  renderEditor();
  fireEvent.change(screen.getByRole('textbox', { name: 'Список вопросов' }), { target: { value: PARSE.source_text } });
  fireEvent.click(screen.getByRole('button', { name: 'Распознать вопросы' }));
  await screen.findByText(/Распознано 4 вопроса, 2 раздела/);
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.parseQuestionList.mockResolvedValue(PARSE);
  mocks.listPickerMaterials.mockResolvedValue(MATERIALS);
  mocks.createExam.mockResolvedValue({ examId: 'new-exam', questionIds: [] });
  mocks.saveExamEdits.mockResolvedValue({ questionIds: [], needsMapping: ['q2'], materialsChanged: false });
  mocks.verifyEnergy.mockResolvedValue(true);
  mocks.confirm.mockResolvedValue(true);
  mocks.startMapping.mockResolvedValue('started');
});

afterEach(() => {
  cleanup();
});

describe('ExamEditor: a new exam', () => {
  it('parses the pasted list, suggests the title and keeps the department’s tickets', async () => {
    await pasteAndParse();
    expect(mocks.parseQuestionList).toHaveBeenCalledWith({ text: PARSE.source_text });
    expect(screen.getByLabelText('Название экзамена')).toHaveValue('Макроэкономика');
    // Only the subject goes here; the kind of exam is chosen next to it.
    expect(screen.getByLabelText('Название экзамена')).toHaveAttribute('placeholder', 'Микроэкономика');
    expect(screen.getByLabelText('Название экзамена')).toHaveAccessibleDescription('Только предмет — вид экзамена выбирается рядом');
    expect(screen.getByRole('combobox', { name: 'Как составлены билеты' })).toHaveValue('fixed');
    expect(screen.getByText(/2 билета из списка кафедры/)).toBeInTheDocument();
    expect(screen.getByText('Раздел 1. Введение')).toBeInTheDocument();
    expect(screen.getByText(/Очень длинная строка — возможно, склеились два вопроса/)).toBeInTheDocument();
  });

  it('shows a line the parser dropped at its place and turns it into a question', async () => {
    await pasteAndParse();
    const note = screen.getByText(/Строка без номера пропущена: «Вопросы к экзамену по курсу «Макроэкономика»»/);
    fireEvent.click(within(note).getByRole('button', { name: 'Это вопрос' }));
    expect(await screen.findByText(/Распознано 5 вопросов/)).toBeInTheDocument();
    expect(screen.queryByText(/Строка без номера пропущена/)).toBeNull();
  });

  it('edits, deletes and saves: exam → questions without hashes → lectures, tickets by question keys, then mapping', async () => {
    await pasteAndParse();
    fireEvent.click(screen.getByRole('button', { name: /Изменить вопрос 2:/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст вопроса' }), { target: { value: 'Система национальных счетов: ВВП и ВНД.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(screen.getByRole('button', { name: /Изменить вопрос 3:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(screen.getByText(/Распознано 3 вопроса/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Разметить по лекциям' }));
    await waitFor(() => expect(mocks.createExam).toHaveBeenCalledTimes(1));
    const [userId, draft] = mocks.createExam.mock.calls[0] as [string, ExamDraft];
    expect(userId).toBe('user-1');
    expect(draft).toMatchObject({ title: 'Макроэкономика', kind: 'exam', layoutMode: 'fixed', perTicket: 2, sourceKind: 'paste' });
    expect(draft.questions.map((question) => question.text)).toEqual([
      'Предмет и метод макроэкономики.',
      'Система национальных счетов: ВВП и ВНД.',
      'Рынок труда и безработица.',
    ]);
    for (const question of draft.questions) expect(question).not.toHaveProperty('question_hash');
    // Ticket 1 lost question 3 and keeps question 1; ticket 2 is whole.
    expect(draft.tickets).toEqual([
      { number: 1, keys: ['p1'] },
      { number: 2, keys: ['p2', 'p4'] },
    ]);
    expect(draft.sectionTitles).toEqual(['Раздел 1. Введение', 'Раздел 2. Деньги и труд']);
    // The lecture of the course and the text-only import; not the physics lecture, never the scan.
    expect(draft.materialIds).toEqual(['m1', 'm2']);
    await waitFor(() => expect(mocks.startMapping).toHaveBeenCalledWith(expect.objectContaining({ examId: 'new-exam', userId: 'user-1' })));
    expect(await screen.findByRole('heading', { name: 'Лист экзамена' })).toBeInTheDocument();
  });

  it('merges a line with the next one and splits a line in two', async () => {
    await pasteAndParse();
    fireEvent.click(screen.getByRole('button', { name: /Изменить вопрос 1:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Склеить со следующей' }));
    expect(screen.getByText(/Распознано 3 вопроса/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Текст вопроса' })).toHaveValue('Предмет и метод макроэкономики. Система национальных счетов.');
    fireEvent.click(screen.getByRole('button', { name: 'Разбить' }));
    expect(screen.getByText(/Распознано 4 вопроса/)).toBeInTheDocument();
  });

  it('turns a line into a section heading', async () => {
    await pasteAndParse();
    fireEvent.click(screen.getByRole('button', { name: /Изменить вопрос 4:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Это заголовок раздела' }));
    expect(screen.getByText(/Распознано 3 вопроса, 3 раздела/)).toBeInTheDocument();
  });

  it('ticks lectures by the words of the title and text-only imports, all of them when none matches, never a scan', async () => {
    await pasteAndParse();
    expect(plain(screen.getByText(/лекци/, { selector: '#lectures .nx-line' }).textContent)).toContain('2 из 3 лекций');
    expect(screen.getByText(/1 из них загружена только текстом/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'изменить' }));
    const list = screen.getByRole('list', { name: 'Лекции для экзамена' });
    expect(within(list).getByRole('checkbox', { name: /Денежный рынок/ })).toBeChecked();
    // A text-only import has no subject: it stays ticked when the title comes from the list header.
    expect(within(list).getByRole('checkbox', { name: /Лекция 3/ })).toBeChecked();
    expect(within(list).getByRole('checkbox', { name: /Механика/ })).not.toBeChecked();
    const scan = within(list).getByRole('checkbox', { name: /Скан лекции/ });
    expect(scan).toBeDisabled();
    expect(within(list).getByText('нет текста — не участвует')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Название экзамена'), { target: { value: 'История' } });
    expect(within(list).getByRole('checkbox', { name: /Лекция 3/ })).toBeChecked();
    expect(within(list).getByRole('checkbox', { name: /Денежный рынок/ })).toBeChecked();
    expect(within(list).getByRole('checkbox', { name: /Механика/ })).toBeChecked();
  });

  it('imports lectures as plain text without spending the daily limit', async () => {
    mocks.importTextOnlyMaterial.mockResolvedValue(material('m9', 'Лекция 10. Рынок капитала', '', { textOnly: true, fragments: 8 }));
    await pasteAndParse();
    const input = screen.getByLabelText('Файлы лекций') as HTMLInputElement;
    const file = new File(['Лекция 10'], 'lecture-10.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('«lecture-10.pdf» добавлена.')).toBeInTheDocument();
    expect(mocks.importTextOnlyMaterial).toHaveBeenCalledWith('user-1', file);
    expect(screen.getByRole('checkbox', { name: /Лекция 10. Рынок капитала/ })).toBeChecked();
    expect(mocks.verifyEnergy).not.toHaveBeenCalled();
  });

  it('shows a failed import next to its file', async () => {
    const { ExamApiError } = await import('../api/exams');
    mocks.importTextOnlyMaterial.mockRejectedValue(new ExamApiError('В файле не найден текст: похоже на скан.', 'no_text'));
    await pasteAndParse();
    fireEvent.change(screen.getByLabelText('Файлы лекций'), { target: { files: [new File(['x'], 'scan.pdf')] } });
    expect(await screen.findByText('«scan.pdf» не добавлена: В файле не найден текст: похоже на скан.')).toBeInTheDocument();
  });

  it('says why the list was not recognised', async () => {
    const { ExamApiError } = await import('../api/exams');
    mocks.parseQuestionList.mockRejectedValue(new ExamApiError('Не нашли ни одного вопроса. Каждый вопрос — с новой строки.', null, 400));
    renderEditor();
    fireEvent.change(screen.getByRole('textbox', { name: 'Список вопросов' }), { target: { value: 'просто текст' } });
    fireEvent.click(screen.getByRole('button', { name: 'Распознать вопросы' }));
    expect(await screen.findByText('Не нашли ни одного вопроса. Каждый вопрос — с новой строки.')).toBeInTheDocument();
  });

  it('saves without mapping when no lecture is chosen', async () => {
    mocks.listPickerMaterials.mockResolvedValue([]);
    await pasteAndParse();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить список' }));
    await waitFor(() => expect(mocks.createExam).toHaveBeenCalledTimes(1));
    expect(mocks.startMapping).not.toHaveBeenCalled();
  });

  it('says where to find the list under the empty field, and only before a list is pasted', async () => {
    renderEditor();
    const hint = 'Список вопросов часто есть в рабочей программе дисциплины на сайте кафедры или у старосты.';
    expect(screen.getByText((_, node) => node?.tagName === 'P' && plain(node.textContent) === hint)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Файл' }));
    expect(screen.getByText((_, node) => node?.tagName === 'P' && plain(node.textContent) === hint)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Вставить текст' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Список вопросов' }), { target: { value: PARSE.source_text } });
    fireEvent.click(screen.getByRole('button', { name: 'Распознать вопросы' }));
    await screen.findByText(/Распознано 4 вопроса, 2 раздела/);
    expect(screen.queryByText(/рабочей программе дисциплины/)).toBeNull();
  });
});

describe('ExamEditor: how the tickets are made, by default and by choice', () => {
  /** The same list without the department's tickets: two sections of two questions. */
  const SECTIONS_ONLY: ParseResult = { ...PARSE, tickets: [] };
  /** A list without sections or tickets. */
  const PLAIN_LIST: ParseResult = {
    ...PARSE,
    questions: PARSE.questions.map((question) => ({ ...question, section: null })),
    sections: [],
    tickets: [],
  };

  async function parse(result: ParseResult) {
    mocks.parseQuestionList.mockResolvedValue(result);
    renderEditor();
    fireEvent.change(screen.getByRole('textbox', { name: 'Список вопросов' }), { target: { value: result.source_text } });
    fireEvent.click(screen.getByRole('button', { name: 'Распознать вопросы' }));
    await screen.findByText(/Распознано 4 вопроса/);
  }

  const layout = () => screen.getByRole('combobox', { name: 'Как составлены билеты' });
  const perTicket = () => screen.getByRole('combobox', { name: 'Вопросов в билете' });

  it('takes one question from each section when there are as many sections as questions in a ticket', async () => {
    await parse(SECTIONS_ONLY);
    expect(perTicket()).toHaveValue('2');
    expect(layout()).toHaveValue('sections');

    // Re-evaluated when the number of questions per ticket changes…
    fireEvent.change(perTicket(), { target: { value: '3' } });
    expect(layout()).toHaveValue('random');
    fireEvent.change(perTicket(), { target: { value: '2' } });
    expect(layout()).toHaveValue('sections');

    // …and when the list changes: the second section loses its questions, so random tickets.
    fireEvent.click(screen.getByRole('button', { name: /Изменить вопрос 3:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: /Изменить вопрос 4:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(layout()).toHaveValue('random');

    fireEvent.click(screen.getByRole('button', { name: 'Разметить по лекциям' }));
    await waitFor(() => expect(mocks.createExam).toHaveBeenCalledTimes(1));
    expect((mocks.createExam.mock.calls[0] as [string, ExamDraft])[1]).toMatchObject({ layoutMode: 'random', perTicket: 2 });
  });

  it('saves «по одному из каждого раздела» when the student keeps the default', async () => {
    await parse(SECTIONS_ONLY);
    fireEvent.click(screen.getByRole('button', { name: 'Разметить по лекциям' }));
    await waitFor(() => expect(mocks.createExam).toHaveBeenCalledTimes(1));
    expect((mocks.createExam.mock.calls[0] as [string, ExamDraft])[1]).toMatchObject({ layoutMode: 'sections', perTicket: 2 });
  });

  it('takes the department’s tickets when the list had «Билет № N» blocks', async () => {
    await parse(PARSE);
    expect(layout()).toHaveValue('fixed');
    expect(perTicket()).toBeDisabled();
  });

  it('takes random tickets for a list without sections or tickets', async () => {
    await parse(PLAIN_LIST);
    expect(layout()).toHaveValue('random');
    expect(within(layout()).queryByRole('option', { name: 'по одному из каждого раздела' })).toBeNull();
  });

  it('keeps the student’s choice when the list or the questions per ticket change', async () => {
    await parse(SECTIONS_ONLY);
    expect(layout()).toHaveValue('sections');
    fireEvent.change(layout(), { target: { value: 'random' } });
    expect(layout()).toHaveValue('random');

    fireEvent.change(perTicket(), { target: { value: '3' } });
    fireEvent.change(perTicket(), { target: { value: '2' } });
    expect(layout()).toHaveValue('random');
    fireEvent.click(screen.getByRole('button', { name: /Изменить вопрос 2:/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст вопроса' }), { target: { value: 'Система национальных счетов: ВВП.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(layout()).toHaveValue('random');

    fireEvent.click(screen.getByRole('button', { name: 'Разметить по лекциям' }));
    await waitFor(() => expect(mocks.createExam).toHaveBeenCalledTimes(1));
    expect((mocks.createExam.mock.calls[0] as [string, ExamDraft])[1]).toMatchObject({ layoutMode: 'random' });
  });

  it('keeps a chosen «по одному из каждого раздела» over the department’s tickets of a list pasted again', async () => {
    await parse(SECTIONS_ONLY);
    fireEvent.change(layout(), { target: { value: 'random' } });
    fireEvent.change(layout(), { target: { value: 'sections' } });
    mocks.parseQuestionList.mockResolvedValue(PARSE);
    fireEvent.click(screen.getByRole('button', { name: 'Вставить заново' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Список вопросов' }), { target: { value: PARSE.source_text } });
    fireEvent.click(screen.getByRole('button', { name: 'Распознать вопросы' }));
    await screen.findByText(/Распознано 4 вопроса/);
    expect(layout()).toHaveValue('sections');
  });
});

describe('ExamEditor: editing a saved exam', () => {
  it('sends a changed question by id (its coverage is reset on save) and maps again', async () => {
    mocks.loadExamBundle.mockResolvedValue(savedBundle());
    renderEditor('/exams/exam-1/edit');
    expect(await screen.findByText(/В списке 3 вопроса/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Изменить вопрос 2:/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст вопроса' }), { target: { value: 'Инфляция: виды, причины и последствия.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и разметить' }));

    await waitFor(() => expect(mocks.saveExamEdits).toHaveBeenCalledTimes(1));
    const [input] = mocks.saveExamEdits.mock.calls[0] as [{ exam: { id: string }; draft: ExamDraft; replaceSource: boolean }];
    expect(input.exam.id).toBe('exam-1');
    expect(input.draft.questions.map((question) => question.id)).toEqual(['q1', 'q2', 'q3']);
    expect(input.draft.questions[1]).toMatchObject({ id: 'q2', text: 'Инфляция: виды, причины и последствия.' });
    expect(input.replaceSource).toBe(false);
    await waitFor(() => expect(mocks.startMapping).toHaveBeenCalledWith(expect.objectContaining({ examId: 'exam-1' })));
  });

  it('keeps the edits after a failed save; saving again still maps the newly ticked lecture', async () => {
    const { ExamApiError } = await import('../api/exams');
    mocks.loadExamBundle.mockResolvedValue(savedBundle());
    // The first attempt attached the lecture and then failed, so the second has nothing left to attach.
    mocks.saveExamEdits
      .mockRejectedValueOnce(new ExamApiError('Экзамен не сохранён. Проверьте связь и повторите.'))
      .mockResolvedValueOnce({ questionIds: ['q1', 'q2', 'q3'], needsMapping: [], materialsChanged: false });
    renderEditor('/exams/exam-1/edit#lectures');
    const list = await screen.findByRole('list', { name: 'Лекции для экзамена' });
    fireEvent.click(within(list).getByRole('checkbox', { name: /Лекция 3/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и разметить' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Экзамен не сохранён. Проверьте связь и повторите.');
    expect(mocks.startMapping).not.toHaveBeenCalled();
    const again = screen.getByRole('button', { name: 'Сохранить и разметить' });
    expect(again).toBeEnabled();
    expect(within(list).getByRole('checkbox', { name: /Лекция 3/ })).toBeChecked();

    fireEvent.click(again);
    await waitFor(() => expect(mocks.saveExamEdits).toHaveBeenCalledTimes(2));
    const [second] = mocks.saveExamEdits.mock.calls[1] as [{ draft: ExamDraft }];
    expect(second.draft.materialIds.sort()).toEqual(['m1', 'm2']);
    await waitFor(() => expect(mocks.startMapping).toHaveBeenCalledWith(expect.objectContaining({ examId: 'exam-1' })));
    expect(await screen.findByRole('heading', { name: 'Лист экзамена' })).toBeInTheDocument();
  });

  it('cannot be changed while the mapping runs, but a lock older than five minutes is stale', async () => {
    mocks.loadExamBundle.mockResolvedValue(savedBundle({ mapping_state: 'running', mapping_started_at: new Date().toISOString() }));
    renderEditor('/exams/exam-1/edit');
    expect(await screen.findAllByText('Идёт разметка — список можно будет изменить, когда она закончится.')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    cleanup();

    mocks.loadExamBundle.mockResolvedValue(
      savedBundle({ mapping_state: 'running', mapping_started_at: new Date(Date.now() - 10 * 60_000).toISOString() }),
    );
    renderEditor('/exams/exam-1/edit');
    await screen.findByText(/В списке 3 вопроса/);
    expect(screen.queryByText('Идёт разметка — список можно будет изменить, когда она закончится.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
  });

  it('deletes the exam after a confirmation', async () => {
    mocks.loadExamBundle.mockResolvedValue(savedBundle());
    mocks.deleteExam.mockResolvedValue(undefined);
    renderEditor('/exams/exam-1/edit');
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить экзамен' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Удалить экзамен?', type: 'danger' })));
    // Spoken and typed answers count the same: the confirmation says «Ответы», not «Ответы вслух».
    const [options] = mocks.confirm.mock.calls[0] as [{ message: string }];
    expect(options.message).toBe('«Макроэкономика» и разметка его вопросов будут удалены. Ответы останутся в истории и в «Прогрессе».');
    expect(options.message).not.toMatch(/вслух/);
    await waitFor(() => expect(mocks.deleteExam).toHaveBeenCalledWith('exam-1'));
    expect(await screen.findByRole('heading', { name: 'Список экзаменов' })).toBeInTheDocument();
  });

  it('keeps the stored layout of an exam, even where the list would suggest another one', async () => {
    const sectioned = [
      savedQuestion('q1', 1, 'Предмет и метод.', { section: 1 }),
      savedQuestion('q2', 2, 'Инфляция.', { section: 1 }),
      savedQuestion('q3', 3, 'Рынок труда.', { section: 2 }),
      savedQuestion('q4', 4, 'Деньги.', { section: 2 }),
    ];
    mocks.loadExamBundle.mockResolvedValue({
      ...savedBundle({ ticket_layout: { mode: 'random', per_ticket: 2, section_titles: ['Введение', 'Деньги и труд'] } }),
      questions: sectioned,
    });
    renderEditor('/exams/exam-1/edit');
    await screen.findByText(/В списке 4 вопроса, 2 раздела/);
    // Two sections and two questions per ticket would default to sections, but the exam stored random tickets.
    expect(screen.getByRole('combobox', { name: 'Как составлены билеты' })).toHaveValue('random');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(mocks.saveExamEdits).toHaveBeenCalledTimes(1));
    expect((mocks.saveExamEdits.mock.calls[0] as [{ draft: ExamDraft }])[0].draft).toMatchObject({ layoutMode: 'random', perTicket: 2 });
    cleanup();

    mocks.loadExamBundle.mockResolvedValue({
      ...savedBundle({ ticket_layout: { mode: 'sections', per_ticket: 2, section_titles: ['Введение', 'Деньги и труд'] } }),
      questions: sectioned,
    });
    renderEditor('/exams/exam-1/edit');
    await screen.findByText(/В списке 4 вопроса, 2 раздела/);
    expect(screen.getByRole('combobox', { name: 'Как составлены билеты' })).toHaveValue('sections');
  });

  it('keeps the exam when the deletion is cancelled', async () => {
    mocks.loadExamBundle.mockResolvedValue(savedBundle());
    mocks.confirm.mockResolvedValue(false);
    renderEditor('/exams/exam-1/edit');
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить экзамен' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.deleteExam).not.toHaveBeenCalled();
  });

  it('opens the lecture list from «Лекции» on the sheet', async () => {
    mocks.loadExamBundle.mockResolvedValue(savedBundle());
    renderEditor('/exams/exam-1/edit#lectures');
    expect(await screen.findByRole('list', { name: 'Лекции для экзамена' })).toBeInTheDocument();
  });
});
