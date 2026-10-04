import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
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
  type PreviewState,
  type SkippedLine,
} from '../components/exams/previewModel';
import { glue } from '../components/exams/sheetModel';
import { useFrame } from '../components/exams/useFrame';
import '../styles/paper.css';
import '../components/exams/exams.css';

const PARSE_ACCEPT = '.docx,.pdf,.txt,.md';
const QUESTION_FORMS = ['вопрос', 'вопроса', 'вопросов'] as const;
/** Where a student finds the list before pasting it (Jury_Check item 12, answer 21). */
const LIST_SOURCE_HINT = 'Список вопросов часто есть в рабочей программе дисциплины на сайте кафедры или у старосты.';

function Chevron() {
  return <ChevronDown aria-hidden="true" strokeWidth={2} />;
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
  const [tab, setTab] = useState<'paste' | 'file'>('paste');
  const [pasted, setPasted] = useState('');
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
  const [pickerOpen, setPickerOpen] = useState(location.hash === '#lectures');
  const [imports, setImports] = useState<ImportStatus[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    setPickerOpen(true);
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

  const importFiles = async (files: File[]) => {
    if (!user) return;
    setPickerOpen(true);
    for (const file of files) {
      const key = `${file.name}:${file.size}:${Date.now()}`;
      setImports((current) => [...current, { key, name: file.name, state: 'pending' }]);
      try {
        const material = await importTextOnlyMaterial(user.id, file);
        setMaterials((current) => [material, ...current.filter((item) => item.id !== material.id)]);
        setSelectionTouched(true);
        setSelected((current) => new Set(current).add(material.id));
        setImports((current) => current.map((item) => (item.key === key ? { ...item, state: 'done' } : item)));
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
      message: `«${bundle.exam.title}» и разметка его вопросов будут удалены. Ответы останутся в истории и в «Прогрессе».`,
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
          ? 'Сохранить и разметить'
          : 'Сохранить'
        : 'Разметить по лекциям';
  const disabledReason = lockedByMapping
    ? 'Идёт разметка — список можно будет изменить, когда она закончится.'
    : total === 0
      ? null
      : titleMissing
        ? 'Назовите экзамен.'
        : listIssue;

  const sizeOptions = [1, 2, 3, 4];
  const primary = (
    <button type="button" className="sf-primary" disabled={!canSave} onClick={() => void save()}>
      {primaryLabel}
    </button>
  );

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
      </header>

      {lockedByMapping && (
        <p className="ex-note" role="status">
          Идёт разметка — список можно будет изменить, когда она закончится.
        </p>
      )}

      <div className="nx-body">
        <section aria-label="Вопросы кафедры" style={{ minWidth: 0 }}>
          {total === 0 ? (
            <>
              <div className="nx-tabs" role="tablist" aria-label="Как добавить список">
                <button type="button" role="tab" aria-selected={tab === 'paste'} onClick={() => setTab('paste')}>
                  Вставить текст
                </button>
                <button type="button" role="tab" aria-selected={tab === 'file'} onClick={() => setTab('file')}>
                  Файл
                </button>
              </div>
              {tab === 'paste' ? (
                <div className="sf-sheet nx-blank">
                  <textarea
                    aria-label="Список вопросов"
                    placeholder="Вставьте текст списка из файла кафедры"
                    value={pasted}
                    disabled={parsing || lockedByMapping}
                    onChange={(event) => setPasted(event.target.value)}
                    onPaste={(event) => {
                      const text = event.clipboardData?.getData('text') ?? '';
                      if (text.trim().length > 20 && pasted.trim() === '') {
                        const target = event.currentTarget;
                        window.setTimeout(() => void parse({ text: target.value || text }), 0);
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="sf-sheet nx-blank">
                  <div className="nx-file">
                    <button type="button" className="ex-secondary" disabled={parsing || lockedByMapping} onClick={() => fileRef.current?.click()}>
                      Выбрать файл
                    </button>
                    <p>DOCX, PDF, TXT или MD — список, как его дала кафедра.</p>
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
                </div>
              )}
              <p className="ex-meta">{glue(LIST_SOURCE_HINT)}</p>
              <div className="nx-under">
                {tab === 'paste' && (
                  <button
                    type="button"
                    className="ex-secondary"
                    disabled={parsing || pasted.trim().length === 0 || lockedByMapping}
                    onClick={() => void parse({ text: pasted })}
                  >
                    {parsing ? 'Распознаём…' : 'Распознать вопросы'}
                  </button>
                )}
                {parsing && tab === 'file' && <p className="ex-meta">Распознаём…</p>}
              </div>
              {parseError && (
                <p className="ex-note" role="alert">
                  {parseError}
                </p>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </section>

        <aside className="nx-form" aria-label="Экзамен, билеты и лекции">
          <div className="nx-grp">
            <p className="nx-lbl">Экзамен</p>
            <div className="nx-fields">
              <span className="nx-sel nx-sel-title">
                <input
                  aria-label="Название экзамена"
                  aria-describedby="exam-title-hint"
                  placeholder="Микроэкономика"
                  value={title}
                  maxLength={200}
                  list="exam-subjects"
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={saving}
                />
              </span>
              <span className="nx-sel">
                <select aria-label="Тип" value={kind} onChange={(event) => setKind(event.target.value as ExamKind)} disabled={saving}>
                  {EXAM_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {KIND_WORDS[value]}
                    </option>
                  ))}
                </select>
                <Chevron />
              </span>
              <span className="nx-sel">
                <input type="date" aria-label="Дата, необязательно" value={examDate} onChange={(event) => setExamDate(event.target.value)} disabled={saving} />
              </span>
            </div>
            <p className="ex-meta" id="exam-title-hint">
              Только предмет — вид экзамена выбирается рядом
            </p>
            <datalist id="exam-subjects">
              {subjects.map((subject) => (
                <option key={subject} value={subject} />
              ))}
            </datalist>
          </div>

          <div className="nx-grp">
            <p className="nx-lbl">Билеты</p>
            <p className="nx-line">
              В билете{' '}
              <span className="nx-sel">
                <select
                  aria-label="Вопросов в билете"
                  value={perTicket}
                  onChange={(event) => setPerTicket(Number(event.target.value))}
                  disabled={saving || layoutMode === 'fixed'}
                >
                  {sizeOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <Chevron />
              </span>{' '}
              {pluralRu(perTicket, QUESTION_FORMS)},{' '}
              <span className="nx-sel">
                <select aria-label="Как составлены билеты" value={layoutMode} onChange={(event) => setLayoutChoice(event.target.value as LayoutMode)} disabled={saving}>
                  <option value="random">случайные</option>
                  {filledSections > 0 && filledSections === perTicket && <option value="sections">по одному из каждого раздела</option>}
                  {hasTickets && <option value="fixed">как в списке билетов</option>}
                </select>
                <Chevron />
              </span>
            </p>
            <p className="ex-meta">
              {layoutMode === 'fixed'
                ? glue(`${preview.tickets.length} ${pluralRu(preview.tickets.length, ['билет', 'билета', 'билетов'])} из списка кафедры: доли посчитаем по ним.`)
                : 'Если знаете, какие вопросы стоят в каждом билете, вставьте список билетов — посчитаем по нему.'}
            </p>
            {perTicket === 1 && layoutMode !== 'fixed' && <p className="ex-meta">Один вопрос в билете: на листе будет «Тянуть вопрос».</p>}
          </div>

          <div className="nx-grp">
            <p className="nx-lbl">Лекции</p>
            <MaterialPicker
              materials={materials}
              selected={selected}
              onToggle={toggleMaterial}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onImport={(files) => void importFiles(files)}
              imports={imports}
              loading={materialsState === 'loading'}
              error={materialsState === 'error' ? EXAM_MESSAGES.materials : null}
              onRetry={() => void loadMaterials()}
              disabled={saving}
            />
          </div>

          <div className="nx-go">
            {frame.side && primary}
            {disabledReason && total > 0 && <p className="ex-note">{disabledReason}</p>}
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

      {!frame.side && total > 0 && <div className="ex-cta">{primary}</div>}
    </div>
  );
}
