import { useId, useRef } from 'react';
import type { PickerMaterial } from '../../api/exams';
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

/**
 * The lectures of an exam: a checklist with the number of fragments each one gives the mapping
 * («нет текста — не участвует» for a scan), and «Добавить лекции» — files imported as plain text
 * (/api/extract): no summary, no cards, no daily limit.
 */
export default function MaterialPicker(props: MaterialPickerProps) {
  const { materials, selected, open } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const usable = materials.filter((material) => material.textLength > 0);
  const chosen = usable.filter((material) => selected.has(material.id));
  const textOnly = chosen.filter((material) => material.textOnly).length;

  return (
    <div id="lectures">
      <p className="nx-line">
        {props.loading ? 'Загружаем лекции…' : glue(lecturesSummary(chosen.length, usable.length))}
        {!props.loading && materials.length > 0 && (
          <>
            {'\u00a0· '}
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
      {open && (
        <ul className="nx-pick" id={listId} aria-label="Лекции для экзамена">
          {materials.map((material) => {
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
                    <span className="nx-pick-title">{material.title}</span>
                    <span className="nx-pick-meta">{fragmentsLine(material)}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
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
