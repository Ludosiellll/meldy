import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { addItems, deleteItem, updateItem } from '../../api/containers';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useFrame } from '../../components/exams/useFrame';
import PaperSelect from '../../components/ui/PaperSelect';
import QuestionEditor from '../../components/containers/keys/QuestionEditor';
import { inputOf, patchOf, type Draft } from '../../components/containers/keys/editorModel';
import { useSavedLine } from '../../components/containers/keys/useSavedLine';
import { newId } from '../../components/containers/sessionStore';
import { EDITOR, errorText, GONE, KEYS, nb } from '../../components/containers/copyImport';
import { TO_EXAMS } from '../../components/containers/copy';
import type { CardAction } from '../../components/test/BuildCard';
import BuildToolbar, { type ToolbarPlace } from '../../components/test/BuildToolbar';
import QuestionList, { type CardNote } from '../../components/test/QuestionList';
import TypeChoice from '../../components/test/TypeChoice';
import { BUILD, type BuildType } from '../../components/test/copyTest';
import { copyInput, insertAfter, itemFromInput, moveIds, numbered, templateItem, typeOf } from '../../components/test/buildModel';
import { bringIntoView } from '../../components/test/bringIntoView';
import { useBuild } from '../../components/test/useBuild';
import type { ItemInput, TestItem, Uuid } from '../../types/container';
import '../../components/exams/exams.css';
import '../../components/test/build.css';

/**
 * /exams/c/:id/build — «Конструктор» (spec 2026-10-18 §47.2): the author's questions of one subject as cards in their
 * order (QuestionList), each with «Изменить» (the editor of «Вопросы и ключи», saved the same way), «Копия» (the same
 * question right under it), «Удалить» (after asking, as «Вопросы и ключи» deletes) and «Выше» / «Ниже» (the cards move
 * at once, the whole order goes to the server and comes back if it refuses). «Добавить вопрос» stands above the list and
 * under its last card (BuildToolbar) and asks the kind first: one answer, several answers, a short answer or «верно /
 * неверно». A new question is written under the list; «Сохранить и следующий» saves it and opens a blank one of the
 * same kind (release 47, M2). The bar at the bottom sends the test by link: the quiz setup with every question (?all=1).
 *
 * Changes not saved are kept (release 47, B3): while the open editor holds some, «Изменить» on another card,
 * «Добавить вопрос», another subject or a link off the page wait, and the editor asks «В вопросе N есть несохранённые
 * правки» — «Сохранить» (then the step goes on) or «Не сохранять». Closing or reloading the tab asks the browser's
 * question. The browser's own «Назад» is not held: BrowserRouter has no blocker.
 *
 * The state lives in useBuild (the subject, its questions, the reload); every question is added through `addMany`.
 * An exam of several subjects shows a subject choice (?s=<subjectId> opens one). A member and an exam that is gone get
 * the screens of «Вопросы и ключи».
 */

const NEW = 'new:';

/** A step that waits while the open editor holds changes not saved. */
type Step =
  | { kind: 'edit'; id: string }
  | { kind: 'add'; at: ToolbarPlace }
  | { kind: 'new'; type: BuildType }
  | { kind: 'subject'; id: string }
  | { kind: 'go'; to: string };

/** What takes the focus after the next render, and what must be in view with it (a saved card down to its button). */
interface Focus {
  selector: string;
  show?: [first: string, last: string];
}

export default function BuildPage() {
  const params = useParams();
  const navigate = useNavigate();
  const containerId = (params.id ?? '') as Uuid;
  const frame = useFrame<HTMLDivElement>();
  const build = useBuild(containerId);
  const { data, summary, owner, group, subjects, subjectId, list, keyed } = build;
  const savedLine = useSavedLine(data.data?.planInput, group);
  useDocumentTitle(summary ? `${BUILD.docTitle} · ${summary.title}` : BUILD.docTitle);
  useEffect(() => {
    if (summary) rememberContainerTitle(summary.id, summary.title);
  }, [summary]);
  const whyId = useId();

  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, CardNote | undefined>>({});
  /** Read out only: a moved, deleted or added question. */
  const [status, setStatus] = useState('');
  const [askDelete, setAskDelete] = useState<string | null>(null);
  /** The question open in the editor: its id, or «new:<kind>» for one being added. */
  const [editing, setEditing] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  /** Where the kinds are shown in place of «Добавить вопрос»: above the list or under it. */
  const [choosing, setChoosing] = useState<ToolbarPlace | null>(null);
  /** A new blank editor each time one is opened (the same kind twice in a row too). */
  const [round, setRound] = useState(0);
  /** The open editor holds changes not saved (QuestionEditor's onDirty). */
  const [dirty, setDirty] = useState(false);
  /** The step that waits for «Сохранить» / «Не сохранять». */
  const [waiting, setWaiting] = useState<Step | null>(null);
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;

  const newType = editing?.startsWith(NEW) ? (editing.slice(NEW.length) as BuildType) : null;
  const template = useMemo(() => (newType ? templateItem(newType, subjectId, containerId) : null), [newType, subjectId, containerId]);
  const guarding = editing !== null && dirty;

  const say = (id: string, text: string, error = false) => setNotes((current) => ({ ...current, [id]: { text, error } }));

  // Focus follows the change: a moved card's button, the card after a deleted one, the editor's text; a saved card is
  // brought into view down to the button that takes the focus.
  const refocus = useRef<Focus | null>(null);
  const focusNext = (selector: string, show?: [string, string]) => {
    refocus.current = { selector, show };
  };
  useLayoutEffect(() => {
    const next = refocus.current;
    if (!next) return;
    refocus.current = null;
    const root = frame.ref.current;
    const target = root?.querySelector<HTMLElement>(next.selector);
    if (!root || !next.show) {
      target?.focus();
      return;
    }
    target?.focus({ preventScroll: true });
    const first = root.querySelector(next.show[0]);
    const last = root.querySelector(next.show[1]);
    if (first && last) bringIntoView(first, last);
  });

  // While the editor holds changes: a link off the page waits for the answer, and the tab asks before it closes.
  useEffect(() => {
    if (!guarding) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const to = `${url.pathname}${url.search}${url.hash}`;
      if (to === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
      event.preventDefault();
      setWaiting({ kind: 'go', to });
    };
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [guarding]);

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

  // ─────────────────────────── steps (each waits while the editor holds changes) ───────────────────────────

  const openNew = (type: BuildType) => {
    build.pin();
    setEditError(null);
    setAskDelete(null);
    setChoosing(null);
    setEditing(`${NEW}${type}`);
    setRound((n) => n + 1);
    focusNext('.tb-newq .qe-stem');
  };
  const openEdit = (item: TestItem) => {
    setEditError(null);
    setAskDelete(null);
    setChoosing(null);
    setNotes((current) => ({ ...current, [item.id]: undefined }));
    setEditing(item.id);
    focusNext(`[data-editing="${item.id}"] .qe-stem`);
  };
  const showChoice = (at: ToolbarPlace) => {
    setChoosing(at);
    setAskDelete(null);
    focusNext(`[data-place="${at}"] [data-type="single"]`);
  };
  const hideChoice = (at: ToolbarPlace) => {
    setChoosing(null);
    focusNext(`[data-place="${at}"] [data-act="add"]`);
  };

  const run = (step: Step) => {
    if (step.kind === 'edit') {
      const item = list.find((entry) => entry.id === step.id);
      if (item) openEdit(item);
    } else if (step.kind === 'add') showChoice(step.at);
    else if (step.kind === 'new') openNew(step.type);
    else if (step.kind === 'subject') {
      setEditing(null);
      setChoosing(null);
      setAskDelete(null);
      build.chooseSubject(step.id);
    } else navigate(step.to);
  };
  /** The step now, or after the answer about the changes the open editor holds. */
  const guard = (step: Step) => {
    if (guarding) setWaiting(step);
    else run(step);
  };
  /** «Не сохранять»: the changes go, the step goes on. */
  const discard = () => {
    const step = waitingRef.current;
    setWaiting(null);
    setEditing(null);
    setEditError(null);
    setDirty(false);
    if (step) run(step);
  };
  /** After a save: the waiting step goes on; true when there was one. */
  const goOn = () => {
    const step = waitingRef.current;
    if (!step) return false;
    setWaiting(null);
    setEditing(null);
    run(step);
    return true;
  };

  const closeEditor = (id: string | null) => {
    setEditing(null);
    setWaiting(null);
    focusNext(id ? `[data-act="edit:${id}"]` : list.length > 0 ? '[data-place="end"] [data-act="add"]' : '[data-type="single"]');
  };

  /** «Выше» / «Ниже». */
  const move = async (item: TestItem, dir: -1 | 1) => {
    const next = moveIds(list.map((entry) => entry.id), item.id, dir);
    if (!next) return;
    build.pin();
    const at = next.indexOf(item.id);
    const button = at === 0 ? 'down' : at === next.length - 1 ? 'up' : dir < 0 ? 'up' : 'down';
    focusNext(`[data-act="${button}:${item.id}"]`);
    setStatus(BUILD.moved(at + 1));
    setBusy(item.id);
    const result = await build.reorder(next);
    setBusy(null);
    if (!result.ok) {
      setStatus('');
      focusNext(`[data-act="${dir < 0 ? 'up' : 'down'}:${item.id}"]`);
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
      focusNext(neighbour ? `[data-act="edit:${neighbour.id}"]` : '[data-type="single"]');
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
      if (!goOn()) closeEditor(item.id);
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
      say(item.id, savedLine(item.id, result.rev_changed));
      if (!goOn()) {
        setEditing(null);
        focusNext(`[data-act="edit:${item.id}"]`, [`[data-item="${item.id}"]`, `[data-item="${item.id}"] .tb-actions`]);
      }
    } catch (error) {
      setEditError(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  /** A new question at the end of the subject; `next` — «Сохранить и следующий»: a blank one of the same kind opens under it. */
  const saveNew = async (draft: Draft, next: boolean) => {
    if (!subjectId || !newType) return;
    const type = newType;
    const number = list.length + 1;
    setBusy(NEW);
    setEditError(null);
    try {
      const { items } = await addMany([inputOf(draft, '', `man:${newId()}`)]);
      const saved = items[0].id;
      setNotes((current) => ({ ...current, [saved]: { text: BUILD.added(number), quiet: true } }));
      setStatus(BUILD.added(number));
      if (goOn()) return;
      if (next) {
        setEditing(`${NEW}${type}`);
        setRound((n) => n + 1);
        focusNext('.tb-newq .qe-stem', [`[data-item="${saved}"]`, '.tb-newq .qe-stem']);
      } else {
        setEditing(null);
        focusNext('[data-place="end"] [data-act="add"]', [`[data-item="${saved}"]`, '[data-place="end"]']);
      }
    } catch (error) {
      setEditError(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const onAction = (item: TestItem, action: CardAction) => {
    if (busy) return;
    if (action === 'edit') {
      if (editing !== item.id) guard({ kind: 'edit', id: item.id });
    } else if (action === 'copy') void copy(item);
    else if (action === 'delete') {
      setAskDelete(item.id);
      focusNext(`[data-confirm-no="${item.id}"]`);
    } else void move(item, action === 'up' ? -1 : 1);
  };

  // ───────────────────────────── render ─────────────────────────────

  // «Контрольные · Настройки» stand in the top row on the right from the first frame (while the exam loads too), so
  // nothing moves when it comes; a member's page and a page that failed have none.
  const headLinks = owner || (!summary && data.loading) ? (
    <div className="ex-links tb-head-links">
      <Link className="sf-link" to={`/exams/c/${containerId}/quizzes`}>
        {BUILD.quizzes}
      </Link>
      <Link className="sf-link" to={`/exams/c/${containerId}/settings`}>
        {BUILD.settings}
      </Link>
    </div>
  ) : null;
  const header = (
    <header className="ex-head tb-head">
      <div style={{ minWidth: 0 }}>
        <div className="tb-top">
          <p className="ex-crumb">
            <Link to="/exams">{TO_EXAMS}</Link>
          </p>
          {headLinks}
        </div>
        <h1 className="ex-h1">{summary ? summary.title : BUILD.label}</h1>
        {summary && owner ? <p className="ex-meta">{nb(BUILD.meta(build.items.length, subjects.length, build.items.length - keyed))}</p> : null}
      </div>
    </header>
  );
  const shell = (children: ReactNode) => (
    <div className="sf-page tb-page tb-build" ref={frame.ref} data-frame={frame.size}>
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
  const unsaved = (number: number) => (waiting ? EDITOR.unsaved(number) : null);
  const renderEditor = (item: TestItem, number: number) => (
    <QuestionEditor
      key={`edit-${item.id}`}
      containerId={containerId}
      item={item}
      context={BUILD.editContext(number, typeOf(item))}
      group={group}
      busy={busy === item.id}
      error={editError}
      trueFalse={typeOf(item) === 'truefalse'}
      noKeyNote={BUILD.noKey}
      onDirty={setDirty}
      unsaved={unsaved(number)}
      onDiscard={discard}
      onSave={(draft) => void saveEdit(item, draft)}
      onCancel={() => closeEditor(item.id)}
    />
  );
  // On a phone an empty test shows no bar: «Отправить по ссылке» would only stand there shut (release 47, m4).
  const showBar = subjects.length > 0 && !editorOpen && !(frame.size === 's' && build.items.length === 0);

  return (
    <div className="sf-page tb-page tb-build" ref={frame.ref} data-frame={frame.size}>
      {header}
      <div className="tb-body">
        {subjects.length > 1 ? (
          <div className="tb-subject">
            <PaperSelect
              ariaLabel={KEYS.findSubject}
              value={subjectId}
              options={subjects.map((entry) => ({ value: entry.id, label: entry.title }))}
              onChange={(value) => {
                if (value !== subjectId) guard({ kind: 'subject', id: value });
              }}
            />
            <span className="tb-subject-n">{nb(BUILD.subjectCount(list.length))}</span>
          </div>
        ) : null}

        {subjects.length === 0 ? (
          <p className="tb-lede">{BUILD.noSubjects}</p>
        ) : (
          <>
            <BuildToolbar
              place="top"
              canAdd={list.length > 0}
              choosing={choosing === 'top'}
              onChoosing={(open) => (open ? guard({ kind: 'add', at: 'top' }) : hideChoice('top'))}
              onPick={(type) => guard({ kind: 'new', type })}
            />

            {list.length === 0 && !newType ? (
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
                focusNext(`[data-act="delete:${item.id}"]`);
              }}
            />

            {newType && template ? (
              // The editor takes no draft of its own: a new question of the chosen kind comes to it as `item`
              // (buildModel.templateItem); its «Ничего не изменилось» means nothing here and is hidden (build.css).
              // It is written under the list, where the question will stand.
              <div className="tb-newq">
                <QuestionEditor
                  key={`new-${newType}-${subjectId}-${round}`}
                  containerId={containerId}
                  item={template}
                  context={BUILD.newContext(list.length + 1, newType)}
                  group={false}
                  busy={busy === NEW}
                  error={editError}
                  trueFalse={newType === 'truefalse'}
                  noKeyNote={BUILD.noKey}
                  onDirty={setDirty}
                  unsaved={unsaved(list.length + 1)}
                  onDiscard={discard}
                  onSave={(draft) => void saveNew(draft, false)}
                  onSaveNext={(draft) => void saveNew(draft, true)}
                  onCancel={() => closeEditor(null)}
                />
              </div>
            ) : list.length > 0 ? (
              <BuildToolbar
                place="end"
                canAdd
                choosing={choosing === 'end'}
                onChoosing={(open) => (open ? guard({ kind: 'add', at: 'end' }) : hideChoice('end'))}
                onPick={(type) => guard({ kind: 'new', type })}
              />
            ) : null}
          </>
        )}
        <p className="sr-only" role="status">
          {status}
        </p>
      </div>

      {/* While a question is open in the editor the bar would cover its «Сохранить» on a phone (as in «Вопросы и ключи»). */}
      {showBar ? (
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
