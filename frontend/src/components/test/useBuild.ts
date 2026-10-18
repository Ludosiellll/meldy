import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { reorderItems } from '../../api/containers';
import { useContainerData, type ContainerData, type Loadable } from '../../lib/containers/hooks';
import type { ContainerSummary, SummarySubject, TestItem, Uuid } from '../../types/container';
import { defaultSubject, isKeyed, orderItems, takesItems } from './buildModel';

/**
 * The builder's state in one place (spec 2026-10-18 §47.2): the exam as read, the subject being built (?s=<id>, else
 * the first with questions, else the first) and its questions in the author's order, with this visit's changes laid
 * over the read until the next read brings them. Tools of the page change questions through the API and then tell this
 * hook what changed (addLocal, patchLocal, dropLocal); the order goes through `reorder`, which moves the cards at once
 * and puts them back when the server refuses.
 */

export interface ReorderResult {
  ok: boolean;
  error?: unknown;
}

export interface Build {
  data: Loadable<ContainerData>;
  summary: ContainerSummary | null;
  owner: boolean;
  /** The exam has members: a change of a key restarts the question for them too. */
  group: boolean;
  /** The subjects that take test questions (an oral-only subject has its own editor). */
  subjects: SummarySubject[];
  subject: SummarySubject | null;
  subjectId: Uuid;
  chooseSubject: (id: string) => void;
  /** Keeps the current subject while the author works in it (the first with questions may change under them). */
  pin: () => void;
  /** Every question of the exam, with this visit's changes. */
  items: TestItem[];
  /** The current subject's questions, in order. */
  list: TestItem[];
  /** Questions of the whole exam that have a key. */
  keyed: number;
  reload: () => void;
  addLocal: (items: TestItem[]) => void;
  patchLocal: (id: string, patch: Partial<TestItem>) => void;
  dropLocal: (id: string) => void;
  /** The current subject's questions in this order (every id), shown at once; put back when the server refuses. */
  reorder: (ids: string[]) => Promise<ReorderResult>;
}

/** The order before a change: the earlier one of this visit, or none (the server's positions). */
function restored(current: Record<string, string[]>, subjectId: string, previous: string[] | undefined): Record<string, string[]> {
  const next = { ...current };
  if (previous) next[subjectId] = previous;
  else delete next[subjectId];
  return next;
}

export function useBuild(containerId: Uuid): Build {
  const [search, setSearch] = useSearchParams();
  const data = useContainerData(containerId);
  const summary = data.data?.summary ?? null;

  const [patched, setPatched] = useState<Record<string, Partial<TestItem>>>({});
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set());
  const [extra, setExtra] = useState<TestItem[]>([]);
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const orderRef = useRef(order);
  orderRef.current = order;

  const items = useMemo(() => {
    const byId = new Map<string, TestItem>();
    data.data?.items.forEach((item) => byId.set(item.id, item));
    for (const item of extra) if (!byId.has(item.id)) byId.set(item.id, item);
    const out: TestItem[] = [];
    byId.forEach((item) => {
      if (!deleted.has(item.id)) out.push({ ...item, ...patched[item.id] });
    });
    return out;
  }, [data.data?.items, extra, patched, deleted]);

  const subjects = useMemo(() => (summary?.subjects ?? []).filter(takesItems), [summary]);
  const [chosen, setChosen] = useState(() => search.get('s') ?? '');
  const subject = subjects.find((entry) => entry.id === chosen) ?? defaultSubject(subjects, items);
  const subjectId = (subject?.id ?? '') as Uuid;
  const list = useMemo(() => orderItems(items.filter((item) => item.subject_id === subjectId), order[subjectId]), [items, subjectId, order]);

  const chooseSubject = useCallback(
    (id: string) => {
      setChosen(id);
      const next = new URLSearchParams(search);
      next.set('s', id);
      setSearch(next, { replace: true });
    },
    [search, setSearch],
  );
  const pin = useCallback(() => {
    if (subjectId) setChosen((current) => (current === subjectId ? current : subjectId));
  }, [subjectId]);

  const addLocal = useCallback((added: TestItem[]) => setExtra((current) => [...current, ...added]), []);
  const patchLocal = useCallback((id: string, patch: Partial<TestItem>) => setPatched((current) => ({ ...current, [id]: { ...current[id], ...patch } })), []);
  const dropLocal = useCallback((id: string) => setDeleted((current) => new Set(current).add(id)), []);

  const reorder = useCallback(
    async (ids: string[]): Promise<ReorderResult> => {
      const target = subjectId;
      const previous = orderRef.current[target];
      setOrder((current) => ({ ...current, [target]: ids }));
      try {
        await reorderItems(target, ids);
        return { ok: true };
      } catch (error) {
        setOrder((current) => restored(current, target, previous));
        return { ok: false, error };
      }
    },
    [subjectId],
  );

  return {
    data,
    summary,
    owner: summary?.role === 'owner',
    group: (summary?.owner?.members ?? 0) > 0,
    subjects,
    subject,
    subjectId,
    chooseSubject,
    pin,
    items,
    list,
    keyed: items.filter(isKeyed).length,
    reload: data.reload,
    addLocal,
    patchLocal,
    dropLocal,
    reorder,
  };
}
