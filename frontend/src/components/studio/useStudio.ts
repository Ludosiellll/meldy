import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { addItems, deleteItem, isGone, isOffline, updateItem } from '../../api/containers';
import { fetchTestDoc, isStale, refusedRule, saveTestDoc } from '../../api/testDocs';
import { applyFix as fixOf, type Fix } from '../../lib/studio/checker';
import {
  bindRefs,
  docProblems,
  duplicateBlock,
  emptyDoc,
  insertBlock,
  moveBlock,
  newBlock,
  newId,
  normalizeDoc,
  questionIds,
  removeBlock,
  replaceBlock,
  ruleMessage,
  sameValue,
  syncQuestions,
  withoutDangling,
} from '../../lib/studio/doc';
import { amend, canRedo, canUndo, record, redo, startHistory, undo, type DocHistory } from '../../lib/studio/history';
import { templateDoc, type TemplateId } from '../../lib/studio/templates';
import type { TextResult } from '../../lib/studio/textFormat';
import type { ItemInput, ItemPatch, TestItem, Uuid } from '../../types/container';
import { DOC_MAX_BLOCKS, type DocBlock, type DocBlockType, type TestDoc } from '../../types/testDoc';
import { errorText } from '../containers/copyImport';
import { copyInput, itemFromInput, numbered } from '../test/buildModel';
import type { Build } from '../test/useBuild';
import { STUDIO, type QuestionType } from './copyStudio';
import { draftInput } from './newQuestion';

/**
 * The studio's state in one place (plan docs/superpowers/plans/2026-10-18-studio.md, «Canvas UI», «Saving»):
 *
 * - The page: read with test_doc_get once the exam's questions are in (none yet → emptyDoc of the exam's name), made
 *   safe (normalizeDoc), the questions not on it appended (syncQuestions). Every change is a step of
 *   lib/studio/history (typing into one field is one step while the keys keep coming).
 * - Saving: 800 ms after the last change, the page without dangling question blocks (withoutDangling), only when
 *   docProblems has nothing against it (else the rule's words stand by the block and nothing is sent), over the
 *   revision it was read at. MC020 stops saving: «Тест изменён в другой вкладке» and «Обновить» (never overwritten
 *   silently). No network → «Не сохранено — нет связи» with «Повторить» (and again when the network is back).
 * - The questions themselves stay rows of test_items, and the page says which rows the test has: a question block taken
 *   off the page (deleted, or a step undone or redone) deletes its row — its content kept here — and a block that comes
 *   back (Ctrl+Z) brings its row back as a new one; a row the page has not seen yet (added in «Список», or in another
 *   tab) is appended at the end. A row deleted elsewhere leaves its block «gone» (the checker offers to remove it).
 */

export const SAVE_DELAY = 800;

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saved' }
  | { kind: 'saving' }
  | { kind: 'offline' }
  | { kind: 'failed'; message: string }
  | { kind: 'invalid'; problems: DocProblem[] }
  | { kind: 'stale' };

export interface DocProblem {
  rule: string;
  /** The block the rule is about (`block:<n>:…` of the document sent), when it names one. */
  blockId: string | null;
  message: string;
}

type Act =
  | { type: 'load'; doc: TestDoc }
  | { type: 'record'; change: (doc: TestDoc) => TestDoc; key: string | null; at: number }
  | { type: 'amend'; change: (doc: TestDoc) => TestDoc }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'remap'; map: Array<{ ref: string; id: string }> };

function reduce(state: DocHistory | null, act: Act): DocHistory | null {
  if (act.type === 'load') return startHistory(act.doc, Date.now());
  if (!state) return state;
  switch (act.type) {
    case 'record':
      return record(state, act.change(state.present), act.at, act.key);
    case 'amend':
      return amend(state, act.change(state.present));
    case 'undo':
      return undo(state);
    case 'redo':
      return redo(state);
    case 'remap': {
      const bind = (doc: TestDoc) => bindRefs(doc, act.map);
      return { ...state, past: state.past.map(bind), present: bind(state.present), future: state.future.map(bind) };
    }
  }
}

/** A rule's block: `block:<n>:…` names the n-th block of the document that was checked. */
function blockOfRule(rule: string, doc: TestDoc): string | null {
  const match = /^block:(\d+):/.exec(rule);
  return match ? doc.blocks[Number(match[1])]?.id ?? null : null;
}

/** The exam's questions in their order: by subject, then by position. */
function ordered(items: readonly TestItem[], subjectOrder: readonly string[]): TestItem[] {
  const rank = new Map(subjectOrder.map((id, at) => [id, at]));
  return [...items].sort((a, b) => (rank.get(a.subject_id) ?? 99) - (rank.get(b.subject_id) ?? 99) || a.position - b.position);
}

/** The local copy of a row after container_item_update (as the constructor keeps it). */
export function patchedRow(patch: ItemPatch, rev: number): Partial<TestItem> {
  const local: Partial<TestItem> = { rev };
  if (patch.stem !== undefined) local.stem = patch.stem;
  if (patch.options !== undefined) local.options = patch.options;
  if (patch.correct !== undefined) local.correct = patch.correct;
  if (patch.answers !== undefined) local.answers = patch.answers;
  if (patch.kind !== undefined) local.kind = patch.kind;
  if (patch.code !== undefined) local.code = patch.code;
  if (patch.keep_order !== undefined) local.keep_order = patch.keep_order;
  if (patch.images !== undefined) local.images = patch.images;
  if (patch.explanation !== undefined) local.explanation = patch.explanation;
  if (patch.correct !== undefined || patch.answers !== undefined) local.key_source = 'manual';
  return local;
}

export interface Studio {
  phase: 'loading' | 'ready' | 'error' | 'gone';
  loadError: string | null;
  retryLoad: () => void;
  doc: TestDoc;
  rows: ReadonlyMap<string, TestItem>;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** A change of the page; `key` joins typing into one step (history typingKey). */
  change: (change: (doc: TestDoc) => TestDoc, key?: string | null) => void;
  save: SaveState;
  /** Save now (the retry of «Не сохранено»). */
  retrySave: () => void;
  /** Saves at once; true when the page on the server is the page here. */
  flush: () => Promise<boolean>;
  /** After MC020: the page as the other tab saved it. */
  reloadDoc: () => void;
  /** The exam's questions that do not fit on the page (DOC_MAX_BLOCKS). */
  overflow: number;
  /** The problems of the last check before saving, by block. */
  problems: ReadonlyMap<string, string>;
  /** A line read out and shown for a moment: «Блок удалён…». */
  notice: string;
  say: (text: string) => void;
  busy: string | null;

  insert: (type: Exclude<DocBlockType, 'question'>, index: number) => DocBlock | null;
  addQuestion: (type: QuestionType, index: number) => Promise<DocBlock | null>;
  /** New rows (the list's editor, a copy of a row off the page) and their blocks at `index` (the end by default). */
  addInputs: (inputs: ItemInput[], index?: number) => Promise<DocBlock[]>;
  duplicate: (blockId: string) => Promise<DocBlock | null>;
  /** Takes a block off the page; `touch`: the words read out leave out Ctrl+Z (the screen shows «Вернуть»). */
  remove: (blockId: string, touch?: boolean) => void;
  move: (blockId: string, index: number) => void;
  replace: (block: DocBlock, key?: string | null) => void;
  /** container_item_update for a row, kept here when it is saved. */
  patchRow: (itemId: string, patch: ItemPatch) => Promise<{ rev_changed: boolean }>;
  applyTemplate: (id: TemplateId) => Promise<void>;
  applyText: (result: TextResult) => Promise<void>;
  applyFix: (fix: Fix) => Promise<void>;
}

/**
 * Picture blocks still waiting for their picture, video blocks still waiting for their link: not sent until it is there
 * (like a dangling question) — the rest of the page saves meanwhile.
 */
export function withoutUnfinished(doc: TestDoc): TestDoc {
  const blocks = doc.blocks.filter((block) => (block.type !== 'image' || block.path !== '') && (block.type !== 'video' || block.url !== ''));
  return blocks.length === doc.blocks.length ? doc : { ...doc, blocks };
}

/** What a save sends: no dangling question blocks, no picture blocks without their picture, no video without its link. */
export function toSend(doc: TestDoc, itemIds: Iterable<string>): TestDoc {
  return withoutUnfinished(withoutDangling(doc, itemIds));
}

export function useStudio(containerId: Uuid, build: Build): Studio {
  const loaded = build.data.data;
  const summary = build.summary;
  const { addLocal, dropLocal, patchLocal, subjectId: buildSubject } = build;
  const rows = useMemo(() => new Map(build.items.map((item) => [item.id, item])), [build.items]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const subjectOrder = useMemo(() => (summary?.subjects ?? []).map((subject) => subject.id), [summary]);

  const [history, dispatch] = useReducer(reduce, null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const [phase, setPhase] = useState<Studio['phase']>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const rev = useRef(0);
  const lastSaved = useRef<unknown>(null);
  /** The page and the rows last found to be on the server as they are (a quick «nothing changed since» by identity). */
  const clean = useRef<{ doc: TestDoc | null; rows: ReadonlyMap<string, TestItem> | null }>({ doc: null, rows: null });
  const inFlight = useRef(false);
  const again = useRef(false);
  const paused = useRef(false);
  /** Rows that have been on the page in this visit: taken off it, they are deleted. */
  const seen = useRef(new Set<string>());
  /** The content of rows this page deleted (a block that comes back brings the row back). */
  const snapshots = useRef(new Map<string, TestItem>());
  /** Rows with a request on its way (not touched again until it answers). */
  const pending = useRef(new Set<string>());
  /** Rows whose deletion failed: left alone until the page changes again. */
  const blocked = useRef(new Set<string>());
  const loadKey = useRef<string | null>(null);
  const [loadRound, setLoadRound] = useState(0);

  const say = useCallback((text: string) => {
    setNotice('');
    window.setTimeout(() => setNotice(text), 0);
  }, []);

  // ───────────────────────────── reading the page ─────────────────────────────

  const load = useCallback(async () => {
    if (!loaded || !summary || summary.role !== 'owner') return;
    setPhase((current) => (current === 'ready' ? current : 'loading'));
    try {
      const stored = await fetchTestDoc(containerId);
      const items = ordered([...rowsRef.current.values()], subjectOrder);
      const ids = items.map((item) => item.id);
      const base = stored ? normalizeDoc(stored.doc, ids).doc : emptyDoc(summary.title);
      const doc = syncQuestions(base, items);
      rev.current = stored?.rev ?? 0;
      lastSaved.current = stored ? stored.doc : base;
      paused.current = false;
      seen.current = new Set(questionIds(doc).filter((id) => rowsRef.current.has(id)));
      blocked.current.clear();
      dispatch({ type: 'load', doc });
      setSave({ kind: stored ? 'saved' : 'idle' });
      setPhase('ready');
      setLoadError(null);
    } catch (error) {
      if (isGone(error)) setPhase('gone');
      else {
        setLoadError(errorText(error));
        setPhase((current) => (current === 'ready' ? current : 'error'));
      }
    }
  }, [loaded, summary, containerId, subjectOrder]);

  useEffect(() => {
    const key = `${containerId}:${loadRound}`;
    if (!loaded || !summary || summary.role !== 'owner' || loadKey.current === key) return;
    loadKey.current = key;
    void load();
  }, [loaded, summary, containerId, loadRound, load]);

  const retryLoad = useCallback(() => setLoadRound((n) => n + 1), []);
  const reloadDoc = useCallback(() => {
    setSave({ kind: 'saving' });
    setLoadRound((n) => n + 1);
  }, []);

  // ───────────────────────────── the rows follow the page ─────────────────────────────

  const present = history?.present ?? null;
  const [overflow, setOverflowState] = useState(0);
  // Set only when it changes: the same number set after every key cost a commit of its own (the render budget's test).
  const overflowRef = useRef(0);
  const setOverflow = useCallback((count: number) => {
    if (overflowRef.current === count) return;
    overflowRef.current = count;
    setOverflowState(count);
  }, []);

  useEffect(() => {
    if (phase !== 'ready' || !present) return;
    const onPage = new Set(questionIds(present));
    for (const id of onPage) if (rows.has(id)) seen.current.add(id);

    // A block came back (undo / redo) whose row this page deleted: the row comes back as a new one.
    for (const block of present.blocks) {
      if (block.type !== 'question' || rows.has(block.item_id) || pending.current.has(block.item_id)) continue;
      const kept = snapshots.current.get(block.item_id);
      if (!kept) continue;
      const old = block.item_id;
      pending.current.add(old);
      const input = copyInput(kept, kept.file_no, `undo:${newId()}`);
      addItems(kept.subject_id, [input])
        .then((batches) => {
          const row = batches.flatMap((batch) => batch.items).find((entry) => entry.ref === input.ref);
          if (!row) throw new Error('');
          const item = itemFromInput(input, row.id, row.position, kept.subject_id, containerId);
          snapshots.current.delete(old);
          seen.current.add(row.id);
          addLocal([item]);
          dispatch({ type: 'remap', map: [{ ref: old, id: row.id }] });
        })
        .catch(() => say(STUDIO.rowFailed))
        .finally(() => pending.current.delete(old));
    }

    // A row that was on the page and is not any more: deleted (its content kept for Ctrl+Z).
    for (const [id, row] of rows) {
      if (onPage.has(id) || !seen.current.has(id) || pending.current.has(id) || blocked.current.has(id)) continue;
      pending.current.add(id);
      snapshots.current.set(id, row);
      deleteItem(id)
        .then(() => dropLocal(id))
        .catch((error) => {
          if (isGone(error)) dropLocal(id);
          else {
            blocked.current.add(id);
            say(STUDIO.rowFailed);
          }
        })
        .finally(() => pending.current.delete(id));
    }

    // Rows the page has not seen: appended at the end (while there is room).
    const fresh = ordered(
      [...rows.values()].filter((row) => !onPage.has(row.id) && !seen.current.has(row.id) && !pending.current.has(row.id)),
      subjectOrder,
    );
    if (fresh.length > 0) {
      const next = syncQuestions(present, fresh);
      const added = next.blocks.length - present.blocks.length;
      setOverflow(fresh.length - added);
      if (added > 0) dispatch({ type: 'amend', change: () => next });
    } else setOverflow(0);
  }, [phase, present, rows, subjectOrder, containerId, addLocal, dropLocal, say, setOverflow]);

  // Any change of the page lets a failed deletion try again.
  useEffect(() => {
    blocked.current.clear();
  }, [present]);

  // ───────────────────────────── saving ─────────────────────────────

  const saveNow = useCallback(async (): Promise<boolean> => {
    const current = historyRef.current;
    if (!current || paused.current) return false;
    if (inFlight.current) {
      again.current = true;
      return false;
    }
    const sentRows = rowsRef.current;
    const ids = [...sentRows.keys()];
    const out = toSend(current.present, ids);
    if (sameValue(out, lastSaved.current)) {
      clean.current = { doc: current.present, rows: sentRows };
      setSave(rev.current > 0 ? { kind: 'saved' } : { kind: 'idle' });
      return true;
    }
    const problems = docProblems(out, ids, containerId);
    if (problems.length > 0) {
      setSave({ kind: 'invalid', problems: problems.map((rule) => ({ rule, blockId: blockOfRule(rule, out), message: ruleMessage(rule, out) })) });
      return false;
    }
    inFlight.current = true;
    setSave({ kind: 'saving' });
    let ok = false;
    try {
      const saved = await saveTestDoc(containerId, out, rev.current);
      rev.current = saved.rev;
      lastSaved.current = out;
      clean.current = { doc: current.present, rows: sentRows };
      ok = true;
      setSave({ kind: 'saved' });
    } catch (error) {
      if (isStale(error)) {
        paused.current = true;
        setSave({ kind: 'stale' });
      } else if (isOffline(error)) setSave({ kind: 'offline' });
      else {
        const rule = refusedRule(error);
        if (rule) setSave({ kind: 'invalid', problems: [{ rule, blockId: blockOfRule(rule, out), message: ruleMessage(rule, out) }] });
        else setSave({ kind: 'failed', message: errorText(error) });
      }
    } finally {
      inFlight.current = false;
    }
    if (again.current && !paused.current) {
      again.current = false;
      const changed = !sameValue(toSend(historyRef.current?.present ?? out, [...rowsRef.current.keys()]), lastSaved.current);
      if (changed) return saveNow();
    }
    return ok;
  }, [containerId]);

  useEffect(() => {
    if (phase !== 'ready' || !present || paused.current) return;
    const timer = window.setTimeout(() => void saveNow(), SAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [phase, present, rows, saveNow]);

  useEffect(() => {
    const online = () => {
      if (save.kind === 'offline' || save.kind === 'failed') void saveNow();
    };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [save.kind, saveNow]);

  // Closing the tab with changes not on the server asks first. Whether they are is worked out when the tab is closed,
  // not at every key (the smoothness audit of 20.10: the whole page was compared with the saved one at each letter).
  const watching = phase === 'ready' && present !== null && save.kind !== 'stale' && (present !== clean.current.doc || rows !== clean.current.rows);
  useEffect(() => {
    if (!watching) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      const current = historyRef.current?.present;
      if (!current || sameValue(toSend(current, [...rowsRef.current.keys()]), lastSaved.current)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [watching]);

  const flush = useCallback(async () => {
    const ok = await saveNow();
    if (ok) return true;
    // A save on its way: wait for it, then look again.
    for (let round = 0; round < 50 && inFlight.current; round += 1) await new Promise((resolve) => window.setTimeout(resolve, 100));
    return saveNow();
  }, [saveNow]);

  // ───────────────────────────── edits ─────────────────────────────

  const change = useCallback((fn: (doc: TestDoc) => TestDoc, key: string | null = null) => {
    dispatch({ type: 'record', change: fn, key, at: Date.now() });
  }, []);

  const full = () => (historyRef.current?.present.blocks.length ?? 0) >= DOC_MAX_BLOCKS;

  const insert = useCallback(
    (type: Exclude<DocBlockType, 'question'>, index: number) => {
      if (full()) {
        say(STUDIO.full);
        return null;
      }
      const block = newBlock(type);
      change((doc) => insertBlock(doc, block, index));
      say(STUDIO.added(STUDIO.types[type]));
      return block;
    },
    [change, say],
  );

  /** New rows added to the exam (container_items_add), kept here; the page is changed by the caller in the same turn. */
  const addRows = useCallback(
    async (inputs: ItemInput[], subjectId: string): Promise<Map<string, TestItem>> => {
      const ready = numbered(inputs, [...rowsRef.current.values()], subjectId);
      const batches = await addItems(subjectId, ready);
      const made = new Map<string, TestItem>();
      const byRef = new Map(batches.flatMap((batch) => batch.items).map((row) => [row.ref, row]));
      for (const input of ready) {
        const row = byRef.get(input.ref);
        if (row) made.set(input.ref, itemFromInput(input, row.id, row.position, subjectId as Uuid, containerId));
      }
      if (made.size === 0) throw new Error('');
      for (const item of made.values()) {
        pending.current.add(item.id);
        seen.current.add(item.id);
      }
      addLocal([...made.values()]);
      window.setTimeout(() => {
        for (const item of made.values()) pending.current.delete(item.id);
      }, 0);
      return made;
    },
    [addLocal, containerId],
  );

  const addQuestion = useCallback(
    async (type: QuestionType, index: number) => {
      if (full()) {
        say(STUDIO.full);
        return null;
      }
      const subjectId = buildSubject;
      if (!subjectId) return null;
      setBusy('question');
      try {
        const input = draftInput(type, `studio:${newId()}`);
        const made = await addRows([input], subjectId);
        const item = made.get(input.ref);
        if (!item) return null;
        const block = newBlock('question', item.id);
        change((doc) => insertBlock(doc, block, index));
        say(STUDIO.added(STUDIO.qtypes[type]));
        return block;
      } catch (error) {
        say(errorText(error));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [addRows, buildSubject, change, say],
  );

  const addInputs = useCallback(
    async (inputs: ItemInput[], index?: number) => {
      const subjectId = buildSubject;
      if (!subjectId) return [];
      const room = DOC_MAX_BLOCKS - (historyRef.current?.present.blocks.length ?? 0);
      const made = await addRows(inputs, subjectId);
      const blocks = [...made.values()].slice(0, Math.max(0, room)).map((item) => newBlock('question', item.id));
      change((doc) => {
        let next = doc;
        const at = index ?? doc.blocks.length;
        blocks.forEach((block, offset) => {
          next = insertBlock(next, block, at + offset);
        });
        return next;
      });
      return blocks;
    },
    [addRows, buildSubject, change],
  );

  const duplicate = useCallback(
    async (blockId: string) => {
      const doc = historyRef.current?.present;
      const block = doc?.blocks.find((entry) => entry.id === blockId);
      if (!doc || !block) return null;
      if (full()) {
        say(STUDIO.full);
        return null;
      }
      if (block.type !== 'question') {
        const next = duplicateBlock(doc, blockId);
        const at = next.blocks.findIndex((entry) => entry.id === blockId);
        change(() => next);
        say(STUDIO.copied);
        return next.blocks[at + 1] ?? null;
      }
      const item = rowsRef.current.get(block.item_id);
      if (!item) return null;
      setBusy(blockId);
      try {
        const input = copyInput(item, '', `copy:${newId()}`);
        const made = await addRows([input], item.subject_id);
        const row = made.get(input.ref);
        if (!row) return null;
        const copy: DocBlock = { ...newBlock('question', row.id), points: block.points, required: block.required };
        change((current) => {
          const at = current.blocks.findIndex((entry) => entry.id === blockId);
          return insertBlock(current, copy, at < 0 ? current.blocks.length : at + 1);
        });
        say(STUDIO.copied);
        return copy;
      } catch (error) {
        say(errorText(error));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [addRows, change, say],
  );

  const remove = useCallback(
    (blockId: string, touch = false) => {
      const block = historyRef.current?.present.blocks.find((entry) => entry.id === blockId);
      if (!block) return;
      change((doc) => removeBlock(doc, blockId));
      say(STUDIO.removed(STUDIO.types[block.type], touch));
    },
    [change, say],
  );

  const move = useCallback(
    (blockId: string, index: number) => {
      const doc = historyRef.current?.present;
      if (!doc) return;
      const next = moveBlock(doc, blockId, index);
      if (next === doc) return;
      change(() => next);
      say(STUDIO.moved(next.blocks.findIndex((entry) => entry.id === blockId) + 1, next.blocks.length));
    },
    [change, say],
  );

  const replace = useCallback((block: DocBlock, key: string | null = null) => change((doc) => replaceBlock(doc, block), key), [change]);

  const patchRow = useCallback(
    async (itemId: string, patch: ItemPatch) => {
      const result = await updateItem(itemId, patch);
      patchLocal(itemId, patchedRow(patch, result.rev));
      return { rev_changed: result.rev_changed };
    },
    [patchLocal],
  );

  const applyTemplate = useCallback(
    async (id: TemplateId) => {
      const subjectId = buildSubject;
      if (!subjectId || !summary) return;
      setBusy('template');
      try {
        const { doc, adds } = templateDoc(id, { title: summary.title, items: [...rowsRef.current.values()] });
        const made = await addRows(adds, subjectId);
        const bound = bindRefs(doc, [...made].map(([ref, item]) => ({ ref, id: item.id })));
        change(() => bound);
      } catch (error) {
        say(errorText(error));
      } finally {
        setBusy(null);
      }
    },
    [addRows, buildSubject, change, say, summary],
  );

  const applyText = useCallback(
    async (result: TextResult) => {
      const subjectId = buildSubject;
      setBusy('text');
      try {
        let doc = result.doc;
        if (result.adds.length > 0 && subjectId) {
          const made = await addRows(result.adds, subjectId);
          doc = bindRefs(doc, [...made].map(([ref, item]) => ({ ref, id: item.id })));
        }
        for (const update of result.updates) await patchRow(update.id, update.patch);
        // The rows the text left out leave the page with their blocks: the page deletes them.
        change(() => doc);
      } finally {
        setBusy(null);
      }
    },
    [addRows, buildSubject, change, patchRow],
  );

  const applyFix = useCallback(
    async (fix: Fix) => {
      const doc = historyRef.current?.present;
      if (!doc) return;
      const result = fixOf(fix, doc, [...rowsRef.current.values()]);
      for (const update of result.updates) await patchRow(update.id, update.patch);
      if (result.doc !== doc) change(() => result.doc);
    },
    [change, patchRow],
  );

  const problems = useMemo(() => {
    const out = new Map<string, string>();
    if (save.kind === 'invalid') for (const problem of save.problems) if (problem.blockId && !out.has(problem.blockId)) out.set(problem.blockId, problem.message);
    return out;
  }, [save]);

  const fallback = useMemo(() => emptyDoc(summary?.title ?? ''), [summary?.title]);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const retrySave = useCallback(() => void saveNow(), [saveNow]);
  const doc = present ?? fallback;
  const undoable = history ? canUndo(history) : false;
  const redoable = history ? canRedo(history) : false;

  // One object while nothing in it changed: what is given it (memo children, effects) is not told of a change for nothing.
  return useMemo(
    () => ({
      phase,
      loadError,
      retryLoad,
      doc,
      rows,
      canUndo: undoable,
      canRedo: redoable,
      undo,
      redo,
      change,
      save,
      retrySave,
      flush,
      reloadDoc,
      overflow,
      problems,
      notice,
      say,
      busy,
      insert,
      addQuestion,
      addInputs,
      duplicate,
      remove,
      move,
      replace,
      patchRow,
      applyTemplate,
      applyText,
      applyFix,
    }),
    [
      phase,
      loadError,
      retryLoad,
      doc,
      rows,
      undoable,
      redoable,
      undo,
      redo,
      change,
      save,
      retrySave,
      flush,
      reloadDoc,
      overflow,
      problems,
      notice,
      say,
      busy,
      insert,
      addQuestion,
      addInputs,
      duplicate,
      remove,
      move,
      replace,
      patchRow,
      applyTemplate,
      applyText,
      applyFix,
    ],
  );
}
