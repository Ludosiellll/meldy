/**
 * TEST ONLY: the shared cases of «learned» for an oral question (contracts/learn_left/vectors.json). Each case is a
 * sheet as meldy_private.oral_sheet_for / GET /api/oral/sheet gives it, the journal rows of its written questions as
 * fetchSheetEvents reads them, a moment and a zone. learnFacts.vectors.test.ts computes the facts with the site's line
 * rule and writes or checks the JSON; supabase/tests/local/learn_left_run.sh feeds the same JSON to
 * meldy_private.learn_left_facts. Ids and hashes are made up.
 */
import type { LearningEvent } from '../../../types/learning';

export interface LearnLeftCase {
  name: string;
  about: string;
  now: string;
  tz: string;
  sheet: { exam_id: string; mapping_state: string; questions: Array<Record<string, unknown>>; to_write: number; units: number; unwritable: number; job: null };
  events: LearningEvent[];
}

const EXAM = '0e000000-0000-4000-8000-000000000001';
const hex = (n: number) => n.toString(16).padStart(2, '0');
const qid = (n: number) => `0e000000-0000-4000-8000-0000000001${hex(n)}`;
const hash = (n: number) => `${hex(n)}`.repeat(16);
const rid = (n: number) => `0e000000-0000-4000-8000-0000000002${hex(n)}`;
const sid = (n: number) => `0e000000-0000-4000-8000-0000000003${hex(n)}`;

interface PointSpec {
  id: string;
  title: string;
  essential?: boolean;
}

function point(p: PointSpec) {
  return { id: p.id, title: p.title, short: '', essential: p.essential === true, source_quote: 'Цитата из лекции.', source_ids: ['M1:S1'] };
}

function question(n: number, extra: Record<string, unknown> = {}) {
  return {
    question_id: qid(n),
    position: n,
    label: String(n),
    section: null,
    text: `Вопрос номер ${n}`,
    question_hash: hash(n),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rubric: null,
    rebuilt: false,
    unwritable: false,
    ...extra,
  };
}

function written(n: number, points: PointSpec[], rubric = rid(n), coverage = 'full') {
  return question(n, {
    rubric: {
      rubric_id: rubric,
      built_at: '2026-09-30T10:00:00+00:00',
      coverage,
      coverage_note: '',
      materials: [{ key: 'M1', material_id: '0e000000-0000-4000-8000-000000000901', title: 'Лекция' }],
      points: points.map(point),
    },
  });
}

let seq = 0;
function eventId(): string {
  seq += 1;
  return `0e000000-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
}

interface Naming {
  q: number;
  at: string;
  day?: string;
  title: string;
  /** covered (named) · partial · wrong · missing; with `followup` 'covered': named after the examiner's question. */
  status?: 'covered' | 'partial' | 'wrong' | 'missing';
  followup?: 'covered';
  correct?: boolean | null;
  session?: number;
  rubric?: string;
  point?: string;
  noTitle?: boolean;
  id?: string;
}

function oral(n: Naming): LearningEvent {
  const status = n.status ?? 'covered';
  const correct = n.correct !== undefined ? n.correct : status === 'covered' || n.followup === 'covered' ? true : false;
  const payload: Record<string, unknown> = {
    question_hash: hash(n.q),
    rubric_id: n.rubric ?? rid(n.q),
    point_id: n.point ?? 'p1',
    status,
  };
  if (!n.noTitle) payload.title = n.title;
  if (n.followup) payload.followup_status = n.followup;
  return {
    id: n.id ?? eventId(),
    created_at: n.at,
    local_date: n.day ?? n.at.slice(0, 10),
    material_id: null,
    kind: 'oral_point',
    item_key: `oral:${n.rubric ?? rid(n.q)}:${n.point ?? 'p1'}`,
    correct,
    score: null,
    confidence: null,
    source_ids: [],
    session_id: n.session === undefined ? sid(1) : n.session === 0 ? null : sid(n.session),
    payload,
  };
}

function peek(q: number, at: string, title: string, point = 'p1', day?: string): LearningEvent {
  return {
    id: eventId(),
    created_at: at,
    local_date: day ?? at.slice(0, 10),
    material_id: null,
    kind: 'sheet_peek',
    item_key: `peek:${rid(q)}:${point}`,
    correct: null,
    score: null,
    confidence: null,
    source_ids: [],
    session_id: null,
    payload: { question_hash: hash(q), rubric_id: rid(q), point_id: point, title },
  };
}

function sheet(questions: Array<Record<string, unknown>>): LearnLeftCase['sheet'] {
  return { exam_id: EXAM, mapping_state: 'done', questions, to_write: 0, units: 0, unwritable: 0, job: null };
}

const D1 = '2026-10-01';
const D2 = '2026-10-02';
const D3 = '2026-10-03';
const t = (day: string, time: string) => `${day}T${time}+00:00`;

export function learnLeftCases(): LearnLeftCase[] {
  seq = 0;
  return [
    {
      name: 'kinds_and_states',
      about: 'Every block kind; a question partly named with a miss, one named in full waiting for another day, one never answered.',
      now: t(D2, '12:00:00'),
      tz: 'UTC',
      sheet: sheet([
        written(1, [{ id: 'p1', title: 'Первичный ключ', essential: true }, { id: 'p2', title: 'Внешний ключ', essential: true }, { id: 'p3', title: 'Пример' }]),
        written(2, [{ id: 'p1', title: 'Нормальная форма' }, { id: 'p2', title: 'Зависимость' }]),
        written(3, [{ id: 'p1', title: 'Транзакция' }]),
        question(4),
        question(5, { coverage: 'none' }),
        question(6, { coverage: null, coverage_method: null }),
        question(7, { coverage: 'unverified', coverage_method: 'lexical' }),
        question(8, { unwritable: true }),
        question(9, { rebuilt: true, coverage: 'partial' }),
        written(10, [{ id: 'p1', title: 'Что-то' }], rid(10), 'none'),
      ]),
      events: [
        oral({ q: 1, at: t(D1, '10:00:00'), title: 'Первичный ключ', point: 'p1', session: 1 }),
        oral({ q: 1, at: t(D1, '10:00:00.200'), title: 'Внешний ключ', point: 'p2', session: 1 }),
        oral({ q: 1, at: t(D1, '10:00:00.300'), title: 'Пример', point: 'p3', status: 'missing', session: 1 }),
        oral({ q: 1, at: t(D2, '08:00:00'), title: 'Первичный ключ', point: 'p1', session: 2 }),
        oral({ q: 1, at: t(D2, '08:00:00.100'), title: 'Внешний ключ', point: 'p2', status: 'partial', session: 2 }),
        oral({ q: 2, at: t(D1, '10:00:00'), title: 'Нормальная форма', point: 'p1', session: 3 }),
        oral({ q: 2, at: t(D1, '10:00:01'), title: 'Зависимость', point: 'p2', session: 3 }),
      ],
    },
    {
      name: 'peek_same_day',
      about: 'A naming after a peek of that point the same day does not count; a peek after the naming does not undo it; a peek today moves the ready moment to tomorrow.',
      now: t(D2, '12:00:00'),
      tz: 'UTC',
      sheet: sheet([
        written(1, [{ id: 'p1', title: 'Индекс' }]),
        written(2, [{ id: 'p1', title: 'Представление' }]),
        written(3, [{ id: 'p1', title: 'Триггер' }]),
      ]),
      events: [
        oral({ q: 1, at: t(D1, '10:00:00'), title: 'Индекс', session: 1 }),
        peek(1, t(D2, '09:00:00'), 'Индекс'),
        oral({ q: 1, at: t(D2, '10:00:00'), title: 'Индекс', session: 2 }),
        oral({ q: 2, at: t(D1, '10:00:00'), title: 'Представление', session: 3 }),
        oral({ q: 2, at: t(D2, '10:00:00'), title: 'Представление', session: 4 }),
        peek(2, t(D2, '11:00:00'), 'Представление'),
        oral({ q: 3, at: t(D1, '09:00:00'), title: 'Триггер', session: 5 }),
      ],
    },
    {
      name: 'followup_and_unrated',
      about: 'Named only after the examiner asked counts as a miss; an unrated point is ignored.',
      now: t(D3, '12:00:00'),
      tz: 'UTC',
      sheet: sheet([written(1, [{ id: 'p1', title: 'Курсор' }]), written(2, [{ id: 'p1', title: 'Процедура' }])]),
      events: [
        oral({ q: 1, at: t(D1, '10:00:00'), title: 'Курсор', session: 1 }),
        oral({ q: 1, at: t(D2, '10:00:00'), title: 'Курсор', status: 'missing', followup: 'covered', session: 2 }),
        oral({ q: 2, at: t(D1, '10:00:00'), title: 'Процедура', session: 3 }),
        oral({ q: 2, at: t(D2, '10:00:00'), title: 'Процедура', correct: null, session: 4 }),
      ],
    },
    {
      name: 'midnight_and_twenty_hours',
      about: '23:59 and 0:01 are two days but not 20 hours; 1:00 and 21:00 are 20 hours on one day; a third naming completes each.',
      now: t(D3, '23:00:00'),
      tz: 'UTC',
      sheet: sheet([written(1, [{ id: 'p1', title: 'Схема' }]), written(2, [{ id: 'p1', title: 'Кортеж' }]), written(3, [{ id: 'p1', title: 'Домен' }])]),
      events: [
        oral({ q: 1, at: t(D1, '23:59:00'), title: 'Схема', session: 1 }),
        oral({ q: 1, at: t(D2, '00:01:00'), title: 'Схема', session: 2 }),
        oral({ q: 1, at: t(D2, '19:59:00'), title: 'Схема', session: 3 }),
        oral({ q: 1, at: t(D2, '20:00:00'), title: 'Схема', session: 4 }),
        oral({ q: 2, at: t(D1, '01:00:00'), title: 'Кортеж', session: 5 }),
        oral({ q: 2, at: t(D1, '21:00:00'), title: 'Кортеж', session: 6 }),
        oral({ q: 2, at: t(D2, '00:30:00'), title: 'Кортеж', session: 7 }),
        oral({ q: 3, at: t(D1, '23:59:00'), title: 'Домен', session: 8 }),
        oral({ q: 3, at: t(D2, '00:01:00'), title: 'Домен', session: 9 }),
      ],
    },
    {
      name: 'rebuilt_rubric_and_words',
      about: 'A rubric rebuilt with the same point keeps its history by the words (case, «ё», punctuation aside); other words do not count; an event with no title falls back to its key.',
      now: t(D3, '12:00:00'),
      tz: 'UTC',
      sheet: sheet([
        written(1, [{ id: 'p1', title: 'Отношение — это таблица.' }, { id: 'p2', title: 'Атрибут' }]),
        written(2, [{ id: 'p1', title: 'Ёмкость связи' }]),
      ]),
      events: [
        oral({ q: 1, at: t(D1, '10:00:00'), title: 'ОТНОШЕНИЕ это таблица', rubric: '0e000000-0000-4000-8000-0000000002ff', point: 'p4', session: 1 }),
        oral({ q: 1, at: t(D2, '10:00:00'), title: 'отношение  это — таблица!', session: 2 }),
        oral({ q: 1, at: t(D1, '10:00:01'), title: 'Атрибуты', point: 'p2', session: 1 }),
        oral({ q: 2, at: t(D1, '10:00:00'), title: 'x', noTitle: true, session: 3 }),
        oral({ q: 2, at: t(D2, '11:00:00'), title: 'емкость связи', session: 4 }),
      ],
    },
    {
      name: 'twins_and_one_per_answer',
      about: 'Two points of one rubric with the same words are told apart by their ids; one answer names a line once (its own point first, else the lower id).',
      now: t(D3, '12:00:00'),
      tz: 'UTC',
      sheet: sheet([written(1, [{ id: 'p1', title: 'Ключ' }, { id: 'p2', title: 'Ключ' }]), written(2, [{ id: 'p1', title: 'Связь' }])]),
      events: [
        oral({ q: 1, at: t(D1, '10:00:00'), title: 'Ключ', point: 'p1', session: 1 }),
        oral({ q: 1, at: t(D1, '10:00:00.100'), title: 'Ключ', point: 'p2', status: 'missing', session: 1 }),
        oral({ q: 1, at: t(D2, '10:00:00'), title: 'Ключ', point: 'p1', session: 2 }),
        oral({ q: 1, at: t(D2, '10:00:00.100'), title: 'Ключ', point: 'p2', session: 2 }),
        oral({ q: 2, at: t(D1, '10:00:00'), title: 'Связь', session: 3, id: '0e000000-0000-4000-8000-0000000000b2' }),
        oral({ q: 2, at: t(D1, '10:00:00.500'), title: 'Связь', status: 'missing', session: 3, id: '0e000000-0000-4000-8000-0000000000b1' }),
        oral({ q: 2, at: t(D2, '11:00:00'), title: 'Связь', session: 4 }),
      ],
    },
    {
      name: 'returned_and_due',
      about: 'A learned point missed later is not learned again until a new series; a point learned long ago stays learned while its check is due.',
      now: t('2026-11-20', '12:00:00'),
      tz: 'UTC',
      sheet: sheet([written(1, [{ id: 'p1', title: 'Нормализация' }]), written(2, [{ id: 'p1', title: 'Денормализация' }])]),
      events: [
        oral({ q: 1, at: t(D1, '10:00:00'), title: 'Нормализация', session: 1 }),
        oral({ q: 1, at: t(D2, '10:00:00'), title: 'Нормализация', session: 2 }),
        oral({ q: 1, at: t(D3, '10:00:00'), title: 'Нормализация', status: 'wrong', session: 3 }),
        oral({ q: 1, at: t('2026-10-04', '10:00:00'), title: 'Нормализация', session: 4 }),
        oral({ q: 2, at: t(D1, '10:00:00'), title: 'Денормализация', session: 5 }),
        oral({ q: 2, at: t(D2, '10:00:00'), title: 'Денормализация', session: 6 }),
      ],
    },
  ];
}
