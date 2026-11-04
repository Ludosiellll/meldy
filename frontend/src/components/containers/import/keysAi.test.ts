import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/containers')>()),
  keysAi: vi.fn(),
}));

import { ContainerApiError, type KeysAiQuestion, type KeysAiResponse } from '../../../api/containers';
import { keysAiCost } from '../../../lib/plans';
import type { BankItem, BankParseResult } from '../../../types/container';
import type { TestItem } from '../../../types/container';
import { KEYS_AI_WORDS } from '../copyImport';
import { joinPlans, joinTargets } from './updateModel';
import { aiKeyQueue, deriveSubjects, itemInputs, NO_EDITS, queueOf, spotCheck, type ImportEdits, type ImportFile } from './importModel';
import {
  KEYS_AI_MAX_BATCHES,
  keysAiBatchCount,
  keysAiBatches,
  keysAiCandidates,
  keysAiErrorLine,
  keysAiForJoins,
  keysAiPrice,
  keysAiRequestCost,
  runKeysAi,
} from './keysAi';

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
    expect([keysAiCost(100, 4), keysAiCost(100, 5), keysAiCost(12, 12), keysAiCost(300, 12)]).toEqual([5, 10, 15, 15]);
  });

  it('a subject joining the exam’s own sends only the questions it adds', () => {
    // variants 1 and 2 of «Сети»; the exam has «Вопрос 2?» already (without a key): only the new «Вопрос 3?» goes
    const variant = (id: string, n: number, items: BankItem[]): ImportFile => {
      const base = file(id, items, 'Сети');
      return { ...base, name: `Сети_Вариант_${n}.docx`, result: { ...base.result, variant: n } };
    };
    const subjects = deriveSubjects([variant('f1', 1, [q(2)]), variant('f2', 2, [q(3)])]);
    expect(subjects).toHaveLength(1);
    const targets = joinTargets(subjects, [{ id: 'sub-1', title: 'Сети' }]);
    const saved = [{
      id: 'i1', container_id: 'c-1', subject_id: 'sub-1', position: 1, file_no: '2', topic: 1, kind: 'single', stem: 'Вопрос 2?',
      options: ['один', 'два', 'три', 'четыре'], correct: [], answers: [], key_source: 'none', code: false, keep_order: false, flags: ['no_key'],
    }] as unknown as TestItem[];
    const joins = joinPlans(subjects, targets, { subjects: [{ id: 'sub-1', topic_titles: ['Вариант 1'] }], items: saved });
    expect(joins[subjects[0].key].plan.add.map((item) => item.text)).toEqual(['Вопрос 3?']);
    const all = keysAiCandidates(subjects, NO_EDITS);
    expect(all.map((candidate) => candidate.question.text)).toEqual(['Вопрос 2?', 'Вопрос 3?']);
    expect(keysAiForJoins(all, joins).map((candidate) => candidate.question.text)).toEqual(['Вопрос 3?']);
    expect(keysAiForJoins(all, {})).toEqual(all);
  });

  it('long questions: batches as the server makes them, at most 12 a request, priced by batches', () => {
    // 2000 characters and eight options of 500: one question per model batch (bank_keys_ai.make_batches)
    const long = (position: number) => q(position, { text: `${position} ${'я'.repeat(1990)}`, options: Array.from({ length: 8 }, (_, k) => `${k}${'v'.repeat(499)}`) });
    const subjects = deriveSubjects([file('f1', Array.from({ length: 13 }, (_, at) => long(at + 1)))]);
    const candidates = keysAiCandidates(subjects, NO_EDITS);
    expect(candidates).toHaveLength(13);
    expect(keysAiBatchCount(candidates.map((candidate) => candidate.question))).toBe(13);
    expect(keysAiBatches(candidates).map((batch) => batch.items.length)).toEqual([KEYS_AI_MAX_BATCHES, 1]);
    expect(keysAiPrice(candidates)).toBe(15 + 5);
    // ordinary questions: 25 to a batch, 300 a request; 60 are three batches (the server: 25, 25, 10)
    const plain = keysAiCandidates(deriveSubjects([file('f2', Array.from({ length: 60 }, (_, at) => q(at + 1)))]), NO_EDITS);
    expect(keysAiBatchCount(plain.map((candidate) => candidate.question))).toBe(3);
    expect(keysAiRequestCost(plain.map((candidate) => candidate.question))).toBe(5);
    // characters as the server counts them (code points): 920 emoji and ten options of 500 make two to a batch, 921 not
    const emoji = (n: number) => ({ id: `e${n}`, text: '😀'.repeat(n), options: Array.from({ length: 10 }, () => 'я'.repeat(500)), kind: 'single' as const });
    expect(keysAiBatchCount([emoji(920), emoji(920)])).toBe(1);
    expect(keysAiBatchCount([emoji(921), emoji(921)])).toBe(2);
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
    expect(outcome).toEqual({ sent: 2, keyed: 1, notes: { 'ответы ИИ разошлись': 1 }, units: 5, error: null, stale: 0 });
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

  it('a key the file gives after the run (the student picks «Ответ выделен жирным») wins over the AI’s', () => {
    // the file marks «три» in bold, but auto read no key; the AI suggested «один»
    const bare = q(2, { marks: { bold: [0, 0, 1, 0] } });
    const ai: ImportEdits['items'] = { 'f1:2': { correct: [0], kind: 'single', aiKey: true, aiOk: false } };
    const [before] = deriveSubjects([file('f1', [bare])], { ...NO_EDITS, items: ai });
    expect([before.test[0].correct, before.test[0].aiKey]).toEqual([[0], true]);
    const [bold] = deriveSubjects([file('f1', [bare])], { ...NO_EDITS, items: ai, files: { f1: { signal: 'bold' } } });
    const item = bold.test[0];
    expect([item.correct, item.aiKey, item.keySource, item.problems, item.flags.includes('ai_key')]).toEqual([[2], undefined, 'bold', [], false]);
    expect(aiKeyQueue([bold])).toEqual([]);
    expect(itemInputs(bold, 'imp-x')[0]).toMatchObject({ correct: [2], key_source: 'bold' });
    // a mark that gives no key leaves the AI's key as it was
    const [none] = deriveSubjects([file('f1', [q(2)])], { ...NO_EDITS, items: ai, files: { f1: { signal: 'bold' } } });
    expect([none.test[0].correct, none.test[0].aiKey]).toEqual([[0], true]);
  });

  it('the label survives a question with many flags: ai_key goes first, before the cut to 16', () => {
    const many = Array.from({ length: 20 }, (_, k) => `mark_${String.fromCharCode(97 + k)}`);
    const edits: ImportEdits = { ...NO_EDITS, items: { 'f1:2': { correct: [1], kind: 'single', aiKey: true, aiOk: false } } };
    const [subject] = deriveSubjects([file('f1', [q(2, { flags: ['no_key', ...many] })])], edits);
    const item = subject.test[0];
    expect(item.flags[0]).toBe('ai_key');
    expect(item.flags.length).toBeLessThanOrEqual(16);
    expect(itemInputs(subject, 'imp-x')[0].flags).toContain('ai_key');
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

  it('a request the server asks to wait for waits and goes again; the AI busy or the day spent stops the run', async () => {
    const subjects = deriveSubjects([file('f1', [q(1)], 'Сети'), file('f2', [q(1)], 'Базы данных')]);
    const candidates = keysAiCandidates(subjects, NO_EDITS);
    const waits: Array<number | null> = [];
    const slept: number[] = [];
    let calls = 0;
    const outcome = await runKeysAi(
      candidates,
      () => undefined,
      async (input) => {
        calls += 1;
        // «Слишком много запросов» of the minute's limit (no code), then another tab's request still running
        if (calls === 2) throw new ContainerApiError('http_429', 'Слишком много запросов.', { status: 429, retryAfter: '7' });
        if (calls === 3) throw new ContainerApiError('keys_running', 'Ключи уже подбираются.', { status: 429, retryAfter: '30' });
        return { results: input.questions.map((question) => ({ id: question.id, correct: [0], agree: true, sure: 'high' as const })), units: 5, spent_questions: 1 };
      },
      { onWait: (until) => waits.push(until), sleep: async (ms) => void slept.push(ms) },
    );
    expect([outcome.keyed, outcome.units, outcome.error, calls]).toEqual([2, 10, null, 4]);
    expect(slept).toEqual([7_000, 30_000]);
    expect(waits.filter((until) => until !== null)).toHaveLength(2);
    expect(waits[waits.length - 1]).toBeNull();

    const busy = await runKeysAi(candidates, () => undefined, async () => {
      throw new ContainerApiError('ai_busy', 'ИИ сейчас занят.', { status: 429, detail: 'ИИ сейчас занят.', retryAfter: '5' });
    }, { sleep: async () => undefined });
    expect([busy.sent, keysAiErrorLine(busy.error)]).toEqual([0, KEYS_AI_WORDS.busy]);
    const day = 'На сегодня предел этой функции исчерпан — он обновится завтра.';
    const spent = await runKeysAi(candidates, () => undefined, async () => {
      throw new ContainerApiError('http_429', day, { status: 429, retryAfter: '36000' });
    }, { sleep: async () => undefined });
    expect([spent.sent, keysAiErrorLine(spent.error)]).toEqual([0, day]);
  });

  it('an answer for a question that changed while the AI answered is dropped and counted', async () => {
    const subjects = deriveSubjects([file('f1', ITEMS)]);
    const got: Record<string, unknown> = {};
    const outcome = await runKeysAi(keysAiCandidates(subjects, NO_EDITS), (fixes) => Object.assign(got, fixes), async () => answer, {
      isFresh: (candidate) => candidate.uid !== 'f1:2',
    });
    expect(Object.keys(got)).toEqual(['f1:3']);
    expect([outcome.keyed, outcome.stale]).toEqual([0, 1]);
    expect(keysAiCandidates(subjects, NO_EDITS).map((candidate) => candidate.fileId)).toEqual(['f1', 'f1']);
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
    // the answer did not come: the server may have charged, and the line says so
    expect(KEYS_AI_WORDS.network).toMatch(/мог успеть .*списать единицы/);
    expect(keysAiErrorLine(error('keys_running', 429, 'Ключи уже подбираются.'))).toBe(KEYS_AI_WORDS.elsewhere);
    expect(keysAiErrorLine(new Error('boom'))).toBe(KEYS_AI_WORDS.failed);
  });
});
