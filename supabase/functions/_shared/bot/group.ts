/**
 * The group chat «Вопрос дня» (spec §4.6 G1–G4, §6.4 «Беседа», §6.5 `g|<post base36>|<i>`, §6.6 steps 1, 2 and 4;
 * decisions 19, 24–26, 29): the `GroupPort` of router.ts, on T7's database (CONTRACT_T7.md,
 * migration 20261010120004_telegram_bot_groups.sql). supabase/functions/telegram/index.ts puts it in `ports` as `group`.
 *
 * - `/start@Meldyteach_bot G<code>` in a group (the author's «Подключить беседу» on the site): `bot_group_claim` takes
 *   the code only from the author's linked Telegram, fresh and unused. Bound → G1 in the group (silent, no buttons) and
 *   the author's private line. Refused → the bot leaves the group without a word (never a group bound to an exam) and
 *   tells a linked sender why, in private. Added without a code, it says nothing.
 * - `my_chat_member` of a group: left / kicked → the group is unbound; added, made admin → nothing (the bot keeps
 *   nothing of the chat: the router drops every non-command). `migrate_to_chat_id` → the group moves to the new id.
 * - The tick (its deadline and its pacer: ≤ 25 calls a second for the whole tick): (1) at 21:00 local time the post
 *   loses its keyboard and its last line becomes «Вопрос закрыт. Ответили N.»; (2) the day's post: the candidates'
 *   summary → the copied `pickGroupQuestion` → `bot_group_pick` → the option order (the copied `optionOrder`) →
 *   `bot_group_sending` → one silent message with `protect_content`, no blue button, «Заниматься в Meldy» →
 *   `start=g<chat>` → `bot_group_posted`; G4 to the author once (T1's deliveries) when the database stops a group after
 *   five posts in a row without answers; (4) «Ответили N.» by an edit, at most once a minute (the database leases the
 *   rows). A 429 stops the step: the post goes back (`retry`), G4 too (`bot_delivery_retry`), an edit is retried.
 * - A press `g|<post>|<i>`: one database call (`bot_group_answer`) → `answerCallbackQuery`. Whatever shows the key is a
 *   window (`show_alert`) of at most 200 characters, a long option cut with «…». The chat never shows the key: posts,
 *   counters and closes are rendered from a view that has none.
 * - `/start g<chat>` in private (`bot_group_entry`): the author or a member → K1 of that exam; not linked → M1 (the
 *   router's); linked but not in the exam → «Экзамен «…»» and how to join; an unbound chat → as a plain /start.
 *
 * Long options are letters, as Z2 (decision 13); options in code are letters in `<code>` (Z3). The strings are plain
 * text; builders glue and escape them (html.ts). Comments stay in English: a test reads the Russian strings.
 */
import { pickGroupQuestion, type GroupInput, type GroupItemCounts } from '../plan/group.ts';
import { optionOrder, pinnedLast } from '../plan/session.ts';
import { TWO_DAYS } from '../plan/words.ts';
import { dayCard } from './card.ts';
import { encode } from './codec.ts';
import type { BotDb, Who } from './db.ts';
import { b, EN_SPACE, esc, lines, pre, t, typo, visibleLength } from './html.ts';
import { m1 } from './link.ts';
import type { Ctx, GroupCallback, GroupPort, StepStats, Tap, TgChatMemberUpdated, TickTools } from './router.ts';
import {
  edit, editKeyboard, isBlocked, isRateLimited, remove, send, TelegramError, type Button, type Keyboard, type Out, type TgMessage,
} from './tg.ts';
import * as W from './words.ts';

// ─────────────────────────────────────────── words (spec §4.6) ───────────────────────────────────────────

export const GW = {
  // G0 lives on the site (GroupBotInvite); G1 goes to the group once, silent, without buttons.
  g1Title: (exam: string) => `Вопрос дня из экзамена «${exam}»`,
  g1Body: (time: string) => `Раз в день, в ${time}, без звука — один вопрос. Что вы нажали и ответ из файла видите только вы.`,
  g1Note: 'Переписку бот не читает. Убрать вопрос дня — удалить бота из беседы.',
  ownerBound: (chat: string | null, time: string) =>
    `${chat ? `Беседа «${chat}»` : 'Беседа'} подключена: вопрос дня — каждый день в ${time}. Час и отключение — на сайте, в «Пригласить группу».`,
  onlyAuthor: 'Подключить беседу может только автор экзамена.',
  codeExpired: 'Ссылка устарела. На сайте нажмите «Подключить беседу» ещё раз.',
  // G2
  postTitle: (subject: string) => `Вопрос дня · ${subject}`,
  study: 'Заниматься в Meldy',
  answered: (n: number) => `Ответили ${n}.`,
  closed: 'Вопрос закрыт.',
  closedAnswered: (n: number) => `Вопрос закрыт. Ответили ${n}.`,
  // G3: lines and windows to the one who pressed
  right: 'Верно.',
  rightTwoDays: (n: number, of: number) => `Верно. Теперь ${n} из ${of} — ${TWO_DAYS}.`,
  wrongMember: (key: string) => `Неверно. В файле — ${key}. Вопрос вернётся в ваших занятиях завтра.`,
  wrongUnlinked: (key: string) => `Неверно. В файле — ${key}. Чтобы такие ответы шли в план Meldy, подключите Telegram в профиле.`,
  wrongOther: (key: string) => `Неверно. В файле — ${key}.`,
  again: (mine: string, key: string) => `Вы уже ответили: ${mine}. В файле — ${key}.`,
  // «Заниматься в Meldy» for someone linked but not in the exam
  notMemberTitle: (exam: string) => `Экзамен «${exam}»`,
  notMemberBody: 'Он приходит по ссылке группы — её даёт автор экзамена. Войдите по ней на сайте, и план появится здесь.',
  // G4
  stopped: (chat: string | null) =>
    `${chat ? `В беседе «${chat}»` : 'В беседе'} пять дней подряд никто не ответил на вопрос дня — бот перестал его присылать. Включить снова можно на сайте, в «Пригласить группу».`,
};

/** The site's «Пригласить группу» of an exam (SettingsPage: `?invite=1` opens it). */
export const invitePath = (containerId: string) => `/exams/c/${containerId}/settings?invite=1`;

// ─────────────────────────────────────────── the database (CONTRACT_T7.md) ───────────────────────────────────────────

/** VIEW: a post's question as the database gives it — options in FILE order, `shown` the order on the buttons; no key. */
export interface Question {
  postId: number;
  chatId: number;
  localDay: string;
  subject: string;
  stem: string;
  /** File order. */
  options: string[];
  code: boolean;
  keepOrder: boolean;
  /** File indices in the order of the buttons; null until `bot_group_sending`. */
  shown: number[] | null;
}

/** A post as the bot renders it: the options in the order of the buttons (`shown.map(i => options[i])`). */
export interface PostView {
  postId: number;
  chatId: number;
  subject: string;
  stem: string;
  options: string[];
  code: boolean;
  keepOrder: boolean;
}

export type ClaimStatus = 'bound' | 'foreign' | 'expired' | 'used' | 'no_link' | 'invalid' | 'slow_down' | 'not_group';

export interface GroupClaim {
  status: ClaimStatus;
  /** The same code from the same Telegram for the same chat (a redelivery). */
  again: boolean;
  /** This chat is bound to an exam now: the bot never leaves it, whatever the code. */
  chatBound: boolean;
  /** The sender's private chat when their Telegram is linked, else null (the only one told about a refusal). */
  senderChatId: number | null;
  examTitle: string;
  /** The chat's title as kept (null when it has none). */
  title: string | null;
  postHour: number;
  ownerChatId: number | null;
}

export type PostRow =
  | { kind: 'post'; postId: number; chatId: number; localDay: string; candidates: GroupInput }
  /** The group just stopped after five posts in a row without answers: G4 to the author's private chat, once. */
  | { kind: 'g4'; deliveryId: number; chatId: number; groupChatId: number; title: string | null; containerId: string };

export type PickResult = { status: 'picked'; question: Question } | { status: 'none' | 'invalid' | 'gone' };

export type AnswerResult =
  | {
    status: 'answered';
    who: 'member' | 'unlinked' | 'outsider';
    correct: boolean;
    choice: string;
    key: string;
    /** member: the answer core wrote (or had) the `tgq:` row. */
    recorded: boolean;
    core: string | null;
    step: string | null;
    figure: { twoDays: number; inPlan: number } | null;
  }
  | { status: 'repeat'; correct: boolean; choice: string; key: string }
  | { status: 'closed'; reason: string | null }
  | { status: 'invalid'; reason: string | null };

/** An open post to edit: its message, how many answered, and the question to render again (null: it was deleted). */
export interface PostEdit { postId: number; chatId: number; messageId: number; answered: number; view: PostView | null }

export interface GroupEntry {
  linked: boolean;
  status: 'ok' | 'unknown';
  containerId: string | null;
  examTitle: string;
  role: 'owner' | 'member' | null;
}

export interface GroupDb {
  claim(args: { code: string; chatId: number; chatType: string; title: string | null; fromTgUserId: number; messageDate: number }): Promise<GroupClaim>;
  event(chatId: number, event: 'left' | 'kicked' | 'migrated', newChatId?: number | null): Promise<void>;
  entry(tgUserId: number, chatId: number): Promise<GroupEntry>;
  claimPosts(limit: number): Promise<PostRow[]>;
  pick(postId: number, rev: string | null): Promise<PickResult>;
  sending(postId: number, shown: number[]): Promise<boolean>;
  posted(postId: number, status: 'sent' | 'failed' | 'unknown' | 'retry', messageId?: number | null, error?: string | null): Promise<void>;
  answer(args: { postId: number; tgUserId: number; shown: number; chatId: number; messageId: number | null }): Promise<AnswerResult>;
  counters(limit: number): Promise<PostEdit[]>;
  counterDone(postId: number, answered: number, status: 'shown' | 'failed' | 'gone'): Promise<void>;
  claimCloses(limit: number): Promise<PostEdit[]>;
  closed(postId: number, status: 'closed' | 'gone' | 'failed' | 'retry'): Promise<void>;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const rows = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : []);
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : String(x ?? ''))) : []);

const CLAIM_STATUSES: readonly ClaimStatus[] = ['bound', 'foreign', 'expired', 'used', 'no_link', 'invalid', 'slow_down', 'not_group'];

/** The order of the buttons when it is a permutation of the options' indices; null otherwise. */
function permutation(v: unknown, n: number): number[] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  const out = v.map((x) => num(x));
  return out.every((x): x is number => x !== null && Number.isInteger(x) && x >= 0 && x < n) && new Set(out).size === n ? (out as number[]) : null;
}

/** VIEW → Question; null when it is not one (the question was deleted). */
export function toQuestion(raw: unknown): Question | null {
  const r = obj(raw);
  const postId = num(r.post_id);
  const chatId = num(r.chat_id);
  const options = texts(r.options);
  if (postId === null || chatId === null || options.length === 0) return null;
  return {
    postId,
    chatId,
    localDay: str(r.local_day) ?? '',
    subject: str(r.subject) ?? '',
    stem: str(r.stem) ?? '',
    options,
    code: r.code === true,
    keepOrder: r.keep_order === true,
    shown: permutation(r.shown, options.length),
  };
}

/** The post as the buttons show it: `shown.map(i => options[i])` (the file's order without `shown`). */
export function viewOf(question: Question, shown: number[] | null = question.shown): PostView {
  const order = shown && shown.length === question.options.length ? shown : question.options.map((_, i) => i);
  return {
    postId: question.postId,
    chatId: question.chatId,
    subject: question.subject,
    stem: question.stem,
    options: order.map((i) => question.options[i]),
    code: question.code,
    keepOrder: question.keepOrder,
  };
}

/** The order of the buttons (CONTRACT_T7 step 2.3): the copied `optionOrder`, seeded by the post. */
export const shownOrder = (question: Question): number[] =>
  optionOrder(question.options.length, question.keepOrder, pinnedLast(question.options), `g:${question.postId}`);

function toCandidates(raw: unknown, fallbackDay: string): GroupInput {
  const r = obj(raw);
  const items: GroupItemCounts[] = rows(r.items).map((i) => ({
    rev: String(i.rev ?? ''),
    label: str(i.label) ?? '',
    topic: num(i.topic),
    members: num(i.members) ?? 0,
    confirmable: num(i.confirmable) ?? 0,
    relearn: num(i.relearn) ?? 0,
    due: num(i.due) ?? 0,
    unseen: num(i.unseen) ?? 0,
    blocked: i.blocked === true,
  })).filter((i) => i.rev !== '');
  const recent = rows(r.recent).map((x) => ({ rev: String(x.rev ?? ''), day: str(x.day) ?? '' })).filter((x) => x.rev !== '' && x.day !== '');
  return { day: str(r.day) ?? fallbackDay, items, recent, minGapDays: num(r.minGapDays) ?? 14 };
}

function toEdit(raw: Raw): PostEdit | null {
  const postId = num(raw.post_id);
  const chatId = num(raw.chat_id);
  const messageId = num(raw.tg_message_id);
  if (postId === null || chatId === null || messageId === null) return null;
  const question = toQuestion(raw.view);
  return { postId, chatId, messageId, answered: Math.max(0, num(raw.answered) ?? 0), view: question ? viewOf(question) : null };
}

/** The «беседа» functions of CONTRACT_T7 through the one `rpc()` of db.ts (service role, `/rest/v1/rpc/bot_*` only). */
export function groupDb(db: BotDb): GroupDb {
  return {
    async claim(args) {
      const r = obj(await db.rpc('bot_group_claim', {
        p_code: args.code, p_chat_id: args.chatId, p_chat_type: args.chatType, p_title: args.title,
        p_from_tg_user_id: args.fromTgUserId, p_message_date: new Date(args.messageDate * 1000).toISOString(),
      }));
      return {
        status: CLAIM_STATUSES.includes(r.status as ClaimStatus) ? (r.status as ClaimStatus) : 'invalid',
        again: r.again === true,
        chatBound: r.chat_bound === true,
        senderChatId: num(r.sender_chat_id),
        examTitle: str(r.exam_title) ?? '',
        title: str(r.title),
        postHour: num(r.post_hour) ?? 12,
        ownerChatId: num(r.owner_chat_id),
      };
    },
    async event(chatId, event, newChatId = null) {
      await db.rpc('bot_group_event', { p_chat_id: chatId, p_event: event, p_new_chat_id: newChatId });
    },
    async entry(tgUserId, chatId) {
      const r = obj(await db.rpc('bot_group_entry', { p_tg_user_id: tgUserId, p_chat_id: chatId }));
      const role = r.role === 'owner' || r.role === 'member' ? r.role : null;
      return {
        linked: r.linked === true,
        status: r.status === 'ok' ? 'ok' : 'unknown',
        containerId: str(r.container_id),
        examTitle: str(r.exam_title) ?? '',
        role,
      };
    },
    async claimPosts(limit) {
      const out: PostRow[] = [];
      for (const r of rows(await db.rpc('bot_claim_group_posts', { p_limit: limit }))) {
        const chatId = num(r.chat_id);
        if (chatId === null) continue;
        if (r.kind === 'g4') {
          const deliveryId = num(r.delivery_id);
          if (deliveryId !== null) {
            out.push({ kind: 'g4', deliveryId, chatId, groupChatId: num(r.group_chat_id) ?? 0, title: str(r.title), containerId: str(r.container_id) ?? '' });
          }
          continue;
        }
        const postId = num(r.post_id);
        const localDay = str(r.local_day) ?? '';
        if (r.kind === 'post' && postId !== null) out.push({ kind: 'post', postId, chatId, localDay, candidates: toCandidates(r.candidates, localDay) });
      }
      return out;
    },
    async pick(postId, rev) {
      const r = obj(await db.rpc('bot_group_pick', { p_post_id: postId, p_rev: rev }));
      if (r.status === 'picked') {
        const question = toQuestion(r.question);
        if (question) return { status: 'picked', question };
        return { status: 'invalid' };
      }
      return { status: r.status === 'none' || r.status === 'invalid' ? r.status : 'gone' };
    },
    async sending(postId, shown) {
      return (await db.rpc<unknown>('bot_group_sending', { p_post_id: postId, p_shown: shown })) === true;
    },
    async posted(postId, status, messageId = null, error = null) {
      await db.rpc('bot_group_posted', {
        p_post_id: postId, p_status: status, p_tg_message_id: messageId, p_error: error ? error.slice(0, 200) : null,
      });
    },
    async answer(args) {
      const r = obj(await db.rpc('bot_group_answer', {
        p_post_id: args.postId, p_tg_user_id: args.tgUserId, p_shown: args.shown, p_chat_id: args.chatId, p_message_id: args.messageId,
      }));
      const choice = str(obj(r.choice).text) ?? '';
      const key = str(obj(r.key).text) ?? '';
      if (r.status === 'answered') {
        const figure = obj(r.figure);
        const twoDays = num(figure.two_days);
        const inPlan = num(figure.in_plan);
        return {
          status: 'answered',
          who: r.who === 'member' || r.who === 'outsider' ? r.who : 'unlinked',
          correct: r.correct === true,
          choice,
          key,
          recorded: r.recorded === true,
          core: str(r.core),
          step: str(r.step),
          figure: twoDays !== null && inPlan !== null ? { twoDays, inPlan } : null,
        };
      }
      if (r.status === 'repeat') return { status: 'repeat', correct: r.correct === true, choice, key };
      if (r.status === 'invalid') return { status: 'invalid', reason: str(r.reason) };
      return { status: 'closed', reason: str(r.reason) };
    },
    async counters(limit) {
      return rows(await db.rpc('bot_group_counters', { p_limit: limit })).map(toEdit).filter((x): x is PostEdit => x !== null);
    },
    async counterDone(postId, answered, status) {
      await db.rpc('bot_group_counter_done', { p_post_id: postId, p_answered: answered, p_status: status });
    },
    async claimCloses(limit) {
      return rows(await db.rpc('bot_claim_group_closes', { p_limit: limit })).map(toEdit).filter((x): x is PostEdit => x !== null);
    },
    async closed(postId, status) {
      await db.rpc('bot_group_closed', { p_post_id: postId, p_status: status });
    },
  };
}

// ─────────────────────────────────────────── rendering (G1, G2, G4) ───────────────────────────────────────────

export const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'];
/** §3: an option button ≤ 24 characters; a post has 2–8 options (the codec carries 8). */
export const OPTION_MAX = 24;
export const MAX_OPTIONS = 8;
/** Telegram's limits: 4096 visible characters a message, 200 a callback answer. */
export const TEXT_MAX = 4096;
export const TOAST_MAX = 200;

/** A line of code: the site's heuristic (components/containers/model.ts `codeLike`), kept in step with it. */
export function codeLike(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  if (/^(\/\/|\/\*|#|--\s)/.test(text)) return true;
  const bare = text
    .replace(/\/\*.*?\*\//g, ' ')
    .replace(/\/\/.*$/, ' ')
    .replace(/\s--\s.*$/, ' ')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, '""')
    .trim();
  const letters = bare.match(/[a-zа-яё]/gi) ?? [];
  const cyrillic = bare.match(/[а-яё]/gi) ?? [];
  if (letters.length > 0 && cyrillic.length / letters.length > 0.5) return false;
  if (/^\s{2,}|\t/.test(line)) return true;
  if (/[;{}]|=>|==|!=|\+\+|::|<\/?\w+>|\w\(.*\)|\[\d*\]/.test(bare)) return true;
  return /^(int|var|let|const|string|bool|double|float|char|long|class|struct|public|private|protected|static|void|for|while|if|else|return|using|namespace|import|from|def|print|console|select|insert|update|delete|create|alter|drop|begin|end|function|new)\b/i.test(bare);
}

/** The question's words before the code, the code block, the words after (the site's `splitStem`). */
export function splitStem(stem: string, code: boolean): { before: string; code: string | null; after: string } {
  const text = stem.replace(/\r\n?/g, '\n');
  if (!code || !text.includes('\n')) return { before: text.trim(), code: null, after: '' };
  const all = text.split('\n');
  let first = all.findIndex((line) => codeLike(line));
  if (first < 0) return { before: text.trim(), code: null, after: '' };
  let last = all.length - 1;
  while (last > first && !codeLike(all[last])) last -= 1;
  if (first === 0 && all.length > 1 && /[?:]\s*$/.test(all[0]) && !/[;{}]/.test(all[0])) first = 1;
  const block = all.slice(first, last + 1).join('\n').replace(/\s+$/, '');
  return { before: all.slice(0, first).join('\n').trim(), code: block || null, after: all.slice(last + 1).join('\n').trim() };
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export interface OptionLayout {
  mode: 'buttons' | 'letters';
  /** Per option in the order shown: set in `<code>` (letters only). */
  code: boolean[];
}

/**
 * Decision 13 and Z3: buttons, one a row, when every option is at most 24 characters on one line, none is code and
 * the order is not the file's own (`keep_order`); otherwise letters in the text and buttons А–З.
 */
export function optionLayout(view: Pick<PostView, 'options' | 'code' | 'keepOrder'>): OptionLayout {
  const code = view.options.map((o) => view.code && codeLike(o));
  const buttons = !view.keepOrder && view.options.every((o, i) => !code[i] && !/[\r\n]/.test(o.trim()) && [...oneLine(o)].length <= OPTION_MAX);
  return { mode: buttons ? 'buttons' : 'letters', code };
}

/** Letter buttons: up to 5 in a row; 6–8 options go 4 a row (§3). */
function letterRows(count: number): number[][] {
  const per = count <= 5 ? Math.max(1, count) : 4;
  const out: number[][] = [];
  for (let i = 0; i < count; i += per) out.push(Array.from({ length: Math.min(per, count - i) }, (_, k) => i + k));
  return out;
}

/** The deep link of «Заниматься в Meldy»: the private chat with `/start g<chat id>`. */
export const studyUrl = (botUsername: string, chatId: number) => `https://t.me/${botUsername}?start=g${chatId}`;

/** `g|<post base36>|<i>`, `i` = the button's index in the shown order. */
export const postData = (postId: number, i: number) => encode({ kind: 'group', post: postId.toString(36), i });

/** The post's text: the title, the question (its code in `<pre>`), the letters when long, and an optional last line. */
export function postText(view: PostView, tail: string | null = null): string {
  const layout = optionLayout(view);
  const stem = splitStem(view.stem, view.code);
  const body: Array<string | null> = [b(GW.postTitle(view.subject)), ''];
  if (stem.before) body.push(t(stem.before));
  if (stem.code) body.push(pre(stem.code));
  if (stem.after) body.push(t(stem.after));
  if (layout.mode === 'letters') {
    body.push('');
    view.options.forEach((option, i) => {
      const text = layout.code[i] ? `<code>${esc(option.trim())}</code>` : t(oneLine(option));
      body.push(`<b>${LETTERS[i]}</b>${EN_SPACE}${text}`);
    });
  }
  if (tail) body.push('', t(tail));
  return lines(...body);
}

/** The post's keyboard while it is open: the options (or letters), then «Заниматься в Meldy». No blue in a group. */
export function postKeyboard(view: PostView, botUsername: string): Keyboard {
  const layout = optionLayout(view);
  const keyboard: Keyboard = layout.mode === 'buttons'
    ? view.options.map((option, i) => [{ text: oneLine(option), data: postData(view.postId, i) }])
    : letterRows(view.options.length).map((row) => row.map((i) => ({ text: LETTERS[i], data: postData(view.postId, i) })));
  keyboard.push([{ text: GW.study, url: studyUrl(botUsername, view.chatId) }]);
  return keyboard;
}

/** G2 as posted (no last line), with «Ответили N.» (the counter), or closed (no keyboard). */
export function postOut(view: PostView, botUsername: string, state: { answered?: number; closed?: boolean } = {}): Out {
  const n = Math.max(0, state.answered ?? 0);
  if (state.closed) return { text: postText(view, n > 0 ? GW.closedAnswered(n) : GW.closed), keyboard: null };
  return { text: postText(view, n > 0 ? GW.answered(n) : null), keyboard: postKeyboard(view, botUsername) };
}

/** Whether a post can go out: 2–8 options, and the text fits Telegram's 4096 even with its longest last line. */
export function postable(view: PostView): boolean {
  if (view.options.length < 2 || view.options.length > MAX_OPTIONS) return false;
  return visibleLength(postText(view, GW.closedAnswered(99999))) <= TEXT_MAX;
}

/** 12 → «12:00». */
export const hourText = (hour: number) => `${Math.max(0, Math.min(23, Math.trunc(hour)))}:00`;

/** G1, in the group: silent, no buttons. */
export function g1(examTitle: string, postHour: number): Out {
  return { text: lines(b(GW.g1Title(examTitle)), t(GW.g1Body(hourText(postHour))), t(GW.g1Note)), keyboard: null };
}

/** The author's private line after G1 (a chat without a title is worded without one). */
export const ownerLine = (chatTitle: string | null, postHour: number): Out => ({ text: t(GW.ownerBound(chatTitle, hourText(postHour))), keyboard: null });

/** What a linked sender reads in private when their code was refused; null: no word (invalid, slow_down, not_group). */
export function refusal(status: ClaimStatus): Out | null {
  if (status === 'foreign') return { text: t(GW.onlyAuthor), keyboard: null };
  if (status === 'expired' || status === 'used' || status === 'no_link') return { text: t(GW.codeExpired), keyboard: null };
  return null;
}

/** G4, to the author once: silent, «Открыть в Meldy» → «Пригласить группу» of the exam. */
export function g4(chatTitle: string | null, containerId: string, site: string): Out {
  return {
    text: t(GW.stopped(chatTitle)),
    keyboard: containerId ? [[{ text: W.OPEN_IN_MELDY, url: `${site}${invitePath(containerId)}` }]] : null,
  };
}

/** «Заниматься в Meldy» for someone linked but not in the group's exam. */
export function notMemberCard(examTitle: string): Out {
  return { text: lines(b(GW.notMemberTitle(examTitle)), t(GW.notMemberBody)), keyboard: null };
}

// ─────────────────────────────────────────── G3: the reply to a press ───────────────────────────────────────────

const len = (text: string) => [...text].length;

/** At most `max` characters: cut at a word's end when one is near, without a trailing comma or dash, and «…». */
function cut(text: string, max: number): string {
  if (len(text) <= max) return text;
  if (max <= 1) return '…';
  const chars = [...text];
  let head = chars.slice(0, max - 1).join('');
  const space = head.lastIndexOf(' ');
  if (chars[max - 1] !== ' ' && space > 0 && head.length - space <= 20) head = head.slice(0, space);
  // Not on a dangling «а», «не», «от»: up to three short words go too.
  for (let i = 0; i < 3 && /\S\s+\S{1,2}$/u.test(head); i += 1) head = head.replace(/\s+\S{1,2}$/u, '');
  return `${head.replace(/[\s,;:—–-]+$/u, '')}…`;
}

/**
 * Fills a template with option texts, cutting them with «…» so that the whole fits in 200 characters: the room left by
 * the bot's own words is shared fairly (a short option keeps its length, the rest share what is left). The bot's own
 * words are glued (no-break spaces); the options are the file's, as they are (on one line).
 */
function fitToast(template: (...options: string[]) => string, options: string[]): string {
  const marks = options.map((_, i) => `\u0001${i}\u0002`);
  const frame = typo(template(...marks));
  const values = options.map(oneLine);
  let room = TOAST_MAX - (len(frame) - marks.reduce((sum, mark) => sum + len(mark), 0));
  const order = values.map((_, i) => i).sort((a, b) => len(values[a]) - len(values[b]));
  const fitted = [...values];
  order.forEach((i, k) => {
    const share = Math.max(1, Math.floor(room / (order.length - k)));
    fitted[i] = cut(values[i], share);
    room -= len(fitted[i]);
  });
  // A sentence that ends with «…» takes no period after it.
  return fitted.reduce((out, value, i) => out.replace(marks[i], value), frame).replace(/…\./g, '…');
}

/**
 * G3 (spec §4.6, CONTRACT_T7 «a press»): a line for a right answer and a closed post; a window (`show_alert`) for
 * everything that shows the key; ≤ 200 characters. A member's press the answer core refused is answered as an
 * outsider's (no promise that it comes back in the sessions).
 */
export function g3(answer: AnswerResult): { text: string; alert: boolean } {
  if (answer.status === 'closed' || answer.status === 'invalid') return { text: GW.closed, alert: false };
  if (!answer.key) return { text: GW.closed, alert: false };
  if (answer.status === 'repeat') return { text: fitToast(GW.again, [answer.choice || answer.key, answer.key]), alert: true };
  const member = answer.who === 'member' && answer.recorded;
  if (answer.correct) {
    if (member && answer.step === 'two_days' && answer.figure && answer.figure.twoDays > 0) {
      return { text: typo(GW.rightTwoDays(answer.figure.twoDays, answer.figure.inPlan)), alert: false };
    }
    return { text: GW.right, alert: false };
  }
  const template = member ? GW.wrongMember : answer.who === 'unlinked' ? GW.wrongUnlinked : GW.wrongOther;
  return { text: fitToast(template, [answer.key]), alert: true };
}

// ─────────────────────────────────────────── the port ───────────────────────────────────────────

/** Rows per claim: posts 10 (T7's default), edits 50. */
export const POSTS_LIMIT = 10;
export const EDITS_LIMIT = 50;

const add = (stats: StepStats, key: string, n = 1) => {
  stats[key] = (stats[key] ?? 0) + n;
};

/** «1z4» → 2560; null for anything that is not a safe post id. */
export function postIdOf(base36: string): number | null {
  if (!/^[0-9a-z]{1,13}$/.test(base36)) return null;
  const value = parseInt(base36, 36);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** A 400 or 403 from Telegram (it refused; nothing happened); a 429 and anything transient are not. */
const refused = (error: unknown) => error instanceof TelegramError && error.failure === 'api' && (error.code === 400 || error.code === 403);
const errorWord = (error: unknown) => (error instanceof TelegramError ? String(error.code) : 'error');

export function createGroup(): GroupPort {
  /** K1 of the group's exam, as /today: the earlier unused card and the typed command go away. */
  async function examCard(ctx: Ctx, msg: TgMessage, tgUserId: number, containerId: string): Promise<void> {
    const chatId = msg.chat.id;
    const today = await ctx.db.today(tgUserId);
    if (!today) {
      const out = m1(ctx.site);
      await send(ctx.tg, { chatId, text: out.text, keyboard: out.keyboard });
      return;
    }
    const card = dayCard(today, 'today', ctx.site, containerId);
    const sent = await send(ctx.tg, { chatId, text: card.out.text, keyboard: card.out.keyboard });
    const recorded = await ctx.db.cardSent(tgUserId, sent.message_id, 'card').catch(() => ({ prevMessageId: null }));
    if (recorded.prevMessageId !== null) await remove(ctx.tg, chatId, recorded.prevMessageId);
    await remove(ctx.tg, chatId, msg.message_id);
  }

  async function leave(ctx: Ctx, chatId: number): Promise<void> {
    try {
      await ctx.tg.call('leaveChat', { chat_id: chatId });
    } catch {
      // Already out, or Telegram refused: nothing more to do.
    }
  }

  /** G4 through T1's deliveries: `bot_delivery_sending` → sendMessage → `bot_delivery_done`. 'stop' on a 429. */
  async function sendG4(ctx: Ctx, stats: StepStats, row: Extract<PostRow, { kind: 'g4' }>, pace: () => Promise<void>): Promise<'ok' | 'stop'> {
    if (!(await ctx.db.deliverySending(row.deliveryId))) {
      add(stats, 'g4_taken');
      return 'ok';
    }
    const out = g4(row.title, row.containerId, ctx.site);
    let sent: TgMessage;
    try {
      await pace();
      sent = await send(ctx.tg, { chatId: row.chatId, text: out.text, keyboard: out.keyboard });
    } catch (error) {
      if (isRateLimited(error)) {
        // Telegram did nothing: back to `claimed` for a later tick (or closed by the database when out of tries).
        const back = await ctx.db.deliveryRetry(row.deliveryId).catch(() => false);
        add(stats, 'rate_limited');
        add(stats, back ? 'g4_requeued' : 'g4_not_requeued');
        return 'stop';
      }
      if (refused(error)) {
        if (isBlocked(error)) await ctx.db.chatEvent(row.chatId, 'blocked').catch(() => undefined);
        await ctx.db.deliveryDone(row.deliveryId, 'failed', null, errorWord(error)).catch(() => undefined);
        add(stats, 'g4_failed');
        return 'ok';
      }
      add(stats, 'g4_unknown'); // a timeout or a 5xx: left in sending, it becomes unknown
      return 'ok';
    }
    // Out of the try: if the database fails here, the row stays in sending and becomes unknown — never sent twice.
    await ctx.db.deliveryDone(row.deliveryId, 'sent', sent.message_id);
    add(stats, 'g4');
    return 'ok';
  }

  /** One post (CONTRACT_T7 step 2): pick → order → sending → sendMessage → posted. 'stop' on a 429. */
  async function sendPost(ctx: Ctx, stats: StepStats, row: Extract<PostRow, { kind: 'post' }>, pace: () => Promise<void>): Promise<'ok' | 'stop'> {
    const gdb = groupDb(ctx.db);
    const pick = pickGroupQuestion(row.candidates);
    const picked = await gdb.pick(row.postId, pick ? pick.rev : null);
    if (picked.status !== 'picked') {
      add(stats, picked.status); // none: no post today; invalid: back in 10 minutes; gone: another tick has it
      return 'ok';
    }
    const question = picked.question;
    const shown = shownOrder(question);
    const view = viewOf(question, shown);
    if (!(await gdb.sending(row.postId, shown))) {
      add(stats, 'taken');
      return 'ok';
    }
    if (!postable(view)) {
      // The database offers only 2–8 options and ≤ 1500 characters; a message Telegram would refuse is never sent.
      await gdb.posted(row.postId, 'failed', null, 'unfit');
      add(stats, 'unfit');
      return 'ok';
    }
    const out = postOut(view, ctx.botUsername);
    let sent: TgMessage;
    try {
      await pace();
      sent = await send(ctx.tg, { chatId: view.chatId, text: out.text, keyboard: out.keyboard });
    } catch (error) {
      if (error instanceof TelegramError && error.migrateTo !== null) {
        // The group became a supergroup: nothing went out. It moves; the post is offered again in 10 minutes.
        await gdb.event(view.chatId, 'migrated', error.migrateTo).catch(() => undefined);
        await gdb.posted(row.postId, 'retry', null, 'migrated');
        add(stats, 'migrated');
        return 'ok';
      }
      if (isRateLimited(error)) {
        await gdb.posted(row.postId, 'retry', null, '429').catch(() => undefined);
        add(stats, 'rate_limited');
        return 'stop';
      }
      if (refused(error)) {
        if (isBlocked(error)) await gdb.event(view.chatId, 'kicked').catch(() => undefined);
        await gdb.posted(row.postId, 'failed', null, errorWord(error)).catch(() => undefined);
        add(stats, 'failed');
        return 'ok';
      }
      // A timeout, a network error or a 5xx: it may be in the chat. Never sent again.
      await gdb.posted(row.postId, 'unknown', null, errorWord(error)).catch(() => undefined);
      add(stats, 'unknown');
      return 'ok';
    }
    // Out of the try: if the database fails here, the row stays in sending and becomes unknown — never sent twice
    // (the first press gives the message id back).
    await gdb.posted(row.postId, 'sent', sent.message_id);
    add(stats, 'posted');
    return 'ok';
  }

  const port: GroupPort = {
    async startGroup(ctx, msg, code) {
      const from = msg.from;
      if (!from || from.is_bot) return;
      const chat = msg.chat;
      const gdb = groupDb(ctx.db);
      const claim = await gdb.claim({ code, chatId: chat.id, chatType: chat.type, title: chat.title ?? null, fromTgUserId: from.id, messageDate: msg.date });
      if (claim.status === 'bound') {
        // G1 first: if it fails, the update fails and Telegram's retry claims the same code again (`again`).
        const out = g1(claim.examTitle, claim.postHour);
        await send(ctx.tg, { chatId: chat.id, text: out.text });
        // The author's line is a courtesy: its failure must not fail the update (G1 would go twice).
        const line = ownerLine(claim.title, claim.postHour);
        await send(ctx.tg, { chatId: claim.ownerChatId ?? claim.senderChatId ?? from.id, text: line.text }).catch(() => undefined);
        return;
      }
      if (claim.status === 'not_group') return;
      // Refused: out of the chat without a word — never out of a chat bound to an exam; a linked sender hears why.
      if (!claim.chatBound) await leave(ctx, chat.id);
      const out = refusal(claim.status);
      if (out && claim.senderChatId !== null) await send(ctx.tg, { chatId: claim.senderChatId, text: out.text }).catch(() => undefined);
    },

    async privateStart(ctx, msg, payload, who: Who) {
      const m = /^g(-\d{1,19})$/.exec(payload);
      if (!m || !who.linked || !msg.from) return false; // not linked: the router answers M1
      const chatId = Number(m[1]);
      if (!Number.isSafeInteger(chatId)) return false;
      const entry = await groupDb(ctx.db).entry(msg.from.id, chatId);
      if (!entry.linked || entry.status !== 'ok' || !entry.containerId) return false; // as a plain /start
      if (entry.role === 'owner' || entry.role === 'member') {
        await examCard(ctx, msg, msg.from.id, entry.containerId);
        return true;
      }
      const out = notMemberCard(entry.examTitle);
      await send(ctx.tg, { chatId: msg.chat.id, text: out.text, keyboard: out.keyboard });
      return true;
    },

    async press(ctx, tap: Tap, cb: GroupCallback) {
      const postId = postIdOf(cb.post);
      // A post lives only in a group: the same data from a private chat is not a press on it.
      if (postId === null || tap.chatType === 'private') return tap.answer(GW.closed);
      const answer = await groupDb(ctx.db).answer({ postId, tgUserId: tap.tgUserId, shown: cb.i, chatId: tap.chatId, messageId: tap.messageId });
      const reply = g3(answer);
      await tap.answer(reply.text, reply.alert);
    },

    async member(ctx, update: TgChatMemberUpdated) {
      if (update.chat?.type !== 'group' && update.chat?.type !== 'supergroup') return;
      const status = update.new_chat_member?.status;
      // Added (member), made admin, restricted: silence; nothing is stored about the chat.
      if (status === 'left' || status === 'kicked') await groupDb(ctx.db).event(update.chat.id, status);
    },

    async migrate(ctx, fromChatId, toChatId) {
      if (fromChatId === toChatId || toChatId >= 0) return;
      await groupDb(ctx.db).event(fromChatId, 'migrated', toChatId);
    },

    async closePosts(ctx, tools: TickTools) {
      const stats: StepStats = {};
      const gdb = groupDb(ctx.db);
      const due = await gdb.claimCloses(EDITS_LIMIT);
      add(stats, 'claimed', due.length);
      for (const row of due) {
        if (ctx.now() > tools.deadline) {
          add(stats, 'left');
          continue; // leased: it comes back when the lease ends
        }
        let result: 'ok' | 'same' | 'gone';
        try {
          await tools.pace();
          // No keyboard: the edit takes the buttons off. A deleted question: only the keyboard comes off.
          result = row.view
            ? await edit(ctx.tg, { chatId: row.chatId, messageId: row.messageId, text: postOut(row.view, ctx.botUsername, { answered: row.answered, closed: true }).text, keyboard: null })
            : await editKeyboard(ctx.tg, { chatId: row.chatId, messageId: row.messageId, keyboard: null });
        } catch (error) {
          if (refused(error)) {
            await gdb.closed(row.postId, 'failed').catch(() => undefined);
            add(stats, 'failed');
            continue;
          }
          await gdb.closed(row.postId, 'retry').catch(() => undefined);
          if (isRateLimited(error)) {
            add(stats, 'rate_limited');
            break; // 429 stops the step
          }
          add(stats, 'retry');
          continue;
        }
        await gdb.closed(row.postId, result === 'gone' ? 'gone' : 'closed');
        add(stats, result === 'gone' ? 'gone' : 'closed');
      }
      return stats;
    },

    async sendPosts(ctx, tools: TickTools) {
      const stats: StepStats = {};
      const claimed = await groupDb(ctx.db).claimPosts(POSTS_LIMIT);
      add(stats, 'claimed', claimed.length);
      for (const row of claimed) {
        if (ctx.now() > tools.deadline) {
          add(stats, 'left');
          continue; // claimed: offered again after 10 minutes
        }
        const outcome = row.kind === 'g4' ? await sendG4(ctx, stats, row, tools.pace) : await sendPost(ctx, stats, row, tools.pace);
        if (outcome === 'stop') break;
      }
      return stats;
    },

    async counters(ctx, tools: TickTools) {
      const stats: StepStats = {};
      const gdb = groupDb(ctx.db);
      const due = await gdb.counters(EDITS_LIMIT);
      add(stats, 'claimed', due.length);
      for (const row of due) {
        if (ctx.now() > tools.deadline) {
          add(stats, 'left');
          continue;
        }
        if (!row.view) {
          await gdb.counterDone(row.postId, row.answered, 'failed').catch(() => undefined);
          add(stats, 'failed');
          continue;
        }
        const out = postOut(row.view, ctx.botUsername, { answered: row.answered });
        let result: 'ok' | 'same' | 'gone';
        try {
          await tools.pace();
          // The same keyboard again: an edit without it would take the buttons off.
          result = await edit(ctx.tg, { chatId: row.chatId, messageId: row.messageId, text: out.text, keyboard: out.keyboard });
        } catch (error) {
          await gdb.counterDone(row.postId, row.answered, 'failed').catch(() => undefined);
          if (isRateLimited(error)) {
            add(stats, 'rate_limited');
            break;
          }
          add(stats, 'failed');
          continue;
        }
        await gdb.counterDone(row.postId, row.answered, result === 'gone' ? 'gone' : 'shown');
        add(stats, result === 'gone' ? 'gone' : 'shown');
      }
      return stats;
    },
  };
  return port;
}

/** The port index.ts plugs in. */
export const group: GroupPort = createGroup();

/** Buttons of a keyboard, flat (tests and the linter). */
export const buttonsOf = (keyboard: Keyboard | null | undefined): Button[] => (keyboard ?? []).flat();
