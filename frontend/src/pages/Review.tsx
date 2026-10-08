import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import 'katex/dist/katex.min.css';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { countDueCards, getDueCards, updateCardProgress, type DueCard } from '../api/flashcards';
import { recordStudyActivity } from '../api/studyActivity';
import { newEventId } from '../api/learning';
import { supabase } from '../lib/supabase';
import { pluralRu } from '../components/conversation/visuals';
import { HandPhraseMark, handPhraseFor } from '../components/marks';
import '../styles/paper.css';
import './Review.css';
import { displayMaterialTitle } from '../utils/materialTitle';
import { stripSourceMarkers } from '../components/summary/fragmentModel';
import { repairMathEscapes } from '../lib/mathEscapes';
import { countBucket, track } from '../lib/telemetry';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { sessionTotalWords } from '../lib/learning/cardCounts';
import { localDateKey } from '../utils/streak';
import { ty } from '../components/landing/typo';
import { usePhone } from '../lib/usePhone';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** getDueCards' default page: a full page means more cards may be due after this one. */
const QUEUE_SIZE = 20;
/** The judgement stays on the card this long before the next card comes (redesign spec 5.13). */
export const NEXT_CARD_MS = 600;
/** Nothing for the first 300 ms of loading, then one quiet line (spec 4.6). */
const LOADING_LINE_MS = 300;
/**
 * Markdown on paper: the card's own ink and line height (the desk's .markdown-content paints slate
 * text, unreadable on the light paper of the dark theme).
 */
const PAPER_MD =
  '[&_p]:m-0 [&_p+p]:mt-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_strong]:font-semibold [&_code]:text-[0.9em]';

type Grade = 'forgot' | 'hard' | 'remember';

/** Three words instead of a traffic light (spec 5.13): the SM-2 quality behind each. */
const GRADES: Array<{ grade: Grade; word: string; key: string; quality: number }> = [
  { grade: 'forgot', word: 'Не помню', key: '1', quality: 1 },
  { grade: 'hard', word: 'С трудом', key: '2', quality: 3 },
  { grade: 'remember', word: 'Помню', key: '3', quality: 5 },
];

interface Judged {
  grade: Grade;
  days: number;
}

/** A saved answer and when the card comes back, as the server computed it (the done screen's day columns). */
interface Returned {
  key: string;
  question: string;
  days: number;
  followUp: boolean;
  note: string;
}

/** The question of a card as one plain line for a small card: no markdown signs, no formula dollars. */
function plainQuestion(markdown: string): string {
  return stripSourceMarkers(markdown)
    .replace(/[*_`#>$\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «Завтра», «Через 6 дней» over a column of the done screen. */
export function dayColumnTitle(days: number): string {
  if (days <= 0) return 'Сегодня';
  if (days === 1) return 'Завтра';
  return `Через ${days} ${pluralRu(days, ['день', 'дня', 'дней'])}`;
}

/** «вернётся завтра», «вернётся через 6 дней». */
export function returnsIn(days: number): string {
  if (days <= 0) return 'вернётся сегодня';
  if (days === 1) return 'вернётся завтра';
  return `вернётся через ${days} ${pluralRu(days, ['день', 'дня', 'дней'])}`;
}

/** «лекция «Эластичность спроса», фрагмент 5» for the back of a card, or ''. */
function sourceNote(title: string | undefined, sourceIds: unknown): string {
  if (!title) return '';
  const first = Array.isArray(sourceIds) ? sourceIds.find((id): id is string => typeof id === 'string') : undefined;
  const number = first ? /S0*(\d+)$/.exec(first)?.[1] : undefined;
  return number ? `лекция «${title}», фрагмент ${number}` : `лекция «${title}»`;
}

function cardDay(card: DueCard): string {
  const raw = typeof card.created_at === 'string' ? card.created_at : null;
  if (!raw) return '';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'd MMMM', { locale: ru });
}

/** Where a card comes from: an examiner's follow-up («из ответа на билет, 2 октября») or its lecture. */
function cardContext(card: DueCard, titles: Record<string, string>): { followUp: boolean; title: string | undefined; context: string } {
  const followUp = card.origin === 'oral_followup';
  const title = card.material_id ? titles[card.material_id] : undefined;
  const day = cardDay(card);
  const context = followUp ? (day ? `из ответа на билет, ${day}` : 'из ответа на билет') : title ?? '';
  return { followUp, title, context };
}

/** Open entries of the mistakes diary: a HEAD request, no rows are transferred; null when it cannot be read. */
export async function countOpenMistakes(userId: string): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('mistake_diary')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_resolved', false);
    if (error || typeof count !== 'number') return null;
    return Math.max(0, count);
  } catch {
    return null;
  }
}

/** «5 открытых ошибок.», «Открытых ошибок нет.», or nothing when the count is not known. */
export function openMistakesLine(count: number | null): string {
  if (count === null) return '';
  if (count === 0) return 'Открытых ошибок нет.';
  return `${count} ${pluralRu(count, ['открытая ошибка', 'открытые ошибки', 'открытых ошибок'])}.`;
}

/**
 * The mistakes diary lives in «Повторение»: one card at the foot of the page in every state, with
 * the number of open mistakes when it could be counted (a phone's session has the line below instead).
 */
function MistakesEntry({ count }: { count: number | null }) {
  const line = openMistakesLine(count);
  return (
    <section className="rv-diary" aria-labelledby="rv-diary-h">
      <div className="rv-diary-main">
        <h2 id="rv-diary-h" className="rv-diary-h">
          Дневник ошибок
        </h2>
        <p className="rv-diary-p">
          {line ? <b>{line}</b> : null}
          {line ? ' ' : null}Ошибки из тестов и ответов на билеты, правильный ответ открывается по нажатию.
        </p>
      </div>
      <Link className="sf-secondary rv-diary-go" to="/mistakes">
        Открыть дневник ошибок
      </Link>
    </section>
  );
}

/** «17 открытых», «открытых нет», or nothing when the count is not known: the tail of the phone's diary line. */
export function openMistakesShort(count: number | null): string {
  if (count === null) return '';
  if (count === 0) return 'открытых нет';
  return `${count} ${pluralRu(count, ['открытая', 'открытые', 'открытых'])}`;
}

/**
 * During a session a phone shows the diary as one line under the card, «Дневник ошибок: 17 открытых →»
 * (10_Project/Phone_Declutter_2026-10-08): the card and its three words keep the screen. A row link: ink, no underline,
 * the arrow at its end (Review.css).
 */
function MistakesLine({ count }: { count: number | null }) {
  const tail = openMistakesShort(count);
  return (
    <p className="rv-diary-line">
      <Link className="sf-link" to="/mistakes">
        {/* One run of text: the link is a flex box, which would trim a space at the edge of a child. */}
        <span>{ty(`Дневник ошибок${tail ? `: ${tail}` : ''}`).replace(/(\d) /g, '$1\u00a0')}</span>
        <span className="rv-diary-arrow" aria-hidden="true">
          →
        </span>
      </Link>
    </p>
  );
}

/**
 * What an empty queue means: how many cards the student has at all (of the material, with
 * `?material`), how many come later today and when the next one comes. Each part is null when it
 * cannot be read, and the page then says only what it knows.
 */
export interface ReviewOutlook {
  total: number | null;
  laterToday: number | null;
  nextAt: string | null;
}

/** The first moment of the next local day, for «later today». */
function startOfTomorrow(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
}

export async function reviewOutlook(userId: string, materialId: string | null, now: Date = new Date()): Promise<ReviewOutlook> {
  const nowIso = now.toISOString();
  const tomorrowIso = startOfTomorrow(now).toISOString();
  // HEAD requests with count=exact: no rows are transferred.
  const count = async (later: boolean): Promise<number | null> => {
    try {
      let query = supabase.from('flashcard_progress').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      if (materialId) query = query.eq('material_id', materialId);
      if (later) query = query.gt('next_review', nowIso).lt('next_review', tomorrowIso);
      const { count: value, error } = await query;
      return error || typeof value !== 'number' ? null : Math.max(0, value);
    } catch {
      return null;
    }
  };
  const next = async (): Promise<string | null> => {
    try {
      let query = supabase.from('flashcard_progress').select('next_review').eq('user_id', userId).gt('next_review', nowIso);
      if (materialId) query = query.eq('material_id', materialId);
      const { data, error } = await query.order('next_review', { ascending: true }).limit(1);
      const value = !error && Array.isArray(data) ? (data[0] as { next_review?: unknown } | undefined)?.next_review : null;
      return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
    } catch {
      return null;
    }
  };
  const [total, laterToday, nextAt] = await Promise.all([count(false), count(true), next()]);
  return { total, laterToday, nextAt };
}

/** «сегодня в 18:40», «завтра», «12 октября»: when the next card comes. */
export function nextReviewWords(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = localDateKey(date);
  if (day === localDateKey(now)) return `сегодня в ${format(date, 'H:mm')}`;
  if (day === localDateKey(startOfTomorrow(now))) return 'завтра';
  return format(date, date.getFullYear() === now.getFullYear() ? 'd MMMM' : 'd MMMM yyyy', { locale: ru });
}

/** «Ещё 2 карточки придут сегодня, первая — в 18:40.» or ''. */
function laterTodaySentence(later: number, nextAt: string | null, now: Date): string {
  if (later <= 0) return '';
  const time = nextAt && localDateKey(new Date(nextAt)) === localDateKey(now) ? format(new Date(nextAt), 'H:mm') : '';
  if (later === 1) return `Ещё одна карточка придёт сегодня${time ? ` в ${time}` : ''}.`;
  return `Ещё ${later} ${pluralRu(later, ['карточка придёт', 'карточки придут', 'карточек придут'])} сегодня${time ? `, первая — в ${time}` : ''}.`;
}

/**
 * The words of an empty queue (LIB-14): a student without cards hears where cards come from, a day
 * with more cards later says when they come, a finished day says when the next review is. With
 * `material`, the same for one lecture. `kind` picks the actions: 'none' has one, «Разобрать лекцию».
 */
export function emptyQueueCopy(
  outlook: ReviewOutlook | null,
  material: boolean,
  now: Date = new Date(),
): { kind: 'none' | 'later' | 'done' | 'unknown'; title: string; text: string } {
  const later = outlook?.laterToday ?? 0;
  const next = outlook?.nextAt ? nextReviewWords(outlook.nextAt, now) : '';
  if (material) {
    if (outlook?.total === 0) return { kind: 'none', title: 'Карточек этой лекции в повторении нет', text: 'Карточки попадают в повторение после разбора лекции.' };
    const title = 'Карточек этой лекции к повторению сейчас нет';
    if (later > 0) return { kind: 'later', title, text: laterTodaySentence(later, outlook?.nextAt ?? null, now) };
    return { kind: next ? 'done' : 'unknown', title, text: next ? `Следующее повторение — ${next}.` : 'Срок следующего повторения ещё не наступил.' };
  }
  if (outlook?.total === 0) {
    return {
      kind: 'none',
      title: 'Карточек пока нет',
      text: 'Они появятся после разбора лекции. Сюда же придут вопросы экзаменатора, на которые вы не ответили в билете.',
    };
  }
  if (later > 0) return { kind: 'later', title: 'Сейчас повторять нечего', text: laterTodaySentence(later, outlook?.nextAt ?? null, now) };
  if (outlook && outlook.total !== null && outlook.laterToday === 0) {
    return { kind: 'done', title: 'На сегодня всё', text: next ? `Следующее повторение — ${next}.` : 'Карточек с наступившим сроком повторения нет.' };
  }
  // The counts could not be read: only what is certain.
  return { kind: 'unknown', title: 'Сейчас повторять нечего', text: 'Карточек с наступившим сроком повторения нет.' };
}

/** Titles of the cards' lectures, for the face and the back of a card; nothing when they cannot be read. */
async function loadLectureTitles(cards: DueCard[]): Promise<Record<string, string>> {
  const ids = Array.from(new Set(cards.map((card) => card.material_id).filter((id): id is string => typeof id === 'string' && UUID.test(id))));
  if (ids.length === 0) return {};
  try {
    const { data, error } = await supabase.from('materials').select('id, title').in('id', ids);
    if (error || !Array.isArray(data)) return {};
    const titles: Record<string, string> = {};
    for (const row of data as Array<{ id?: unknown; title?: unknown }>) {
      if (typeof row.id === 'string' && typeof row.title === 'string' && row.title.trim()) titles[row.id] = displayMaterialTitle(row.title);
    }
    return titles;
  } catch {
    return {};
  }
}

/**
 * Review of due cards («Повторение», redesign spec 5.13): one index card at a time in a column of
 * 600, recall first, then turn the card over and say how it went in one of three words. The pencil
 * writes when the card comes back («завтра» only when it is tomorrow); then the next card.
 *
 * Every answer goes through the review_flashcard RPC with its own client_event_id. A failed save
 * keeps that id for the card, so a retry can never apply the same answer twice; the id is dropped
 * only after the save succeeded. One review session id covers the whole page load. `?material=<id>`
 * limits the queue to one material. Activity counters are written one after another, and the done
 * screen appears only after the last one is stored, so «Сегодня» opened next shows the answers.
 * No sounds, no traffic-light buttons, no spinner.
 */
export default function Review() {
  useDocumentTitle('Повторение');
  const { user } = useAuth();
  const phone = usePhone();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const materialParam = searchParams.get('material');
  const materialFilter = materialParam ? materialParam.trim() : null;
  const [cards, setCards] = useState<DueCard[]>([]);
  /** All cards due now when the session holds only the first page of them (decision 4: «всего на сегодня»). */
  const [dueTotal, setDueTotal] = useState<number | null>(null);
  /** What an empty queue means (no cards yet, more later today, the next day); null until read. */
  const [outlook, setOutlook] = useState<ReviewOutlook | null>(null);
  const loadSeq = useRef(0);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  /** A card was turned over on this page: a phone drops the hint under «Перевернуть» from then on. */
  const [flippedOnce, setFlippedOnce] = useState(false);
  const [judged, setJudged] = useState<Judged | null>(null);
  const [counts, setCounts] = useState<Record<Grade, number>>({ forgot: 0, hard: 0, remember: 0 });
  const [tomorrow, setTomorrow] = useState(0);
  const [returned, setReturned] = useState<Returned[]>([]);
  const [done, setDone] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingLine, setLoadingLine] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const processingRef = useRef(false);
  const [sessionId] = useState(() => newEventId());
  /** client_event_id of an answer whose save has not succeeded yet, per card. */
  const pendingEventIds = useRef(new Map<string, string>());
  const activityChain = useRef<Promise<void>>(Promise.resolve());
  const nextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flipButtonRef = useRef<HTMLButtonElement | null>(null);
  const gradesRef = useRef<HTMLDivElement | null>(null);
  /** Open mistakes for the diary's card; null until counted or when the count cannot be read. */
  const [openMistakes, setOpenMistakes] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    void countOpenMistakes(user.id).then((value) => {
      if (!cancelled) setOpenMistakes(value);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const loadCards = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    const seq = (loadSeq.current += 1);
    const userId = user.id;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setDueTotal(null);
    processingRef.current = false;
    try {
      const validFilter = !materialFilter || UUID.test(materialFilter);
      const scope = materialFilter ? { materialId: materialFilter } : {};
      const data = validFilter ? await getDueCards(userId, scope) : [];
      // An empty queue waits for its meaning, so «Карточек пока нет» never flashes «На сегодня всё» first.
      const meaning = data.length === 0 && validFilter ? await reviewOutlook(userId, materialFilter) : null;
      if (seq !== loadSeq.current) return;
      setOutlook(meaning);
      if (data.length >= QUEUE_SIZE) {
        // A full page: more cards may be due than this session holds.
        void Promise.resolve()
          .then(() => countDueCards(userId, scope))
          .then((value) => {
            if (seq === loadSeq.current) setDueTotal(value);
          })
          .catch(() => undefined);
      }
      setCards(data);
      setIdx(0);
      setFlipped(false);
      setJudged(null);
      setCounts({ forgot: 0, hard: 0, remember: 0 });
      setTomorrow(0);
      setReturned([]);
      setDone(false);
      void loadLectureTitles(data).then(setTitles);
    } catch (error) {
      if (seq !== loadSeq.current) return;
      console.error('Error loading due cards:', error);
      setCards([]);
      setLoadError('Карточки на месте — повторите через минуту.');
    } finally {
      // A newer load owns the page now.
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [user?.id, materialFilter]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  useEffect(() => {
    if (!loading) {
      setLoadingLine(false);
      return;
    }
    const timer = setTimeout(() => setLoadingLine(true), LOADING_LINE_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  useEffect(() => () => {
    if (nextTimer.current) clearTimeout(nextTimer.current);
  }, []);

  const flip = () => {
    if (flipped || judged) return;
    setFlipped(true);
    setFlippedOnce(true);
  };

  // The three words take the focus once the card is turned over, so 1, 2, 3 and Tab start there. A long
  // answer or a phone's height can put them below the window: they stick to its foot (Review.css), and
  // the page brings them into view in case the reader had scrolled past them.
  useEffect(() => {
    if (!flipped || judged) return;
    const grades = gradesRef.current;
    grades?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    if (grades && typeof grades.scrollIntoView === 'function') {
      const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      grades.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
    }
  }, [flipped, judged]);

  const recordActivity = () => {
    if (!user?.id) return activityChain.current;
    const userId = user.id;
    activityChain.current = activityChain.current
      .then(() => recordStudyActivity(userId, 1, 0))
      .catch((err) => console.error('Error recording study activity:', err));
    return activityChain.current;
  };

  const handleAnswer = async (grade: Grade) => {
    const card = cards[idx];
    if (!card || processingRef.current || judged) return;
    const quality = GRADES.find((item) => item.grade === grade)?.quality ?? 3;

    processingRef.current = true;
    setProcessing(true);
    setSaveError(null);

    try {
      if (!card.id) throw new Error('Review card is missing its database id.');
      const eventId = pendingEventIds.current.get(card.id) ?? newEventId();
      pendingEventIds.current.set(card.id, eventId);
      const result = await updateCardProgress(card.id, quality, { clientEventId: eventId, sessionId });
      pendingEventIds.current.delete(card.id);

      // When the card comes back, as the server computed it; without that number nothing is promised.
      const days = typeof result?.interval_days === 'number' && Number.isFinite(result.interval_days) ? result.interval_days : NaN;
      setCounts((previous) => ({ ...previous, [grade]: previous[grade] + 1 }));
      if (days === 1) setTomorrow((previous) => previous + 1);
      if (Number.isFinite(days)) {
        const { followUp, context } = cardContext(card, titles);
        setReturned((previous) => [...previous, { key: `${card.id}:${previous.length}`, question: plainQuestion(card.question), days, followUp, note: context }]);
      }

      const activity = recordActivity();
      const last = idx + 1 >= cards.length;
      // The last answer: the done screen and «Сегодня» after it must already see the counters.
      if (last) await activity;
      setJudged({ grade, days });
      nextTimer.current = setTimeout(() => {
        nextTimer.current = null;
        if (last) {
          track('review_done', { cards: countBucket(cards.length), early: false });
          setDone(true);
        } else {
          setIdx((previous) => previous + 1);
          setFlipped(false);
          setJudged(null);
          flipButtonRef.current?.focus({ preventScroll: true });
        }
      }, NEXT_CARD_MS);
    } catch (error) {
      console.error('Error saving card progress:', error);
      setSaveError('Ответ не сохранён. Проверьте соединение и попробуйте ещё раз.');
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  };

  // Space or Enter turns the card over; 1, 2 and 3 grade it (not while typing or in a dialog).
  useEffect(() => {
    if (loading || done || cards.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const onControl = Boolean(target?.closest('button, a'));
      if (!flipped && (event.key === ' ' || event.key === 'Enter')) {
        if (onControl) return; // the focused control does its own thing
        event.preventDefault();
        flip();
        return;
      }
      if (flipped && !judged) {
        const choice = GRADES.find((item) => item.key === event.key);
        if (choice) {
          event.preventDefault();
          void handleAnswer(choice.grade);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const finish = () => {
    const answered = counts.forgot + counts.hard + counts.remember;
    if (answered === 0) {
      navigate('/dashboard');
      return;
    }
    if (nextTimer.current) clearTimeout(nextTimer.current);
    track('review_done', { cards: countBucket(answered), early: true });
    setDone(true);
  };

  if (loading) {
    return (
      <div className="sf-page rv">
        <div className="rv-col rv-state" role="status" aria-label="Загружаем карточки">
          {loadingLine ? <p className="rv-quiet">Загружаем карточки…</p> : null}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="sf-page rv">
        <div className="rv-col rv-state">
          <div className="rv-note-card" role="alert">
            <h1 className="rv-h2">Не удалось загрузить карточки</h1>
            <p className="rv-quiet rv-gap-s">{loadError}</p>
          </div>
          <button type="button" className="sf-secondary rv-gap-m" onClick={() => void loadCards()}>
            Повторить загрузку
          </button>
        </div>
      </div>
    );
  }

  // No cards due
  if (cards.length === 0) {
    const copy = emptyQueueCopy(outlook, materialFilter !== null);
    return (
      <div className="sf-page rv">
        <div className="rv-col rv-state">
          <section className="rv-empty" data-kind={copy.kind}>
            <div className="rv-art" aria-hidden="true">
              <b />
              <b />
              <b>
                {/* A tick only when the day's cards are done; a student without cards sees a blank card. */}
                {copy.kind === 'done' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : null}
              </b>
            </div>
            <h1 className="rv-h2">{ty(copy.title)}</h1>
            <p className="rv-quiet rv-gap-s rv-empty-p">{ty(copy.text)}</p>
            {materialFilter ? (
              <div className="rv-acts">
                <button type="button" className="sf-secondary" onClick={() => navigate('/review')}>
                  Все карточки к повторению
                </button>
                {UUID.test(materialFilter) ? (
                  <button type="button" className="sf-link" data-muted="" onClick={() => navigate(`/library/${materialFilter}`)}>
                    К лекции
                  </button>
                ) : null}
              </div>
            ) : copy.kind === 'none' ? (
              // A student without cards: the one way to get them.
              <div className="rv-acts">
                <Link className="sf-primary" to="/analyze">
                  Разобрать лекцию
                </Link>
              </div>
            ) : (
              <div className="rv-acts">
                <Link className="sf-secondary" to="/exams">
                  Экзамены
                </Link>
                <Link className="sf-link" data-muted="" to="/library">
                  Лекции
                </Link>
              </div>
            )}
          </section>
          <MistakesEntry count={openMistakes} />
        </div>
      </div>
    );
  }

  // Session done
  if (done) {
    const total = counts.forgot + counts.hard + counts.remember;
    // Cards left in this queue (the session was ended early), or a full queue: more may be due.
    const mayHaveMore = total < cards.length || cards.length >= QUEUE_SIZE;
    // The answered cards by the day they come back (the server's interval), nearest first.
    const byDay = new Map<number, Returned[]>();
    for (const item of returned) byDay.set(item.days, [...(byDay.get(item.days) ?? []), item]);
    const columns = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
    return (
      <div className="sf-page rv">
        <div className="rv-col rv-col-done">
          <section className="rv-done" aria-labelledby="rv-done-h">
            <div className="rv-done-main">
              <h1 id="rv-done-h" className="rv-h1">
                Повторили {total} {pluralRu(total, ['карточку', 'карточки', 'карточек'])}
              </h1>
              <p className="rv-done-line">
                {`Помню — ${counts.remember}, с трудом — ${counts.hard}, не помню — ${counts.forgot}.`}
                {tomorrow > 0 ? ` Завтра ${tomorrow === 1 ? 'вернётся' : 'вернутся'} ${tomorrow}.` : ''}
              </p>
              <p className="rv-saved">Ответы сохранены.</p>
              <div className="rv-acts">
                {mayHaveMore ? (
                  <button type="button" className="sf-primary" onClick={() => void loadCards()}>
                    Продолжить
                  </button>
                ) : null}
                {/* The list of exams, named as it is: it used to say «Лист экзамена» and open the list. Beside
                    «Продолжить» a phone makes it a quiet link: one pill on the screen. */}
                <Link className={phone && mayHaveMore ? 'sf-link' : 'sf-secondary'} to="/exams">
                  Экзамены
                </Link>
                <Link className="sf-link" data-muted="" to="/library">
                  Лекции
                </Link>
              </div>
            </div>
            <div className="rv-art rv-art-done" aria-hidden="true">
              <b />
              <b />
              <b>{total}</b>
            </div>
          </section>

          {columns.length > 0 ? (
            <section className="rv-days" aria-labelledby="rv-days-h">
              <h2 id="rv-days-h" className="rv-days-h">
                Когда вернутся
              </h2>
              <ol className="rv-cols">
                {columns.map(([days, items], index) => (
                  <li key={days} className="rv-day" data-first={index === 0 ? '' : undefined}>
                    <p className="rv-day-h">
                      <span className="rv-day-n" aria-hidden="true">
                        {items.length}
                      </span>
                      {dayColumnTitle(days)}
                      <span className="sr-only">{`: ${items.length} ${pluralRu(items.length, ['карточка', 'карточки', 'карточек'])}`}</span>
                    </p>
                    <ul className="rv-minis">
                      {items.slice(0, 3).map((item) => (
                        <li key={item.key} className="rv-mini" data-followup={item.followUp ? '' : undefined}>
                          <span className="rv-mini-q">{item.question}</span>
                          {item.note ? <small className="rv-mini-note">{item.note}</small> : null}
                        </li>
                      ))}
                    </ul>
                    {items.length > 3 ? <p className="rv-more">и ещё {items.length - 3}</p> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <MistakesEntry count={openMistakes} />
        </div>
      </div>
    );
  }

  const card = cards[idx];
  const { followUp, title, context } = cardContext(card, titles);
  const note = sourceNote(title, card.source_ids);
  const hand = judged ? handPhraseFor(judged.days) : null;
  const longQuestion = card.question.length > 90;
  const longAnswer = card.answer.length > 220;
  const progress = cards.length > 0 ? (idx + (judged ? 1 : 0)) / cards.length : 0;
  const judgedWord = judged ? GRADES.find((item) => item.grade === judged.grade)?.word ?? '' : '';
  // The cards still waiting under this one (at most two are drawn).
  const under = Math.min(2, cards.length - idx - 1);
  // «1 из 20 · всего на сегодня 24» when the session is a page of a longer day (decision 4).
  const dayTotal = sessionTotalWords(cards.length, dueTotal);

  return (
    <div className="sf-page rv">
      <div className="rv-col">
        {/* The card's question is the visible headline; the page still gets its level-1 heading for screen readers. */}
        <h1 className="sr-only">Повторение</h1>
        <div className="rv-top">
          <p className="rv-where" title={context || undefined}>
            <b>
              {idx + 1} из {cards.length}
            </b>
            {dayTotal ? (
              <span className="rv-total">
                <span className="rv-sep"> · </span>
                {dayTotal}
              </span>
            ) : null}
            {/* Where the card comes from; on a phone the card's own label says it. */}
            {context ? <span className="rv-ctx">{` · ${context}`}</span> : null}
          </p>
          <button type="button" className="sf-link rv-end" data-muted="" onClick={finish}>
            Закончить
          </button>
        </div>
        <div className="rv-progress" aria-hidden="true">
          <i style={{ width: `${Math.max(progress, 1 / cards.length) * 100}%` }} />
        </div>

        <div className="sf-deck rv-deck" data-enter="" data-under={under} key={card.id ?? idx}>
          {under >= 2 ? <div className="sf-index-card sf-deck-under rv-under" data-n="2" aria-hidden="true" /> : null}
          {under >= 1 ? <div className="sf-index-card sf-deck-under rv-under" data-n="1" aria-hidden="true" /> : null}
          <div className="sf-flip" data-flipped={flipped ? '' : undefined} onClick={flip}>
            <div className="sf-flip-inner">
              <section
                className="sf-index-card sf-flip-face rv-face"
                data-side="front"
                data-followup={followUp ? '' : undefined}
                aria-hidden={flipped}
                aria-label="Вопрос"
              >
                <p className={followUp ? 'rv-chip' : 'rv-label'}>{followUp ? 'Вопрос экзаменатора' : title ?? 'Вопрос'}</p>
                <div className={`${PAPER_MD} rv-q`} data-long={longQuestion ? '' : undefined}>
                  <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{repairMathEscapes(stripSourceMarkers(card.question))}</ReactMarkdown>
                </div>
              </section>
              <section
                className="sf-index-card sf-flip-face rv-face"
                data-side="back"
                data-followup={followUp ? '' : undefined}
                aria-hidden={!flipped}
                aria-label="Ответ"
              >
                <p className="rv-label">Ответ</p>
                {flipped ? (
                  <div className={`${PAPER_MD} rv-a`} data-long={longAnswer ? '' : undefined}>
                    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>{repairMathEscapes(stripSourceMarkers(card.answer))}</ReactMarkdown>
                  </div>
                ) : null}
                {note ? <p className="sf-pnote rv-source">{note}</p> : null}
                {judged ? (
                  hand ? (
                    <span className="rv-hand">
                      <HandPhraseMark phrase={hand} px={26} />
                    </span>
                  ) : Number.isFinite(judged.days) ? (
                    <span className="sf-pnote rv-when">{`через ${judged.days} ${pluralRu(judged.days, ['день', 'дня', 'дней'])}`}</span>
                  ) : null
                ) : null}
              </section>
            </div>
          </div>
        </div>

        <div className="rv-controls" aria-busy={processing}>
          {!flipped ? (
            // The hint stays on a computer; a phone shows it shorter, in one line, and only until the first card is
            // turned over (Review.css).
            <div className="rv-flip-row" data-seen={flippedOnce ? '' : undefined}>
              <button ref={flipButtonRef} type="button" className="sf-primary" onClick={flip} aria-keyshortcuts="Space Enter">
                Перевернуть
              </button>
              <p className="rv-quiet">{phone ? 'Вспомните ответ, потом переверните.' : 'Сначала вспомните ответ, потом переверните карточку.'}</p>
            </div>
          ) : judged ? (
            <p className="rv-judged" role="status">
              {Number.isFinite(judged.days) ? `${judgedWord} — ${returnsIn(judged.days)}.` : `${judgedWord}.`}
            </p>
          ) : (
            <div ref={gradesRef} className="rv-grades" role="group" aria-label="Как вспомнилось">
              {GRADES.map((item) => (
                <button
                  key={item.grade}
                  type="button"
                  className="rv-grade"
                  onClick={() => void handleAnswer(item.grade)}
                  disabled={processing}
                  aria-keyshortcuts={item.key}
                  aria-label={item.word}
                >
                  <span className="rv-grade-w">{item.word}</span>
                  <span className="rv-key" aria-hidden="true">
                    {item.key}
                  </span>
                </button>
              ))}
            </div>
          )}
          {processing ? (
            <p role="status" aria-live="polite" className="rv-quiet rv-gap-s">
              Сохраняем ответ…
            </p>
          ) : null}
          {saveError ? (
            <p role="alert" className="rv-alert">
              {saveError}
            </p>
          ) : null}
        </div>
        {phone ? <MistakesLine count={openMistakes} /> : <MistakesEntry count={openMistakes} />}
      </div>
    </div>
  );
}
