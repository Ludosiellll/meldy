import { useEffect, useState } from 'react';
import { listLectures, type LectureTitle } from '../../../api/materials';
import { useAuth } from '../../../contexts/AuthContext';
import { gapCount } from '../../../lib/kinds/cloze';
import { canonicalTolerance } from '../../../lib/kinds/number';
import { KINDS, num } from '../../kinds/copyKinds';
import { LIMITS, numbersOf, type Draft } from './editorModel';

/**
 * The key of a question of a new kind in the author's editor (release 48, docs/kinds/CONTRACT.md §1): the accepted
 * numbers with a tolerance and a unit, the items in the right order, the pairs and the extra right items, the forms of
 * each gap, the lectures an essay is checked by; partial credit where the kind has it. The rows are the editor's own
 * (keys.css .qe-*): a field each, arrows and «×» beside it.
 */

const W = {
  numbers: 'Верное число',
  numbersHint: 'Несколько верных — через «;». Дробь можно с запятой: 9,8.',
  tolerance: 'Допуск, ±',
  toleranceHint: 'Пусто — только точное число.',
  unit: 'Единица',
  unitHint: 'Ответ «5 м» засчитается как «5».',
  range: (from: string, to: string, unit: string) => `Засчитаем от ${from} до ${to}${unit ? ` ${unit}` : ''}.`,
  exact: (value: string, unit: string) => `Засчитаем ровно ${value}${unit ? ` ${unit}` : ''}.`,
  orderItems: 'Пункты в верном порядке',
  orderNote: 'Участник увидит их перемешанными.',
  item: (n: number) => `Пункт ${n}`,
  addItem: 'Добавить пункт',
  up: (n: number) => `Пункт ${n} выше`,
  down: (n: number) => `Пункт ${n} ниже`,
  remove: (n: number) => `Убрать пункт ${n}`,
  pairs: 'Пары',
  left: (n: number) => `Строка ${n}`,
  right: (n: number) => `Пара строки ${n}`,
  addPair: 'Добавить пару',
  removePair: (n: number) => `Убрать пару ${n}`,
  extras: 'Лишние ответы',
  extrasHint: 'Ответы без пары: участник увидит их в списке вместе с верными.',
  extra: (n: number) => `Лишний ответ ${n}`,
  addExtra: 'Добавить лишний ответ',
  removeExtra: (n: number) => `Убрать лишний ответ ${n}`,
  gapsHint: 'Поставьте ___ (три подчёркивания) в тексте вопроса там, где участник вписывает слово.',
  addGap: 'Добавить пропуск в конец текста',
  gap: (n: number) => `Пропуск ${n}: верные ответы`,
  gapHint: 'Несколько вариантов — через «;». Регистр и ё не важны.',
  noGaps: 'В тексте пока нет пропуска.',
  lectures: 'Лекции для проверки',
  lecturesHint: 'Meldy сверит ответ с этими лекциями и поставит «полно», «частично» или «нет» с цитатой. Проверка тратит ваш лимит ИИ. Без лекций ответы проверяете вы.',
  lecturesNone: 'У вас пока нет лекций. Ответы проверите сами.',
  lecturesLoading: 'Загружаем лекции…',
  lecturesFailed: 'Не удалось загрузить лекции.',
  partial: 'Частичный балл',
  partialHint: {
    order: 'За каждую пару пунктов, стоящих в верном порядке, — доля балла.',
    match: 'За каждую верную пару — доля балла.',
    cloze: 'За каждый верный пропуск — доля балла.',
    multiple: 'За верные отметки — доля балла, неверная отметка её снимает.',
  } as Record<string, string>,
};

interface Props {
  id: string;
  draft: Draft;
  busy: boolean;
  setDraft: (change: (current: Draft) => Draft) => void;
}

/** «Частичный балл» with what it counts. */
export function PartialCheck({ id, kind, checked, busy, onChange }: { id: string; kind: string; checked: boolean; busy: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="qe-check qe-partial" htmlFor={`${id}-partial`}>
      <input id={`${id}-partial`} type="checkbox" checked={checked} disabled={busy} aria-describedby={`${id}-partial-hint`} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {W.partial}
        <span className="qe-partial-hint" id={`${id}-partial-hint`}>
          {W.partialHint[kind]}
        </span>
      </span>
    </label>
  );
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Cross() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const moved = <T,>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

function NumberFields({ id, draft, busy, setDraft }: Props) {
  const numbers = numbersOf(draft.numbers ?? '');
  const first = numbers[0] ?? null;
  const tolerance = canonicalTolerance(draft.tolerance ?? '');
  const unit = (draft.unit ?? '').trim();
  let line = '';
  if (first) {
    if (tolerance && Number(tolerance) > 0) {
      const scale = Math.max((first.split('.')[1] ?? '').length, (tolerance.split('.')[1] ?? '').length);
      line = W.range(num((Number(first) - Number(tolerance)).toFixed(scale)), num((Number(first) + Number(tolerance)).toFixed(scale)), unit);
    } else line = W.exact(num(first), unit);
  }
  return (
    <div className="qe-kindbox">
      <label className="qe-label" htmlFor={`${id}-numbers`}>
        {W.numbers}
      </label>
      <input id={`${id}-numbers`} className="kq-input" inputMode="decimal" value={draft.numbers ?? ''} disabled={busy} aria-describedby={`${id}-numbers-hint`}
        onChange={(event) => setDraft((current) => ({ ...current, numbers: event.target.value }))} />
      <p className="qe-khint" id={`${id}-numbers-hint`}>{W.numbersHint}</p>
      <div className="qe-pair-row">
        <div>
          <label className="qe-label" htmlFor={`${id}-tolerance`}>
            {W.tolerance}
          </label>
          <input id={`${id}-tolerance`} className="kq-input" inputMode="decimal" value={draft.tolerance ?? ''} disabled={busy} placeholder="0" aria-describedby={`${id}-tolerance-hint`}
            onChange={(event) => setDraft((current) => ({ ...current, tolerance: event.target.value }))} />
          <p className="qe-khint" id={`${id}-tolerance-hint`}>{W.toleranceHint}</p>
        </div>
        <div>
          <label className="qe-label" htmlFor={`${id}-unit`}>
            {W.unit}
          </label>
          <input id={`${id}-unit`} className="kq-input" value={draft.unit ?? ''} maxLength={LIMITS.unit + 10} disabled={busy} placeholder="м/с²" aria-describedby={`${id}-unit-hint`}
            onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))} />
          <p className="qe-khint" id={`${id}-unit-hint`}>{W.unitHint}</p>
        </div>
      </div>
      {line ? (
        <p className="qe-kind-line" aria-live="polite">
          {line}
        </p>
      ) : null}
    </div>
  );
}

function OrderFields({ id, draft, busy, setDraft }: Props) {
  const items = draft.options;
  return (
    <div className="qe-kindbox">
      <p className="qe-label" id={`${id}-order`}>
        {W.orderItems}
      </p>
      <ol className="qe-rows" aria-labelledby={`${id}-order`}>
        {items.map((option, index) => (
          <li key={index} className="qe-rowline">
            <span className="qe-letter" aria-hidden="true">{index + 1}</span>
            <input className="kq-input" aria-label={W.item(index + 1)} value={option.text} disabled={busy}
              onChange={(event) => setDraft((current) => ({ ...current, options: current.options.map((o, at) => (at === index ? { ...o, text: event.target.value } : o)) }))} />
            <span className="qe-option-tools">
              <button type="button" className="qe-icon" aria-label={W.up(index + 1)} disabled={busy || index === 0}
                onClick={() => setDraft((current) => ({ ...current, options: moved(current.options, index, index - 1) }))}>
                <Arrow up />
              </button>
              <button type="button" className="qe-icon" aria-label={W.down(index + 1)} disabled={busy || index === items.length - 1}
                onClick={() => setDraft((current) => ({ ...current, options: moved(current.options, index, index + 1) }))}>
                <Arrow up={false} />
              </button>
              {items.length > LIMITS.optionsMin ? (
                <button type="button" className="qe-icon" aria-label={W.remove(index + 1)} disabled={busy}
                  onClick={() => setDraft((current) => ({ ...current, options: current.options.filter((_, at) => at !== index) }))}>
                  <Cross />
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <p className="qe-khint">{W.orderNote}</p>
      {items.length < LIMITS.optionsMax ? (
        <div className="qe-row">
          <button type="button" className="sf-link" disabled={busy} onClick={() => setDraft((current) => ({ ...current, options: [...current.options, { text: '', pictures: [] }] }))}>
            {W.addItem}
          </button>
        </div>
      ) : null}
      <PartialCheck id={id} kind="order" checked={Boolean(draft.partial)} busy={busy} onChange={(on) => setDraft((current) => ({ ...current, partial: on }))} />
    </div>
  );
}

function MatchFields({ id, draft, busy, setDraft }: Props) {
  const lefts = draft.options;
  const rights = draft.rights ?? [];
  const extras = draft.extras ?? [];
  const room = LIMITS.rights - lefts.length - extras.length;
  return (
    <div className="qe-kindbox">
      <p className="qe-label" id={`${id}-pairs`}>
        {W.pairs}
      </p>
      <ol className="qe-rows" aria-labelledby={`${id}-pairs`}>
        {lefts.map((option, index) => (
          <li key={index} className="qe-rowline qe-pairline">
            <span className="qe-letter" aria-hidden="true">{index + 1}</span>
            <input className="kq-input" aria-label={W.left(index + 1)} value={option.text} disabled={busy}
              onChange={(event) => setDraft((current) => ({ ...current, options: current.options.map((o, at) => (at === index ? { ...o, text: event.target.value } : o)) }))} />
            <span className="qe-pair-arrow" aria-hidden="true">→</span>
            <input className="kq-input" aria-label={W.right(index + 1)} value={rights[index] ?? ''} maxLength={LIMITS.right + 20} disabled={busy}
              onChange={(event) => setDraft((current) => {
                const next = current.options.map((_, at) => current.rights?.[at] ?? '');
                next[index] = event.target.value;
                return { ...current, rights: next };
              })} />
            <span className="qe-option-tools">
              {lefts.length > LIMITS.optionsMin ? (
                <button type="button" className="qe-icon" aria-label={W.removePair(index + 1)} disabled={busy}
                  onClick={() => setDraft((current) => ({
                    ...current,
                    options: current.options.filter((_, at) => at !== index),
                    rights: current.options.map((_, at) => current.rights?.[at] ?? '').filter((_, at) => at !== index),
                  }))}>
                  <Cross />
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {lefts.length < LIMITS.optionsMax && room > 0 ? (
        <div className="qe-row">
          <button type="button" className="sf-link" disabled={busy}
            onClick={() => setDraft((current) => ({ ...current, options: [...current.options, { text: '', pictures: [] }], rights: [...current.options.map((_, at) => current.rights?.[at] ?? ''), ''] }))}>
            {W.addPair}
          </button>
        </div>
      ) : null}
      <p className="qe-label" id={`${id}-extras`}>
        {W.extras}
      </p>
      <p className="qe-khint">{W.extrasHint}</p>
      {extras.length > 0 ? (
        <ol className="qe-rows" aria-labelledby={`${id}-extras`}>
          {extras.map((text, index) => (
            <li key={index} className="qe-rowline">
              <input className="kq-input" aria-label={W.extra(index + 1)} value={text} maxLength={LIMITS.right + 20} disabled={busy}
                onChange={(event) => setDraft((current) => ({ ...current, extras: (current.extras ?? []).map((t, at) => (at === index ? event.target.value : t)) }))} />
              <span className="qe-option-tools">
                <button type="button" className="qe-icon" aria-label={W.removeExtra(index + 1)} disabled={busy}
                  onClick={() => setDraft((current) => ({ ...current, extras: (current.extras ?? []).filter((_, at) => at !== index) }))}>
                  <Cross />
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {room > 0 ? (
        <div className="qe-row">
          <button type="button" className="sf-link" disabled={busy} onClick={() => setDraft((current) => ({ ...current, extras: [...(current.extras ?? []), ''] }))}>
            {W.addExtra}
          </button>
        </div>
      ) : null}
      <PartialCheck id={id} kind="match" checked={Boolean(draft.partial)} busy={busy} onChange={(on) => setDraft((current) => ({ ...current, partial: on }))} />
    </div>
  );
}

function ClozeFields({ id, draft, busy, setDraft }: Props) {
  const count = gapCount(draft.stem);
  return (
    <div className="qe-kindbox">
      <p className="qe-khint">{W.gapsHint}</p>
      <div className="qe-row">
        <button type="button" className="sf-link" disabled={busy || count >= LIMITS.gaps}
          onClick={() => setDraft((current) => ({ ...current, stem: `${current.stem.replace(/\s+$/, '')} ___`.trimStart(), gaps: [...(current.gaps ?? []), ''] }))}>
          {W.addGap}
        </button>
      </div>
      {count === 0 ? <p className="qe-khint" aria-live="polite">{W.noGaps}</p> : null}
      {Array.from({ length: Math.min(count, LIMITS.gaps) }, (_, index) => (
        <div key={index} className="qe-gap">
          <label className="qe-label" htmlFor={`${id}-gap-${index}`}>
            {W.gap(index + 1)}
          </label>
          <input id={`${id}-gap-${index}`} className="kq-input" value={draft.gaps?.[index] ?? ''} disabled={busy} aria-describedby={`${id}-gap-hint`}
            onChange={(event) => setDraft((current) => {
              const next = Array.from({ length: Math.max(count, current.gaps?.length ?? 0) }, (_, at) => current.gaps?.[at] ?? '');
              next[index] = event.target.value;
              return { ...current, gaps: next };
            })} />
        </div>
      ))}
      {count > 0 ? <p className="qe-khint" id={`${id}-gap-hint`}>{W.gapHint}</p> : null}
      <PartialCheck id={id} kind="cloze" checked={Boolean(draft.partial)} busy={busy} onChange={(on) => setDraft((current) => ({ ...current, partial: on }))} />
    </div>
  );
}

function EssayFields({ id, draft, busy, setDraft }: Props) {
  const { user } = useAuth();
  const [lectures, setLectures] = useState<LectureTitle[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    let live = true;
    listLectures(user.id).then(
      (rows) => live && setLectures(rows),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [user?.id]);
  const chosen = new Set(draft.materialIds ?? []);
  return (
    <div className="qe-kindbox">
      <fieldset className="qe-lectures">
        <legend className="qe-label">{W.lectures}</legend>
        <p className="qe-khint">{W.lecturesHint}</p>
        {failed ? <p className="qe-khint" role="alert">{W.lecturesFailed}</p> : lectures === null ? <p className="qe-khint">{W.lecturesLoading}</p> : lectures.length === 0 ? <p className="qe-khint">{W.lecturesNone}</p> : (
          <ul className="qe-lecture-list">
            {lectures.map((lecture) => (
              <li key={lecture.id}>
                <label className="qe-check">
                  <input type="checkbox" checked={chosen.has(lecture.id)} disabled={busy || (!chosen.has(lecture.id) && chosen.size >= LIMITS.materials)}
                    onChange={(event) => setDraft((current) => {
                      const ids = new Set(current.materialIds ?? []);
                      if (event.target.checked) ids.add(lecture.id);
                      else ids.delete(lecture.id);
                      return { ...current, materialIds: [...ids] };
                    })} />
                  <span>{lecture.title || KINDS.essayLabel}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  );
}

export default function KindFields(props: Props) {
  switch (props.draft.kind) {
    case 'number':
      return <NumberFields {...props} />;
    case 'order':
      return <OrderFields {...props} />;
    case 'match':
      return <MatchFields {...props} />;
    case 'cloze':
      return <ClozeFields {...props} />;
    case 'essay':
      return <EssayFields {...props} />;
    default:
      return null;
  }
}
