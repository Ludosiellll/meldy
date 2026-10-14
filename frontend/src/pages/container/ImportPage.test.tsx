import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import twoSubjects from '../../../../contracts/container/parse_bank_two_subjects.json';
import openList from '../../../../contracts/container/parse_bank_open.json';
import summaryJson from '../../../../contracts/container/summary.json';
import itemsJson from '../../../../contracts/container/items_page.json';
import type { BankItem, BankParseResult, ContainerSummary, ContainersOverview, TestItem } from '../../types/container';

const api = vi.hoisted(() => {
  class ContainerApiError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    ContainerApiError,
    parseBank: vi.fn(),
    createContainer: vi.fn(),
    addSubject: vi.fn(),
    addItems: vi.fn(),
    saveSettings: vi.fn(),
    createExam: vi.fn(),
    parseQuestionList: vi.fn(),
    feasibility: vi.fn(),
    windowDays: vi.fn(),
    fetchOldExams: vi.fn(),
    loadOralPlanItems: vi.fn(),
    overview: { data: null as ContainersOverview | null },
    // «Обновить из файла»: the exam's data and the direct writes of a subject's topics.
    container: { summary: null as ContainerSummary | null, items: [] as TestItem[], error: null as string | null },
    subjectWrites: [] as Array<{ table: string; values: unknown; id: string }>,
  };
});

vi.mock('../../api/containers', () => ({
  ContainerApiError: api.ContainerApiError,
  containerError: (error: unknown) => error,
  parseBank: api.parseBank,
  createContainer: api.createContainer,
  addSubject: api.addSubject,
  addItems: api.addItems,
  saveSettings: api.saveSettings,
}));
vi.mock('../../api/exams', () => ({
  createExam: api.createExam,
  parseQuestionList: api.parseQuestionList,
  examErrorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
// The rest of the plan module stays real («Все вопросы»: ALL_QUESTIONS_MIN, allQuestions, planDay).
vi.mock('../../lib/containers/plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/containers/plan')>()),
  feasibility: api.feasibility,
  windowDays: api.windowDays,
}));
vi.mock('../../lib/containers/hooks', () => ({
  useContainersOverview: () => ({ data: api.overview.data, loading: false, offline: false, unavailable: false, error: null, reload: () => undefined }),
  useContainerData: (id: string) => ({
    data:
      id && api.container.summary
        ? { summary: api.container.summary, items: new Map(api.container.items.map((entry) => [entry.id, entry])), planInput: null, oralWithoutPoints: 0 }
        : null,
    loading: false,
    offline: false,
    unavailable: false,
    error: id ? api.container.error : null,
    reload: () => undefined,
  }),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (values: unknown) => ({
        eq: (_column: string, id: string) => ({
          select: async () => {
            api.subjectWrites.push({ table, values, id });
            return { data: [{ id }], error: null, status: 200 };
          },
        }),
      }),
    }),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../../components/containers/import/targets', async () => {
  const actual = await vi.importActual<typeof import('../../components/containers/import/targets')>('../../components/containers/import/targets');
  return { ...actual, fetchOldExams: api.fetchOldExams };
});
vi.mock('../../lib/containers/oralPlan', () => ({ loadOralPlanItems: api.loadOralPlanItems }));

import ImportPage from './ImportPage';
import { GUIDE_LATER_KEY } from '../../components/guide/guideLater';
import { IMPORT, PARSE_ERRORS, QUEUE } from '../../components/containers/copyImport';

const TWO = twoSubjects as unknown as BankParseResult;
const OPEN = openList as unknown as BankParseResult;

let where = '';
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}${location.hash}`;
  return null;
}

function renderAt(path = '/exams/import') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams/import" element={<ImportPage />} />
        <Route path="/exams/c/:id" element={<p>Экзамен открыт</p>} />
        <Route path="/exams/c/:id/s/:subjectId" element={<p>Предмет открыт</p>} />
        <Route path="/exams/c/:id/keys" element={<p>Ключи открыты</p>} />
        <Route path="/exams/:id/edit" element={<p>Редактор устного экзамена</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

function upload(names: string[]) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  const files = names.map((name) => new File(['синтетический банк'], name, { type: 'application/octet-stream' }));
  fireEvent.change(input, { target: { files } });
}

function item(position: number, patch: Partial<BankItem> = {}): BankItem {
  return {
    position,
    label: String(position),
    subject: 1,
    topic: 1,
    kind: 'single',
    text: `Вопрос ${position}?`,
    options: ['один', 'два', 'три'],
    correct: [0],
    order: [],
    pairs: [],
    answer: null,
    evidence: 'bold',
    flags: [],
    code: false,
    where: '',
    marks: { bold: [1, 0, 0] },
    ...patch,
  };
}

function bank(items: BankItem[], title: string | null = 'Гражданское право'): BankParseResult {
  return {
    ...TWO,
    subjects: [{ index: 1, title, evidence: title ? 'heading' : 'none', items: items.length }],
    topics: [{ index: 1, title: 'Раздел 1', subject: 1, items: items.length }],
    items,
    warnings: [],
    key_source: { bold: items.length },
    stats: { ...TWO.stats, items: items.length },
  };
}

const saveButton = () => screen.getByRole('button', { name: /^(Сохранить|Сохраняем…|Добавить \d)/ });
/** Text with its no-break spaces read as spaces; a name or label matcher of that text. */
const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ');
const nm = (text: string) => (content: string) => plain(content) === text;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  where = '';
  api.overview.data = null;
  api.parseBank.mockReset();
  api.createContainer.mockReset().mockResolvedValue({
    container_id: 'c-1',
    subjects: [
      { id: 's-1', position: 1, title: 'one' },
      { id: 's-2', position: 2, title: 'two' },
      { id: 's-3', position: 3, title: 'three' },
    ],
  });
  api.addSubject.mockReset().mockImplementation(async (_id: string, subject: { title: string }) => ({ id: `added-${subject.title}`, position: 9, title: subject.title }));
  api.addItems.mockReset().mockResolvedValue([]);
  api.saveSettings.mockReset().mockResolvedValue(undefined);
  api.createExam.mockReset().mockImplementation(async (_user: string, draft: { title: string }) => ({ examId: `oral-${draft.title}`, questionIds: [] }));
  api.parseQuestionList.mockReset();
  api.feasibility.mockReset().mockReturnValue({ neededMin: 45, option: 45, seenByDateEst: 10_000 });
  api.windowDays.mockReset().mockReturnValue(4);
  api.fetchOldExams.mockReset().mockResolvedValue([]);
  api.loadOralPlanItems.mockReset().mockResolvedValue([]);
  api.container.summary = null;
  api.container.items = [];
  api.container.error = null;
  api.subjectWrites = [];
});
afterEach(() => cleanup());

describe('ImportPage: one door for every file', () => {
  it('defers the guide synchronously and offers files, text and the formats', () => {
    renderAt();
    expect(window.sessionStorage.getItem(GUIDE_LATER_KEY)).toBe('1');
    expect(screen.getByRole('heading', { level: 1, name: 'Новый экзамен' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выбрать файлы' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вставить список текстом' })).toBeInTheDocument();
    expect(screen.getByText(/PDF и сканы — для списков без вариантов/)).toBeInTheDocument();
  });

  it('reads a file of two subjects, previews them and saves one exam with both (items, topics, minutes)', async () => {
    api.parseBank.mockResolvedValue(TWO);
    renderAt();
    upload(['Тесты_две_дисциплины.docx']);
    expect(await screen.findByRole('heading', { name: /Нашли 2\sпредмета и 18\sвопросов/ })).toBeInTheDocument();
    expect(api.parseBank).toHaveBeenCalledWith(expect.objectContaining({ format: 'auto' }));
    expect(screen.getByText('Основы программирования')).toBeInTheDocument();
    expect(screen.getByText(/12\sвопросов\s· ключ жирным/)).toBeInTheDocument();
    expect(screen.getByLabelText('Название')).toHaveValue('Основы программирования и История Беларуси');

    fireEvent.click(saveButton());
    await waitFor(() => expect(where).toBe('/exams/c/c-1'));
    expect(api.createContainer).toHaveBeenCalledWith('Основы программирования и История Беларуси', null, [
      expect.objectContaining({ title: 'Основы программирования', exam_id: null, topics: expect.arrayContaining(['Тема 3. Строки']) }),
      expect.objectContaining({ title: 'История Беларуси', exam_id: null, topics: ['Раздел 1. Древняя Русь', 'Раздел 2. ВКЛ'] }),
    ]);
    expect(api.addItems).toHaveBeenCalledTimes(2);
    const [subjectId, items] = api.addItems.mock.calls[0];
    expect(subjectId).toBe('s-1');
    expect(items).toHaveLength(12);
    expect(items[0]).toMatchObject({ file_no: '1', topic: 1, key_source: 'bold', kind: 'single' });
    expect(items[0].ref).toMatch(/^imp-[a-z0-9]+-[a-z0-9]+:1$/);
    expect(api.addItems.mock.calls[1][1]).toHaveLength(6);
    expect(api.saveSettings).toHaveBeenCalledWith('c-1', { minutes_per_day: 60, study_weekdays: 127, tempo: 'date' });
    expect(api.createExam).not.toHaveBeenCalled();
  });

  it('«Как можно быстрее» needs no date: the line says when all are seen, the «по 15 в день» note goes, the tempo is saved', async () => {
    api.parseBank.mockResolvedValue(TWO);
    renderAt();
    upload(['Тесты_две_дисциплины.docx']);
    expect(await screen.findByRole('heading', { name: /Нашли 2\sпредмета и 18\sвопросов/ })).toBeInTheDocument();
    expect(screen.getByText(/Без даты|Дату можно не указывать/)).toBeInTheDocument();
    expect(screen.queryByText(/вы увидите/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Новые вопросы' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Как можно быстрее' }));
    expect(screen.getByText(/^При 60\sминутах в\sдень все 18\sвопросов вы увидите (сегодня|завтра)\./)).toBeInTheDocument();
    expect(screen.queryByText(/Дату можно не указывать/)).not.toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(where).toBe('/exams/c/c-1'));
    expect(api.saveSettings).toHaveBeenCalledWith('c-1', { minutes_per_day: 60, study_weekdays: 127, tempo: 'fast' });
  });

  it('makes a single oral list today’s oral exam and goes on to its lectures (decision 21)', async () => {
    api.parseBank.mockResolvedValue(OPEN);
    renderAt();
    upload(['Вопросы_к_экзамену.docx']);
    await screen.findByRole('heading', { name: /Нашли 7\sвопросов/ });
    expect(screen.getByText(/7\sустных вопросов/)).toBeInTheDocument();
    expect(screen.queryByText('Время в день')).not.toBeInTheDocument();
    expect(screen.getByText(IMPORT.nextLectures)).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(where).toBe('/exams/oral-Основы программирования/edit#lectures'));
    const [userId, draft] = api.createExam.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(draft).toMatchObject({ title: 'Основы программирования', kind: 'exam', layoutMode: 'random', sectionTitles: ['Раздел 1. Язык C#', 'Раздел 2. События и делегаты'] });
    expect(draft.questions).toHaveLength(7);
    expect(draft.questions[4]).toMatchObject({ section: 2, id: null });
    expect(api.createContainer).not.toHaveBeenCalled();
  });

  it('splits more than 150 open questions into parts and saves each as an oral exam inside one exam (decision 5)', async () => {
    const items = [
      ...Array.from({ length: 10 }, (_, index) => item(index + 1)),
      ...Array.from({ length: 200 }, (_, index) => item(index + 11, { kind: 'open', options: [], correct: [], evidence: '', marks: {} })),
    ];
    api.parseBank.mockResolvedValue(bank(items));
    renderAt();
    upload(['Право.docx']);
    await screen.findByRole('heading', { name: /Нашли 2\sпредмета/ });
    expect(screen.getByText('Гражданское право, часть 1')).toBeInTheDocument();
    expect(screen.getByText('Гражданское право, часть 2')).toBeInTheDocument();
    expect(screen.getByText(/вопросы 151–200/)).toBeInTheDocument();
    expect(screen.getByText(/помещается 150 — разделили на 2\sчасти/)).toBeInTheDocument();

    fireEvent.click(saveButton());
    await waitFor(() => expect(where).toBe('/exams/c/c-1'));
    expect(api.createExam).toHaveBeenCalledTimes(2);
    expect(api.createExam.mock.calls[0][1].questions).toHaveLength(150);
    expect(api.createExam.mock.calls[1][1].questions).toHaveLength(50);
    expect(api.createContainer).toHaveBeenCalledWith('Гражданское право, часть 1 и Гражданское право, часть 2', null, [
      expect.objectContaining({ title: 'Гражданское право, часть 1', exam_id: 'oral-Гражданское право, часть 1' }),
      expect.objectContaining({ title: 'Гражданское право, часть 2', exam_id: 'oral-Гражданское право, часть 2' }),
    ]);
    expect(api.addItems).toHaveBeenCalledTimes(1);
    expect(api.addItems.mock.calls[0][1]).toHaveLength(10);
  });

  it('says in Russian why a file did not open, and never blocks the others', async () => {
    api.parseBank.mockImplementation(async ({ file }: { file: File }) => {
      if (file.name.startsWith('Большой')) throw new api.ContainerApiError('too_many', 'too many items');
      if (file.name.startsWith('Сеть')) throw new api.ContainerApiError('network', 'Failed to fetch');
      return TWO;
    });
    renderAt();
    upload(['Сети.doc', 'Большой.docx', 'Сеть.docx', 'Хороший.docx']);
    await screen.findByRole('heading', { name: /Нашли 2\sпредмета/ });
    expect(screen.getByText(PARSE_ERRORS.old_doc)).toBeInTheDocument();
    expect(screen.getByText(PARSE_ERRORS.too_many)).toBeInTheDocument();
    expect(screen.getByText(PARSE_ERRORS.network)).toBeInTheDocument();
    // .doc is refused without a request; a network failure can be tried again.
    expect(api.parseBank).toHaveBeenCalledTimes(3);
    expect(screen.getAllByRole('button', { name: 'Попробовать ещё раз' })).toHaveLength(1);
    expect(screen.getByText(/Откройте его в Word или Google Документах и сохраните как DOCX/)).toBeInTheDocument();
  });

  it('only a missing name stops saving: the line says so and the field gets the cursor', async () => {
    api.parseBank.mockImplementation(async ({ file }: { file: File }) =>
      bank([item(1), item(2)], file.name.replace(/\.docx$/, '')),
    );
    renderAt();
    upload(['Сети.docx', 'Базы.docx', 'Право.docx']);
    await screen.findByRole('heading', { name: /Нашли 3\sпредмета/ });
    expect(screen.getByLabelText('Название')).toHaveValue('');
    fireEvent.click(saveButton());
    expect(await screen.findByText('Назовите экзамен.')).toBeInTheDocument();
    expect(screen.getByLabelText('Название')).toHaveFocus();
    expect(api.createContainer).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Зимняя сессия' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.createContainer).toHaveBeenCalledWith('Зимняя сессия', null, expect.any(Array)));
  });

  it('walks the problem queue: «Верны оба», a lost image confirmed, a key tapped; the save carries the fixes', async () => {
    const items = [
      item(1, { correct: [0, 2], flags: ['several_marked'] }),
      item(2, { flags: ['has_image'] }),
      item(3, { correct: [], evidence: '', flags: ['no_key'] }),
      item(4),
    ];
    api.parseBank.mockResolvedValue(bank(items, 'Сети'));
    renderAt();
    upload(['Сети.docx']);
    await screen.findByRole('heading', { name: /Нашли 4\sвопроса/ });
    expect(screen.getByText(/Проверьте 3\sвопроса — можно и после сохранения/)).toBeInTheDocument();
    expect(screen.getByText(/Картинка в №\s2 не перенеслась/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));

    expect(await screen.findByText('В файле выделены два ответа: А и В.')).toBeInTheDocument();
    expect(screen.getByText(/1 из 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Верны оба' }));
    expect(await screen.findByText(QUEUE.image)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: QUEUE.imageOk }));
    expect(await screen.findByText(QUEUE.noKey)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Б\.\s?два/ }));
    expect(await screen.findByText('Проверили 3 из 3.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    await screen.findByRole('heading', { name: /Нашли 4\sвопроса/ });
    expect(screen.queryByText(/Проверьте/)).not.toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.addItems).toHaveBeenCalled());
    const saved = api.addItems.mock.calls[0][1];
    expect(saved[0]).toMatchObject({ kind: 'multiple', correct: [0, 2], key_source: 'manual' });
    expect(saved[1]).toMatchObject({ correct: [0], key_source: 'bold' });
    expect(saved[1].flags).not.toContain('has_image');
    expect(saved[2]).toMatchObject({ correct: [1], key_source: 'manual' });
  });

  it('a file without keys asks one question: paste the key, mark as you go, or read as oral (decision 34)', async () => {
    const noKey = bank([item(1, { correct: [], evidence: '', flags: ['no_key'] }), item(2, { correct: [], evidence: '', flags: ['no_key'] })], 'ОС');
    api.parseBank.mockImplementation(async ({ format, keyText }: { format: string; keyText?: string }) => {
      if (format === 'open') return OPEN;
      if (keyText) return bank([item(1, { evidence: 'key_text' }), item(2, { evidence: 'key_text' })], 'ОС');
      return noKey;
    });
    renderAt();
    upload(['ОС.docx']);
    await screen.findByText(IMPORT.noKeyTitle);
    expect(screen.queryByText(/Проверьте/)).not.toBeInTheDocument();
    expect(screen.getByText(/2\sвопроса\s· ключа нет/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: IMPORT.noKeyLater }));
    expect(await screen.findByText(/Проверьте 2\sвопроса/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ОС/ }));
    fireEvent.click(await screen.findByRole('button', { name: IMPORT.otherWay }));
    fireEvent.change(await screen.findByLabelText(IMPORT.keyListLabel), { target: { value: '1 – а, 2 – а' } });
    fireEvent.click(screen.getByRole('button', { name: IMPORT.keyListGo }));
    await waitFor(() => expect(api.parseBank).toHaveBeenLastCalledWith(expect.objectContaining({ keyText: '1 – а, 2 – а', format: 'auto' })));
    expect(await screen.findByText('Ключ подошёл к 2 из 2.')).toBeInTheDocument();
  });

  it('«Ключ в другом файле»: the key file goes with the questions; when no variant fits, the student picks one (owner, 2026-10-14)', async () => {
    const noKey = bank([item(1, { correct: [], evidence: '', flags: ['no_key'] }), item(2, { correct: [], evidence: '', flags: ['no_key'] })], 'ТРПО');
    const sections = [
      { title: 'КЛЮЧ ОТВЕТОВ — ВАРИАНТ 4', variant: 4, count: 160 },
      { title: 'КЛЮЧ ОТВЕТОВ — ВАРИАНТ 5', variant: 5, count: 160 },
    ];
    api.parseBank.mockImplementation(async ({ keyFile, keySection }: { keyFile?: File; keySection?: number | null }) => {
      if (!keyFile) return noKey;
      if (typeof keySection !== 'number') {
        return {
          ...noKey,
          key_file: { sections, used: null },
          warnings: [{ code: 'key_file_variant', message: 'В файле ключа нет варианта 1, есть: 4, 5. Выберите нужный.' }],
        };
      }
      return { ...bank([item(1, { evidence: 'key_text' }), item(2, { evidence: 'key_text' })], 'ТРПО'), key_file: { sections, used: keySection } };
    });
    renderAt();
    upload(['Вариант 1.docx']);
    await screen.findByText(IMPORT.noKeyTitle);
    const pick = screen.getByRole('button', { name: IMPORT.noKeyFile });
    const input = pick.nextElementSibling as HTMLInputElement;
    expect(input.accept).toContain('.docx');
    fireEvent.change(input, { target: { files: [new File(['ключ'], 'Ключ 4 5 6.docx')] } });
    await waitFor(() => expect(api.parseBank).toHaveBeenLastCalledWith(expect.objectContaining({ keySection: null })));
    expect((api.parseBank.mock.lastCall?.[0] as { keyFile: File }).keyFile.name).toBe('Ключ 4 5 6.docx');
    expect(await screen.findByText('В файле ключа нет варианта 1, есть: 4, 5. Выберите нужный.')).toBeInTheDocument();
    expect(screen.getByText(IMPORT.keyFileChoose)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: nm('Вариант 5 · 160 ответов') }));
    await waitFor(() => expect(api.parseBank).toHaveBeenLastCalledWith(expect.objectContaining({ keySection: 1 })));
    await waitFor(() => expect(screen.queryByText(IMPORT.noKeyTitle)).not.toBeInTheDocument());
  });

  it('«Это устные вопросы» reads the file again as an oral list', async () => {
    api.parseBank.mockImplementation(async ({ format }: { format: string }) =>
      format === 'open' ? OPEN : bank([item(1, { correct: [], evidence: '', flags: ['no_key'] })], 'ОС'),
    );
    renderAt();
    upload(['ОС.docx']);
    fireEvent.click(await screen.findByRole('button', { name: IMPORT.noKeyOral }));
    await waitFor(() => expect(api.parseBank).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'open' })));
    expect(await screen.findByText(/7\sустных вопросов/)).toBeInTheDocument();
  });

  it('adds subjects to an existing exam from «Добавить предмет» (?from=c:<id>): no name, no date, no minutes', async () => {
    api.overview.data = {
      v: 1,
      day: '2026-10-10',
      attached_exam_ids: [],
      containers: [
        { id: 'box-7', title: 'Зимняя сессия', exam_date: '2027-01-12', created_at: '', role: 'owner', items: 100, items_updated_at: null, subjects: [], answers_today: 0, settings: null },
      ],
    };
    api.parseBank.mockResolvedValue(TWO);
    renderAt('/exams/import?from=c:box-7');
    expect(screen.getByRole('heading', { level: 1, name: 'Добавить предмет' })).toBeInTheDocument();
    upload(['Две.docx']);
    await screen.findByRole('heading', { name: /Нашли 2\sпредмета/ });
    expect(screen.queryByLabelText('Название')).not.toBeInTheDocument();
    expect(screen.queryByText('Время в день')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Добавить 2\sпредмета$/ }));
    await waitFor(() => expect(where).toBe('/exams/c/box-7'));
    expect(api.addSubject).toHaveBeenCalledTimes(2);
    expect(api.addSubject.mock.calls[0]).toEqual(['box-7', expect.objectContaining({ title: 'Основы программирования', exam_date: null })]);
    expect(api.addItems.mock.calls.map((call) => call[0])).toEqual(['added-Основы программирования', 'added-История Беларуси']);
    expect(api.createContainer).not.toHaveBeenCalled();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it('«Куда добавить: к «Микроэкономика»» makes the old exam subject 1 of a new exam (decision 22)', async () => {
    api.fetchOldExams.mockResolvedValue([{ id: 'old-9', title: 'Микроэкономика', exam_date: '2026-10-21', questions: 30, created_at: '2026-10-01T12:00:00Z' }]);
    api.parseBank.mockResolvedValue(bank([item(1), item(2)], 'Статистика'));
    renderAt();
    upload(['Статистика.docx']);
    await screen.findByRole('heading', { name: /Нашли 2\sвопроса/ });
    fireEvent.click(await screen.findByRole('combobox', { name: 'Куда добавить' }));
    fireEvent.click(await screen.findByRole('option', { name: 'К «Микроэкономика»' }));
    // The label names the oral exam and counts the rows shown (one subject from the file).
    expect(screen.getByLabelText(nm('В экзамене будут «Микроэкономика» и ещё 1 предмет. Название'))).toHaveValue('Микроэкономика и Статистика');
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.createContainer).toHaveBeenCalled());
    expect(api.createContainer).toHaveBeenCalledWith('Микроэкономика и Статистика', '2026-10-21', [
      { title: 'Микроэкономика', exam_id: 'old-9' },
      expect.objectContaining({ title: 'Статистика', exam_id: null }),
    ]);
    expect(api.addItems.mock.calls[0][0]).toBe('s-2');
  });

  it('a failed save keeps what was saved and goes on from there when pressed again', async () => {
    api.parseBank.mockResolvedValue(TWO);
    api.addItems.mockRejectedValueOnce(new api.ContainerApiError('network', 'Failed to fetch')).mockResolvedValue([]);
    renderAt();
    upload(['Две.docx']);
    await screen.findByRole('heading', { name: /Нашли 2\sпредмета/ });
    fireEvent.click(saveButton());
    expect(await screen.findByText(IMPORT.saveRetry)).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() => expect(where).toBe('/exams/c/c-1'));
    expect(api.createContainer).toHaveBeenCalledTimes(1);
    expect(api.addItems).toHaveBeenCalledTimes(3);
  });

  it('says under the minutes what they need by the date, and what they reach when they fall short', async () => {
    // The draft's «today» is the device's: a fixed day keeps the date ahead whenever the test runs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T09:00:00Z'));
    try {
      api.feasibility.mockImplementation((input: { budgetMin: number }) => ({
        neededMin: 72,
        option: 90,
        seenByDateEst: input.budgetMin === 45 ? 14 : 18,
      }));
      api.parseBank.mockResolvedValue(TWO);
      renderAt();
      upload(['Две.docx']);
      await screen.findByRole('heading', { name: /Нашли 2\sпредмета/ });
      expect(screen.queryByText(/Чтобы увидеть все/)).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Дата экзамена'), { target: { value: '2026-10-28' } });
      // With a date the minutes start at the smallest option that is enough.
      expect(await screen.findByText(/^Чтобы увидеть все 18\sвопросов к 28\sоктября, нужно около 75\sминут в день\./)).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Время в день' })).toHaveTextContent(/90\sминут/);
      fireEvent.click(screen.getByRole('combobox', { name: 'Время в день' }));
      fireEvent.click(await screen.findByRole('option', { name: /^45\sминут$/ }));
      expect(
        await screen.findByText(/При 45\sминутах к 28\sоктября вы увидите около 14 из 18\. Чтобы увидеть все, нужно около 75\sминут\./),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Подробнее' }));
      expect(screen.getByText(/С 24\sоктября новых вопросов не будет: последние 4\sдня — только знакомые, сначала ошибки\./)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads pasted text as a file', async () => {
    api.parseBank.mockResolvedValue(TWO);
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Вставить список текстом' }));
    fireEvent.click(screen.getByRole('button', { name: 'Разобрать' }));
    expect(screen.getByText(IMPORT.pasteEmpty)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Список вопросов'), { target: { value: '1. Вопрос?\nа) да\nб) нет' } });
    fireEvent.click(screen.getByRole('button', { name: 'Разобрать' }));
    await screen.findByRole('heading', { name: /Нашли 2\sпредмета/ });
    expect(api.parseBank).toHaveBeenCalledWith(expect.objectContaining({ text: '1. Вопрос?\nа) да\nб) нет', file: undefined }));
  });

  it('opens one subject: where the name came from, the numbers, the topics; renames and removes it', async () => {
    api.parseBank.mockResolvedValue(TWO);
    renderAt();
    upload(['Две.docx']);
    await screen.findByRole('heading', { name: /Нашли 2\sпредмета/ });
    fireEvent.click(screen.getByRole('button', { name: /История Беларуси/ }));
    const detail = await screen.findByRole('region', { name: 'История Беларуси' });
    expect(within(detail).getByText('из заголовка в файле')).toBeInTheDocument();
    expect(within(detail).getByText(/Ответ выделен жирным в 6 из 6\./)).toBeInTheDocument();
    expect(within(detail).getByText('Раздел 2. ВКЛ')).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole('button', { name: 'Переименовать' }));
    fireEvent.change(within(detail).getByLabelText('Название предмета'), { target: { value: 'История' } });
    fireEvent.click(within(detail).getByRole('button', { name: 'Готово' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'История' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Убрать предмет' }));
    await screen.findByRole('heading', { name: /Нашли 12\sвопросов/ });
    expect(screen.getByText(/Убрано: 1\sпредмет/)).toBeInTheDocument();
  });
});

describe('ImportPage: «Обновить из файла» of one subject (?from=c:<id>&subject=<id>, Concept 1 §3.4)', () => {
  const SUMMARY = summaryJson as unknown as ContainerSummary;
  const CID = SUMMARY.id;
  const SUBJECT = SUMMARY.subjects[0];
  const SAVED = (itemsJson as unknown as TestItem[]).filter((entry) => entry.subject_id === SUBJECT.id);
  const AT = `/exams/import?from=c:${CID}&subject=${SUBJECT.id}`;

  /** A saved question as the newer file has it again. */
  const again = (saved: TestItem, patch: Partial<BankItem> = {}) =>
    item(saved.position, {
      label: saved.file_no,
      topic: saved.topic,
      text: saved.stem,
      options: [...saved.options],
      correct: [...saved.correct],
      marks: { bold: saved.options.map((_, index) => (saved.correct.includes(index) ? 1 : 0)) },
      ...patch,
    });
  const newer = (items: BankItem[]): BankParseResult => ({
    ...bank(items, null),
    topics: [
      { index: 1, title: 'Тема 1. Директивы и пространства имён', subject: 1, items: 4 },
      { index: 2, title: 'Тема 2. Делегаты и события', subject: 1, items: 4 },
      { index: 3, title: 'Тема 3. Строки', subject: 1, items: 4 },
      { index: 4, title: 'Тема 4. Коллекции', subject: 1, items: 1 },
    ],
  });

  beforeEach(() => {
    api.container.summary = SUMMARY;
    api.container.items = SAVED;
  });

  it('adds only the new questions, keeps the saved ones and their keys, and lists a key that differs by number', async () => {
    api.parseBank.mockResolvedValue(
      newer([
        ...SAVED.slice(0, 11).map((saved, index) => (index === 6 ? again(saved, { correct: [0], marks: { bold: [1, 0, 0, 0] } }) : again(saved))),
        item(13, { label: '13', topic: 4, text: 'Какая коллекция хранит пары «ключ — значение»?', options: ['List<T>', 'Dictionary<TKey, TValue>', 'Queue<T>', 'Stack<T>'], correct: [1], marks: { bold: [0, 1, 0, 0] } }),
      ]),
    );
    renderAt(AT);
    expect(screen.getByRole('heading', { level: 1, name: 'Обновить из файла' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: SUBJECT.title })).toHaveAttribute('href', `/exams/c/${CID}/s/${SUBJECT.id}`);
    expect(screen.getByText(IMPORT.updateLede(SUBJECT.title))).toBeInTheDocument();
    upload(['Программирование v2.docx']);
    const rows = await screen.findByRole('list', { name: SUBJECT.title });
    const count = (label: string) => within(rows).getByText(label).nextElementSibling?.textContent;
    expect(count(IMPORT.updateRowNew)).toBe('1');
    expect(count(IMPORT.updateRowSame)).toBe('11');
    expect(count(IMPORT.updateRowKey)).toBe('1');
    expect(count(IMPORT.updateRowGone)).toBe('1');
    expect(screen.getByText(IMPORT.updateKeyLine)).toBeInTheDocument();
    expect(screen.getByText(/^№\s7: в файле А, сейчас Б$/)).toBeInTheDocument();
    // No name, date or minutes: the subject is there already.
    expect(screen.queryByLabelText('Название')).not.toBeInTheDocument();
    expect(screen.queryByText('Время в день')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Добавить 1\sвопрос$/ }));
    await waitFor(() => expect(where).toBe(`/exams/c/${CID}/s/${SUBJECT.id}`));
    expect(api.subjectWrites).toEqual([{ table: 'container_subjects', values: { topics: [...SUBJECT.topic_titles, 'Тема 4. Коллекции'] }, id: SUBJECT.id }]);
    expect(api.addItems).toHaveBeenCalledTimes(1);
    const [subjectId, inputs] = api.addItems.mock.calls[0] as [string, Array<{ ref: string; stem: string; topic: number; correct: number[] }>];
    expect(subjectId).toBe(SUBJECT.id);
    expect(inputs.map((input) => [input.ref.replace(/^imp-[a-z0-9]+-[a-z0-9]+/, 'imp'), input.topic, input.correct])).toEqual([['imp:13', 4, [1]]]);
    expect(api.addSubject).not.toHaveBeenCalled();
    expect(api.createContainer).not.toHaveBeenCalled();
  });

  it('with nothing new says so; a differing key is the next thing to look at, in «Ключи»', async () => {
    api.parseBank.mockResolvedValue(newer(SAVED.map((saved, index) => (index === 6 ? again(saved, { correct: [0], marks: { bold: [1, 0, 0, 0] } }) : again(saved)))));
    renderAt(AT);
    upload(['Программирование.docx']);
    expect(await screen.findByText(IMPORT.updateNothing)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: IMPORT.updateToKeys }));
    await waitFor(() => expect(where).toBe(`/exams/c/${CID}/keys?s=${SUBJECT.id}&no=7`));
    expect(api.addItems).not.toHaveBeenCalled();
    expect(api.subjectWrites).toEqual([]);
  });

  it('only the author adds questions from a file; a subject that is gone is said so', () => {
    api.container.summary = { ...SUMMARY, role: 'member', owner: null };
    renderAt(AT);
    expect(screen.getByText(IMPORT.updateAuthorOnly)).toBeInTheDocument();
    expect(document.querySelector('input[type=file]')).toBeNull();
    cleanup();
    api.container.summary = SUMMARY;
    renderAt(`/exams/import?from=c:${CID}&subject=no-such-subject`);
    expect(screen.getByText(IMPORT.updateNotFound)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: IMPORT.updateToExam })).toHaveAttribute('href', `/exams/c/${CID}`);
  });
});

describe('ImportPage: an oral exam the student has joins an exam (usability check 2026-10-10, m4)', () => {
  // Two copies of one oral list, made on different days, and another oral exam without a date.
  const twins = [
    { id: 'db-new', title: 'Базы данных', exam_date: '2026-10-21', questions: 20, created_at: '2026-10-09T12:00:00Z' },
    { id: 'db-old', title: 'Базы данных', exam_date: '2026-10-21', questions: 20, created_at: '2026-10-07T12:00:00Z' },
    { id: 'law', title: 'Гражданское право', exam_date: null, questions: 60, created_at: '2026-10-05T12:00:00Z' },
  ];
  const oralPart = (n: number) => ({
    examId: 'db-old',
    subjectId: 'old:db-old',
    items: Array.from({ length: n }, (_, i) => ({ id: `o${i}`, s: 'old:db-old', f: 'o' as const, tp: null, o: i + 1, l: [], m: { sc: null, rating: 0 as const, ac: null, prepared: false } })),
    withoutPoints: 20 - n,
    examDate: '2026-10-21',
  });
  const minutesLine = () =>
    Array.from(document.querySelectorAll('.im-hint')).map((node) => plain(node.textContent)).find((text) => text.startsWith('Чтобы') || text.startsWith('При')) ?? null;
  const box = (id: string, title: string, role: 'owner' | 'member') => ({
    id, title, exam_date: '2027-01-12', created_at: '', role, items: 100, items_updated_at: null, subjects: [], answers_today: 0, settings: null,
  });

  it('two oral exams of one name are told apart in «Куда добавить»: the date and the size, then the day made', async () => {
    api.fetchOldExams.mockResolvedValue(twins);
    api.parseBank.mockResolvedValue(TWO);
    renderAt();
    upload(['Две.docx']);
    await screen.findByRole('heading', { name: /Нашли 2\sпредмета/ });
    expect(api.fetchOldExams).toHaveBeenCalledWith('user-1');
    fireEvent.click(await screen.findByRole('combobox', { name: 'Куда добавить' }));
    const options = (await screen.findAllByRole('option')).map((option) => plain(option.textContent));
    expect(options).toEqual([
      'Новый экзамен',
      'К «Базы данных» · 21 октября · 20 вопросов · создан 9 октября',
      'К «Базы данных» · 21 октября · 20 вопросов · создан 7 октября',
      'К «Гражданское право»',
    ]);
  });

  it('chosen: it names the new exam, the label counts the rows shown, the minutes count its questions in the plan', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T09:00:00Z'));
    try {
      let read: (parts: unknown) => void = () => undefined;
      api.loadOralPlanItems.mockImplementation(() => new Promise((resolve) => (read = resolve)));
      api.fetchOldExams.mockResolvedValue(twins);
      api.feasibility.mockImplementation((input: { items: unknown[] }) => ({ neededMin: 20, option: 30, seenByDateEst: input.items.length }));
      api.parseBank.mockResolvedValue(TWO);
      renderAt();
      upload(['Две.docx']);
      await screen.findByRole('heading', { name: /Нашли 2\sпредмета и 18\sвопросов/ });
      fireEvent.click(await screen.findByRole('combobox', { name: 'Куда добавить' }));
      fireEvent.click(await screen.findByRole('option', { name: nm('К «Базы данных» · 21 октября · 20 вопросов · создан 7 октября') }));
      // The QA's form said «Теперь в экзамене 3 предмета» over 2 rows, with an empty name.
      expect(screen.getByLabelText(nm('В экзамене будут «Базы данных» и ещё 2 предмета. Название'))).toHaveValue('Базы данных');
      expect(document.querySelectorAll('.im-found-sec .im-row')).toHaveLength(2);
      expect(screen.getByLabelText('Дата экзамена')).toHaveValue('2026-10-21');
      expect(api.loadOralPlanItems).toHaveBeenCalledWith([{ examId: 'db-old', subjectId: 'old:db-old' }], expect.any(Number), expect.any(String));
      // While its questions are read the line waits: it would count only the file's.
      expect(minutesLine()).toBeNull();
      act(() => read([oralPart(16)]));
      // 18 from the file and 16 of its 20 in the plan; the exam will hold 38.
      await waitFor(() => expect(minutesLine()).toMatch(/^Чтобы увидеть все 34 вопроса в плане к 21 октября, нужно около 20 минут в день\./));
      fireEvent.click(saveButton());
      await waitFor(() => expect(api.createContainer).toHaveBeenCalled());
      expect(api.createContainer).toHaveBeenCalledWith('Базы данных', '2026-10-21', [
        { title: 'Базы данных', exam_id: 'db-old' },
        expect.objectContaining({ title: 'Основы программирования', exam_id: null }),
        expect.objectContaining({ title: 'История Беларуси', exam_id: null }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('«Добавить предмет» of an exam offers the oral exams outside any exam; a tap adds one as it is', async () => {
    api.overview.data = { v: 1, day: '2026-10-10', attached_exam_ids: ['db-new'], containers: [box('box-7', 'Зимняя сессия', 'owner')] };
    api.fetchOldExams.mockResolvedValue(twins);
    renderAt('/exams/import?from=c:box-7');
    const offer = await screen.findByRole('region', { name: 'Или устный экзамен, который уже есть' });
    // the one inside an exam already (db-new) is not offered
    expect(within(offer).getAllByRole('button').map((button) => plain(button.textContent))).toEqual([
      'Базы данныхустный · 21 октября · 20 вопросов',
      'Гражданское правоустный · дата не указана · 60 вопросов',
    ]);
    // the files keep the page's one blue button
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
    fireEvent.click(within(offer).getByRole('button', { name: /^Базы данных/ }));
    await waitFor(() => expect(where).toBe('/exams/c/box-7'));
    expect(api.addSubject).toHaveBeenCalledWith('box-7', { title: 'Базы данных', exam_id: 'db-old' });
    expect(api.createContainer).not.toHaveBeenCalled();
  });

  it('a refusal says why and keeps the offer; another student’s exam and a new exam have none', async () => {
    api.overview.data = { v: 1, day: '2026-10-10', attached_exam_ids: [], containers: [box('box-7', 'Зимняя сессия', 'owner'), box('box-8', 'Чужой', 'member')] };
    api.fetchOldExams.mockResolvedValue(twins);
    api.addSubject.mockRejectedValueOnce(new api.ContainerApiError('MC007', 'at most 20 subjects'));
    renderAt('/exams/import?from=c:box-7');
    const offer = await screen.findByRole('region', { name: 'Или устный экзамен, который уже есть' });
    fireEvent.click(within(offer).getByRole('button', { name: /^Гражданское право/ }));
    expect(await within(offer).findByRole('alert')).toHaveTextContent('В экзамене помещается 20 предметов');
    expect(where).toBe('/exams/import?from=c:box-7');
    expect(within(offer).getByRole('button', { name: /^Гражданское право/ })).not.toBeDisabled();
    cleanup();
    renderAt('/exams/import?from=c:box-8');
    await waitFor(() => expect(api.fetchOldExams).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: 'Или устный экзамен, который уже есть' })).toBeNull();
    cleanup();
    renderAt();
    expect(screen.queryByRole('region', { name: 'Или устный экзамен, который уже есть' })).toBeNull();
  });
});
