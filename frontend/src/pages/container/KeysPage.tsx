import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { addItems, deleteItem, fetchDoubts, keepKey, updateItem } from '../../api/containers';
import { useContainerData } from '../../lib/containers/hooks';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useFrame } from '../../components/exams/useFrame';
import PaperSelect from '../../components/ui/PaperSelect';
import KeyQuestion, { QueueBar, type KeyAction, type TapMode } from '../../components/containers/keys/KeyQuestion';
import QuestionEditor from '../../components/containers/keys/QuestionEditor';
import { inputOf, nextFileNo, patchOf, searchItems, type Draft } from '../../components/containers/keys/editorModel';
import { useSavedLine } from '../../components/containers/keys/useSavedLine';
import { newId } from '../../components/containers/sessionStore';
import { storedPictures } from '../../components/containers/ItemPictures';
import { errorText, GONE, KEYS, lettersText, nb, QUEUE } from '../../components/containers/copyImport';
import { TO_EXAMS } from '../../components/containers/copy';
import type { DoubtRow, ItemPatch, SummarySubject, TestItem, Uuid } from '../../types/container';
import '../../components/exams/exams.css';
import './KeysPage.css';

/**
 * /exams/c/:id/keys — «Вопросы и ключи», the author's keys (spec decision 14, §16 #44; Concept 1 §3.11 with the design critique I8):
 * rows of one card — «Без ключа», «Сомневаются в ключе» (a solo author: «Отложены вами»), «Ключ поставили вы» — the
 * queue «Проверить N вопросов» in the bar, and «Найти вопрос по номеру из файла», which opens the question as the
 * number matches. ?s=<subjectId>&no=<file number> opens one question (the Telegram bot links here).
 *
 * A key is changed by a tap on another option: the database raises the question's rev, so its count starts again for
 * everyone (decision 15); «Ключ верный» keeps the file's key and returns the doubted question to everyone's sessions.
 *
 * The editor (spec 2026-10-16 part 1): «Изменить» opens the question's text, options, key and pictures in place of its
 * card (also in a queue); «Добавить вопрос» adds one to the chosen subject with the next number; the find field takes a
 * number from the file or words from the question.
 */

type ListKind = 'check' | 'nokey' | 'doubts' | 'manual';
const LISTS: readonly ListKind[] = ['check', 'nokey', 'doubts', 'manual'];

const isKeyed = (item: TestItem) => item.correct.length > 0 || item.answers.length > 0;

/** Words, not a number from the file: two letters in a row («3а» is a number). */
const isWords = (raw: string) => /\p{L}{2,}/u.test(raw);
const WORDS_PAGE = 30;

/** A subject of test questions (an oral one keeps its questions in its own editor). */
const takesItems = (subject: SummarySubject) => !(subject.oral && subject.oral.questions > 0 && subject.kinds.single + subject.kinds.multiple + subject.kinds.short === 0);

function cleanNumber(raw: string): string {
  return raw.replace(/^№\s*/, '').replace(/\s+/g, '').trim();
}

/** The proposal most doubters made, as letters: «В», «А и В». */
function topProposal(row: DoubtRow): string | null {
  const counts = new Map<string, { n: number; set: number[] }>();
  for (const set of row.proposed ?? []) {
    if (!Array.isArray(set) || set.length === 0) continue;
    const key = [...set].sort((a, b) => a - b).join(',');
    const entry = counts.get(key) ?? { n: 0, set: [...set].sort((a, b) => a - b) };
    entry.n += 1;
    counts.set(key, entry);
  }
  let best: { n: number; set: number[] } | null = null;
  counts.forEach((entry) => {
    if (!best || entry.n > best.n) best = entry;
  });
  return best ? lettersText((best as { set: number[] }).set) : null;
}

export default function KeysPage() {
  const params = useParams();
  const containerId = (params.id ?? '') as Uuid;
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const frame = useFrame<HTMLDivElement>();
  const data = useContainerData(containerId);
  const summary = data.data?.summary ?? null;
  useDocumentTitle(summary ? `${KEYS.docTitle} · ${summary.title}` : KEYS.docTitle);
  useEffect(() => {
    if (summary) rememberContainerTitle(summary.id, summary.title);
  }, [summary]);

  const owner = summary?.role === 'owner';
  const group = (summary?.owner?.members ?? 0) > 0;
  const savedLine = useSavedLine(data.data?.planInput, group);

  // ── items, with the author's changes of this visit laid over them ──
  const [patched, setPatched] = useState<Record<string, Partial<TestItem>>>({});
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set());
  const items = useMemo(() => {
    const out: TestItem[] = [];
    data.data?.items.forEach((item) => {
      if (deleted.has(item.id)) return;
      out.push({ ...item, ...patched[item.id] });
    });
    return out.sort((a, b) => (a.subject_id === b.subject_id ? a.position - b.position : 0));
  }, [data.data?.items, patched, deleted]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const [doubts, setDoubts] = useState<DoubtRow[]>([]);
  const [doubtsError, setDoubtsError] = useState(false);
  const loadDoubts = useCallback(() => {
    if (!containerId) return;
    fetchDoubts(containerId).then(
      (rows) => {
        setDoubts(rows.filter((row) => row.doubts > 0));
        setDoubtsError(false);
      },
      () => setDoubtsError(true),
    );
  }, [containerId]);
  useEffect(() => {
    if (owner) loadDoubts();
  }, [owner, loadDoubts]);
  const doubtOf = useMemo(() => new Map(doubts.map((row) => [row.item_id, row])), [doubts]);

  const subjects = summary?.subjects ?? [];
  const subjectTitle = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject.title])), [subjects]);
  const order = useMemo(() => new Map(subjects.map((subject, index) => [subject.id, index])), [subjects]);
  const sorted = useMemo(
    () => [...items].sort((a, b) => (order.get(a.subject_id) ?? 0) - (order.get(b.subject_id) ?? 0) || a.position - b.position),
    [items, order],
  );
  const noKey = sorted.filter((item) => !isKeyed(item));
  const doubted = sorted.filter((item) => doubtOf.has(item.id));
  const manual = sorted.filter((item) => item.key_source === 'manual' && isKeyed(item));
  const check = sorted.filter((item) => !isKeyed(item) || doubtOf.has(item.id));
  const lists: Record<ListKind, TestItem[]> = { check, nokey: noKey, doubts: doubted, manual };

  // ── the queue (#check, #nokey, #doubts, #manual): its list is kept as it opened ──
  const hash = location.hash.replace(/^#/, '') as ListKind;
  const listKind = LISTS.includes(hash) ? hash : null;
  const [queue, setQueue] = useState<{ kind: ListKind; ids: string[]; index: number } | null>(null);
  useEffect(() => {
    if (!listKind) {
      setQueue(null);
      return;
    }
    if (!data.data) return;
    setQueue((current) => (current && current.kind === listKind ? current : { kind: listKind, ids: lists[listKind].map((item) => item.id), index: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKind, Boolean(data.data), doubts.length]);
  const openList = (kind: ListKind) => {
    setQueue({ kind, ids: lists[kind].map((item) => item.id), index: 0 });
    navigate({ search: location.search, hash: kind }, { state: { keysView: true } });
  };
  const closeList = () => {
    setQueue(null);
    data.reload();
    if (owner) loadDoubts();
    if ((location.state as { keysView?: boolean } | null)?.keysView) navigate(-1);
    else navigate({ search: location.search, hash: '' }, { replace: true });
  };

  // ── find by number (also ?s=…&no=…) ──
  const findId = useId();
  const [subjectId, setSubjectId] = useState<string>(() => search.get('s') ?? '');
  const [number, setNumber] = useState(() => search.get('no') ?? '');
  useEffect(() => {
    if (!subjectId && subjects.length > 0) setSubjectId(subjects[0].id);
  }, [subjectId, subjects]);
  const chosenSubject = subjects.find((subject) => subject.id === subjectId) ?? null;
  const newNumber = useMemo(() => nextFileNo(items, subjectId), [items, subjectId]);
  const byWords = isWords(number);
  const wanted = byWords ? '' : cleanNumber(number);
  const matches = wanted ? sorted.filter((item) => item.subject_id === subjectId && cleanNumber(item.file_no) === wanted) : [];
  const [wordsShown, setWordsShown] = useState(WORDS_PAGE);
  useEffect(() => setWordsShown(WORDS_PAGE), [number, subjectId]);
  const wordHits = useMemo(
    () => (byWords ? searchItems(sorted.filter((item) => item.subject_id === subjectId), number) : []),
    [byWords, sorted, subjectId, number],
  );
  const found = matches[0] ?? null;
  const resultRef = useRef<HTMLDivElement>(null);
  const linked = Boolean(search.get('no'));
  useEffect(() => {
    if (linked && found) resultRef.current?.scrollIntoView?.({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, Boolean(found)]);

  // ── changing a key ──
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { text: string; error?: boolean }>>({});
  const [askDelete, setAskDelete] = useState<string | null>(null);
  /** The question open in the editor: its id, or 'new' for one being added to the chosen subject. */
  const [editing, setEditing] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const say = (itemId: string, text: string, error = false) => setNotes((current) => ({ ...current, [itemId]: { text, error } }));
  const run = async (item: TestItem, work: () => Promise<void>) => {
    setBusy(item.id);
    try {
      await work();
    } catch (error) {
      say(item.id, errorText(error), true);
    } finally {
      setBusy(null);
    }
  };
  const patchItem = (item: TestItem, patch: ItemPatch, local: Partial<TestItem>) =>
    run(item, async () => {
      const result = await updateItem(item.id, patch);
      setPatched((current) => ({ ...current, [item.id]: { ...current[item.id], ...local, rev: result.rev, key_source: 'manual' } }));
      if (result.doubts_resolved > 0) setDoubts((rows) => rows.filter((row) => row.item_id !== item.id));
      say(item.id, result.rev_changed ? KEYS.changed(group) : KEYS.savedKeep);
    });
  const keep = (item: TestItem) =>
    run(item, async () => {
      await keepKey(item.id);
      setDoubts((rows) => rows.filter((row) => row.item_id !== item.id));
      say(item.id, KEYS.kept);
    });
  const remove = (item: TestItem) =>
    run(item, async () => {
      await deleteItem(item.id);
      setDeleted((current) => new Set(current).add(item.id));
      setAskDelete(null);
      say(item.id, KEYS.removed);
    });

  const openEditor = (id: string) => {
    setEditError(null);
    setEditing(id);
  };
  /** The editor's draft saved: only what changed (editorModel.patchOf); the card then shows the question as saved. */
  const saveEdit = async (item: TestItem, draft: Draft) => {
    const patch = patchOf(item, draft);
    if (!patch) {
      setEditing(null);
      return;
    }
    setBusy(item.id);
    setEditError(null);
    try {
      const result = await updateItem(item.id, patch);
      const local: Partial<TestItem> = { rev: result.rev };
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
      setPatched((current) => ({ ...current, [item.id]: { ...current[item.id], ...local } }));
      if (result.doubts_resolved > 0) setDoubts((rows) => rows.filter((row) => row.item_id !== item.id));
      setEditing(null);
      say(item.id, savedLine(item.id, result.rev_changed));
    } catch (error) {
      setEditError(errorText(error));
    } finally {
      setBusy(null);
    }
  };
  const [adding, setAdding] = useState(false);
  /** A new question in the chosen subject, numbered after its last one; it then opens by that number. */
  const saveNew = async (draft: Draft, fileNo: string) => {
    if (!subjectId) return;
    setAdding(true);
    setEditError(null);
    try {
      const [added] = await addItems(subjectId as Uuid, [inputOf(draft, fileNo, `man:${newId()}`)]);
      const id = added?.items?.[0]?.id;
      setEditing(null);
      setNumber(fileNo);
      if (id) say(id, KEYS.added(fileNo));
      data.reload();
    } catch (error) {
      setEditError(errorText(error));
    } finally {
      setAdding(false);
    }
  };

  /** One question: its line, its options in the file's order with the key marked, and what the author can do. */
  const renderQuestion = (item: TestItem, extraActions: KeyAction[] = []) => {
    const doubt = doubtOf.get(item.id) ?? null;
    const subjectName = subjectTitle.get(item.subject_id) ?? '';
    const summarySubject = subjects.find((subject) => subject.id === item.subject_id);
    const topic = item.topic && summarySubject ? summarySubject.topic_titles[item.topic - 1] ?? null : null;
    if (owner && editing === item.id) {
      return (
        <QuestionEditor
          key={`edit-${item.id}`}
          containerId={containerId}
          item={item}
          context={QUEUE.context(subjectName, item.file_no, topic)}
          group={group}
          busy={busy === item.id}
          error={editError}
          onSave={(draft) => void saveEdit(item, draft)}
          onCancel={() => setEditing(null)}
        />
      );
    }
    const keyed = isKeyed(item);
    const multiple = item.kind === 'multiple';
    const tapMode: TapMode = item.kind === 'short' ? 'none' : multiple ? 'keys' : 'key';
    const reasonLines: string[] = [];
    if (doubt) {
      if (group) {
        reasonLines.push(KEYS.doubters(doubt.doubts));
        const proposal = topProposal(doubt);
        if (proposal) reasonLines.push(KEYS.proposed(proposal));
      } else reasonLines.push(KEYS.doubtOwn);
      if (doubt.top_wrong && doubt.top_wrong.length && (doubt.top_wrong_n ?? 0) * 2 > doubt.first_answers && doubt.first_answers > 1) {
        reasonLines.push(KEYS.majority(lettersText(doubt.top_wrong)));
      }
    } else if (!keyed) {
      const pictured = Boolean(item.images?.stem?.length || item.images?.options?.some((list) => list.length > 0));
      reasonLines.push(
        item.flags.includes('has_image') ? (pictured ? QUEUE.imageMark : QUEUE.image) : item.flags.includes('several_marked') ? QUEUE.several([]) : QUEUE.noKey,
      );
    }
    const current = item.kind === 'short' ? [] : item.correct;
    const keyLine = item.kind === 'short' ? (item.answers.length ? KEYS.currentShort(item.answers.join('; ')) : KEYS.noKeyNow) : keyed ? KEYS.current(lettersText(item.correct)) : KEYS.noKeyNow;
    const note = notes[item.id];
    const actions: KeyAction[] = [{ key: 'edit', label: KEYS.edit, onClick: () => openEditor(item.id) }];
    if (doubt && keyed) actions.push({ key: 'keep', label: KEYS.keep, onClick: () => void keep(item) });
    actions.push({ key: 'delete', label: QUEUE.remove, muted: true, onClick: () => setAskDelete(item.id) });
    return (
      <KeyQuestion
        key={item.id}
        explanation={item.explanation}
        context={QUEUE.context(subjectName, item.file_no, topic)}
        reason={
          reasonLines.length ? (
            <>
              {reasonLines.map((line) => (
                <p key={line}>{nb(line)}</p>
              ))}
            </>
          ) : null
        }
        stem={item.stem}
        code={item.code}
        pictures={
          item.images
            ? { stem: storedPictures(item.images.stem), options: item.options.map((_, at) => storedPictures(item.images?.options?.[at])) }
            : null
        }
        options={item.options}
        kind={item.kind}
        answers={item.answers}
        current={current}
        tapMode={owner ? tapMode : 'none'}
        instruction={owner && item.kind !== 'short' ? (multiple ? QUEUE.pickKeys : QUEUE.pickKey) : null}
        busy={busy === item.id}
        onTap={(index) => {
          if (item.correct.length === 1 && item.correct[0] === index) return;
          void patchItem(item, { correct: [index] }, { correct: [index] });
        }}
        onSaveKeys={(indices) => void patchItem(item, { correct: indices }, { correct: indices })}
        onSaveForms={(forms) => void patchItem(item, { answers: forms }, { answers: forms })}
        actions={owner ? [...actions, ...extraActions] : extraActions}
      >
        {keyed ? (
          <p className="kq-note" data-muted="">
            {keyLine}
          </p>
        ) : null}
        {doubt?.notes && doubt.notes.length > 0 ? (
          <ul className="kq-notes" aria-label={KEYS.notes}>
            {doubt.notes.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        ) : null}
        {note ? (
          <p className="kq-note" role={note.error ? 'alert' : 'status'}>
            {note.text}
          </p>
        ) : null}
        {askDelete === item.id ? (
          <p className="kq-note ky-confirm">
            {nb(KEYS.removeAsk(item.file_no || String(item.position), group))}{' '}
            <button type="button" className="sf-link" onClick={() => void remove(item)}>
              {KEYS.removeYes}
            </button>{' '}
            <button type="button" className="sf-link" data-muted="" onClick={() => setAskDelete(null)}>
              {KEYS.removeNo}
            </button>
          </p>
        ) : null}
      </KeyQuestion>
    );
  };

  // ───────────────────────────── render ─────────────────────────────

  const crumb = summary ? <Link to={`/exams/c/${containerId}`}>{summary.title}</Link> : null;
  const header = (
    <header className="ex-head ky-head">
      <div style={{ minWidth: 0 }}>
        {crumb ? <p className="ex-crumb">{crumb}</p> : null}
        <h1 className="ex-h1">{KEYS.title}</h1>
      </div>
    </header>
  );

  if (data.loading && !data.data) {
    return (
      <div className="sf-page ky-page" ref={frame.ref} data-frame={frame.size}>
        {header}
        <p className="ky-wait" role="status">
          {KEYS.loading}
        </p>
      </div>
    );
  }
  if (!data.data || !summary) {
    return (
      <div className="sf-page ky-page" ref={frame.ref} data-frame={frame.size}>
        {header}
        {data.gone ? (
          // Not the user's any more (deleted, left, removed): another try changes nothing (usability check m2).
          <p className="ex-note">
            {GONE.title}. {GONE.text}{' '}
            <Link className="sf-link" to="/exams">
              {TO_EXAMS}
            </Link>
          </p>
        ) : (
          <p className="ex-note" role="alert">
            {data.error && /[а-яё]/i.test(data.error) ? data.error : KEYS.loadFailed}{' '}
            <button type="button" className="sf-link" onClick={data.reload}>
              {KEYS.retry}
            </button>
          </p>
        )}
      </div>
    );
  }
  if (!owner) {
    return (
      <div className="sf-page ky-page" ref={frame.ref} data-frame={frame.size}>
        {header}
        <p className="ky-lede">{KEYS.authorOnly}</p>
        <p>
          <Link className="sf-link" to={`/exams/c/${containerId}`}>
            {KEYS.toExam}
          </Link>
        </p>
      </div>
    );
  }

  if (queue && listKind) {
    const finished = queue.index >= queue.ids.length;
    const currentId = finished ? null : queue.ids[queue.index];
    const item = currentId ? byId.get(currentId) ?? null : null;
    const next = () => setQueue((current) => (current ? { ...current, index: current.index + 1 } : current));
    return (
      <div className="sf-page ky-page" ref={frame.ref} data-frame={frame.size}>
        <div className="ky-queue">
          <QueueBar title={QUEUE.title} at={finished ? 0 : queue.index + 1} of={finished ? 0 : queue.ids.length} onDone={closeList} />
          {finished ? (
            <>
              <p className="ky-lede" role="status">
                {queue.ids.length === 0 ? QUEUE.empty : KEYS.queueEnd}
              </p>
              <button type="button" className="sf-primary" onClick={closeList}>
                {KEYS.title}
              </button>
            </>
          ) : !item ? (
            <>
              <p className="ky-lede" role="status">
                {KEYS.removed}
              </p>
              <button type="button" className="sf-link" onClick={next}>
                {KEYS.next}
              </button>
            </>
          ) : (
            renderQuestion(item, [
              {
                key: 'next',
                label: notes[item.id] ? KEYS.next : QUEUE.skip,
                muted: !notes[item.id],
                onClick: next,
              },
            ])
          )}
        </div>
      </div>
    );
  }

  const rows: Array<{ kind: ListKind; title: string; meta: string; n: number }> = [
    { kind: 'nokey', title: KEYS.noKeyRow, meta: KEYS.noKeyMeta(noKey.length), n: noKey.length },
    { kind: 'doubts', title: group ? KEYS.doubtsRow : KEYS.doubtsOwnRow, meta: KEYS.rowCount(doubted.length), n: doubted.length },
    { kind: 'manual', title: KEYS.manualRow, meta: KEYS.rowCount(manual.length), n: manual.length },
  ].filter((row) => row.n > 0) as Array<{ kind: ListKind; title: string; meta: string; n: number }>;

  return (
    <div className="sf-page ky-page" ref={frame.ref} data-frame={frame.size}>
      {header}
      <div className="ky-body" data-side={frame.side ? '' : undefined}>
        <section className="ky-lists" aria-label={KEYS.title}>
          {rows.length > 0 ? (
            <ul className="ky-rows">
              {rows.map((row) => (
                <li key={row.kind}>
                  <button type="button" className="ky-row" onClick={() => openList(row.kind)}>
                    <span className="ky-row-title">{row.title}</span>
                    <span className="ky-row-meta">{nb(row.meta)}</span>
                    <svg className="ky-row-go" viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ky-lede">{KEYS.allGood}</p>
          )}
          {doubtsError ? (
            <p className="ky-lede" role="alert">
              {KEYS.loadFailed}
            </p>
          ) : null}
        </section>

        <section className="ky-find" aria-labelledby={`${findId}-h`}>
          <h2 id={`${findId}-h`} className="ky-h2">
            {KEYS.findTitle}
          </h2>
          <div className="ky-find-row">
            {subjects.length > 1 ? (
              <PaperSelect
                ariaLabel={KEYS.findSubject}
                value={subjectId}
                options={subjects.map((subject) => ({ value: subject.id, label: subject.title }))}
                onChange={(value) => setSubjectId(value)}
              />
            ) : null}
            <label className="ky-no">
              <svg className="ky-no-icon" viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M13 13l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                className="ky-no-input"
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                aria-label={KEYS.findNumber}
                placeholder={KEYS.findPlaceholder}
                value={number}
                maxLength={120}
                onChange={(event) => {
                  setNumber(event.target.value);
                  if (search.get('no')) {
                    const next = new URLSearchParams(search);
                    next.delete('no');
                    next.delete('s');
                    setSearch(next, { replace: true });
                  }
                }}
              />
            </label>
          </div>
          {chosenSubject && takesItems(chosenSubject) && editing !== 'new' ? (
            <p className="ky-add">
              <button type="button" className="sf-link" onClick={() => openEditor('new')}>
                {KEYS.add}
              </button>
            </p>
          ) : null}
          {editing === 'new' && chosenSubject ? (
            <div className="ky-found">
              <QuestionEditor
                key={`new-${chosenSubject.id}`}
                containerId={containerId}
                item={null}
                context={KEYS.addContext(chosenSubject.title, newNumber)}
                group={group}
                busy={adding}
                error={editError}
                onSave={(draft) => void saveNew(draft, newNumber)}
                onCancel={() => setEditing(null)}
              />
            </div>
          ) : null}
          <div ref={resultRef} className="ky-found" aria-live="polite">
            {wanted && !found ? <p className="ky-lede">{nb(KEYS.notFound(subjectTitle.get(subjectId) ?? '', wanted))}</p> : null}
            {found ? (
              <>
                {matches.length > 1 ? <p className="ky-lede">{KEYS.twice(matches.length)}</p> : null}
                {renderQuestion(found)}
              </>
            ) : null}
            {byWords ? (
              wordHits.length === 0 ? (
                <p className="ky-lede">{nb(KEYS.notFoundWords(subjectTitle.get(subjectId) ?? ''))}</p>
              ) : (
                <>
                  <p className="ky-lede">{nb(KEYS.foundWords(wordHits.length, Math.min(wordsShown, wordHits.length)))}</p>
                  <div className="ky-hits">{wordHits.slice(0, wordsShown).map((item) => renderQuestion(item))}</div>
                  {wordHits.length > wordsShown ? (
                    <button type="button" className="sf-link ky-more" onClick={() => setWordsShown((n) => n + WORDS_PAGE)}>
                      {KEYS.more}
                    </button>
                  ) : null}
                </>
              )
            ) : null}
          </div>
        </section>
      </div>

      {/* While a question is open in the editor the bar would cover its «Сохранить» on a phone (live check 45). */}
      {check.length > 0 && editing === null ? (
        <div className="ex-cta ky-cta" data-row={frame.side ? '' : undefined}>
          <button type="button" className="sf-primary" onClick={() => openList('check')}>
            {nb(KEYS.check(check.length))}
          </button>
        </div>
      ) : null}
    </div>
  );
}
