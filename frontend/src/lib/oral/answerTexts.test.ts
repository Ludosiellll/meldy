import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; op: string; values?: unknown; options?: unknown; filters: Array<[string, unknown]> };

const db = vi.hoisted(() => ({
  consent: null as null | { granted: boolean; version: number },
  consentError: null as null | { code: string },
  insertError: null as null | { code: string },
  upsertError: null as null | { code: string },
  deleteError: null as null | { code: string },
  countError: null as null | { code: string },
  count: 0,
  fromThrows: false,
  calls: [] as Call[],
}));

vi.mock('../supabase', () => ({
  supabase: {
    from(table: string) {
      if (db.fromThrows) throw new Error('client broken');
      const call: Call = { table, op: '', filters: [] };
      db.calls.push(call);
      const builder = {
        select(_columns: string, options?: unknown) {
          call.op = 'select';
          call.options = options;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(db.consentError ? { data: null, error: db.consentError } : { data: db.consent, error: null });
        },
        insert(values: unknown) {
          call.op = 'insert';
          call.values = values;
          return Promise.resolve({ error: db.insertError });
        },
        upsert(values: unknown, options: unknown) {
          call.op = 'upsert';
          call.values = values;
          call.options = options;
          return Promise.resolve({ error: db.upsertError });
        },
        delete() {
          call.op = 'delete';
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const result = call.op === 'delete' ? { error: db.deleteError } : { count: db.countError ? null : db.count, error: db.countError };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  },
}));

import {
  ANSWER_TEXT_CONSENT_TEXT,
  ANSWER_TEXT_CONSENT_VERSION,
  ANSWER_TEXT_MAX_CHARS,
  countAnswerTexts,
  deleteAnswerTexts,
  forgetAnswerTextConsent,
  onAnswerTextConsent,
  readAnswerTextConsent,
  saveAnswerText,
  setAnswerTextConsent,
} from './answerTexts';

const USER = 'user-1';
const EXAM = '0a000000-0000-4000-8000-000000000001';
const SESSION = '5e000000-0000-4000-8000-000000000001';
const HASH = '0123456789abcdef0123456789abcdef';

function record(overrides: Partial<Parameters<typeof saveAnswerText>[0]> = {}) {
  return {
    userId: USER,
    attemptId: 'attempt-0001',
    sessionId: SESSION,
    examId: EXAM,
    questionHash: HASH,
    input: 'speech' as const,
    text: '  Обучение сети — это подбор весов.  ',
    ...overrides,
  };
}

beforeEach(() => {
  forgetAnswerTextConsent();
  Object.assign(db, {
    consent: null, consentError: null, insertError: null, upsertError: null, deleteError: null, countError: null,
    count: 0, fromThrows: false, calls: [],
  });
});

describe('the consent', () => {
  it('is the student’s answer to the current consent text', async () => {
    expect(await readAnswerTextConsent(USER)).toBe('unknown');
    forgetAnswerTextConsent();
    db.consent = { granted: true, version: ANSWER_TEXT_CONSENT_VERSION };
    expect(await readAnswerTextConsent(USER)).toBe('granted');
    forgetAnswerTextConsent();
    db.consent = { granted: false, version: ANSWER_TEXT_CONSENT_VERSION };
    expect(await readAnswerTextConsent(USER)).toBe('declined');
    forgetAnswerTextConsent();
    db.consent = { granted: true, version: ANSWER_TEXT_CONSENT_VERSION + 1 }; // another text: asked again
    expect(await readAnswerTextConsent(USER)).toBe('unknown');
    expect(db.calls[0]).toMatchObject({ table: 'oral_answer_consent', op: 'select', filters: [['user_id', USER]] });
    expect(ANSWER_TEXT_CONSENT_TEXT).toBe(
      'Помогите проверить точность Meldy: разрешите сохранять текст ваших ответов. Имя к ним не прикладывается, удалить можно в профиле.',
    );
  });

  it('is read once per account, and a failed read is not remembered', async () => {
    db.consentError = { code: 'PGRST205' }; // no table yet
    await expect(readAnswerTextConsent(USER)).rejects.toThrow();
    db.consentError = null;
    db.consent = { granted: true, version: ANSWER_TEXT_CONSENT_VERSION };
    expect(await readAnswerTextConsent(USER)).toBe('granted');
    expect(await readAnswerTextConsent(USER)).toBe('granted');
    expect(db.calls).toHaveLength(2);
    expect(await readAnswerTextConsent('user-2')).toBe('granted');
    expect(db.calls).toHaveLength(3);
  });

  it('is saved as an upsert by user_id without sending user_id, and every listener hears it', async () => {
    const heard: Array<[string, string]> = [];
    const stop = onAnswerTextConsent((who, consent) => heard.push([who, consent]));
    await setAnswerTextConsent(USER, true);
    expect(db.calls[0]).toMatchObject({
      table: 'oral_answer_consent',
      op: 'upsert',
      values: { granted: true, version: ANSWER_TEXT_CONSENT_VERSION },
      options: { onConflict: 'user_id' },
    });
    expect(db.calls[0].values).not.toHaveProperty('user_id');
    expect(await readAnswerTextConsent(USER)).toBe('granted'); // remembered, not read again
    expect(db.calls).toHaveLength(1);
    db.upsertError = { code: '42501' };
    await expect(setAnswerTextConsent(USER, false)).rejects.toThrow();
    expect(await readAnswerTextConsent(USER)).toBe('granted');
    stop();
    expect(heard).toEqual([[USER, 'granted']]);
  });
});

describe('the text of a saved answer', () => {
  it('is stored only with a granted consent', async () => {
    expect(await saveAnswerText(record())).toBe(false);
    expect(db.calls.filter((call) => call.op === 'insert')).toEqual([]);
    forgetAnswerTextConsent();
    db.consent = { granted: false, version: ANSWER_TEXT_CONSENT_VERSION };
    expect(await saveAnswerText(record())).toBe(false);
    expect(await saveAnswerText(record({ userId: null }))).toBe(false);
    expect(db.calls.filter((call) => call.op === 'insert')).toEqual([]);
  });

  it('goes with its attempt, session, exam and question, never with the account', async () => {
    db.consent = { granted: true, version: ANSWER_TEXT_CONSENT_VERSION };
    expect(await saveAnswerText(record())).toBe(true);
    const insert = db.calls.find((call) => call.op === 'insert');
    expect(insert).toMatchObject({ table: 'oral_answer_texts' });
    expect(insert?.values).toEqual({
      exam_id: EXAM,
      question_hash: HASH,
      attempt_id: 'attempt-0001',
      session_id: SESSION,
      input: 'speech',
      text: 'Обучение сети — это подбор весов.',
      consent_version: ANSWER_TEXT_CONSENT_VERSION,
    });
    // An exam id or session that is not a uuid is left out rather than refused.
    await saveAnswerText(record({ attemptId: 'attempt-0002', examId: 'demo', sessionId: null }));
    expect(db.calls.filter((call) => call.op === 'insert')[1].values).toMatchObject({ exam_id: null, session_id: null });
  });

  it('keeps at most 20 000 characters and skips what cannot be stored', async () => {
    db.consent = { granted: true, version: ANSWER_TEXT_CONSENT_VERSION };
    await saveAnswerText(record({ text: 'а'.repeat(ANSWER_TEXT_MAX_CHARS + 50) }));
    expect((db.calls.find((call) => call.op === 'insert')?.values as { text: string }).text).toHaveLength(ANSWER_TEXT_MAX_CHARS);
    expect(await saveAnswerText(record({ text: '   ' }))).toBe(false);
    expect(await saveAnswerText(record({ questionHash: 'not-a-hash' }))).toBe(false);
    expect(await saveAnswerText(record({ attemptId: 'x' }))).toBe(false);
    expect(db.calls.filter((call) => call.op === 'insert')).toHaveLength(1);
  });

  it('a text already stored for the attempt counts as stored; any other failure is a quiet false', async () => {
    db.consent = { granted: true, version: ANSWER_TEXT_CONSENT_VERSION };
    db.insertError = { code: '23505' };
    expect(await saveAnswerText(record())).toBe(true);
    db.insertError = { code: '42501' };
    expect(await saveAnswerText(record())).toBe(false);
    db.fromThrows = true;
    expect(await saveAnswerText(record())).toBe(false);
  });
});

describe('the student’s own texts in «Профиль»', () => {
  it('are counted and deleted by the account', async () => {
    db.count = 7;
    expect(await countAnswerTexts(USER)).toBe(7);
    expect(db.calls[0]).toMatchObject({ table: 'oral_answer_texts', op: 'select', options: { count: 'exact', head: true }, filters: [['user_id', USER]] });
    await deleteAnswerTexts(USER);
    expect(db.calls[1]).toMatchObject({ table: 'oral_answer_texts', op: 'delete', filters: [['user_id', USER]] });
    db.countError = { code: '42501' };
    await expect(countAnswerTexts(USER)).rejects.toThrow();
    db.deleteError = { code: '42501' };
    await expect(deleteAnswerTexts(USER)).rejects.toThrow();
  });
});
