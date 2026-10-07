import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { PickerMaterial } from '../../api/exams';
import { OCR_NOTICE, PPTX_MIME } from '../../lib/lectureFormats';
import { AI_COSTS, OCR_PAGES_PER_CHARGE } from '../../lib/plans';
import { displayMaterialTitle } from '../../utils/materialTitle';
import { pluralRu } from '../conversation/visuals';
import {
  FIT_METHOD,
  fitCountText,
  fitSummary,
  groupFitText,
  notCheckedText,
  unmatchedLines,
  type FitStatus,
  type FitView,
} from './lectureFit';
import { glue } from './sheetModel';

export interface ImportStatus {
  key: string;
  name: string;
  state: 'pending' | 'done' | 'error';
  message?: string;
  /** The text was recognised from a scan: the row says so and asks to check formulas and numbers. */
  ocr?: boolean;
}

/** «Какие лекции подходят к вопросам» (components/exams/lectureFit) as the picker shows it. */
export interface PickerFit {
  status: FitStatus;
  /** The last answer for the lectures of the list; null before the first one. */
  view: FitView | null;
  /** The ticks came from the questions: the hint above says so; the summary line adds, for a screen reader, that they are ticked. */
  ticked: boolean;
  /** The ticked lectures are exactly the fitting ones: «Отметить подходящие» has nothing to do. */
  picked: boolean;
  /** Tick exactly the fitting lectures (one click; «Снять все» and the boxes undo it). */
  onPick: () => void;
  onRetry: () => void;
}

interface MaterialPickerProps {
  materials: PickerMaterial[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Tick or untick several lectures at once: all, the found ones, or one subject. */
  onSetMany: (ids: string[], selected: boolean) => void;
  /** Why these lectures are ticked, until the student changes them (null: say nothing). */
  hint?: string | null;
  /** Which lectures fit the questions of the list (null: no list yet, say nothing). */
  fit?: PickerFit | null;
  onImport: (files: File[]) => void;
  imports: ImportStatus[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  disabled?: boolean;
}

export const IMPORT_ACCEPT = `.pdf,.docx,.pptx,.txt,.md,.html,.htm,${PPTX_MIME}`;

/** From this many lectures the list gets a search line and is split by subject. */
export const PICKER_LONG_LIST = 8;
const NO_SUBJECT = 'Без предмета';

function fragmentsLine(material: PickerMaterial): string {
  if (material.textLength === 0) return 'нет текста — не участвует';
  const count = material.fragments;
  const head = `${count} ${pluralRu(count, ['фрагмент', 'фрагмента', 'фрагментов'])}`;
  return glue(material.textOnly ? `${head} · только текст` : head);
}

/** «Все 9 лекций» / «5 из 9 лекций» / «Лекций пока нет». */
export function lecturesSummary(selectedCount: number, usable: number): string {
  if (usable === 0) return 'Лекций с текстом пока нет';
  if (selectedCount === usable) return `Все ${usable} ${pluralRu(usable, ['лекция', 'лекции', 'лекций'])}`;
  if (selectedCount === 0) return 'Лекции не выбраны';
  return `${selectedCount} из ${usable} ${pluralRu(usable, ['лекции', 'лекций', 'лекций'])}`;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[_\s]+/g, ' ').trim();
}

/** Every word of the query is found in the lecture's title or subject («нейр сет» finds «Нейронные сети»). */
export function matchesQuery(material: Pick<PickerMaterial, 'title' | 'subject'>, query: string): boolean {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize(`${displayMaterialTitle(material.title)} ${material.title} ${material.subject}`);
  return words.every((word) => haystack.includes(word));
}

export interface PickerGroup {
  key: string;
  subject: string;
  materials: PickerMaterial[];
}

/** Lectures by subject, in the order of the list (the newest lecture's subject first). */
export function groupBySubject(materials: PickerMaterial[]): PickerGroup[] {
  const groups = new Map<string, PickerGroup>();
  for (const material of materials) {
    const subject = material.subject.trim();
    const key = normalize(subject);
    let group = groups.get(key);
    if (!group) {
      group = { key, subject: subject || NO_SUBJECT, materials: [] };
      groups.set(key, group);
    }
    group.materials.push(material);
  }
  return [...groups.values()];
}

type GroupState = 'none' | 'some' | 'all';

function GroupCheckbox(props: { state: GroupState; label: string; disabled: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = props.state === 'some';
  }, [props.state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={props.label}
      checked={props.state === 'all'}
      disabled={props.disabled}
      onChange={props.onChange}
    />
  );
}

/**
 * What the picker says about «какие лекции подходят к вопросам», under its summary: while the first
 * answer loads, that it is coming; then how many lectures fit (unless the hint above already says the
 * ticks came from the questions) and how it is counted; a failure is one quiet line with «Повторить» —
 * the hint is optional and never stands in the way of saving. One polite live region: a screen reader
 * hears the answer when it comes, and that the questions ticked the lectures.
 */
function FitNote({ fit, disabled }: { fit: PickerFit; disabled?: boolean }) {
  const { view, status } = fit;
  const retry = (
    <button type="button" className="sf-link nx-pick-retry" onClick={fit.onRetry} disabled={disabled}>
      Повторить
    </button>
  );
  return (
    <div className="nx-pick-fitnote" aria-live="polite" aria-busy={status === 'loading' && view ? true : undefined}>
      {!view && status === 'loading' && <p className="ex-meta">Подбираем лекции к вопросам…</p>}
      {!view && status === 'error' && <p className="ex-meta">Не удалось подобрать лекции к вопросам. {retry}</p>}
      {view && (
        <>
          {/* The count is on screen also when the questions ticked the lectures (live check 07.10: the hint alone
              said that lectures were ticked, not how many fit); a screen reader also hears that they are ticked. */}
          <p className="sf-pnote nx-pick-fitsum">
            {glue(fitSummary(view.fitting.length))}
            {fit.ticked ? <span className="ex-sr"> Они отмечены.</span> : null}
          </p>
          <p className="ex-meta">{glue(FIT_METHOD)}</p>
          {view.notChecked > 0 && <p className="ex-meta">{glue(notCheckedText(view.notChecked))}</p>}
          {status === 'error' && <p className="ex-meta">Подсказка не обновилась. {retry}</p>}
        </>
      )}
    </div>
  );
}

/**
 * The lectures of an exam, always in sight (the marks depend on them): a checklist with the number
 * of fragments each one gives the mapping («нет текста — не участвует» for a scan), «Выбрать все /
 * Снять все», and — for a long list — a search line and the lectures split by subject, each subject
 * with its own box. The list scrolls inside the form, so the form keeps its place. «Добавить лекции»
 * imports files as plain text (/api/extract): no summary, no cards, no daily limit; a scanned PDF is
 * recognised by Google Gemini — that costs units (lib/plans scanCost) — and its row asks to check
 * formulas and numbers.
 *
 * With a list of questions (`fit`), Meldy's pencil notes say which lectures fit it: «подходит к 3
 * вопросам» on a lecture, «подходят 2 лекции» on a subject, «Отметить подходящие (N)» next to «Выбрать
 * все», and under the list the questions no lecture fits.
 */
export default function MaterialPicker(props: MaterialPickerProps) {
  const { materials, selected } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const usable = materials.filter((material) => material.textLength > 0);
  const chosen = usable.filter((material) => selected.has(material.id));
  const textOnly = materials.filter((material) => material.textOnly).length;

  const fitView = props.fit?.view ?? null;
  const fitCount = (id: string) => fitView?.counts.get(id) ?? 0;
  const fitting = fitView?.fitting.length ?? 0;
  const unmatched = fitView ? unmatchedLines(fitView.unmatched, fitView.total) : null;

  const long = materials.length >= PICKER_LONG_LIST;
  const filtering = long && query.trim() !== '';
  const found = filtering ? materials.filter((material) => matchesQuery(material, query)) : materials;
  // Lectures that fit the questions go first, otherwise in the list's order — and with them their
  // subject: the owner's «Информатика» was the third subject, below lectures of other courses.
  const visible = fitting > 0 ? [...found.filter((material) => fitCount(material.id) > 0), ...found.filter((material) => fitCount(material.id) === 0)] : found;
  const visibleUsable = visible.filter((material) => material.textLength > 0);
  const groups = long ? groupBySubject(visible) : [];
  const grouped = groups.length > 1;
  const canTick = visibleUsable.some((material) => !selected.has(material.id));
  const canUntick = visibleUsable.some((material) => selected.has(material.id));

  const row = (material: PickerMaterial) => {
    const noText = material.textLength === 0;
    const count = noText ? 0 : fitCount(material.id);
    return (
      <li key={material.id}>
        <label>
          <input
            type="checkbox"
            checked={!noText && selected.has(material.id)}
            disabled={noText || props.disabled}
            onChange={() => props.onToggle(material.id)}
          />
          <span>
            <span className="nx-pick-title">{displayMaterialTitle(material.title)}</span>
            {count > 0 ? (
              // «6 фрагментов · подходит к 2 вопросам»; on a narrow column the note moves to its own line whole.
              <span className="nx-pick-meta nx-pick-dots">
                <span className="nx-pick-dot">
                  <span className="nx-pick-sep" aria-hidden="true">
                    ·
                  </span>
                  {fragmentsLine(material)}
                </span>
                <span className="nx-pick-dot">
                  <span className="nx-pick-sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="nx-pick-fit">{glue(fitCountText(count))}</span>
                </span>
              </span>
            ) : (
              <span className="nx-pick-meta">{fragmentsLine(material)}</span>
            )}
          </span>
        </label>
      </li>
    );
  };

  return (
    <div id="lectures" className="nx-pickbox">
      <p className="nx-line">{props.loading ? 'Загружаем лекции…' : glue(lecturesSummary(chosen.length, usable.length))}</p>
      {!props.loading && props.hint && usable.length > 0 && <p className="ex-meta nx-pick-hint">{glue(props.hint)}</p>}
      {!props.loading && props.fit && usable.length > 0 && <FitNote fit={props.fit} disabled={props.disabled} />}
      {props.error && (
        <p className="ex-note" role="alert">
          {props.error}{' '}
          <button type="button" className="sf-link" onClick={props.onRetry}>
            Повторить
          </button>
        </p>
      )}
      {materials.length === 0 && !props.loading && !props.error && (
        <p className="ex-meta">Без лекций Meldy не сможет отметить покрытие. Список вопросов сохранится и без них.</p>
      )}
      {materials.length > 0 && (
        <div className="nx-pick-panel">
          {long && (
            <label className="nx-pick-find">
              <Search aria-hidden="true" strokeWidth={2} />
              <input
                type="search"
                value={query}
                placeholder="Найти лекцию или предмет"
                aria-label="Найти лекцию"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query) {
                    event.preventDefault();
                    setQuery('');
                  }
                }}
              />
              {query && (
                <button type="button" className="nx-pick-clear" aria-label="Очистить поиск" onClick={() => setQuery('')}>
                  <X aria-hidden="true" strokeWidth={2} />
                </button>
              )}
            </label>
          )}
          {usable.length > 1 && (
            <p className="nx-pick-bulk">
              {/* «Отметить подходящие (6) · Выбрать все · Снять все»: each dot goes with the action after it, and
                  a dot at the start of a line is clipped, so a wrapped line never starts or ends with one. */}
              <span className="nx-pick-dots">
                {props.fit && fitting > 0 && (
                  <span className="nx-pick-dot">
                    <span className="nx-pick-sep" aria-hidden="true">
                      ·
                    </span>
                    <button
                      type="button"
                      className="sf-link nx-pick-fitpick"
                      disabled={props.fit.picked || props.disabled}
                      onClick={props.fit.onPick}
                    >
                      Отметить подходящие ({fitting})
                    </button>
                  </span>
                )}
                <span className="nx-pick-dot">
                  <span className="nx-pick-sep" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    className="sf-link"
                    disabled={!canTick || props.disabled}
                    onClick={() => props.onSetMany(visibleUsable.map((material) => material.id), true)}
                  >
                    {filtering ? 'Выбрать найденные' : 'Выбрать все'}
                  </button>
                </span>
                <span className="nx-pick-dot">
                  <span className="nx-pick-sep" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    className="sf-link"
                    disabled={!canUntick || props.disabled}
                    onClick={() => props.onSetMany(visibleUsable.map((material) => material.id), false)}
                  >
                    {filtering ? 'Снять найденные' : 'Снять все'}
                  </button>
                </span>
              </span>
              {filtering && (
                <span className="nx-pick-found" role="status">
                  {visible.length === 0 ? 'ничего не нашлось' : `нашлось ${visible.length} из ${materials.length}`}
                </span>
              )}
            </p>
          )}
          {visible.length > 0 && grouped && (
            <div className="nx-pick-scroll" role="group" aria-label="Лекции для экзамена">
              {groups.map((group) => {
                const groupUsable = group.materials.filter((material) => material.textLength > 0);
                const ticked = groupUsable.filter((material) => selected.has(material.id)).length;
                const state: GroupState = ticked === 0 ? 'none' : ticked === groupUsable.length ? 'all' : 'some';
                const groupFit = groupUsable.filter((material) => fitCount(material.id) > 0).length;
                return (
                  <section key={group.key} className="nx-pick-group">
                    <label className="nx-pick-head">
                      <GroupCheckbox
                        state={state}
                        label={`Все лекции: ${group.subject}${groupFit > 0 ? `, ${groupFitText(groupFit)}` : ''}`}
                        disabled={groupUsable.length === 0 || Boolean(props.disabled)}
                        onChange={() => props.onSetMany(groupUsable.map((material) => material.id), state !== 'all')}
                      />
                      <span className="nx-pick-subject">
                        {group.subject}
                        {groupFit > 0 && <span className="nx-pick-groupfit">{glue(groupFitText(groupFit))}</span>}
                      </span>
                      <span className="nx-pick-count">
                        {ticked} из {groupUsable.length}
                      </span>
                    </label>
                    <ul className="nx-pick" aria-label={group.subject}>
                      {group.materials.map(row)}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          {visible.length > 0 && !grouped && (
            <ul className="nx-pick nx-pick-scroll" aria-label="Лекции для экзамена">
              {visible.map(row)}
            </ul>
          )}
          {filtering && visible.length === 0 && (
            <p className="ex-meta">
              По «{query.trim()}» лекций нет.{' '}
              <button type="button" className="sf-link" onClick={() => setQuery('')}>
                Показать все
              </button>
            </p>
          )}
        </div>
      )}
      {/* The questions no lecture fits, right above «Добавить лекции»: the missing lecture is added there. */}
      {!props.loading && unmatched && usable.length > 0 && (
        <p className="nx-pick-unmatched">
          <span className="sf-pnote">{glue(unmatched.lead)}</span> <span className="ex-meta">{glue(unmatched.advice)}</span>
        </p>
      )}
      {/* Each row says «только текст»; once, under the list, what that means for the mapping. */}
      {textOnly > 0 && <p className="ex-meta nx-pick-foot">{glue('«Только текст» — лекция без конспекта: для сверки с лекциями этого хватает.')}</p>}
      <div className="nx-import">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={IMPORT_ACCEPT}
          hidden
          aria-label="Файлы лекций"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length > 0) props.onImport(files);
          }}
        />
        {/* One line: the link and what it costs (nothing, a scan's recognition aside). */}
        <p className="nx-import-line">
          <button type="button" className="sf-link" onClick={() => fileRef.current?.click()} disabled={props.disabled}>
            Добавить лекции
          </button>
          {/* What it takes and what it costs; scans are recognised by an outside AI service, said so, with the price. */}
          <span className="ex-meta">
            {' — только текст, без конспекта и без расхода лимита: PDF, DOCX, PPTX, TXT, MD. Сканы PDF распознаёт '}
            <span className="ex-nb">ИИ-сервис</span>
            {` Google Gemini — ${AI_COSTS.scanPages} единиц лимита за каждые ${OCR_PAGES_PER_CHARGE} страниц.`}
          </span>
        </p>
        {props.imports.map((item) => (
          <p key={item.key} className="nx-import-row" role={item.state === 'error' ? 'alert' : undefined}>
            {item.state === 'pending' && `«${item.name}»: читаем текст…`}
            {item.state === 'done' && (item.ocr ? `«${item.name}» добавлена. ${OCR_NOTICE}` : `«${item.name}» добавлена.`)}
            {item.state === 'error' && `«${item.name}» не добавлена: ${item.message ?? 'не удалось прочитать файл.'}`}
          </p>
        ))}
      </div>
    </div>
  );
}
