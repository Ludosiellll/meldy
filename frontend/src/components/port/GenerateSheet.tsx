import { useEffect, useId, useRef, useState } from 'react';
import { listLectures, type LectureTitle } from '../../api/materials';
import { GENERATE_COUNTS, generateTest, portInputs, type GenerateSource, type PortItem } from '../../api/testPort';
import { AI_COSTS } from '../../lib/plans';
import type { ItemInput } from '../../types/container';
import { newImportId } from '../containers/import/importModel';
import { Sheet } from '../containers/ui';
import { PORT } from './copyPort';
import PortList, { firstPicks } from './PortList';
import '../containers/containers.css';
import './port.css';

type Source = 'lecture' | 'text' | 'file';
const SOURCES: Source[] = ['lecture', 'text', 'file'];
const FILE_ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.html,.htm';

type Phase =
  | { kind: 'form' }
  | { kind: 'running' }
  | { kind: 'ready'; items: PortItem[]; dropped: number }
  | { kind: 'adding'; items: PortItem[]; dropped: number }
  | { kind: 'done'; added: number };

/**
 * «Сгенерировать вопросы» (release 49): from one of the author's lectures, a pasted text or a file. The server makes
 * the questions (the lecture analysis's test, the same fragments), gives each its sentence of the text and checks the
 * key against it; the author ticks the ones to take («Проверьте ответ…» ones are not ticked at first) and they are added
 * at the end of the test. It costs what a lecture's «Тест заново» costs, said before the button.
 */
export default function GenerateSheet({ userId, onAdd, onClose }: { userId: string | null; onAdd: (inputs: ItemInput[]) => Promise<number>; onClose: () => void }) {
  const ids = useId();
  const [source, setSource] = useState<Source>('lecture');
  const [lectures, setLectures] = useState<LectureTitle[] | null>(null);
  const [materialId, setMaterialId] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [count, setCount] = useState<number>(10);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!userId) {
      setLectures([]);
      setSource((current) => (current === 'lecture' ? 'text' : current));
      return undefined;
    }
    let live = true;
    listLectures(userId).then(
      (rows) => {
        if (!live) return;
        setLectures(rows);
        setMaterialId((current) => current || rows[0]?.id || '');
        if (rows.length === 0) setSource((current) => (current === 'lecture' ? 'text' : current));
      },
      () => {
        if (!live) return;
        setLectures([]);
        setSource((current) => (current === 'lecture' ? 'text' : current));
      },
    );
    return () => {
      live = false;
    };
  }, [userId]);
  useEffect(() => () => controller.current?.abort(), []);

  const chosen: GenerateSource | null =
    source === 'lecture' ? (materialId ? { material_id: materialId } : null) : source === 'text' ? (text.trim() ? { text } : null) : file ? { file } : null;

  const run = async () => {
    if (!chosen) return;
    controller.current?.abort();
    controller.current = new AbortController();
    setError(null);
    setPhase({ kind: 'running' });
    try {
      const made = await generateTest(chosen, count, controller.current.signal);
      setPicked(firstPicks(made.items));
      setPhase({ kind: 'ready', items: made.items, dropped: made.dropped });
    } catch (failure) {
      if (failure instanceof Error && 'code' in failure && failure.code === 'aborted') return;
      setError(failure instanceof Error && failure.message ? failure.message : PORT.failed);
      setPhase({ kind: 'form' });
    }
  };

  const add = async () => {
    if (phase.kind !== 'ready') return;
    const take = phase.items.filter((_, index) => picked.has(index));
    if (take.length === 0) return;
    setError(null);
    setPhase({ kind: 'adding', items: phase.items, dropped: phase.dropped });
    try {
      const added = await onAdd(portInputs(take, newImportId()));
      setPhase({ kind: 'done', added });
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : PORT.failed);
      setPhase({ kind: 'ready', items: phase.items, dropped: phase.dropped });
    }
  };

  const list = phase.kind === 'ready' || phase.kind === 'adding' ? phase : null;
  const actions =
    phase.kind === 'done' ? (
      <button type="button" className="sf-primary" onClick={onClose}>
        {PORT.close}
      </button>
    ) : list ? (
      <>
        <button type="button" className="sf-primary" disabled={picked.size === 0 || phase.kind === 'adding'} onClick={() => void add()}>
          {phase.kind === 'adding' ? PORT.adding : PORT.pick(picked.size)}
        </button>
        <button type="button" className="sf-link" onClick={() => setPhase({ kind: 'form' })}>
          {PORT.again}
        </button>
      </>
    ) : (
      <button type="button" className="sf-primary" disabled={!chosen || phase.kind === 'running'} onClick={() => void run()}>
        {PORT.run}
      </button>
    );

  return (
    <Sheet title={PORT.generateTitle} onClose={onClose} className="pt-sheet pt-sheet-wide" actions={actions}>
      {phase.kind === 'done' ? (
        <p className="ct-sheet-status" role="status">
          {PORT.added(phase.added)}
        </p>
      ) : list ? (
        <>
          <p className="ct-sheet-status" role="status">
            {PORT.found(list.items.length, list.dropped)}
          </p>
          <PortList
            items={list.items}
            picked={picked}
            onPick={(index, on) =>
              setPicked((current) => {
                const next = new Set(current);
                if (on) next.add(index);
                else next.delete(index);
                return next;
              })
            }
          />
        </>
      ) : (
        <>
          <p data-muted="">{PORT.generateLead}</p>
          <fieldset className="pt-seg" disabled={phase.kind === 'running'}>
            <legend className="sr-only">{PORT.sourcesLabel}</legend>
            {SOURCES.map((name) => (
              <label key={name} className="pt-seg-btn">
                <input type="radio" name={`${ids}-source`} checked={source === name} onChange={() => setSource(name)} />
                <span>{PORT.sources[name]}</span>
              </label>
            ))}
          </fieldset>
          {source === 'lecture' ? (
            lectures === null ? (
              <p className="ct-sheet-status">{PORT.lecturesLoading}</p>
            ) : lectures.length === 0 ? (
              <p className="ct-sheet-status">{PORT.noLectures}</p>
            ) : (
              <label className="ct-field" htmlFor={`${ids}-lecture`}>
                {PORT.lecture}
                <select id={`${ids}-lecture`} className="pt-select" value={materialId} onChange={(event) => setMaterialId(event.target.value)} disabled={phase.kind === 'running'}>
                  {lectures.map((lecture) => (
                    <option key={lecture.id} value={lecture.id}>
                      {lecture.title || PORT.lectureNone}
                    </option>
                  ))}
                </select>
              </label>
            )
          ) : source === 'text' ? (
            <div className="ct-field">
              <label htmlFor={`${ids}-text`}>{PORT.text}</label>
              <textarea id={`${ids}-text`} rows={7} value={text} maxLength={300000} onChange={(event) => setText(event.target.value)} disabled={phase.kind === 'running'} aria-describedby={`${ids}-text-hint`} />
              <span id={`${ids}-text-hint`} className="pt-hint">
                {PORT.textHint}
              </span>
            </div>
          ) : (
            <div className="ct-field">
              <label htmlFor={`${ids}-file`}>{PORT.file}</label>
              <input id={`${ids}-file`} type="file" accept={FILE_ACCEPT} onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={phase.kind === 'running'} aria-describedby={`${ids}-file-hint`} />
              <span id={`${ids}-file-hint`} className="pt-hint">
                {file ? PORT.fileChosen(file.name) : PORT.fileHint}
              </span>
            </div>
          )}
          <fieldset className="pt-count" disabled={phase.kind === 'running'}>
            <legend className="pt-count-l">{PORT.countLabel}</legend>
            <div className="pt-seg">
              {GENERATE_COUNTS.map((n) => (
                <label key={n} className="pt-seg-btn">
                  <input type="radio" name={`${ids}-count`} checked={count === n} onChange={() => setCount(n)} />
                  <span>{n}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="pt-note">{PORT.cost(AI_COSTS.analysisSection)}</p>
          {phase.kind === 'running' ? (
            <p className="ct-sheet-status" role="status">
              {PORT.running}
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p className="ct-sheet-error" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
