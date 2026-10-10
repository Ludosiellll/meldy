import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  deleteContainer,
  deleteSubject,
  leaveContainer,
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
import { errorText, IMPORT, INVITE, nb, SETTINGS } from '../../components/containers/copyImport';
import { minutesLines } from '../../components/containers/import/minutesLines';
import { cleanDays, dayCount, dayOn, toggleDay } from '../../components/containers/weekdays';
import type { PlanInput, SummarySubject, Uuid } from '../../types/container';
import '../../components/exams/exams.css';
import '../../components/containers/import/import.css';
import './SettingsPage.css';

/**
 * /exams/c/:id/settings — the one «Настройки» of an exam (spec §16 #44, design critique I9): the name, the date (or a
 * date per subject), the minutes a day 30 / 45 / 60 / 90 with the plan's line under them — what they need to see every
 * question by the date, or what they reach when they fall short (Concept 2 §3.6, the design table; the exam page's
 * «Время в день» leads here) — the days of the week (Пн–Вс, at least one; spec §3), the subjects (rename, remove,
 * add), the group, and «Удалить экзамен», refused while members are in (MC009) until the author removes them. A member
 * sets only their own minutes and days; their way out is «Выйти из экзамена».
 *
 * Anchors for the exam page's «⋯»: #minutes («Время в день»), #subjects, #group, #delete; ?invite=1 opens
 * «Пригласить группу».
 */

const MINUTE_OPTIONS = [30, 45, 60, 90] as const;

const oralOnly = (subject: SummarySubject) => subject.keyed + subject.no_key === 0 && Boolean(subject.oral);

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
  const [lastDayTried, setLastDayTried] = useState(false);
  const [filled, setFilled] = useState<string | null>(null);
  useEffect(() => {
    if (!summary) return;
    const stamp = `${summary.id}:${summary.title}:${summary.exam_date}:${summary.settings.minutes_per_day}:${summary.settings.study_weekdays}:${summary.subjects.map((subject) => `${subject.id}=${subject.exam_date}`).join(',')}`;
    if (filled === stamp) return;
    setFilled(stamp);
    rememberContainerTitle(summary.id, summary.title);
    setTitle(summary.title);
    setDate(summary.exam_date ?? '');
    const own = summary.subjects.filter((subject) => !oralOnly(subject));
    const distinct = own.some((subject) => subject.exam_date && subject.exam_date !== summary.exam_date);
    setPerSubject((current) => current || distinct);
    setSubjectDates(Object.fromEntries(summary.subjects.map((subject) => [subject.id, subject.exam_date ?? ''])));
    setMinutes(summary.settings.minutes_per_day);
    setWeekdays(cleanDays(summary.settings.study_weekdays));
  }, [summary, filled]);

  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [nameTried, setNameTried] = useState(false);

  const subjects = summary?.subjects ?? [];
  const changedSubjects = subjects.filter(
    (subject) => !oralOnly(subject) && perSubject && (subjectDates[subject.id] ?? '') !== (subject.exam_date ?? ''),
  );
  // «Одна дата для всех»: a subject's own date would still win over the exam's (coalesce), so it is cleared.
  const ownDates = subjects.filter((subject) => !oralOnly(subject) && !perSubject && subject.exam_date && subject.exam_date !== (date || null));
  const dirty = Boolean(
    summary &&
      ((owner && title.trim() !== summary.title) ||
        (owner && !perSubject && date !== (summary.exam_date ?? '')) ||
        (owner && changedSubjects.length > 0) ||
        (owner && ownDates.length > 0) ||
        minutes !== summary.settings.minutes_per_day ||
        weekdays !== cleanDays(summary.settings.study_weekdays)),
  );

  // ── the minutes and the plan's line under them, for the dates as the form has them now ──
  const anyDate = perSubject ? subjects.some((subject) => subjectDates[subject.id] || summary?.exam_date) : Boolean(date);
  const liveInput = useMemo((): PlanInput | null => {
    if (!planInput || !summary) return null;
    return {
      ...planInput,
      subjects: planInput.subjects.map((entry) => {
        const subject = summary.subjects.find((candidate) => candidate.id === entry.id);
        // An oral-only subject keeps the date of its oral page; the rest take their own date or the exam's.
        if (!subject || oralOnly(subject)) return entry;
        const own = perSubject ? subjectDates[entry.id] || null : null;
        return { ...entry, date: own ?? (date || null) };
      }),
    };
  }, [planInput, summary, perSubject, subjectDates, date]);
  const lines = useMemo(() => minutesLines(liveInput, minutes), [liveInput, minutes]);
  const [moreOpen, setMoreOpen] = useState(false);

  // ── subjects ──
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [subjectError, setSubjectError] = useState<string | null>(null);

  // ── the group and deleting ──
  const [inviting, setInviting] = useState(() => search.get('invite') === '1');
  const [who, setWho] = useState(false);
  const [asking, setAsking] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const members = summary?.owner?.members ?? 0;
  const link = (summary?.owner?.links ?? [])
    .filter((entry) => !entry.revoked_at && (!entry.expires_at || Date.parse(entry.expires_at) > Date.now()))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  // Anchors from the exam page's «⋯».
  const anchor = location.hash.replace(/^#/, '');
  useEffect(() => {
    if (!summary || !anchor) return;
    const target = document.getElementById(`settings-${anchor}`);
    target?.scrollIntoView?.({ block: 'start' });
    if (anchor === 'minutes') minutesRef.current?.querySelector<HTMLElement>('button')?.focus();
    if (anchor === 'delete' && owner) setAsking(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(summary), anchor]);

  const save = async () => {
    if (!summary || saving) return;
    if (owner && !title.trim()) {
      setNameTried(true);
      document.getElementById(`${formId}-name`)?.focus();
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
      if (minutes !== summary.settings.minutes_per_day || daysChanged) {
        await saveSettings(containerId, { minutes_per_day: minutes, study_weekdays: weekdays });
        if (minutes !== summary.settings.minutes_per_day) track('container.minutes_set', { minutes });
        if (daysChanged) track('container.days_set', { days: dayCount(weekdays) });
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

  const rename = async (subject: SummarySubject) => {
    const next = renameText.trim();
    setSubjectError(null);
    if (!next || next === subject.title) {
      setRenaming(null);
      return;
    }
    try {
      await updateSubject(subject.id, { title: next });
      setRenaming(null);
      data.reload();
    } catch (error) {
      setSubjectError(errorText(error));
    }
  };
  const removeSubject = async (subject: SummarySubject) => {
    setSubjectError(null);
    try {
      await deleteSubject(subject.id);
      setRemoving(null);
      data.reload();
    } catch (error) {
      setSubjectError(errorText(error));
    }
  };

  const removeExam = async () => {
    setRemoveError(null);
    try {
      await deleteContainer(containerId);
      try {
        await forgetBank(containerId);
      } catch {
        // The device's copy of the questions goes when the next overview no longer lists the exam.
      }
      track('container.deleted', { subjects: subjects.length });
      navigate('/exams', { replace: true });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      setRemoveError(code === 'MC009' ? SETTINGS.hasMembers(Math.max(1, members)) : errorText(error));
    }
  };
  const leave = async () => {
    setRemoveError(null);
    try {
      await leaveContainer(containerId);
      navigate('/exams', { replace: true });
    } catch (error) {
      setRemoveError(errorText(error));
    }
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
        {data.loading ? null : (
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
          {minutesField}
          {daysField}
        </section>
        <section className="st-danger" id="settings-delete">
          {asking ? (
            <p className="st-line st-ask">
              <span>{SETTINGS.leaveAsk(summary.title)}</span>
              <button type="button" className="sf-link" onClick={() => void leave()}>
                {SETTINGS.leaveYes}
              </button>
              <button type="button" className="sf-link" data-muted="" onClick={() => setAsking(false)}>
                {SETTINGS.removeNo}
              </button>
            </p>
          ) : (
            <button type="button" className="sf-link" data-muted="" onClick={() => setAsking(true)}>
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
                    <span className="im-date-name">{subject.title}</span>
                    {oralOnly(subject) ? (
                      <span className="st-oral-date">{SETTINGS.oralDate}</span>
                    ) : (
                      <input
                        type="date"
                        className="im-input im-date"
                        aria-label={IMPORT.subjectDate(subject.title)}
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
            {subjects.length > 1 ? (
              <button type="button" className="sf-link im-dates-switch" data-muted="" onClick={() => setPerSubject((value) => !value)}>
                {perSubject ? SETTINGS.oneDate : SETTINGS.dates}
              </button>
            ) : null}
            {!anyDate ? <p className="im-hint" data-muted="">{nb(SETTINGS.noDate)}</p> : null}
          </div>
          {minutesField}
          {daysField}
        </section>

        <div className="st-side">
          <section className="st-subjects" id="settings-subjects" aria-labelledby={`${formId}-subjects`}>
            <h2 id={`${formId}-subjects`} className="st-h2">
              {SETTINGS.subjects}
            </h2>
            <ul className="st-rows">
              {subjects.map((subject) => (
                <li key={subject.id} className="st-row">
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
                        <button type="button" className="sf-link" data-muted="" onClick={() => setRenaming(null)}>
                          {SETTINGS.renameCancel}
                        </button>
                      </span>
                    </form>
                  ) : (
                    <>
                      <span className="st-row-t">
                        <span className="st-row-title">{subject.title}</span>
                        {subject.oral ? <span className="st-row-meta">{SETTINGS.oralRow}</span> : null}
                      </span>
                      <MoreMenu
                        variant="round"
                        label={SETTINGS.subjectMore(subject.title)}
                        items={[
                          {
                            key: 'rename',
                            label: SETTINGS.rename,
                            onSelect: () => {
                              setRenameText(subject.title);
                              setRenaming(subject.id);
                            },
                          },
                          { key: 'remove', label: SETTINGS.removeSubject, danger: true, onSelect: () => setRemoving(subject.id) },
                        ]}
                      />
                    </>
                  )}
                  {removing === subject.id ? (
                    subjects.length === 1 ? (
                      <p className="st-line st-ask">
                        <span>{SETTINGS.lastSubject}</span>
                        <button type="button" className="sf-link" data-muted="" onClick={() => setRemoving(null)}>
                          {SETTINGS.removeNo}
                        </button>
                      </p>
                    ) : (
                      <p className="st-line st-ask">
                        <span>
                          {subject.oral
                            ? oralOnly(subject)
                              ? SETTINGS.removeOralAsk(subject.title)
                              : SETTINGS.removeMixedAsk(subject.title)
                            : SETTINGS.removeSubjectAsk(subject.title)}
                        </span>
                        <button type="button" className="sf-link" onClick={() => void removeSubject(subject)}>
                          {SETTINGS.removeSubjectYes}
                        </button>
                        <button type="button" className="sf-link" data-muted="" onClick={() => setRemoving(null)}>
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
              {nb(link ? SETTINGS.joined(link.members, link.max_members) : SETTINGS.joined(members, null))}
              {members > 0 ? (
                <>
                  {' · '}
                  <button type="button" className="sf-link" aria-expanded={who} onClick={() => setWho((value) => !value)}>
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
                <p className="st-line st-ask">
                  <span>{nb(SETTINGS.hasMembers(members))}</span>
                  <button
                    type="button"
                    className="sf-link"
                    onClick={() => {
                      setWho(true);
                      window.setTimeout(() => document.getElementById('settings-group')?.scrollIntoView?.({ block: 'start' }), 0);
                    }}
                  >
                    {SETTINGS.who}
                  </button>
                  <button type="button" className="sf-link" data-muted="" onClick={() => setAsking(false)}>
                    {SETTINGS.removeNo}
                  </button>
                </p>
              ) : (
                <p className="st-line st-ask">
                  <span>{SETTINGS.removeAsk(summary.title, subjects.some((subject) => subject.oral))}</span>
                  <button type="button" className="sf-link" onClick={() => void removeExam()}>
                    {SETTINGS.removeYes}
                  </button>
                  <button type="button" className="sf-link" data-muted="" onClick={() => setAsking(false)}>
                    {SETTINGS.removeNo}
                  </button>
                </p>
              )
            ) : (
              <button type="button" className="sf-link" data-muted="" onClick={() => setAsking(true)}>
                {SETTINGS.remove}
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
