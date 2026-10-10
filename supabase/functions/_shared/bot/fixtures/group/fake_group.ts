// An in-memory model of T7's group functions for the function's tests (CONTRACT_T7.md; spec §6.2 `groups`,
// `group_posts`, `group_answers`, §6.3 «беседа», §8.2 «Беседа»), installed on T2's fake database through its
// `on(fn, handler)` hook, with the contract's names, arguments, statuses and JSON shapes:
// - `bot_group_claim`: the code only from the author's linked Telegram, 1 h by the message date, once (a redelivery of
//   the same code, chat and Telegram → `bound` with `again`); `sender_chat_id`, `chat_bound` on every result;
// - posts: claimed → (pick) → sending (with `shown`) → open → closed, or failed / unknown; the window is the hour,
//   at most 3 hours late and before 20:00; `sending` for 10 minutes → unknown, never a second post; none on an exam day
//   or after the date, after the link ended (off, `link`), when turned off, or after 5 posts in a row without answers
//   (off, `empty`, and a G4 notice in T1's deliveries);
// - answers: the first press of a Telegram user per post; a member's goes through the answer core with
//   `client_event_id = tgq:<post>:<tg>` and `source = 'bot_group'`; repeats return the first choice; not linked →
//   only the counter; linked but not in the exam → `outsider`. The key comes back only after a press; a VIEW never
//   carries it;
// - counters leased for a minute, before 21:00; closes at 21:00 local, leased for 10 minutes, at most 3 tries.
import type { GroupItemCounts } from '../../../plan/group.ts';
import { addDays, clockOf, daysBetween, localDay } from '../../../plan/time.ts';
import { DbError } from '../../db.ts';
import type { FakeDb } from '../fake_db.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FakeItem {
  id: string;
  subject: string;
  topic: number | null;
  stem: string;
  /** File order. */
  options: string[];
  /** The key: a file index. */
  correct: number;
  code?: boolean;
  keepOrder?: boolean;
  rev?: number;
}

export interface FakeExam {
  id: string;
  title: string;
  ownerUserId: string;
  members: string[];
  /** The last test date: no post on it or after it. */
  examDate: string | null;
  linkActive: boolean;
  items: FakeItem[];
  /** `bot.group_candidates` items: counts by `rev` (the question's id). */
  counts: GroupItemCounts[];
}

export interface GroupRow {
  chatId: number;
  containerId: string;
  /** The exam's group link at the binding (the group stops when it ends). */
  linkActive: () => boolean;
  title: string | null;
  postHour: number;
  tz: string;
  ownerUserId: string;
  boundAt: number;
  onAt: number;
  offAt: number | null;
  offReason: 'author' | 'empty' | 'link' | null;
  leftAt: number | null;
}

export interface PostRow {
  id: number;
  chatId: number;
  localDay: string;
  itemId: string | null;
  itemRev: number | null;
  shown: number[] | null;
  status: 'claimed' | 'sending' | 'open' | 'closed' | 'failed' | 'unknown';
  claimedAt: number;
  sendingAt: number | null;
  attempts: number;
  messageId: number | null;
  answered: number;
  counterShown: number;
  counterAt: number | null;
  closeAt: number | null;
  closeTries: number;
  closedAt: number | null;
  error: string | null;
}

interface CodeRow { containerId: string; userId: string; postHour: number; tz: string; expiresAt: number; usedAt: number | null; usedByTg: number | null }

export interface AnswerRecord { clientEventId: string; userId: string; itemId: string; chosen: number; source: 'bot_group'; correct: boolean; shownOrder: number[] }

export function fakeGroup(fdb: FakeDb, options: { now: () => number; firstPostId?: number }) {
  const now = options.now;
  const exams = new Map<string, FakeExam>();
  const codes = new Map<string, CodeRow>();
  const groups = new Map<number, GroupRow>();
  const posts: PostRow[] = [];
  const answers = new Map<string, { shown: number; correct: boolean; at: number }>();
  const records: AnswerRecord[] = [];
  const failures: Array<{ tg: number; at: number }> = [];
  /** Telegram users whose right answer completes «верно в два разных дня», with their figure after it. */
  const twoDays = new Map<number, { twoDays: number; inPlan: number }>();
  let nextPostId = options.firstPostId ?? 2560;
  let nextDeliveryId = 900_001;

  const linkOf = (tg: number) => fdb.link(tg);
  const ownerLink = (userId: string) => fdb.links.find((l) => l.userId === userId && l.unlinkedAt === null) ?? null;
  const roleIn = (userId: string | null, exam: FakeExam | undefined) =>
    !userId || !exam ? null : exam.ownerUserId === userId ? 'owner' : exam.members.includes(userId) ? 'member' : null;
  const examOf = (chatId: number) => {
    const g = groups.get(chatId);
    return g ? exams.get(g.containerId) : undefined;
  };
  const itemOf = (exam: FakeExam | undefined, itemId: string | null) => (exam && itemId ? exam.items.find((i) => i.id === itemId) ?? null : null);
  const revOf = (item: FakeItem) => item.rev ?? 1;
  const local = (t: number, tz: string) => {
    const c = clockOf(t, tz);
    return { day: localDay(t, tz), minutes: c.h * 60 + c.m };
  };
  const inWindow = (t: number, g: GroupRow) => {
    const { minutes } = local(t, g.tz);
    return minutes >= g.postHour * 60 && minutes < Math.min(g.postHour * 60 + 180, 20 * 60);
  };
  /** 21:00 local of the post's day has come. */
  const pastClose = (t: number, p: PostRow) => {
    const g = groups.get(p.chatId);
    const { day, minutes } = local(t, g?.tz ?? 'Europe/Minsk');
    return day > p.localDay || (day === p.localDay && minutes >= 21 * 60);
  };
  const itemOk = (item: FakeItem) => item.options.length >= 2 && item.options.length <= 8 && item.stem.length + item.options.join('').length <= 1500;
  const dayStop = (exam: FakeExam, day: string) => (exam.examDate === null ? null : day > exam.examDate ? 'after_date' : day === exam.examDate ? 'exam_day' : null);
  const stopOf = (g: GroupRow, day: string) => {
    const exam = exams.get(g.containerId);
    if (!exam || g.leftAt !== null) return 'left';
    if (g.offAt !== null) return 'off';
    if (!g.linkActive()) return 'link';
    return dayStop(exam, day);
  };

  /** VIEW: options in file order and `shown`; never the key. Null when the question is gone. */
  function view(post: PostRow) {
    const exam = examOf(post.chatId);
    const item = itemOf(exam, post.itemId);
    if (!item) return null;
    return {
      post_id: post.id, chat_id: post.chatId, local_day: post.localDay, subject: item.subject, stem: item.stem, options: [...item.options],
      kind: 'single', code: item.code === true, keep_order: item.keepOrder === true, shown: post.shown ? [...post.shown] : null,
    };
  }

  function candidates(g: GroupRow, day: string) {
    const exam = exams.get(g.containerId) as FakeExam;
    const recent = posts
      .filter((p) => p.chatId === g.chatId && p.itemId !== null && p.localDay < day && daysBetween(p.localDay, day) <= 30 && ['open', 'closed', 'unknown'].includes(p.status))
      .sort((a, b) => (a.localDay < b.localDay ? -1 : 1))
      .map((p) => ({ rev: p.itemId, day: p.localDay }));
    return { day, items: exam.counts.map((c) => ({ ...c })), recent, minGapDays: 14 };
  }

  function fiveEmpty(g: GroupRow, day: string) {
    const last = posts
      .filter((p) => p.chatId === g.chatId && p.localDay < day && p.claimedAt >= g.onAt && (p.status === 'open' || p.status === 'closed' || (p.status === 'unknown' && p.answered > 0)))
      .sort((a, b) => (a.localDay < b.localDay ? 1 : -1))
      .slice(0, 5);
    return last.length === 5 && last.every((p) => p.answered === 0);
  }

  function sweep(t: number) {
    for (const p of posts) {
      if (p.status === 'sending' && (p.sendingAt ?? p.claimedAt) < t - 10 * MIN) {
        p.status = 'unknown';
        p.error = 'died while sending';
      }
      if (p.status === 'claimed' && p.claimedAt < t - 3 * HOUR) {
        p.status = 'failed';
        p.error = 'abandoned';
      }
    }
    for (const d of fdb.deliveries) {
      if (d.kind !== 'notice' || !String(d.ref).startsWith('g4:')) continue;
      if (d.status === 'sending' && d.claimedAt < t - 10 * MIN) d.status = 'unknown';
      if (d.status === 'claimed' && d.claimedAt < t - 3 * HOUR) d.status = 'failed';
    }
  }

  const bad = (fn: string) => new DbError(fn, 400, '22023');

  fdb.on('bot_group_claim', (a) => {
    const t = now();
    const code = typeof a.p_code === 'string' ? a.p_code : null;
    const chatId = Number(a.p_chat_id);
    const from = Number(a.p_from_tg_user_id);
    const sender = from > 0 ? linkOf(from) : null;
    const existing = groups.get(chatId);
    const bound = Boolean(existing && existing.leftAt === null);
    const refuse = (status: string) => ({ sender_chat_id: sender ? sender.chatId : null, chat_bound: bound, status });
    if (!(chatId < 0) || !['group', 'supergroup'].includes(String(a.p_chat_type)) || !(from > 0)) return refuse('not_group');
    if (failures.filter((f) => f.tg === from && f.at > t - HOUR).length >= 10) return refuse('slow_down');
    const row = code && /^G[0-9a-f]{32}$/.test(code) ? codes.get(code) : undefined;
    if (!row) {
      failures.push({ tg: from, at: t });
      return refuse('invalid');
    }
    const exam = exams.get(row.containerId);
    const owner = ownerLink(row.userId);
    if (!owner || owner.tgUserId !== from || roleIn(row.userId, exam) !== 'owner' || !exam) return refuse('foreign');
    const result = (g: GroupRow, again: boolean) => ({
      status: 'bound', again, chat_id: g.chatId, container_id: g.containerId, exam_title: exam.title, title: g.title, post_hour: g.postHour, tz: g.tz,
      owner_chat_id: owner.chatId, sender_chat_id: owner.chatId, chat_bound: true,
    });
    if (row.usedAt !== null) {
      if (row.usedByTg === from && existing && bound && existing.containerId === row.containerId && existing.boundAt === row.usedAt) return result(existing, true);
      return refuse('used');
    }
    const sent = typeof a.p_message_date === 'string' ? Date.parse(a.p_message_date) : NaN;
    if (Math.min(Number.isFinite(sent) ? sent : t, t) > row.expiresAt) return refuse('expired');
    if (!exam.linkActive) return refuse('no_link');
    row.usedAt = t;
    row.usedByTg = from;
    const title = typeof a.p_title === 'string' && a.p_title.replace(/\s+/g, ' ').trim() !== '' ? a.p_title.replace(/\s+/g, ' ').trim().slice(0, 128) : null;
    const g: GroupRow = {
      chatId, containerId: exam.id, linkActive: () => exam.linkActive, title: title ?? existing?.title ?? null, postHour: [9, 12, 15, 18].includes(row.postHour) ? row.postHour : 12,
      tz: owner.tz, ownerUserId: row.userId, boundAt: t, onAt: t, offAt: null, offReason: null, leftAt: null,
    };
    groups.set(chatId, g);
    return result(g, false);
  });

  fdb.on('bot_group_event', (a) => {
    const chatId = Number(a.p_chat_id);
    const event = a.p_event;
    if (event !== 'left' && event !== 'kicked' && event !== 'migrated') throw bad('bot_group_event');
    const g = groups.get(chatId);
    if (event === 'left' || event === 'kicked') {
      const changed = Boolean(g && g.leftAt === null);
      if (g && changed) g.leftAt = now();
      return { status: 'ok', changed, chat_id: chatId };
    }
    const to = a.p_new_chat_id === null || a.p_new_chat_id === undefined ? NaN : Number(a.p_new_chat_id);
    if (!(to < 0) || to === chatId) throw bad('bot_group_event');
    if (!g || g.leftAt !== null) return { status: 'ok', changed: false, chat_id: chatId };
    const there = groups.get(to);
    if (there && there.leftAt === null) {
      g.leftAt = now();
      return { status: 'ok', changed: true, chat_id: to };
    }
    groups.delete(chatId);
    groups.set(to, { ...g, chatId: to });
    for (const p of posts) if (p.chatId === chatId) p.chatId = to;
    return { status: 'ok', changed: true, chat_id: to };
  });

  fdb.on('bot_group_entry', (a) => {
    const l = linkOf(Number(a.p_tg_user_id));
    if (!l) return { linked: false };
    const g = groups.get(Number(a.p_chat_id));
    if (!g || g.leftAt !== null) return { linked: true, status: 'unknown' };
    const exam = exams.get(g.containerId);
    return { linked: true, status: 'ok', container_id: g.containerId, exam_title: exam?.title ?? '', role: roleIn(l.userId, exam) };
  });

  fdb.on('bot_claim_group_posts', (a) => {
    const t = now();
    sweep(t);
    const limit = Math.max(1, Math.min(Number(a.p_limit ?? 10), 100));
    const out: Array<Record<string, unknown>> = [];
    // G4 notices claimed and never tried: again after 10 minutes, at most 3 tries.
    for (const d of fdb.deliveries) {
      if (d.kind !== 'notice' || !String(d.ref).startsWith('g4:') || d.status !== 'claimed' || d.attempts >= 3 || d.claimedAt >= t - 10 * MIN) continue;
      const l = fdb.links.find((x) => x.id === d.linkId);
      if (!l || l.unlinkedAt !== null || l.blockedAt !== null) continue;
      d.claimedAt = t;
      d.attempts += 1;
      const gchat = Number(String(d.ref).slice(3));
      const g = groups.get(gchat);
      out.push({ kind: 'g4', post_id: null, delivery_id: d.id, chat_id: d.chatId, group_chat_id: gchat, local_day: d.localDay, container_id: g?.containerId ?? null, title: g?.title ?? null, exam_title: g ? exams.get(g.containerId)?.title ?? null : null, candidates: null });
    }
    // Posts claimed and never sent: again after 10 minutes, at most 3 tries, in their window.
    for (const p of posts) {
      const g = groups.get(p.chatId);
      if (!g || p.status !== 'claimed' || p.attempts >= 3 || p.claimedAt >= t - 10 * MIN || g.leftAt !== null || g.offAt !== null) continue;
      if (p.localDay !== local(t, g.tz).day || !inWindow(t, g)) continue;
      p.claimedAt = t;
      p.attempts += 1;
      p.error = null;
      out.push({ kind: 'post', post_id: p.id, delivery_id: null, chat_id: p.chatId, group_chat_id: p.chatId, local_day: p.localDay, container_id: g.containerId, title: g.title, exam_title: exams.get(g.containerId)?.title ?? null, candidates: candidates(g, p.localDay) });
    }
    // New posts.
    const due = [...groups.values()]
      .filter((g) => g.leftAt === null && g.offAt === null && inWindow(t, g) && !posts.some((p) => p.chatId === g.chatId && p.localDay === local(t, g.tz).day))
      .sort((x, y) => x.postHour - y.postHour || x.chatId - y.chatId)
      .slice(0, limit);
    for (const g of due) {
      const day = local(t, g.tz).day;
      const stop = stopOf(g, day);
      if (stop === 'link') {
        g.offAt = t;
        g.offReason = 'link';
        continue;
      }
      if (stop !== null) {
        posts.push(newPost(g.chatId, day, 'failed', stop));
        continue;
      }
      if (fiveEmpty(g, day)) {
        g.offAt = t;
        g.offReason = 'empty';
        const owner = fdb.links.find((l) => l.userId === g.ownerUserId && l.unlinkedAt === null && l.blockedAt === null);
        const ref = `g4:${g.chatId}`;
        if (owner && !fdb.deliveries.some((d) => d.kind === 'notice' && d.chatId === owner.chatId && d.localDay === day && d.ref === ref)) {
          const id = nextDeliveryId++;
          fdb.deliveries.push({ id, kind: 'notice', chatId: owner.chatId, linkId: owner.id, localDay: day, ref, status: 'claimed', attempts: 1, claimedAt: t, sentAt: null, messageId: null, error: null });
          out.push({ kind: 'g4', post_id: null, delivery_id: id, chat_id: owner.chatId, group_chat_id: g.chatId, local_day: day, container_id: g.containerId, title: g.title, exam_title: exams.get(g.containerId)?.title ?? null, candidates: null });
        }
        continue;
      }
      const post = newPost(g.chatId, day, 'claimed', null);
      posts.push(post);
      out.push({ kind: 'post', post_id: post.id, delivery_id: null, chat_id: g.chatId, group_chat_id: g.chatId, local_day: day, container_id: g.containerId, title: g.title, exam_title: exams.get(g.containerId)?.title ?? null, candidates: candidates(g, day) });
    }
    return out;
  });

  function newPost(chatId: number, day: string, status: PostRow['status'], error: string | null): PostRow {
    return {
      id: nextPostId++, chatId, localDay: day, itemId: null, itemRev: null, shown: null, status, claimedAt: now(), sendingAt: null, attempts: 1,
      messageId: null, answered: 0, counterShown: 0, counterAt: null, closeAt: null, closeTries: 0, closedAt: null, error,
    };
  }

  fdb.on('bot_group_pick', (a) => {
    const post = posts.find((p) => p.id === Number(a.p_post_id));
    if (!post || post.status !== 'claimed') return { status: 'gone', post_id: Number(a.p_post_id) };
    if (a.p_rev === null || a.p_rev === undefined) {
      post.status = 'failed';
      post.error = 'none';
      return { status: 'none', post_id: post.id };
    }
    const exam = examOf(post.chatId);
    const item = typeof a.p_rev === 'string' && UUID.test(a.p_rev) ? itemOf(exam, a.p_rev) : null;
    if (!exam || !item || !itemOk(item) || (exam.examDate !== null && exam.examDate <= post.localDay)) return { status: 'invalid', post_id: post.id };
    post.itemId = item.id;
    post.itemRev = revOf(item);
    post.shown = null;
    return { status: 'picked', post_id: post.id, chat_id: post.chatId, local_day: post.localDay, question: view(post) };
  });

  fdb.on('bot_group_sending', (a) => {
    const t = now();
    const post = posts.find((p) => p.id === Number(a.p_post_id));
    if (!post || post.status !== 'claimed' || post.itemId === null) return false;
    const exam = examOf(post.chatId);
    const item = itemOf(exam, post.itemId);
    const n = item ? item.options.length : 0;
    const shown = Array.isArray(a.p_shown) ? a.p_shown.map(Number) : null;
    if (!shown || shown.length !== n || new Set(shown.filter((x) => Number.isInteger(x) && x >= 0 && x < n)).size !== n) throw bad('bot_group_sending');
    if (!item || revOf(item) !== post.itemRev || !itemOk(item)) return false;
    const g = groups.get(post.chatId) as GroupRow;
    const { day, minutes } = local(t, g.tz);
    const stop = day !== post.localDay || minutes >= 20 * 60 ? 'late' : stopOf(g, post.localDay);
    if (stop !== null) {
      post.status = 'failed';
      post.error = stop;
      return false;
    }
    post.shown = shown;
    post.status = 'sending';
    post.sendingAt = t;
    return true;
  });

  fdb.on('bot_group_posted', (a) => {
    const status = a.p_status;
    const id = a.p_tg_message_id === null || a.p_tg_message_id === undefined ? null : Number(a.p_tg_message_id);
    if (!['sent', 'failed', 'unknown', 'retry'].includes(String(status)) || (status === 'sent' && !(id !== null && id > 0))) throw bad('bot_group_posted');
    const post = posts.find((p) => p.id === Number(a.p_post_id));
    if (!post) return { status: 'ignored' };
    if (post.status === 'sending' || (status === 'sent' && post.status === 'unknown')) {
      if (status === 'sent') {
        post.status = 'open';
        post.messageId = id;
        post.error = null;
      } else if (status === 'retry') {
        post.status = 'claimed';
        post.claimedAt = now();
        post.error = a.p_error === null || a.p_error === undefined ? null : String(a.p_error);
      } else {
        post.status = status as 'failed' | 'unknown';
        post.error = a.p_error === null || a.p_error === undefined ? null : String(a.p_error);
      }
      return { status: 'ok' };
    }
    return status === 'sent' && post.status === 'open' && post.messageId === id ? { status: 'ok' } : { status: 'ignored' };
  });

  fdb.on('bot_group_answer', (a) => {
    const t = now();
    const tg = Number(a.p_tg_user_id);
    const shownIndex = Number(a.p_shown);
    const chatId = a.p_chat_id === null || a.p_chat_id === undefined ? null : Number(a.p_chat_id);
    const messageId = a.p_message_id === null || a.p_message_id === undefined ? null : Number(a.p_message_id);
    if (!(tg > 0) || !Number.isInteger(shownIndex) || shownIndex < 0 || shownIndex > 7) return { status: 'invalid', reason: 'input' };
    const post = posts.find((p) => p.id === Number(a.p_post_id));
    if (!post) return { status: 'closed', reason: 'gone' };
    if (chatId !== null && chatId !== post.chatId) return { status: 'invalid', reason: 'chat' };
    if (!['open', 'sending', 'unknown'].includes(post.status) || post.shown === null || post.itemId === null) return { status: 'closed', reason: 'status' };
    if (pastClose(t, post)) return { status: 'closed', reason: 'time' };
    if (shownIndex >= post.shown.length) return { status: 'invalid', reason: 'shown' };
    const exam = examOf(post.chatId);
    const item = itemOf(exam, post.itemId);
    if (!exam || !item || item.options.length !== post.shown.length) return { status: 'closed', reason: 'stale' };
    if (post.messageId === null && (post.status === 'sending' || post.status === 'unknown') && chatId === post.chatId && messageId !== null && messageId > 0) {
      post.messageId = messageId;
      post.status = 'open';
    }
    const file = post.shown[shownIndex];
    const correct = file === item.correct;
    const key = { shown: post.shown.indexOf(item.correct), text: item.options[item.correct] };
    const mark = `${post.id}:${tg}`;
    const first = answers.get(mark);
    if (first) {
      return { status: 'repeat', correct: first.correct, choice: { shown: first.shown, text: item.options[post.shown[first.shown]] }, key, answered: post.answered };
    }
    answers.set(mark, { shown: shownIndex, correct, at: t });
    post.answered += 1;
    const base = { status: 'answered', correct, choice: { shown: shownIndex, text: item.options[file] }, key, answered: post.answered };
    const l = linkOf(tg);
    if (!l) return { ...base, who: 'unlinked' };
    if (roleIn(l.userId, exam) === null) return { ...base, who: 'outsider' };
    const clientEventId = `tgq:${post.id}:${tg}`;
    const core = records.some((r) => r.clientEventId === clientEventId && r.userId === l.userId) ? 'duplicate' : 'saved';
    if (core === 'saved') records.push({ clientEventId, userId: l.userId, itemId: item.id, chosen: file, source: 'bot_group', correct, shownOrder: [...post.shown] });
    const figure = correct ? twoDays.get(tg) : undefined;
    return {
      ...base, who: 'member', recorded: true, core, step: figure ? 'two_days' : correct ? 'start' : 'miss',
      figure: figure ? { two_days: figure.twoDays, in_plan: figure.inPlan } : null,
    };
  });

  fdb.on('bot_group_counters', (a) => {
    const t = now();
    const due = posts
      .filter((p) => {
        const g = groups.get(p.chatId);
        return p.status === 'open' && p.messageId !== null && p.itemId !== null && g && g.leftAt === null && p.answered > p.counterShown
          && (p.counterAt === null || p.counterAt <= t - MIN) && !pastClose(t, p);
      })
      .sort((x, y) => x.id - y.id)
      .slice(0, Number(a.p_limit ?? 50));
    for (const p of due) p.counterAt = t;
    return due.map((p) => ({ post_id: p.id, chat_id: p.chatId, tg_message_id: p.messageId, answered: p.answered, view: view(p) }));
  });

  fdb.on('bot_group_counter_done', (a) => {
    const status = a.p_status ?? 'shown';
    if (!['shown', 'failed', 'gone'].includes(String(status))) throw bad('bot_group_counter_done');
    const post = posts.find((p) => p.id === Number(a.p_post_id) && p.status === 'open');
    if (!post) return { status: 'ignored' };
    if (status === 'shown') post.counterShown = Math.max(post.counterShown, Math.min(Number(a.p_answered ?? 0), post.answered));
    else if (status === 'gone') post.messageId = null;
    return { status: 'ok' };
  });

  fdb.on('bot_claim_group_closes', (a) => {
    const t = now();
    sweep(t);
    for (const p of posts) {
      const g = groups.get(p.chatId);
      if (!(p.status === 'open' || p.status === 'unknown') || !pastClose(t, p)) continue;
      if (p.status === 'unknown' || p.messageId === null || p.itemId === null || !g || g.leftAt !== null || p.closeTries >= 3) {
        p.error = p.error ?? (p.status === 'unknown' ? 'unknown' : !g || g.leftAt !== null ? 'left' : p.messageId === null ? 'no message' : p.itemId === null ? 'no question' : 'close failed');
        p.status = 'closed';
        p.closedAt = t;
      }
    }
    const due = posts
      .filter((p) => {
        const g = groups.get(p.chatId);
        return p.status === 'open' && p.messageId !== null && p.itemId !== null && g && g.leftAt === null && pastClose(t, p)
          && (p.closeAt === null || p.closeAt <= t - 10 * MIN);
      })
      .sort((x, y) => x.id - y.id)
      .slice(0, Number(a.p_limit ?? 50));
    for (const p of due) {
      p.closeAt = t;
      p.closeTries += 1;
    }
    return due.map((p) => ({ post_id: p.id, chat_id: p.chatId, tg_message_id: p.messageId, answered: p.answered, view: view(p) }));
  });

  fdb.on('bot_group_closed', (a) => {
    const status = a.p_status ?? 'closed';
    if (!['closed', 'gone', 'failed', 'retry'].includes(String(status))) throw bad('bot_group_closed');
    const post = posts.find((p) => p.id === Number(a.p_post_id) && p.status === 'open');
    if (!post) return { status: 'ignored' };
    if (status !== 'retry') {
      post.status = 'closed';
      post.closedAt = now();
      if (status !== 'closed') post.error = String(status);
    }
    return { status: 'ok' };
  });

  return {
    exams,
    groups,
    posts,
    answers,
    records,
    twoDays,
    failures,
    addExam(exam: FakeExam) {
      exams.set(exam.id, exam);
      return exam;
    },
    /** A group code the site would have made (`telegram_group_code`): `G` + 32 hex, valid `ttlMs` from now. */
    addCode(code: string, exam: FakeExam, opts: { postHour?: number; ttlMs?: number; tz?: string } = {}) {
      codes.set(code, { containerId: exam.id, userId: exam.ownerUserId, postHour: opts.postHour ?? 12, tz: opts.tz ?? 'Europe/Minsk', expiresAt: now() + (opts.ttlMs ?? HOUR), usedAt: null, usedByTg: null });
    },
    /** A group bound earlier, as if its code had been claimed. */
    bind(chatId: number, exam: FakeExam, opts: { title?: string | null; postHour?: number; tz?: string; onAt?: number } = {}) {
      const g: GroupRow = {
        chatId, containerId: exam.id, linkActive: () => exam.linkActive, title: opts.title === undefined ? '3-ПО' : opts.title, postHour: opts.postHour ?? 12,
        tz: opts.tz ?? 'Europe/Minsk', ownerUserId: exam.ownerUserId, boundAt: now(), onAt: opts.onAt ?? now() - 30 * 24 * HOUR, offAt: null, offReason: null, leftAt: null,
      };
      groups.set(chatId, g);
      return g;
    },
    /** A closed post of an earlier day (the five-empty rule and the recent posts read them). */
    pastPost(chatId: number, day: string, itemId: string, answered: number) {
      const p = newPost(chatId, day, 'closed', null);
      p.itemId = itemId;
      p.itemRev = 1;
      p.shown = [0, 1, 2, 3];
      p.messageId = 1;
      p.answered = answered;
      p.counterShown = answered;
      p.claimedAt = Date.parse(`${day}T09:00:00Z`);
      p.closedAt = Date.parse(`${day}T18:00:00Z`);
      posts.push(p);
      return p;
    },
    post(id: number) {
      return posts.find((p) => p.id === id) ?? null;
    },
    daysBefore(day: string, n: number) {
      return addDays(day, -n);
    },
  };
}

export type FakeGroup = ReturnType<typeof fakeGroup>;
