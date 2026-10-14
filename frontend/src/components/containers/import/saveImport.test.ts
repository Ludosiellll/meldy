import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankItem, BankParseResult, ItemInput } from '../../../types/container';

const api = vi.hoisted(() => ({
  addItems: vi.fn(),
  createContainer: vi.fn(),
  addSubject: vi.fn(),
  saveSettings: vi.fn(),
  uploadPicture: vi.fn(),
}));

vi.mock('../../../api/containers', () => ({
  addItems: api.addItems,
  addSubject: api.addSubject,
  createContainer: api.createContainer,
  saveSettings: api.saveSettings,
  containerError: (error: unknown) => error,
}));
vi.mock('../../../api/exams', () => ({ createExam: vi.fn() }));
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../../lib/containers/titleCache', () => ({ rememberContainerTitle: vi.fn() }));
vi.mock('../../../api/itemPictures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/itemPictures')>()),
  uploadPicture: api.uploadPicture,
}));

import { deriveSubjects, NO_EDITS, type ImportFile } from './importModel';
import { freshSaveState, saveImport, saveUpdate } from './saveImport';

const CONTAINER = '11111111-2222-4333-8444-555555555555';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const PNG = { type: 'image/png', data: 'iVBORw0KGgo=' };

function item(position: number, patch: Partial<BankItem> = {}): BankItem {
  return {
    position,
    label: String(position),
    subject: 1,
    topic: null,
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
    marks: {},
    ...patch,
  };
}

function file(items: BankItem[]): ImportFile {
  const result = {
    method: 'rules', layout: 'table_stem_rows', layouts_seen: {}, confidence: 1, key_source: {}, format_signal: 'bold',
    format_signals: {}, mark_share: 0.6, marker: null, markers: [], subjects: [{ index: 1, title: 'Схемы', evidence: 'heading', items: items.length }],
    topics: [], skipped: [], warnings: [], items,
    stats: { items: items.length, with_key: items.length, no_key: 0, ambiguous: 0, to_check: 0, duplicates: 0, kinds: {}, options: {}, gaps: [], key_lists: 0 },
    pictures: { [A]: PNG, [B]: { type: 'image/jpeg', data: '/9j/' } },
  } as BankParseResult;
  return { id: 'f1', name: 'Схемы.docx', importId: 'imp-x', source: 'file', format: 'auto', keyText: '', result };
}

const ITEMS = [
  item(1, { text: '', options: ['', '', 'текст'], images: { stem: [A], options: [[B], [A], []] } }),
  item(2, { images: { stem: [B], options: [] } }),
  item(3),
];

function setup() {
  const imported = file(ITEMS);
  const subjects = deriveSubjects([imported], NO_EDITS);
  return {
    subjects,
    input: {
      userId: 'u1', target: { kind: 'new' as const }, title: 'Схемы', date: null, perSubject: false, minutes: null,
      subjects, importIds: { f1: 'imp-x' }, pictures: imported.result.pictures,
    },
  };
}

const sent = (): ItemInput[] => api.addItems.mock.calls[api.addItems.mock.calls.length - 1]?.[1] ?? [];

beforeEach(() => {
  vi.clearAllMocks();
  api.createContainer.mockResolvedValue({ container_id: CONTAINER, subjects: [{ id: 'sub-1', position: 1, title: 'Схемы' }] });
  api.addItems.mockResolvedValue([]);
});

describe('saving pictures with the questions (owner, 2026-10-14)', () => {
  it('puts each picture once into the container’s folder, then saves the questions with their paths', async () => {
    api.uploadPicture.mockResolvedValue('kept');
    const { input } = setup();
    await expect(saveImport(input, freshSaveState())).resolves.toBe(`/exams/c/${CONTAINER}`);
    expect(api.uploadPicture.mock.calls.map(([path, picture]) => [path, picture.type]).sort()).toEqual([
      [`${CONTAINER}/${A}.png`, 'image/png'],
      [`${CONTAINER}/${B}.jpg`, 'image/jpeg'],
    ]);
    const [first, second, third] = sent();
    expect(first).toMatchObject({ stem: 'Вопрос на картинке', options: ['Рисунок А', 'Рисунок Б', 'текст'], correct: [0] });
    expect(first.images).toEqual({ stem: [`${CONTAINER}/${A}.png`], options: [[`${CONTAINER}/${B}.jpg`], [`${CONTAINER}/${A}.png`], []] });
    expect(second.images).toEqual({ stem: [`${CONTAINER}/${B}.jpg`], options: [[], [], []] });
    expect(third.images).toBeUndefined();
  });

  it('a network failure stops the save; the next try puts only what is not there yet and creates nothing twice', async () => {
    api.uploadPicture.mockImplementation(async (path: string) => {
      if (path.endsWith('.jpg')) throw new Error('Failed to fetch');
      return 'kept';
    });
    const { input } = setup();
    const state = freshSaveState();
    await expect(saveImport(input, state)).rejects.toThrow('Failed to fetch');
    expect(api.addItems).not.toHaveBeenCalled();
    expect(state.itemsStarted).toBe(false);

    api.uploadPicture.mockReset();
    api.uploadPicture.mockResolvedValue('kept');
    await saveImport(input, state);
    expect(api.createContainer).toHaveBeenCalledTimes(1);
    expect(api.uploadPicture.mock.calls.map(([path]) => path)).toEqual([`${CONTAINER}/${B}.jpg`]);
    expect(sent()[1].images?.stem).toEqual([`${CONTAINER}/${B}.jpg`]);
  });

  it('a picture storage refuses is lost: its question is saved without its key and with has_image', async () => {
    api.uploadPicture.mockImplementation(async (path: string) => (path.endsWith('.jpg') ? 'refused' : 'kept'));
    const { input } = setup();
    await saveImport(input, freshSaveState());
    const [first, second, third] = sent();
    expect(first).toMatchObject({ correct: [], key_source: 'none' });
    expect(first.flags).toContain('has_image');
    expect(first.images).toEqual({ stem: [`${CONTAINER}/${A}.png`], options: [[], [`${CONTAINER}/${A}.png`], []] });
    expect(second.images).toBeUndefined();
    expect(second.flags).toContain('has_image');
    expect(third).toMatchObject({ correct: [0], key_source: 'bold' });
  });

  it('«Обновить из файла» puts the new questions’ pictures into the container before adding them', async () => {
    api.uploadPicture.mockResolvedValue('kept');
    const { subjects } = setup();
    await saveUpdate(
      {
        subjectId: 'sub-1',
        topics: null,
        items: (place) => [{ ref: 'imp-x:2', stem: 'Вопрос', options: ['а', 'б'], correct: [0], images: { stem: [place(B) ?? 'lost'], options: [] } }],
        pictures: { containerId: CONTAINER, ids: [B], data: file(ITEMS).result.pictures ?? {} },
      },
      freshSaveState(),
    );
    expect(subjects).toHaveLength(1);
    expect(api.uploadPicture).toHaveBeenCalledTimes(1);
    expect(sent()[0].images?.stem).toEqual([`${CONTAINER}/${B}.jpg`]);
  });
});
