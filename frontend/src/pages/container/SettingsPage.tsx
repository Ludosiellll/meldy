import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  deleteContainer,
  deleteSubject,
  leaveContainer,
  moveExamDate,
  saveSettings,
  updateContainer,
  updateSubject,
} from '../../api/containers';
import { forgetBank } from '../../lib/containers/bankCache';
import { useContainerData } from '../../lib/containers/hooks';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { track } from '../../lib/telemetry';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useFrame } from '../../components/exams/useFrame';
import MoreMenu from '../../components/ui/MoreMenu';
import PaperSelect from '../../components/ui/PaperSelect';
import InviteExam from '../../components/containers/group/InviteExam';
import MembersList from '../../components/containers/group/MembersList';
import ExamTelegramSwitch from '../../components/telegram/ExamTelegramSwitch';
import KindSwitch from '../../components/containers/KindSwitch';
import { removeWords } from '../../components/containers/actions';
import { MOVE_MAX_DAYS, moveFacts } from '../../components/containers/MoveExamDialog';
import { addDay, dayDiff, isOwnTest } from '../../components/containers/model';
import { dayText, errorText, GONE, IMPORT, INVITE, MEMBERS, nb, SETTINGS } from '../../components/containers/copyImport';
import { ALL_QUESTIONS_MIN } from '../../lib/containers/plan';
import { examLeft, TO_EXAMS } from '../../components/containers/copy';
import { minutesLines } from '../../components/containers/import/minutesLines';
import { useFocusAfter } from '../../components/containers/useFocusAfter';
import { cleanDays, dayCount, dayOn, toggleDay } from '../../components/containers/weekdays';
import type { ContainerSummary, PlanInput, SummarySubject, Tempo, Uuid } from '../../types/container';
import '../../components/exams/exams.css';
import '../../components/containers/import/import.css';
import './SettingsPage.css';

/**
 * /exams/c/:id/settings — the one «Настройки» of an exam (spec §16 #44, design critique I9): the name, the date (or a
 * date per subject), the minutes a day 30 / 45 / 60 / 90 with the plan's line under them — what they need to see every
 * question by the date, or what they reach when they fall short (Concept 2 §3.6, the design table; the exam page's
 * «Время в день» leads here) — the days of the week (Пн–Вс, at least one; spec §3), the subjects (rename, remove,
 * add), the group, and «Удалить экзамен», refused while members are in (MC009) until the author removes them. A member
 * sets only their own minutes and days and «Моя дата экзамена» (release 47: their own date, the author's stays; the
 * author has it too after «Только для меня»); their way out is «Выйти из экзамена». With Telegram linked, both get «План
 * в Telegram по этому экзамену».
 *
 * Anchors for the exam page's «⋯»: #minutes («Время в день»), #subjects, #group, #delete (the author), #leave (a
 * member: the confirm opens); ?invite=1 opens «Пригласить группу», ?who=1 the members («Кто вошёл» of the page's
 * «Удалить» while members are in). The author's first field is «Это экзамен» / «Это тест» (release 47.3, KindSwitch:
 * saved as it is chosen); «Удалить» says the test's words for a test (removeWords, as the page's own confirm).
 *
 * Every inline confirm gives «Отмена» the focus when it opens and gives it back to the button that opened it when it
 * closes; a refusal is said in an alert (usability check m9).
 */

/** 30–90 minutes, then «Все вопросы» (no minutes cap). */
const MINUTE_OPTIONS = [30, 45, 60, 90, ALL_QUESTIONS_MIN] as const;
const TEMPO_OPTIONS: readonly Tempo[] = ['date', 'fast'];

const oralOnly = (subject: SummarySubject) => subject.keyed + subject.no_key === 0 && Boolean(subject.oral);
/** Errors of «Моя дата экзамена»: the server's 22023 is the date out of range. */
const OWN_DATE_ERRORS: Record<string, string> = { '22023': SETTINGS.ownDateRange };

/**
 * The exam's common date as the author set it. While the caller (the author, after «Только для меня») has an own date,
 * the summary's dates are that date: the author's comes in `author_exam_date`, and the subjects' own dates are not
 * known here, so the form keeps to the common one.
 */
function commonDateOf(summary: ContainerSummary): string | null {
  if (summary.own_exam_date && summary.author_exam_date !== undefined) return summary.author_exam_date;
  return summary.exam_date;
}

export default function SettingsPage() {
  const params = useParams();
  const containerId = (params.id ?? '') as Uuid;
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const frame = useFrame<HTMLDivElement>();
  const data = useContainerData(containerId);
  const summary = data.data?.summary ?? null;
  const planInput = data.data?.planInput ?? null;
  const owner = summary?.role === 'owner';
  // The author's own date stands in for every date of the summary (see commonDateOf).
  const ownOverrides = Boolean(owner && summary?.own_exam_date);
  // «Моя дата экзамена»: always for a member; for the author only while they have one.
  const showOwn = Boolean(summary && (!owner || summary.own_exam_date));
  // The author's own test (release 47.3): no plan of their own, so no minutes, days or Telegram plan here.
  const ownTest = isOwnTest(summary);
  useDocumentTitle(summary ? `${SETTINGS.title} · ${summary.title}` : SETTINGS.docTitle);
  const formId = useId();
  const minutesRef = useRef<HTMLDivElement>(null);

  // ── the form, filled from the summary once it arrives ──
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [perSubject, setPerSubject] = useState(false);
  const [subjectDates, setSubjectDates] = useState<Record<string, string>>({});
  const [minutes, setMinutes] = useState(60);
  const [weekdays, setWeekdays] = useState(127);
  const [tempo, setTempo] = useState<Tempo>('date');
  const [lastDayTried, setLastDayTried] = useState(false);
  const [ownDate, setOwnDate] = useState('');
  const [ownBusy, setOwnBusy] = useState(false);
  const [filled, setFilled] = useState<string | null>(null);
  useEffect(() => {
    if (!summary) return;
    const stamp = `${summary.id}:${summary.title}:${summary.exam_date}:${summary.own_exam_date ?? ''}:${summary.author_exam_date ?? ''}:${summary.settings.minutes_per_day}:${summary.settings.study_weekdays}:${summary.settings.tempo ?? 'date'}:${summary.subjects.map((subject) => `${subject.id}=${subject.exam_date}`).join(',')}`;
    if (filled === stamp) return;
    setFilled(stamp);
    rememberContainerTitle(summary.id, summary.title);
    setTitle(summary.title);
    const common = commonDateOf(summary);
    setDate(common ?? '');
    setOwnDate(summary.own_exam_date ?? '');
    const own = summary.subjects.filter((subject) => !oralOnly(subject));
    const distinct = !(summary.role === 'owner' && summary.own_exam_date) && own.some((subject) => subject.exam_date && subject.exam_date !== common);
    setPerSubject((current) => current || distinct);
    setSubjectDates(Object.fromEntries(summary.subjects.map((subject) => [subject.id, subject.exam_date ?? ''])));
    setMinutes(summary.settings.minutes_per_day);
    setWeekdays(cleanDays(summary.settings.study_weekdays));
    setTempo(summary.settings.tempo === 'fast' ? 'fast' : 'date');
  }, [summary, filled]);

  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [nameTried, setNameTried] = useState(false);

  const subjects = summary?.subjects ?? [];
  const changedSubjects = subjects.filter(
    (subject) => !ownOverrides && !oralOnly(subject) && perSubject && (subjectDates[subject.id] ?? '') !== (subject.exam_date ?? ''),
  );
  // «Одна дата для всех»: a subject's own date would still win over the exam's (coalesce), so it is cleared. (Not while
  // the author's own date stands in for the subjects' dates: they are not known here.)
  const ownDates = ownOverrides ? [] : subjects.filter((subject) => !oralOnly(subject) && !perSubject && subject.exam_date && subject.exam_date !== (date || null));
  const ownChanged = Boolean(summary && showOwn && ownDate !== (summary.own_exam_date ?? ''));
  const today = summary?.day ?? '';
  const dirty = Boolean(
    summary &&
      ((owner && title.trim() !== summary.title) ||
        (owner && !perSubject && date !== (commonDateOf(summary) ?? '')) ||
        ownChanged ||
        (owner && changedSubjects.length > 0) ||
        (owner && ownDates.length > 0) ||
        minutes !== summary.settings.minutes_per_day ||
        weekdays !== cleanDays(summary.settings.study_weekdays) ||
        tempo !== (summary.settings.tempo === 'fast' ? 'fast' : 'date')),
  );

  // ── the minutes and the plan's line under them, for the dates and the days of the week as the form has them now ──
  const anyDate = perSubject ? subjects.some((subject) => subjectDates[subject.id] || summary?.exam_date) : Boolean(date);
  const liveInput = useMemo((): PlanInput | null => {
    if (!planInput || !summary) return null;
    return {
      ...planInput,
      studyWeekdays: weekdays,
      subjects: planInput.subjects.map((entry) => {
        const subject = summary.subjects.find((candidate) => candidate.id === entry.id);
        // An oral-only subject keeps the date of its oral page; the rest take their own date or the exam's.
        if (!subject || oralOnly(subject)) return entry;
        // «Моя дата экзамена» stands for every subject's date (the server's effective date, 20261018120000).
        if (showOwn && ownDate) return { ...entry, date: ownDate };
        const own = perSubject ? subjectDates[entry.id] || null : null;
        return { ...entry, date: own ?? (date || null) };
      }),
    };
  }, [planInput, summary, perSubject, subjectDates, date, weekdays, showOwn, ownDate]);
  const lines = useMemo(() => minutesLines(liveInput, minutes, tempo), [liveInput, minutes, tempo]);
  const [moreOpen, setMoreOpen] = useState(false);

  const focusAfter = useFocusAfter();

  // ── subjects ──
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [subjectBusy, setSubjectBusy] = useState(false);
  const subjectsRef = useRef<HTMLHeadingElement>(null);
  const rowsRef = useRef<HTMLUListElement>(null);
  // A new name stays on screen while the summary is read again (usability check n2: the old one came back for a moment):
  // the names given since this summary arrived; the next summary has them.
  const [renamed, setRenamed] = useState<{ from: ContainerSummary; titles: Record<string, string> } | null>(null);
  const titleOf = (subject: SummarySubject) => (renamed && renamed.from === summary ? renamed.titles[subject.id] : undefined) ?? subject.title;

  // ── the group and deleting ──
  const [inviting, setInviting] = useState(() => search.get('invite') === '1');
  const [who, setWho] = useState(() => search.get('who') === '1');
  const [asking, setAsking] = useState(false);
  const [acting, setActing] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // The database refused «Удалить экзамен» (MC009) while this summary had nobody in: someone joined since. Until the
  // summary is read again at least one member is in (usability check m8).
  const [refusedAt, setRefusedAt] = useState<ContainerSummary | null>(null);
  const refused = refusedAt !== null && refusedAt === summary;
  const members = refused ? Math.max(1, summary?.owner?.members ?? 0) : summary?.owner?.members ?? 0;
  // Anyone ever in: a seat taken through any link, closed ones too (a rejoin takes none). «Кто вошёл» then stays, so a
  // removed member can be returned when nobody is left (usability check M1).
  const everJoined = members > 0 || (summary?.owner?.links ?? []).some((entry) => entry.members > 0);
  const askRef = useRef<HTMLButtonElement>(null);
  const askNoRef = useRef<HTMLButtonElement>(null);
  const whoRef = useRef<HTMLButtonElement>(null);

  const openAsk = () => {
    setAsking(true);
    focusAfter(() => askNoRef.current);
  };
  const closeAsk = () => {
    setAsking(false);
    focusAfter(() => askRef.current);
  };

  // Anchors from the exam page's «⋯».
  const anchor = location.hash.replace(/^#/, '');
  useEffect(() => {
    if (!summary || !anchor) return;
    const target = document.getElementById(`settings-${anchor}`);
    target?.scrollIntoView?.({ block: 'start' });
    if (anchor === 'minutes') minutesRef.current?.querySelector<HTMLElement>('button')?.focus();
    if ((anchor === 'delete' && owner) || (anchor === 'leave' && !owner)) openAsk();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(summary), anchor]);

  /** A date of «Моя дата экзамена» the server takes (today to two years ahead), else what is wrong with it. */
  const ownDateProblem = (value: string): string | null => {
    if (!value || !today) return null;
    const ahead = dayDiff(today, value);
    if (ahead === null || ahead > MOVE_MAX_DAYS) return SETTINGS.ownDateRange;
    if (ahead < 0) return SETTINGS.ownDatePast;
    return null;
  };

  const save = async () => {
    if (!summary || saving) return;
    if (owner && !title.trim()) {
      setNameTried(true);
      document.getElementById(`${formId}-name`)?.focus();
      return;
    }
    const ownProblem = ownChanged ? ownDateProblem(ownDate) : null;
    if (ownProblem) {
      setNote({ text: ownProblem, error: true });
      document.getElementById(`${formId}-own`)?.focus();
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      if (owner) {
        const patch: { title?: string; exam_date?: string | null } = {};
        if (title.trim() !== summary.title) patch.title = title.trim();
        if (!perSubject && date !== (summary.exam_date ?? '')) patch.exam_date = date || null;
        if (Object.keys(patch).length > 0) await updateContainer(containerId, patch);
        for (const subject of changedSubjects) {
          await updateSubject(subject.id, { exam_date: subjectDates[subject.id] || null });
        }
        for (const subject of ownDates) {
          await updateSubject(subject.id, { exam_date: null });
        }
      }
      // The minutes and the days are one row of the user's own (container_plans): saved together.
      const daysChanged = weekdays !== cleanDays(summary.settings.study_weekdays);
      const tempoChanged = tempo !== (summary.settings.tempo === 'fast' ? 'fast' : 'date');
      if (minutes !== summary.settings.minutes_per_day || daysChanged || tempoChanged) {
        await saveSettings(containerId, { minutes_per_day: minutes, study_weekdays: weekdays, tempo });
        if (minutes !== summary.settings.minutes_per_day) track('container.minutes_set', { minutes });
        if (tempoChanged) track('container.tempo_set', { tempo });
        if (daysChanged) track('container.days_set', { days: dayCount(weekdays) });
      }
      if (ownChanged) {
        try {
          await moveExamDate(containerId, ownDate || null, 'me');
        } catch (error) {
          setNote({ text: errorText(error, OWN_DATE_ERRORS), error: true });
          data.reload();
          return;
        }
      }
      if (owner) rememberContainerTitle(containerId, title.trim());
      setNote({ text: SETTINGS.saved });
      data.reload();
    } catch (error) {
      setNote({ text: errorText(error), error: true });
    } finally {
      setSaving(false);
    }
  };

  /** The «⋯» of a subject's row: the focus goes back to it when its rename or its confirm closes. */
  const rowMenu = (subjectId: string) =>
    Array.from(rowsRef.current?.querySelectorAll<HTMLElement>('.st-row') ?? [])
      .find((row) => row.dataset.subject === subjectId)
      ?.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
  const closeRename = (subjectId: string) => {
    setRenaming(null);
    focusAfter(() => rowMenu(subjectId));
  };
  const askRemove = (subjectId: string) => {
    setRemoving(subjectId);
    focusAfter(() => document.getElementById(`${formId}-no-${subjectId}`));
  };
  const keepSubject = (subjectId: string) => {
    setRemoving(null);
    focusAfter(() => rowMenu(subjectId));
  };

  const rename = async (subject: SummarySubject) => {
    if (subjectBusy) return;
    const next = renameText.trim();
    setSubjectError(null);
    if (!next || next === titleOf(subject)) {
      closeRename(subject.id);
      return;
    }
    setSubjectBusy(true);
    try {
      await updateSubject(subject.id, { title: next });
      const from = summary;
      if (from) setRenamed((current) => ({ from, titles: { ...(current?.from === from ? current.titles : {}), [subject.id]: next } }));
      closeRename(subject.id);
      data.reload();
    } catch (error) {
      setSubjectError(errorText(error));
    } finally {
      setSubjectBusy(false);
    }
  };
  const removeSubject = async (subject: SummarySubject) => {
    if (subjectBusy) return;
    setSubjectBusy(true);
    setSubjectError(null);
    try {
      await deleteSubject(subject.id);
      setRemoving(null);
      // The row goes with the next summary: the focus waits on the heading of the list.
      focusAfter(() => subjectsRef.current);
      data.reload();
    } catch (error) {
      setSubjectError(errorText(error));
    } finally {
      setSubjectBusy(false);
    }
  };

  const removeExam = async () => {
    if (acting) return;
    setActing(true);
    setRemoveError(null);
    try {
      await deleteContainer(containerId);
      try {
        await forgetBank(containerId);
      } catch {
        // The device's copy of the questions goes when the next overview no longer lists the exam.
      }
      track('container.deleted', { subjects: subjects.length });
      navigate('/exams', { replace: true, state: summary ? { notice: removeWords(summary).done } : null });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'MC009') {
        // The confirm turns into the members' one (its words, «Кто вошёл», «Отмена»), and the group is read again.
        setRefusedAt(summary);
        focusAfter(() => askNoRef.current);
        data.reload();
      } else setRemoveError(errorText(error));
    } finally {
      setActing(false);
    }
  };
  const leave = async () => {
    if (acting) return;
    setActing(true);
    setRemoveError(null);
    try {
      await leaveContainer(containerId);
      navigate('/exams', { replace: true, state: summary ? { notice: examLeft(summary.title) } : null });
    } catch (error) {
      setRemoveError(errorText(error));
    } finally {
      setActing(false);
    }
  };
  /** «Убрать»: the own date goes at once; the plan takes the author's date again. */
  const clearOwn = async () => {
    if (ownBusy || saving) return;
    setOwnBusy(true);
    setNote(null);
    try {
      await moveExamDate(containerId, null, 'me');
      setOwnDate('');
      setNote({ text: SETTINGS.ownDateCleared });
      // The field stays where the focus was (the button leaves with the date).
      focusAfter(() => document.getElementById(`${formId}-own`));
      data.reload();
    } catch (error) {
      setNote({ text: errorText(error, OWN_DATE_ERRORS), error: true });
    } finally {
      setOwnBusy(false);
    }
  };

  const showWho = () => {
    setWho(true);
    focusAfter(() => whoRef.current);
    window.setTimeout(() => document.getElementById('settings-group')?.scrollIntoView?.({ block: 'start' }), 0);
  };

  // ───────────────────────────── render ─────────────────────────────

  const header = (
    <header className="ex-head st-head">
      <div style={{ minWidth: 0 }}>
        {summary ? (
          <p className="ex-crumb">
            <Link to={`/exams/c/${containerId}`}>{summary.title}</Link>
          </p>
        ) : null}
        <h1 className="ex-h1">{SETTINGS.title}</h1>
      </div>
    </header>
  );

  if (!summary) {
    return (
      <div className="sf-page st-page" ref={frame.ref} data-frame={frame.size}>
        {header}
        {data.loading ? null : data.gone ? (
          // Not the user's any more (deleted, left, removed): another try changes nothing (usability check m2).
          <p className="ex-note">
            {GONE.title}. {GONE.text}{' '}
            <Link className="sf-link" to="/exams">
              {TO_EXAMS}
            </Link>
          </p>
        ) : (
          <p className="ex-note" role="alert">
            {data.error && /[а-яё]/i.test(data.error) ? data.error : SETTINGS.loadFailed}{' '}
            <button type="button" className="sf-link" onClick={data.reload}>
              {SETTINGS.retry}
            </button>
          </p>
        )}
      </div>
    );
  }

  const minutesField = (
    <div className="im-field" id="settings-minutes" ref={minutesRef}>
      <span className="im-label">{SETTINGS.minutes}</span>
      <PaperSelect
        ariaLabel={SETTINGS.minutes}
        value={minutes}
        options={MINUTE_OPTIONS.map((value) => ({ value, label: IMPORT.minuteOption(value) }))}
        onChange={(value) => setMinutes(value)}
        disabled={saving}
      />
      <span className="im-label im-tempo-label">{IMPORT.tempo}</span>
      <PaperSelect
        ariaLabel={IMPORT.tempo}
        value={tempo}
        options={TEMPO_OPTIONS.map((value) => ({ value, label: IMPORT.tempoOption(value) }))}
        onChange={(value) => setTempo(value)}
        disabled={saving}
      />
      {lines ? (
        <p className="im-hint">
          {nb(lines.line)}
          {lines.window ? (
            <>
              {' '}
              <button type="button" className="sf-link" data-muted="" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
                {SETTINGS.more}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {lines?.window && moreOpen ? <p className="im-hint" data-muted="">{nb(lines.window)}</p> : null}
      {!owner ? <p className="im-hint" data-muted="">{SETTINGS.minutesMember}</p> : null}
    </div>
  );

  // «Моя дата экзамена»: the member's own date (the author's after «Только для меня»), «Убрать», and whose date stays.
  const authorDay = dayText(owner ? commonDateOf(summary) : moveFacts(summary).authorDate);
  const ownField = showOwn ? (
    <div className="im-field" id="settings-own-date">
      <label className="im-label" htmlFor={`${formId}-own`}>
        {SETTINGS.ownDate}
      </label>
      <div className="st-own">
        <input
          id={`${formId}-own`}
          type="date"
          className="im-input im-date"
          value={ownDate}
          min={today || undefined}
          max={today ? addDay(today, MOVE_MAX_DAYS) : undefined}
          aria-describedby={`${formId}-own-note`}
          aria-invalid={note?.error && ownDateProblem(ownDate) ? true : undefined}
          disabled={saving}
          onChange={(event) => setOwnDate(event.target.value)}
        />
        {summary.own_exam_date ? (
          <button type="button" className="sf-link" data-muted="" aria-busy={ownBusy || undefined} onClick={() => void clearOwn()}>
            {SETTINGS.ownDateClear}
          </button>
        ) : null}
      </div>
      <p className="im-hint" data-muted="" id={`${formId}-own-note`}>
        {nb(owner ? SETTINGS.ownDateNoteOwner(authorDay) : SETTINGS.ownDateNote(authorDay))}
      </p>
    </div>
  ) : null;

  // Пн–Вс, each a toggle; the last day on stays on (the plan needs a day to study in).
  const daysField = (
    <div className="im-field st-days-field" id="settings-days">
      <span className="im-label" id={`${formId}-days`}>
        {SETTINGS.days}
      </span>
      <div className="st-days" role="group" aria-labelledby={`${formId}-days`}>
        {SETTINGS.dayShort.map((short, day) => {
          const on = dayOn(weekdays, day);
          const last = on && dayCount(weekdays) === 1;
          return (
            <button
              key={short}
              type="button"
              className="st-day"
              aria-pressed={on}
              aria-disabled={last || undefined}
              disabled={saving}
              onClick={() => {
                const next = toggleDay(weekdays, day);
                setLastDayTried(next === null);
                if (next !== null) setWeekdays(next);
              }}
            >
              <span aria-hidden="true">{short}</span>
              <span className="sr-only">{SETTINGS.dayFull[day]}</span>
            </button>
          );
        })}
      </div>
      {lastDayTried ? (
        <p className="im-hint" data-muted="" role="status">
          {SETTINGS.daysLeast}
        </p>
      ) : null}
    </div>
  );

  const bar = !dirty && !note && !nameTried ? null : (
    <div className="ex-cta st-cta" data-row={frame.side ? '' : undefined}>
      {note ? (
        <p className="ex-cta-why" role={note.error ? 'alert' : 'status'}>
          {note.text}
        </p>
      ) : nameTried && !title.trim() ? (
        <p className="ex-cta-why">{SETTINGS.nameMissing}</p>
      ) : null}
      {dirty || saving ? (
        <button type="button" className="sf-primary" disabled={saving} onClick={() => void save()}>
          {saving ? SETTINGS.saving : SETTINGS.save}
        </button>
      ) : null}
    </div>
  );

  if (!owner) {
    return (
      <div className="sf-page st-page" ref={frame.ref} data-frame={frame.size}>
        {header}
        <section className="st-form">
          {ownField}
          {minutesField}
          {daysField}
          <ExamTelegramSwitch containerId={containerId} />
        </section>
        <section className="st-danger" id="settings-leave">
          {asking ? (
            <p className="st-line st-ask" role="group" aria-labelledby={`${formId}-ask`}>
              <span id={`${formId}-ask`}>{SETTINGS.leaveAsk(summary.title)}</span>
              <button type="button" className="sf-link" onClick={() => void leave()}>
                {SETTINGS.leaveYes}
              </button>
              <button ref={askNoRef} type="button" className="sf-link" data-muted="" onClick={closeAsk}>
                {SETTINGS.removeNo}
              </button>
            </p>
          ) : (
            <button ref={askRef} type="button" className="sf-link" data-muted="" onClick={openAsk}>
              {SETTINGS.leave}
            </button>
          )}
          {removeError ? (
            <p className="st-line" role="alert">
              {removeError}
            </p>
          ) : null}
        </section>
        {bar}
      </div>
    );
  }

  return (
    <div className="sf-page st-page" ref={frame.ref} data-frame={frame.size}>
      {header}
      <div className="st-body" data-side={frame.side ? '' : undefined}>
        <section className="st-form" aria-label={SETTINGS.title}>
          {summary.kind ? <KindSwitch containerId={containerId} kind={summary.kind} onSaved={() => data.reload()} /> : null}
          <div className="im-field">
            <label className="im-label" htmlFor={`${formId}-name`}>
              {SETTINGS.name}
            </label>
            <input
              id={`${formId}-name`}
              className="im-input"
              value={title}
              maxLength={200}
              aria-invalid={nameTried && !title.trim() ? true : undefined}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="im-field">
            {perSubject ? (
              <fieldset className="im-dates">
                <legend className="im-label">{SETTINGS.date}</legend>
                {subjects.map((subject) => (
                  <div key={subject.id} className="im-date-row">
                    <span className="im-date-name">{titleOf(subject)}</span>
                    {oralOnly(subject) ? (
                      <span className="st-oral-date">{SETTINGS.oralDate}</span>
                    ) : (
                      <input
                        type="date"
                        className="im-input im-date"
                        aria-label={IMPORT.subjectDate(titleOf(subject))}
                        value={subjectDates[subject.id] ?? ''}
                        onChange={(event) => setSubjectDates((current) => ({ ...current, [subject.id]: event.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </fieldset>
            ) : (
              <>
                <label className="im-label" htmlFor={`${formId}-date`}>
                  {SETTINGS.date}
                </label>
                <input id={`${formId}-date`} type="date" className="im-input im-date" value={date} onChange={(event) => setDate(event.target.value)} />
              </>
            )}
            {subjects.length > 1 && !ownOverrides ? (
              <button type="button" className="sf-link im-dates-switch" data-muted="" onClick={() => setPerSubject((value) => !value)}>
                {perSubject ? SETTINGS.oneDate : SETTINGS.dates}
              </button>
            ) : null}
            {!anyDate && tempo !== 'fast' && !ownTest ? <p className="im-hint" data-muted="">{nb(SETTINGS.noDate)}</p> : null}
          </div>
          {/* The author of a test does not study it (release 47.3): no plan of their own to set here; the date stays —
              the members' plans count to it. «Это экзамен» brings the plan back. */}
          {ownTest ? null : (
            <>
              {ownField}
              {minutesField}
              {daysField}
              <ExamTelegramSwitch containerId={containerId} />
            </>
          )}
        </section>

        <div className="st-side">
          <section className="st-subjects" id="settings-subjects" aria-labelledby={`${formId}-subjects`}>
            <h2 id={`${formId}-subjects`} ref={subjectsRef} className="st-h2" tabIndex={-1}>
              {SETTINGS.subjects}
            </h2>
            <ul className="st-rows" ref={rowsRef}>
              {subjects.map((subject) => (
                <li key={subject.id} className="st-row" data-subject={subject.id}>
                  {renaming === subject.id ? (
                    <form
                      className="st-rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void rename(subject);
                      }}
                    >
                      <input
                        className="im-input"
                        aria-label={SETTINGS.rename}
                        value={renameText}
                        maxLength={200}
                        autoFocus
                        onChange={(event) => setRenameText(event.target.value)}
                      />
                      <span className="st-rename-acts">
                        <button type="submit" className="im-small">
                          {SETTINGS.renameDone}
                        </button>
                        <button type="button" className="sf-link" data-muted="" onClick={() => closeRename(subject.id)}>
                          {SETTINGS.renameCancel}
                        </button>
                      </span>
                    </form>
                  ) : (
                    <>
                      <span className="st-row-t">
                        <span className="st-row-title">{titleOf(subject)}</span>
                        {subject.oral ? <span className="st-row-meta">{SETTINGS.oralRow}</span> : null}
                      </span>
                      <MoreMenu
                        variant="round"
                        label={SETTINGS.subjectMore(titleOf(subject))}
                        items={[
                          {
                            key: 'rename',
                            label: SETTINGS.rename,
                            onSelect: () => {
                              setRenameText(titleOf(subject));
                              setRenaming(subject.id);
                            },
                          },
                          { key: 'remove', label: SETTINGS.removeSubject, danger: true, onSelect: () => askRemove(subject.id) },
                        ]}
                      />
                    </>
                  )}
                  {removing === subject.id ? (
                    subjects.length === 1 ? (
                      <p className="st-line st-ask" role="group" aria-labelledby={`${formId}-ask-${subject.id}`}>
                        <span id={`${formId}-ask-${subject.id}`}>{SETTINGS.lastSubject}</span>
                        <button id={`${formId}-no-${subject.id}`} type="button" className="sf-link" data-muted="" onClick={() => keepSubject(subject.id)}>
                          {SETTINGS.removeNo}
                        </button>
                      </p>
                    ) : (
                      <p className="st-line st-ask" role="group" aria-labelledby={`${formId}-ask-${subject.id}`}>
                        <span id={`${formId}-ask-${subject.id}`}>
                          {subject.oral
                            ? oralOnly(subject)
                              ? SETTINGS.removeOralAsk(titleOf(subject))
                              : SETTINGS.removeMixedAsk(titleOf(subject))
                            : SETTINGS.removeSubjectAsk(titleOf(subject))}
                        </span>
                        <button type="button" className="sf-link" onClick={() => void removeSubject(subject)}>
                          {SETTINGS.removeSubjectYes}
                        </button>
                        <button id={`${formId}-no-${subject.id}`} type="button" className="sf-link" data-muted="" onClick={() => keepSubject(subject.id)}>
                          {SETTINGS.removeNo}
                        </button>
                      </p>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
            {subjectError ? (
              <p className="st-line" role="alert">
                {subjectError}
              </p>
            ) : null}
            <p className="st-line">
              <Link className="sf-link" to={`/exams/import?from=c:${containerId}`}>
                {SETTINGS.addSubject}
              </Link>
            </p>
          </section>

          <section className="st-group" id="settings-group" aria-labelledby={`${formId}-group`}>
            <h2 id={`${formId}-group`} className="st-h2">
              {SETTINGS.group}
            </h2>
            <p className="st-line">
              {nb(MEMBERS.inExam(members, everJoined))}
              {everJoined ? (
                <>
                  {' · '}
                  <button ref={whoRef} type="button" className="sf-link" aria-expanded={who} onClick={() => setWho((value) => !value)}>
                    {SETTINGS.who}
                  </button>
                </>
              ) : null}
            </p>
            {who ? <MembersList containerId={containerId} onChanged={() => data.reload()} /> : null}
            <p className="st-line">
              <button type="button" className="sf-link" onClick={() => setInviting(true)}>
                {INVITE.title}
              </button>
            </p>
          </section>

          <section className="st-danger" id="settings-delete">
            {asking ? (
              members > 0 ? (
                <p key="members" className="st-line st-ask">
                  <span role="alert">{nb(SETTINGS.hasMembers(members))}</span>
                  <button type="button" className="sf-link" onClick={showWho}>
                    {SETTINGS.who}
                  </button>
                  <button ref={askNoRef} type="button" className="sf-link" data-muted="" onClick={closeAsk}>
                    {SETTINGS.removeNo}
                  </button>
                </p>
              ) : (
                <p key="ask" className="st-line st-ask" role="group" aria-labelledby={`${formId}-ask`}>
                  <span id={`${formId}-ask`}>{removeWords(summary).ask}</span>
                  <button type="button" className="sf-link" onClick={() => void removeExam()}>
                    {removeWords(summary).yes}
                  </button>
                  <button ref={askNoRef} type="button" className="sf-link" data-muted="" onClick={closeAsk}>
                    {SETTINGS.removeNo}
                  </button>
                </p>
              )
            ) : (
              <button ref={askRef} type="button" className="sf-link" data-muted="" onClick={openAsk}>
                {removeWords(summary).title}
              </button>
            )}
            {removeError ? (
              <p className="st-line" role="alert">
                {removeError}
              </p>
            ) : null}
          </section>
        </div>
      </div>
      {bar}
      {inviting ? (
        <InviteExam
          summary={summary}
          onClose={() => {
            setInviting(false);
            if (search.get('invite')) {
              const next = new URLSearchParams(search);
              next.delete('invite');
              setSearch(next, { replace: true });
            }
          }}
          onChanged={() => data.reload()}
        />
      ) : null}
    </div>
  );
}
