import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { PickerMaterial } from '../../api/exams';
import { displayMaterialTitle } from '../../utils/materialTitle';
import { pluralRu } from '../conversation/visuals';
import { glue } from './sheetModel';

export interface ImportStatus {
  key: string;
  name: string;
  state: 'pending' | 'done' | 'error';
  message?: string;
}

interface MaterialPickerProps {
  materials: PickerMaterial[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Tick or untick several lectures at once: all, the found ones, or one subject. */
  onSetMany: (ids: string[], selected: boolean) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (files: File[]) => void;
  imports: ImportStatus[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  disabled?: boolean;
}

export const IMPORT_ACCEPT = '.pdf,.docx,.txt,.md,.html,.htm';

/** From this many lectures the list gets a search line and is split by subject. */
export const PICKER_LONG_LIST = 8;
const NO_SUBJECT = 'Без предмета';
/** How many chosen titles the folded line names before «и ещё N». */
const FOLDED_TITLES = 3;

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

/** «Денежный рынок», «Инфляция» и ещё 2 — what the folded line has ticked. */
export function chosenTitlesLine(titles: string[]): string {
  const named = titles.slice(0, FOLDED_TITLES).map((title) => `«${title}»`);
  const rest = titles.length - named.length;
  if (rest <= 0) return named.length > 1 ? `${named.slice(0, -1).join(', ')} и ${named[named.length - 1]}` : (named[0] ?? '');
  return `${named.join(', ')} и ещё ${rest}`;
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
 * The lectures of an exam: a checklist with the number of fragments each one gives the mapping
 * («нет текста — не участвует» for a scan), «Выбрать все / Снять все», and — for a long list — a
 * search line and the lectures split by subject, each subject with its own box. The list scrolls
 * inside the form, so the form keeps its place. «Добавить лекции» imports files as plain text
 * (/api/extract): no summary, no cards, no daily limit.
 */
export default function MaterialPicker(props: MaterialPickerProps) {
  const { materials, selected, open } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const usable = materials.filter((material) => material.textLength > 0);
  const chosen = usable.filter((material) => selected.has(material.id));
  const textOnly = chosen.filter((material) => material.textOnly).length;

  const long = materials.length >= PICKER_LONG_LIST;
  const filtering = long && query.trim() !== '';
  const visible = filtering ? materials.filter((material) => matchesQuery(material, query)) : materials;
  const visibleUsable = visible.filter((material) => material.textLength > 0);
  const groups = long ? groupBySubject(visible) : [];
  const grouped = groups.length > 1;
  const canTick = visibleUsable.some((material) => !selected.has(material.id));
  const canUntick = visibleUsable.some((material) => selected.has(material.id));

  const row = (material: PickerMaterial) => {
    const noText = material.textLength === 0;
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
            <span className="nx-pick-meta">{fragmentsLine(material)}</span>
          </span>
        </label>
      </li>
    );
  };

  return (
    <div id="lectures" className="nx-pickbox">
      <p className="nx-line">
        {props.loading ? 'Загружаем лекции…' : glue(lecturesSummary(chosen.length, usable.length))}
        {!props.loading && materials.length > 0 && (
          <>
            {' · '}
            <button
              type="button"
              className="sf-link"
              style={{ minHeight: 0, fontSize: 'inherit' }}
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => props.onOpenChange(!open)}
              disabled={props.disabled}
            >
              {open ? 'свернуть' : 'изменить'}
            </button>
          </>
        )}
      </p>
      {!open && !props.loading && chosen.length > 0 && chosen.length < usable.length && (
        <p className="ex-meta nx-pick-chosen">{chosenTitlesLine(chosen.map((material) => displayMaterialTitle(material.title)))}</p>
      )}
      {props.error && (
        <p className="ex-note" role="alert">
          {props.error}{' '}
          <button type="button" className="sf-link" onClick={props.onRetry}>
            Повторить
          </button>
        </p>
      )}
      {textOnly > 0 && (
        <p className="ex-meta">
          {textOnly === chosen.length
            ? 'Все выбранные лекции загружены только текстом: конспекта нет, для разметки этого хватает.'
            : `${textOnly} из них ${textOnly === 1 ? 'загружена' : 'загружены'} только текстом: конспекта нет, для разметки этого хватает.`}
        </p>
      )}
      {materials.length === 0 && !props.loading && !props.error && (
        <p className="ex-meta">Без лекций Meldy не сможет отметить покрытие. Список вопросов сохранится и без них.</p>
      )}
      {open && materials.length > 0 && (
        <div id={listId} className="nx-pick-panel">
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
              <button
                type="button"
                className="sf-link"
                disabled={!canTick || props.disabled}
                onClick={() => props.onSetMany(visibleUsable.map((material) => material.id), true)}
              >
                {filtering ? 'Выбрать найденные' : 'Выбрать все'}
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                className="sf-link"
                disabled={!canUntick || props.disabled}
                onClick={() => props.onSetMany(visibleUsable.map((material) => material.id), false)}
              >
                {filtering ? 'Снять найденные' : 'Снять все'}
              </button>
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
                return (
                  <section key={group.key} className="nx-pick-group">
                    <label className="nx-pick-head">
                      <GroupCheckbox
                        state={state}
                        label={`Все лекции: ${group.subject}`}
                        disabled={groupUsable.length === 0 || Boolean(props.disabled)}
                        onChange={() => props.onSetMany(groupUsable.map((material) => material.id), state !== 'all')}
                      />
                      <span className="nx-pick-subject">{group.subject}</span>
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
        <button type="button" className="sf-link" onClick={() => fileRef.current?.click()} disabled={props.disabled}>
          Добавить лекции
        </button>
        <p className="ex-meta" style={{ marginTop: 0 }}>
          Текстом, без конспекта и без расхода лимита: PDF, DOCX, TXT, MD.
        </p>
        {props.imports.map((item) => (
          <p key={item.key} className="nx-import-row" role={item.state === 'error' ? 'alert' : undefined}>
            {item.state === 'pending' && `«${item.name}»: читаем текст…`}
            {item.state === 'done' && `«${item.name}» добавлена.`}
            {item.state === 'error' && `«${item.name}» не добавлена: ${item.message ?? 'не удалось прочитать файл.'}`}
          </p>
        ))}
      </div>
    </div>
  );
}
