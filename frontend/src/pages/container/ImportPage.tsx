import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { deferGuideOnce } from '../../components/guide/guideLater';
import { useContainerData, useContainersOverview } from '../../lib/containers/hooks';
import { loadOralPlanItems } from '../../lib/containers/oralPlan';
import { addSubject } from '../../api/containers';
import { track } from '../../lib/telemetry';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { usePhone } from '../../lib/usePhone';
import { useFrame } from '../../components/exams/useFrame';
import PaperSelect from '../../components/ui/PaperSelect';
import type { BankParseResult, PlanItem, TestItem, Uuid } from '../../types/container';
import { dayText, errorText, IMPORT, nb, SETTINGS } from '../../components/containers/copyImport';
import FilePick, { AddFileLink, platformOf } from '../../components/containers/import/FilePick';
import ImportQueue from '../../components/containers/import/ImportQueue';
import KeySource from '../../components/containers/import/KeySource';
import ReadingList, { type ReadingRow } from '../../components/containers/import/ReadingList';
import SubjectDetail from '../../components/containers/import/SubjectDetail';
import SubjectRows from '../../components/containers/import/SubjectRows';
import UpdatePreview from '../../components/containers/import/UpdatePreview';
import { fetchOldExams, ownContainers, plainExams, targetOptions as targetOptionsOf, type OldExam } from '../../components/containers/import/targets';
import {
  activeSubjects,
  deriveSubjects,
  draftPlanInput,
  isSingleOralList,
  ITEMS_CAP,
  newImportId,
  NO_EDITS,
  queueOf,
  spotCheck,
  SUBJECTS_CAP,
  totalsOf,
  type FileFormat,
  type FileSource,
  type ImportEdits,
  type ImportFile,
  type ItemFix,
  type KeySignal,
} from '../../components/containers/import/importModel';
import { minutesLines } from '../../components/containers/import/minutesLines';
import { readBank, ReadError } from '../../components/containers/import/readFiles';
import { useTelegramFile } from '../../lib/telegram/fileTicket';
import {
  freshSaveState,
  saveImport,
  saveStarted,
  saveUpdate,
  type SaveProgress,
  type SaveState,
  type SaveTarget,
} from '../../components/containers/import/saveImport';
import { bestSource, planUpdate, updateItemInputs, updateSources } from '../../components/containers/import/updateModel';
import '../../components/exams/exams.css';
import '../../components/containers/import/import.css';
import './ImportPage.css';

/**
 * /exams/import — one door for every file (spec decision 21; Concept 1 §3.2 with spec v2.2 and both critiques):
 * files → reading → preview → problems → save. Several files at once (one per subject or one for all), pasted text,
 * a PDF read as a list without variants. The preview goes by subject; «Проверить» opens the problem queue, which never
 * blocks saving — only a missing name does. A single oral list becomes today's oral exam and goes on to its lectures;
 * everything else becomes one exam with subjects (or joins one: ?from=c:<id>, «Куда добавить»).
 *
 * «Обновить из файла» (?from=c:<id>&subject=<id>, Concept 1 §3.4): a newer file of one subject. Only its new questions
 * with variants are added; the ones already there stay as they are, keys included — a key that differs in the file is
 * listed by number and changes only in «Ключи» (updateModel.ts).
 *
 * The mandatory first run of the guide waits here (decision 25): deferGuideOnce() runs when this file loads on this
 * address and again as the page first renders, before the guide can open over a student who came to load a file.
 */

const IMPORT_PATH = /^\/exams\/(?:import|new)\/?$/;
if (typeof window !== 'undefined' && IMPORT_PATH.test(window.location.pathname)) deferGuideOnce();

const CONTAINER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MINUTE_OPTIONS = [30, 45, 60, 90] as const;
const READ_AT_ONCE = 2;

interface Entry {
  id: string;
  name: string;
  file: File | null;
  text: string | null;
  source: FileSource;
  format: FileFormat;
  keyText: string;
  importId: string;
  status: 'reading' | 'done' | 'failed';
  result: BankParseResult | null;
  pdf: boolean;
  error: string | null;
  errorCode: string | null;
}

interface FormState {
  target: string;
  title: string;
  titleTouched: boolean;
  date: string;
  dateTouched: boolean;
  perSubject: boolean;
  minutes: number | null;
}

type View = { kind: 'main' } | { kind: 'subject'; key: string } | { kind: 'check' } | { kind: 'key'; fileId: string; paste: boolean };

function viewOf(hash: string): View {
  const value = decodeURIComponent(hash.replace(/^#/, ''));
  if (value === 'check') return { kind: 'check' };
  if (value.startsWith('s=')) return { kind: 'subject', key: value.slice(2) };
  if (value.startsWith('key=')) {
    const [fileId, flag] = value.slice(4).split('&');
    return { kind: 'key', fileId, paste: flag === 'paste' };
  }
  return { kind: 'main' };
}

function localDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Minsk';
  } catch {
    return 'Europe/Minsk';
  }
}

let entrySeq = 0;

export default function ImportPage() {
  // Synchronously, before the shell's guide can open (spec decision 25).
  useState(() => {
    deferGuideOnce();
    return null;
  });
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const phone = usePhone();
  const frame = useFrame<HTMLDivElement>();
  const overview = useContainersOverview();
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const fromRaw = search.get('from') ?? '';
  const fromId = fromRaw.startsWith('c:') && CONTAINER_ID.test(fromRaw.slice(2)) ? fromRaw.slice(2) : null;
  const containers = useMemo(() => ownContainers(overview.data), [overview.data]);
  const fromContainer = fromId ? containers.find((container) => container.id === fromId) ?? null : null;
  const fromTitle = fromContainer?.title ?? null;
  // «Обновить из файла»: the subject and its saved questions, to compare the file with.
  const subjectRaw = search.get('subject') ?? '';
  const updateId = fromId && CONTAINER_ID.test(subjectRaw) ? subjectRaw : null;
  const updateData = useContainerData((updateId && fromId ? fromId : '') as Uuid);
  const updateSummary = updateId ? updateData.data?.summary ?? null : null;
  const updateSubject = updateSummary?.subjects.find((subject) => subject.id === updateId) ?? null;
  const savedItems = useMemo<TestItem[]>(
    () => (updateSubject && updateData.data ? [...updateData.data.items.values()].filter((item) => item.subject_id === updateSubject.id) : []),
    [updateSubject, updateData.data],
  );
  useDocumentTitle(updateId ? IMPORT.titleUpdate : fromId ? IMPORT.titleAdd : IMPORT.docTitle);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [edits, setEdits] = useState<ImportEdits>(NO_EDITS);
  const [form, setForm] = useState<FormState>({
    target: 'new',
    title: '',
    titleTouched: false,
    date: '',
    dateTouched: false,
    perSubject: false,
    minutes: null,
  });
  const [nameTried, setNameTried] = useState(false);
  const [spotOpen, setSpotOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [queue, setQueue] = useState<{ uids: string[]; index: number } | null>(null);
  const [saving, setSaving] = useState<{ status: 'idle' | 'saving' | 'failed' | 'done'; error: string | null; progress: SaveProgress | null }>({
    status: 'idle',
    error: null,
    progress: null,
  });
  const saveState = useRef<SaveState>(freshSaveState());
  // Every oral exam of the student with its number of questions (targets.ts fetchOldExams).
  const [exams, setExams] = useState<OldExam[]>([]);
  // «Добавить предмет»: the oral exam being added as it is, and why it was not.
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const platform = useMemo(
    () => platformOf(typeof navigator === 'undefined' ? '' : navigator.userAgent, typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints ?? 0),
    [],
  );

  useEffect(() => {
    track('container.import_opened', { from: updateId ? 'subject' : fromId ? 'container' : 'new' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────────────────────────── reading files, at most two at once (the importer allows 10 a minute) ─────────────────────────────

  const running = useRef(0);
  const waiting = useRef<Array<() => Promise<void>>>([]);
  const pump = useCallback(() => {
    while (running.current < READ_AT_ONCE && waiting.current.length > 0) {
      const job = waiting.current.shift()!;
      running.current += 1;
      void job().finally(() => {
        running.current -= 1;
        pump();
      });
    }
  }, []);

  const update = useCallback((id: string, patch: Partial<Entry>) => {
    setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const forgetEdits = useCallback((fileId: string) => {
    const prefix = `${fileId}:`;
    setEdits((current) => ({
      items: Object.fromEntries(Object.entries(current.items).filter(([uid]) => !uid.startsWith(prefix))),
      subjects: Object.fromEntries(Object.entries(current.subjects).filter(([key]) => !key.startsWith(prefix))),
      files: Object.fromEntries(Object.entries(current.files).filter(([id]) => id !== fileId)),
    }));
  }, []);

  const read = useCallback(
    (entry: Entry) => {
      waiting.current.push(async () => {
        try {
          const { result, pdf } = await readBank({
            file: entry.file ?? undefined,
            text: entry.text ?? undefined,
            format: entry.format,
            keyText: entry.keyText,
          });
          forgetEdits(entry.id);
          update(entry.id, { status: 'done', result, pdf, error: null, errorCode: null });
          track('container.import_parsed', {
            items: result.stats.items,
            subjects: result.subjects.length,
            with_key: result.stats.with_key,
            layout: result.layout,
            kinds: Object.keys(result.stats.kinds ?? {}).sort().join(','),
          });
        } catch (error) {
          const failure = error instanceof ReadError ? error : new ReadError('unknown');
          track('container.import_failed', { code: failure.code });
          // A file read again (a key list, another format) keeps what it had: the line says what went wrong.
          update(entry.id, { status: entry.result ? 'done' : 'failed', error: failure.message, errorCode: failure.code });
        }
      });
      pump();
    },
    [forgetEdits, pump, update],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const fresh: Entry[] = files.map((file) => ({
        id: `f${(entrySeq += 1)}`,
        name: file.name || IMPORT.pasteName,
        file,
        text: null,
        source: 'file',
        format: 'auto',
        keyText: '',
        importId: newImportId(),
        status: 'reading',
        result: null,
        pdf: false,
        error: null,
        errorCode: null,
      }));
      setEntries((list) => [...list, ...fresh]);
      fresh.forEach(read);
    },
    [read],
  );
  // A file forwarded to the Telegram bot (?tg=<ticket>, bot spec §4.7 F1) comes in through the same door.
  const telegramFile = useTelegramFile(addFiles);

  const addText = useCallback(
    (text: string) => {
      const entry: Entry = {
        id: `f${(entrySeq += 1)}`,
        name: IMPORT.pasteName,
        file: null,
        text,
        source: 'paste',
        format: 'auto',
        keyText: '',
        importId: newImportId(),
        status: 'reading',
        result: null,
        pdf: false,
        error: null,
        errorCode: null,
      };
      setEntries((list) => [...list, entry]);
      read(entry);
    },
    [read],
  );

  const reread = useCallback(
    (fileId: string, patch: { format?: FileFormat; keyText?: string }) => {
      const entry = entries.find((item) => item.id === fileId);
      if (!entry) return;
      const next: Entry = { ...entry, ...patch, status: 'reading', error: null, errorCode: null };
      update(fileId, { ...patch, status: 'reading', error: null, errorCode: null });
      read(next);
    },
    [entries, read, update],
  );

  // ───────────────────────────── what the files make ─────────────────────────────

  const files: ImportFile[] = useMemo(
    () =>
      entries
        .filter((entry) => entry.result)
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          importId: entry.importId,
          source: entry.pdf ? 'pdf' : entry.source,
          format: entry.format,
          keyText: entry.keyText,
          result: entry.result!,
        })),
    [entries],
  );
  const subjects = useMemo(() => deriveSubjects(files, edits), [files, edits]);
  const active = useMemo(() => activeSubjects(subjects), [subjects]);
  const totals = useMemo(() => totalsOf(subjects), [subjects]);
  const problems = useMemo(() => queueOf(subjects), [subjects]);
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const sources = useMemo(() => (updateId ? updateSources(subjects) : []), [updateId, subjects]);
  const source = useMemo(
    () =>
      sources.find((entry) => entry.key === sourceKey) ??
      (updateSubject ? bestSource(sources, savedItems, updateSubject.title) : null),
    [sources, sourceKey, updateSubject, savedItems],
  );
  const updatePlan = useMemo(
    () => (updateSubject && updateData.data ? planUpdate(source, savedItems, updateSubject) : null),
    [updateSubject, updateData.data, source, savedItems],
  );
  // The queue of an update: only the questions it adds.
  const shownProblems = useMemo(() => {
    if (!updateId) return problems;
    const uids = new Set(updatePlan ? [...updatePlan.add, ...updatePlan.blocked].map((item) => item.uid) : []);
    return problems.filter((entry) => uids.has(entry.uid));
  }, [updateId, updatePlan, problems]);
  const singleOral = isSingleOralList(subjects);
  const removedCount = subjects.length - active.length;

  const firstRead = entries.some((entry) => entry.status === 'reading' && !entry.result);
  const stage: 'pick' | 'reading' | 'preview' = entries.length === 0 ? 'pick' : firstRead || files.length === 0 ? 'reading' : 'preview';
  const rereading = entries.some((entry) => entry.status === 'reading' && entry.result);

  // ───────────────────────────── where it goes, its name, date and minutes ─────────────────────────────

  // The oral exams: «Куда добавить» of a new exam (its preview), the offer of «Добавить предмет» (its first step).
  const wantsExams = Boolean(user?.id) && !updateId && (fromId ? stage === 'pick' : stage === 'preview');
  useEffect(() => {
    if (!user?.id || !wantsExams) return;
    let live = true;
    fetchOldExams(user.id).then((list) => {
      if (live) setExams(list);
    });
    return () => {
      live = false;
    };
  }, [user?.id, wantsExams]);
  const attached = overview.data?.attached_exam_ids;
  const oldExams = useMemo(() => plainExams(exams, attached ?? []), [exams, attached]);

  const today = localDay();
  // Two of one name are told apart by their date and size, as the exam lists show them (usability check 2026-10-10, m4).
  const targetOptions = useMemo(() => targetOptionsOf(containers, exams, attached ?? [], today), [containers, exams, attached, today]);
  // A target that left the list (the exam was deleted elsewhere) shows and saves as a new exam, never silently.
  const targetValue = fromId ? `c:${fromId}` : targetOptions.some((option) => option.value === form.target) ? form.target : 'new';
  const targetKind: SaveTarget['kind'] = targetValue === 'new' ? 'new' : targetValue.startsWith('c:') ? 'container' : 'old';
  const oldExam = targetKind === 'old' ? oldExams.find((exam) => `old:${exam.id}` === targetValue) ?? null : null;
  const container = targetKind === 'container' ? containers.find((item) => `c:${item.id}` === targetValue) ?? null : null;

  // An oral exam joining as subject 1 names the new exam (with the file's one subject: both names).
  const suggestion =
    targetKind === 'old'
      ? oldExam
        ? active.length === 1
          ? IMPORT.nameTwo(oldExam.title, active[0].title)
          : oldExam.title
        : ''
      : active.length === 1
        ? active[0].title
        : active.length === 2
          ? IMPORT.nameTwo(active[0].title, active[1].title)
          : '';
  const title = form.titleTouched ? form.title : suggestion;
  const date = form.dateTouched ? form.date : targetKind === 'old' ? oldExam?.exam_date ?? '' : form.date;
  const perSubject = form.perSubject && active.length > 1 && targetKind !== 'container';
  const subjectDates = active.map((subject) => subject.date);
  const anyDate = perSubject ? subjectDates.some(Boolean) : Boolean(date);
  const showName = targetKind !== 'container';
  // One oral list into a new exam is today's oral exam (decision 21): no minutes a day, no plan.
  const asOralExam = targetKind === 'new' && singleOral;
  const showMinutes = targetKind !== 'container' && !asOralExam;
  const showDate = targetKind !== 'container';

  // The oral exam joining as subject 1, as the exam's page will plan it: its questions in the plan, from its sheet
  // (lib/containers/oralPlan.ts, read once it is chosen). Undefined while read, null when it could not be.
  const [oldPlan, setOldPlan] = useState<{ examId: string; items: PlanItem[] | null } | null>(null);
  const oldId = oldExam?.id ?? null;
  useEffect(() => {
    if (!oldId) return undefined;
    let live = true;
    loadOralPlanItems([{ examId: oldId, subjectId: `old:${oldId}` }], Date.now(), timeZone()).then(
      (parts) => {
        if (live) setOldPlan({ examId: oldId, items: parts[0]?.items ?? [] });
      },
      () => {
        if (live) setOldPlan({ examId: oldId, items: null });
      },
    );
    return () => {
      live = false;
    };
  }, [oldId]);
  const oldItems = oldId && oldPlan?.examId === oldId ? oldPlan.items : undefined;

  // The questions about to be saved, nothing answered yet: what the minutes reach by the date (the plan's own line),
  // with the joining oral exam's. The exam's size after saving tells the line whether it counts all of it («в плане»
  // when not: questions without a key, oral ones waiting for lectures — usability check 2026-10-10, m6).
  const examSize = active.reduce((sum, subject) => sum + subject.test.length + subject.oral.length, 0) + (oldExam?.questions ?? 0);
  const draftInput = useMemo(() => {
    if (!showMinutes || (totals.test === 0 && !oldItems?.length) || !anyDate) return null;
    try {
      const extra =
        oldExam && oldItems && oldItems.length > 0
          ? { id: `old:${oldExam.id}`, title: oldExam.title, date: oldExam.exam_date ?? (perSubject ? null : date || null), items: oldItems }
          : null;
      return draftPlanInput(subjects, { now: Date.now(), tz: timeZone(), today, minutes: 60, date: date || null, perSubject, extra, examQuestions: examSize });
    } catch {
      return null;
    }
  }, [showMinutes, totals.test, anyDate, subjects, today, date, perSubject, oldExam, oldItems, examSize]);
  const base = useMemo(() => minutesLines(draftInput, 60), [draftInput]);
  // Without a date 60 minutes; with one, the smallest option that is enough (90 when none is).
  const defaultMinutes = !base ? 60 : base.option ?? 90;
  const minutes = form.minutes ?? defaultMinutes;
  // The line waits for the joining oral exam's questions: without them it would count too few.
  const lines = useMemo(
    () => (targetKind === 'old' && !Array.isArray(oldItems) ? null : minutesLines(draftInput, minutes)),
    [targetKind, oldItems, draftInput, minutes],
  );

  // ───────────────────────────── views (the address's #… so «назад» closes them) ─────────────────────────────

  const view = viewOf(location.hash);
  const openView = (hash: string) => navigate({ search: location.search, hash }, { state: { importView: true } });
  const closeView = () => {
    if ((location.state as { importView?: boolean } | null)?.importView) navigate(-1);
    else navigate({ search: location.search, hash: '' }, { replace: true });
  };
  const openQueue = (uids: string[]) => {
    setQueue({ uids, index: 0 });
    openView('#check');
  };

  const setItemFix = useCallback((uid: string, fix: ItemFix) => {
    setEdits((current) => ({ ...current, items: { ...current.items, [uid]: { ...current.items[uid], ...fix } } }));
  }, []);
  const setSubjectEdit = (key: string, patch: Record<string, unknown>) =>
    setEdits((current) => ({ ...current, subjects: { ...current.subjects, [key]: { ...current.subjects[key], ...patch } } }));
  const setFileEdit = (fileId: string, patch: Record<string, unknown>) =>
    setEdits((current) => ({ ...current, files: { ...current.files, [fileId]: { ...current.files[fileId], ...patch } } }));

  // ───────────────────────────── saving ─────────────────────────────

  const started = saveStarted(saveState.current);
  const locked = saving.status === 'saving' || started;
  const subjectsAfter = active.length + (targetKind === 'old' ? 1 : 0) + (container ? container.subjects : 0);
  const itemsAfter = totals.test + (container ? container.items : 0);
  const missing = !user
    ? IMPORT.signedOut
    : active.length === 0
      ? IMPORT.nothingLeft
      : showName && !title.trim()
        ? IMPORT.nameMissing
        : !asOralExam && subjectsAfter > SUBJECTS_CAP
          ? IMPORT.tooManySubjects(subjectsAfter)
          : itemsAfter > ITEMS_CAP
            ? IMPORT.tooManyItems(itemsAfter)
            : null;

  useEffect(() => {
    if (stage === 'pick' || saving.status === 'done') return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [stage, saving.status]);

  const updateCount = updateSummary && updatePlan ? updateSummary.items_version.count + updatePlan.add.length : 0;
  const updateMissing = !updateId
    ? null
    : !user
      ? IMPORT.signedOut
      : !updateData.data
        ? updateData.error
          ? IMPORT.updateLoadFailed
          : IMPORT.updateLoading
        : !updateSubject
          ? IMPORT.updateNotFound
          : updateSummary?.role !== 'owner'
            ? IMPORT.updateAuthorOnly
            : updateCount > ITEMS_CAP
              ? IMPORT.tooManyItems(updateCount)
              : null;
  const subjectHref = `/exams/c/${fromId ?? ''}/s/${updateId ?? ''}`;
  const firstDiffer = updatePlan?.keyDiffers[0] ?? null;
  const keysHref = `/exams/c/${fromId ?? ''}/keys?s=${updateId ?? ''}${firstDiffer?.saved.file_no ? `&no=${encodeURIComponent(firstDiffer.saved.file_no)}` : ''}`;

  const runUpdate = async () => {
    if (saving.status === 'saving' || updateMissing || !updatePlan || !updateId) return;
    if (updatePlan.add.length === 0) {
      // Nothing new: a differing key is the next thing to look at, in «Ключи».
      navigate(firstDiffer ? keysHref : subjectHref, { replace: true });
      return;
    }
    const importId = files.find((file) => file.id === source?.fileId)?.importId ?? 'imp';
    setSaving({ status: 'saving', error: null, progress: null });
    try {
      await saveUpdate({ subjectId: updateId, topics: updatePlan.topics, items: updateItemInputs(updatePlan, importId) }, saveState.current, (progress) =>
        setSaving((current) => ({ ...current, progress })),
      );
      track('container.updated', {
        added: updatePlan.add.length,
        same: updatePlan.same,
        key_differs: updatePlan.keyDiffers.length,
        not_in_file: updatePlan.notInFile,
        topics_added: updatePlan.topics ? updatePlan.topics.length - (updateSubject?.topic_titles.length ?? 0) : 0,
      });
      setSaving({ status: 'done', error: null, progress: null });
      navigate(subjectHref, { replace: true });
    } catch (error) {
      setSaving({ status: 'failed', error: saveStarted(saveState.current) ? IMPORT.saveRetry : errorText(error, {}, IMPORT.saveFailed), progress: null });
    }
  };

  const runSave = async () => {
    if (updateId) {
      await runUpdate();
      return;
    }
    if (saving.status === 'saving') return;
    if (missing) {
      if (missing === IMPORT.nameMissing) {
        setNameTried(true);
        nameRef.current?.focus();
        nameRef.current?.scrollIntoView?.({ block: 'center' });
      }
      return;
    }
    const target: SaveTarget =
      targetKind === 'container'
        ? { kind: 'container', containerId: targetValue.slice(2), title: container?.title ?? fromTitle ?? '' }
        : targetKind === 'old' && oldExam
          ? { kind: 'old', examId: oldExam.id, title: oldExam.title }
          : { kind: 'new' };
    setSaving({ status: 'saving', error: null, progress: null });
    try {
      const path = await saveImport(
        {
          userId: user!.id,
          target,
          title,
          date: date || null,
          perSubject,
          minutes: showMinutes ? minutes : null,
          subjects: active,
          importIds: Object.fromEntries(files.map((file) => [file.id, file.importId])),
        },
        saveState.current,
        (progress) => setSaving((current) => ({ ...current, progress })),
      );
      track('container.saved', {
        items: totals.test,
        subjects: active.length,
        oral_subjects: active.filter((subject) => subject.oral.length > 0).length,
        target: target.kind,
        single_oral: singleOral,
      });
      setSaving({ status: 'done', error: null, progress: null });
      navigate(path, { replace: true });
    } catch (error) {
      const partial = saveStarted(saveState.current);
      setSaving({ status: 'failed', error: partial ? IMPORT.saveRetry : errorText(error, {}, IMPORT.saveFailed), progress: null });
    }
  };

  // ───────────────────────────── render ─────────────────────────────

  const heading = updateId ? IMPORT.titleUpdate : fromId ? IMPORT.titleAdd : IMPORT.title;
  const crumb = updateId ? (
    <Link to={subjectHref}>{updateSubject?.title ?? fromTitle ?? IMPORT.titleUpdate}</Link>
  ) : fromId ? (
    <Link to={`/exams/c/${fromId}`}>{fromTitle ?? IMPORT.titleAdd}</Link>
  ) : (
    <Link to="/exams">{IMPORT.crumb}</Link>
  );
  const header = (
    <header className="ex-head im-head">
      <div style={{ minWidth: 0 }}>
        <p className="ex-crumb">{crumb}</p>
        <h1 className="ex-h1">{heading}</h1>
      </div>
    </header>
  );

  const readingRows: ReadingRow[] = entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    status: entry.status,
    found: entry.result?.stats.items ?? null,
    error: entry.status === 'failed' ? entry.error : null,
    retry: entry.status === 'failed' && (entry.errorCode === 'network' || entry.errorCode === 'unknown' || entry.errorCode === 'rate_limited'),
  }));
  const removeEntry = (id: string) => {
    setEntries((list) => list.filter((entry) => entry.id !== id));
    forgetEdits(id);
  };
  const retryEntry = (id: string) => {
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    update(id, { status: 'reading', error: null, errorCode: null });
    read({ ...entry, status: 'reading' });
  };

  // «Обновить из файла» that cannot go on (no such subject, not the author): say so instead of asking for a file.
  const updateRefused = Boolean(updateId && updateData.data && (!updateSubject || updateSummary?.role !== 'owner'));
  const updateFailed = Boolean(updateId && updateData.error && !updateData.data);
  // While the subject loads, the bar says so; the body speaks only when something is wrong.
  const updateNote = updateRefused || updateFailed ? (
    <section className="im-found-sec">
      <p className="im-line" role={updateFailed ? 'alert' : 'status'}>
        {updateMissing}
      </p>
      {updateFailed ? (
        <p className="im-line">
          <button type="button" className="sf-link" onClick={updateData.reload}>
            {IMPORT.retryFile}
          </button>
        </p>
      ) : updateRefused ? (
        <p className="im-line">
          <Link className="sf-link" to={updateSubject ? subjectHref : `/exams/c/${fromId ?? ''}`}>
            {IMPORT.updateToExam}
          </Link>
        </p>
      ) : null}
    </section>
  ) : null;

  // «Добавить предмет» of an exam: an oral exam the student already has joins it as it is, no file needed
  // (container_subject_add takes its exam_id, as container_create does for «Куда добавить»; usability check 2026-10-10, m4).
  const addOral = async (exam: OldExam) => {
    if (!fromId || adding !== null) return;
    setAdding(exam.id);
    setAddError(null);
    try {
      await addSubject(fromId, { title: exam.title.slice(0, 200), exam_id: exam.id });
      track('container.oral_added', { questions: exam.questions });
      navigate(`/exams/c/${fromId}`, { replace: true });
    } catch (error) {
      setAddError(errorText(error, {}, IMPORT.saveFailed));
      setAdding(null);
    }
  };
  const oralOffer =
    fromContainer && !updateId && oldExams.length > 0 ? (
      <section className="im-offer" aria-labelledby={`${formId}-offer`}>
        <h2 className="im-offer-h" id={`${formId}-offer`}>
          {IMPORT.oralOffer}
        </h2>
        <ul className="im-rows">
          {oldExams.map((exam) => (
            <li key={exam.id}>
              <button type="button" className="im-row" disabled={adding !== null} aria-busy={adding === exam.id || undefined} onClick={() => void addOral(exam)}>
                <span className="im-row-title">{exam.title}</span>
                <span className="im-row-meta">{nb(IMPORT.oralOfferMeta(exam.exam_date ? dayText(exam.exam_date) : '', exam.questions))}</span>
                <svg className="im-row-go" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
        {addError ? (
          <p className="im-line" role="alert">
            {addError}
          </p>
        ) : null}
      </section>
    ) : null;

  if (stage === 'pick') {
    return (
      <div className="sf-page im-page" ref={frame.ref} data-frame={frame.size}>
        {header}
        {telegramFile.line ? <p className="im-line" role={telegramFile.alert ? 'alert' : 'status'}>{nb(telegramFile.line)}</p> : null}
        {updateRefused ? (
          updateNote
        ) : (
          <FilePick
            phone={phone}
            side={frame.side && !updateId}
            platform={platform}
            onFiles={addFiles}
            onText={addText}
            title={updateId ? IMPORT.updateDropTitle : undefined}
            lede={updateId && updateSubject ? IMPORT.updateLede(updateSubject.title) : undefined}
          />
        )}
        {oralOffer}
      </div>
    );
  }

  if (stage === 'reading') {
    return (
      <div className="sf-page im-page" ref={frame.ref} data-frame={frame.size}>
        {header}
        <ReadingList rows={readingRows} onRemove={removeEntry} onRetry={retryEntry} onFiles={addFiles} heading />
        {platform !== 'other' ? <p className="im-tg">{platform === 'android' ? IMPORT.tgAndroid : IMPORT.tgIphone}</p> : null}
      </div>
    );
  }

  // The preview and its views.
  const detailSubject = view.kind === 'subject' ? subjects.find((subject) => subject.key === view.key) ?? null : null;
  const keyFile = view.kind === 'key' ? files.find((file) => file.id === view.fileId) ?? null : null;
  const keyEntry = view.kind === 'key' ? entries.find((entry) => entry.id === view.fileId) ?? null : null;

  if (view.kind === 'check' && queue) {
    return (
      <div className="sf-page im-page" ref={frame.ref} data-frame={frame.size}>
        <ImportQueue
          subjects={subjects}
          uids={queue.uids}
          index={queue.index}
          onIndex={(index) => setQueue((current) => (current ? { ...current, index } : current))}
          onFix={setItemFix}
          onDone={closeView}
        />
      </div>
    );
  }

  if (view.kind === 'key' && keyFile && keyEntry) {
    return (
      <div className="sf-page im-page" ref={frame.ref} data-frame={frame.size}>
        <KeySource
          file={keyFile}
          signal={edits.files[keyFile.id]?.signal ?? 'auto'}
          busy={keyEntry.status === 'reading'}
          focusKeyText={view.paste}
          onSignal={(signal: KeySignal) => setFileEdit(keyFile.id, { signal })}
          onKeyText={(text) => reread(keyFile.id, { keyText: text })}
          onClose={closeView}
        />
        {keyEntry.error ? (
          <p className="ex-note" role="alert">
            {keyEntry.error}
          </p>
        ) : null}
      </div>
    );
  }

  if (view.kind === 'subject' && detailSubject) {
    const entry = entries.find((item) => item.id === detailSubject.fileId);
    return (
      <div className="sf-page im-page" ref={frame.ref} data-frame={frame.size}>
        <SubjectDetail
          subject={detailSubject}
          phone={phone}
          onBack={closeView}
          onRename={(name) => setSubjectEdit(detailSubject.key, { title: name })}
          onRemove={() => {
            setSubjectEdit(detailSubject.key, { removed: true });
            closeView();
          }}
          onRestore={() => setSubjectEdit(detailSubject.key, { removed: false })}
          onCheck={() => {
            const uids = problems.filter((entryItem) => entryItem.subjectKey === detailSubject.key).map((entryItem) => entryItem.uid);
            openQueue(uids);
          }}
          onKeySource={() => openView(`#key=${encodeURIComponent(detailSubject.fileId)}`)}
          onMerge={(merged) => setFileEdit(detailSubject.fileId, { merged })}
          onFormat={entry ? (format) => reread(detailSubject.fileId, { format }) : null}
        />
        {entry?.status === 'reading' ? (
          <p className="im-line" role="status">
            {IMPORT.rereading}
          </p>
        ) : null}
      </div>
    );
  }

  // ── the preview ──
  const failed = entries.filter((entry) => entry.status === 'failed');
  const splitGroups = active.filter((subject) => subject.part === 1);
  const noKeySubjects = active.filter((subject) => subject.allNoKey);
  const spot = spotOpen ? spotCheck(subjects) : [];
  const singleFile = files.length === 1 ? files[0] : null;
  const singleFileOral = singleFile ? active.every((subject) => subject.test.length === 0 && subject.blocked.length === 0) : false;
  const imageLabels = totals.imageLost.map((item) => item.label).filter(Boolean);
  const progress = saving.progress;
  const nothingNew = Boolean(updatePlan && updatePlan.add.length === 0);
  const barLine =
    saving.status === 'failed'
      ? saving.error
      : saving.status === 'saving' && progress && progress.total > 0
        ? IMPORT.savingItems(progress.done, progress.total)
        : updateId
          ? updateMissing ?? (nothingNew ? IMPORT.updateNothing : null)
          : missing && (missing !== IMPORT.nameMissing || nameTried)
            ? missing
            : asOralExam
              ? IMPORT.nextLectures
              : null;
  const saveLabel =
    saving.status === 'saving'
      ? IMPORT.saving
      : updateId
        ? !updatePlan
          ? IMPORT.titleUpdate
          : nothingNew
            ? firstDiffer
              ? IMPORT.updateToKeys
              : IMPORT.updateDone
            : IMPORT.updateSave(updatePlan.add.length)
        : targetKind === 'container'
          ? IMPORT.saveAdd(active.length)
          : IMPORT.save;

  /** A file without keys asks one question (decision 34): paste the key, mark as you go, or read it as oral. */
  const noKeyBlock = (list: ReadonlyArray<{ key: string; title: string; fileId: string }>, named: boolean) =>
    list.map((subject) => (
      <div key={`nokey-${subject.key}`} className="im-nokey">
        <p className="im-nokey-t">{named ? IMPORT.noKeyIn(subject.title) : IMPORT.noKeyTitle}</p>
        <p className="im-nokey-acts">
          <button type="button" className="sf-link" disabled={locked} onClick={() => openView(`#key=${encodeURIComponent(subject.fileId)}&paste`)}>
            {IMPORT.noKeyPaste}
          </button>
          <button type="button" className="sf-link" disabled={locked} onClick={() => setFileEdit(subject.fileId, { noKeyLater: true })}>
            {IMPORT.noKeyLater}
          </button>
          <button type="button" className="sf-link" disabled={locked} onClick={() => reread(subject.fileId, { format: 'open' })}>
            {IMPORT.noKeyOral}
          </button>
        </p>
      </div>
    ));
  const problemsLine = (list: ReadonlyArray<{ uid: string }>) =>
    list.length > 0 ? (
      <p className="im-line">
        {nb(IMPORT.problems(list.length))}{' '}
        <button type="button" className="sf-link" disabled={locked} onClick={() => openQueue(list.map((entry) => entry.uid))}>
          {IMPORT.problemsGo}
        </button>
      </p>
    ) : null;
  const failedFiles =
    failed.length > 0 ? (
      <ReadingList rows={readingRows.filter((row) => row.status === 'failed')} onRemove={removeEntry} onRetry={retryEntry} onFiles={addFiles} heading={false} />
    ) : null;
  const rereadingLine = rereading ? (
    <p className="im-line" role="status">
      {IMPORT.rereading}
    </p>
  ) : null;
  const pdfLine = files.some((file) => file.source === 'pdf') ? <p className="im-line" data-muted="">{IMPORT.pdfNote}</p> : null;

  // «Обновить из файла»: what the file brings to the subject; the notes speak of the new questions only.
  const updateNew = updatePlan?.add ?? [];
  const updateImages = updateNew.filter((item) => item.imageLost);
  const updateImageLabels = updateImages.map((item) => item.label).filter(Boolean);
  const updateBody =
    updateId && updatePlan && updateSubject && !updateRefused ? (
      <section className="im-found-sec" aria-label={IMPORT.found(1, source?.found ?? 0)}>
        <h2 className="im-found">{nb(IMPORT.found(1, source?.found ?? 0))}</h2>
        {failedFiles}
        {rereadingLine}
        <UpdatePreview subject={updateSubject} sources={sources} source={source} onSource={setSourceKey} plan={updatePlan} locked={locked} />
        {source && source.allNoKey && updateNew.length > 0 ? noKeyBlock([source], false) : null}
        {problemsLine(shownProblems)}
        {updateImages.length > 0 ? (
          <p className="im-line" data-muted="">
            {nb(IMPORT.imageLost(updateImageLabels.length <= 5 ? updateImageLabels : [], updateImages.length))}
          </p>
        ) : null}
        {updatePlan.blocked.length > 0 ? <p className="im-line" data-muted="">{nb(IMPORT.blocked(updatePlan.blocked.length))}</p> : null}
        {source && source.skippedKinds > 0 ? <p className="im-line" data-muted="">{nb(IMPORT.notInPlan(source.skippedKinds))}</p> : null}
        {pdfLine}
      </section>
    ) : (
      updateNote
    );

  const rows = (
    <section className="im-found-sec" aria-label={IMPORT.found(totals.subjects, totals.found)}>
      <h2 className="im-found">{nb(IMPORT.found(totals.subjects, totals.found))}</h2>
      {failedFiles}
      {rereadingLine}
      <SubjectRows subjects={active} disabled={locked} onOpen={(key) => openView(`#s=${encodeURIComponent(key)}`)} />
      {removedCount > 0 && !locked ? (
        <p className="im-line" data-muted="">
          {nb(IMPORT.removedSubjects(removedCount))}{' '}
          <button
            type="button"
            className="sf-link"
            onClick={() =>
              setEdits((current) => ({
                ...current,
                subjects: Object.fromEntries(Object.entries(current.subjects).map(([key, edit]) => [key, { ...edit, removed: false }])),
              }))
            }
          >
            {IMPORT.restoreSubjects}
          </button>
        </p>
      ) : null}

      {noKeyBlock(noKeySubjects, active.length > 1)}
      {problemsLine(problems)}
      {splitGroups.map((subject) => (
        <p key={`split-${subject.key}`} className="im-line" data-muted="">
          {nb(IMPORT.split(subject.title.replace(/, часть 1$/, ''), subject.oralTotal, subject.parts))}
        </p>
      ))}
      {active
        .filter((subject) => subject.topicsTotal > 99)
        .map((subject) => (
          <p key={`topics-${subject.key}`} className="im-line" data-muted="">
            {nb(IMPORT.topicsMerged(subject.title, subject.topicsTotal))}
          </p>
        ))}
      {totals.imageLost.length > 0 ? (
        <p className="im-line" data-muted="">
          {nb(IMPORT.imageLost(imageLabels.length <= 5 ? imageLabels : [], totals.imageLost.length))}
        </p>
      ) : null}
      {totals.blocked > 0 ? <p className="im-line" data-muted="">{nb(IMPORT.blocked(totals.blocked))}</p> : null}
      {totals.skippedKinds > 0 ? <p className="im-line" data-muted="">{nb(IMPORT.notInPlan(totals.skippedKinds))}</p> : null}
      {totals.oral > 0 ? <p className="im-line" data-muted="">{nb(IMPORT.oralCost(totals.oral))}</p> : null}
      {totals.answerDropped > 0 ? <p className="im-line" data-muted="">{IMPORT.oralAnswers}</p> : null}
      {pdfLine}
    </section>
  );

  const details = (
    <div className="im-details">
      {totals.test > 0 && !updateId ? (
        <div>
          <button type="button" className="sf-link" data-muted="" aria-expanded={spotOpen} onClick={() => setSpotOpen((open) => !open)}>
            {IMPORT.spotCheck}
          </button>
          {spotOpen && spot.length > 0 ? (
            <div className="im-spot">
              <p className="im-spot-lede">{IMPORT.spotCheckLede}</p>
              <ul>
                {spot.map(({ subject, item }) => (
                  <li key={item.uid}>
                    <p className="im-spot-ctx">{nb([subject, item.label ? `№ ${item.label}` : null].filter(Boolean).join(' · '))}</p>
                    <p className="im-spot-q">{item.text}</p>
                    <p className="im-spot-a">
                      {`${IMPORT.spotCheckFile}: `}
                      {item.correct.map((index) => item.options[index]).join('; ')}
                    </p>
                  </li>
                ))}
              </ul>
              {singleFile || files.length > 0 ? (
                <p className="im-spot-wrong">
                  {`${IMPORT.spotCheckWrong} `}
                  <button type="button" className="sf-link" onClick={() => openView(`#key=${encodeURIComponent((singleFile ?? files[0]).id)}`)}>
                    {IMPORT.otherWay}
                  </button>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {singleFile && singleFile.source !== 'pdf' && !locked ? (
        <div>
          <button
            type="button"
            className="sf-link"
            data-muted=""
            onClick={() => reread(singleFile.id, { format: singleFileOral ? 'test' : 'open' })}
          >
            {singleFileOral ? IMPORT.readAsTest : IMPORT.readAsOral}
          </button>
        </div>
      ) : null}
      {!locked ? (
        <div>
          <AddFileLink onFiles={addFiles} />
        </div>
      ) : null}
    </div>
  );

  const nameField = showName ? (
    <div className="im-field">
      <label className="im-label" htmlFor={`${formId}-name`}>
        {targetKind === 'old' && oldExam ? nb(IMPORT.nameWith(oldExam.title, active.length)) : IMPORT.name}
      </label>
      <input
        id={`${formId}-name`}
        ref={nameRef}
        className="im-input"
        value={title}
        maxLength={200}
        placeholder={IMPORT.namePlaceholder}
        aria-invalid={nameTried && !title.trim() ? true : undefined}
        disabled={locked}
        onChange={(event) => setForm((current) => ({ ...current, title: event.target.value, titleTouched: true }))}
      />
    </div>
  ) : null;

  const dateFields = showDate ? (
    <div className="im-field">
      {perSubject ? (
        <fieldset className="im-dates">
          <legend className="im-label">{IMPORT.date}</legend>
          {active.map((subject) => (
            <label key={subject.key} className="im-date-row">
              <span className="im-date-name">{subject.title}</span>
              <input
                type="date"
                className="im-input im-date"
                value={subject.date ?? ''}
                min={today}
                disabled={locked}
                aria-label={IMPORT.subjectDate(subject.title)}
                onChange={(event) => setSubjectEdit(subject.key, { date: event.target.value || null })}
              />
            </label>
          ))}
        </fieldset>
      ) : (
        <>
          <label className="im-label" htmlFor={`${formId}-date`}>
            {IMPORT.date}
          </label>
          <input
            id={`${formId}-date`}
            type="date"
            className="im-input im-date"
            value={date}
            min={today}
            disabled={locked}
            onChange={(event) => setForm((current) => ({ ...current, date: event.target.value, dateTouched: true }))}
          />
        </>
      )}
      {active.length > 1 ? (
        <button
          type="button"
          className="sf-link im-dates-switch"
          data-muted=""
          disabled={locked}
          onClick={() => setForm((current) => ({ ...current, perSubject: !current.perSubject }))}
        >
          {perSubject ? IMPORT.oneDate : IMPORT.dates}
        </button>
      ) : null}
      {!anyDate && !asOralExam ? <p className="im-hint" data-muted="">{nb(IMPORT.noDate)}</p> : null}
    </div>
  ) : null;

  const minutesField = showMinutes ? (
    <div className="im-field">
      <span className="im-label" id={`${formId}-minutes`}>
        {IMPORT.minutes}
      </span>
      <PaperSelect
        ariaLabel={IMPORT.minutes}
        value={minutes}
        options={MINUTE_OPTIONS.map((value) => ({ value, label: IMPORT.minuteOption(value) }))}
        onChange={(value) => setForm((current) => ({ ...current, minutes: value }))}
        disabled={locked}
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
    </div>
  ) : null;

  const targetField =
    !fromId && targetOptions.length > 1 ? (
      <div className="im-field">
        <span className="im-label">{IMPORT.target}</span>
        <PaperSelect
          ariaLabel={IMPORT.target}
          value={targetValue}
          options={targetOptions}
          onChange={(value) => setForm((current) => ({ ...current, target: value, titleTouched: false, dateTouched: false }))}
          disabled={locked}
        />
      </div>
    ) : null;

  const formBlock =
    targetField || nameField || dateFields || minutesField ? (
      <section className="im-form">
        {targetField}
        {nameField}
        {dateFields}
        {minutesField}
      </section>
    ) : null;

  return (
    <div className="sf-page im-page" ref={frame.ref} data-frame={frame.size}>
      {header}
      {updateId ? (
        <div className="im-body im-body-update">
          {updateBody}
          {updatePlan && !updateRefused ? details : null}
        </div>
      ) : (
        <div className="im-body" data-side={frame.side ? '' : undefined}>
          <div className="im-main">
            {rows}
            {frame.side ? details : null}
          </div>
          {formBlock}
          {!frame.side ? details : null}
        </div>
      )}
      <div className="ex-cta im-cta" data-row={frame.side ? '' : undefined}>
        {barLine ? (
          <p className="ex-cta-why" role={saving.status === 'failed' ? 'alert' : 'status'} data-next={barLine === IMPORT.nextLectures ? '' : undefined}>
            {nb(barLine)}
          </p>
        ) : null}
        <button
          type="button"
          className="sf-primary"
          disabled={saving.status === 'saving' || Boolean(updateId && (!updatePlan || updateRefused))}
          aria-busy={saving.status === 'saving' || undefined}
          onClick={() => void runSave()}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

