import { useEffect, useId, useState } from 'react';
import { typingKey } from '../../lib/studio/history';
import { POINTS_MAX, replaceBlock } from '../../lib/studio/doc';
import { DOC_TITLE_MAX, type DocBlock, type DocLayout } from '../../types/testDoc';
import QuestionEditor from '../containers/keys/QuestionEditor';
import { patchOf, type Draft } from '../containers/keys/editorModel';
import { errorText, KEYS } from '../containers/copyImport';
import { typeOf } from '../test/buildModel';
import { BUILD } from '../test/copyTest';
import Choice from './Choice';
import { STUDIO } from './copyStudio';
import { BlockIcon, QuestionIcon } from './icons';
import PictureField from './PictureField';
import type { Studio } from './useStudio';
import type { SideApi } from './Workspace';

/**
 * «Блок» of the settings (spec §47.6 «Справа — свойства выбранного блока»): the selected block's settings — the
 * alignment of a cover and a text, a heading's size, a picture's width, a note's tone, a page's name; for a question
 * the editor of «Вопросы и ключи» (saved into test_items, as there) with «Баллы» and «Обязательный». With nothing
 * selected: the page's name for the participants and how they go through it.
 */

export const LAYOUT_OPTIONS = (['one_by_one', 'one_page', 'pages'] as DocLayout[]).map((value) => ({ value, label: STUDIO.layouts[value], hint: STUDIO.layoutHints[value] }));

function PageSettings({ studio }: { studio: Studio }) {
  const id = useId();
  const { doc } = studio;
  return (
    <div className="st-panel-body">
      <p className="st-lead">{STUDIO.nothingSelected}</p>
      <h3 className="st-panel-h">{STUDIO.pageSettings}</h3>
      <div className="st-group">
        <label className="st-field-label" htmlFor={id}>
          {STUDIO.pageTitle}
        </label>
        <input
          id={id}
          className="st-input"
          value={doc.title}
          maxLength={DOC_TITLE_MAX}
          aria-describedby={`${id}-hint`}
          onChange={(event) => studio.change((current) => ({ ...current, title: event.target.value.replace(/\s*\n\s*/g, ' ') }), typingKey('doc', 'title'))}
        />
        <p className="st-field-hint" id={`${id}-hint`}>
          {STUDIO.pageTitleHint}
        </p>
      </div>
      <Choice label={STUDIO.layout} options={LAYOUT_OPTIONS} value={doc.layout} wide onChange={(layout) => studio.change((current) => ({ ...current, layout }))} />
    </div>
  );
}

function PointsField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const bad = !/^\d{1,3}$/.test(text.trim()) || Number(text) < 1 || Number(text) > POINTS_MAX;
  return (
    <div className="st-points">
      <label className="st-field-label" htmlFor={id}>
        {STUDIO.pointsLabel}
      </label>
      <div className="st-stepper">
        <button type="button" className="st-step" aria-label={STUDIO.pointsLess} disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}>
          −
        </button>
        <input
          id={id}
          className="st-input st-input-num"
          inputMode="numeric"
          value={text}
          aria-invalid={bad || undefined}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d]/g, '').slice(0, 3);
            setText(next);
            const n = Number(next);
            if (next && n >= 1 && n <= POINTS_MAX) onChange(n);
          }}
          onBlur={() => setText(String(value))}
        />
        <button type="button" className="st-step" aria-label={STUDIO.pointsMore} disabled={value >= POINTS_MAX} onClick={() => onChange(Math.min(POINTS_MAX, value + 1))}>
          +
        </button>
      </div>
      <p className="sr-only" id={`${id}-hint`}>
        {STUDIO.pointsHint}
      </p>
    </div>
  );
}

interface QuestionPanelProps {
  studio: Studio;
  block: DocBlock & { type: 'question' };
  number: number;
  containerId: string;
  group: boolean;
  onDirty: (dirty: boolean) => void;
  unsaved: string | null;
  onDiscard: () => void;
  onSaved: () => void;
}

function QuestionPanel({ studio, block, number, containerId, group, onDirty, unsaved, onDiscard, onSaved }: QuestionPanelProps) {
  const item = studio.rows.get(block.item_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    setError(null);
    setNote(null);
  }, [block.id]);
  if (!item) return <p className="st-lead">{STUDIO.gone}</p>;
  const type = typeOf(item);
  const save = async (draft: Draft) => {
    const patch = patchOf(item, draft);
    if (!patch) {
      onSaved();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await studio.patchRow(item.id, patch);
      setNote(result.rev_changed ? KEYS.editedReset(group) : STUDIO.editorSaved);
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };
  const set = (patch: Partial<typeof block>, field: string) => studio.change((current) => replaceBlock(current, { ...block, ...patch }), typingKey(block.id, field));
  return (
    <div className="st-panel-body st-question">
      <div className="st-q-extra">
        <PointsField value={block.points} onChange={(points) => set({ points }, 'points')} />
        <label className="st-switch">
          <input type="checkbox" checked={block.required} onChange={(event) => set({ required: event.target.checked }, 'required')} />
          <span className="st-switch-track" aria-hidden="true" />
          <span className="st-switch-words">
            <span className="st-switch-label">{STUDIO.requiredLabel}</span>
            <span className="st-field-hint">{STUDIO.requiredHint}</span>
          </span>
        </label>
      </div>
      <QuestionEditor
        key={`${item.id}:${round}`}
        containerId={containerId}
        item={item}
        context={STUDIO.editorContext(number, BUILD.types[type])}
        group={group}
        busy={busy}
        error={error}
        trueFalse={type === 'truefalse'}
        noKeyNote={BUILD.noKey}
        onDirty={onDirty}
        unsaved={unsaved}
        onDiscard={() => {
          setRound((n) => n + 1);
          onDiscard();
        }}
        onSave={(draft) => void save(draft)}
        onCancel={() => setRound((n) => n + 1)}
      />
      {note ? (
        <p className="st-note" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}

export interface BlockPanelProps {
  studio: Studio;
  selected: string | null;
  containerId: string;
  group: boolean;
  api: SideApi;
  numbers: ReadonlyMap<string, number>;
  onDirty: (dirty: boolean) => void;
  unsaved: string | null;
  onDiscard: () => void;
  onSaved: () => void;
}

export default function BlockPanel({ studio, selected, containerId, group, api, numbers, onDirty, unsaved, onDiscard, onSaved }: BlockPanelProps) {
  const { doc } = studio;
  const at = selected ? doc.blocks.findIndex((block) => block.id === selected) : -1;
  const block = at >= 0 ? doc.blocks[at] : null;
  if (!block) return <PageSettings studio={studio} />;

  const set = (next: DocBlock, field: string | null = null) => studio.change((current) => replaceBlock(current, next), field ? typingKey(block.id, field) : null);
  const item = block.type === 'question' ? studio.rows.get(block.item_id) : undefined;
  const title = block.type === 'question' ? STUDIO.questionNo(numbers.get(block.id) ?? 0) : STUDIO.types[block.type];

  return (
    <div className="st-block-panel">
      <header className="st-panel-head">
        <span className="st-panel-ico" aria-hidden="true">
          {block.type === 'question' ? item ? <QuestionIcon type={typeOf(item)} /> : null : <BlockIcon type={block.type} />}
        </span>
        <div>
          <h3 className="st-panel-h">{title}</h3>
          <p className="st-panel-sub">{`Блок ${at + 1} из ${doc.blocks.length}`}</p>
        </div>
      </header>

      {block.type === 'question' ? (
        <QuestionPanel
          key={block.id}
          studio={studio}
          block={block}
          number={numbers.get(block.id) ?? 0}
          containerId={containerId}
          group={group}
          onDirty={onDirty}
          unsaved={unsaved}
          onDiscard={onDiscard}
          onSaved={onSaved}
        />
      ) : (
        <div className="st-panel-body">
          {block.type === 'cover' ? (
            <>
              <Choice label={STUDIO.align} options={[{ value: 'left', label: STUDIO.aligns.left }, { value: 'center', label: STUDIO.aligns.center }]} value={block.align} onChange={(align) => set({ ...block, align })} />
              <PictureField label={STUDIO.picture} path={block.image} target={{ kind: 'cover', blockId: block.id }} api={api} presets="cover" onRemove={() => set({ ...block, image: null })} />
            </>
          ) : null}
          {block.type === 'heading' ? (
            <Choice label={STUDIO.size} options={[{ value: 'l', label: STUDIO.sizes.l }, { value: 'm', label: STUDIO.sizes.m }]} value={block.size} onChange={(size) => set({ ...block, size })} />
          ) : null}
          {block.type === 'text' ? (
            <Choice label={STUDIO.align} options={[{ value: 'left', label: STUDIO.aligns.left }, { value: 'center', label: STUDIO.aligns.center }]} value={block.align} onChange={(align) => set({ ...block, align })} />
          ) : null}
          {block.type === 'image' ? (
            <>
              <Choice
                label={STUDIO.width}
                options={[
                  { value: 'narrow', label: STUDIO.widths.narrow },
                  { value: 'wide', label: STUDIO.widths.wide },
                  { value: 'full', label: STUDIO.widths.full },
                ]}
                value={block.width}
                onChange={(width) => set({ ...block, width })}
              />
              <PictureField label={STUDIO.picture} path={block.path || null} target={{ kind: 'image', blockId: block.id }} api={api} />
            </>
          ) : null}
          {block.type === 'note' ? (
            <Choice
              label={STUDIO.tone}
              options={[
                { value: 'info', label: STUDIO.tones.info },
                { value: 'tip', label: STUDIO.tones.tip },
                { value: 'warn', label: STUDIO.tones.warn },
              ]}
              value={block.tone}
              onChange={(tone) => set({ ...block, tone })}
            />
          ) : null}
          {block.type === 'page' ? (
            <label className="st-label-block">
              <span className="st-field-label">{STUDIO.pageBlockTitle}</span>
              <input className="st-input" value={block.title} maxLength={DOC_TITLE_MAX} onChange={(event) => set({ ...block, title: event.target.value.replace(/\s*\n\s*/g, ' ') }, 'title')} />
            </label>
          ) : null}
          <p className="st-panel-foot">
            <button type="button" className="sf-link" data-muted="" onClick={() => api.removeBlock(block.id)}>
              {STUDIO.remove}
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
