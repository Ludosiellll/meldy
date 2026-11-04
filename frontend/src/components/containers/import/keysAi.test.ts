import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/containers')>()),
  keysAi: vi.fn(),
}));

import { ContainerApiError, type KeysAiQuestion, type KeysAiResponse } from '../../../api/containers';
import { keysAiCost } from '../../../lib/plans';
import type { BankItem, BankParseResult } from '../../../types/container';
import { KEYS_AI_WORDS } from '../copyImport';
import { aiKeyQueue, deriveSubjects, itemInputs, NO_EDITS, queueOf, spotCheck, type ImportEdits, type ImportFile } from './importModel';
import { keysAiBatches, keysAiCandidates, keysAiErrorLine, keysAiPrice, runKeysAi } from './keysAi';

/** «Подобрать ключи с ИИ» (owner, 2026-11-04; docs/import/KEYS_AI.md). Synthetic questions. */

function q(position: number, patch: Partial<BankItem> = {}): BankItem {
  return {
    position, label: String(position), subject: 1, topic: null, kind: 'single', text: `Вопрос ${position}?`, options: ['один', 'два', 'три', 'четыре'],
    correct: [], order: [], pairs: [], answer: null, evidence: '', flags: ['no_key'], code: false, where: '', marks: {}, ...patch,
  };
}
const keyed = (position: number) => q(position, { correct: [1], evidence: 'bold', flags: [], marks: { bold: [0, 1, 0, 0] } });

function file(id: string, items: BankItem[], title = 'Сети'): ImportFile {
  const result = {
    method: 'rules', layout: 'numbered_paragraphs', layouts_seen: {}, confidence: 1, key_source: {}, format_signal: 'bold', format_signals: {},
    mark_share: 0.6, marker: null, markers: [], subjects: [{ index: 1, title, evidence: 'heading', items: items.length }], topics: [], skipped: [],
    warnings: [], items,
    stats: { items: items.length, with_key: 0, no_key: 0, ambiguous: 0, to_check: 0, duplicates: 0, kinds: {}, options: {}, gaps: [], key_lists: 0 },
  } as BankParseResult;
  return { id, name: `${title}.docx`, importId: `imp-${id}`, source: 'file', format: 'auto', keyText: '', result };
}

const ITEMS = [
  keyed(1),
  q(2),
  q(3, { kind: 'multiple', options: ['А1', 'А2', 'А3', 'А4', 'А5'] }),
  q(4, { images: { stem: ['a'.repeat(64)], options: [[], [], [], []] } }), // a picture: the model cannot see it
  q(5, { flags: ['no_key', 'has_image'] }), // a picture that did not come
  q(6, { flags: ['several_marked'], correct: [0, 2], evidence: 'bold', marks: { bold: [1, 0, 1, 0] } }), // the file marked two
  q(7, { kind: 'open', options: [] }), // oral
  q(8, { text: 'x'.repeat(2001) }), // over the server's limit
  q(9, { options: ['один', 'два', 'x'.repeat(501)] }),
];

describe('«Подобрать ключи с ИИ»: what is sent', () => {
  it('only choice questions without a key from the file, without pictures, within the server’s limits; ids are the uids', () => {
    const subjects = deriveSubjects([file('f1', ITEMS)]);
    const candidates = keysAiCandidates(subjects, NO_EDITS);
    expect(candidates.map((candidate) => candidate.question)).toEqual<KeysAiQuestion[]>([
      { id: 'f1:2', text: 'Вопрос 2?', options: ['один', 'два', 'три', 'четыре'], kind: 'single' },
      { id: 'f1:3', text: 'Вопрос 3?', options: ['А1', 'А2', 'А3', 'А4', 'А5'], kind: 'multiple' },
    ]);
    expect(candidates.every((candidate) => candidate.subjectTitle === 'Сети')).toBe(true);
    // a key the student set, a question the AI was unsure of: not again; one it gave no answer: again
    const edits: ImportEdits = { ...NO_EDITS, items: { 'f1:2': { correct: [0] }, 'f1:3': { aiTried: 'low', aiNote: 'ИИ не уверен' } } };
    expect(keysAiCandidates(deriveSubjects([file('f1', ITEMS)], edits), edits)).toEqual([]);
    const retry: ImportEdits = { ...NO_EDITS, items: { 'f1:3': { aiTried: 'none', aiNote: 'ИИ не дал ответа' } } };
    expect(keysAiCandidates(deriveSubjects([file('f1', ITEMS)], retry), retry).map((candidate) => candidate.uid)).toEqual(['f1:2', 'f1:3']);
  });

  it('a dropped option is not sent; the key comes back in the file’s option numbers', async () => {
    const edits: ImportEdits = { ...NO_EDITS, items: { 'f1:2': { drop: [0] } } };
    const subjects = deriveSubjects([file('f1', [q(2)])], edits);
    const [candidate] = keysAiCandidates(subjects, edits);
    expect(candidate.question.options).toEqual(['два', 'три', 'четыре']);
    const outcome = await runKeysAi([candidate], (fixes) => expect(fixes['f1:2']).toMatchObject({ correct: [2], aiKey: true }), async () => ({
      results: [{ id: 'f1:2', correct: [1], agree: true, sure: 'high' }],
      units: 5,
      spent_questions: 1,
    }));
    expect(outcome).toMatchObject({ sent: 1, keyed: 1, units: 5, error: null });
  });

  it('one request per subject (its title along) and per 300 questions; the price is each request’s', () => {
    const many = Array.from({ length: 301 }, (_, at) => q(at + 1));
    const subjects = deriveSubjects([file('f1', many, 'Сети'), file('f2', [q(1), q(2)], 'Базы данных')]);
    const candidates = keysAiCandidates(subjects, NO_EDITS);
    expect(keysAiBatches(candidates).map((batch) => [batch.subject, batch.items.length])).toEqual([
      ['Сети', 300],
      ['Сети', 1],
      ['Базы данных', 2],
    ]);
    expect(keysAiPrice(candidates)).toBe(15 + 5 + 5);
    expect([keysAiCost(1), keysAiCost(100), keysAiCost(101), keysAiCost(300), keysAiCost(0)]).toEqual([5, 5, 10, 15, 5]);
  });
});

describe('«Подобрать ключи с ИИ»: what comes back', () => {
  const answer: KeysAiResponse = {
    results: [
      { id: 'f1:2', correct: [2], agree: true, sure: 'high' },
      { id: 'f1:3', correct: null, agree: false, sure: 'low', note: 'ответы ИИ разошлись' },
    ],
    units: 5,
    spent_questions: 2,
  };

  it('an agreed key is the student’s key with the flag ai_key, waiting in «Проверьте ключи от ИИ»; null stays keyless with its note', async () => {
    const subjects = deriveSubjects([file('f1', ITEMS)]);
    const items: ImportEdits['items'] = {};
    const outcome = await runKeysAi(keysAiCandidates(subjects, NO_EDITS), (fixes) => Object.assign(items, fixes), async () => answer);
    expect(outcome).toEqual({ sent: 2, keyed: 1, notes: { 'ответы ИИ разошлись': 1 }, units: 5, error: null });
    expect(items['f1:2']).toMatchObject({ correct: [2], kind: 'single', aiKey: true, aiOk: false });
    expect(items['f1:3']).toEqual({ aiTried: 'low', aiNote: 'ответы ИИ разошлись' });

    const edits: ImportEdits = { ...NO_EDITS, items };
    const [subject] = deriveSubjects([file('f1', ITEMS)], edits);
    const two = subject.test.find((item) => item.uid === 'f1:2')!;
    expect([two.correct, two.keySource, two.aiKey, two.problems]).toEqual([[2], 'manual', true, ['ai_key']]);
    expect(two.flags).toContain('ai_key');
    expect(two.flags).not.toContain('no_key');
    const three = subject.test.find((item) => item.uid === 'f1:3')!;
    expect([three.correct, three.problems]).toEqual([[], ['no_key']]);
    // the AI key is not one of the file's problems; it has its own queue; the spot check never picks it
    expect(queueOf([subject]).map((entry) => entry.uid)).not.toContain('f1:2');
    expect(aiKeyQueue([subject]).map((entry) => [entry.uid, entry.problem])).toEqual([['f1:2', 'ai_key']]);
    expect(spotCheck([subject]).map((entry) => entry.item.uid)).not.toContain('f1:2');
    // the save carries the flag and the key as the student's
    const input = itemInputs(subject, 'imp-x').find((entry) => entry.ref === 'imp-x:2')!;
    expect(input).toMatchObject({ correct: [2], key_source: 'manual' });
    expect(input.flags).toContain('ai_key');
  });

  it('accepting keeps the key and its label; changing it drops the label', () => {
    const accept: ImportEdits = { ...NO_EDITS, items: { 'f1:2': { correct: [2], kind: 'single', aiKey: true, aiOk: true } } };
    const [accepted] = deriveSubjects([file('f1', ITEMS)], accept);
    const kept = accepted.test.find((item) => item.uid === 'f1:2')!;
    expect([kept.problems, kept.aiKey, kept.flags.includes('ai_key')]).toEqual([[], true, true]);
    expect(aiKeyQueue([accepted])).toEqual([]);

    const change: ImportEdits = { ...NO_EDITS, items: { 'f1:2': { correct: [0], kind: 'single', aiKey: false, aiOk: false } } };
    const [changed] = deriveSubjects([file('f1', ITEMS)], change);
    const mine = changed.test.find((item) => item.uid === 'f1:2')!;
    expect([mine.correct, mine.problems, mine.aiKey, mine.flags.includes('ai_key'), mine.keySource]).toEqual([[0], [], undefined, false, 'manual']);
    expect(itemInputs(changed, 'imp-x').find((entry) => entry.ref === 'imp-x:2')!.flags).not.toContain('ai_key');
  });

  it('a failed request stops the run; what came before it stays', async () => {
    const subjects = deriveSubjects([file('f1', [q(1)], 'Сети'), file('f2', [q(1)], 'Базы данных')]);
    let calls = 0;
    const got: string[] = [];
    const outcome = await runKeysAi(keysAiCandidates(subjects, NO_EDITS), (fixes) => got.push(...Object.keys(fixes)), async (input) => {
      calls += 1;
      if (calls === 2) throw new ContainerApiError('ai_busy', 'ИИ сейчас занят.', { status: 429, detail: 'ИИ сейчас занят.' });
      return { results: input.questions.map((question) => ({ id: question.id, correct: [0], agree: true, sure: 'high' as const })), units: 5, spent_questions: 1 };
    });
    expect(got).toEqual(['f1:1']);
    expect([outcome.keyed, outcome.units, keysAiErrorLine(outcome.error)]).toEqual([1, 5, KEYS_AI_WORDS.busy]);
  });

  it('says each error in plain words', () => {
    const error = (code: string, status: number, message = 'x', detail: string | null = null) => new ContainerApiError(code, message, { status, detail });
    expect(keysAiErrorLine(error('ai_limit', 429, 'Дневной лимит ИИ на сегодня исчерпан.'))).toBe(KEYS_AI_WORDS.limit);
    expect(keysAiErrorLine(error('ai_busy', 429, 'ИИ сейчас занят.'))).toBe(KEYS_AI_WORDS.busy);
    expect(keysAiErrorLine(error('unknown', 502, 'Сервер не ответил.', 'ai_failed'))).toBe(KEYS_AI_WORDS.failed);
    expect(keysAiErrorLine(error('bad_request', 422, 'Вопрос 3: текст длиннее 2000 знаков.'))).toBe(KEYS_AI_WORDS.badRequest);
    expect(keysAiErrorLine(error('too_big', 413, 'Слишком большой запрос.'))).toBe(KEYS_AI_WORDS.tooBig);
    expect(keysAiErrorLine(error('http_429', 429, 'На сегодня предел этой функции исчерпан — он обновится завтра.'))).toBe(
      'На сегодня предел этой функции исчерпан — он обновится завтра.',
    );
    expect(keysAiErrorLine(error('network', 0, 'Нет сети.'))).toBe(KEYS_AI_WORDS.network);
    expect(keysAiErrorLine(new Error('boom'))).toBe(KEYS_AI_WORDS.failed);
  });
});
