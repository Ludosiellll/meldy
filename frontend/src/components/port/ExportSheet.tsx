import { useEffect, useRef, useState } from 'react';
import { EXPORT_FORMATS, exportTest, saveExport, type ExportFormat, type ExportResult } from '../../api/testPort';
import type { TestItem } from '../../types/container';
import { Sheet } from '../containers/ui';
import { PORT } from './copyPort';
import '../containers/containers.css';
import './port.css';

type State = { kind: 'idle' } | { kind: 'counting' } | { kind: 'ready'; result: ExportResult } | { kind: 'failed'; message: string };

/**
 * «Скачать тест файлом» (release 49): GIFT, Moodle XML, Aiken or Kahoot's sheet. Picking a format asks the server what
 * goes into the file (nothing is downloaded yet): «В файл войдут 18 из 20 вопросов» and every question left out with its
 * number and reason; «Скачать файл» saves it. The test in Meldy stays as it is.
 */
export default function ExportSheet({ title, items, numbers, onClose }: { title: string; items: readonly TestItem[]; numbers?: ReadonlyMap<string, number>; onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>('moodle');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [saved, setSaved] = useState<string | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    if (items.length === 0) return undefined;
    const round = ++asked.current;
    const controller = new AbortController();
    setState({ kind: 'counting' });
    setSaved(null);
    exportTest(format, title, items, numbers, controller.signal).then(
      (result) => {
        if (round === asked.current) setState({ kind: 'ready', result });
      },
      (error: unknown) => {
        if (round !== asked.current || controller.signal.aborted) return;
        setState({ kind: 'failed', message: error instanceof Error && error.message ? error.message : PORT.failed });
      },
    );
    return () => controller.abort();
  }, [format, title, items, numbers]);

  const result = state.kind === 'ready' ? state.result : null;
  const download = () => {
    if (!result || result.count === 0) return;
    saveExport(result);
    setSaved(PORT.downloaded(result.name));
  };

  return (
    <Sheet
      title={PORT.exportTitle}
      onClose={onClose}
      className="pt-sheet"
      actions={
        <button type="button" className="sf-primary" disabled={!result || result.count === 0} onClick={download}>
          {PORT.download}
        </button>
      }
    >
      <p data-muted="">{PORT.exportLead}</p>
      {items.length === 0 ? (
        <p className="ct-sheet-status">{PORT.noItems}</p>
      ) : (
        <>
          <fieldset className="ct-choices pt-formats">
            <legend className="sr-only">{PORT.formatsLabel}</legend>
            {EXPORT_FORMATS.map((name) => (
              <label key={name} className="ct-choice pt-format">
                <input type="radio" name="pt-format" value={name} checked={format === name} onChange={() => setFormat(name)} data-autofocus={name === format ? '' : undefined} />
                <span className="pt-format-t">
                  <span className="pt-format-name">{PORT.formats[name].name}</span>
                  <span className="pt-format-lead">{PORT.formats[name].lead}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="pt-summary" aria-live="polite">
            {state.kind === 'counting' ? <p className="ct-sheet-status">{PORT.counting}</p> : null}
            {state.kind === 'failed' ? (
              <p className="ct-sheet-error" role="alert">
                {state.message}
              </p>
            ) : null}
            {result ? (
              <>
                <p className="ct-sheet-status">{result.count > 0 ? PORT.willGo(result.count, result.total) : PORT.noneGo}</p>
                {result.pictures_lost > 0 ? <p className="pt-note">{PORT.picturesLost(result.pictures_lost)}</p> : null}
                {result.skipped.length > 0 ? (
                  <div className="pt-left">
                    <p className="pt-left-h">{PORT.left}</p>
                    <ul>
                      {result.skipped.map((entry, at) => (
                        <li key={at}>{PORT.leftLine(entry.number, entry.reason)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}
            {saved ? (
              <p className="pt-saved" role="status">
                {saved}
              </p>
            ) : null}
          </div>
        </>
      )}
    </Sheet>
  );
}
