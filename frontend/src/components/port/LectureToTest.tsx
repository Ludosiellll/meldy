import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addItems, fetchOverview } from '../../api/containers';
import { fromLecture, portInputs, type PortItem } from '../../api/testPort';
import type { OverviewContainer } from '../../types/container';
import { newImportId } from '../containers/import/importModel';
import { Sheet } from '../containers/ui';
import { freshQuickSave, saveQuick } from '../quick/saveQuick';
import { PORT } from './copyPort';
import PortList, { firstPicks } from './PortList';
import '../containers/containers.css';
import './port.css';

type Mode = 'make' | 'add';
type Load = { kind: 'loading' } | { kind: 'ready'; title: string; items: PortItem[]; dropped: number } | { kind: 'failed'; message: string };

/**
 * The lecture's own self-test → a test (release 49): «Сделать контрольную» saves its questions as a new test and opens
 * the контрольная's form; «Добавить в тест» adds them to one of the author's tests. Each question keeps its
 * explanation and the lecture's sentence behind its key (POST /api/tests/from-lecture: no model, no units).
 */
export default function LectureToTest({ materialId, title }: { materialId: string; title: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <div className="pt-lecture">
      <p className="pt-lecture-lead">{PORT.lectureLead}</p>
      <div className="pt-lecture-acts">
        <button type="button" className="qz-chip" onClick={() => setMode('make')}>
          {PORT.lectureMake}
        </button>
        <button type="button" className="qz-chip" onClick={() => setMode('add')}>
          {PORT.lectureAdd}
        </button>
      </div>
      {mode ? <LectureSheet materialId={materialId} title={title} mode={mode} onClose={() => setMode(null)} /> : null}
    </div>
  );
}

function LectureSheet({ materialId, title, mode, onClose }: { materialId: string; title: string; mode: Mode; onClose: () => void }) {
  const ids = useId();
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [tests, setTests] = useState<OverviewContainer[] | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ n: number; id: string; title: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fromLecture(materialId, controller.signal).then(
      (made) => {
        setPicked(firstPicks(made.items));
        setLoad({ kind: 'ready', title: made.title || title, items: made.items, dropped: made.dropped });
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'failed', message: failure instanceof Error && failure.message ? failure.message : PORT.failed });
      },
    );
    return () => controller.abort();
  }, [materialId, title]);

  useEffect(() => {
    if (mode !== 'add') return undefined;
    let live = true;
    fetchOverview().then(
      (overview) => {
        if (!live) return;
        const own = (overview?.containers ?? []).filter((entry) => entry.role === 'owner' && entry.kind === 'test' && entry.subjects.length > 0);
        setTests(own);
        setTarget((current) => current || own[0]?.id || '');
      },
      () => live && setTests([]),
    );
    return () => {
      live = false;
    };
  }, [mode]);

  const ready = load.kind === 'ready' ? load : null;
  const take = ready ? ready.items.filter((_, index) => picked.has(index)) : [];

  const go = async () => {
    if (!ready || take.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const inputs = portInputs(take, newImportId());
      if (mode === 'make') {
        const saved = await saveQuick({ title: ready.title || title, items: inputs }, freshQuickSave());
        navigate(`/exams/c/${saved.containerId}/quizzes/new?all=1`);
        return;
      }
      const test = tests?.find((entry) => entry.id === target);
      const subject = test ? [...test.subjects].sort((a, b) => a.position - b.position)[0] : null;
      if (!test || !subject) return;
      await addItems(subject.id, inputs);
      setDone({ n: inputs.length, id: test.id, title: test.title });
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : PORT.failed);
    } finally {
      setBusy(false);
    }
  };

  const primary = done ? (
    <Link className="sf-primary" to={`/exams/c/${done.id}/studio`}>
      {PORT.openStudio}
    </Link>
  ) : (
    <button type="button" className="sf-primary" disabled={!ready || take.length === 0 || busy || (mode === 'add' && !target)} onClick={() => void go()}>
      {busy ? (mode === 'make' ? PORT.making : PORT.adding) : mode === 'make' ? PORT.makeGo : PORT.pick(take.length)}
    </button>
  );

  return (
    <Sheet title={PORT.lectureTitle} onClose={onClose} className="pt-sheet pt-sheet-wide" actions={primary}>
      {load.kind === 'loading' ? (
        <p className="ct-sheet-status" role="status">
          {PORT.lectureLoading}
        </p>
      ) : load.kind === 'failed' ? (
        <p className="ct-sheet-error" role="alert">
          {load.message}
        </p>
      ) : done ? (
        <p className="ct-sheet-status" role="status">
          {PORT.addedTo(done.n, done.title)}
        </p>
      ) : (
        <>
          {mode === 'add' ? (
            tests === null ? (
              <p className="ct-sheet-status">{PORT.testsLoading}</p>
            ) : tests.length === 0 ? (
              <p className="ct-sheet-status">{PORT.noTests}</p>
            ) : (
              <label className="ct-field" htmlFor={`${ids}-test`}>
                {PORT.testsLabel}
                <select id={`${ids}-test`} className="pt-select" value={target} onChange={(event) => setTarget(event.target.value)}>
                  {tests.map((test) => (
                    <option key={test.id} value={test.id}>
                      {test.title}
                    </option>
                  ))}
                </select>
              </label>
            )
          ) : null}
          {load.dropped > 0 ? <p className="pt-note">{PORT.lectureDropped(load.dropped)}</p> : null}
          <PortList
            items={load.items}
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
      )}
      {error ? (
        <p className="ct-sheet-error" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
