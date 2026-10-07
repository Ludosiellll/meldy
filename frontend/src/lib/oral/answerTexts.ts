/**
 * The full text of an answer, kept with the student's consent (plan 2026-10-07, «Текст ответа с согласия»;
 * migration 20261007103621_oral_answer_texts.sql).
 *
 * The blind check of Meldy's accuracy needs whole answers, and the server keeps only quotes of up to 160
 * characters per point (record_oral_attempt). After an answer is saved, its text goes to
 * oral_answer_texts — only when the account's row in oral_answer_consent says yes to the current consent
 * text (ANSWER_TEXT_CONSENT_VERSION). The database checks the same (RLS), keeps one text per attempt and
 * lets nobody change one; the student deletes them in «Профиль». No name goes with a text: the owner's
 * export (docs/oral-answer-texts-export.sql) shows a salted hash instead of the account.
 *
 * Nothing here ever breaks saving the answer: a failed read or write is a quiet `false`. The Supabase
 * client is loaded on first use, as in oralPersistence (the example exam /try never loads it).
 */

export const ANSWER_TEXT_CONSENT_VERSION = 1;
export const ANSWER_TEXT_MAX_CHARS = 20_000;
/** The request itself, the first sentence of the consent text wherever it is asked. */
export const ANSWER_TEXT_CONSENT_ASK = 'Помогите проверить точность Meldy: разрешите сохранять текст ваших ответов.';
export const ANSWER_TEXT_CONSENT_TEXT = `${ANSWER_TEXT_CONSENT_ASK} Имя к ним не прикладывается, удалить можно в профиле.`;
/**
 * The same consent under the switch in «Профиль», where the student already is: the kept texts are deleted
 * right there (the row «Сохранено текстов ответов: N» with «Удалить»), not «в профиле».
 */
export const ANSWER_TEXT_PROFILE_TEXT = `${ANSWER_TEXT_CONSENT_ASK} Имя к ним не прикладывается, удалить их можно здесь.`;

/** granted / declined — the student answered the current consent text; unknown — not yet (or an older text). */
export type AnswerTextConsent = 'granted' | 'declined' | 'unknown';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUESTION_HASH = /^[0-9a-f]{32}$/;
const ATTEMPT_ID = /^[A-Za-z0-9_-]{8,64}$/;

let known: { userId: string; consent: AnswerTextConsent } | null = null;
const listeners = new Set<(userId: string, consent: AnswerTextConsent) => void>();

async function client() {
  const { supabase } = await import('../supabase');
  return supabase;
}

function remember(userId: string, consent: AnswerTextConsent): void {
  known = { userId, consent };
  for (const listener of Array.from(listeners)) listener(userId, consent);
}

/** The consent of this account; throws when it cannot be read (no table yet, no network). */
export async function readAnswerTextConsent(userId: string): Promise<AnswerTextConsent> {
  if (known && known.userId === userId) return known.consent;
  const supabase = await client();
  const { data, error } = await supabase.from('oral_answer_consent').select('granted, version').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('consent_read_failed');
  const row = data as { granted?: unknown; version?: unknown } | null;
  const consent: AnswerTextConsent =
    row && row.version === ANSWER_TEXT_CONSENT_VERSION ? (row.granted === true ? 'granted' : 'declined') : 'unknown';
  remember(userId, consent);
  return consent;
}

/**
 * Yes or no to the current consent text (one row per account); throws when it is not saved. user_id is not
 * sent: the row takes auth.uid(), and an upsert updates every column it sends, while nobody may update user_id.
 */
export async function setAnswerTextConsent(userId: string, granted: boolean): Promise<void> {
  const supabase = await client();
  const { error } = await supabase
    .from('oral_answer_consent')
    .upsert({ granted, version: ANSWER_TEXT_CONSENT_VERSION }, { onConflict: 'user_id' });
  if (error) throw new Error('consent_write_failed');
  remember(userId, granted ? 'granted' : 'declined');
}

/** Called with every consent read or change in this page's life (the exam page and «Профиль» agree). */
export function onAnswerTextConsent(listener: (userId: string, consent: AnswerTextConsent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forget what was read (a test, or another account signing in). */
export function forgetAnswerTextConsent(): void {
  known = null;
}

export interface AnswerTextRecord {
  userId: string | null;
  attemptId: string;
  /** exam_sessions row of the saved attempt (record_oral_attempt's session_id). */
  sessionId: string | null;
  examId: string | null;
  questionHash: string;
  input: 'speech' | 'text' | 'mixed';
  text: string;
}

/**
 * Stores the text of a saved answer when the student said yes; true when it is stored (or was stored by an
 * earlier try of the same attempt). Never throws.
 */
export async function saveAnswerText(record: AnswerTextRecord): Promise<boolean> {
  try {
    const text = typeof record.text === 'string' ? record.text.trim().slice(0, ANSWER_TEXT_MAX_CHARS) : '';
    if (!record.userId || !text || !QUESTION_HASH.test(record.questionHash) || !ATTEMPT_ID.test(record.attemptId)) return false;
    if ((await readAnswerTextConsent(record.userId)) !== 'granted') return false;
    const supabase = await client();
    const { error } = await supabase.from('oral_answer_texts').insert({
      exam_id: record.examId && UUID.test(record.examId) ? record.examId : null,
      question_hash: record.questionHash,
      attempt_id: record.attemptId,
      session_id: record.sessionId && UUID.test(record.sessionId) ? record.sessionId : null,
      input: record.input === 'speech' || record.input === 'mixed' ? record.input : 'text',
      text,
      consent_version: ANSWER_TEXT_CONSENT_VERSION,
    });
    if (!error) return true;
    return (error as { code?: unknown }).code === '23505'; // this attempt's text is already there
  } catch {
    return false;
  }
}

/** How many answer texts of this account are stored; throws when it cannot be read. */
export async function countAnswerTexts(userId: string): Promise<number> {
  const supabase = await client();
  const { count, error } = await supabase.from('oral_answer_texts').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (error) throw new Error('texts_count_failed');
  return typeof count === 'number' ? count : 0;
}

/** Deletes every stored answer text of this account; throws when they are not deleted. */
export async function deleteAnswerTexts(userId: string): Promise<void> {
  const supabase = await client();
  const { error } = await supabase.from('oral_answer_texts').delete().eq('user_id', userId);
  if (error) throw new Error('texts_delete_failed');
}
