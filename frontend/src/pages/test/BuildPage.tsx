import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addItems, deleteItem, updateItem } from '../../api/containers';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useFrame } from '../../components/exams/useFrame';
import PaperSelect from '../../components/ui/PaperSelect';
import QuestionEditor from '../../components/containers/keys/QuestionEditor';
import { inputOf, patchOf, type Draft } from '../../components/containers/keys/editorModel';
import { newId } from '../../components/containers/sessionStore';
import { errorText, GONE, KEYS, nb } from '../../components/containers/copyImport';
import { TO_EXAMS } from '../../components/containers/copy';
import type { CardAction } from '../../components/test/BuildCard';
import BuildToolbar from '../../components/test/BuildToolbar';
import QuestionList, { type CardNote } from '../../components/test/QuestionList';
import TypeChoice from '../../components/test/TypeChoice';
import { BUILD, type BuildType } from '../../components/test/copyTest';
import { copyInput, insertAfter, itemFromInput, moveIds, numbered, templateItem, typeOf } from '../../components/test/buildModel';
import { useBuild } from '../../components/test/useBuild';
import type { ItemInput, TestItem, Uuid } from '../../types/container';
import '../../components/exams/exams.css';
import '../../components/test/build.css';

/**
 * /exams/c/:id/build — «Конструктор» (spec 2026-10-18 §47.2): the author's questions of one subject as cards in their
 * order (QuestionList), each with «Изменить» (the editor of «Вопросы и ключи», saved the same way), «Копия» (the same
 * question right under it), «Удалить» (after asking, as «Вопросы и ключи» deletes) and «Выше» / «Ниже» (the cards move
 * at once, the whole order goes to the server and comes back if it refuses). The row above the list (BuildToolbar)
 * holds «Добавить вопрос», which asks the kind first: one answer, several answers, a short answer or «верно / неверно».
 * The bar at the bottom sends the test by link: the quiz setup with every question (?all=1).
 *
 * The state lives in useBuild (the subject, its questions, the reload); every question is added through `addMany`.
 * An exam of several subjects shows a subject choice (?s=<subjectId> opens one). A member and an exam that is gone get
 * the screens of «Вопросы и ключи».
 */

const NEW = 'new:';

export default function BuildPage() {
  const params = useParams();
  const containerId = (params.id ?? '') as Uuid;
  const frame = useFrame<HTMLDivElement>();
  const build = useBuild(containerId);
  const { data, summary, owner, group, subjects, subjectId, list, keyed } = build;
  useDocumentTitle(summary ? `${BUILD.docTitle} · ${summary.title}` : BUILD.docTitle);
  useEffect(() => {
    if (summary) rememberContainerTitle(summary.id, summary.title);
  }, [summary]);
  const whyId = useId();

  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, CardNote | undefined>>({});
  /** Read out only: a moved or deleted question. */
  const [status, setStatus] = useState('');
  /** The toolbar's line after a question was added. */
  const [added, setAdded] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState<string | null>(null);
  /** The question open in the editor: its id, or «new:<kind>» for one being added. */
  const [editing, setEditing] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const newType = editing?.startsWith(NEW) ? (editing.slice(NEW.length) as BuildType) : null;
  const template = useMemo(() => (newType ? templateItem(newType, subjectId, containerId) : null), [newType, subjectId, containerId]);

  const say = (id: string, text: string, error = false) => setNotes((current) => ({ ...current, [id]: { text, error } }));

  // Focus follows the change: a moved card's button, the card after a deleted one, the editor's text.
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const selector = refocus.current;
    if (!selector) return;
    refocus.current = null;
    frame.ref.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  /**
   * Adds questions to the current subject (container_items_add): at its end, or right after `afterId` (then the whole
   * order is sent; `placed` is false when that failed and they stayed at the end). A question without a number from
   * the file gets the next one. The one way this page adds questions: «Добавить вопрос», «Копия», the tools to come.
   */
  const addMany = async (inputs: ItemInput[], afterId?: string): Promise<{ items: TestItem[]; placed: boolean }> => {
    const target = subjectId;
    build.pin();
    const before = list.map((entry) => entry.id);
    const ready = numbered(inputs, build.items, target);
    const batches = await addItems(target, ready);
    const rows = new Map(batches.flatMap((batch) => batch.items).map((row) => [row.ref, row]));
    const made = ready.flatMap((input) => {
      const row = rows.get(input.ref);
      return row ? [itemFromInput(input, row.id, row.position, target, containerId)] : [];
    });
    if (made.length === 0) throw new Error('');
    build.addLocal(made);
    let placed = true;
    if (afterId) {
      placed = (await build.reorder(insertAfter(before, afterId, made.map((item) => item.id)))).ok;
    }
    build.reload();
    return { items: made, placed };
  };

  const openNew = (type: BuildType) => {
    build.pin();
    setEditError(null);
    setAskDelete(null);
    setChoosing(false);
    setAdded(null);
    setEditing(`${NEW}${type}`);
    refocus.current = '.tb-newq textarea';
  };
  const closeEditor = (id: string | null) => {
    setEditing(null);
    refocus.current = id ? `[data-act="edit:${id}"]` : list.length > 0 ? '[data-act="add"]' : '[data-type="single"]';
  };
  const showChoice = (open: boolean) => {
    setChoosing(open);
    setAdded(null);
    setAskDelete(null);
    refocus.current = open ? '[data-type="single"]' : '[data-act="add"]';
  };

  /** «Выше» / «Ниже». */
  const move = async (item: TestItem, dir: -1 | 1) => {
    const next = moveIds(list.map((entry) => entry.id), item.id, dir);
    if (!next) return;
    build.pin();
    const at = next.indexOf(item.id);
    const button = at === 0 ? 'down' : at === next.length - 1 ? 'up' : dir < 0 ? 'up' : 'down';
    refocus.current = `[data-act="${button}:${item.id}"]`;
    setStatus(BUILD.moved(at + 1));
    setBusy(item.id);
    const result = await build.reorder(next);
    setBusy(null);
    if (!result.ok) {
      setStatus('');
      refocus.current = `[data-act="${dir < 0 ? 'up' : 'down'}:${item.id}"]`;
      say(item.id, `${BUILD.moveFailed} ${errorText(result.error)}`, true);
    }
  };

  /** «Копия»: the same content under a new ref and number, right under the original. */
  const copy = async (item: TestItem) => {
    const at = list.findIndex((entry) => entry.id === item.id);
    setBusy(item.id);
    try {
      const { placed } = await addMany([copyInput(item, '', `man:${newId()}`)], item.id);
      if (placed) say(item.id, BUILD.copied(at + 2));
      else say(item.id, BUILD.copiedEnd, true);
    } catch (error) {
      say(item.id, errorText(error), true);
    } finally {
      setBusy(null);
    }
  };

  /** «Удалить» after asking, as «Вопросы и ключи» deletes. */
  const remove = async (item: TestItem) => {
    build.pin();
    const at = list.findIndex((entry) => entry.id === item.id);
    const neighbour = list[at + 1] ?? list[at - 1] ?? null;
    setBusy(item.id);
    try {
      await deleteItem(item.id);
      build.dropLocal(item.id);
      setAskDelete(null);
      setStatus(KEYS.removed);
      refocus.current = neighbour ? `[data-act="edit:${neighbour.id}"]` : '[data-type="single"]';
    } catch (error) {
      say(item.id, errorText(error), true);
    } finally {
      setBusy(null);
    }
  };

  /** The editor's draft saved as in «Вопросы и ключи»: only what changed (editorModel.patchOf). */
  const saveEdit = async (item: TestItem, draft: Draft) => {
    const patch = patchOf(item, draft);
    if (!patch) {
      closeEditor(item.id);
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
      build.patchLocal(item.id, local);
      closeEditor(item.id);
      say(item.id, result.rev_changed ? KEYS.editedReset(group) : KEYS.edited);
    } catch (error) {
      setEditError(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  /** A new question at the end of the subject. */
  const saveNew = async (draft: Draft) => {
    if (!subjectId) return;
    const number = list.length + 1;
    setBusy(NEW);
    setEditError(null);
    try {
      await addMany([inputOf(draft, '', `man:${newId()}`)]);
      setEditing(null);
      setAdded(BUILD.added(number));
      refocus.current = '[data-act="add"]';
    } catch (error) {
      setEditError(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const onAction = (item: TestItem, action: CardAction) => {
    if (busy) return;
    if (action === 'edit') {
      setEditError(null);
      setAskDelete(null);
      setChoosing(false);
      setAdded(null);
      setNotes((current) => ({ ...current, [item.id]: undefined }));
      setEditing(item.id);
      refocus.current = `[data-editing="${item.id}"] textarea`;
    } else if (action === 'copy') void copy(item);
    else if (action === 'delete') {
      setAskDelete(item.id);
      refocus.current = `[data-confirm-no="${item.id}"]`;
    } else void move(item, action === 'up' ? -1 : 1);
  };

  // ───────────────────────────── render ─────────────────────────────

  const header = (
    <header className="ex-head tb-head">
      <div style={{ minWidth: 0 }}>
        <p className="ex-crumb">
          <Link to="/exams">{TO_EXAMS}</Link>
        </p>
        {summary ? <p className="tb-eyebrow">{BUILD.label}</p> : null}
        <h1 className="ex-h1">{summary ? summary.title : BUILD.label}</h1>
        {summary && owner ? <p className="ex-meta">{nb(BUILD.meta(build.items.length, subjects.length, build.items.length - keyed))}</p> : null}
      </div>
      {summary && owner ? (
        <div className="ex-links tb-head-links">
          <Link className="sf-link" to={`/exams/c/${containerId}/quizzes`}>
            {BUILD.quizzes}
          </Link>
          <Link className="sf-link" to={`/exams/c/${containerId}/settings`}>
            {BUILD.settings}
          </Link>
        </div>
      ) : null}
    </header>
  );
  const shell = (children: ReactNode) => (
    <div className="sf-page tb-page" ref={frame.ref} data-frame={frame.size}>
      {header}
      {children}
    </div>
  );

  if (data.loading && !data.data) {
    return shell(
      <p className="tb-wait" role="status">
        {KEYS.loading}
      </p>,
    );
  }
  if (!data.data || !summary) {
    return shell(
      data.gone ? (
        // Not the user's any more (deleted, left, removed): another try changes nothing (as «Вопросы и ключи»).
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
      ),
    );
  }
  if (!owner) {
    return shell(
      <>
        <p className="tb-lede">{KEYS.authorOnly}</p>
        <p>
          <Link className="sf-link" to={`/exams/c/${containerId}`}>
            {KEYS.toExam}
          </Link>
        </p>
      </>,
    );
  }

  const editorOpen = editing !== null;
  const renderEditor = (item: TestItem, number: number) => (
    <QuestionEditor
      key={`edit-${item.id}`}
      containerId={containerId}
      item={item}
      context={BUILD.editContext(number, typeOf(item))}
      group={group}
      busy={busy === item.id}
      error={editError}
      onSave={(draft) => void saveEdit(item, draft)}
      onCancel={() => closeEditor(item.id)}
    />
  );

  return (
    <div className="sf-page tb-page" ref={frame.ref} data-frame={frame.size}>
      {header}
      <div className="tb-body">
        {subjects.length > 1 ? (
          <div className="tb-subject">
            <PaperSelect
              ariaLabel={KEYS.findSubject}
              value={subjectId}
              options={subjects.map((entry) => ({ value: entry.id, label: entry.title }))}
              onChange={(value) => {
                setEditing(null);
                setChoosing(false);
                setAskDelete(null);
                setAdded(null);
                build.chooseSubject(value);
              }}
            />
            <span className="tb-subject-n">{nb(BUILD.subjectCount(list.length))}</span>
          </div>
        ) : null}

        {subjects.length === 0 ? (
          <p className="tb-lede">{BUILD.noSubjects}</p>
        ) : (
          <>
            <BuildToolbar canAdd={list.length > 0 && !editorOpen} choosing={choosing} onChoosing={showChoice} onPick={openNew} note={added} />

            {newType && template ? (
              // The editor takes no draft of its own: a new question of the chosen kind comes to it as `item`
              // (buildModel.templateItem); its «Ничего не изменилось» means nothing here and is hidden (build.css).
              <div className="tb-newq">
                <QuestionEditor
                  key={`new-${newType}-${subjectId}`}
                  containerId={containerId}
                  item={template}
                  context={BUILD.newContext(list.length + 1, newType)}
                  group={false}
                  busy={busy === NEW}
                  error={editError}
                  onSave={(draft) => void saveNew(draft)}
                  onCancel={() => closeEditor(null)}
                />
              </div>
            ) : list.length === 0 ? (
              <div className="tb-empty">
                <p className="tb-lede">{BUILD.empty}</p>
                <TypeChoice onPick={openNew} quietLabel />
              </div>
            ) : null}

            <QuestionList
              items={list}
              busy={busy}
              notes={notes}
              askDelete={askDelete}
              group={group}
              editing={editing}
              renderEditor={renderEditor}
              onAction={onAction}
              onDelete={(item) => void remove(item)}
              onKeep={(item) => {
                setAskDelete(null);
                refocus.current = `[data-act="delete:${item.id}"]`;
              }}
            />
          </>
        )}
        <p className="sr-only" role="status">
          {status}
        </p>
      </div>

      {/* While a question is open in the editor the bar would cover its «Сохранить» on a phone (as in «Вопросы и ключи»). */}
      {subjects.length > 0 && !editorOpen ? (
        <div className="ex-cta tb-cta" data-row={frame.side ? '' : undefined}>
          {keyed === 0 ? (
            <p id={whyId} className="ex-cta-why">
              {BUILD.sendWhy}
            </p>
          ) : null}
          {keyed > 0 ? (
            <Link className="sf-primary" to={`/exams/c/${containerId}/quizzes/new?all=1`}>
              {BUILD.send}
            </Link>
          ) : (
            <button type="button" className="sf-primary" disabled aria-describedby={whyId}>
              {BUILD.send}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
