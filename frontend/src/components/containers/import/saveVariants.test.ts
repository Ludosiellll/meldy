import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankItem, BankParseResult, ItemInput, TestItem } from '../../../types/container';

const api = vi.hoisted(() => ({
  addItems: vi.fn(),
  createContainer: vi.fn(),
  addSubject: vi.fn(),
  saveSettings: vi.fn(),
  topics: vi.fn(),
}));

vi.mock('../../../api/containers', () => ({
  addItems: api.addItems,
  addSubject: api.addSubject,
  createContainer: api.createContainer,
  saveSettings: api.saveSettings,
  containerError: (error: unknown) => error,
}));
vi.mock('../../../api/exams', () => ({ createExam: vi.fn() }));
vi.mock('../../../lib/containers/titleCache', () => ({ rememberContainerTitle: vi.fn() }));
// container_subjects.update({ topics }).eq('id', …).select('id'): the topics a join writes
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: unknown) => ({
        eq: (_column: string, id: string) => ({
          select: async () => {
            api.topics(id, patch);
            return { data: [{ id }], error: null, status: 200 };
          },
        }),
      }),
    }),
  },
}));

import { deriveSubjects, pictureIds, type ImportFile } from './importModel';
import { freshSaveState, saveImport, type SubjectJoin } from './saveImport';
import { joinPlans, joinTargets, updateItemInputs } from './updateModel';
import { ownContainers } from './targets';

const CONTAINER = '11111111-2222-4333-8444-555555555555';
const OPTIONS = ['один', 'два', 'три', 'четыре'];

function q(position: number, text: string, correct = 1): BankItem {
  return {
    position, label: String(position), subject: 1, topic: null, kind: 'single', text, options: [...OPTIONS], correct: [correct],
    order: [], pairs: [], answer: null, evidence: 'bold', flags: [], code: false, where: '',
    marks: { bold: OPTIONS.map((_, index) => (index === correct ? 1 : 0)) },
  };
}

function file(id: string, variant: number, items: BankItem[]): ImportFile {
  const result = {
    method: 'rules', layout: 'numbered_paragraphs', layouts_seen: {}, confidence: 1, key_source: { bold: items.length }, format_signal: 'bold',
    format_signals: {}, mark_share: 0.6, marker: null, markers: [], subjects: [{ index: 1, title: 'Сети', evidence: 'heading', items: items.length }],
    topics: [], skipped: [], warnings: [], items, variant,
    stats: { items: items.length, with_key: items.length, no_key: 0, ambiguous: 0, to_check: 0, duplicates: 0, kinds: {}, options: {}, gaps: [], key_lists: 0 },
  } as BankParseResult;
  return { id, name: `Сети_Вариант_${variant}.docx`, importId: `imp-${id}`, source: 'file', format: 'auto', keyText: '', result };
}

const FILES = [
  file('f1', 1, [q(1, 'Что такое IP?'), q(2, 'Что такое маска?')]),
  file('f2', 2, [q(1, 'Что такое порт?'), q(2, 'Что такое IP?')]),
];
const IDS = { f1: 'imp-f1', f2: 'imp-f2' };
const sent = (): ItemInput[] => api.addItems.mock.calls.flatMap((call) => call[1] as ItemInput[]);

beforeEach(() => {
  vi.clearAllMocks();
  api.createContainer.mockResolvedValue({ container_id: CONTAINER, subjects: [{ id: 'sub-1', position: 1, title: 'Сети' }] });
  api.addSubject.mockResolvedValue({ id: 'sub-new' });
  api.addItems.mockResolvedValue([]);
});

describe('saving a subject made of variants', () => {
  it('one subject; each question’s ref carries its own file’s import id, so a resent batch adds nothing twice', async () => {
    const subjects = deriveSubjects(FILES);
    expect(subjects).toHaveLength(1);
    const input = { userId: 'u1', target: { kind: 'new' as const }, title: 'Сессия', date: null, perSubject: false, minutes: null, subjects, importIds: IDS };
    await saveImport(input, freshSaveState());
    expect(api.createContainer).toHaveBeenCalledTimes(1);
    expect(api.createContainer.mock.calls[0][2]).toEqual([{ title: 'Сети', exam_date: null, exam_id: null, topics: ['Вариант 1', 'Вариант 2'] }]);
    expect(sent().map((input) => [input.ref, input.stem, input.topic])).toEqual([
      ['imp-f1:1', 'Что такое IP?', 1],
      ['imp-f1:2', 'Что такое маска?', 1],
      ['imp-f2:1', 'Что такое порт?', 2],
    ]);
  });

  it('into an exam that has «Сети»: the new variants land in that subject, its new questions and topics only', async () => {
    const subjects = deriveSubjects(FILES);
    const overview = {
      v: 1 as const, day: '2026-11-04', attached_exam_ids: [],
      containers: [{
        id: CONTAINER, title: 'Сессия', exam_date: null, created_at: '2026-11-01T10:00:00Z', role: 'owner' as const, items: 1, items_updated_at: null,
        answers_today: 0, settings: null,
        subjects: [
          { id: 'sub-other', position: 1, title: 'Базы данных', exam_date: null, oral_exam_id: null, has_oral: false, keyed: 0, no_key: 0, seen: 0, two_days: 0, open_errors: 0, seen_today: 0, doubted: 0, stale: 0 },
          { id: 'sub-1', position: 2, title: '«Сети»', exam_date: null, oral_exam_id: null, has_oral: false, keyed: 1, no_key: 0, seen: 0, two_days: 0, open_errors: 0, seen_today: 0, doubted: 0, stale: 0 },
        ],
      }],
    };
    const [target] = ownContainers(overview);
    expect(target.subjectList).toEqual([{ id: 'sub-other', title: 'Базы данных' }, { id: 'sub-1', title: '«Сети»' }]);
    const targets = joinTargets(subjects, target.subjectList);
    expect(targets).toEqual({ [subjects[0].key]: 'sub-1' });

    const saved = [{
      id: 'i1', container_id: CONTAINER, subject_id: 'sub-1', position: 1, file_no: '1', topic: 1, kind: 'single', stem: 'Что такое IP?',
      options: [...OPTIONS], correct: [1], answers: [], key_source: 'bold', code: false, keep_order: false, flags: [],
    }] as unknown as TestItem[];
    const plans = joinPlans(subjects, targets, { subjects: [{ id: 'sub-1', topic_titles: ['Вариант 1'] }], items: saved });
    const { plan } = plans[subjects[0].key];
    expect([plan.add.map((item) => item.text), plan.same, plan.topics]).toEqual([['Что такое маска?', 'Что такое порт?'], 1, ['Вариант 1', 'Вариант 2']]);

    const join: SubjectJoin = {
      subjectId: 'sub-1',
      topics: plan.topics,
      items: (place) => updateItemInputs(plan, (fileId) => IDS[fileId as 'f1' | 'f2'], place),
      pictureIds: pictureIds({ test: plan.add }),
      count: plan.add.length,
    };
    const state = freshSaveState();
    const input = {
      userId: 'u1', target: { kind: 'container' as const, containerId: CONTAINER, title: 'Сессия' }, title: '', date: null, perSubject: false,
      minutes: null, subjects, importIds: IDS, joins: { [subjects[0].key]: join },
    };
    await saveImport(input, state);
    expect(api.addSubject).not.toHaveBeenCalled();
    expect(api.topics).toHaveBeenCalledWith('sub-1', { topics: ['Вариант 1', 'Вариант 2'] });
    expect(api.addItems.mock.calls.map((call) => call[0])).toEqual(['sub-1']);
    expect(sent().map((input) => [input.ref, input.stem, input.topic])).toEqual([
      ['imp-f1:2', 'Что такое маска?', 1],
      ['imp-f2:1', 'Что такое порт?', 2],
    ]);
    // pressed again: nothing is written twice
    await saveImport(input, state);
    expect(api.topics).toHaveBeenCalledTimes(1);
    expect(api.addItems).toHaveBeenCalledTimes(1);
  });

  it('a subject that is not made of variants never joins, even of the same name', () => {
    const single = deriveSubjects([FILES[0]]);
    expect(joinTargets(single, [{ id: 'sub-1', title: 'Сети' }])).toEqual({});
  });
});
