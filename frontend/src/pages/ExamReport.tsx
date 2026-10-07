import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EXAM_MESSAGES, examErrorMessage, isMappingLocked, loadExamBundle, type ExamBundle } from '../api/exams';
import { fetchSheet } from '../api/cheatSheet';
import { useMapJob } from '../components/exams/mapJobs';
import { nearestSentence } from '../components/exams/WhyPanel';
import { glue } from '../components/exams/sheetModel';
import {
  buildTeacherReport,
  evidenceCaption,
  GRADE_LINE,
  pointsNote,
  reportCsv,
  reportDocumentTitle,
  reportFileBase,
  uncheckedLine,
  VERDICT_TITLES,
  type ReportItem,
  type ReportLecture,
  type ReportSheet,
  type ReportVerdict,
  type TeacherReport,
} from '../lib/exams/teacherReport';
import { countBucket, track } from '../lib/telemetry';
import '../styles/paper.css';
import '../components/exams/exams.css';
import './ExamReport.css';

/**
 * «Отчёт для преподавателя» (/exams/:id/report): the exam's questions with what Meldy found in the
 * student's lectures, as a page to print on A4 (or save as PDF) and mark by hand, and as a CSV file.
 * A room: no menu, its own top line; the printout has no app chrome at all. The exam and its cheat
 * sheet are read with the loaders of the exam page; row-level security keeps the exam to its owner, so
 * anyone else (a group's copy belongs to its classmate) sees «Экзамен не найден».
 */
export default function ExamReport() {
  const { id: examId = '' } = useParams();
  return <ReportPage key={examId} examId={examId} />;
}

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bundle: ExamBundle; sheet: ReportSheet; at: Date };

/** The cheat sheet's points; a failed read leaves the report without them (it says so) instead of failing it. */
async function readSheet(examId: string): Promise<ReportSheet> {
  try {
    const response = await fetchSheet(examId);
    return { status: 'ready', questions: response.questions, writing: response.job !== null };
  } catch {
    return { status: 'error' };
  }
}

function ReportPage({ examId }: { examId: string }) {
  const [data, setData] = useState<Load>({ status: 'loading' });
  const job = useMapJob(examId);
  const seq = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      const current = ++seq.current;
      if (!quiet) setData({ status: 'loading' });
      const sheet = readSheet(examId);
      try {
        const bundle = await loadExamBundle(examId);
        if (current !== seq.current) return;
        if (!bundle) {
          setData({ status: 'missing' });
          return;
        }
        // The mapping is on the page at once; the points follow when the cheat sheet has been read (a read
        // again keeps the points it had meanwhile).
        setData((previous) => ({
          status: 'ready',
          bundle,
          sheet: quiet && previous.status === 'ready' && previous.sheet.status === 'ready' ? previous.sheet : { status: 'loading' },
          at: new Date(),
        }));
        const read = await sheet;
        if (current !== seq.current) return;
        setData((previous) => (previous.status === 'ready' ? { ...previous, sheet: read } : previous));
      } catch (error) {
        if (current !== seq.current) return;
        setData((previous) =>
          quiet && previous.status === 'ready' ? previous : { status: 'error', message: examErrorMessage(error, EXAM_MESSAGES.load) },
        );
      }
    },
    [examId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A mapping run of this tab ended while the report was open: its marks are in the rows now.
  const finished = useRef(job.finishedSeq);
  useEffect(() => {
    if (job.finishedSeq === finished.current) return;
    finished.current = job.finishedSeq;
    void load(true);
  }, [job.finishedSeq, load]);

  const ready = data.status === 'ready' ? data : null;
  const running =
    job.phase === 'running' ||
    job.phase === 'waiting' ||
    Boolean(ready && ready.bundle.exam.mapping_state === 'running' && isMappingLocked(ready.bundle.exam));
  const report = useMemo(
    () => (ready ? buildTeacherReport({ bundle: ready.bundle, sheet: ready.sheet, running, now: ready.at }) : null),
    [ready, running],
  );

  // Chrome names a saved PDF after the page's title.
  useEffect(() => {
    if (!report) return;
    const previous = document.title;
    document.title = reportDocumentTitle(report);
    return () => {
      document.title = previous;
    };
  }, [report]);

  const bar = (
    <header className="sf-room-bar">
      <div className="dw-left">
        <Link className="dw-wordmark" to="/dashboard">
          Meldy
        </Link>
        <span className="dw-where">
          <span className="dw-long">{report ? `${report.title} · Отчёт для преподавателя` : 'Отчёт для преподавателя'}</span>
          <span className="dw-short">Отчёт</span>
        </span>
      </div>
      <Link className="sf-link dw-exit" to={`/exams/${examId}`}>
        Назад к экзамену
      </Link>
    </header>
  );

  let body: JSX.Element;
  if (data.status === 'loading') {
    body = (
      <p className="ex-loading" role="status">
        Собираем отчёт…
      </p>
    );
  } else if (data.status === 'missing') {
    body = (
      <Empty title="Экзамен не найден" text="Его удалили, или он принадлежит другому аккаунту.">
        <Link className="ex-secondary" to="/exams">
          Экзамены
        </Link>
      </Empty>
    );
  } else if (data.status === 'error') {
    body = (
      <Empty title="Не удалось собрать отчёт" text={data.message} alert>
        <button type="button" className="sf-primary" onClick={() => void load()}>
          Повторить
        </button>
      </Empty>
    );
  } else if (!report || report.state !== 'ready') {
    body = <EmptyReport examId={examId} report={report} onReload={() => void load()} />;
  } else {
    body = <ReadyReport report={report} sheet={data.sheet} onReload={() => void load(true)} />;
  }

  return (
    <>
      {bar}
      <main className="sf-page rp-room">{body}</main>
    </>
  );
}

// ------------------------------------------------------------------------------------- empty states

function Empty({ title, text, alert, children }: { title: string; text: string; alert?: boolean; children?: React.ReactNode }) {
  return (
    <div className="rp-empty" role={alert ? 'alert' : undefined}>
      <h1>{title}</h1>
      <p>{glue(text)}</p>
      {children ? <div className="rp-empty-act">{children}</div> : null}
    </div>
  );
}

function EmptyReport({ examId, report, onReload }: { examId: string; report: TeacherReport | null; onReload: () => void }) {
  if (report?.state === 'no-questions') {
    return (
      <Empty title="В экзамене нет вопросов" text="Добавьте вопросы кафедры и сверьте их с лекциями — после этого здесь будет отчёт.">
        <Link className="sf-primary" to={`/exams/${examId}/edit`}>
          Изменить список
        </Link>
      </Empty>
    );
  }
  if (report?.state === 'no-lectures') {
    return (
      <Empty
        title="К экзамену не добавлены лекции"
        text="Отчёт сверяет вопросы кафедры с лекциями студента. Добавьте лекции и сверьте с ними вопросы — после этого здесь будет отчёт."
      >
        <Link className="sf-primary" to={`/exams/${examId}/edit#lectures`}>
          Добавить лекции
        </Link>
      </Empty>
    );
  }
  if (report?.mapping === 'running') {
    return (
      <Empty title="Сверка ещё идёт" text="Отчёт будет готов, когда сверка закончится. Если страница не обновится сама, нажмите «Обновить».">
        <button type="button" className="ex-secondary" onClick={onReload}>
          Обновить
        </button>
      </Empty>
    );
  }
  const interrupted = report?.mapping === 'interrupted';
  return (
    <Empty
      title={interrupted ? 'Сверка прервалась' : 'Вопросы ещё не сверены с лекциями'}
      text={
        interrupted
          ? 'Сверка остановилась раньше, чем проверила первый вопрос. Запустите её снова на странице экзамена — после этого здесь будет отчёт.'
          : 'Отчёт показывает, где в лекциях ответ на каждый вопрос. Нажмите «Сверить с лекциями» на странице экзамена — после этого здесь будет отчёт.'
      }
    >
      <Link className="ex-secondary" to={`/exams/${examId}`}>
        Назад к экзамену
      </Link>
    </Empty>
  );
}

// ------------------------------------------------------------------------------------- the report

function downloadCsv(report: TeacherReport) {
  const blob = new Blob([reportCsv(report)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${reportFileBase(report)}.csv`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked later: a download that starts after the click must still find the file.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function ReadyReport({ report, sheet, onReload }: { report: TeacherReport; sheet: ReportSheet; onReload: () => void }) {
  const questions = countBucket(report.counts.total);
  // Printing before the points arrive would leave them out.
  const pending = sheet.status === 'loading';
  const print = () => {
    track('report_print', { questions });
    // A browser inside a messenger may have no print at all.
    if (typeof window.print === 'function') window.print();
  };
  const csv = () => {
    track('report_csv', { questions });
    downloadCsv(report);
  };

  return (
    <>
      <div className="rp-tools" data-print="hide">
        <p className="rp-tools-hint">{glue('Распечатайте на A4 или сохраните в PDF: в окне печати выберите «Сохранить как PDF».')}</p>
        <div className="rp-tools-acts">
          <button type="button" className="ex-secondary" onClick={csv} disabled={pending}>
            Скачать CSV
          </button>
          <button type="button" className="sf-primary" onClick={print} disabled={pending}>
            Печать
          </button>
        </div>
        {pending && (
          <p className="rp-tools-warn" role="status">
            Загружаем пункты ответов…
          </p>
        )}
        {sheet.status === 'error' && (
          <p className="rp-tools-warn" role="status">
            {glue('Пункты ответов не загрузились.')}{' '}
            <button type="button" className="sf-link" onClick={onReload}>
              Загрузить снова
            </button>
          </p>
        )}
      </div>
      <TeacherReportDocument report={report} />
    </>
  );
}

/** The document itself: what is printed, and what the screen shows on its sheet of paper. */
export function TeacherReportDocument({ report }: { report: TeacherReport }) {
  const groups = useMemo(() => {
    const result: Array<{ title: string | null; items: ReportItem[] }> = [];
    for (const item of report.items) {
      if (item.sectionTitle !== null || result.length === 0) result.push({ title: item.sectionTitle, items: [] });
      result[result.length - 1].items.push(item);
    }
    return result;
  }, [report.items]);
  const sections = groups.some((group) => group.title !== null);
  const unchecked = uncheckedLine(report.counts);

  return (
    <article className="rp-doc" aria-labelledby="rp-title">
      <div className="rp-head">
        <p className="rp-eyebrow">
          <span>Отчёт сверки для преподавателя</span>
          <span className="rp-brand">Meldy</span>
        </p>
        <h1 id="rp-title" className="rp-title">
          {report.title}
        </h1>
        <p className="rp-kind">{report.examDay ? `${report.kind} · ${report.examDay}` : report.kind}</p>
        <dl className="rp-meta">
          <div>
            <dt>Сверка с лекциями</dt>
            <dd>{report.mappedAt || '—'}</dd>
          </div>
          <div>
            <dt>Отчёт составлен</dt>
            <dd>{report.madeAt}</dd>
          </div>
          <div>
            <dt>Вопросов кафедры</dt>
            <dd>{report.counts.total}</dd>
          </div>
          <div data-fill="">
            <dt>Студент</dt>
            <dd>
              <span className="ex-sr">заполняется от руки</span>
            </dd>
          </div>
        </dl>
      </div>

      <section className="rp-part" aria-labelledby="rp-sum-t">
        <h2 id="rp-sum-t" className="rp-h2">
          Итог сверки
        </h2>
        <ul className="rp-tally">
          <Tally verdict="full" count={report.counts.full} label="есть в лекциях" />
          <Tally verdict="partial" count={report.counts.partial} label="частично" />
          <Tally verdict="none" count={report.counts.none} label="нет в лекциях" />
          <Tally verdict="unmapped" count={report.counts.unchecked} label="не проверено ИИ" />
        </ul>
        {unchecked && <p className="rp-fine">{glue(unchecked)}</p>}
        {report.notes.map((note) => (
          <p key={note} className="rp-notice">
            {glue(note)}
          </p>
        ))}
      </section>

      <div className="rp-cols">
        <section className="rp-part" aria-labelledby="rp-lect-t">
          <h2 id="rp-lect-t" className="rp-h2">
            Лекции студента
          </h2>
          <ul className="rp-lectures">
            {report.lectures.map((lecture) => (
              <li key={lecture.id}>
                <span className="rp-lecture">{glue(lecture.title || 'Без названия')}</span>
                <span className="rp-fine">{glue(lectureNote(lecture))}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rp-part" aria-labelledby="rp-how-t">
          <h2 id="rp-how-t" className="rp-h2">
            Как читать отчёт
          </h2>
          <ul className="rp-how">
            <li>{glue('Цитата — текст лекции студента без изменений. Над ней название лекции и номер фрагмента.')}</li>
            <li>{glue('Пункты ответа Meldy составил по этим цитатам. Главные пункты отмечены словом «главный».')}</li>
            <li>{glue('Справа у каждого вопроса — место для вашей пометки: верно, неполно или ошибка.')}</li>
          </ul>
        </section>
      </div>

      <section className="rp-part rp-list" aria-labelledby="rp-list-t">
        <h2 id="rp-list-t" className="rp-h2">
          Вопросы кафедры
        </h2>
        <div className="rp-list-head" aria-hidden="true">
          <span>№</span>
          <span>Вопрос, цитата из лекции и пункты ответа</span>
          <span>Пометка преподавателя</span>
        </div>
        {groups.map((group, index) => (
          <Fragment key={group.items[0]?.id ?? index}>
            {group.title !== null && (
              <h3 className="rp-sec">
                <span>{glue(group.title)}</span>
              </h3>
            )}
            <ol className="rp-qs">
              {group.items.map((item) => (
                <Question key={item.id} item={item} heading={sections ? 'h4' : 'h3'} />
              ))}
            </ol>
          </Fragment>
        ))}
      </section>

      <section className="rp-part rp-end" aria-labelledby="rp-end-t">
        <h2 id="rp-end-t" className="rp-h2">
          Что делает Meldy и чего не делает
        </h2>
        <ul className="rp-how">
          <li>{glue('Находит в лекциях студента фрагменты, где есть ответ на вопрос кафедры, и составляет по ним пункты ответа.')}</li>
          <li>{glue('Задаёт студенту вопросы вслух и отмечает, какие пункты он назвал сам.')}</li>
          <li>
            {glue(
              'Не знает, что говорили на занятиях: сверка идёт только по лекциям, которые загрузил студент. «Нет в лекциях» значит, что в этих лекциях ответа нет.',
            )}
          </li>
        </ul>
        <p className="rp-grade">{glue(`${GRADE_LINE}.`)}</p>
      </section>

      <section className="rp-part rp-sign" aria-labelledby="rp-sign-t">
        <h2 id="rp-sign-t" className="rp-h2">
          Отчёт проверил(а)
        </h2>
        <div className="rp-sign-grid">
          <SignField label="Должность" wide />
          <SignField label="Фамилия и инициалы" wide />
          <SignField label="Подпись" />
          <SignField label="Дата" />
        </div>
      </section>
    </article>
  );
}

function lectureNote(lecture: ReportLecture): string {
  const quoted = lecture.cited > 0 ? `цитаты к ${lecture.cited} ${lecture.cited % 10 === 1 && lecture.cited % 100 !== 11 ? 'вопросу' : 'вопросам'}` : 'цитат нет';
  if (lecture.removed) return `${quoted}, убрана из экзамена после сверки`;
  if (lecture.addedAfter) return 'добавлена после сверки, в ней не участвовала';
  return quoted;
}

function Tally({ verdict, count, label }: { verdict: ReportVerdict; count: number; label: string }) {
  return (
    <li>
      <span className="rp-tally-n">{count}</span>
      <span className="rp-tally-l">
        <VerdictDot verdict={verdict} />
        {label}
      </span>
    </li>
  );
}

function SignField({ label, wide }: { label: string; wide?: boolean }) {
  return (
    <div className="rp-sign-field" data-wide={wide ? '' : undefined}>
      <span className="rp-fill" aria-hidden="true" />
      <span className="rp-sign-label">{label}</span>
    </div>
  );
}

/**
 * The verdict's mark, drawn so that it reads in black and white: a full circle «есть», a half one
 * «частично», an empty one «нет», a dashed one when the model did not check the question.
 */
function VerdictDot({ verdict }: { verdict: ReportVerdict }) {
  return (
    <svg className="rp-dot" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      {verdict === 'full' ? (
        <circle cx="6" cy="6" r="5.3" fill="currentColor" />
      ) : verdict === 'partial' ? (
        <>
          <circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6 1.2 A4.8 4.8 0 0 0 6 10.8 Z" fill="currentColor" />
        </>
      ) : verdict === 'none' ? (
        <circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      ) : (
        <circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.1 1.7" />
      )}
    </svg>
  );
}

function Question({ item, heading }: { item: ReportItem; heading: 'h3' | 'h4' }) {
  const Heading = heading;
  return (
    <li className="rp-q" data-verdict={item.verdict}>
      <span className="rp-q-num" aria-hidden="true">
        {item.number}
      </span>
      <div className="rp-q-main">
        <Heading className="rp-q-text">
          <span className="ex-sr">{`Вопрос ${item.number}. `}</span>
          {glue(item.text)}
        </Heading>
        <p className="rp-verdict">
          <VerdictDot verdict={item.verdict} />
          {VERDICT_TITLES[item.verdict]}
        </p>
        {item.evidence.map((evidence, index) => (
          <figure key={`${evidence.materialId}:${evidence.fragment}:${index}`} className="rp-quote">
            <figcaption>{glue(evidenceCaption(evidence))}</figcaption>
            <blockquote>
              {evidence.heading && <span className="rp-quote-head">{evidence.heading}</span>}
              {evidence.body}
            </blockquote>
          </figure>
        ))}
        {item.note && (
          <div className="rp-gap">
            <p>{glue(item.note)}</p>
            {item.nearest && <p className="rp-fine">{glue(nearestSentence(item.nearest))}</p>}
          </div>
        )}
        {item.missing && (
          <p className="rp-missing">
            <span>Не хватает:</span> {glue(item.missing)}
          </p>
        )}
        {item.verdict !== 'none' && <Points item={item} />}
      </div>
      <div className="rp-q-mark" role="group" aria-label={`Пометка преподавателя к вопросу ${item.number}`}>
        <ul className="rp-marks">
          {['верно', 'неполно', 'ошибка'].map((word) => (
            <li key={word}>
              <span className="rp-box" aria-hidden="true" />
              {word}
            </li>
          ))}
        </ul>
        <p className="rp-cmt">Комментарий</p>
        <span className="rp-line" aria-hidden="true" />
        <span className="rp-line" aria-hidden="true" />
      </div>
    </li>
  );
}

function Points({ item }: { item: ReportItem }) {
  const { points } = item;
  if (points.kind !== 'written') {
    return <p className="rp-points-none">{glue(pointsNote(points))}</p>;
  }
  return (
    <div className="rp-points">
      <p className="rp-points-t">Пункты ответа</p>
      <ol>
        {points.points.map((point, index) => (
          <li key={index} data-main={point.main ? '' : undefined}>
            {glue(point.text)}
            {point.main && <span className="rp-main"> · главный</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
