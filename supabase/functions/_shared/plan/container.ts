/**
 * The exam container's shared types (frontend/src/types/container.ts). Every package imports from here and nobody
 * redefines them. Spec: meldy-notes/10_Project/Exam_Container_Spec_2026-10-09.md.
 *
 * Three groups:
 *  1. What the database returns (package A's SQL must produce exactly these shapes; contracts/container/*.json are
 *     real samples of them).
 *  2. The plan's decoded input and output (package D1 decodes `PlanInputsWire` into `PlanInput`; package D2's pure
 *     `planDay` turns it into a `DayPlan`; screens and the Telegram bot read `DayPlan`).
 *  3. The question-bank importer's response (`POST /api/exams/parse-bank`, backend/bank_parse.py).
 *
 * Conventions: day fields are local days 'YYYY-MM-DD'; ids are uuid strings; option indices are IN FILE ORDER;
 * moments in the wire are epoch seconds, in decoded objects epoch milliseconds.
 */
export type Uuid = string;
export type DayKey = string;
export type ContainerRole = 'owner' | 'member';

/** single: one option; multiple: several, all or nothing; short: a typed short answer compared with the file's forms. */
export type ItemKind = 'single' | 'multiple' | 'short';
export type KeySource =
  | 'bold' | 'underline' | 'italic' | 'color' | 'highlight' | 'shade' | 'marker' | 'key_column' | 'answer_line'
  | 'key_list' | 'key_text' | 'gift' | 'first_option' | 'manual' | 'none';

export interface ContainerSettings {
  minutes_per_day: number; // 10..300 (the UI offers 30 / 45 / 60 / 90)
  study_weekdays: number; // bit mask, Monday = 1 … Sunday = 64; 127 = every day
}

// ───────────────────────────────────────────── 1. Database shapes ─────────────────────────────────────────────

/** Facts about one subject's TEST part for the signed-in user (facts only: no plan rules in here). */
export interface SubjectFacts {
  keyed: number; // items with a key (the denominator of «N из M» for the test part)
  no_key: number; // items waiting for a key (never planned)
  seen: number; // answered at least once under the current key
  two_days: number; // «верно в два разных дня» now
  open_errors: number; // last answer wrong or «Не знаю» (doubted items excluded)
  seen_today: number; // first answered today (the day's new quota already taken)
  doubted: number; // this user's open «Сомневаюсь в ключе»
  stale: number; // answered before the author changed the key: they start again
}

// containers_overview(p_local_date)
export interface OverviewSubject extends SubjectFacts {
  id: Uuid;
  position: number;
  title: string;
  exam_date: DayKey | null; // the TEST part's date: the subject's own, else the container's
  oral_exam_id: Uuid | null; // author: the oral exam; member: their own copy, or null until copied
  has_oral: boolean; // the author's subject has an oral part
}
export interface OverviewContainer {
  id: Uuid;
  title: string;
  exam_date: DayKey | null;
  created_at: string;
  role: ContainerRole;
  items: number;
  items_updated_at: string | null; // with `items`, the version stamp of the offline bank
  subjects: OverviewSubject[];
  answers_today: number;
  settings: ContainerSettings | null; // null = defaults (60 min, every day)
}
export interface ContainersOverview {
  v: 1;
  day: DayKey;
  containers: OverviewContainer[];
  attached_exam_ids: Uuid[]; // oral exams shown INSIDE a container: hide them from the plain list and from pickExam
}

// container_summary(p_container_id, p_local_date)
export interface SummaryTopic {
  topic: number;
  keyed: number;
  seen: number;
  two_days: number;
  open_errors: number;
}
export interface SummarySubject extends SubjectFacts {
  id: Uuid;
  position: number;
  title: string;
  exam_date: DayKey | null;
  topic_titles: string[]; // topic n = topic_titles[n - 1]
  oral: { exam_id: Uuid | null; questions: number } | null;
  topics: SummaryTopic[];
  kinds: { single: number; multiple: number; short: number };
}
export interface ContainerSummary {
  v: 1;
  day: DayKey;
  id: Uuid;
  title: string;
  exam_date: DayKey | null;
  role: ContainerRole;
  created_at: string;
  first_plan_day: DayKey; // owner: the container's first day; member: the day they joined (the Europe/Minsk day: the server does not know the device's zone)
  settings: ContainerSettings;
  subjects: SummarySubject[];
  items_version: { count: number; updated_at: string | null };
  answers_today: number;
  key_changes_unseen: number; // items whose key the author changed since this member last answered them
  mock_runs: Array<{ id: Uuid; local_date: DayKey; subject_ids: Uuid[]; items: number; correct: number }>;
  owner: {
    members: number;
    doubts_open: number; // items with open doubts
    links: Array<{
      id: Uuid; created_at: string; expires_at: string | null; revoked_at: string | null;
      members: number; max_members: number; oral: number;
    }>;
  } | null;
}

/**
 * plan_inputs(p_local_date, p_container_id?) — the test part of the plan's whole input, also read by the bot.
 * One jsonb row, compact tuples. Oral parts are not in here: their line states come from the cheat sheet on the client.
 */
/** [id, subject index, topic, position, kind 0 single | 1 multiple | 2 short, rev, slow 0 | 1 (code or multiple)] */
export type PlanItemRow = [id: Uuid, subject: number, topic: number | null, position: number, kind: 0 | 1 | 2, rev: number, slow: 0 | 1];
/**
 * One current-key state. Day fields are offsets from `day` (0 today, -1 yesterday), moments are epoch seconds; null = never.
 * [item index, seen, wrong, first_seen_day, last_answer_day, last_result 0 right | 1 wrong | 2 «Не знаю»,
 *  streak_day, streak_at, two_days_at, named_at, checks, peek_day, was_two_days 0 | 1, clean_ok_at]
 */
export type PlanStateRow = [
  item: number, seen: number, wrong: number, firstSeen: number | null, lastAnswer: number | null, lastResult: 0 | 1 | 2 | null,
  streakDay: number | null, streakAt: number | null, twoDaysAt: number | null, namedAt: number | null, checks: number,
  peekDay: number | null, wasTwoDays: 0 | 1, cleanOkAt: number | null,
];
export interface PlanInputsWire {
  v: 1;
  day: DayKey;
  now: number; // epoch seconds, the server's clock
  containers: Array<{
    id: Uuid; title: string; exam_date: DayKey | null; role: ContainerRole; first_plan_day: DayKey;
    answers_today: number; settings: ContainerSettings;
    today: { first_at: number | null; done_s: number }; // the first answer today (epoch s) and seconds answered today
  }>;
  subjects: Array<{
    id: Uuid; container: number; title: string; test_date: DayKey | null; oral_exam_id: Uuid | null; topics: number;
    new_today: number; // items first answered today in this subject
  }>;
  items: PlanItemRow[]; // every item with a key at its current rev, except the ones this user doubts (never offered)
  states: PlanStateRow[];
  doubted: number[]; // reserved, always [] (doubted items are left out of `items`); counts come from SubjectFacts.doubted
  /** Own pace per subject index and class, from the last ≤ 200 answers: trimmed median ms and the share wrong. */
  pace: Array<{ subject: number; cls: PlanCls; n: number; median_ms: number; p_wrong: number }>;
  /**
   * The same rows as `pace`, from the answers made before the container's first answer today (equal to `pace` while
   * there is none): the pace as of the day's start, which the frozen day is planned with (20261010130000; absent from
   * an older server).
   */
  pace_day?: Array<{ subject: number; cls: PlanCls; n: number; median_ms: number; p_wrong: number }>;
  /**
   * The state each item answered today had when the day began (before its first answer today), as `states` tuples:
   * items answered today whose state came from an earlier day under the current rev. An item first answered today
   * began the day unseen. (20261010130000; absent from an older server.)
   */
  day_start?: PlanStateRow[];
  ai: { left: number; resets_at: number } | null; // today's AI units left (epoch s of the reset)
}

// test_items rows (PostgREST keyset pages of ≤ 500 by subject_id + position)
export interface TestItem {
  id: Uuid;
  container_id: Uuid;
  subject_id: Uuid;
  position: number;
  file_no: string; // the number in the file («№ 37»), shown after answering
  topic: number | null;
  kind: ItemKind;
  stem: string; // verbatim, code kept as written
  options: string[]; // file order; [] for short
  correct: number[]; // file order; [] = no key yet (short: [])
  answers: string[]; // short: the accepted forms from the file (1..10); [] otherwise
  key_source: KeySource;
  code: boolean;
  keep_order: boolean;
  flags: string[];
  rev: number;
  updated_at: string;
}
export const TEST_ITEM_COLUMNS =
  'id, container_id, subject_id, position, file_no, topic, kind, stem, options, correct, answers, key_source, code, keep_order, flags, rev, updated_at';

// record_test_answers(p_answers) / container_mock_finish(p_run)
/** The plan class an answer belongs to (for the student's own pace and miss rates). */
export type PlanCls = 'relearn' | 'confirm' | 'new_floor' | 'confirm_ai' | 'start_ai' | 'check' | 'final' | 'new_fill' | 'free';
export interface AnswerInput {
  client_event_id: string; // [A-Za-z0-9_:-]{8,120}, one per answer, kept by the offline queue
  item_id: Uuid;
  chosen?: number | number[] | null; // single / multiple; null = «Не знаю»; multiple = the set (all or nothing)
  text?: string | null; // short; null = «Не знаю»
  rev?: number; // the item's rev the student saw: a newer one answers 'stale'
  shown_order?: number[]; // permutation of file indices as shown
  mode?: 'learn' | 'mock';
  retry?: boolean; // the same session asks a mistake again
  misclick?: boolean; // «Нажали не туда?»: the wrong tap is recorded as a peek, not as a mistake
  session_id?: Uuid;
  local_date?: DayKey;
  ms?: number; // time on the question, ≤ 600 000
  cls?: PlanCls;
}
export type AnswerStatus = 'saved' | 'late' | 'duplicate' | 'conflict' | 'gone' | 'no_key' | 'stale' | 'invalid';
/** Spec §4. `late`: an answer for an older local day after a newer one (journal only). */
export type AnswerStep = 'miss' | 'misclick' | 'training' | 'start' | 'too_early' | 'two_days' | 'check' | 'early' | 'late';
export interface AnswerState {
  item_rev: number;
  seen: number; // counted answers: retries and misclicks are not counted, so seen can differ from right + wrong
  right: number;
  wrong: number;
  last_result: 'right' | 'wrong' | 'dont_know' | null;
  first_seen_day: DayKey | null;
  last_answer_day: DayKey | null;
  streak_at: string | null;
  streak_day: DayKey | null;
  two_days_at: string | null;
  two_days_day: DayKey | null;
  named_at: string | null; // the latest clean correct answer: checks count from it
  checks: number; // checks passed since two_days_at
  peek_day: DayKey | null;
  was_two_days: boolean; // a miss took it out of the figure (for «выпали из счёта»)
  clean_ok_at: string | null; // the latest clean correct answer (the final pass)
}
export interface AnswerResult {
  client_event_id: string | null;
  item_id?: Uuid;
  status: AnswerStatus;
  correct?: boolean;
  key?: number[]; // single / multiple: the key in file order
  answers?: string[]; // short: the accepted forms
  step?: AnswerStep;
  rev?: number;
  state?: AnswerState | null;
}
export interface RecordAnswersResponse {
  v: 1;
  server_day: DayKey; // compare with the device's day (clock skew)
  results: AnswerResult[];
}
/** The offline queue: remove on these, remove and report on these, keep (retry) on network / 5xx / 401. */
export const QUEUE_DONE: readonly AnswerStatus[] = ['saved', 'late', 'duplicate'];
export const QUEUE_DROP_AND_REPORT: readonly AnswerStatus[] = ['gone', 'no_key', 'invalid', 'conflict', 'stale'];
export interface MockRunInput {
  client_run_id: string;
  container_id: Uuid;
  local_date: DayKey;
  subject_ids?: Uuid[];
  time_limit_s?: number;
  duration_s?: number;
  answers: AnswerInput[]; // ≤ 200; chosen / text null = unanswered (counts as wrong)
}
export interface MockRunResult {
  run_id: Uuid;
  items: number;
  correct: number;
  unanswered: number;
  duplicate: boolean;
  results?: AnswerResult[];
}

// writing: container_create, container_items_add, container_item_update
export interface CreateSubjectInput {
  title: string;
  exam_date?: DayKey | null;
  exam_id?: Uuid | null; // an own oral exam as the subject's oral part (also: an old exam becomes subject 1)
  topics?: string[]; // ≤ 99 titles
}
export interface ContainerCreated {
  container_id: Uuid;
  subjects: Array<{ id: Uuid; position: number; title: string }>;
}
export interface ItemInput {
  ref: string; // "<import id>:<n>": a resent batch inserts nothing twice
  stem: string;
  options: string[];
  correct: number[];
  answers?: string[]; // short only
  kind?: ItemKind;
  file_no?: string;
  topic?: number | null;
  key_source?: KeySource;
  code?: boolean;
  keep_order?: boolean;
  flags?: string[];
}
export interface ItemsAdded {
  subject_id: Uuid;
  added: number;
  in_container: number; // ≤ 2000
  items: Array<{ ref: string; id: Uuid; position: number }>;
}
export type ItemPatch = Partial<Pick<ItemInput, 'stem' | 'options' | 'correct' | 'answers' | 'kind' | 'file_no' | 'topic' | 'key_source' | 'code' | 'keep_order'>>;
export interface ItemUpdated {
  id: Uuid;
  rev: number;
  rev_changed: boolean; // the key, the kind or the option count changed: everyone's state of this item starts again
  doubts_resolved: number;
}

// doubts («Сомневаюсь в ключе» from members; the author decides)
export interface DoubtRow {
  item_id: Uuid;
  subject_id: Uuid;
  position: number;
  file_no: string;
  correct: number[];
  doubts: number;
  proposed: number[][] | null;
  notes: string[] | null; // no names, ever
  first_answers: number; // people who answered it for the first time (current key)
  top_wrong: number[] | null; // the wrong option most of them chose first
  top_wrong_n: number | null;
}

// group link (/g/<code>)
export type LinkPreviewStatus = 'active' | 'own' | 'joined' | 'removed' | 'revoked' | 'expired' | 'full' | 'not_found';
export interface LinkPreview {
  status: LinkPreviewStatus;
  container_id?: Uuid | null; // own / joined
  title?: string;
  exam_date?: DayKey | null;
  subjects?: Array<{ title: string; items: number; oral: boolean }>;
  needs_consent_text?: boolean; // the container has oral subjects
}
export interface LinkCreated {
  link_id: Uuid;
  code: string; // shown once; /g/<code>
  path: string;
  oral_subjects: number;
  expires_at: string;
}
/** POST /api/containers/{id}/oral-sync (backend/container_shares.py): the member's oral copies through the oral path. */
export interface OralSyncResponse {
  container_id: Uuid;
  oral: Array<{
    subject_id: Uuid;
    status: 'copied' | 'bound' | 'not_ready' | 'closed' | 'failed';
    exam_id?: Uuid;
  }>;
}
export interface MemberRow {
  user_id: Uuid;
  name: string;
  joined_at: string;
  left_at: string | null;
  removed_at: string | null;
}

/** SQLSTATEs of the container functions (the API layer maps them to Russian copy). */
export type ContainerErrorCode =
  | '28000' | '42501' | 'P0002' | '22023' | 'MC001' | 'MC002' | 'MC003' | 'MC004' | 'MC005' | 'MC006' | 'MC007' | 'MC008' | 'MC009';

/** Every RPC by name: argument object and response (PostgREST /rest/v1/rpc/<name>). */
export interface ContainerRpc {
  containers_overview: { args: { p_local_date?: DayKey }; returns: ContainersOverview };
  container_summary: { args: { p_container_id: Uuid; p_local_date?: DayKey }; returns: ContainerSummary };
  plan_inputs: { args: { p_local_date?: DayKey; p_container_id?: Uuid }; returns: PlanInputsWire };
  record_test_answers: { args: { p_answers: AnswerInput[] }; returns: RecordAnswersResponse };
  container_mock_finish: { args: { p_run: MockRunInput }; returns: MockRunResult };
  container_create: { args: { p_title: string; p_exam_date: DayKey | null; p_subjects: CreateSubjectInput[] }; returns: ContainerCreated };
  container_subject_add: { args: { p_container_id: Uuid; p_subject: CreateSubjectInput }; returns: { id: Uuid; position: number; title: string } };
  container_items_add: { args: { p_subject_id: Uuid; p_items: ItemInput[] }; returns: ItemsAdded };
  container_item_update: { args: { p_item_id: Uuid; p_patch: ItemPatch }; returns: ItemUpdated };
  test_key_doubt: { args: { p_item_id: Uuid; p_proposed?: number[]; p_note?: string }; returns: { item_id: Uuid; open: true } };
  test_key_doubt_withdraw: { args: { p_item_id: Uuid }; returns: { item_id: Uuid; open: false } };
  container_doubts: { args: { p_container_id: Uuid }; returns: DoubtRow[] };
  container_doubt_keep: { args: { p_item_id: Uuid }; returns: { item_id: Uuid; resolved: number } };
  test_answer_days: { args: { p_since: DayKey }; returns: Array<{ local_date: DayKey; answers: number }> };
  container_link_create: { args: { p_container_id: Uuid; p_max_members?: number; p_consent?: string | null }; returns: LinkCreated };
  container_link_revoke: { args: { p_link_id: Uuid }; returns: { id: Uuid; revoked_at: string } };
  container_link_preview: { args: { p_code: string }; returns: LinkPreview };
  container_join: { args: { p_code: string }; returns: { container_id: Uuid; joined: boolean; oral_subjects?: number } };
  /** closed: no new copies; a copy the member already has is still listed, without a code (20261010110000). */
  container_oral_codes: { args: { p_container_id: Uuid }; returns: { status: 'open' | 'closed'; subjects: Array<{ subject_id: Uuid; title: string; code: string | null; existing_exam_id: Uuid | null }> } };
  container_bind_copy: { args: { p_subject_id: Uuid; p_exam_id: Uuid }; returns: { subject_id: Uuid; exam_id: Uuid } };
  container_leave: { args: { p_container_id: Uuid }; returns: { container_id: Uuid; left: true } };
  container_members_list: { args: { p_container_id: Uuid }; returns: MemberRow[] };
  container_member_remove: { args: { p_container_id: Uuid; p_user_id: Uuid | null; p_restore?: boolean }; returns: { removed: number } };
}

// ───────────────────────────────────── 2. The plan: decoded input and output ─────────────────────────────────────

export type LocalDay = DayKey;

/** One unit's state for the rule (a test item, or one deciding line of an oral question). Moments in epoch ms. */
export interface UnitState {
  seen: number;
  wrong: number;
  firstDay: LocalDay | null;
  lastDay: LocalDay | null;
  seriesAt: number | null; // = streak_at
  seriesDay: LocalDay | null; // = streak_day
  twoDaysAt: number | null;
  namedAt: number | null;
  checks: number;
  peekDay: LocalDay | null;
  wasTwoDays: boolean;
  cleanOkAt: number | null;
}
/** Oral question meta for the plan: the last self-check, its rating, the last AI check, whether points are written. */
export interface OralMeta {
  sc: LocalDay | null;
  rating: 0 | 1 | 2 | 3; // 0 none · 1 «Не знаю» · 2 «Плаваю» · 3 «Знаю»
  ac: LocalDay | null;
  prepared: boolean;
}
export interface PlanItem {
  id: string; // test item id, or the oral question id
  s: string; // subject id
  f: 't' | 'o'; // test or oral
  tp: number | null; // topic
  o: number; // order (position)
  slow?: 1;
  u?: UnitState; // test
  l?: UnitState[]; // oral: the deciding lines
  m?: OralMeta; // oral
}
export interface Pace {
  tNew: number; tRev: number; tWrong: number; tRetry: number; tSC: number; tAC: number; // seconds
  pWrong: { new: number; relearn: number; confirm: number; check: number; final: number };
}
export interface PlanInput {
  v: 1;
  now: number; // epoch ms
  tz: string; // IANA, e.g. 'Europe/Minsk'
  containerId: string;
  budgetMin: number;
  /**
   * The days of the week the student studies (settings.study_weekdays): a bit mask, Monday = 1 … Sunday = 64; 127 =
   * every day. Absent or out of 1..127 → every day. Days to a date count only these; another day has no plan.
   */
  studyWeekdays?: number;
  firstPlanDay: LocalDay;
  subjects: Array<{ id: string; title: string; date: LocalDay | null }>;
  items: PlanItem[]; // in plan only, ≤ 2000 test + ≤ 20 × 150 oral
  today: { firstAt: number | null; doneSec: number; newDone: Record<string, number> };
  pace: Record<string, Pace> | null; // per subject id; null → defaults
  /** The pace as of the day's start (plan_inputs.pace_day; null → defaults); absent from an older server. */
  paceDay?: Record<string, Pace> | null;
  /**
   * Items answered today → their state when the day began (plan_inputs.day_start, or the server's state of an answer
   * still in the offline queue); an item first answered today began unseen. Absent from an older server.
   */
  dayStart?: Record<string, UnitState>;
  ai: { left: number; resetsAt: number } | null;
  /**
   * The exam's size as its screens say it: all its questions, with variants (with a key or not) and oral (those waiting
   * for lectures too). The plan never reads it; the line of what the minutes reach by the date (the import page,
   * «Настройки») counts the questions in the plan and says «в плане» when the exam holds more. Absent: the same count.
   */
  examQuestions?: number;
}
export type Cls = 'relearn' | 'confirm' | 'new_floor' | 'confirm_ai' | 'start_ai' | 'check' | 'final' | 'new_fill';
export interface DayPlan {
  day: LocalDay;
  state: 'study' | 'done' | 'nothing' | 'exam_today' | 'after' | 'empty';
  sessions: Array<{ subjectId: string; kind: 'answer' | 'self_check' | 'ai_check'; ids: string[]; estSec: number }>;
  counts: { newItems: number; reviews: number; oral: number; aiChecks: number; estSec: number; leftSec: number; doneSec: number };
  postponed: Partial<Record<Cls, number>>;
  coverage: { unseen: number; floor: number; lastNewDay: LocalDay | null; seenByDateEst: number; neededMin: number };
  window: { from: LocalDay | null; days: number; inWindow: boolean };
  units: { points: number; checks: number } | null;
  figure: { inPlan: number; twoDays: number; seen: number; errors: number; selfKnow: number };
  perSubject: Array<{ subjectId: string; estSec: number; items: number; figure: { inPlan: number; twoDays: number; seen: number; errors: number } }>;
  next: number | null; // the earliest moment more becomes countable (epoch ms)
  firstCountDay: LocalDay | null; // while the figure is 0: the earliest day the first items can count
  lines: Array<{ key: string; n?: number[]; day?: LocalDay; time?: string }>; // rendered by words.ts
}

// ───────────────────────────── 3. The question-bank importer (POST /api/exams/parse-bank) ─────────────────────────────

export type BankItemKind = 'single' | 'multiple' | 'truefalse' | 'open' | 'order' | 'match' | 'unknown';
export interface BankItem {
  position: number; // 1.. across the whole file
  label: string; // the number in the file ('' when it has none)
  subject: number; // index into subjects (1..)
  topic: number | null; // index into topics (1..), numbered across the whole file; the container keeps topics per subject
  kind: BankItemKind;
  text: string;
  options: string[];
  correct: number[];
  order: number[]; // kind order: the key as option indices; [] otherwise
  pairs: Array<[string, string]>; // kind match: the pairs; [] otherwise
  answer: string | null; // an «Ответ: …» line or a GIFT short answer
  /**
   * Where the key came from: a formatting signal ('bold' | 'underline' | 'highlight' | 'color' | 'shade' | 'italic'),
   * 'marker', 'checkbox', 'key_column', 'answer_line', 'key_list', 'key_text', 'gift', 'first_option',
   * 'order_numbers', or '' (no key). All but 'checkbox', 'order_numbers' and '' are KeySource values too.
   */
  evidence: string;
  flags: string[];
  code: boolean;
  where: string;
  marks: Record<string, number[]>; // per formatting signal: the marked share of each option, 0..1
}
/** stats of a parse: counts over items; gaps are missing file numbers [from, to] inside a subject. */
export interface BankParseStats {
  items: number;
  with_key: number;
  no_key: number;
  ambiguous: number;
  to_check: number;
  duplicates: number;
  kinds: Partial<Record<BankItemKind, number>>;
  options: Record<string, number>; // number of options → items
  gaps: Array<[number, number]>;
  key_lists: number;
}
export interface BankParseResult {
  method: string;
  layout: string;
  layouts_seen: Record<string, number>; // layout → times it was seen (rows or questions); layout is the most seen
  confidence: number;
  key_source: Record<string, number>; // evidence → items whose key came from it ({} when no item has a key)
  format_signal: string | null;
  format_signals: Record<string, { one: number; many: number; all: number }>; // items with one, several, all options marked
  mark_share: number;
  marker: string | null;
  markers: string[];
  subjects: Array<{ index: number; title: string | null; evidence: 'heading' | 'heading_level' | 'restart' | 'none'; items: number }>;
  topics: Array<{ index: number; title: string; subject: number; items: number }>;
  skipped: string[]; // lines that were not read (≤ 50, each cut to 200 characters)
  warnings: Array<{ code: string; message: string }>;
  items: BankItem[];
  stats: BankParseStats;
}
export interface BankParseError {
  detail: string;
  code: string;
}
