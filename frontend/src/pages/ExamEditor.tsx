import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  EXAM_KINDS,
  EXAM_MESSAGES,
  createExam,
  deleteExam,
  examErrorMessage,
  importTextOnlyMaterial,
  isMappingLocked,
  listPickerMaterials,
  loadExamBundle,
  parseQuestionList,
  saveExamEdits,
  type ExamBundle,
  type ExamKind,
  type LayoutMode,
  type ParseResult,
  type PickerMaterial,
} from '../api/exams';
import { useAuth } from '../hooks/useAuth';
import { useEnergyConfirm } from '../hooks/useEnergyConfirm';
import { useConfirm } from '../contexts/ConfirmContext';
import { KIND_WORDS, subjectOf } from '../lib/exams/format';
import { pluralRu } from '../components/conversation/visuals';
import QuestionPreview from '../components/exams/QuestionPreview';
import MaterialPicker, { type ImportStatus } from '../components/exams/MaterialPicker';
import PaperSelect from '../components/ui/PaperSelect';
import PaperSuggestInput from '../components/ui/PaperSuggestInput';
import { startMapping, useMapJob } from '../components/exams/mapJobs';
import {
  EMPTY_PREVIEW,
  chosenLayout,
  draftQuestions,
  filledSectionCount,
  keepSavedQuestions,
  listProblem,
  previewFromExam,
  previewFromParse,
  questionCount,
  sectionTitles,
  skippedLines,
  suggestedMaterialIds,
  suggestedTitle,
  suggestionReason,
  type PreviewState,
  type SkippedLine,
} from '../components/exams/previewModel';
import { glue } from '../components/exams/sheetModel';
import { COVERAGE_MARK, COVERAGE_MARK_SIZE, COVERAGE_PILL_WORDS, PILL_MARK_SCALE } from '../components/exams/marks';
import { Mark } from '../components/marks/PencilSvg';
import { useFrame } from '../components/exams/useFrame';
import '../styles/paper.css';
import '../components/exams/exams.css';

const PARSE_ACCEPT = '.docx,.pdf,.txt,.md';
const QUESTION_FORMS = ['вопрос', 'вопроса', 'вопросов'] as const;
/** Where a student finds the list before pasting it (Jury_Check item 12, answer 21). */
const LIST_SOURCE_HINT = 'Список вопросов часто есть в рабочей программе дисциплины на сайте кафедры или у старосты.';
/** The empty field shows what a department's list looks like: paste it as it is. */
const LIST_EXAMPLE = 'Вопросы к экзамену\n1. Предмет и метод экономической теории.\n2. Спрос и закон спроса.\n3. Эластичность спроса и её виды.\n…';
/** «Распознать вопросы» pressed on an empty field: the cursor goes into it and this line says why. */
const EMPTY_HINT = 'Сначала вставьте сюда список — или выберите файл.';
/** The status pills of the sheet the list will become (the legend's words, on drawn rows: no data). */
const SHEET_PREVIEW: Array<{ coverage: 'full' | 'partial' | 'none'; width: string }> = [
  { coverage: 'full', width: '78%' },
  { coverage: 'partial', width: '62%' },
  { coverage: 'none', width: '70%' },
];
/** Under «Разметить по лекциям»: what the press does, with how many lectures. */
function mapNext(lectures: number): string {
  const chosen = lectures % 10 === 1 && lectures % 100 !== 11 ? 'выбранной лекцией' : 'выбранными лекциями';
  return `Meldy сверит каждый вопрос с ${lectures} ${chosen} — пометки появятся на листе экзамена.`;
}
/** Why the lectures are ticked as they are, until the student changes them. */
const TICK_HINTS = {
  'no-title': 'Пока отмечены все: когда вы назовёте экзамен, Meldy оставит лекции этого предмета.',
  'by-title': 'Отмечены лекции, подходящие к названию экзамена. Лишние снимите, нужные отметьте.',
  'no-match': 'По названию экзамена лекций не нашлось — отмечены все. Лишние снимите.',
} as const;
const TITLE_ID = 'exam-title';
const SAVE_WHY_ID = 'exam-save-why';

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/**
 * Puts the cursor into a field the main button sent the student to; brings it to the middle of the
 * window when it is off screen or under the phone's bottom bar (which a plain focus() ignores).
 */
function reveal(element: HTMLElement | null | undefined) {
  if (!element) return;
  element.focus({ preventScroll: true });
  const box = element.getBoundingClientRect();
  const bar = document.querySelector('.ex-cta')?.getBoundingClientRect();
  const bottom = bar && bar.height > 0 ? Math.min(window.innerHeight, bar.top) : window.innerHeight;
  if (box.top < 0 || box.bottom > bottom - 12) element.scrollIntoView?.({ block: 'center' });
}

/** The most common ticket size of the department's tickets (1…4). */
function ticketSize(tickets: Array<{ keys: string[] }>): number {
  const counts = new Map<number, number>();
  for (const ticket of tickets) counts.set(ticket.keys.length, (counts.get(ticket.keys.length) ?? 0) + 1);
  let best = 2;
  let bestCount = -1;
  counts.forEach((count, size) => {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  });
  return Math.min(4, Math.max(1, best));
}

/**
 * «Новый экзамен» and «Изменить список»: one page, four blocks (tickets spec 3.3, redesign 5.8).
 * The list is pasted or uploaded as it is, recognised on the server (no model) and corrected in an
 * editable preview; the exam, its questions and lectures are written straight to Supabase; the
 * mapping starts in the background and the sheet shows it.
 */
export default function ExamEditor() {
  const { id: editId } = useParams();
  const editing = Boolean(editId);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const location = useLocation();
  const { verifyEnergy } = useEnergyConfirm();
  const { confirm } = useConfirm();
  const frame = useFrame<HTMLDivElement>();
  const job = useMapJob(editId);

  // existing exam (edit mode)
  const [bundle, setBundle] = useState<ExamBundle | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>(editing ? 'loading' : 'idle');
  const [loadError, setLoadError] = useState('');

  // the list
  const [dragging, setDragging] = useState(false);
  const [pasted, setPasted] = useState('');
  const [emptyTried, setEmptyTried] = useState(false);
  const listRef = useRef<HTMLTextAreaElement>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<SkippedLine[]>([]);
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const [collapsed, setCollapsed] = useState(true);
  const [sourceKind, setSourceKind] = useState<'paste' | 'file'>('paste');
  const [sourceText, setSourceText] = useState('');
  const [replaceSource, setReplaceSource] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // the exam
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ExamKind>('exam');
  const [examDate, setExamDate] = useState('');
  const [perTicket, setPerTicket] = useState(2);
  /**
   * «Как составлены билеты» as the student chose it, or as an edited exam stored it; null until
   * then, and the list decides (chosenLayout). An explicit choice is never replaced by a default.
   */
  const [layoutChoice, setLayoutChoice] = useState<LayoutMode | null>(null);

  // lectures
  const [materials, setMaterials] = useState<PickerMaterial[]>([]);
  const [materialsState, setMaterialsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [imports, setImports] = useState<ImportStatus[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The main button was pressed without a title: the field is marked until it gets one. */
  const [titleTried, setTitleTried] = useState(false);

  // ------------------------------------------------------------------ loading
  const loadMaterials = useCallback(async () => {
    if (!userId) return;
    setMaterialsState('loading');
    try {
      setMaterials(await listPickerMaterials(userId));
      setMaterialsState('ready');
    } catch {
      setMaterialsState('error');
    }
  }, [userId]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  const loadExam = useCallback(async () => {
    if (!editId) return;
    setLoadState('loading');
    try {
      const next = await loadExamBundle(editId);
      if (!next) {
        setLoadState('missing');
        return;
      }
      setBundle(next);
      setTitle(next.exam.title);
      setKind(next.exam.kind);
      setExamDate(next.exam.exam_date ?? '');
      setPerTicket(next.exam.ticket_layout.per_ticket);
      // Editing keeps the stored layout: it counts as the student's choice.
      setLayoutChoice(next.exam.ticket_layout.mode);
      setSourceKind(next.exam.source_kind);
      setSourceText(next.exam.source_text);
      setPreview(previewFromExam(next.questions, next.exam.ticket_layout));
      setSelected(new Set(next.materialIds));
      setSelectionTouched(true);
      setLoadState('ready');
    } catch (error) {
      setLoadError(examErrorMessage(error, EXAM_MESSAGES.load));
      setLoadState('error');
    }
  }, [editId]);

  useEffect(() => {
    void loadExam();
  }, [loadExam]);

  // Lectures ticked in advance by word stems of the title (all of them when none matches).
  useEffect(() => {
    if (editing || selectionTouched || materialsState !== 'ready') return;
    setSelected(new Set(suggestedMaterialIds(materials, title)));
  }, [editing, selectionTouched, materialsState, materials, title]);

  useEffect(() => {
    if (location.hash !== '#lectures' || loadState === 'loading') return;
    window.setTimeout(() => document.getElementById('lectures')?.scrollIntoView?.({ block: 'start' }), 0);
  }, [location.hash, loadState]);

  // ------------------------------------------------------------------ the list
  const total = questionCount(preview);
  const sections = sectionTitles(preview).length;
  const filledSections = filledSectionCount(preview);
  const hasTickets = preview.tickets.length > 0;
  const listIssue = total > 0 ? listProblem(preview) : null;
  // The department's tickets, one question from each section or random tickets: re-evaluated on every
  // change of the list or of the questions per ticket, unless the student chose (or the exam stored)
  // a layout that still fits (Jury_Check item 10).
  const layoutMode = chosenLayout(layoutChoice, preview, perTicket);

  const applyParse = (result: ParseResult, from: 'paste' | 'file') => {
    let next = previewFromParse(result);
    if (bundle) next = keepSavedQuestions(next, bundle.questions);
    setPreview(next);
    if (title.trim() === '') {
      const suggestion = suggestedTitle(result);
      if (suggestion) setTitle(suggestion);
    }
    setSkipped(skippedLines(result));
    setParseWarnings(result.warnings.filter((warning) => warning.code !== 'unparsed_lines' || skippedLines(result).length === 0).map((warning) => warning.message));
    setSourceKind(from);
    setSourceText(result.source_text);
    setReplaceSource(true);
    setCollapsed(true);
    // The department's tickets say how many questions a ticket has; the layout itself follows the list.
    if (next.tickets.length > 0) setPerTicket(ticketSize(next.tickets));
  };

  const parse = async (input: { text?: string; file?: File }) => {
    setParseError(null);
    setParsing(true);
    try {
      const result = await parseQuestionList(input);
      applyParse(result, input.file ? 'file' : 'paste');
    } catch (error) {
      setParseError(examErrorMessage(error, 'Не удалось распознать список. Повторите попытку.'));
    } finally {
      setParsing(false);
    }
  };

  const startOver = () => {
    setPreview(EMPTY_PREVIEW);
    setSkipped([]);
    setParseWarnings([]);
    setParseError(null);
    setPasted('');
  };

  // ------------------------------------------------------------------ lectures
  const toggleMaterial = (id: string) => {
    setSelectionTouched(true);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setManyMaterials = (ids: string[], on: boolean) => {
    setSelectionTouched(true);
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const importFiles = async (files: File[]) => {
    if (!user) return;
    for (const file of files) {
      const key = `${file.name}:${file.size}:${Date.now()}`;
      setImports((current) => [...current, { key, name: file.name, state: 'pending' }]);
      try {
        const material = await importTextOnlyMaterial(user.id, file);
        setMaterials((current) => [material, ...current.filter((item) => item.id !== material.id)]);
        setSelectionTouched(true);
        setSelected((current) => new Set(current).add(material.id));
        setImports((current) => current.map((item) => (item.key === key ? { ...item, state: 'done', ocr: material.ocr } : item)));
      } catch (error) {
        setImports((current) =>
          current.map((item) => (item.key === key ? { ...item, state: 'error', message: examErrorMessage(error, EXAM_MESSAGES.material) } : item)),
        );
      }
    }
  };

  // ------------------------------------------------------------------ saving
  const lockedByMapping =
    editing &&
    (job.phase === 'running' || job.phase === 'waiting' || Boolean(bundle && bundle.exam.mapping_state === 'running' && isMappingLocked(bundle.exam)));
  const usableSelected = materials.filter((material) => material.textLength > 0 && selected.has(material.id)).map((material) => material.id);
  const titleMissing = title.trim() === '';
  const canSave = !saving && !lockedByMapping && total > 0 && !listIssue && !titleMissing && Boolean(user);

  const save = async () => {
    if (!user || !canSave) return;
    setSaving(true);
    setSaveError(null);
    const draft = {
      title,
      kind,
      examDate: examDate || null,
      sourceKind,
      sourceText,
      layoutMode,
      perTicket,
      sectionTitles: sectionTitles(preview),
      questions: draftQuestions(preview),
      tickets: preview.tickets,
      // Lectures without text stay attached when they were (they do not take part in the mapping).
      materialIds: Array.from(selected).filter((id) => materials.some((material) => material.id === id) || bundle?.materialIds.includes(id)),
    };
    try {
      if (!editing) {
        const { examId } = await createExam(user.id, draft);
        if (usableSelected.length > 0) void startMapping({ examId, userId: user.id, verifyEnergy });
        navigate(`/exams/${examId}`);
        return;
      }
      if (!bundle) return;
      // The save compares the list with what the database holds now, so pressing again after a
      // failure repeats nothing. Lectures are compared with the ones the editor opened with: a save
      // that failed after attaching them leaves nothing to attach, and the mapping is still due.
      const result = await saveExamEdits({ exam: bundle.exam, draft, replaceSource });
      const opened = new Set(bundle.materialIds);
      const lecturesChanged = draft.materialIds.length !== opened.size || draft.materialIds.some((id) => !opened.has(id));
      if ((result.needsMapping.length > 0 || result.materialsChanged || lecturesChanged) && usableSelected.length > 0) {
        void startMapping({ examId: bundle.exam.id, userId: user.id, verifyEnergy });
      }
      navigate(`/exams/${bundle.exam.id}`);
    } catch (error) {
      setSaveError(examErrorMessage(error, EXAM_MESSAGES.save));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!bundle) return;
    const ok = await confirm({
      title: 'Удалить экзамен?',
      message: `«${bundle.exam.title}» и сверка его вопросов с лекциями будут удалены. Ответы останутся в истории и в «Прогрессе».`,
      confirmText: 'Удалить',
      cancelText: 'Отмена',
      type: 'danger',
    });
    if (!ok) return;
    try {
      await deleteExam(bundle.exam.id);
      navigate('/exams');
    } catch (error) {
      setSaveError(examErrorMessage(error, EXAM_MESSAGES.delete));
    }
  };

  /** In edit mode: a changed or new question, or other lectures, means the mapping runs again. */
  const needsMapping = useMemo(() => {
    if (!bundle) return true;
    const before = new Map(bundle.questions.map((question) => [question.id, question]));
    const rowsChanged = draftQuestions(preview).some((question) => {
      const saved = question.id ? before.get(question.id) : undefined;
      return !saved || saved.text.trim() !== question.text.trim() || saved.coverage === null;
    });
    const savedLectures = new Set(bundle.materialIds);
    const lecturesChanged = selected.size !== savedLectures.size || Array.from(selected).some((id) => !savedLectures.has(id));
    return rowsChanged || lecturesChanged;
  }, [bundle, preview, selected]);

  const subjects = useMemo(
    () => Array.from(new Set(materials.map((material) => material.subject.trim()).filter(Boolean))).slice(0, 20),
    [materials],
  );

  // ------------------------------------------------------------------ render
  if (editing && (loadState === 'loading' || loadState === 'missing' || loadState === 'error')) {
    return (
      <div className="sf-page" ref={frame.ref} data-frame={frame.size}>
        {loadState === 'loading' ? (
          <p className="ex-loading" role="status">
            Загружаем экзамен…
          </p>
        ) : (
          <div className="ex-error" role="alert">
            <h2>{loadState === 'missing' ? 'Экзамен не найден' : 'Не удалось открыть экзамен'}</h2>
            <p>{loadState === 'missing' ? 'Его удалили, или он принадлежит другому аккаунту.' : loadError}</p>
            {loadState === 'error' ? (
              <button type="button" className="sf-link" onClick={() => void loadExam()}>
                Повторить
              </button>
            ) : (
              <Link className="sf-link" to="/exams">
                Экзамены
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  const primaryLabel = saving
    ? 'Сохраняем…'
    : usableSelected.length === 0
      ? 'Сохранить список'
      : editing
        ? needsMapping
          ? 'Сохранить и сверить'
          : 'Сохранить'
        : 'Сверить с лекциями';
  const disabledReason = lockedByMapping
    ? 'Идёт сверка — список можно будет изменить, когда она закончится.'
    : total === 0
      ? null
      : titleMissing
        ? 'Назовите экзамен.'
        : listIssue;

  const sizeOptions = [1, 2, 3, 4];
  // Like «Распознать вопросы», the main button of step 2 always answers: while something is missing
  // it takes the student there (the title field, or the line of the list to fix) instead of staying
  // pressed in vain; the line next to it says what is missing.
  const primary = (
    <button
      type="button"
      className="sf-primary"
      disabled={saving || lockedByMapping || !user}
      aria-describedby={disabledReason ? SAVE_WHY_ID : undefined}
      onClick={() => {
        if (titleMissing) {
          setTitleTried(true);
          reveal(document.getElementById(TITLE_ID));
          return;
        }
        if (listIssue) {
          // The list opens in full first: the line to fix may be among the folded ones.
          setCollapsed(false);
          window.setTimeout(() => {
            const row = document.querySelector('.nx-problem')?.closest('li');
            const line = row?.querySelector<HTMLElement>('.nx-t');
            if (line) reveal(line);
            else document.querySelector('.nx-list')?.scrollIntoView?.({ block: 'center' });
          }, 0);
          return;
        }
        void save();
      }}
    >
      {primaryLabel}
    </button>
  );
  // Step 1 says where the lectures are chosen (step 2) and how many the library has.
  const libraryLectures = materials.filter((material) => material.textLength > 0).length;
  const lecturesAhead =
    materialsState !== 'ready'
      ? 'Какие лекции брать, выберете на следующем шаге.'
      : libraryLectures > 0
        ? `В библиотеке ${libraryLectures} ${pluralRu(libraryLectures, ['лекция', 'лекции', 'лекций'])}. На следующем шаге выберете нужные — Meldy заранее отметит лекции по предмету экзамена.`
        : 'В библиотеке пока нет лекций с текстом. На следующем шаге их можно добавить — только текст, без расхода лимита.';
  // Step 1 is the list alone: one card, its button right under the field. The button always answers:
  // with text it recognises it; on an empty field it puts the cursor there and says what to do.
  const recognizeStep = total === 0;
  const recognize = (
    <button
      type="button"
      className="sf-primary"
      disabled={parsing || lockedByMapping}
      onClick={() => {
        if (pasted.trim() === '') {
          setEmptyTried(true);
          listRef.current?.focus();
          return;
        }
        void parse({ text: pasted });
      }}
    >
      {parsing ? 'Распознаём…' : 'Распознать вопросы'}
    </button>
  );
  const dropZone = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event) || parsing || lockedByMapping) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event) || parsing || lockedByMapping) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      const file = event.dataTransfer?.files?.[0];
      setDragging(false);
      if (!file) return;
      event.preventDefault();
      if (!parsing && !lockedByMapping) void parse({ file });
    },
  };

  return (
    <div className="sf-page" ref={frame.ref} data-frame={frame.size}>
      <header className="ex-head" style={{ display: 'block' }}>
        <p className="ex-crumb">
          <Link to="/exams">Экзамены</Link>
          {bundle && (
            <>
              {' · '}
              <Link to={`/exams/${bundle.exam.id}`}>{subjectOf(bundle.exam.title)}</Link>
            </>
          )}
        </p>
        <h1 className="ex-h1">{editing ? 'Изменить экзамен' : 'Новый экзамен'}</h1>
        {!editing && (
          <ol className="nx-steps" aria-label="Шаги">
            <li data-state={recognizeStep ? 'now' : 'done'} aria-current={recognizeStep ? 'step' : undefined}>
              <span className="nx-step-n" aria-hidden="true">
                1
              </span>
              Список вопросов
            </li>
            <li data-state={recognizeStep ? undefined : 'now'} aria-current={recognizeStep ? undefined : 'step'}>
              <span className="nx-step-n" aria-hidden="true">
                2
              </span>
              Проверка и лекции
            </li>
            <li>
              <span className="nx-step-n" aria-hidden="true">
                3
              </span>
              Сверка с лекциями
            </li>
          </ol>
        )}
      </header>

      {lockedByMapping && (
        <p className="ex-note" role="status">
          Идёт сверка — список можно будет изменить, когда она закончится.
        </p>
      )}

      {recognizeStep ? (
        // Step 1: the list alone. One card: the field with an example of a department's list, its
        // button right under it; on the side, quietly, what the list becomes and where to find it.
        <section
          className="sf-sheet nx-start"
          aria-label="Вопросы кафедры"
          data-drag={dragging ? '' : undefined}
          {...dropZone}
        >
          <div className="nx-start-main">
            <h2 className="nx-start-h">Вставьте список вопросов</h2>
            {/* A phone has nothing to drag a file from: there the formats go into this line instead. */}
            <p className="nx-start-sub">
              {frame.size === 's'
                ? 'Скопируйте его из файла кафедры как есть — или выберите сам файл: DOCX, PDF (сканы тоже), TXT или MD.'
                : 'Скопируйте его из файла кафедры как есть — или перетащите сюда сам файл.'}
            </p>
            <div className="nx-field">
              <textarea
                ref={listRef}
                aria-label="Список вопросов"
                placeholder={LIST_EXAMPLE}
                value={pasted}
                disabled={parsing || lockedByMapping}
                onChange={(event) => {
                  setPasted(event.target.value);
                  if (event.target.value.trim() !== '') setEmptyTried(false);
                }}
                onPaste={(event) => {
                  const text = event.clipboardData?.getData('text') ?? '';
                  if (text.trim().length > 20 && pasted.trim() === '') {
                    const target = event.currentTarget;
                    window.setTimeout(() => void parse({ text: target.value || text }), 0);
                  }
                }}
              />
            </div>
            <div className="nx-start-acts">
              {recognize}
              <button type="button" className="ex-secondary" disabled={parsing || lockedByMapping} onClick={() => fileRef.current?.click()}>
                Выбрать файл
              </button>
              {frame.size !== 's' && <span className="nx-start-fmt">DOCX, PDF, TXT или MD · сканы тоже</span>}
              <input
                ref={fileRef}
                type="file"
                accept={PARSE_ACCEPT}
                hidden
                aria-label="Файл со списком вопросов"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void parse({ file });
                }}
              />
            </div>
            {emptyTried && !parsing && pasted.trim() === '' && (
              <p className="ex-note" role="status">
                {EMPTY_HINT}
              </p>
            )}
            {parsing && (
              <p className="ex-meta" role="status">
                Распознаём список…
              </p>
            )}
            {parseError && (
              <p className="ex-note" role="alert">
                {parseError}
              </p>
            )}
          </div>
          <aside className="nx-start-side" aria-label="Что будет дальше">
            <p className="nx-lbl">Что сделает Meldy</p>
            <ul className="nx-start-art" aria-hidden="true">
              {SHEET_PREVIEW.map((row) => {
                const kind = COVERAGE_MARK[row.coverage];
                const size = kind ? COVERAGE_MARK_SIZE[kind] : null;
                return (
                  <li key={row.coverage}>
                    <i style={{ width: row.width }} />
                    <span className="ex-cov" data-mark={kind ?? undefined}>
                      {kind && size && (
                        <Mark
                          kind={kind}
                          seed={row.coverage.length * 7}
                          width={Math.round(size.width * PILL_MARK_SCALE)}
                          height={Math.round(size.height * PILL_MARK_SCALE)}
                          weight={size.weight}
                        />
                      )}
                      <span className="ex-cov-word">{COVERAGE_PILL_WORDS[row.coverage]}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="nx-start-p">
              {glue('Найдёт вопросы, разделы и билеты, а после проверки сверит каждый вопрос с вашими лекциями.')}
            </p>
            <p className="nx-lbl nx-start-lbl2">Лекции</p>
            <p className="nx-start-p">{glue(lecturesAhead)}</p>
            <p className="nx-lbl nx-start-lbl2">Где взять список</p>
            <p className="nx-start-p">{glue(LIST_SOURCE_HINT)}</p>
          </aside>
          {dragging && (
            <p className="nx-drop" aria-hidden="true">
              Отпустите файл — Meldy распознает список
            </p>
          )}
        </section>
      ) : (
        <div className="nx-body">
          <section aria-label="Вопросы кафедры" style={{ minWidth: 0 }}>
            <p className="nx-parsed">
              {glue(
                `${replaceSource || !editing ? 'Распознано' : 'В списке'} ${total} ${pluralRu(total, QUESTION_FORMS)}` +
                  (sections > 0 ? `, ${sections} ${pluralRu(sections, ['раздел', 'раздела', 'разделов'])}` : ''),
              )}
            </p>
            <p className="ex-meta">Строку можно поправить, склеить или удалить.</p>
            {parseWarnings.map((warning) => (
              <p key={warning} className="ex-note">
                {glue(warning)}
              </p>
            ))}
            <QuestionPreview
              state={preview}
              onChange={setPreview}
              skipped={skipped}
              onSkippedHandled={(key) => setSkipped((current) => current.filter((line) => line.key !== key))}
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsed((value) => !value)}
              disabled={lockedByMapping || saving}
            />
            <div className="nx-acts">
              <button type="button" className="sf-link" onClick={startOver} disabled={lockedByMapping || saving}>
                Вставить заново
              </button>
            </div>
          </section>

          <aside className="nx-form" aria-label="Экзамен, билеты и лекции">
            <div className="nx-grp">
              <p className="nx-lbl">Экзамен</p>
              <div className="nx-fields">
                <span className="nx-sel nx-sel-title" data-missing={titleTried && titleMissing ? '' : undefined}>
                  <PaperSuggestInput
                    id={TITLE_ID}
                    aria-label="Название экзамена"
                    aria-describedby="exam-title-hint"
                    aria-invalid={titleTried && titleMissing ? true : undefined}
                    placeholder="Например, Микроэкономика"
                    value={title}
                    maxLength={200}
                    suggestions={subjects}
                    onValueChange={setTitle}
                    disabled={saving}
                  />
                </span>
                <PaperSelect
                  ariaLabel="Тип"
                  value={kind}
                  options={EXAM_KINDS.map((value) => ({ value, label: KIND_WORDS[value] }))}
                  onChange={(value) => setKind(value)}
                  disabled={saving}
                />
                <span className="nx-sel">
                  <input type="date" aria-label="Дата, необязательно" value={examDate} onChange={(event) => setExamDate(event.target.value)} disabled={saving} />
                </span>
              </div>
              {/* The example in the field («Например, Микроэкономика») shows it; screen readers hear it in words. */}
              <p className="ex-sr" id="exam-title-hint">
                Только предмет — вид экзамена выбирается рядом
              </p>
            </div>

            {/* Right after the title: the marks depend on these lectures, and the title ticks them. */}
            <div className="nx-grp">
              <p className="nx-lbl">Лекции</p>
              <MaterialPicker
                materials={materials}
                selected={selected}
                onToggle={toggleMaterial}
                onSetMany={setManyMaterials}
                hint={!editing && !selectionTouched ? TICK_HINTS[suggestionReason(materials, title)] : null}
                onImport={(files) => void importFiles(files)}
                imports={imports}
                loading={materialsState === 'loading'}
                error={materialsState === 'error' ? EXAM_MESSAGES.materials : null}
                onRetry={() => void loadMaterials()}
                disabled={saving}
              />
            </div>

            <div className="nx-grp">
              <p className="nx-lbl">Билеты</p>
              <p className="nx-line">
                В билете{' '}
                <PaperSelect
                  ariaLabel="Вопросов в билете"
                  value={perTicket}
                  options={sizeOptions.map((value) => ({ value, label: String(value) }))}
                  onChange={(value) => setPerTicket(value)}
                  disabled={saving || layoutMode === 'fixed'}
                />{' '}
                {pluralRu(perTicket, QUESTION_FORMS)},{' '}
                <PaperSelect
                  ariaLabel="Как составлены билеты"
                  value={layoutMode}
                  options={[
                    { value: 'random' as LayoutMode, label: 'случайные' },
                    ...(filledSections > 0 && filledSections === perTicket ? [{ value: 'sections' as LayoutMode, label: 'по одному из каждого раздела' }] : []),
                    ...(hasTickets ? [{ value: 'fixed' as LayoutMode, label: 'как в списке билетов' }] : []),
                  ]}
                  onChange={(value) => setLayoutChoice(value)}
                  disabled={saving}
                />
              </p>
              <p className="ex-meta">
                {layoutMode === 'fixed'
                  ? glue(`${preview.tickets.length} ${pluralRu(preview.tickets.length, ['билет', 'билета', 'билетов'])} из списка кафедры: доли посчитаем по ним.`)
                  : 'Знаете состав билетов? Вставьте и их список — посчитаем по нему.'}
              </p>
              {perTicket === 1 && layoutMode !== 'fixed' && <p className="ex-meta">Один вопрос в билете: на листе будет «Тянуть вопрос».</p>}
            </div>

            <div className="nx-go">
              {frame.side && primary}
              {!editing && canSave && usableSelected.length > 0 && <p className="ex-meta nx-go-note">{glue(mapNext(usableSelected.length))}</p>}
              {disabledReason && total > 0 && (
                <p className="ex-note" id={frame.side ? SAVE_WHY_ID : undefined}>
                  {disabledReason}
                </p>
              )}
              {saveError && (
                <p className="ex-note" role="alert">
                  {saveError}
                </p>
              )}
              {editing && bundle && (
                <button type="button" className="sf-link" data-muted="" onClick={() => void remove()} disabled={saving}>
                  Удалить экзамен
                </button>
              )}
            </div>
          </aside>
        </div>
      )}

      {!frame.side && total > 0 && (
        <div className="ex-cta">
          {/* A phone: why the button is off, right above it (the form with the same line is far below). */}
          {disabledReason && (
            <p className="ex-cta-why" id={SAVE_WHY_ID}>
              {disabledReason}
            </p>
          )}
          {primary}
        </div>
      )}
    </div>
  );
}
