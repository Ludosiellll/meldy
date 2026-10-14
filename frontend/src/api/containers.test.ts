import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ITEM_COLUMNS, type ItemInput } from '../types/container';
import overviewJson from '../../../contracts/container/overview.json';
import summaryJson from '../../../contracts/container/summary.json';
import planInputsJson from '../../../contracts/container/plan_inputs.json';
import itemsPageJson from '../../../contracts/container/items_page.json';
import oralSyncJson from '../../../contracts/container/oral_sync.json';
import parseBankJson from '../../../contracts/container/parse_bank_two_subjects.json';

/** The Supabase client, replaced: RPCs and table queries are recorded and answered by `db.rpc` / `db.table`. */
type Op = [string, unknown[]];
interface Entry { table: string; ops: Op[] }
interface Answer { data: unknown; error: unknown; status?: number }

const db = vi.hoisted(() => {
  const state = {
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown>; signal: AbortSignal | null }>,
    tableCalls: [] as Entry[],
    rpc: (_name: string, _args: Record<string, unknown>): Answer | Promise<Answer> => ({ data: null, error: null, status: 200 }),
    table: (_entry: Entry): Answer | Promise<Answer> => ({ data: [], error: null, status: 200 }),
  };
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      const call = { name, args, signal: null as AbortSignal | null };
      state.rpcCalls.push(call);
      const builder = {
        abortSignal(signal: AbortSignal) {
          call.signal = signal;
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve().then(() => state.rpc(name, args)).then(resolve, reject);
        },
      };
      return builder;
    },
    from(table: string) {
      const entry: Entry = { table, ops: [] };
      state.tableCalls.push(entry);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'gt', 'in', 'order', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          entry.ops.push([method, args]);
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(() => state.table(entry)).then(resolve, reject);
      return builder;
    },
  };
  return Object.assign(state, { client });
});

vi.mock('../lib/supabase', () => ({ supabase: db.client }));

import {
  ANSWERS_PER_CALL,
  CONTAINER_ERROR_TEXT,
  ContainerApiError,
  ITEMS_PAGE_SIZE,
  ITEMS_PER_CALL,
  LINKS_LIMIT_TEXT,
  NOTHING_TO_SHARE_TEXT,
  addItems,
  containerErrorText,
  createContainer,
  deleteContainer,
  deleteItem,
  fetchAllItems,
  fetchItemsPage,
  fetchOverview,
  fetchPlanInputs,
  fetchSummary,
  finishMock,
  isContainersUnavailable,
  isGone,
  isOffline,
  joinByCode,
  normalizeCode,
  oralSync,
  parseBank,
  previewLink,
  recordAnswers,
  removeMember,
  saveSettings,
  updateContainer,
  updateSubject,
} from './containers';

const C1 = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
const S1 = '69ead689-38d6-4350-bc5d-13d273f8b9b2';
const S2 = '590a774c-7a67-4b13-a944-cf9a2f0e9d9b';
const ORAL = 'c0390f9c-787d-4d0e-a82d-9efa069bfe11';

const op = (entry: Entry, name: string) => entry.ops.find(([method]) => method === name)?.[1];

async function caught(promise: Promise<unknown>): Promise<ContainerApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ContainerApiError);
    return error as ContainerApiError;
  }
  throw new Error('expected a ContainerApiError');
}

/** `count` items of one subject, positions 1..count, as test_items rows. */
function rows(subjectId: string, count: number, from = 1) {
  return Array.from({ length: count }, (_, index) => ({
    ...itemsPageJson[0],
    id: `${subjectId.slice(0, 8)}-item-${from + index}`,
    subject_id: subjectId,
    position: from + index,
  }));
}

/** Answers test_items keyset pages of a subject holding `counts[subject]` items. */
function serveItems(counts: Record<string, number>) {
  db.table = (entry) => {
    const subject = op(entry, 'eq')?.[1] as string;
    const after = op(entry, 'gt')?.[1] as number;
    const limit = op(entry, 'limit')?.[0] as number;
    const total = counts[subject] ?? 0;
    const first = after + 1;
    const n = Math.max(0, Math.min(limit, total - after));
    return { data: rows(subject, n, first), error: null, status: 200 };
  };
}

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db.rpcCalls = [];
  db.tableCalls = [];
  db.rpc = () => ({ data: null, error: null, status: 200 });
  db.table = () => ({ data: [], error: null, status: 200 });
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('error mapping', () => {
  const failing = (code: string, message = 'raised', status = 400, details: string | null = null) => {
    db.rpc = () => ({ data: null, error: { code, message, details, hint: null }, status });
  };

  it.each([
    ['MC001', 'Ссылка не найдена — проверьте, что вставили её целиком.'],
    ['MC002', 'Автор закрыл эту ссылку.'],
    ['MC003', 'Срок ссылки истёк — попросите у автора новую.'],
    ['MC004', 'Места по этой ссылке закончились — попросите у автора новую.'],
    ['MC005', 'Это ваша ссылка — по ней приходят участники.'],
    ['MC006', 'Автор убрал вас из этого экзамена.'],
    ['MC007', 'Слишком много: в экзамене до 20 предметов и 2000 вопросов.'],
    ['MC008', 'Чтобы поделиться устными предметами, отметьте согласие.'],
    ['MC009', 'Сначала уберите участников — потом экзамен можно удалить.'],
    ['42501', 'Это может сделать только автор экзамена.'],
    ['P0002', 'Не нашли — возможно, его уже удалили.'],
    ['22023', 'Что-то не так с данными — обновите страницу и попробуйте снова.'],
  ])('%s → its code and the Russian text', async (code, text) => {
    // PostgREST answers P0002 with 500 (P0*), our own codes with 400: the code decides, never the status.
    failing(code, 'raised', code === 'P0002' ? 500 : 400);
    const error = await caught(joinByCode('abcdefghjkmn'));
    expect(error.code).toBe(code);
    expect(error.message).toBe(text);
    expect(containerErrorText(error)).toBe(text);
    expect(CONTAINER_ERROR_TEXT[code as keyof typeof CONTAINER_ERROR_TEXT]).toBe(text);
  });

  it('says what each limit means: ten open links, and nothing to share yet', async () => {
    failing('MC007', 'at most 10 open links');
    expect((await caught(fetchSummary(C1))).message).toBe(LINKS_LIMIT_TEXT);
    failing('MC007', 'at most 2000 items in a container', 400, '1990 in the container, 20 more do not fit');
    const items = await caught(fetchSummary(C1));
    expect(items.message).toBe(CONTAINER_ERROR_TEXT.MC007);
    expect(items.detail).toBe('1990 in the container, 20 more do not fit');
    failing('22023', 'nothing to share yet');
    expect((await caught(fetchSummary(C1))).message).toBe(NOTHING_TO_SHARE_TEXT);
  });

  it('keeps the server detail of a refused item for the import page', async () => {
    failing('22023', 'invalid item', 400, 'item 7: options');
    const error = await caught(addItems(S1, [{ ref: 'imp:1', stem: 'x', options: ['a'], correct: [0] }]));
    expect(error).toMatchObject({ code: '22023', detail: 'item 7: options', status: 400 });
  });

  it('a signed-out or expired session is 28000, an anonymous 42501 (HTTP 401, live) too', async () => {
    for (const [code, status] of [['28000', 403], ['PGRST301', 401], ['PGRST303', 401], ['', 401], ['42501', 401]] as const) {
      failing(code, 'JWT expired', status);
      const error = await caught(fetchSummary(C1));
      expect(error.code, code).toBe('28000');
      expect(error.message).toBe('Сессия истекла. Войдите снова.');
    }
  });

  it('a check violation of a direct write and a malformed id read as bad data (22023)', async () => {
    for (const code of ['23514', '23502', '22P02', '22007']) {
      db.table = () => ({ data: null, error: { code, message: 'violates check constraint' }, status: 400 });
      const error = await caught(updateContainer(C1, { title: ' ' }));
      expect(error.code, code).toBe('22023');
    }
  });

  it('a server failure is unknown with its status; the text is never the server’s English', async () => {
    failing('XX000', 'internal error', 500);
    const error = await caught(fetchSummary(C1));
    expect(error).toMatchObject({ code: 'unknown', status: 500, message: CONTAINER_ERROR_TEXT.unknown });
    expect(containerErrorText(new Error('TypeError: x is undefined'))).toBe(CONTAINER_ERROR_TEXT.unknown);
    expect(containerErrorText('boom')).toBe(CONTAINER_ERROR_TEXT.unknown);
  });
});

describe('no network', () => {
  it('a request that got no answer (PostgREST status 0) is network', async () => {
    db.rpc = () => ({ data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, status: 0 });
    const error = await caught(fetchSummary(C1));
    expect(error.code).toBe('network');
    expect(error.status).toBe(0);
    expect(error.message).toBe('Нет сети — попробуем ещё раз, когда она появится.');
    expect(isOffline(error)).toBe(true);
    expect(isContainersUnavailable(error)).toBe(false);
  });

  it('an aborted request (our timeout) and a thrown fetch failure are network too', async () => {
    db.rpc = () => ({ data: null, error: { message: 'AbortError: aborted', code: '', hint: 'Request was aborted' }, status: 0 });
    expect((await caught(recordAnswers([{ client_event_id: 'abcdefgh-1', item_id: C1, chosen: 0 }]))).code).toBe('network');
    db.rpc = () => {
      throw new TypeError('Failed to fetch');
    };
    expect(isOffline(await caught(fetchSummary(C1)))).toBe(true);
    db.table = () => {
      throw new TypeError('Load failed');
    };
    expect(isOffline(await caught(fetchItemsPage(S1)))).toBe(true);
  });

  it('other thrown things are not taken for the network', async () => {
    db.rpc = () => {
      throw new RangeError('bug');
    };
    expect((await caught(fetchSummary(C1))).code).toBe('unknown');
  });
});

describe('a database without the container functions', () => {
  it('fetchOverview resolves null on PGRST202 and 42883', async () => {
    for (const code of ['PGRST202', '42883']) {
      db.rpc = () => ({ data: null, error: { code, message: 'Could not find the function public.containers_overview' }, status: 404 });
      await expect(fetchOverview('2026-12-21')).resolves.toBeNull();
    }
  });

  it('the other reads throw unavailable; a missing table (PGRST205, 42P01) too', async () => {
    db.rpc = () => ({ data: null, error: { code: 'PGRST202', message: 'no function' }, status: 404 });
    const error = await caught(fetchPlanInputs('2026-12-21', C1));
    expect(error.code).toBe('unavailable');
    expect(isContainersUnavailable(error)).toBe(true);
    expect(error.message).toBe(CONTAINER_ERROR_TEXT.unavailable);
    for (const code of ['PGRST205', '42P01']) {
      db.table = () => ({ data: null, error: { code, message: 'relation does not exist' }, status: 404 });
      expect(isContainersUnavailable(await caught(fetchItemsPage(S1))), code).toBe(true);
    }
  });

  it('other overview failures still throw', async () => {
    db.rpc = () => ({ data: null, error: { code: '', message: 'Failed to fetch' }, status: 0 });
    expect(isOffline(await caught(fetchOverview()))).toBe(true);
  });
});

describe('reads', () => {
  it('reads the overview for the given day, or the device’s day', async () => {
    db.rpc = () => ({ data: overviewJson, error: null, status: 200 });
    const overview = await fetchOverview('2026-12-21');
    expect(db.rpcCalls[0]).toMatchObject({ name: 'containers_overview', args: { p_local_date: '2026-12-21' } });
    expect(overview?.containers[0].subjects).toHaveLength(3);
    expect(overview?.attached_exam_ids).toEqual([ORAL]);
    await fetchOverview();
    expect(db.rpcCalls[1].args.p_local_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('refuses a shape that is not an overview instead of crashing a screen', async () => {
    db.rpc = () => ({ data: '<html>', error: null, status: 200 });
    expect((await caught(fetchOverview('2026-12-21'))).code).toBe('unknown');
  });

  it('reads one container’s summary and plan inputs, the whole account’s without an id', async () => {
    db.rpc = (name) => ({ data: name === 'container_summary' ? summaryJson : planInputsJson, error: null, status: 200 });
    const summary = await fetchSummary(C1, '2026-12-21');
    expect(summary.items_version).toEqual({ count: 18, updated_at: '2026-12-14T16:03:05.069454+00:00' });
    expect(db.rpcCalls[0]).toMatchObject({ name: 'container_summary', args: { p_container_id: C1, p_local_date: '2026-12-21' } });
    const one = await fetchPlanInputs('2026-12-21', C1);
    expect(one.items).toHaveLength(18);
    expect(db.rpcCalls[1].args).toEqual({ p_local_date: '2026-12-21', p_container_id: C1 });
    await fetchPlanInputs('2026-12-21');
    expect(db.rpcCalls[2].args).toEqual({ p_local_date: '2026-12-21' });
  });

  it('an exam that is not the caller’s any more: its page’s reads answer null with HTTP 200, read as gone (third live check)', async () => {
    // 20261011100000: null, not P0002 — PostgREST answered that with 500, two errors in the console of a deleted exam.
    db.rpc = () => ({ data: null, error: null, status: 200 });
    const summary = await caught(fetchSummary(C1, '2026-12-21'));
    expect(summary).toMatchObject({ code: 'P0002', status: 200, message: CONTAINER_ERROR_TEXT.P0002 });
    expect(isGone(summary)).toBe(true);
    expect(isGone(await caught(fetchPlanInputs('2026-12-21', C1)))).toBe(true);
    // The whole account's plan inputs are never null: a null there is a bad answer, not a gone exam.
    const all = await caught(fetchPlanInputs('2026-12-21'));
    expect(all.code).toBe('unknown');
    // A database before the migration raised P0002 (HTTP 500): the same gone, so the site can go first.
    db.rpc = () => ({ data: null, error: { code: 'P0002', message: 'container not found', details: null, hint: null }, status: 500 });
    expect(isGone(await caught(fetchSummary(C1)))).toBe(true);
    expect(isGone(await caught(fetchPlanInputs('2026-12-21', C1)))).toBe(true);
  });

  it('an address that cannot be an exam’s (a cut link) is gone without a request', async () => {
    db.rpc = () => ({ data: summaryJson, error: null, status: 200 });
    for (const id of ['f4881273-7331-4c39-96d7', 'undefined', `${C1}x`]) {
      const error = await caught(fetchSummary(id));
      expect(error, id).toMatchObject({ code: 'P0002', status: null });
      expect(isGone(await caught(fetchPlanInputs('2026-12-21', id))), id).toBe(true);
    }
    expect(db.rpcCalls).toEqual([]);
  });
});

describe('items by keyset pages', () => {
  it('asks one subject’s page after a position: its columns, position order, 500 rows', async () => {
    serveItems({ [S1]: 12 });
    const page = await fetchItemsPage(S1, 0);
    expect(page).toHaveLength(12);
    const [entry] = db.tableCalls;
    expect(entry.table).toBe('test_items');
    expect(op(entry, 'select')).toEqual([TEST_ITEM_COLUMNS]);
    expect(op(entry, 'eq')).toEqual(['subject_id', S1]);
    expect(op(entry, 'gt')).toEqual(['position', 0]);
    expect(op(entry, 'order')).toEqual(['position', { ascending: true }]);
    expect(op(entry, 'limit')).toEqual([500]);
    expect(page[0]).toMatchObject({ subject_id: S1, position: 1, kind: 'single', options: itemsPageJson[0].options, correct: [0] });
  });

  it.each([
    [0, [0]],
    [499, [0]],
    [500, [0, 500]],
    [501, [0, 500]],
    [2000, [0, 500, 1000, 1500, 2000]],
  ])('%i items are read in pages after positions %j, nothing lost, nothing twice', async (count, afters) => {
    serveItems({ [S1]: count });
    const items = await fetchAllItems([S1]);
    expect(items).toHaveLength(count);
    expect(new Set(items.map((item) => item.id)).size).toBe(count);
    expect(items.map((item) => item.position)).toEqual(Array.from({ length: count }, (_, index) => index + 1));
    expect(db.tableCalls.map((entry) => op(entry, 'gt')?.[1])).toEqual(afters);
    expect(ITEMS_PAGE_SIZE).toBe(500);
  });

  it('keeps the subjects’ order, each by position', async () => {
    serveItems({ [S1]: 3, [S2]: 501 });
    const items = await fetchAllItems([S2, S1]);
    expect(items).toHaveLength(504);
    expect(items[0]).toMatchObject({ subject_id: S2, position: 1 });
    expect(items[500]).toMatchObject({ subject_id: S2, position: 501 });
    expect(items[501]).toMatchObject({ subject_id: S1, position: 1 });
  });

  it('stops on a page that does not move on instead of reading forever, and keeps each item once', async () => {
    db.table = () => ({ data: rows(S1, 500, 1).map((row) => ({ ...row, position: 7 })), error: null, status: 200 });
    const items = await fetchAllItems([S1]);
    expect(items).toHaveLength(500);
    expect(db.tableCalls.map((entry) => op(entry, 'gt')?.[1])).toEqual([0, 7]);
  });
});

describe('adding items', () => {
  /** A server that keeps refs per container: a resent ref inserts nothing (container_items_add). */
  function serveAdd() {
    const refs = new Map<string, number>();
    db.rpc = (name, args) => {
      if (name !== 'container_items_add') return { data: null, error: null, status: 200 };
      const batch = args.p_items as ItemInput[];
      let added = 0;
      const out = batch.map((item) => {
        if (!refs.has(item.ref)) {
          refs.set(item.ref, refs.size + 1);
          added += 1;
        }
        return { ref: item.ref, id: `id-${item.ref}`, position: refs.get(item.ref) };
      });
      return { data: { subject_id: args.p_subject_id, added, in_container: refs.size, items: out }, error: null, status: 200 };
    };
    return refs;
  }
  const items = (count: number): ItemInput[] =>
    Array.from({ length: count }, (_, index) => ({ ref: `imp1:${index + 1}`, stem: `Вопрос ${index + 1}`, options: ['а', 'б'], correct: [0] }));

  it('sends batches of 250 in order and reports progress after each', async () => {
    serveAdd();
    const progress: Array<[number, number]> = [];
    const added = await addItems(S1, items(600), (done, total) => progress.push([done, total]));
    expect(ITEMS_PER_CALL).toBe(250);
    expect(db.rpcCalls.map((call) => (call.args.p_items as ItemInput[]).length)).toEqual([250, 250, 100]);
    expect(db.rpcCalls.every((call) => call.name === 'container_items_add' && call.args.p_subject_id === S1)).toBe(true);
    expect((db.rpcCalls[1].args.p_items as ItemInput[])[0].ref).toBe('imp1:251');
    expect(progress).toEqual([[250, 600], [500, 600], [600, 600]]);
    expect(added.map((batch) => batch.added)).toEqual([250, 250, 100]);
    expect(added[2].in_container).toBe(600);
  });

  it('at the edges: nothing sends nothing, 250 is one call, 251 two', async () => {
    serveAdd();
    expect(await addItems(S1, [])).toEqual([]);
    expect(db.rpcCalls).toHaveLength(0);
    await addItems(S1, items(250));
    expect(db.rpcCalls).toHaveLength(1);
    db.rpcCalls = [];
    serveAdd();
    await addItems(S1, items(251));
    expect(db.rpcCalls.map((call) => (call.args.p_items as ItemInput[]).length)).toEqual([250, 1]);
  });

  it('resending after a failure adds nothing twice: the refs are the same', async () => {
    const refs = serveAdd();
    const all = items(600);
    const serve = db.rpc;
    let calls = 0;
    db.rpc = (name, args) => {
      calls += 1;
      if (calls === 2) return { data: null, error: { code: '', message: 'Failed to fetch' }, status: 0 };
      return serve(name, args);
    };
    expect(isOffline(await caught(addItems(S1, all)))).toBe(true);
    expect(refs.size).toBe(250);
    db.rpc = serve;
    db.rpcCalls = [];
    const again = await addItems(S1, all);
    expect(again.map((batch) => batch.added)).toEqual([0, 250, 100]);
    expect(refs.size).toBe(600);
    expect((db.rpcCalls[0].args.p_items as ItemInput[]).map((item) => item.ref)).toEqual(all.slice(0, 250).map((item) => item.ref));
  });
});

describe('answers and «Как на экзамене»', () => {
  it('records answers in calls of at most 50, results in order', async () => {
    db.rpc = (_name, args) => ({
      data: { v: 1, server_day: '2026-12-21', results: (args.p_answers as Array<{ client_event_id: string }>).map((a) => ({ client_event_id: a.client_event_id, status: 'saved' })) },
      error: null,
      status: 200,
    });
    const answers = Array.from({ length: 120 }, (_, index) => ({ client_event_id: `session-1:${index}`, item_id: C1, chosen: 0 }));
    const response = await recordAnswers(answers);
    expect(ANSWERS_PER_CALL).toBe(50);
    expect(db.rpcCalls.map((call) => (call.args.p_answers as unknown[]).length)).toEqual([50, 50, 20]);
    expect(response.results.map((result) => result.client_event_id)).toEqual(answers.map((answer) => answer.client_event_id));
    expect(response.server_day).toBe('2026-12-21');
  });

  it('passes the caller’s signal (the queue’s timeout) to the request', async () => {
    db.rpc = () => ({ data: { v: 1, server_day: '2026-12-21', results: [] }, error: null, status: 200 });
    const controller = new AbortController();
    await recordAnswers([{ client_event_id: 'session-1:0', item_id: C1, chosen: 0 }], { signal: controller.signal });
    expect(db.rpcCalls[0].signal).toBe(controller.signal);
    await finishMock({ client_run_id: 'run-0001', container_id: C1, local_date: '2026-12-21', answers: [] }, { signal: controller.signal }).catch(() => undefined);
    expect(db.rpcCalls[1]).toMatchObject({ name: 'container_mock_finish', signal: controller.signal });
  });
});

describe('writes under RLS', () => {
  it('a container’s title (trimmed) and date go straight to its row', async () => {
    db.table = () => ({ data: [{ id: C1 }], error: null, status: 200 });
    await updateContainer(C1, { title: '  Зимняя сессия ', exam_date: '2027-01-12' });
    const [entry] = db.tableCalls;
    expect(entry.table).toBe('containers');
    expect(op(entry, 'update')).toEqual([{ title: 'Зимняя сессия', exam_date: '2027-01-12' }]);
    expect(op(entry, 'eq')).toEqual(['id', C1]);
    await updateContainer(C1, {});
    expect(db.tableCalls).toHaveLength(1);
  });

  it('a write that touched no row: not the author’s (42501) when the row is readable, else gone (P0002)', async () => {
    db.table = (entry) => ({ data: op(entry, 'update') ? [] : [{ id: C1 }], error: null, status: 200 });
    expect((await caught(updateContainer(C1, { title: 'x' }))).code).toBe('42501');
    db.table = () => ({ data: [], error: null, status: 200 });
    expect((await caught(updateContainer(C1, { title: 'x' }))).code).toBe('P0002');
    expect((await caught(deleteItem('item-1'))).code).toBe('P0002');
  });

  it('deleting an exam with members is refused with MC009', async () => {
    db.table = () => ({ data: null, error: { code: 'MC009', message: 'the container has members' }, status: 400 });
    const error = await caught(deleteContainer(C1));
    expect(error.message).toBe('Сначала уберите участников — потом экзамен можно удалить.');
    expect(op(db.tableCalls[0], 'delete')).toEqual([]);
  });

  it('a subject’s new date goes to its oral exam too; clearing it leaves the oral date', async () => {
    db.table = (entry) => ({ data: entry.table === 'container_subjects' ? [{ id: S1, exam_id: ORAL }] : [{ id: ORAL }], error: null, status: 200 });
    await updateSubject(S1, { exam_date: '2027-01-20', title: ' Билеты ' });
    expect(db.tableCalls.map((entry) => entry.table)).toEqual(['container_subjects', 'exams']);
    expect(op(db.tableCalls[0], 'update')).toEqual([{ title: 'Билеты', exam_date: '2027-01-20' }]);
    expect(op(db.tableCalls[1], 'update')).toEqual([{ exam_date: '2027-01-20' }]);
    expect(op(db.tableCalls[1], 'eq')).toEqual(['id', ORAL]);
    db.tableCalls = [];
    await updateSubject(S1, { exam_date: null });
    expect(db.tableCalls.map((entry) => entry.table)).toEqual(['container_subjects']);
  });

  it('minutes and days are an upsert of the user’s own container_plans row', async () => {
    db.table = () => ({ data: [{ container_id: C1 }], error: null, status: 200 });
    await saveSettings(C1, { minutes_per_day: 45, study_weekdays: 127 });
    const [entry] = db.tableCalls;
    expect(entry.table).toBe('container_plans');
    const [values, options] = op(entry, 'upsert') as [Record<string, unknown>, Record<string, unknown>];
    expect(values).toMatchObject({ container_id: C1, minutes_per_day: 45, study_weekdays: 127 });
    expect(values).not.toHaveProperty('user_id');
    expect(options).toEqual({ onConflict: 'user_id,container_id' });
  });

  it('creates a container with its subjects in one RPC', async () => {
    db.rpc = () => ({ data: { container_id: C1, subjects: [{ id: S1, position: 1, title: 'Основы программирования' }] }, error: null, status: 200 });
    const created = await createContainer('Зимняя сессия', '2027-01-12', [{ title: 'Основы программирования', exam_id: ORAL }]);
    expect(db.rpcCalls[0]).toMatchObject({ name: 'container_create', args: { p_title: 'Зимняя сессия', p_exam_date: '2027-01-12', p_subjects: [{ title: 'Основы программирования', exam_id: ORAL }] } });
    expect(created.subjects).toHaveLength(1);
  });

  it('removing everyone sends a null user', async () => {
    db.rpc = () => ({ data: { removed: 7 }, error: null, status: 200 });
    expect(await removeMember(C1, null)).toBe(7);
    expect(db.rpcCalls[0].args).toEqual({ p_container_id: C1, p_user_id: null, p_restore: false });
  });
});

describe('the group link', () => {
  it('cleans a pasted code; a code that cannot be one is not_found without a request', async () => {
    expect(normalizeCode(' ABCD-EFGH jkmn ')).toBe('abcdefghjkmn');
    db.rpc = () => ({ data: { status: 'active', title: 'Зимняя сессия', subjects: [] }, error: null, status: 200 });
    expect((await previewLink('ABCD-EFGH-JKMN')).status).toBe('active');
    expect(db.rpcCalls[0]).toMatchObject({ name: 'container_link_preview', args: { p_code: 'abcdefghjkmn' } });
    expect(await previewLink('nope')).toEqual({ status: 'not_found' });
    expect(db.rpcCalls).toHaveLength(1);
    expect((await caught(joinByCode('ilou'))).code).toBe('MC001');
    expect(db.rpcCalls).toHaveLength(1);
  });
});

describe('backend calls', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('parse-bank: a multipart form with the file and the options, the same /api path as every backend call', async () => {
    fetchMock.mockResolvedValue(json(parseBankJson));
    const file = new File(['1. Вопрос\nа) да\nб) нет'], 'Сессия.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const controller = new AbortController();
    const result = await parseBank({ file, keyMode: 'none', keyText: '1 – б', format: 'test', signal: controller.signal });
    expect(result.subjects).toHaveLength(parseBankJson.subjects.length);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/exams/parse-bank');
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(controller.signal);
    // Never urlencoded: a FormData body, and no Content-Type of our own (the browser adds the multipart boundary).
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toBeUndefined();
    const form = init.body as FormData;
    expect((form.get('file') as File).name).toBe('Сессия.docx');
    expect(form.get('text')).toBeNull();
    expect(form.get('key_mode')).toBe('none');
    expect(form.get('key_text')).toBe('1 – б');
    expect(form.get('format')).toBe('test');
  });

  it('parse-bank: a key kept in another file goes as key_file, the chosen section as key_section (owner, 2026-10-14)', async () => {
    fetchMock.mockResolvedValue(json(parseBankJson));
    const file = new File(['x'], 'Вариант 4.docx');
    const keyFile = new File(['1 – А'], 'Ключ 4 5 6.docx');
    await parseBank({ file, keyFile, keySection: 0 });
    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect((form.get('key_file') as File).name).toBe('Ключ 4 5 6.docx');
    expect(form.get('key_section')).toBe('0');
    fetchMock.mockResolvedValue(json(parseBankJson));
    await parseBank({ file, keyFile, keySection: null });
    const second = (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as FormData;
    expect(second.get('key_file')).not.toBeNull();
    expect(second.get('key_section')).toBeNull();
  });

  it('parse-bank: pasted text without options sends only the text', async () => {
    fetchMock.mockResolvedValue(json(parseBankJson));
    await parseBank({ text: '1. Вопрос' });
    const form = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect([...form.keys()]).toEqual(['text']);
    expect(form.get('text')).toBe('1. Вопрос');
  });

  it('parse-bank: an error {detail, code} comes back as the server said it', async () => {
    const detail = 'В файле не нашлось вопросов: проверьте, что это банк тестовых вопросов.';
    fetchMock.mockResolvedValue(json({ detail, code: 'no_items' }, 422));
    const error = await caught(parseBank({ text: 'просто текст' }));
    expect(error).toMatchObject({ code: 'no_items', message: detail, status: 422 });
    const long = `${'Слишком длинное объяснение. '.repeat(12)}`;
    fetchMock.mockResolvedValue(json({ detail: long, code: 'too_much_text' }, 413));
    expect(await caught(parseBank({ text: 'x' }))).toMatchObject({ code: 'too_much_text', message: long.trim(), status: 413 });
  });

  it('parse-bank: no network, a signed-out session and a server failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(isOffline(await caught(parseBank({ text: 'x' })))).toBe(true);
    fetchMock.mockResolvedValue(json({ detail: 'Требуется войти в аккаунт', code: 'auth' }, 401));
    expect((await caught(parseBank({ text: 'x' }))).code).toBe('28000');
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    const failure = await caught(parseBank({ text: 'x' }));
    expect(failure).toMatchObject({ code: 'unknown', status: 502 });
    expect(failure.message).toMatch(/[А-Яа-я]/);
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    expect((await caught(parseBank({ text: 'x', signal: controller.signal }))).code).toBe('aborted');
  });

  it('oral-sync: POST /api/containers/{id}/oral-sync without a body', async () => {
    fetchMock.mockResolvedValue(json(oralSyncJson));
    const result = await oralSync(C1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/containers/${C1}/oral-sync`);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(result.oral[0]).toMatchObject({ status: 'copied' });
  });

  it('oral-sync: its errors {detail, code} (package C, live)', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'Вы не участник этого экзамена.', code: 'not_found' }, 404));
    expect(await caught(oralSync(C1))).toMatchObject({ code: 'not_found', status: 404, message: 'Вы не участник этого экзамена.' });
    fetchMock.mockResolvedValue(json({ detail: 'Нет доступа.', code: 'forbidden' }, 403));
    expect((await caught(oralSync(C1))).code).toBe('forbidden');
    fetchMock.mockResolvedValue(json({ detail: 'Войдите снова.', code: 'session' }, 401));
    expect((await caught(oralSync(C1))).code).toBe('28000');
    // The rate limiter (6 calls a minute) answers without a detail of ours: the app's own words.
    fetchMock.mockResolvedValue(json({ error: 'Rate limit exceeded: 6 per 1 minute' }, 429));
    const limited = await caught(oralSync(C1));
    expect(limited).toMatchObject({ code: 'http_429', status: 429 });
    expect(limited.message).toMatch(/[А-Яа-я]/);
  });

  it('oral-sync: the backend’s 503 «unavailable» is a server failure, never «no container functions»', async () => {
    for (const code of ['unavailable', 'read_failed']) {
      fetchMock.mockResolvedValue(json({ detail: 'Не удалось прочитать данные. Попробуйте позже.', code }, 503));
      const error = await caught(oralSync(C1));
      expect(error).toMatchObject({ code: 'unknown', status: 503 });
      expect(isContainersUnavailable(error)).toBe(false);
      expect(error.detail).toBe(code === 'unavailable' ? 'server_unavailable' : 'read_failed');
    }
    fetchMock.mockResolvedValue(json({ detail: 'Что-то пошло не так.', code: 'unavailable' }, 409));
    const taken = await caught(oralSync(C1));
    expect(taken.code).toBe('server_unavailable');
    expect(isContainersUnavailable(taken)).toBe(false);
  });
});

describe('words (spec §3, §16 decisions 45 and 55)', () => {
  it('no error text says what the product never says', () => {
    const banned = /контейнер|тест|повторени|на проверку|спорн|пробн|засчитан|сгорел|готов на|выучен|сдашь|отстаёте|преподавател|колледж|аккредитац|копи/i;
    for (const text of [...Object.values(CONTAINER_ERROR_TEXT), LINKS_LIMIT_TEXT, NOTHING_TO_SHARE_TEXT]) {
      expect(text, text).not.toMatch(banned);
    }
  });
});
