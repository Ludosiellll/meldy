import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deleteItem } from '../../api/containers';
import { newId } from '../../lib/studio/doc';
import type { TestItem } from '../../types/container';
import type { DocBlock } from '../../types/testDoc';
import QuestionEditor from '../containers/keys/QuestionEditor';
import { inputOf, patchOf, type Draft } from '../containers/keys/editorModel';
import { EDITOR, errorText, KEYS } from '../containers/copyImport';
import type { CardAction } from '../test/BuildCard';
import BuildToolbar, { type ToolbarPlace } from '../test/BuildToolbar';
import QuestionList, { type CardNote } from '../test/QuestionList';
import TypeChoice from '../test/TypeChoice';
import { BUILD, type BuildType } from '../test/copyTest';
import { copyInput, templateItem, typeOf } from '../test/buildModel';
import type { Build } from '../test/useBuild';
import type { Studio } from './useStudio';
import '../test/build.css';

/**
 * «Список» (spec §47.6): the release-47 constructor's cards (QuestionList, BuildToolbar, TypeChoice, QuestionEditor) in
 * the page's order — the questions on the page first, then those that did not fit on it (400 blocks). «Выше / Ниже»
 * move the question past its neighbour question on the page; «Копия» and a new question stand on the page too;
 * «Удалить» asks first, as in the constructor, and the page takes the block off (its row is deleted with it).
 */

const NEW = 'new:';

type Step = { kind: 'edit'; id: string } | { kind: 'add'; at: ToolbarPlace } | { kind: 'new'; type: BuildType };

export default function ListView({
  studio,
  build,
  containerId,
  group,
  savedLine,
}: {
  studio: Studio;
  build: Build;
  containerId: string;
  group: boolean;
  /** The line under a saved question (containers/keys/useSavedLine): no «Счёт… заново» where nothing was counted. */
  savedLine: (itemId: string, revChanged: boolean) => string;
}) {
  const { doc, rows } = studio;
  const rootRef = useRef<HTMLDivElement>(null);
  const onPage = useMemo(() => {
    const out: Array<{ block: DocBlock & { type: 'question' }; item: TestItem }> = [];
    for (const block of doc.blocks) {
      const item = block.type === 'question' ? rows.get(block.item_id) : undefined;
      if (block.type === 'question' && item) out.push({ block, item });
    }
    return out;
  }, [doc.blocks, rows]);
  const list = useMemo(() => {
    const placed = new Set(onPage.map((entry) => entry.item.id));
    return [...onPage.map((entry) => entry.item), ...build.items.filter((item) => !placed.has(item.id))];
  }, [onPage, build.items]);
  const blockOf = (item: TestItem) => onPage.find((entry) => entry.item.id === item.id)?.block ?? null;

  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, CardNote | undefined>>({});
  const [askDelete, setAskDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<ToolbarPlace | null>(null);
  const [round, setRound] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [waiting, setWaiting] = useState<Step | null>(null);
  const [status, setStatus] = useState('');
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const selector = refocus.current;
    if (!selector) return;
    refocus.current = null;
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  const newType = editing?.startsWith(NEW) ? (editing.slice(NEW.length) as BuildType) : null;
  const template = useMemo(() => (newType ? templateItem(newType, build.subjectId, containerId) : null), [newType, build.subjectId, containerId]);
  const say = (id: string, text: string, error = false) => setNotes((current) => ({ ...current, [id]: { text, error } }));

  const run = (step: Step) => {
    setWaiting(null);
    setAskDelete(null);
    setEditError(null);
    if (step.kind === 'edit') {
      setChoosing(null);
      setEditing(step.id);
      setNotes((current) => ({ ...current, [step.id]: undefined }));
      refocus.current = `[data-editing="${step.id}"] .qe-stem`;
    } else if (step.kind === 'add') {
      setChoosing(step.at);
      refocus.current = `[data-place="${step.at}"] [data-type="single"]`;
    } else {
      setChoosing(null);
      setEditing(`${NEW}${step.type}`);
      setRound((n) => n + 1);
      refocus.current = '.tb-newq .qe-stem';
    }
  };
  const guard = (step: Step) => {
    if (editing && dirty) setWaiting(step);
    else run(step);
  };
  const goOn = () => {
    const step = waiting;
    if (!step) return false;
    setDirty(false);
    run(step);
    return true;
  };

  const saveEdit = async (item: TestItem, draft: Draft) => {
    const patch = patchOf(item, draft);
    if (!patch) {
      if (!goOn()) setEditing(null);
      return;
    }
    setBusy(item.id);
    setEditError(null);
    try {
      const result = await studio.patchRow(item.id, patch);
      say(item.id, savedLine(item.id, result.rev_changed));
      if (!goOn()) {
        setEditing(null);
        refocus.current = `[data-act="edit:${item.id}"]`;
      }
    } catch (error) {
      setEditError(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const saveNew = async (draft: Draft, next: boolean) => {
    if (!newType) return;
    const type = newType;
    const number = list.length + 1;
    setBusy(NEW);
    setEditError(null);
    try {
      const blocks = await studio.addInputs([inputOf(draft, '', `man:${newId()}`)]);
      const saved = blocks[0]?.type === 'question' ? blocks[0].item_id : null;
      if (saved) say(saved, BUILD.added(number));
      setStatus(BUILD.added(number));
      if (goOn()) return;
      if (next) {
        setEditing(`${NEW}${type}`);
        setRound((n) => n + 1);
        refocus.current = '.tb-newq .qe-stem';
      } else {
        setEditing(null);
        refocus.current = '[data-place="end"] [data-act="add"]';
      }
    } catch (error) {
      setEditError(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const onAction = async (item: TestItem, action: CardAction) => {
    if (busy) return;
    const block = blockOf(item);
    if (action === 'edit') {
      if (editing !== item.id) guard({ kind: 'edit', id: item.id });
      return;
    }
    if (action === 'delete') {
      setAskDelete(item.id);
      refocus.current = `[data-confirm-no="${item.id}"]`;
      return;
    }
    if (action === 'copy') {
      setBusy(item.id);
      try {
        if (block) await studio.duplicate(block.id);
        else await studio.addInputs([copyInput(item, '', `copy:${newId()}`)]);
        say(item.id, BUILD.copied(list.indexOf(item) + 2));
      } catch (error) {
        say(item.id, errorText(error), true);
      } finally {
        setBusy(null);
      }
      return;
    }
    if (!block) return;
    const at = onPage.findIndex((entry) => entry.block.id === block.id);
    const neighbour = onPage[at + (action === 'up' ? -1 : 1)];
    if (!neighbour) return;
    studio.move(block.id, doc.blocks.findIndex((entry) => entry.id === neighbour.block.id));
    setStatus(BUILD.moved(at + (action === 'up' ? 0 : 2)));
    refocus.current = `[data-act="${action}:${item.id}"]`;
  };

  const remove = async (item: TestItem) => {
    const block = blockOf(item);
    const at = list.indexOf(item);
    const neighbour = list[at + 1] ?? list[at - 1] ?? null;
    setAskDelete(null);
    if (block) studio.remove(block.id);
    else {
      setBusy(item.id);
      try {
        await deleteItem(item.id);
        build.dropLocal(item.id);
      } catch (error) {
        say(item.id, errorText(error), true);
        return;
      } finally {
        setBusy(null);
      }
    }
    setStatus(KEYS.removed);
    refocus.current = neighbour ? `[data-act="edit:${neighbour.id}"]` : '[data-type="single"]';
  };

  const unsaved = (number: number) => (waiting ? EDITOR.unsaved(number) : null);

  return (
    <div className="st-listview tb-body" ref={rootRef}>
      <BuildToolbar
        place="top"
        canAdd={list.length > 0}
        choosing={choosing === 'top'}
        onChoosing={(open) => (open ? guard({ kind: 'add', at: 'top' }) : setChoosing(null))}
        onPick={(type) => guard({ kind: 'new', type })}
      />
      {list.length === 0 && !newType ? (
        <div className="tb-empty">
          <p className="tb-lede">{BUILD.empty}</p>
          <TypeChoice onPick={(type) => run({ kind: 'new', type })} quietLabel />
        </div>
      ) : null}
      <QuestionList
        items={list}
        busy={busy}
        notes={notes}
        askDelete={askDelete}
        group={group}
        editing={editing}
        renderEditor={(item, number) => (
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
            onDiscard={() => {
              setDirty(false);
              if (!goOn()) setEditing(null);
            }}
            onSave={(draft) => void saveEdit(item, draft)}
            onCancel={() => {
              setEditing(null);
              setWaiting(null);
              refocus.current = `[data-act="edit:${item.id}"]`;
            }}
          />
        )}
        onAction={(item, action) => void onAction(item, action)}
        onDelete={(item) => void remove(item)}
        onKeep={(item) => {
          setAskDelete(null);
          refocus.current = `[data-act="delete:${item.id}"]`;
        }}
      />
      {newType && template ? (
        <div className="tb-newq">
          <QuestionEditor
            key={`new-${newType}-${round}`}
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
            onDiscard={() => {
              setDirty(false);
              if (!goOn()) setEditing(null);
            }}
            onSave={(draft) => void saveNew(draft, false)}
            onSaveNext={(draft) => void saveNew(draft, true)}
            onCancel={() => {
              setEditing(null);
              setWaiting(null);
            }}
          />
        </div>
      ) : list.length > 0 ? (
        <BuildToolbar
          place="end"
          canAdd
          choosing={choosing === 'end'}
          onChoosing={(open) => (open ? guard({ kind: 'add', at: 'end' }) : setChoosing(null))}
          onPick={(type) => guard({ kind: 'new', type })}
        />
      ) : null}
      <p className="sr-only" role="status">
        {status}
      </p>
    </div>
  );
}
