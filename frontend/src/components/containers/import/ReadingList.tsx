import { IMPORT, nb } from '../copyImport';
import { AddFileLink } from './FilePick';

/**
 * «Читаем 4 файла» (Concept 1 §3.2): one row per file, its status on the right; a file that did not open says why
 * under its row, with «Убрать файл», and never holds the others back. Long names are cut in the middle, so the end of
 * «Программирование_на_C#_2026.docx» stays readable (design critique N8).
 */

export interface ReadingRow {
  id: string;
  name: string;
  status: 'reading' | 'done' | 'failed';
  found: number | null;
  error: string | null;
  retry: boolean;
}

/** «Программирова…C#.docx»: the head shrinks, the last 12 characters stay. */
export function FileName({ name }: { name: string }) {
  const cut = Math.max(0, name.length - 12);
  return (
    <span className="im-fname" title={name}>
      <span className="im-fname-head">{name.slice(0, cut)}</span>
      <span className="im-fname-tail">{name.slice(cut)}</span>
    </span>
  );
}

interface Props {
  rows: ReadingRow[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onFiles: (files: File[]) => void;
  heading: boolean;
}

export default function ReadingList({ rows, onRemove, onRetry, onFiles, heading }: Props) {
  return (
    <section className="im-reading" aria-label={IMPORT.reading(rows.length)}>
      {heading ? <h2 className="im-found">{nb(IMPORT.reading(rows.length))}</h2> : null}
      <ul className="im-files">
        {rows.map((row) => (
          <li key={row.id} className="im-file" data-status={row.status}>
            <div className="im-file-row">
              <FileName name={row.name} />
              <span className="im-file-status" role={row.status === 'reading' ? 'status' : undefined}>
                {row.status === 'reading' ? IMPORT.readingWait : row.status === 'failed' ? IMPORT.readFailed : nb(IMPORT.fileFound(row.found ?? 0))}
              </span>
            </div>
            {row.status === 'failed' && row.error ? (
              <div className="im-file-why">
                <p>{nb(row.error)}</p>
                <p className="im-file-acts">
                  {row.retry ? (
                    <button type="button" className="sf-link" onClick={() => onRetry(row.id)}>
                      {IMPORT.retryFile}
                    </button>
                  ) : null}
                  <button type="button" className="sf-link" data-muted="" onClick={() => onRemove(row.id)}>
                    {IMPORT.removeFile}
                  </button>
                </p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="im-more">
        <AddFileLink onFiles={onFiles} />
      </p>
    </section>
  );
}
