import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ExamBundle, ExamQuestion, ExamRow } from '../api/exams';
import type { SheetQuestion } from '../lib/exams/cheatSheet';

const mocks = vi.hoisted(() => ({
  loadExamBundle: vi.fn(),
  fetchSheet: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../api/exams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/exams')>();
  return { ...actual, loadExamBundle: mocks.loadExamBundle };
});
vi.mock('../api/cheatSheet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/cheatSheet')>();
  return { ...actual, fetchSheet: mocks.fetchSheet };
});
vi.mock('../lib/telemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/telemetry')>();
  return { ...actual, track: mocks.track };
});

import ExamReport from './ExamReport';
import { GRADE_LINE } from '../lib/exams/teacherReport';

// ------------------------------------------------------------------------------------ fixtures

/** The text as read: the no-break spaces of Russian typesetting are spaces. */
const plain = (element: Element | null) => (element?.textContent ?? '').replace(/\u00a0/g, ' ');

const MAPPED_AT = new Date(2026, 9, 7, 14, 2).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function question(n: number, coverage: ExamQuestion['coverage'], overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  const covered = coverage === 'full' || coverage === 'partial';
  return {
    id: uuid(n),
    exam_id: 'exam-1',
    position: n,
    label: String(n),
    section: null,
    text: `Вопрос ${n} о денежном рынке`,
    question_hash: n.toString(16).padStart(32, 'b'),
    coverage,
    coverage_method: coverage === null ? null : coverage === 'unverified' ? 'lexical' : 'llm',
    coverage_reason: coverage === 'full' ? 'Модель объясняет своими словами' : '',
    missing_note: coverage === 'partial' ? 'примеров из практики' : '',
    evidence: covered
      ? [{ material_id: 'm1', material_title: 'Денежный рынок', source_id: `S${n + 10}`, excerpt: `Текст лекции к вопросу ${n}: спрос на деньги.` }]
      : [],
    nearest: [],
    materials_fingerprint: 'fp',
    mapping_version: 1,
    mapped_at: coverage === null ? null : MAPPED_AT,
    created_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

function bundle(questions: ExamQuestion[], exam: Partial<ExamRow> = {}, materials = [{ id: 'm1', title: 'Денежный рынок' }, { id: 'm2', title: 'Инфляция' }]): ExamBundle {
  return {
    exam: {
      id: 'exam-1',
      title: 'Экзамен: макроэкономика',
      kind: 'exam',
      exam_date: '2027-01-24',
      source_kind: 'paste',
      source_text: '',
      ticket_layout: { mode: 'random', per_ticket: 2 },
      mapping_state: 'done',
      mapping_started_at: null,
      mapped_at: MAPPED_AT,
      mapped_material_ids: materials.map((item) => item.id),
      created_at: '2026-10-01T10:00:00Z',
      ...exam,
    },
    questions,
    materialIds: materials.map((item) => item.id),
    materials,
  };
}

function sheetOf(questions: ExamQuestion[], points: Record<number, Array<[string, boolean]>> = {}, job: unknown = null) {
  return {
    examId: 'exam-1',
    mappingState: 'done',
    toWrite: 0,
    units: 0,
    job,
    questions: questions.map(
      (item): SheetQuestion => ({
        question_id: item.id,
        position: item.position,
        label: item.label,
        section: item.section,
        text: item.text,
        question_hash: item.question_hash ?? '',
        coverage: item.coverage,
        coverage_method: item.coverage_method,
        coverage_reason: item.coverage_reason,
        missing_note: item.missing_note,
        rubric: points[item.position]
          ? {
              rubric_id: uuid(500 + item.position),
              built_at: null,
              coverage: 'full',
              coverage_note: '',
              materials: [],
              points: points[item.position].map(([title, essential], index) => ({
                id: `p${index + 1}`,
                title,
                short: '',
                essential,
                source_quote: '',
                source_ids: [],
              })),
            }
          : null,
      }),
    ),
  };
}

const MIXED = [
  question(1, 'full'),
  question(2, 'partial'),
  question(3, 'none', { coverage_reason: 'Ни одного фрагмента с этими словами', coverage_method: 'lexical' }),
  question(4, 'unverified', { nearest: [{ material_id: 'm2', material_title: 'Инфляция', source_id: 'S4', excerpt: 'Инфляция', matched: ['цены'] }] }),
  question(5, 'full', { coverage_method: 'manual', evidence: [] }),
  question(6, null),
];

function openReport(path = '/exams/exam-1/report') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams/:id/report" element={<ExamReport />} />
        <Route path="/exams/:id" element={<h1>Лист экзамена</h1>} />
        <Route path="/exams" element={<h1>Список экзаменов</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The report on screen with the cheat sheet read (the points come after the mapping). */
async function openedReport() {
  const doc = await screen.findByRole('article', { name: 'Макроэкономика' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Печать' })).toBeEnabled());
  return doc;
}

beforeEach(() => {
  mocks.loadExamBundle.mockResolvedValue(bundle(MIXED));
  mocks.fetchSheet.mockResolvedValue(sheetOf(MIXED, { 1: [['Спрос на деньги зависит от дохода', true], ['Три мотива спроса', false]] }));
});

afterEach(() => {
  cleanup();
  document.title = '';
});

// ------------------------------------------------------------------------------------ the document

describe('the report', () => {
  it('heads the document with the exam, its day, the mapping date, the counts and the lectures', async () => {
    openReport();
    expect(screen.getByRole('status')).toHaveTextContent('Собираем отчёт…');
    const doc = await openedReport();
    expect(within(doc).getByRole('heading', { level: 1, name: 'Макроэкономика' })).toBeInTheDocument();
    expect(doc).toHaveTextContent('Отчёт сверки для преподавателя');
    expect(doc).toHaveTextContent('Экзамен · 24 января 2027');
    expect(doc).toHaveTextContent('Сверка с лекциями7 октября 2026, 14:02');
    expect(doc).toHaveTextContent('Вопросов кафедры6');
    const tally = doc.querySelector('.rp-tally') as HTMLElement;
    expect(within(tally).getAllByRole('listitem').map(plain)).toEqual([
      '1есть в лекциях',
      '1частично',
      '1нет в лекциях',
      '3не проверено ИИ',
    ]);
    expect(doc).toHaveTextContent('Не проверено ИИ: 1 — только по словам, 1 — отмечен студентом, 1 — ещё не сверен.');
    const lectures = doc.querySelector('.rp-lectures') as HTMLElement;
    expect(within(lectures).getAllByRole('listitem').map(plain)).toEqual(['Денежный рынокцитаты к 2 вопросам', 'Инфляцияцитат нет']);
  });

  it('one block per question in list order: the verdict in words, the lecture’s own fragment, what is missing, the points', async () => {
    openReport();
    const doc = await openedReport();
    const blocks = [...doc.querySelectorAll<HTMLElement>('.rp-q')];
    expect(blocks.map((block) => block.querySelector('.rp-q-num')?.textContent)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(blocks.map((block) => block.querySelector('.rp-verdict')?.textContent)).toEqual([
      'Есть в лекциях',
      'Есть частично',
      'Нет в лекциях',
      'Проверено только по словам',
      'Отмечено студентом',
      'Не сверено',
    ]);
    // The quote is the lecture's text with its lecture and fragment; the model's explanation is not printed.
    expect(within(blocks[0]).getByText('Лекция «Денежный рынок», фрагмент 11')).toBeInTheDocument();
    expect(blocks[0].querySelector('blockquote')).toHaveTextContent('Текст лекции к вопросу 1: спрос на деньги.');
    expect(doc).not.toHaveTextContent('Модель объясняет своими словами');
    // Points: in order, the main ones marked.
    const points = within(blocks[0]).getAllByRole('listitem').filter((item) => item.closest('.rp-points'));
    expect(points.map(plain)).toEqual(['Спрос на деньги зависит от дохода · главный', 'Три мотива спроса']);
    // «частично»: what is missing; points not written yet are said plainly.
    expect(blocks[1]).toHaveTextContent('Не хватает: примеров из практики');
    expect(blocks[1]).toHaveTextContent('Пункты ещё не написаны.');
    // «нет в лекциях»: said plainly, no quote and no points.
    expect(blocks[2]).toHaveTextContent('Ни в одной из 2 лекций нет фрагмента с этими словами.');
    expect(blocks[2].querySelector('blockquote')).toBeNull();
    expect(blocks[2]).not.toHaveTextContent('Пункты');
    // Not checked by the model: why, and the closest fragment as the exam page names it.
    expect(blocks[3]).toHaveTextContent('ИИ не проверил этот вопрос: он сопоставлен с лекциями только по совпадению слов.');
    expect(blocks[3]).toHaveTextContent('Ближе всего — «Инфляция», фрагмент 4: совпало только слово «цены».');
    expect(blocks[4]).toHaveTextContent('Студент сам отметил, что ответ есть в лекциях. Meldy это не проверял.');
    expect(blocks[5]).toHaveTextContent('Вопрос ещё не сверен с лекциями.');
  });

  it('every question has the teacher’s field: верно / неполно / ошибка and a comment', async () => {
    openReport();
    const doc = await openedReport();
    const fields = within(doc).getAllByRole('group', { name: /^Пометка преподавателя к вопросу/ });
    expect(fields).toHaveLength(6);
    for (const field of fields) {
      expect(within(field).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['верно', 'неполно', 'ошибка']);
      expect(field).toHaveTextContent('Комментарий');
    }
  });

  it('ends with what Meldy does and does not do, no grades, and a line for the reviewer’s signature and date', async () => {
    openReport();
    const doc = await openedReport();
    expect(within(doc).getByRole('heading', { name: 'Что делает Meldy и чего не делает' })).toBeInTheDocument();
    expect(plain(doc.querySelector('.rp-grade'))).toBe(`${GRADE_LINE}.`);
    expect(within(doc).getByRole('heading', { name: 'Отчёт проверил(а)' })).toBeInTheDocument();
    for (const label of ['Должность', 'Фамилия и инициалы', 'Подпись', 'Дата']) expect(within(doc).getByText(label)).toBeInTheDocument();
    expect(doc.textContent).not.toMatch(/засчита|оценка \d|\bбалл/i);
  });

  it('prints section headings once, before the first question of each section', async () => {
    const questions = [question(1, 'full', { section: 1 }), question(2, 'none', { section: 1 }), question(3, 'full', { section: 2 })];
    mocks.loadExamBundle.mockResolvedValue(bundle(questions, { ticket_layout: { mode: 'sections', per_ticket: 2, section_titles: ['Деньги', 'Инфляция'] } }));
    mocks.fetchSheet.mockResolvedValue(sheetOf(questions));
    openReport();
    const doc = await openedReport();
    expect(within(doc).getAllByRole('heading', { level: 3 }).map((item) => item.textContent)).toEqual(['Деньги', 'Инфляция']);
    expect(within(doc).getAllByRole('heading', { level: 4 })).toHaveLength(3);
  });

  it('names the page after the report (Chrome names the saved PDF so) and gives the title back on leaving', async () => {
    document.title = 'Meldy — помощник для учёбы';
    const view = openReport();
    await screen.findByRole('article', { name: 'Макроэкономика' });
    expect(document.title).toBe('Отчёт сверки — Макроэкономика');
    view.unmount();
    expect(document.title).toBe('Meldy — помощник для учёбы');
  });

  it('shows the mapping at once and the points when the cheat sheet arrives; print and CSV wait for them', async () => {
    let arrive: (value: unknown) => void = () => undefined;
    mocks.fetchSheet.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    openReport();
    const doc = await screen.findByRole('article', { name: 'Макроэкономика' });
    expect(doc.querySelector('.rp-q')).toHaveTextContent('Пункты загружаются…');
    expect(screen.getByRole('button', { name: 'Печать' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Скачать CSV' })).toBeDisabled();
    expect(screen.getByText('Загружаем пункты ответов…')).toBeInTheDocument();
    arrive(sheetOf(MIXED, { 1: [['Спрос на деньги зависит от дохода', true]] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Печать' })).toBeEnabled());
    expect(doc.querySelector('.rp-q')).toHaveTextContent('Спрос на деньги зависит от дохода');
    expect(screen.queryByText('Загружаем пункты ответов…')).toBeNull();
  });

  it('renders 150 questions', async () => {
    const many = Array.from({ length: 150 }, (_, index) => question(index + 1, (['full', 'partial', 'none', 'unverified'] as const)[index % 4]));
    mocks.loadExamBundle.mockResolvedValue(bundle(many));
    mocks.fetchSheet.mockResolvedValue(sheetOf(many));
    openReport();
    const doc = await openedReport();
    expect(doc.querySelectorAll('.rp-q')).toHaveLength(150);
  });
});

// ------------------------------------------------------------------------------------ actions

describe('print and CSV', () => {
  it('«Печать» opens the browser’s print and is counted', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    openReport();
    await openedReport();
    fireEvent.click(screen.getByRole('button', { name: 'Печать' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(mocks.track).toHaveBeenCalledWith('report_print', { questions: '6-10' });
  });

  it('«Скачать CSV» saves the same table as a UTF-8 file with a BOM, named after the exam', async () => {
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:report';
    });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicks: Array<{ href: string; download: string }> = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });
    openReport();
    await openedReport();
    fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(clicks[0].href).toBe('blob:report');
    expect(clicks[0].download).toMatch(/^Отчёт сверки - Макроэкономика - \d{4}-\d{2}-\d{2}\.csv$/);
    expect(blobs[0].type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('№;вопрос;есть в лекциях;лекция;фрагмент;цитата;чего не хватает;пункты;пометка преподавателя;комментарий');
    expect(lines).toHaveLength(8);
    expect(lines[3]).toBe('3;Вопрос 3 о денежном рынке;нет;;;;;нет: ответа в лекциях не нашлось;;');
    expect(mocks.track).toHaveBeenCalledWith('report_csv', { questions: '6-10' });
    // The page is not left holding a link.
    expect(document.querySelector('a[download]')).toBeNull();
  });
});

// ------------------------------------------------------------------------------------ guard and states

describe('who sees it, and the empty states', () => {
  it('an exam that is not the user’s (or is gone) is «не найден»: nothing of it is shown', async () => {
    mocks.loadExamBundle.mockResolvedValue(null);
    mocks.fetchSheet.mockRejectedValue(new Error('404'));
    openReport('/exams/someone-else/report');
    expect(await screen.findByRole('heading', { name: 'Экзамен не найден' })).toBeInTheDocument();
    expect(screen.getByText('Его удалили, или он принадлежит другому аккаунту.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Печать' })).toBeNull();
    expect(mocks.loadExamBundle).toHaveBeenCalledWith('someone-else');
  });

  it('a failed read says so and «Повторить» reads again', async () => {
    mocks.loadExamBundle.mockRejectedValueOnce(new Error('offline'));
    openReport();
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось собрать отчёт');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('article', { name: 'Макроэкономика' })).toBeInTheDocument();
    expect(mocks.loadExamBundle).toHaveBeenCalledTimes(2);
  });

  it('an exam not mapped yet: what to do first, no document', async () => {
    const questions = [question(1, null), question(2, null)];
    mocks.loadExamBundle.mockResolvedValue(bundle(questions, { mapping_state: 'none', mapped_at: null }));
    openReport();
    expect(await screen.findByRole('heading', { level: 1, name: 'Вопросы ещё не сверены с лекциями' })).toBeInTheDocument();
    expect(screen.getByText(/Нажмите «Сверить с лекциями» на странице экзамена/)).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Назад к экзамену' }).every((link) => link.getAttribute('href') === '/exams/exam-1')).toBe(true);
  });

  it('no lectures: offers to add them', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, null)], { mapping_state: 'none', mapped_at: null }, []));
    openReport();
    expect(await screen.findByRole('heading', { level: 1, name: 'К экзамену не добавлены лекции' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Добавить лекции' })).toHaveAttribute('href', '/exams/exam-1/edit#lectures');
  });

  it('an interrupted mapping: the report of what was checked, with a printed note on the rest', async () => {
    mocks.loadExamBundle.mockResolvedValue(bundle([question(1, 'full'), question(2, null), question(3, null)], { mapping_state: 'failed' }));
    openReport();
    const doc = await openedReport();
    expect(plain(doc.querySelector('.rp-notice'))).toBe(
      'Сверка прервалась: проверено 1 из 3 вопросов. Остальные отмечены «не сверено».',
    );
    expect(doc).toHaveTextContent('Сверка прервалась раньше, чем дошла до этого вопроса.');
  });

  it('a mapping another tab is running now: the report says how far it had got', async () => {
    mocks.loadExamBundle.mockResolvedValue(
      bundle([question(1, 'full'), question(2, null)], { mapping_state: 'running', mapping_started_at: new Date().toISOString() }),
    );
    openReport();
    const doc = await openedReport();
    expect(doc).toHaveTextContent('Сверка ещё шла, когда составлен отчёт: проверено 1 из 2 вопросов.');
  });

  it('points that did not load: said on screen with «Загрузить снова», and in the printed note', async () => {
    mocks.fetchSheet.mockRejectedValueOnce(new Error('offline'));
    openReport();
    const doc = await openedReport();
    expect(doc).toHaveTextContent('Пункты ответов не загрузились, поэтому в отчёте их нет.');
    expect(doc.querySelector('.rp-q')).toHaveTextContent('Пункты не загрузились.');
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить снова' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Загрузить снова' })).toBeNull());
    expect(screen.getByRole('article', { name: 'Макроэкономика' })).not.toHaveTextContent('Пункты ответов не загрузились');
    expect(mocks.fetchSheet).toHaveBeenCalledTimes(2);
  });

  it('the room’s way out is «Назад к экзамену»', async () => {
    openReport();
    await screen.findByRole('article', { name: 'Макроэкономика' });
    fireEvent.click(screen.getByRole('link', { name: 'Назад к экзамену' }));
    expect(await screen.findByRole('heading', { name: 'Лист экзамена' })).toBeInTheDocument();
  });
});
