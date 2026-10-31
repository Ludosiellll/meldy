import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listLectures: vi.fn(),
  fetchOverview: vi.fn(),
  addItems: vi.fn(),
  createContainer: vi.fn(),
  setContainerKind: vi.fn(),
}));
vi.mock('../../api/materials', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/materials')>()), listLectures: api.listLectures }));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  fetchOverview: api.fetchOverview,
  addItems: api.addItems,
  createContainer: api.createContainer,
  setContainerKind: api.setContainerKind,
}));

import { exportRows, generateTest, portInputs, PortError, type PortItem } from '../../api/testPort';
import { AI_COSTS } from '../../lib/plans';
import type { TestItem } from '../../types/container';
import ExportSheet from './ExportSheet';
import GenerateSheet from './GenerateSheet';
import LectureToTest from './LectureToTest';
import { PORT } from './copyPort';

/** The words as the page shows them to a query (testing-library reads a no-break space as a space). */
const seen = (text: string) => text.replace(/\s+/g, ' ');

const row = (patch: Partial<TestItem>): TestItem => ({
  id: 'i1', container_id: 'c', subject_id: 's', position: 1, file_no: '', topic: null, kind: 'single', stem: 'Вопрос?', options: ['а', 'б'],
  correct: [0], answers: [], key_source: 'manual', code: false, keep_order: false, flags: [], rev: 1, updated_at: '', images: null, explanation: '',
  ...patch,
});
const ITEMS: PortItem[] = [
  { stem: 'Чем банк борется с инфляцией?', options: ['Ключевой ставкой', 'Налогами'], correct: [0], explanation: 'Ставка.\n\nИз лекции «Инфляция»: «Банк повышает ставку.»', quote: 'Банк повышает ставку.', source_id: 'S02', checked: true },
  { stem: 'Какого цвета знаки запрета?', options: ['Жёлтого', 'Красного'], correct: [0], explanation: 'Из лекции: «…»', quote: 'Красный — запрет, жёлтый — предупреждение.', source_id: 'S03', checked: false },
];

function answer(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('api/testPort', () => {
  it('sends the questions in the page order with their numbers and whether they have pictures', () => {
    const rows = exportRows([row({ id: 'a' }), row({ id: 'b', kind: 'number', options: [], correct: [], answers: ['9.8'], tolerance: 0.1, unit: 'м/с²', images: { stem: ['c/x.png'] } })], new Map([['a', 3], ['b', 4]]));
    expect(rows[0]).toMatchObject({ number: '3', kind: 'single', pictures: false });
    expect(rows[1]).toMatchObject({ number: '4', kind: 'number', answers: ['9.8'], tolerance: 0.1, unit: 'м/с²', pictures: true });
  });

  it('saves the chosen questions as single questions with the quote in the explanation', () => {
    expect(portInputs(ITEMS, 'gen-1')).toEqual([
      expect.objectContaining({ ref: 'gen-1:1', kind: 'single', stem: ITEMS[0].stem, options: ITEMS[0].options, correct: [0], key_source: 'manual', explanation: ITEMS[0].explanation }),
      expect.objectContaining({ ref: 'gen-1:2', explanation: ITEMS[1].explanation }),
    ]);
  });

  it('sends a file as a form and a text as JSON; says the server words of a refusal and its own of a failure', async () => {
    fetchMock.mockReturnValueOnce(answer({ title: 'Глава', items: ITEMS, dropped: 1 }));
    const file = new File(['текст'], 'Глава.txt', { type: 'text/plain' });
    const made = await generateTest({ file }, 15);
    expect(made).toMatchObject({ title: 'Глава', dropped: 1 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('count')).toBe('15');

    fetchMock.mockReturnValueOnce(answer({ detail: 'Текста слишком мало, чтобы составить вопросы.', code: 'no_text' }, 422));
    await expect(generateTest({ text: 'мало' }, 5)).rejects.toMatchObject({ code: 'no_text', message: 'Текста слишком мало, чтобы составить вопросы.' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ text: 'мало', count: 5 });

    fetchMock.mockReturnValueOnce(answer({ detail: 'Traceback…' }, 500));
    const failure = await generateTest({ text: 'x' }, 5).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PortError);
    expect((failure as PortError).message).toBe(PORT.failed);
  });
});

describe('copyPort', () => {
  it('agrees the verb with the number', () => {
    expect(seen(PORT.willGo(21, 30))).toBe('В файл войдёт 21 из 30 вопросов.');
    expect(seen(PORT.willGo(11, 21))).toBe('В файл войдут 11 из 21 вопроса.');
    expect(seen(PORT.found(3, 1))).toBe('Готово: 3 вопроса. Ещё 1 не вошёл: его ответа нет в тексте.');
    expect(seen(PORT.found(5, 2))).toBe('Готово: 5 вопросов. Ещё 2 не вошли: их ответа нет в тексте.');
    expect(seen(PORT.addedTo(1, 'Т'))).toBe('1 вопрос добавлен в тест «Т».');
  });
});

describe('ExportSheet', () => {
  it('shows what goes into the file and what is left out, then downloads it', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return answer({
        name: `Тест (${body.format}).txt`, mime: 'text/plain', data: btoa('ok'), count: 1, total: 2, pictures_lost: 1,
        skipped: [{ number: '2', reason: 'в Aiken только вопросы с одним верным ответом' }],
      });
    });
    const create = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    render(<ExportSheet title="Тест" items={[row({ id: 'a' }), row({ id: 'b', kind: 'multiple', correct: [0, 1] })]} onClose={() => undefined} />);
    expect(await screen.findByText(seen(PORT.willGo(1, 2)))).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).format).toBe('moodle');
    expect(screen.getByText(seen(PORT.leftLine('2', 'в Aiken только вопросы с одним верным ответом')))).toBeTruthy();
    expect(screen.getByText(seen(PORT.picturesLost(1)))).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Aiken/));
    await waitFor(() => expect(JSON.parse(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body).format).toBe('aiken'));
    fireEvent.click(await screen.findByRole('button', { name: PORT.download }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByText(PORT.downloaded('Тест (aiken).txt'))).toBeTruthy();
  });

  it('an empty test says so and sends nothing', () => {
    render(<ExportSheet title="Тест" items={[]} onClose={() => undefined} />);
    expect(screen.getByText(PORT.noItems)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: PORT.download }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('GenerateSheet', () => {
  it('says the price, generates from the lecture and adds only the ticked questions', async () => {
    api.listLectures.mockResolvedValue([{ id: 'm1', title: 'Инфляция' }]);
    fetchMock.mockReturnValueOnce(answer({ title: 'Инфляция', items: ITEMS, dropped: 1 }));
    const onAdd = vi.fn(async (inputs: unknown[]) => inputs.length);
    render(<GenerateSheet userId="u1" onAdd={onAdd} onClose={() => undefined} />);
    expect(screen.getByText(seen(PORT.cost(AI_COSTS.analysisSection)))).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Инфляция' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: PORT.run }));
    expect(await screen.findByText(seen(PORT.found(2, 1)))).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ material_id: 'm1', count: 10 });
    // the checked question is ticked, the one to check is not; each shows its sentence
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    expect(screen.getByText(ITEMS[1].quote)).toBeTruthy();
    expect(screen.getByText(PORT.doubt)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: (name: string) => seen(name) === seen(PORT.pick(1)) }));
    expect(await screen.findByText(seen(PORT.added(1)))).toBeTruthy();
    expect(onAdd.mock.calls[0][0]).toEqual([expect.objectContaining({ stem: ITEMS[0].stem, kind: 'single' })]);
  });

  it('without lectures it starts from a text; a refusal is said and the form stays', async () => {
    api.listLectures.mockResolvedValue([]);
    fetchMock.mockReturnValueOnce(answer({ detail: 'Текста слишком мало, чтобы составить вопросы. Нужен хотя бы абзац.', code: 'no_text' }, 422));
    render(<GenerateSheet userId="u1" onAdd={vi.fn()} onClose={() => undefined} />);
    const field = await screen.findByLabelText(PORT.text);
    fireEvent.change(field, { target: { value: 'Мало.' } });
    fireEvent.click(screen.getByLabelText('20'));
    fireEvent.click(screen.getByRole('button', { name: PORT.run }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Текста слишком мало, чтобы составить вопросы. Нужен хотя бы абзац.');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: 'Мало.', count: 20 });
    expect(screen.getByLabelText(PORT.text)).toBeTruthy();
  });
});

describe('LectureToTest', () => {
  function renderAt() {
    return render(
      <MemoryRouter initialEntries={['/m/1']}>
        <Routes>
          <Route path="/m/1" element={<LectureToTest materialId="0f000000-0000-4000-8000-0000000000aa" title="Инфляция" />} />
          <Route path="/exams/c/:id/quizzes/new" element={<p>форма контрольной</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('«Сделать контрольную» saves a test of the checked questions and opens the контрольная form', async () => {
    fetchMock.mockReturnValueOnce(answer({ title: 'Инфляция', items: ITEMS, dropped: 0 }));
    api.createContainer.mockResolvedValue({ container_id: 'c-new', subjects: [{ id: 's-new' }] });
    api.setContainerKind.mockResolvedValue(undefined);
    api.addItems.mockResolvedValue([]);
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: PORT.lectureMake }));
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByText(ITEMS[0].quote);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ material_id: '0f000000-0000-4000-8000-0000000000aa' });
    fireEvent.click(within(sheet).getByRole('button', { name: PORT.makeGo }));
    expect(await screen.findByText('форма контрольной')).toBeTruthy();
    expect(api.createContainer.mock.calls[0][0]).toBe('Инфляция');
    expect(api.setContainerKind).toHaveBeenCalledWith('c-new', 'test');
    expect(api.addItems.mock.calls[0][0]).toBe('s-new');
    expect(api.addItems.mock.calls[0][1]).toEqual([expect.objectContaining({ stem: ITEMS[0].stem, explanation: ITEMS[0].explanation })]);
  });

  it('«Добавить в тест» adds them to the chosen own test', async () => {
    fetchMock.mockReturnValueOnce(answer({ title: 'Инфляция', items: ITEMS, dropped: 1 }));
    api.fetchOverview.mockResolvedValue({
      containers: [
        { id: 'e1', title: 'Экзамен', kind: 'exam', role: 'owner', subjects: [{ id: 'se', position: 1 }] },
        { id: 't2', title: 'Чужой тест', kind: 'test', role: 'member', subjects: [{ id: 'sm', position: 1 }] },
        { id: 't1', title: 'Контрольная по экономике', kind: 'test', role: 'owner', subjects: [{ id: 's2', position: 2 }, { id: 's1', position: 1 }] },
      ],
    });
    api.addItems.mockResolvedValue([]);
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: PORT.lectureAdd }));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByRole('option', { name: 'Контрольная по экономике' })).toBeTruthy();
    expect(within(sheet).queryByRole('option', { name: 'Экзамен' })).toBeNull();
    expect(within(sheet).getByText(seen(PORT.lectureDropped(1)))).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: (name: string) => seen(name) === seen(PORT.pick(1)) }));
    expect(await within(sheet).findByText(seen(PORT.addedTo(1, 'Контрольная по экономике')))).toBeTruthy();
    expect(api.addItems.mock.calls[0][0]).toBe('s1');
    expect(within(sheet).getByRole('link', { name: PORT.openStudio }).getAttribute('href')).toBe('/exams/c/t1/studio');
  });
});
