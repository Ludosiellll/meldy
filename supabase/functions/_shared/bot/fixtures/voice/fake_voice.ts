// The voice stage in memory for voice.test.ts (package T10): the bot_voice_* functions of
// supabase/migrations/20261010120006_telegram_bot_voice.sql on the fake database (`fdb.on`), the Space's single-use
// take and refund (bridge_voice_take / bridge_voice_refund), a fake Space (backend/bot_bridge.py: POST /api/bot/voice)
// and Telegram's file server. Statuses and shapes follow the SQL (supabase/tests/local/telegram_bot_voice.sql checks the
// SQL itself). The exam is the spec's invented «Осенняя сессия»: the oral exam of «Операционные системы».
import { createHash } from 'node:crypto';
import type { FakeDb } from '../fake_db.ts';
import { CID, SUBJECT_IDS, SUBJECTS } from '../scenario.ts';

export const SPACE = 'https://ludosiel-studyforge.hf.space';
export const OS_SUBJECT = SUBJECT_IDS[2];
export const OS_TITLE = SUBJECTS[2]; // «Операционные системы»
export const ORAL_EXAM = 'f0f0c3d4-0000-4000-8000-000000000301';
export const Q9 = 'f1f1c3d4-0000-4000-8000-000000000009';
export const Q10 = 'f1f1c3d4-0000-4000-8000-000000000010';
export const Q11 = 'f1f1c3d4-0000-4000-8000-000000000011';
/** A question of the session with no written points (the sheet has no rubric for it). */
export const Q12 = 'f1f1c3d4-0000-4000-8000-000000000012';
export const MAT1 = 'f2f2c3d4-0000-4000-8000-000000000001';
export const MAT2 = 'f2f2c3d4-0000-4000-8000-000000000002';
export const MATERIALS = [
  { key: 'M1', material_id: MAT1, title: 'Лекция 4. Взаимоблокировки' },
  { key: 'M2', material_id: MAT2, title: 'Лекция 5. Управление ресурсами' },
];

interface Point { id: string; title: string; essential: boolean; source_quote: string; source_ids: string[]; followup: { question: string; expected: string } }
interface Question { id: string; label: string; text: string; hash: string; rubricId: string | null; points: Point[] }

const fu = (question: string, expected: string) => ({ question, expected });
export const QUESTIONS: Record<string, Question> = {
  [Q9]: {
    id: Q9, label: '9', text: 'Взаимоблокировка: условия возникновения и способы предотвращения.', hash: 'a9'.padEnd(32, '0'),
    rubricId: 'f3f3c3d4-0000-4000-8000-000000000009',
    points: [
      { id: 'p1', title: 'Взаимное исключение: ресурс занят одним процессом', essential: true, source_quote: 'Ресурс в каждый момент занят не более чем одним процессом.', source_ids: ['M1:S03'], followup: fu('Что значит, что ресурс неразделяемый?', 'Им владеет только один процесс.') },
      { id: 'p2', title: 'Удержание и ожидание: процесс держит ресурс и ждёт другой', essential: true, source_quote: 'Процесс удерживает полученные ресурсы и ждёт новые.', source_ids: ['M1:S04'], followup: fu('Что делает процесс, которому не хватает ресурса?', 'Ждёт, не отпуская свои.') },
      { id: 'p3', title: 'Круговое ожидание: цепочка процессов ждёт друг друга', essential: true, source_quote: 'Процессы образуют цепочку, где каждый ждёт ресурс следующего.', source_ids: ['M1:S05', 'M1:S06'], followup: fu('Какие условия должны выполняться одновременно, чтобы возникла взаимоблокировка?', 'Взаимное исключение, удержание и ожидание, отсутствие вытеснения и круговое ожидание.') },
      { id: 'p4', title: 'Предотвращение: нарушить одно из условий', essential: false, source_quote: 'Достаточно исключить одно из необходимых условий.', source_ids: ['M2:S11'], followup: fu('Как предотвратить взаимоблокировку?', 'Нарушить одно из условий.') },
    ],
  },
  [Q10]: {
    id: Q10, label: '10', text: 'Планирование процессов: вытесняющие и невытесняющие алгоритмы.', hash: 'b10'.padEnd(32, '0'),
    rubricId: 'f3f3c3d4-0000-4000-8000-000000000010',
    points: [
      { id: 'p1', title: 'Вытесняющее планирование прерывает процесс по таймеру', essential: true, source_quote: 'Планировщик может прервать процесс.', source_ids: ['M2:S02'], followup: fu('Кто прерывает процесс при вытеснении?', 'Планировщик по таймеру.') },
      { id: 'p2', title: 'Невытесняющее ждёт, пока процесс сам отдаст процессор', essential: true, source_quote: 'Процесс сам освобождает процессор.', source_ids: ['M2:S03'], followup: fu('Когда процесс отдаёт процессор без вытеснения?', 'Сам, по завершении или ожиданию.') },
      { id: 'p3', title: 'Квант времени', essential: false, source_quote: 'Каждому процессу выделяется квант.', source_ids: ['M2:S04'], followup: fu('Что такое квант?', 'Отрезок времени процессора.') },
    ],
  },
  [Q11]: {
    id: Q11, label: '11', text: 'Виртуальная память: страничная организация и замещение страниц.', hash: 'c11'.padEnd(32, '0'),
    rubricId: 'f3f3c3d4-0000-4000-8000-000000000011',
    points: [
      { id: 'p1', title: 'Память делится на страницы одного размера', essential: true, source_quote: 'Адресное пространство делится на страницы.', source_ids: ['M2:S07'], followup: fu('Как делится адресное пространство?', 'На страницы одного размера.') },
      { id: 'p2', title: 'Таблица страниц переводит адреса', essential: true, source_quote: 'Таблица страниц отображает виртуальные адреса.', source_ids: ['M2:S08'], followup: fu('Что делает таблица страниц?', 'Переводит виртуальный адрес в физический.') },
    ],
  },
  [Q12]: { id: Q12, label: '12', text: 'Файловые системы: журналирование и восстановление после сбоя.', hash: 'd12'.padEnd(32, '0'), rubricId: null, points: [] },
};

type Phase = 'asked' | 'answering' | 'followup' | 'ready' | 'self' | 'done' | 'rated' | 'closed';
const OPEN: Phase[] = ['asked', 'answering', 'followup', 'ready', 'self'];

interface AttemptRow {
  id: number;
  aid: string;
  userId: string;
  containerId: string;
  subjectId: string;
  examId: string;
  questionId: string;
  queue: string[];
  pos: number;
  localDay: string;
  subjectTitle: string;
  phase: Phase;
  parts: Array<{ text?: string; seconds: number; message_id: number | null }>;
  seconds: number;
  checked: { statuses: unknown; protocol: unknown } | null;
  followup: Record<string, unknown> | null;
  chargeId: string | null;
  charged: number;
  busyUntil: number | null;
  sessionId: string | null;
  messages: Record<string, number>;
  updatedAt: number;
}

interface TicketRow { hash: string; attemptId: number; userId: string; job: 'transcribe' | 'check' | 'followup'; seconds: number; expiresAt: number; takenAt: number | null; chargeId: string | null; charged: number; refunded: boolean }

export interface VoiceWorldOptions {
  now: () => number;
  on?: boolean;
  /** AI units: the day's limit and what is used (left = limit − used). */
  limit?: number;
  used?: number;
  /** Seconds of voice already counted today: this student's and everyone's. */
  audioUsed?: number;
  audioAll?: number;
  daySeconds?: number;
  stopSeconds?: number;
}

/** The voice stage's tables and functions over a fake database. */
export function voiceWorld(fdb: FakeDb, options: VoiceWorldOptions) {
  const now = options.now;
  const world = {
    on: options.on ?? true,
    limit: options.limit ?? 100,
    used: options.used ?? 13,
    price: 4,
    audioUsed: options.audioUsed ?? 0,
    audioAll: options.audioAll ?? 0,
    daySeconds: options.daySeconds ?? 1800,
    stopSeconds: options.stopSeconds ?? 20160,
    attempts: [] as AttemptRow[],
    tickets: new Map<string, TicketRow>(),
    records: [] as Array<{ aid: string; how: string; attempt: Record<string, unknown> }>,
    peeks: [] as string[],
    ratings: [] as Array<{ aid: string; rating: string }>,
    charges: [] as Array<{ id: string; units: number; refunded: boolean }>,
    /** Exams of the user: an exam not here is «gone». */
    exams: new Set<string>([ORAL_EXAM]),
    /** T11's sheet read missing (meldy_private.oral_sheet_for): start answers not_ready. */
    notReady: false,
  };
  let nextId = 1;
  let nextAid = 0;
  let nextCharge = 1;
  let nextSession = 1;

  const iso = (ms: number) => new Date(ms).toISOString();
  const tomorrowUtc = () => {
    const d = new Date(now());
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  };
  const unitsJson = () => ({ left: Math.max(world.limit - world.used, 0), used: world.used, limit: world.limit, price: world.price, resets_at: iso(tomorrowUtc()) });
  const audioJson = () => ({ left_s: Math.max(world.daySeconds - world.audioUsed, 0), day_s: world.daySeconds, stop: world.audioAll >= world.stopSeconds });
  const linkOf = (tg: unknown) => (typeof tg === 'number' ? fdb.link(tg) : null);
  const localDayOf = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now()));
  const aidOk = (aid: unknown): aid is string => typeof aid === 'string' && /^[0-9a-z]{8}$/.test(aid);
  const mine = (userId: string, aid: unknown) => (aidOk(aid) ? world.attempts.find((a) => a.aid === aid && a.userId === userId) ?? null : null);
  const openOf = (userId: string) => world.attempts.find((a) => a.userId === userId && OPEN.includes(a.phase)) ?? null;
  const busy = (a: AttemptRow) => a.busyUntil !== null && a.busyUntil > now();

  function attemptJson(a: AttemptRow) {
    const q = QUESTIONS[a.questionId];
    return {
      aid: a.aid, phase: a.phase, container_id: a.containerId, subject_id: a.subjectId, subject_title: a.subjectTitle, exam_id: a.examId,
      question_id: a.questionId, question: { text: q.text, label: q.label, position: Number(q.label), hash: q.hash },
      n: a.pos + 1, of: a.queue.length, has_next: a.pos + 1 < a.queue.length, rubric_id: q.rubricId, evidence_material_id: MAT1,
      points: q.points.map((p) => ({ id: p.id, title: p.title, essential: p.essential, source_quote: p.source_quote, source_ids: p.source_ids })),
      materials: MATERIALS, parts: a.parts, seconds: a.seconds, checked: a.checked, followup: a.followup, charged: a.charged,
      session_id: a.sessionId, messages: a.messages, busy: busy(a), local_day: a.localDay, updated_at: iso(a.updatedAt),
    };
  }

  /** bot.voice_open: the first question with points from pos on; closes the open one. */
  function open(link: NonNullable<ReturnType<typeof linkOf>>, s: { containerId: string; subjectId: string; examId: string; title: string; queue: string[]; pos: number }) {
    if (world.notReady) return { status: 'not_ready' };
    let pos = s.pos;
    while (pos < s.queue.length && !(QUESTIONS[s.queue[pos]]?.points.length > 0)) pos += 1;
    if (pos >= s.queue.length) return { status: 'empty' };
    for (const a of world.attempts) if (a.userId === link.userId && OPEN.includes(a.phase)) {
      a.phase = 'closed';
      a.parts = [];
    }
    nextAid += 1;
    const a: AttemptRow = {
      id: nextId++, aid: `vq${String(nextAid).padStart(6, '0')}`, userId: link.userId, containerId: s.containerId, subjectId: s.subjectId,
      examId: s.examId, questionId: s.queue[pos], queue: s.queue, pos, localDay: localDayOf(link.tz), subjectTitle: s.title.trim().slice(0, 200),
      phase: 'asked', parts: [], seconds: 0, checked: null, followup: null, chargeId: null, charged: 0, busyUntil: null, sessionId: null,
      messages: {}, updatedAt: now(),
    };
    world.attempts.push(a);
    return { status: 'ok', attempt: attemptJson(a), units: unitsJson(), audio: audioJson(), tz: link.tz };
  }

  // Every function: the switch, the link, then its own checks (as the SQL).
  const fn = (name: string, body: (link: NonNullable<ReturnType<typeof linkOf>>, args: Record<string, unknown>) => unknown) =>
    fdb.on(name, (args) => {
      if (!world.on) return name === 'bot_voice_state' ? { voice: false } : { status: 'off' };
      const link = linkOf(args.p_tg_user_id);
      if (!link) return name === 'bot_voice_state' ? { voice: true, linked: false } : { status: 'unlinked' };
      return body(link, args);
    });

  fn('bot_voice_state', (link) => {
    const a = openOf(link.userId);
    return { voice: true, linked: true, attempt: a ? attemptJson(a) : null, units: unitsJson(), audio: audioJson(), local_day: localDayOf(link.tz), tz: link.tz };
  });

  fn('bot_voice_start', (link, args) => {
    const ids = args.p_question_ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || typeof args.p_pos !== 'number' || args.p_pos < 0 || args.p_pos >= ids.length) return { status: 'invalid' };
    if (args.p_container_id !== CID || args.p_subject_id !== OS_SUBJECT || !world.exams.has(String(args.p_exam_id))) return { status: 'gone' };
    return open(link, { containerId: CID, subjectId: OS_SUBJECT, examId: String(args.p_exam_id), title: String(args.p_subject_title ?? ''), queue: ids as string[], pos: args.p_pos });
  });

  fn('bot_voice_next', (link, args) => {
    const a = mine(link.userId, args.p_aid);
    if (!aidOk(args.p_aid)) return { status: 'invalid' };
    if (!a || !['done', 'rated'].includes(a.phase)) return { status: 'gone' };
    const prev = attemptJson(a);
    if (a.pos + 1 >= a.queue.length) return { status: 'end', prev };
    const again = world.attempts.find((o) => o.userId === link.userId && OPEN.includes(o.phase) && o.queue === a.queue && o.pos > a.pos);
    if (again) return { status: 'ok', again: true, attempt: attemptJson(again), units: unitsJson(), audio: audioJson(), tz: link.tz, prev };
    return { ...open(link, { containerId: a.containerId, subjectId: a.subjectId, examId: a.examId, title: a.subjectTitle, queue: a.queue, pos: a.pos + 1 }), prev };
  });

  fn('bot_voice_sent', (link, args) => {
    if (!aidOk(args.p_aid) || !['v1', 'v2', 'v3', 'v4', 'voice'].includes(String(args.p_which))) return { status: 'invalid' };
    const a = mine(link.userId, args.p_aid);
    if (!a) return { status: 'gone' };
    if (args.p_message_id === null) delete a.messages[String(args.p_which)];
    else a.messages[String(args.p_which)] = Number(args.p_message_id);
    return { status: 'ok' };
  });

  fn('bot_voice_ticket', (link, args) => {
    const job = args.p_job;
    const seconds = Number(args.p_seconds ?? 0);
    if (!aidOk(args.p_aid) || !['transcribe', 'check', 'followup'].includes(String(job)) || (job !== 'check' && !(seconds >= 1 && seconds <= 3600))) return { status: 'invalid' };
    const a = mine(link.userId, args.p_aid);
    if (!a || (job === 'transcribe' && !['asked', 'answering'].includes(a.phase)) || (job === 'check' && (a.phase !== 'answering' || a.parts.length === 0))
      || (job === 'followup' && a.phase !== 'followup')) return { status: 'gone', phase: a?.phase ?? null };
    if (job === 'transcribe' && args.p_message_id != null && a.parts.some((p) => p.message_id === args.p_message_id)) return { status: 'duplicate', attempt: attemptJson(a) };
    if (busy(a)) return { status: 'busy' };
    if (job !== 'check') {
      const cost = Math.max(seconds, 10);
      if (world.audioUsed + cost > world.daySeconds) return { status: 'ceiling', audio: audioJson() };
      if (world.audioAll + cost > world.stopSeconds) return { status: 'stop', audio: audioJson() };
    }
    if ((job === 'transcribe' || (job === 'check' && a.chargeId === null)) && world.limit - world.used < world.price) return { status: 'limit', units: unitsJson() };
    const ticket = createHash('sha256').update(`ticket-${world.tickets.size + 1}-${a.aid}`).digest('hex');
    world.tickets.set(ticket, { hash: ticket, attemptId: a.id, userId: link.userId, job: job as TicketRow['job'], seconds: job === 'check' ? 0 : seconds, expiresAt: now() + 120_000, takenAt: null, chargeId: null, charged: 0, refunded: false });
    if (job !== 'transcribe') a.busyUntil = now() + 150_000;
    return { status: 'ok', ticket, expires_at: iso(now() + 120_000) };
  });

  fn('bot_voice_part', (link, args) => {
    const text = typeof args.p_text === 'string' ? args.p_text.trim() : '';
    if (!aidOk(args.p_aid) || !text) return { status: 'invalid' };
    const a = mine(link.userId, args.p_aid);
    if (!a || !['asked', 'answering'].includes(a.phase)) return { status: 'gone', phase: a?.phase ?? null };
    if (args.p_voice_message_id != null && a.parts.some((p) => p.message_id === args.p_voice_message_id)) return { status: 'ok', duplicate: true, attempt: attemptJson(a) };
    if (busy(a)) return { status: 'busy' };
    const total = a.parts.reduce((sum, p) => sum + (p.text ?? '').length, 0) + a.parts.length;
    if (total + text.length > 4000) return { status: 'too_long' };
    a.parts.push({ text, seconds: Number(args.p_seconds), message_id: (args.p_voice_message_id as number | null) ?? null });
    a.seconds += Number(args.p_seconds);
    a.phase = 'answering';
    a.updatedAt = now();
    if (args.p_voice_message_id != null) a.messages.voice = Number(args.p_voice_message_id);
    return { status: 'ok', attempt: attemptJson(a) };
  });

  fn('bot_voice_restart', (link, args) => {
    if (!aidOk(args.p_aid)) return { status: 'invalid' };
    const a = mine(link.userId, args.p_aid);
    if (!a || a.phase !== 'answering') return { status: 'gone', phase: a?.phase ?? null };
    if (busy(a)) return { status: 'busy' };
    const v2 = a.messages.v2 ?? null;
    delete a.messages.v2;
    a.parts = [];
    a.seconds = 0;
    a.phase = 'asked';
    a.updatedAt = now();
    return { status: 'ok', v2, attempt: attemptJson(a) };
  });

  fn('bot_voice_checked', (link, args) => {
    const r = args.p_result as Record<string, any> | null;
    if (!aidOk(args.p_aid) || !r || typeof r !== 'object' || !r.protocol || !Array.isArray(r.protocol.points) || !r.statuses || typeof r.statuses !== 'object') return { status: 'invalid' };
    const a = mine(link.userId, args.p_aid);
    if (!a || a.phase !== 'answering') return { status: 'gone', phase: a?.phase ?? null };
    const point = r.ask && typeof r.ask === 'object' ? QUESTIONS[a.questionId].points.find((p) => p.id === r.ask.point_id) : undefined;
    a.checked = { statuses: r.statuses, protocol: r.protocol };
    a.followup = point && point.followup.question ? { point_id: point.id, question: point.followup.question, expected: point.followup.expected } : null;
    a.phase = a.followup ? 'followup' : 'ready';
    a.busyUntil = null;
    a.updatedAt = now();
    return { status: 'ok', attempt: attemptJson(a) };
  });

  fn('bot_voice_followup', (link, args) => {
    if (!aidOk(args.p_aid) || !['covered', 'partial', 'missing', 'wrong'].includes(String(args.p_status)) || (args.p_judged != null && args.p_judged !== 'check')) return { status: 'invalid' };
    const a = mine(link.userId, args.p_aid);
    if (!a || a.phase !== 'followup' || !a.followup) return { status: 'gone', phase: a?.phase ?? null };
    a.followup = { ...a.followup, status: args.p_status, student_quote: String(args.p_quote ?? '').trim().slice(0, 160), judged_by: args.p_judged ?? null };
    a.phase = 'ready';
    a.busyUntil = null;
    a.updatedAt = now();
    return { status: 'ok', attempt: attemptJson(a) };
  });

  function refundAttempt(a: AttemptRow): number {
    const charge = world.charges.find((c) => c.id === a.chargeId);
    if (!charge || charge.refunded) return 0;
    charge.refunded = true;
    world.used -= charge.units;
    for (const t of world.tickets.values()) if (t.chargeId === a.chargeId) t.refunded = true;
    a.chargeId = null;
    a.charged = 0;
    return charge.units;
  }

  fn('bot_voice_release', (link, args) => {
    if (!aidOk(args.p_aid)) return { status: 'invalid' };
    const a = mine(link.userId, args.p_aid);
    if (!a) return { status: 'gone' };
    const back = a.chargeId !== null && a.checked === null && a.sessionId === null && a.charged > 0 ? refundAttempt(a) : 0;
    a.busyUntil = null;
    a.updatedAt = now();
    return { status: 'ok', refunded: back, attempt: attemptJson(a) };
  });

  fn('bot_voice_record', (link, args) => {
    if (!aidOk(args.p_aid) || !['checked', 'dont_know'].includes(String(args.p_how)) || !args.p_attempt || typeof args.p_attempt !== 'object') return { status: 'invalid' };
    const a = mine(link.userId, args.p_aid);
    if (!a) return { status: 'gone' };
    if (a.phase === 'done' && a.sessionId) return { status: 'ok', session_id: a.sessionId, duplicate: true, charged: a.charged, units: unitsJson(), attempt: attemptJson(a) };
    if ((args.p_how === 'checked' && a.phase !== 'ready') || (args.p_how === 'dont_know' && !['asked', 'answering'].includes(a.phase))) return { status: 'gone', phase: a.phase };
    const attempt = args.p_attempt as Record<string, unknown>;
    if (typeof attempt.score !== 'number' || typeof attempt.grade !== 'number') return { status: 'invalid' };
    world.records.push({ aid: a.aid, how: String(args.p_how), attempt });
    a.sessionId = `f4f4c3d4-0000-4000-8000-${String(nextSession++).padStart(12, '0')}`;
    a.phase = 'done';
    a.busyUntil = null;
    a.parts = a.parts.map((p) => ({ seconds: p.seconds, message_id: p.message_id }));
    a.updatedAt = now();
    return { status: 'ok', session_id: a.sessionId, duplicate: false, charged: a.charged, units: unitsJson(), attempt: attemptJson(a) };
  });

  fn('bot_voice_self', (link, args) => {
    if (!aidOk(args.p_aid)) return { status: 'invalid' };
    const a = mine(link.userId, args.p_aid);
    if (!a || !['asked', 'answering', 'self'].includes(a.phase)) return { status: 'gone', phase: a?.phase ?? null };
    if (a.phase === 'self') return { status: 'ok', attempt: attemptJson(a) };
    if (busy(a)) return { status: 'busy' };
    for (const p of QUESTIONS[a.questionId].points) world.peeks.push(`peek:${QUESTIONS[a.questionId].rubricId}:${p.id}`);
    a.phase = 'self';
    a.parts = [];
    a.seconds = 0;
    a.updatedAt = now();
    return { status: 'ok', attempt: attemptJson(a) };
  });

  fn('bot_voice_rate', (link, args) => {
    if (!aidOk(args.p_aid) || !['know', 'unsure', 'dont_know'].includes(String(args.p_rating))) return { status: 'invalid' };
    const a = mine(link.userId, args.p_aid);
    if (!a || a.phase !== 'self') return { status: 'gone', phase: a?.phase ?? null };
    world.ratings.push({ aid: a.aid, rating: String(args.p_rating) });
    a.phase = 'rated';
    a.updatedAt = now();
    return { status: 'ok', attempt: attemptJson(a) };
  });

  /** bridge_voice_take: burns the ticket; counts the voice's seconds or charges the check; the job's context. */
  function take(ticket: string): Record<string, unknown> {
    if (!/^[0-9a-f]{64}$/.test(ticket)) return { status: 'invalid' };
    const t = world.tickets.get(ticket);
    if (!t) return { status: 'invalid' };
    if (t.takenAt !== null) return { status: 'used' };
    t.takenAt = now();
    const a = world.attempts.find((x) => x.id === t.attemptId);
    if (t.expiresAt <= now()) return { status: 'expired' };
    if (!world.on) return { status: 'off' };
    if (!a || (t.job === 'transcribe' && !['asked', 'answering'].includes(a.phase)) || (t.job === 'check' && a.phase !== 'answering')
      || (t.job === 'followup' && a.phase !== 'followup')) return { status: 'gone' };
    const q = QUESTIONS[a.questionId];
    if (t.job !== 'check') {
      const cost = Math.max(t.seconds, 10);
      if (world.audioUsed + cost > world.daySeconds) return { status: 'ceiling' };
      if (world.audioAll + cost > world.stopSeconds) return { status: 'stop' };
      world.audioUsed += cost;
      world.audioAll += cost;
    } else if (a.chargeId === null) {
      if (world.limit - world.used < world.price) return { status: 'limit' };
      const id = `charge-${nextCharge++}`;
      world.charges.push({ id, units: world.price, refunded: false });
      world.used += world.price;
      a.chargeId = id;
      a.charged = world.price;
      t.chargeId = id;
      t.charged = world.price;
    }
    if (t.job === 'transcribe') return { status: 'ok', job: 'transcribe', hint: q.text.slice(0, 300), min_words: a.parts.length === 0 ? 8 : 1 };
    if (t.job === 'check') {
      return {
        status: 'ok', job: 'check', question: q.text, transcript: a.parts.map((p) => p.text ?? '').join('\n').slice(0, 4000),
        points: q.points.map((p) => ({ id: p.id, title: p.title, essential: p.essential, source_quote: p.source_quote, followup: p.followup })),
        units: { charged: a.charged, left: world.limit - world.used },
      };
    }
    return { status: 'ok', job: 'followup', question: q.text, hint: String(a.followup?.question ?? ''), point_id: a.followup?.point_id, followup: { question: a.followup?.question, expected: a.followup?.expected }, points: q.points.map((p) => ({ id: p.id, title: p.title, essential: p.essential })) };
  }

  /** bridge_voice_refund: the check's units back, once, while nothing is stored. */
  function refund(ticket: string): Record<string, unknown> {
    const t = world.tickets.get(ticket);
    if (!t) return { status: 'invalid' };
    const a = world.attempts.find((x) => x.id === t.attemptId);
    if (t.job !== 'check' || t.takenAt === null || t.chargeId === null || t.refunded || !a || a.chargeId !== t.chargeId || a.checked !== null || a.sessionId !== null) return { status: 'no' };
    const back = refundAttempt(a);
    a.busyUntil = null;
    return { status: 'ok', refunded: back };
  }

  return Object.assign(world, { take, refund, attemptOf: (aid: string) => world.attempts.find((a) => a.aid === aid) ?? null, unitsLeft: () => world.limit - world.used });
}

export type VoiceWorld = ReturnType<typeof voiceWorld>;

// ─────────────────────────────────────────── the Space and Telegram's files ───────────────────────────────────────────

export interface SpaceRequest { url: string; headers: Record<string, string>; bytes: number; ticket: string; status: string }

/** What the fake Space answers per job after a successful take (each queue entry is used once, then the default). */
export interface SpaceScript {
  transcribe: Array<Record<string, unknown>>;
  check: Array<Record<string, unknown>>;
  followup: Array<Record<string, unknown>>;
  /** The Space cannot be reached (once per entry). */
  down: number;
}

/** The check of the spec's example: two main points named, the third only mentioned, the fourth missed; asks about p3. */
export const CHECK_RESULT = {
  status: 'ok',
  statuses: { p1: 'covered', p2: 'covered', p3: 'partial', p4: 'missing' },
  ask: { point_id: 'p3' },
  protocol: {
    points: [
      { id: 'p1', status: 'covered', student_quote: 'ресурс может взять только один процесс', comment: 'Названо.' },
      { id: 'p2', status: 'covered', student_quote: 'держит свой ресурс и ждёт чужой', comment: 'Названо.' },
      { id: 'p3', status: 'partial', student_quote: 'процессы ждут друг друга', comment: 'Без цепочки.' },
      { id: 'p4', status: 'missing', student_quote: '', comment: '' },
    ],
    errors: [],
    verdict: 'Назовите, что условия выполняются одновременно.',
  },
};

export const ANSWER_TEXT = 'Взаимоблокировка — это когда процессы ждут ресурсы, занятые друг другом, и никто не может продолжить работу.';

/** A fetch for the function's own downloads and the Space: Telegram's file URL and POST <Space>/api/bot/voice. */
export function fakeVoiceNet(world: VoiceWorld, token: string) {
  const script: SpaceScript = { transcribe: [], check: [], followup: [], down: 0 };
  const space: SpaceRequest[] = [];
  const files: string[] = [];
  /** Telegram's file server: these paths fail (once each) with a network error whose message carries the URL. */
  const fileFailures: string[] = [];
  let fileBytes = 4096;

  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.startsWith('https://api.telegram.org/file/bot')) {
      const m = /^https:\/\/api\.telegram\.org\/file\/bot([^/]+)\/(.+)$/.exec(url);
      if (!m || m[1] !== token) throw new Error('fake files: wrong token');
      files.push(m[2]);
      const failure = fileFailures.indexOf(m[2]);
      if (failure >= 0) {
        fileFailures.splice(failure, 1);
        throw new TypeError(`error sending request for url (${url}): connection reset`);
      }
      const bytes = new Uint8Array(fileBytes);
      bytes.set([0x4f, 0x67, 0x67, 0x53]);
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'audio/ogg', 'Content-Length': String(fileBytes) } });
    }
    if (url === `${SPACE}/api/bot/voice`) {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      const body = init?.body;
      const bytes = body instanceof Uint8Array ? body.length : body ? -1 : 0;
      const ticket = headers['x-meldy-ticket'] ?? '';
      const answer = (status: string, extra: Record<string, unknown> = {}, http = 200) => {
        space.push({ url, headers, bytes, ticket, status });
        return Response.json({ status, ...extra }, { status: http });
      };
      if (script.down > 0) {
        script.down -= 1;
        space.push({ url, headers, bytes, ticket, status: 'down' });
        throw new TypeError('fetch failed');
      }
      if (!/^[0-9a-f]{64}$/.test(ticket)) return answer('invalid', {}, 400);
      const context = world.take(ticket);
      if (context.status !== 'ok') return answer(String(context.status));
      if (context.job !== 'check') {
        if (headers['content-type'] !== 'audio/ogg') return answer('bad_audio', {}, 415);
        if (bytes > 20 * 1024 * 1024) return answer('too_large', {}, 413);
      }
      if (context.job === 'transcribe') {
        const next = script.transcribe.shift() ?? { status: 'ok', text: ANSWER_TEXT };
        return answer(String(next.status), next);
      }
      if (context.job === 'check') {
        const next = script.check.shift() ?? CHECK_RESULT;
        if (next.status !== 'ok') world.refund(ticket);
        return answer(String(next.status), next);
      }
      const next = script.followup.shift() ?? { status: 'ok', text: 'Нужно, чтобы все четыре условия выполнялись одновременно.', followup_status: 'covered', judged_by: 'check' };
      return answer(String(next.status), next);
    }
    throw new Error('fake voice net: unexpected URL');
  };

  return {
    fetch,
    script,
    space,
    files,
    fileFailures,
    setFileBytes(n: number) {
      fileBytes = n;
    },
  };
}
