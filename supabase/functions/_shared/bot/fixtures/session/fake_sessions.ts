// An in-memory model of T5's session functions (CONTRACT_T5.md; migration 20261010120003_telegram_bot_sessions.sql)
// for the session's tests: the same names, arguments, statuses and JSON shapes, plugged into T2's fake database
// (`fdb.on`). It keeps the SQL's rules that the function relies on: the user only through the link; the position and the
// pending answer; a right answer recorded at once (a short one stays until «Дальше»); wrong / «Не знаю» pending until
// «Дальше» / «Нажали не туда?» / «Отметить» / «Закончить» / the 30-minute flush; `repeat` and `old` (+ what the log has
// at that position); the requeue after a miss (only the current question's repeat may be added, with its order);
// gone and stale questions stepped over; counts and the figure as the summary reads them; one open session per user.
import type { FakeDb } from '../fake_db.ts';
import type { OpenSession } from '../../db.ts';
import type { PlanInputsWire } from '../../../plan/container.ts';
import { addDays, localDay } from '../../../plan/time.ts';
import { shortNorm } from '../../question.ts';
import { plain, type BankItem } from './bank.ts';

type Json = Record<string, unknown>;

interface Pending {
  pos: number;
  item_id: string;
  rev: number;
  kind: BankItem['kind'];
  choice: number[];
  chosen: number[];
  text: string | null;
  dont_know: boolean;
  correct: boolean;
  at: number;
  local_date: string;
  cls: string;
  retry: number;
  order: number[];
  recorded: boolean;
  misclick: boolean;
  doubt: boolean;
  status: string | null;
  step: string | null;
}

export interface Row {
  sid: string;
  user: string;
  linkId: number;
  chatId: number;
  messageId: number | null;
  containerId: string;
  subjectId: string;
  kind: 'plan' | 'errors' | 'extra';
  localDay: string;
  items: string[];
  retry: number[];
  cls: string[];
  shown: Array<{ o: number[]; r: number | null }>;
  shownAt: Array<number | null>;
  position: number;
  pending: Pending | null;
  pendingAt: number | null;
  counts: Record<string, number>;
  figure: { in_plan: number | null; two_days: number | null; gained: string[]; dropped: string[]; started: string[]; too_early: Record<string, Json> };
  status: 'open' | 'finished' | 'abandoned';
  examTitle: string;
  createdAt: number;
  activeAt: number;
  finishedAt: number | null;
}

export interface LoggedAnswer {
  user: string;
  cid: string;
  itemId: string;
  correct: boolean;
  misclick: boolean;
  retry: boolean;
  step: string;
  source: 'bot';
  chosen: number[];
  text: string | null;
  cls: string;
  ms: number | null;
}

const MIN = 60_000;
const SID = /^[0-9a-z]{8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLS = ['relearn', 'confirm', 'new_floor', 'confirm_ai', 'start_ai', 'check', 'final', 'new_fill', 'free'];
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const orderOk = (o: unknown, n: number): o is number[] =>
  Array.isArray(o) && o.length === n && o.every((x) => Number.isInteger(x) && x >= 0 && x < n) && new Set(o).size === n;
const identity = (n: number) => Array.from({ length: n }, (_, i) => i);

export function fakeSessions(fdb: FakeDb, options: { now: () => number }) {
  const now = options.now;
  const bank = new Map<string, BankItem>();
  const subjects = new Map<string, { containerId: string; title: string; topics: string[] }>();
  const containers = new Map<string, { title: string }>();
  const roles = new Map<string, 'owner' | 'member' | null>(); // `${user}|${container}`
  const sessions = new Map<string, Row>();
  const answers: LoggedAnswer[] = [];
  const doubts: Array<{ user: string; itemId: string; proposed: number[] }> = [];
  /** item → the step of its next clean right answer (start by default); `state` feeds too_early. */
  const steps = new Map<string, { step: string; state?: Json }>();
  /** user|item: in the figure before the answer (a miss drops it). */
  const inFigure = new Set<string>();
  const calls: Array<{ fn: string; args: Json }> = [];

  const linkOf = (tg: unknown) => fdb.link(Number(tg));
  const roleOf = (user: string, container: string) => {
    const key = `${user}|${container}`;
    return roles.has(key) ? roles.get(key) ?? null : containers.has(container) ? 'member' : null;
  };
  const keyed = (item: BankItem | undefined) => Boolean(item && (item.correct.length > 0 || item.answers.length > 0));
  const optionsN = (item: BankItem) => (item.kind === 'short' ? 0 : item.options.length);
  const count = (s: Row, key: string, by = 1) => {
    s.counts[key] = (s.counts[key] ?? 0) + by;
  };
  const add = (set: string[], id: string) => {
    if (!set.includes(id)) set.push(id);
  };

  /** Keeps T2's fake bot_today in step: the user's open session (raw row → OpenSession). */
  function syncToday(user: string) {
    const open = [...sessions.values()].find((s) => s.user === user && s.status === 'open') ?? null;
    const session: OpenSession | null = open
      ? {
          sid: open.sid, containerId: open.containerId, subjectId: open.subjectId, messageId: open.messageId, chatId: open.chatId,
          position: open.position, queue: open.items.map((id, i) => ({ id, retry: open.retry[i] as 0 | 1 | 2 })), localDay: open.localDay, kind: open.kind,
        }
      : null;
    fdb.setUser(user, { session });
  }

  // ─────────────── the helpers of the migration ───────────────

  function live(s: Row, tz: string, t: number, todayOnly: boolean) {
    return s.localDay >= localDay(t, tz) || (!todayOnly && s.activeAt > t - 30 * MIN);
  }

  function stamp(s: Row, t: number): Row {
    if (s.status !== 'open') return s;
    for (;;) {
      if (s.position >= s.items.length) {
        s.status = 'finished';
        s.finishedAt = t;
        s.pending = null;
        s.pendingAt = null;
        return s;
      }
      const item = bank.get(s.items[s.position]);
      if (item && item.containerId === s.containerId && keyed(item)) break;
      count(s, 'gone');
      s.position += 1;
      s.pending = null;
      s.pendingAt = null;
    }
    const item = bank.get(s.items[s.position]) as BankItem;
    const n = optionsN(item);
    const cell = s.shown[s.position] ?? { o: [], r: null };
    const order = orderOk(cell.o, n) ? cell.o : identity(n);
    const answered = s.pending !== null && s.pending.pos === s.position;
    s.shown[s.position] = { o: order, r: answered && typeof cell.r === 'number' ? cell.r : item.rev };
    if (s.shownAt[s.position] === null || s.shownAt[s.position] === undefined) s.shownAt[s.position] = t;
    return s;
  }

  /** meldy_private.record_test_answers_for for one bot answer (the rule's step from the test's settings). */
  function core(s: Row, p: Pending, misclick: boolean): Json {
    const cid = `tg:${s.sid}:${p.pos}`;
    const item = bank.get(p.item_id);
    if (answers.some((a) => a.user === s.user && a.cid === cid)) return { status: 'duplicate', item_id: p.item_id };
    if (!item || !keyed(item)) return { status: 'gone', item_id: p.item_id };
    if (item.rev !== p.rev) return { status: 'stale', item_id: p.item_id, rev: item.rev };
    let step: string;
    let state: Json | undefined;
    const wrongish = !p.correct;
    if (misclick && wrongish) step = 'misclick';
    else if (wrongish) step = 'miss';
    else if (p.retry > 0) step = 'training';
    else {
      const set = steps.get(p.item_id);
      step = set?.step ?? 'start';
      state = set?.state;
    }
    answers.push({
      user: s.user, cid, itemId: p.item_id, correct: p.correct, misclick: misclick && wrongish, retry: p.retry > 0, step, source: 'bot',
      chosen: p.chosen, text: p.text, cls: p.cls, ms: p.at && s.shownAt[p.pos] ? Math.min(180_000, Math.max(0, p.at - (s.shownAt[p.pos] as number))) : null,
    });
    return { status: 'saved', item_id: p.item_id, step, state: state ?? null, correct: p.correct };
  }

  function tally(s: Row, p: Pending, misclick: boolean, result: Json) {
    const status = String(result.status);
    const step = String(result.step ?? '');
    const id = p.item_id;
    if (status === 'saved' || status === 'late' || status === 'duplicate') {
      if (p.retry > 0) count(s, 'retries');
      else {
        count(s, 'questions');
        count(s, misclick ? 'misclick' : p.correct ? 'right' : p.dont_know ? 'dont_know' : 'wrong');
      }
      if (status === 'saved') {
        const f = s.figure;
        if (step === 'two_days') {
          add(f.gained, id);
          delete f.too_early[id];
        } else if (step === 'miss') {
          if (inFigure.has(`${s.user}|${id}`)) {
            inFigure.delete(`${s.user}|${id}`);
            if (f.gained.includes(id)) f.gained = f.gained.filter((x) => x !== id);
            else add(f.dropped, id);
          }
        } else if (step === 'too_early' && !f.gained.includes(id)) {
          const st = (result.state ?? {}) as Json;
          f.too_early[id] = { streak_at: st.streak_at ?? null, streak_day: st.streak_day ?? null, peek_day: st.peek_day ?? null };
        } else if (step === 'start') add(f.started, id);
      }
    } else if (status === 'stale') count(s, 'stale');
    else if (status === 'gone' || status === 'no_key' || status === 'conflict') count(s, 'gone');
  }

  function record(s: Row, misclick: boolean): Row {
    const p = s.pending;
    if (!p || p.recorded) return s;
    const result = core(s, p, misclick);
    tally(s, p, misclick, result);
    s.pending = { ...p, misclick, recorded: true, status: String(result.status), step: (result.step as string) ?? null };
    s.pendingAt = null;
    return s;
  }

  function close(s: Row, status: 'finished' | 'abandoned', rec: boolean, t: number): Row {
    if (rec) record(s, false);
    s.status = status;
    s.finishedAt = t;
    s.pendingAt = null;
    return s;
  }

  function logged(user: string, sid: string, pos: unknown): Json | null {
    if (pos === null || pos === undefined) return null;
    const a = answers.find((x) => x.user === user && x.cid === `tg:${sid}:${pos}`);
    return a ? { status: 'duplicate', correct: a.correct, dont_know: a.chosen.length === 0 && a.text === null, misclick: a.misclick, step: a.step } : null;
  }

  function counts(s: Row) {
    return { questions: 0, right: 0, wrong: 0, dont_know: 0, misclick: 0, retries: 0, skipped: 0, gone: 0, stale: 0, doubted: 0, ...s.counts };
  }

  function figure(s: Row) {
    const f = s.figure;
    return {
      in_plan: f.in_plan, two_days: f.two_days,
      now: typeof f.two_days === 'number' ? Math.max(0, f.two_days + f.gained.length - f.dropped.length) : null,
      gained: f.gained.length, dropped: f.dropped.length, started: f.started.length, too_early: Object.keys(f.too_early).length,
      too_early_states: Object.keys(f.too_early).sort().map((k) => f.too_early[k]),
    };
  }

  function sessionJson(s: Row, role: string | null, t: number): Json {
    const subject = subjects.get(s.subjectId);
    return {
      sid: s.sid, kind: s.kind, status: s.status, container_id: s.containerId, subject_id: s.subjectId,
      exam_title: containers.get(s.containerId)?.title ?? s.examTitle, subject_title: subject?.title ?? null, role,
      local_day: s.localDay, position: s.position, length: s.items.length,
      queue: s.items.map((id, i) => ({ id, retry: s.retry[i] })),
      answered: s.pending !== null && s.pending.pos === s.position,
      chat_id: s.chatId, message_id: s.messageId, counts: counts(s), figure: figure(s),
      created_at: iso(s.createdAt), active_at: iso(s.activeAt), finished_at: iso(s.finishedAt), now: iso(t),
    };
  }

  function viewJson(s: Row): Json | null {
    if (s.status !== 'open' || s.position >= s.items.length) return null;
    const item = bank.get(s.items[s.position]);
    if (!item) return null;
    const cell = s.shown[s.position] ?? { o: [], r: null };
    const order = item.kind === 'short' ? [] : cell.o;
    const p = s.pending;
    const review = p && p.pos === s.position
      ? {
          correct: p.correct, dont_know: p.dont_know, choice: p.choice, text: p.text,
          key: order.map((f, k) => (item.correct.includes(f) ? k : -1)).filter((k) => k >= 0),
          answers: item.answers, recorded: p.recorded, misclick: p.misclick, doubt: p.doubt, status: p.status, step: p.step,
          key_source: item.keySource, key_changed_at: item.rev > 1 ? item.updatedAt : null,
        }
      : null;
    return {
      pos: s.position, item_id: item.id, rev: cell.r ?? item.rev, kind: item.kind, code: item.code, keep_order: item.keepOrder,
      stem: item.stem, options: order.map((f) => item.options[f]), order, file_no: item.fileNo, number: item.position,
      topic: item.topicTitle ? 1 : null, topic_title: item.topicTitle, retry: s.retry[s.position], review,
    };
  }

  const save = (s: Row) => {
    sessions.set(s.sid, s);
    syncToday(s.user);
  };

  function reply(status: string, s: Row, role: string | null, t: number, extra: Json = {}): Json {
    return { status, ...extra, session: sessionJson(s, role, t), view: viewJson(s) };
  }

  function refusal(status: string, s: Row | null, role: string | null, t: number, extra: Json = {}): Json {
    const out: Json = { status, ...extra };
    if (status === 'unavailable' && s) out.exam_title = containers.get(s.containerId)?.title ?? s.examTitle;
    if (s && (status === 'ended' || status === 'unavailable')) {
      out.session = sessionJson(s, role, t);
      out.view = null;
    }
    return out;
  }

  function take(tg: unknown, sid: unknown, t: number, todayOnly: boolean) {
    const l = linkOf(tg);
    if (!l) return { status: 'unlinked' as const, s: null, l: null, role: null };
    l.lastSeenAt = t;
    if (typeof sid !== 'string' || !SID.test(sid)) return { status: 'not_found' as const, s: null, l, role: null };
    const s = sessions.get(sid);
    if (!s || s.user !== l.userId) return { status: 'not_found' as const, s: null, l, role: null };
    const role = roleOf(l.userId, s.containerId);
    if (s.status !== 'open') return { status: 'ended' as const, s, l, role };
    if (role === null) {
      close(s, 'abandoned', false, t);
      save(s);
      return { status: 'unavailable' as const, s, l, role };
    }
    if (!live(s, l.tz, t, todayOnly)) {
      close(s, 'abandoned', true, t);
      save(s);
      return { status: 'ended' as const, s, l, role };
    }
    return { status: 'ok' as const, s, l, role };
  }

  /** bot.session_requeue: the answered part and the current question as they are; only the current question's repeat added. */
  function requeue(s: Row, queue: unknown): Row | null {
    if (!Array.isArray(queue) || queue.length < 1 || queue.length > 60) return null;
    const pos = s.position;
    const cur = s.items[pos];
    const curRetry = s.retry[pos];
    const next: Row = { ...s, items: [], retry: [], cls: [], shown: [], shownAt: [] };
    const seen = new Set<string>();
    let last = -1;
    for (let k = 0; k < queue.length; k += 1) {
      const e = queue[k] as Json;
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !UUID.test(e.id)) return null;
      if ('retry' in e && !(e.retry === 0 || e.retry === 1 || e.retry === 2)) return null;
      const r = (e.retry as number | undefined) ?? 0;
      const key = `${e.id}:${r}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const idx = s.items.findIndex((id, i) => id === e.id && s.retry[i] === r);
      if (k <= pos && idx !== k) return null;
      if (idx >= 0) {
        if (idx <= last) return null;
        last = idx;
        next.items.push(s.items[idx]);
        next.retry.push(s.retry[idx]);
        next.cls.push(s.cls[idx]);
        next.shown.push(s.shown[idx]);
        next.shownAt.push(s.shownAt[idx]);
      } else {
        if (e.id !== cur || r !== curRetry + 1 || k <= pos) return null;
        const item = bank.get(e.id);
        if (!item) return null;
        const order = (e.shown ?? (optionsN(item) === 0 ? [] : undefined)) as unknown;
        if (!orderOk(order, optionsN(item))) return null;
        next.items.push(e.id);
        next.retry.push(r);
        next.cls.push(s.cls[pos]);
        next.shown.push({ o: order, r: null });
        next.shownAt.push(null);
      }
    }
    for (let i = pos + 1; i < s.items.length; i += 1) if (s.items[i] !== cur && !seen.has(`${s.items[i]}:${s.retry[i]}`)) return null;
    return next;
  }

  /** bot.session_drop: leaves out one question's repeat after `after` (positions up to it keep their meaning). */
  function drop(s: Row, after: number, id: string, retry: number) {
    const keep = s.items.map((_, i) => i).filter((i) => !(i > after && s.items[i] === id && s.retry[i] === retry));
    if (keep.length === s.items.length) return;
    s.items = keep.map((i) => s.items[i]);
    s.retry = keep.map((i) => s.retry[i]);
    s.cls = keep.map((i) => s.cls[i]);
    s.shown = keep.map((i) => s.shown[i]);
    s.shownAt = keep.map((i) => s.shownAt[i]);
  }

  // ─────────────── the functions ───────────────

  const fns: Record<string, (a: Json) => Json> = {
    bot_session_items(a) {
      const l = linkOf(a.p_tg_user_id);
      if (!l) return { status: 'unlinked' };
      const ids = a.p_item_ids;
      if (typeof a.p_container_id !== 'string' || !Array.isArray(ids) || ids.length < 1 || ids.length > 60) return { status: 'invalid', reason: 'arguments' };
      if (roleOf(l.userId, a.p_container_id) === null) return { status: 'unavailable' };
      return {
        status: 'ok',
        items: ids.map((id) => bank.get(String(id))).filter((i): i is BankItem => Boolean(i && i.containerId === a.p_container_id && keyed(i)))
          .map((i) => ({ id: i.id, subject_id: i.subjectId, kind: i.kind, keep_order: i.keepOrder, code: i.code, rev: i.rev, options: i.kind === 'short' ? [] : i.options })),
      };
    },

    bot_session_start(a) {
      const t = now();
      const l = linkOf(a.p_tg_user_id);
      if (!l) return { status: 'unlinked' };
      l.lastSeenAt = t;
      const sid = a.p_sid;
      const queue = a.p_queue;
      if (typeof sid !== 'string' || !SID.test(sid) || typeof a.p_container_id !== 'string' || typeof a.p_subject_id !== 'string'
        || !['plan', 'errors', 'extra'].includes(String(a.p_kind)) || !Array.isArray(queue) || queue.length < 1 || queue.length > 20
        || (a.p_message_id !== null && a.p_message_id !== undefined && !(Number(a.p_message_id) > 0))) {
        return { status: 'invalid', reason: 'arguments' };
      }
      const role = roleOf(l.userId, a.p_container_id);
      if (role === null) return { status: 'unavailable', exam_title: containers.get(a.p_container_id)?.title ?? null };
      const subject = subjects.get(a.p_subject_id);
      if (!subject || subject.containerId !== a.p_container_id) return { status: 'invalid', reason: 'subject' };
      const messageId = a.p_message_id === null || a.p_message_id === undefined ? null : Number(a.p_message_id);
      const existing = [...sessions.values()].find((s) => s.user === l.userId && s.status === 'open'
        && (s.sid === sid || (messageId !== null && s.chatId === l.chatId && s.messageId === messageId)));
      if (existing && live(existing, l.tz, t, false)) {
        stamp(existing, t);
        existing.activeAt = t;
        save(existing);
        return reply('ok', existing, role, t, { resumed: true, replaced: null });
      }
      if (sessions.has(sid)) return { status: 'conflict' };
      const items: string[] = [];
      const cls: string[] = [];
      const shown: Row['shown'] = [];
      for (const raw of queue) {
        const e = raw as Json;
        if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !UUID.test(e.id) || ('retry' in e && e.retry !== 0)
          || ('cls' in e && e.cls !== null && typeof e.cls !== 'string')) return { status: 'invalid', reason: 'queue' };
        if (items.includes(e.id)) return { status: 'invalid', reason: 'queue' };
        const item = bank.get(e.id);
        if (!item || item.subjectId !== a.p_subject_id || item.containerId !== a.p_container_id || !keyed(item)) continue;
        const n = optionsN(item);
        let order = (e.shown ?? (n === 0 ? [] : undefined)) as unknown;
        if (!orderOk(order, n)) {
          if (Array.isArray(order) && orderOk(order, order.length)) order = identity(n);
          else return { status: 'invalid', reason: 'shown' };
        }
        items.push(e.id);
        cls.push(typeof e.cls === 'string' && CLS.includes(e.cls) ? e.cls : 'free');
        shown.push({ o: order as number[], r: null });
      }
      if (items.length === 0) return { status: 'empty' };
      let replaced: Json | null = null;
      for (const old of sessions.values()) {
        if (old.user !== l.userId || old.status !== 'open') continue;
        // Its waiting answer is recorded as given while the link that started it is still active (as in the flush).
        close(old, 'abandoned', fdb.links.some((x) => x.id === old.linkId && x.unlinkedAt === null), t);
        save(old);
        replaced = { sid: old.sid, chat_id: old.chatId, message_id: old.messageId };
      }
      const f = a.p_figure as Json | null;
      const s: Row = {
        sid, user: l.userId, linkId: l.id, chatId: l.chatId, messageId, containerId: a.p_container_id, subjectId: a.p_subject_id,
        kind: a.p_kind as Row['kind'], localDay: localDay(t, l.tz), items, retry: items.map(() => 0), cls, shown,
        shownAt: items.map(() => null), position: 0, pending: null, pendingAt: null, counts: {},
        figure: { in_plan: typeof f?.in_plan === 'number' ? f.in_plan : null, two_days: typeof f?.two_days === 'number' ? f.two_days : null, gained: [], dropped: [], started: [], too_early: {} },
        status: 'open', examTitle: containers.get(a.p_container_id)?.title ?? '', createdAt: t, activeAt: t, finishedAt: null,
      };
      stamp(s, t);
      save(s);
      return reply('ok', s, role, t, { resumed: false, replaced });
    },

    bot_session_view(a) {
      const t = now();
      const tk = take(a.p_tg_user_id, a.p_sid, t, false);
      if (tk.status !== 'ok') return refusal(tk.status, tk.s, tk.role, t);
      const s = stamp(tk.s, t);
      s.activeAt = t;
      save(s);
      if (a.p_pos !== null && a.p_pos !== undefined && a.p_pos !== s.position) {
        return reply('old', s, tk.role, t, { answer: logged(s.user, s.sid, a.p_pos) });
      }
      return reply('ok', s, tk.role, t);
    },

    bot_session_answer(a) {
      const t = now();
      let sid = a.p_sid as string | null;
      if (sid === null || sid === undefined) {
        const l = linkOf(a.p_tg_user_id);
        if (!l) return { status: 'unlinked' };
        sid = [...sessions.values()].find((s) => s.user === l.userId && s.status === 'open')?.sid ?? null;
        if (!sid) return { status: 'no_question' };
      }
      const tk = take(a.p_tg_user_id, sid, t, false);
      if (tk.status !== 'ok') {
        if ((a.p_sid === null || a.p_sid === undefined) && tk.status === 'ended') return { status: 'no_question' };
        return refusal(tk.status, tk.s, tk.role, t, tk.status === 'ended' && a.p_pos !== null && a.p_pos !== undefined && tk.s ? { answer: logged(tk.s.user, sid, a.p_pos) } : {});
      }
      const s = tk.s;
      const typed = a.p_sid === null || a.p_sid === undefined;
      const pos = typed ? s.position : (a.p_pos as number | null);
      if (pos === null || pos === undefined || pos !== s.position) {
        stamp(s, t);
        s.activeAt = t;
        save(s);
        return reply('old', s, tk.role, t, { answer: logged(s.user, s.sid, pos) });
      }
      const item = bank.get(s.items[pos]);
      if (typed && (!item || item.kind !== 'short')) return { status: 'no_question' };
      if (s.pending && s.pending.pos === pos) return reply('repeat', s, tk.role, t);
      s.activeAt = t;
      const rev = s.shown[pos]?.r ?? item?.rev;
      if (!item || item.containerId !== s.containerId || !keyed(item) || rev !== item.rev) {
        const status = item && item.containerId === s.containerId && keyed(item) ? 'stale' : 'gone';
        count(s, status);
        s.position = pos + 1;
        stamp(s, t);
        save(s);
        return reply('ok', s, tk.role, t, { answer: { status } });
      }
      const n = optionsN(item);
      const order = orderOk(s.shown[pos]?.o, n) ? (s.shown[pos].o as number[]) : identity(n);
      const choice = a.p_choice as Json;
      const keys = choice && typeof choice === 'object' ? Object.keys(choice) : [];
      let dont = false;
      let shownIdx: number[] = [];
      let chosen: number[] = [];
      let text: string | null = null;
      if (keys.length !== 1) return reply('invalid', s, tk.role, t, { reason: 'choice' });
      if (keys[0] === 'dont_know' && choice.dont_know === true) dont = true;
      else if (keys[0] === 'i' && item.kind === 'single' && Number.isInteger(choice.i) && (choice.i as number) >= 0 && (choice.i as number) < n) {
        shownIdx = [choice.i as number];
        chosen = [order[choice.i as number]];
      } else if (keys[0] === 'mask' && item.kind === 'multiple' && Number.isInteger(choice.mask) && (choice.mask as number) >= 1 && (choice.mask as number) < 2 ** n) {
        shownIdx = identity(n).filter((k) => ((choice.mask as number) >> k) & 1);
        chosen = shownIdx.map((k) => order[k]).sort((x, y) => x - y);
      } else if (keys[0] === 'text' && item.kind === 'short' && typeof choice.text === 'string' && choice.text.length <= 1000 && shortNorm(choice.text) !== '') {
        text = choice.text;
      } else return reply('invalid', s, tk.role, t, { reason: 'choice' });
      let correct = false;
      if (!dont) {
        if (item.kind === 'short') correct = item.answers.some((f) => shortNorm(f) === shortNorm(text as string));
        else {
          const key = [...item.correct].sort((x, y) => x - y);
          correct = chosen.length > 0 && chosen.length === key.length && chosen.every((v, i) => v === key[i]);
        }
      }
      const l = tk.l;
      s.pending = {
        pos, item_id: item.id, rev: item.rev, kind: item.kind, choice: shownIdx, chosen, text, dont_know: dont, correct, at: t,
        local_date: localDay(t, l.tz), cls: s.cls[pos], retry: s.retry[pos], order, recorded: false, misclick: false, doubt: false, status: null, step: null,
      };
      let answer: Json;
      if (correct) {
        record(s, false);
        answer = { status: s.pending.status, correct: true, dont_know: false, step: s.pending.step };
        if (!['saved', 'late', 'duplicate'].includes(String(s.pending.status)) || item.kind !== 'short') {
          s.pending = null;
          s.position = pos + 1;
        }
        stamp(s, t);
      } else {
        s.pendingAt = t;
        answer = { status: 'pending', correct: false, dont_know: dont, step: null };
      }
      save(s);
      const fig = figure(s) as Json;
      delete fig.too_early_states;
      return reply('ok', s, tk.role, t, { answer: { ...answer, figure: fig } });
    },

    bot_session_resolve(a) {
      const t = now();
      const tk = take(a.p_tg_user_id, a.p_sid, t, false);
      if (tk.status !== 'ok') return refusal(tk.status, tk.s, tk.role, t);
      let s = tk.s;
      const pos = s.position;
      if (!['next', 'misclick', 'skip'].includes(String(a.p_action))) return reply('invalid', s, tk.role, t, { reason: 'action' });
      if (a.p_pos === null || a.p_pos === undefined || a.p_pos !== pos) {
        stamp(s, t);
        s.activeAt = t;
        save(s);
        return reply('old', s, tk.role, t, { answer: logged(s.user, s.sid, a.p_pos) });
      }
      const p = s.pending;
      const answered = p !== null && p.pos === pos;
      const cur = s.items[pos];
      const curRetry = s.retry[pos];
      if (a.p_action === 'misclick') {
        if (!answered || !p) return reply('invalid', s, tk.role, t, { reason: 'no_answer' });
        if (p.recorded) return reply('invalid', s, tk.role, t, { reason: 'recorded' });
        if (p.correct) return reply('invalid', s, tk.role, t, { reason: 'correct' });
        if (p.kind === 'short' && !p.dont_know) return reply('invalid', s, tk.role, t, { reason: 'typed' });
        s.activeAt = t;
        record(s, true);
        const answer = { status: s.pending?.status, correct: false, dont_know: s.pending?.dont_know, misclick: true, step: s.pending?.step };
        save(s);
        return reply('ok', s, tk.role, t, { answer });
      }
      if (a.p_action === 'skip') {
        if (answered) return reply('invalid', s, tk.role, t, { reason: 'answered' });
        s.activeAt = t;
        count(s, 'skipped');
        s.position = pos + 1;
        stamp(s, t);
        save(s);
        return reply('ok', s, tk.role, t, { answer: null });
      }
      if (!answered || !p) return reply('invalid', s, tk.role, t, { reason: 'no_answer' });
      let q = s;
      if (a.p_queue !== null && a.p_queue !== undefined) {
        const r = requeue(s, a.p_queue);
        if (!r) return reply('invalid', s, tk.role, t, { reason: 'queue' });
        q = r;
      }
      const hasNew = q.items.some((id, i) => i > pos && id === cur && q.retry[i] === curRetry + 1);
      let expect = !p.correct && !p.misclick && !p.doubt && ['saved', 'late', 'duplicate'].includes(String(p.status ?? 'saved')) && curRetry < 2;
      if (expect && !hasNew) return reply('invalid', s, tk.role, t, { reason: 'queue' });
      s = q;
      s.activeAt = t;
      let answer: Json | null = null;
      if (!p.recorded) {
        record(s, false);
        answer = { status: s.pending?.status, correct: s.pending?.correct, dont_know: s.pending?.dont_know, misclick: false, step: s.pending?.step };
        if (!['saved', 'late', 'duplicate'].includes(String(s.pending?.status))) expect = false;
      }
      // No repeat after a right answer, a misclick, the doubt (set aside) or an answer the core did not record.
      if (!expect && hasNew) drop(s, pos, cur, curRetry + 1);
      s.pending = null;
      s.pendingAt = null;
      s.position = pos + 1;
      stamp(s, t);
      save(s);
      return reply('ok', s, tk.role, t, { answer });
    },

    bot_session_finish(a) {
      const t = now();
      const tk = take(a.p_tg_user_id, a.p_sid, t, false);
      if (tk.status === 'ended' && tk.s && tk.s.status === 'finished') return reply('ok', tk.s, tk.role, t, { answer: null });
      if (tk.status !== 'ok') return refusal(tk.status, tk.s, tk.role, t);
      const s = tk.s;
      s.activeAt = t;
      let answer: Json | null = null;
      if (s.pending && s.pending.pos === s.position) {
        if (!s.pending.recorded) {
          record(s, false);
          answer = { status: s.pending.status, correct: s.pending.correct, dont_know: s.pending.dont_know, misclick: false, step: s.pending.step };
        }
        s.pending = null;
        s.pendingAt = null;
        s.position += 1;
      }
      const c = counts(s);
      if (s.position >= s.items.length) {
        s.status = 'finished';
        s.finishedAt = t;
      } else if (c.questions + c.retries === 0) {
        s.status = 'abandoned';
        s.finishedAt = t;
      }
      save(s);
      return reply('ok', s, tk.role, t, { answer });
    },

    bot_session_move(a) {
      const t = now();
      if (!(Number(a.p_message_id) > 0)) return { status: 'invalid', reason: 'message' };
      const tk = take(a.p_tg_user_id, a.p_sid, t, true);
      if (tk.status !== 'ok') return refusal(tk.status, tk.s, tk.role, t);
      const s = tk.s;
      const prev = s.messageId;
      s.messageId = Number(a.p_message_id);
      s.chatId = tk.l.chatId;
      s.activeAt = t;
      stamp(s, t);
      save(s);
      return reply('ok', s, tk.role, t, { prev_message_id: prev === s.messageId ? null : prev });
    },

    bot_key_doubt(a) {
      const t = now();
      const tk = take(a.p_tg_user_id, a.p_sid, t, false);
      if (tk.status !== 'ok') return refusal(tk.status, tk.s, tk.role, t);
      const s = tk.s;
      if (a.p_pos === null || a.p_pos === undefined || a.p_pos !== s.position) return reply('old', s, tk.role, t, { answer: logged(s.user, s.sid, a.p_pos) });
      if (!s.pending || s.pending.pos !== s.position) return reply('invalid', s, tk.role, t, { reason: 'no_answer' });
      s.activeAt = t;
      let answer: Json | null = null;
      if (!s.pending.doubt) {
        if (!s.pending.recorded) {
          record(s, false);
          answer = { status: s.pending.status, correct: s.pending.correct, dont_know: s.pending.dont_know, misclick: false, step: s.pending.step };
        }
        doubts.push({ user: s.user, itemId: s.pending.item_id, proposed: s.pending.chosen });
        s.pending = { ...s.pending, doubt: true };
        count(s, 'doubted');
      }
      save(s);
      return reply('ok', s, tk.role, t, { answer });
    },

    bot_flush_pending(a) {
      const t = typeof a.p_now === 'string' ? Date.parse(a.p_now) : now();
      let flushed = 0;
      let closed = 0;
      for (const s of sessions.values()) {
        if (s.pendingAt !== null && s.pendingAt < t - 30 * MIN && s.status === 'open') {
          record(s, false);
          flushed += 1;
          save(s);
        }
      }
      for (const s of sessions.values()) {
        const l = fdb.links.find((x) => x.id === s.linkId);
        if (s.status !== 'open' || s.activeAt > t - 30 * MIN) continue;
        if (!l || l.unlinkedAt !== null || s.localDay < localDay(t, l.tz)) {
          close(s, 'abandoned', Boolean(l && l.unlinkedAt === null), t);
          closed += 1;
          save(s);
        }
      }
      return { status: 'ok', flushed, closed, deleted: 0 };
    },
  };

  for (const [fn, handler] of Object.entries(fns)) {
    fdb.on(fn, (args) => {
      calls.push({ fn, args: args as Json });
      return JSON.parse(JSON.stringify(handler(args as Json)));
    });
  }

  return {
    bank,
    sessions,
    answers,
    doubts,
    steps,
    calls,
    of: (fn: string) => calls.filter((c) => c.fn === fn),
    /** Every item of the wire's exams becomes a plain question of its subject (overrides with `put`). */
    fromWire(wire: PlanInputsWire) {
      wire.containers.forEach((c, ci) => {
        containers.set(c.id, { title: c.title });
        wire.subjects.forEach((s) => {
          if (s.container === ci) subjects.set(s.id, { containerId: c.id, title: s.title, topics: [] });
        });
      });
      wire.items.forEach((row, n) => {
        const [id, subjectIndex] = row;
        const subject = wire.subjects[subjectIndex];
        const container = wire.containers[subject.container];
        if (!bank.has(id)) bank.set(id, { id, containerId: container.id, subjectId: subject.id, ...plain(n + 1) });
      });
    },
    /** Replace a question (keeps its id, exam and subject). */
    put(id: string, spec: Omit<BankItem, 'id' | 'containerId' | 'subjectId'>) {
      const old = bank.get(id);
      if (!old) throw new Error(`fake sessions: no item ${id}`);
      bank.set(id, { ...old, ...spec, id, containerId: old.containerId, subjectId: old.subjectId });
    },
    role(user: string, container: string, role: 'owner' | 'member' | null) {
      roles.set(`${user}|${container}`, role);
    },
    inFigure(user: string, itemId: string) {
      inFigure.add(`${user}|${itemId}`);
    },
    /** The author changes the key: the rev grows (a shown question answers stale). */
    bumpRev(itemId: string, at = '2026-10-16T08:00:00Z') {
      const item = bank.get(itemId);
      if (item) bank.set(itemId, { ...item, rev: item.rev + 1, updatedAt: at });
    },
    remove(itemId: string) {
      bank.delete(itemId);
    },
    open(user: string): Row | null {
      return [...sessions.values()].find((s) => s.user === user && s.status === 'open') ?? null;
    },
    /** The next day in the link's zone, for «Продолжить» after midnight. */
    nextDay: (day: string) => addDays(day, 1),
  };
}

export type FakeSessions = ReturnType<typeof fakeSessions>;
