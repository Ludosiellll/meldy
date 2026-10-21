import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { listQuizzes } from '../../api/quizzes';
import { copyText } from '../../lib/clipboard';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { useContainerData } from '../../lib/containers/hooks';
import { dateWords } from '../../lib/quizzes/quizModel';
import { qrCode, shortLink } from '../../lib/quizzes/qr';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useFrame } from '../../components/exams/useFrame';
import { errorText } from '../../components/containers/copyImport';
import { QrScreen } from '../../components/quiz/QuizShare';
import { QUICK_LINK } from '../../components/quick/copyQuick';
import { QUICK_PATH, TESTS_PATH } from '../../components/quick/paths';
import type { QuizListRow } from '../../types/quiz';
import '../../components/exams/exams.css';
import '../../components/quick/quick.css';

const QUIET = 4;

/** The facts of the контрольная as short tags (no chain of «·»): the questions, the time, until when. */
export function linkFacts(row: Pick<QuizListRow, 'item_count' | 'time_limit_s' | 'closes_at' | 'state'>, now: Date = new Date()): string[] {
  const minutes = row.time_limit_s === null ? null : Math.round(row.time_limit_s / 60);
  return [
    QUICK_LINK.questions(row.item_count),
    minutes === null ? QUICK_LINK.noTime : QUICK_LINK.time(minutes),
    row.state === 'closed' ? QUICK_LINK.closed : row.closes_at ? QUICK_LINK.until(dateWords(row.closes_at, now)) : QUICK_LINK.noEnd,
  ];
}

/**
 * /exams/c/:id/quizzes/:quizId/link — the контрольная's link at once (UX audit of 21.10, P1; mockup m3): «Ссылка
 * готова», whether the students sign in, its questions, time and end as tags, the QR code drawn on the device with the
 * link under it, «Скопировать ссылку», «Поделиться» where the device shares, the QR over the whole screen, and how many
 * write and finished. Then «Открыть результаты», «Оформить в студии», «Изменить настройки», «Сделать ещё одну».
 */
export default function QuickLinkPage() {
  const params = useParams();
  const containerId = params.id ?? '';
  const quizId = params.quizId ?? '';
  const frame = useFrame<HTMLDivElement>();
  const data = useContainerData(containerId);
  const summary = data.data?.summary ?? null;
  useEffect(() => {
    if (summary) rememberContainerTitle(summary.id, summary.title);
  }, [summary]);

  const [row, setRow] = useState<QuizListRow | null>(null);
  const [failure, setFailure] = useState<{ text: string; missing: boolean } | null>(null);
  const load = useCallback(() => {
    setFailure(null);
    listQuizzes(containerId).then(
      (rows) => {
        const found = rows.find((entry) => entry.id === quizId) ?? null;
        if (found) setRow(found);
        else setFailure({ text: QUICK_LINK.missing, missing: true });
      },
      (error: unknown) => setFailure({ text: errorText(error, undefined, QUICK_LINK.failed), missing: false }),
    );
  }, [containerId, quizId]);
  useEffect(() => {
    load();
  }, [load]);
  // Back on the tab: the counts are read again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);
  useDocumentTitle(row ? `${QUICK_LINK.docTitle} · ${row.title}` : QUICK_LINK.docTitle);

  const url = row ? `${window.location.origin}/k/${row.code}` : '';
  const code = useMemo(() => (url ? qrCode(url) : null), [url]);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const copy = async () => {
    const ok = await copyText(url, linkRef.current);
    setCopied(ok ? 'ok' : 'failed');
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const share = async () => {
    try {
      await navigator.share({ title: row?.title ?? '', url });
    } catch {
      // Closed without sharing: nothing to say.
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="sf-page qk-page qk-link-page" ref={frame.ref} data-frame={frame.size}>
      <header className="ex-head qk-head">
        <div>
          <p className="ex-crumb">
            <Link to={TESTS_PATH}>{QUICK_LINK.toTests}</Link>
          </p>
          {children}
        </div>
      </header>
    </div>
  );

  if (failure) {
    return shell(
      <p className="ex-note" role="alert">
        {failure.text}{' '}
        {failure.missing ? (
          <Link className="sf-link" to={TESTS_PATH}>
            {QUICK_LINK.toTests}
          </Link>
        ) : (
          <button type="button" className="sf-link" onClick={load}>
            {QUICK_LINK.retry}
          </button>
        )}
      </p>,
    );
  }
  if (!row || !code) {
    return shell(
      <p className="qk-wait" role="status">
        {QUICK_LINK.loading}
      </p>,
    );
  }

  const outer = code.size + QUIET * 2;
  const quizPath = `/exams/c/${encodeURIComponent(containerId)}/quizzes/${encodeURIComponent(quizId)}`;
  return (
    <div className="sf-page qk-page qk-link-page" ref={frame.ref} data-frame={frame.size}>
      <header className="ex-head qk-head">
        <div>
          <p className="ex-crumb">
            <Link to={TESTS_PATH}>{QUICK_LINK.toTests}</Link>
          </p>
          <p className="qk-ready">
            <span className="qk-ready-dot" aria-hidden="true" />
            {QUICK_LINK.ready}
          </p>
          <h1 className="ex-h1">{row.title}</h1>
          <p className="qk-facts">
            <span className="qk-fact">{row.guests ? QUICK_LINK.guests : QUICK_LINK.signIn}</span>
            {linkFacts(row).map((fact) => (
              <span key={fact} className="qk-fact">
                {fact}
              </span>
            ))}
          </p>
        </div>
      </header>

      <div className="qk-link-grid">
        <section className="qk-card qk-share" aria-label={QUICK_LINK.qr}>
          {/* A press on the code opens it large too; the keyboard and a screen reader have «Показать QR на весь экран». */}
          <button type="button" className="qk-qr" onClick={() => setFull(true)} tabIndex={-1} aria-hidden="true">
            <svg viewBox={`${-QUIET} ${-QUIET} ${outer} ${outer}`} shapeRendering="crispEdges">
              <rect x={-QUIET} y={-QUIET} width={outer} height={outer} fill="#fff" />
              <path d={code.path} fill="#0b121c" />
            </svg>
          </button>
          <div className="qk-share-side">
            <label className="sr-only" htmlFor="qk-link">
              {QUICK_LINK.copy}
            </label>
            <input id="qk-link" ref={linkRef} className="qk-link-field" value={shortLink(url)} readOnly onFocus={(event) => event.currentTarget.select()} />
            <div className="qk-share-acts">
              <button type="button" className="sf-primary qk-copy" onClick={() => void copy()}>
                {QUICK_LINK.copy}
              </button>
              {canShare ? (
                <button type="button" className="qk-pill" onClick={() => void share()}>
                  {QUICK_LINK.share}
                </button>
              ) : null}
            </div>
            <p className="qk-copied" role="status" aria-live="polite">
              {copied === 'ok' ? QUICK_LINK.copied : copied === 'failed' ? QUICK_LINK.copyFailed : ''}
            </p>
            <p className="qk-hint">{QUICK_LINK.hint}</p>
            <button type="button" className="sf-link qk-full" onClick={() => setFull(true)}>
              {QUICK_LINK.full}
            </button>
          </div>
        </section>

        <section className="qk-card qk-people" aria-labelledby="qk-people-h">
          <h2 className="qk-h2" id="qk-people-h">
            {QUICK_LINK.results}
          </h2>
          {row.people === 0 ? (
            <p className="qk-people-none">{QUICK_LINK.nobody}</p>
          ) : (
            <p className="qk-facts">
              <span className="qk-fact" data-tone="live">
                {QUICK_LINK.writing(row.writing)}
              </span>
              <span className="qk-fact">{QUICK_LINK.finished(row.finished)}</span>
            </p>
          )}
          <Link className="qk-pill" to={quizPath}>
            {QUICK_LINK.openResults}
          </Link>
        </section>
      </div>

      <p className="qk-after">
        <Link className="sf-link" to={`/exams/c/${encodeURIComponent(containerId)}/studio`}>
          {QUICK_LINK.studio}
        </Link>
        <Link className="sf-link" to={`${quizPath}/edit`}>
          {QUICK_LINK.edit}
        </Link>
        <Link className="sf-link" to={QUICK_PATH}>
          {QUICK_LINK.another}
        </Link>
      </p>
      {full ? <QrScreen url={url} title={row.title} onClose={() => setFull(false)} /> : null}
    </div>
  );
}
