import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listQuizzes } from '../../api/quizzes';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { rememberContainerTitle } from '../../lib/containers/titleCache';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { checkTest } from '../../lib/studio/checker';
import { createCanvasStore } from '../../components/studio/canvasStore';
import { useFrame } from '../../components/exams/useFrame';
import { KEYS } from '../../components/containers/copyImport';
import { useSavedLine } from '../../components/containers/keys/useSavedLine';
import { TO_EXAMS } from '../../components/containers/copy';
import { goneWords } from '../../components/test/copyTest';
import { useBuild } from '../../components/test/useBuild';
import { STUDIO, type Panel, type StudioView } from '../../components/studio/copyStudio';
import EmptyStart from '../../components/studio/EmptyStart';
import { UiIcon } from '../../components/studio/icons';
import { useLeaveGuard, type LeaveStep } from '../../components/studio/leave';
import { setLeaveCheck } from '../../lib/leaveCheck';
import LeavePrompt from '../../components/studio/LeavePrompt';
import ListView from '../../components/studio/ListView';
import { bottomBarShown, hasBottomBar, sendWords, useTyping } from '../../components/studio/phone';
import Preview from '../../components/studio/Preview';
import Side from '../../components/studio/Side';
import TextView from '../../components/studio/TextView';
import Tour, { useStudioTour } from '../../components/studio/Tour';
import { createUnsavedStore, UnsavedContext, useUnsavedEditors, type UnsavedEditor } from '../../components/studio/unsaved';
import { useDark } from '../../components/studio/useDark';
import { useStudio, type SaveState, type Studio } from '../../components/studio/useStudio';
import Workspace from '../../components/studio/Workspace';
import ExportSheet from '../../components/port/ExportSheet';
import GenerateSheet from '../../components/port/GenerateSheet';
import { PORT } from '../../components/port/copyPort';
import { DownloadIcon } from '../../components/port/portIcons';
import type { Uuid } from '../../types/container';
import type { QuizListRow } from '../../types/quiz';
import type { TestDoc } from '../../types/testDoc';
import '../../components/exams/exams.css';
import '../../components/studio/studio.css';
import { STUDIO_PASTE } from '../../components/quick/copyQuick';
import '../../components/quick/studioPaste.css';
import { rescuedFor } from '../../lib/draftRescue';

/**
 * /exams/c/:id/studio — «Студия теста» (spec meldy-notes 10_Project/Test_Builder_Spec_2026-10-18.md §47.6; plan
 * docs/superpowers/plans/2026-10-18-studio.md, «Canvas UI»): the test built like a site. Three views of one page —
 * «Холст» (the page as the participant sees it, edited in place: Workspace), «Список» (the release-47 cards: ListView)
 * and «Текст» (TextView) — over one document that saves itself (useStudio). The top bar: the views, a phone or a
 * computer for the canvas, «Отменить / Повторить» (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y), «Проверка теста», «Посмотреть как
 * участник» and «Отправить по ссылке» (the quiz setup with every question of the page, «как в студии»).
 *
 * Saving (owner, 04.11: «нет кнопки сохранить… если выйти по стрелке, ничего не меняется»): the page saves itself, a
 * question is saved by its editor's «Сохранить». Beside the status the top bar has its own «Сохранить» (and Ctrl+S, in
 * the editor too): the page now and the open question editor through its own checks (unsaved.ts). The status says
 * «Все изменения сохранены» only when neither waits, «Вопрос 3 не сохранён» while an editor holds changes. While
 * anything waits, leaving asks first (leave.ts: a link, the browser's «Назад» / «Вперёд», closing the tab; LeavePrompt:
 * «Сохранить и выйти», «Не сохранять», «Остаться»), and so do the views (an editor would close); inside «Холст» another
 * block, another tab of the settings or closing the phone's sheet wait for the editor's own answer, as before.
 * «Отправить по ссылке» saves the open question first. One quiet line on the canvas says where changes go.
 *
 * Pages (owner, 05.11: an exam of 960 questions, the canvas held 400): «Холст» shows one page of the test at a time
 * (Workspace, lib/studio/pages.ts). Another page from its bar waits for the question editor's answer as another block
 * does; a block chosen on another page («Показать» of «Проверка теста», ↑ ↓, a link `?block=<id>`) brings its page.
 */

const VIEWS: StudioView[] = ['canvas', 'list', 'text'];

/**
 * The page as it stands once typing pauses (300 ms): the check's hints are worked out from it, not at every key (the
 * smoothness audit of 20.10: «Проверка» ran over the whole page at each letter). A change of the blocks' order or number,
 * of the layout or of the questions is taken at once.
 */
function useSettledDoc(doc: TestDoc, ms = 300): TestDoc {
  const [settled, setSettled] = useState(doc);
  useEffect(() => {
    if (settled === doc) return undefined;
    const timer = window.setTimeout(() => setSettled(doc), ms);
    return () => window.clearTimeout(timer);
  }, [doc, settled, ms]);
  const sameShape =
    settled.layout === doc.layout &&
    settled.blocks.length === doc.blocks.length &&
    settled.blocks.every((block, at) => block.id === doc.blocks[at].id && block.type === doc.blocks[at].type);
  return sameShape ? settled : doc;
}

/** The step the leave question waits on: a way out of the page (leave.ts), «Отправить по ссылке» or another view. */
type AskStep =
  | LeaveStep
  | { kind: 'send' }
  | { kind: 'view'; view: StudioView; check?: boolean }
  /** Out of the signed-in app without a link (the account menu's «Выйти», lib/leaveCheck): `done` answers it. */
  | { kind: 'out'; done: (go: boolean) => void };
/** A step inside «Холст» that waits for the editor's own «Сохранить» / «Не сохранять». */
type HeldStep = { kind: 'select'; id: string | null } | { kind: 'panel'; panel: Panel } | { kind: 'close' } | { kind: 'page'; page: number };

/** What the top bar's «Сохранить» left unsaved: a question (its editor says why) or the page (the status says why). */
type SaveResult = { ok: true } | { ok: false; what: 'question' | 'page' };

/** Which line says where the changes go: a link «как в студии» exists, only older links, or none yet. */
export function whereKind(quizzes: readonly Pick<QuizListRow, 'design' | 'state'>[]): 'design' | 'plain' | 'none' {
  const open = quizzes.filter((quiz) => quiz.state !== 'closed');
  if (open.some((quiz) => quiz.design)) return 'design';
  return open.length > 0 ? 'plain' : 'none';
}

const whereKey = (containerId: string) => `meldy_studio_where:${containerId}`;

/** Why the page did not save, in a few words (the leave question's line). */
function pageWhy(save: SaveState): string {
  if (save.kind === 'offline') return 'нет связи.';
  if (save.kind === 'failed') return save.message;
  if (save.kind === 'invalid') return save.problems[0]?.message ?? '';
  return STUDIO.failed;
}

const SaveLine = memo(function SaveLine({
  save,
  pending,
  editors,
  saving,
  onRetry,
  onReload,
}: {
  save: SaveState;
  pending: boolean;
  editors: readonly UnsavedEditor[];
  saving: boolean;
  onRetry: () => void;
  onReload: () => void;
}) {
  const failing = save.kind === 'offline' || save.kind === 'failed' || save.kind === 'invalid' || save.kind === 'stale';
  if (!failing) {
    if (saving || editors.some((editor) => editor.busy)) {
      return (
        <span className="st-save" role="status">
          <span className="st-save-t">{STUDIO.saving}</span>
        </span>
      );
    }
    if (editors.length > 0) {
      return (
        <span className="st-save" data-warn="" role="status">
          <span className="st-save-dot" aria-hidden="true" />
          <span className="st-save-t">
            {editors.some((editor) => editor.kind === 'text') ? STUDIO.textUnapplied : STUDIO.questionUnsaved(editors.map((editor) => editor.number))}
          </span>
        </span>
      );
    }
    if (save.kind === 'saving' || pending) {
      return (
        <span className="st-save" role="status">
          <span className="st-save-t">{STUDIO.saving}</span>
        </span>
      );
    }
    return (
      <span className="st-save" data-ok="" role="status" title={STUDIO.allSaved}>
        <UiIcon name="check" />
        <span className="st-save-t">
          <span className="st-save-long">{STUDIO.allSaved}</span>
          <span className="st-save-short" aria-hidden="true">
            {STUDIO.allSavedShort}
          </span>
        </span>
      </span>
    );
  }
  switch (save.kind) {
    case 'offline':
    case 'failed':
      return (
        <span className="st-save" data-bad="">
          <span className="st-save-t">{save.kind === 'offline' ? STUDIO.offline : `${STUDIO.failed}: ${save.message}`}</span>
          <button type="button" className="st-save-btn" onClick={onRetry}>
            {STUDIO.retry}
          </button>
        </span>
      );
    case 'invalid':
      return (
        <span className="st-save" data-bad="" title={save.problems[0]?.message}>
          <span className="st-save-t">{`${STUDIO.invalid}: ${save.problems[0]?.message ?? ''}`}</span>
        </span>
      );
    case 'stale':
      return (
        <span className="st-save" data-bad="">
          <span className="st-save-t">{STUDIO.stale}</span>
          <button type="button" className="st-save-btn" onClick={onReload}>
            {STUDIO.reload}
          </button>
        </span>
      );
  }
  return null;
});

export default function StudioPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const containerId = (params.id ?? '') as Uuid;
  const frame = useFrame<HTMLDivElement>();
  const phone = frame.size === 's';
  /** Below a computer's width the palette and the settings are sheets, opened from the bottom bar. */
  const narrow = hasBottomBar(frame.size);
  /** A field of the page takes the keyboard: the bottom bar steps away (it would stand over the field). */
  const mainRef = useRef<HTMLElement>(null);
  const typing = useTyping(mainRef);
  const build = useBuild(containerId);
  const { data, summary, owner, group } = build;
  /** «Счёт… начнётся заново» only where somebody's answers were counted (not on a new test's first saves). */
  const savedLine = useSavedLine(data.data?.planInput, group);
  const studio = useStudio(containerId, build);
  const { user } = useAuth();
  const dark = useDark();
  useDocumentTitle(summary ? `${STUDIO.docTitle} · ${summary.title}` : STUDIO.docTitle);
  useEffect(() => {
    if (summary) rememberContainerTitle(summary.id, summary.title);
  }, [summary]);

  const initialView = search.get('view');
  const [view, setView] = useState<StudioView>(VIEWS.includes(initialView as StudioView) ? (initialView as StudioView) : 'canvas');
  /**
   * The view a tap on «Холст · Список · Текст» chose, until the page has followed: the segment moves at once, the view
   * itself comes in a transition (smoothness debt: «Список» mounted its 30 cards inside the tap, ~200 ms on a mid phone).
   */
  const [pressedView, setPressedView] = useState<StudioView | null>(null);
  const showView = (next: StudioView) => {
    setPressedView(next);
    startTransition(() => {
      setView(next);
      setPressedView(null);
    });
  };
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  /** The canvas's own facts (the chosen block, the text typed in…): read by the frame or gap they concern (canvasStore). */
  const [store] = useState(createCanvasStore);
  const [panel, setPanel] = useState<Panel>('block');
  /** The page of the test «Холст» shows (from 0; Workspace clamps it to the pages there are). */
  const [canvasPage, setCanvasPage] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [preview, setPreview] = useState<{ device: 'phone' | 'desktop'; percent: number | null } | null>(null);
  const [textStart, setTextStart] = useState<{ text: string; round: number } | null>(null);
  const [touring, setTouring] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  /**
   * A step inside «Холст» taken while the panel's question editor holds changes (another block, another tab of the
   * settings, closing the phone's sheet): waits for the editor's «Сохранить» / «Не сохранять», with the question's number.
   */
  const [waiting, setWaiting] = useState<{ step: HeldStep; number: number } | null>(null);
  const [sendNote, setSendNote] = useState<string | null>(null);
  /** The question editors holding changes (the canvas's panel, «Список»): the top bar saves them too. */
  const [unsaved] = useState(createUnsavedStore);
  const editors = useUnsavedEditors(unsaved);
  /** The top bar's «Сохранить» (or Ctrl+S, or «Сохранить и выйти») is on its way; a second press waits for that one. */
  const [saving, setSaving] = useState(false);
  const savingRef = useRef<Promise<SaveResult> | null>(null);
  /** The question before leaving: the step it holds, whether its save is on its way, what did not save. */
  const [leaving, setLeaving] = useState<{ step: AskStep; busy: boolean; failed: 'question' | 'page' | null } | null>(null);
  /** Release 49: «Скачать тест файлом» or «Сгенерировать вопросы». */
  const [port, setPort] = useState<'export' | 'generate' | null>(null);
  const openGenerate = useCallback(() => setPort('generate'), []);

  const items = build.items;
  const checked = useSettledDoc(studio.doc);
  const hints = useMemo(() => (studio.phase === 'ready' ? checkTest(checked, items) : []), [studio.phase, checked, items]);
  const numbers = useMemo(() => {
    const out = new Map<string, number>();
    for (const block of studio.doc.blocks) if (block.type === 'question' && studio.rows.has(block.item_id)) out.set(block.id, out.size + 1);
    return out;
  }, [studio.doc.blocks, studio.rows]);
  // The questions in the page's order and their numbers there (the export names a question left out by it).
  const [pageItems, itemNumbers] = useMemo(() => {
    const list = [];
    const byItem = new Map<string, number>();
    for (const block of studio.doc.blocks) {
      const row = block.type === 'question' ? studio.rows.get(block.item_id) : undefined;
      if (!row) continue;
      list.push(row);
      byItem.set(row.id, list.length);
    }
    return [list, byItem] as const;
  }, [studio.doc.blocks, studio.rows]);

  // The first visit's tour, once the page has its first block (UX audit of 21.10: it covered the empty page's starters),
  // when neither this device nor the profile says it was seen.
  const tourDue = useStudioTour(user?.id, studio.phase === 'ready' && studio.doc.blocks.length > 0);
  useEffect(() => {
    if (tourDue) setTouring(true);
  }, [tourDue]);

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: the page's steps (the question editor and the text field keep their own).
  const { undo, redo } = studio;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const isZ = event.code === 'KeyZ' || key === 'z' || key === 'я';
      const isY = event.code === 'KeyY' || key === 'y' || key === 'н';
      if (!isZ && !isY) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.qe, .st-textview, .st-menu, .st-preview, .st-listview')) return;
      event.preventDefault();
      if (isY || event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ───────────────────────────── holding the editor's changes inside «Холст» ─────────────────────────────

  /** A step inside «Холст» waits while the panel's question editor holds changes; true when it was held. */
  const setSelected = (id: string | null) => store.set({ selected: id });
  const hold = (step: HeldStep): boolean => {
    const selected = store.get().selected;
    const current = selected ? studio.doc.blocks.find((block) => block.id === selected) : null;
    if (!(editorDirty && current?.type === 'question' && panel === 'block')) return false;
    setWaiting({ step, number: (selected && numbers.get(selected)) || 0 });
    return true;
  };
  const take = (step: HeldStep) => {
    if (step.kind === 'select') setSelected(step.id);
    else if (step.kind === 'panel') setPanel(step.panel);
    else if (step.kind === 'page') {
      // Another page from its top, nothing chosen on it yet (the settings show the page's own).
      setSelected(null);
      setCanvasPage(step.page);
    } else setSideOpen(false);
  };
  const select = (id: string | null) => {
    if (id === store.get().selected) return;
    if (!hold({ kind: 'select', id })) setSelected(id);
  };
  const choosePanel = (next: Panel) => {
    if (next === panel) return;
    if (!hold({ kind: 'panel', panel: next })) setPanel(next);
  };
  /** Another page of «Холст» (its bar): as another block, it waits for the question editor's answer. */
  const choosePage = (next: number) => {
    if (next === canvasPage) return;
    if (!hold({ kind: 'page', page: next })) take({ kind: 'page', page: next });
  };
  const openSide = (open: boolean) => {
    if (open) setSideOpen(true);
    else if (!hold({ kind: 'close' })) setSideOpen(false);
  };
  const goOn = () => {
    const step = waiting?.step;
    setWaiting(null);
    setEditorDirty(false);
    if (step) take(step);
  };

  // ───────────────────────────── saving everything, and leaving ─────────────────────────────

  /** «Сохранить» of the top bar: each open question through its editor, then the page at once. */
  const studioRef = useRef<Studio>(studio);
  studioRef.current = studio;
  const saveAll = useCallback((): Promise<SaveResult> => {
    // Ctrl+S and then «Отправить по ссылке» at once: the second gets the first one's answer, not a refusal.
    if (savingRef.current) return savingRef.current;
    const run = (async (): Promise<SaveResult> => {
      setSaving(true);
      try {
        for (const editor of unsaved.list()) if (!(await editor.save())) return { ok: false, what: 'question' };
        // «Тест изменён в другой вкладке»: the page waits for «Обновить»; the questions are saved.
        if (studioRef.current.save.kind === 'stale') return { ok: true };
        return (await studioRef.current.flush()) ? { ok: true } : { ok: false, what: 'page' };
      } finally {
        savingRef.current = null;
        setSaving(false);
      }
    })();
    savingRef.current = run;
    return run;
  }, [unsaved]);

  // Ctrl+S (⌘S), in the editor's fields too: everything saved; never the browser's «Сохранить страницу».
  const saveAllRef = useRef(saveAll);
  saveAllRef.current = saveAll;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.code !== 'KeyS' && key !== 's' && key !== 'ы') return;
      event.preventDefault();
      void saveAllRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  /** Something would be lost by leaving: an editor's changes, or the page's not yet on the server. */
  const guarding = studio.phase === 'ready' && (editors.length > 0 || studio.pending);
  const sendTo = `/exams/c/${containerId}/quizzes/new?all=1&design=1`;
  const goRef = useRef<(step: LeaveStep) => void>(() => undefined);
  const leavingRef = useRef(leaving);
  leavingRef.current = leaving;
  /** The question opens (or turns to a new step); a sign-out it held is told «stay». */
  const askAbout = (step: AskStep, failed: 'question' | 'page' | null = null) => {
    const before = leavingRef.current?.step;
    if (before && before !== step && before.kind === 'out') before.done(false);
    setLeaving({ step, busy: false, failed });
  };
  /** The step goes; `dropped`: «Не сохранять» — no kept draft of an editor comes back. */
  const proceed = (step: AskStep, dropped = false) => {
    setLeaving(null);
    if (dropped) unsaved.forgetKept();
    if (step.kind === 'link' || step.kind === 'history') goRef.current(step);
    else if (step.kind === 'out') step.done(true);
    else if (step.kind === 'send') void sendNow();
    else {
      showView(step.view);
      if (step.check) {
        setPanel('check');
        if (narrow) setSideOpen(true);
      }
    }
  };
  /** A leave's own flush is on its way (only the page waited): another way out meanwhile is not taken twice. */
  const flushing = useRef(false);
  /** A way out: with only the page waiting it is sent now and the step goes; otherwise the question. */
  const leave = async (step: AskStep) => {
    // While «Сохранить и выйти» saves, or the page is being sent for a step already taken, another step is dropped (the
    // browser's «Назад» is taken back by the guard all the same).
    if (leavingRef.current?.busy || flushing.current) {
      if (step.kind === 'out') step.done(false);
      return;
    }
    if (unsaved.list().length === 0 && studioRef.current.save.kind !== 'stale') {
      flushing.current = true;
      let sent = false;
      try {
        sent = await studioRef.current.flush();
      } finally {
        flushing.current = false;
      }
      if (sent) {
        proceed(step);
        return;
      }
    }
    askAbout(step);
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  goRef.current = useLeaveGuard(guarding, (step) => void leave(step), navigate);
  // «Выйти» of the account menu asks here too while anything waits (lib/leaveCheck).
  useEffect(() => {
    if (!guarding) return undefined;
    return setLeaveCheck(() => new Promise<boolean>((done) => void leaveRef.current({ kind: 'out', done })));
  }, [guarding]);
  // The question asked about the page alone, and the page saved meanwhile (the network came back): the step goes.
  useEffect(() => {
    if (leaving && !leaving.busy && editors.length === 0 && !studio.pending && studio.save.kind !== 'stale' && leaving.step.kind !== 'view') proceed(leaving.step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, editors.length, studio.pending, studio.save.kind]);
  const saveAndLeave = async () => {
    if (!leaving) return;
    const step = leaving.step;
    setLeaving({ step, busy: true, failed: null });
    const result = await saveAll();
    if (result.ok) proceed(step);
    else setLeaving({ step, busy: false, failed: result.what });
  };
  const stay = () => {
    const step = leavingRef.current?.step;
    if (step?.kind === 'out') step.done(false);
    setLeaving(null);
  };

  // The window narrowed (a tablet turned) while the canvas's question editor held changes: the settings go from the
  // right column into a phone's sheet; the sheet opens, and the editor there takes its kept draft back (unsaved.ts).
  const wasNarrow = useRef(narrow);
  useEffect(() => {
    if (narrow && !wasNarrow.current && editorDirty && panel === 'block' && view === 'canvas') setSideOpen(true);
    wasNarrow.current = narrow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow]);

  /** «Холст · Список · Текст»: the open question editor of this view would close — asked first. */
  const chooseView = (next: StudioView) => {
    if (next !== view && unsaved.list().length > 0) {
      askAbout({ kind: 'view', view: next });
      return;
    }
    showView(next);
  };
  const openCheck = () => {
    if (view !== 'canvas' && unsaved.list().length > 0) {
      askAbout({ kind: 'view', view: 'canvas', check: true });
      return;
    }
    setView('canvas');
    if (narrow) setSideOpen(true);
    choosePanel('check');
  };

  const showBlock = (blockId: string) => {
    setView('canvas');
    select(blockId);
    // A block of another page is drawn once its page is (Workspace follows the choice): looked for a few times.
    const reveal = (tries: number) => {
      const node = document.querySelector<HTMLElement>(`[data-block="${blockId}"]`);
      if (!node) {
        if (tries > 0) window.setTimeout(() => reveal(tries - 1), 40);
        return;
      }
      node.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      node.focus({ preventScroll: true });
    };
    window.setTimeout(() => reveal(8), 0);
  };
  // A link to a block (`?block=<id>`): once the page is read, the block is chosen and shown, on its page. Without one,
  // a question whose changes were kept when the login ran out (lib/draftRescue) is chosen: its editor takes them back.
  const linked = useRef(search.get('block'));
  useEffect(() => {
    if (studio.phase !== 'ready') return;
    const id = linked.current;
    linked.current = null;
    if (id && studio.doc.blocks.some((block) => block.id === id)) {
      showBlock(id);
      return;
    }
    const kept = rescuedFor(containerId).find((entry) => entry.itemId !== null);
    const block = kept ? studio.doc.blocks.find((entry) => entry.type === 'question' && entry.item_id === kept.itemId) : undefined;
    if (block) showBlock(block.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.phase]);

  /** The quiz setup, once the page is on the server (else «Не сохранено» stays here). */
  const sendNow = async () => {
    const before = studioRef.current.save.kind;
    const ok = await studioRef.current.flush();
    if (!ok && before !== 'idle') {
      setSendNote(STUDIO.failed);
      return;
    }
    navigate(sendTo);
  };
  /** «Отправить по ссылке»: the open question (or the text) is saved first (its problem asked about), then the page. */
  const send = async () => {
    setSendNote(null);
    if (unsaved.list().length > 0) {
      const result = await saveAll();
      if (!result.ok && result.what === 'question') {
        askAbout({ kind: 'send' }, 'question');
        return;
      }
      if (!result.ok) {
        setSendNote(STUDIO.failed);
        return;
      }
      navigate(sendTo);
      return;
    }
    await sendNow();
  };

  // ───────────────────────────── where the changes go ─────────────────────────────

  /** The exam's links, read once: whether one shows the studio's page («как в студии»). */
  const [quizzes, setQuizzes] = useState<readonly QuizListRow[] | null>(null);
  useEffect(() => {
    if (!owner || !containerId) return undefined;
    let live = true;
    // Not read (no network): no line — it would guess which links there are.
    listQuizzes(containerId).then(
      (rows) => live && setQuizzes(rows),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [owner, containerId]);
  const [whereSeen, setWhereSeen] = useState(() => {
    try {
      return window.localStorage.getItem(whereKey(containerId)) === '1';
    } catch {
      return false;
    }
  });
  const seeWhere = () => {
    setWhereSeen(true);
    try {
      window.localStorage.setItem(whereKey(containerId), '1');
    } catch {
      // A private window: the line comes back next time.
    }
  };

  // ───────────────────────────── screens before the studio ─────────────────────────────

  const simple = (children: React.ReactNode) => (
    <div className="sf-page st-page st-page-simple" ref={frame.ref} data-frame={frame.size}>
      <header className="ex-head">
        <p className="ex-crumb">
          <Link to="/exams">{TO_EXAMS}</Link>
        </p>
        <h1 className="ex-h1">{summary ? summary.title : STUDIO.docTitle}</h1>
      </header>
      {children}
    </div>
  );

  if (data.loading && !data.data) {
    return simple(
      <p className="tb-wait" role="status">
        {STUDIO.loading}
      </p>,
    );
  }
  if (!data.data || !summary || studio.phase === 'gone') {
    // The kind is known when the summary was read (the test went away while its studio was open).
    const gone = goneWords(summary ? summary.kind ?? 'exam' : null);
    return simple(
      data.gone || studio.phase === 'gone' ? (
        <p className="ex-note">
          {gone.title}. {gone.text}{' '}
          <Link className="sf-link" to="/exams">
            {TO_EXAMS}
          </Link>
        </p>
      ) : (
        <p className="ex-note" role="alert">
          {data.error && /[а-яё]/i.test(data.error) ? data.error : KEYS.loadFailed}{' '}
          <button type="button" className="sf-link" onClick={data.reload}>
            {KEYS.retry}
          </button>
        </p>
      ),
    );
  }
  if (!owner) {
    return simple(
      <>
        <p className="tb-lede">{KEYS.authorOnly}</p>
        <p>
          <Link className="sf-link" to={`/exams/c/${containerId}`}>
            {KEYS.toExam}
          </Link>
        </p>
      </>,
    );
  }
  if (studio.phase === 'error') {
    return simple(
      <p className="ex-note" role="alert">
        {STUDIO.loadFailed} {studio.loadError}{' '}
        <button type="button" className="sf-link" onClick={studio.retryLoad}>
          {KEYS.retry}
        </button>
      </p>,
    );
  }
  if (studio.phase === 'loading') {
    return simple(
      <p className="tb-wait" role="status">
        {STUDIO.loading}
      </p>,
    );
  }

  // ───────────────────────────── the studio ─────────────────────────────

  const keyed = build.keyed;
  const empty = (
    <EmptyStart
      busy={studio.busy === 'template' || studio.busy === 'question'}
      onTemplate={(id) => void studio.applyTemplate(id)}
      onPaste={() => {
        setTextStart({ text: STUDIO.textExample, round: (textStart?.round ?? 0) + 1 });
        setView('text');
      }}
      onGenerate={openGenerate}
      onQuestion={(type) =>
        void studio.addQuestion(type, studio.doc.blocks.length).then((block) => {
          if (!block) return;
          setSelected(block.id);
          setPanel('block');
          if (narrow) setSideOpen(true);
        })
      }
    />
  );
  const fixes = hints.filter((hint) => hint.level === 'fix').length;

  const side = (api: Parameters<React.ComponentProps<typeof Workspace>['side']>[0]) => (
    <Side
      studio={studio}
      api={api}
      panel={panel}
      onPanel={choosePanel}
      store={store}
      numbers={numbers}
      containerId={containerId}
      group={group}
      dark={dark}
      hints={hints}
      savedLine={savedLine}
      tabs={!(narrow && panel === 'check')}
      onShow={(blockId) => {
        showBlock(blockId);
        if (narrow) setSideOpen(false);
      }}
      onPreview={() => setPreview({ device: phone ? 'phone' : device, percent: null })}
      onPreviewBand={(percent) => setPreview({ device: phone ? 'phone' : device, percent })}
      onEditorDirty={setEditorDirty}
      unsaved={waiting ? STUDIO.editorUnsaved(waiting.number) : null}
      onDiscard={goOn}
      onSaved={() => {
        if (waiting) goOn();
      }}
    />
  );

  const sendButton = (
    <button
      type="button"
      className="sf-primary st-send"
      disabled={keyed === 0}
      title={keyed === 0 ? STUDIO.sendWhy : undefined}
      aria-label={STUDIO.send}
      aria-describedby={keyed === 0 ? 'st-send-why' : undefined}
      onClick={() => void send()}
    >
      {/* A phone narrower than 400 px: «Отправить» (19.10: «Отправить по ссылке» did not fit at 375 and 360). */}
      {narrow ? sendWords(frame.width) : STUDIO.send}
    </button>
  );

  // The top bar's «Сохранить»: anything waits (an editor, the page, a save that did not go) and nothing is on its way.
  const pageWaits = studio.pending || studio.save.kind === 'failed' || studio.save.kind === 'offline';
  const canSaveAll = !saving && !editors.some((editor) => editor.busy) && (editors.length > 0 || (pageWaits && studio.save.kind !== 'saving'));
  /** A failure has its own words and «Сохранить ещё раз» (or «Обновить»): the bar's button steps away for it. */
  const failing = studio.save.kind === 'offline' || studio.save.kind === 'failed' || studio.save.kind === 'invalid' || studio.save.kind === 'stale';
  const where = quizzes && !whereSeen && view === 'canvas' ? whereKind(quizzes) : null;
  const askKind = leaving ? (leaving.step.kind === 'send' ? 'send' : leaving.step.kind === 'view' ? 'view' : 'go') : 'go';
  /** «Текст» holds the changes (its editors and the text never wait together: each lives in its own view). */
  const textHeld = editors.some((editor) => editor.kind === 'text');
  const stale = studio.save.kind === 'stale';

  return (
    <UnsavedContext.Provider value={unsaved}>
    <div className="sf-page tb-page st-page" ref={frame.ref} data-frame={frame.size} data-view={view}>
      <header className="st-bar">
        <div className="st-bar-start">
          {phone ? null : (
            <Link className="st-back" to={`/exams/c/${containerId}`} aria-label={summary.title} title={summary.title}>
              <UiIcon name="back" />
            </Link>
          )}
          <div className="st-name">
            <h1 className="st-title">{summary.title}</h1>
            {/* The status and «Сохранить» under the name; where the bar is short (studio.css) the button stands in the
                status's place while it has something to save, and steps away when it has not. */}
            <div
              className="st-status"
              data-held={editors.length > 0 ? '' : undefined}
              data-busy={saving || editors.some((editor) => editor.busy) ? '' : undefined}
              data-fail={failing && editors.length === 0 ? '' : undefined}
              data-stale={stale ? '' : undefined}
            >
              <SaveLine save={studio.save} pending={studio.pending} editors={editors} saving={saving} onRetry={studio.retrySave} onReload={studio.reloadDoc} />
              <button
                type="button"
                className="st-saveall"
                disabled={!canSaveAll}
                aria-keyshortcuts="Control+S Meta+S"
                title={`${STUDIO.saveAllHint} · ${STUDIO.saveAllKeys}`}
                onClick={() => void saveAll()}
              >
                {STUDIO.saveAll}
              </button>
            </div>
          </div>
        </div>

        <div className="st-seg st-views" role="group" aria-label={STUDIO.viewsLabel}>
          {VIEWS.map((name) => (
            <button key={name} type="button" className="st-seg-btn" aria-pressed={(pressedView ?? view) === name} onClick={() => chooseView(name)}>
              <UiIcon name={name} />
              <span>{STUDIO.views[name]}</span>
            </button>
          ))}
        </div>

        <div className="st-bar-tools">
          {view === 'canvas' && !narrow ? (
            <div className="st-seg st-seg-icons" role="group" aria-label={STUDIO.deviceLabel}>
              {(['phone', 'desktop'] as const).map((name) => (
                <button key={name} type="button" className="st-seg-btn" aria-pressed={device === name} aria-label={STUDIO.device[name]} title={STUDIO.device[name]} onClick={() => setDevice(name)}>
                  <UiIcon name={name} />
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="st-icon-btn" aria-label={STUDIO.undo} title={`${STUDIO.undo} · ${STUDIO.undoKeys}`} disabled={!studio.canUndo} onClick={studio.undo}>
            <UiIcon name="undo" />
          </button>
          <button type="button" className="st-icon-btn" aria-label={STUDIO.redo} title={`${STUDIO.redo} · ${STUDIO.redoKeys}`} disabled={!studio.canRedo} onClick={studio.redo}>
            <UiIcon name="redo" />
          </button>
          {/* Release 49: the test as a GIFT, Moodle XML, Aiken or Kahoot file; by its icon alone below 1700 px. */}
          <button type="button" className="st-tool pt-tool" onClick={() => setPort('export')} aria-label={PORT.exportOpenLong} title={PORT.exportOpenLong}>
            <DownloadIcon />
            <span className="st-tool-word pt-tool-word" aria-hidden="true">
              {PORT.exportOpen}
            </span>
          </button>
          <button
            type="button"
            className="st-tool"
            aria-pressed={view === 'canvas' && panel === 'check' && (!narrow || sideOpen)}
            aria-label={narrow ? STUDIO.check : undefined}
            onClick={openCheck}
          >
            <span className="st-tool-word st-check-long">{STUDIO.check}</span>
            <span className="st-tool-word st-check-short" aria-hidden="true">
              {STUDIO.checkShort}
            </span>
            {hints.length > 0 ? (
              <span className="st-badge" data-fix={fixes > 0 ? '' : undefined}>
                {hints.length}
              </span>
            ) : null}
          </button>
          {/* Narrow screens show its eye alone (studio.css): the name is always there. */}
          <button type="button" className="st-tool" data-tour="preview" onClick={() => setPreview({ device: phone ? 'phone' : device, percent: null })} aria-label={STUDIO.preview} title={STUDIO.preview}>
            <UiIcon name="eye" />
            <span className="st-tool-word st-preview-long">{STUDIO.preview}</span>
            <span className="st-tool-word st-preview-short" aria-hidden="true">
              {STUDIO.previewShort}
            </span>
          </button>
          {narrow ? null : sendButton}
        </div>
      </header>

      {studio.save.kind === 'stale' ? (
        <p className="st-line" data-bad="" role="alert">
          <strong>{STUDIO.stale}.</strong> {STUDIO.staleMore}{' '}
          <button type="button" className="sf-link" onClick={studio.reloadDoc}>
            {STUDIO.reload}
          </button>
        </p>
      ) : null}
      {studio.overflow > 0 ? <p className="st-line">{STUDIO.cap}</p> : null}
      {/* Why «Отправить по ссылке» waits, said on the page (UX audit of 21.10: it was a tooltip, and a phone hid the button). */}
      {keyed === 0 ? (
        <p id="st-send-why" className="st-line st-send-why">
          {items.length === 0 ? STUDIO_PASTE.sendWaitsEmpty : STUDIO.sendWhy}
        </p>
      ) : null}
      {sendNote ? (
        <p className="st-line" data-bad="" role="alert">
          {sendNote}
        </p>
      ) : null}
      {/* Where the changes go: one quiet line on the canvas until «Понятно» (the owner looked for a way to «обновить»). */}
      {where ? (
        <p className="st-line st-where">
          <span>{STUDIO.where[where]}</span>{' '}
          <button type="button" className="sf-link" onClick={seeWhere}>
            {STUDIO.whereOk}
          </button>
        </p>
      ) : null}

      {/* A section, not a second <main>: the site's Layout has the page's one (accessibility audit 07.11, A11Y-7). */}
      <section ref={mainRef} className="st-main" data-view={view} aria-label={STUDIO.workspace}>
        {/* «Холст» stays under «Список» and «Текст», hidden: coming back to it is instant (the audit: 30 blocks remounted). */}
        <Workspace
          studio={studio}
          containerId={containerId}
          dark={dark}
          device={device}
          phone={narrow}
          store={store}
          onSelect={select}
          panel={panel}
          onPanel={choosePanel}
          side={side}
          empty={empty}
          paletteOpen={paletteOpen}
          onPaletteOpen={setPaletteOpen}
          sideOpen={sideOpen}
          onSideOpen={openSide}
          active={view === 'canvas'}
          onGenerate={openGenerate}
          page={canvasPage}
          onPage={choosePage}
          onFollow={setCanvasPage}
        />
        {view === 'canvas' ? null : view === 'list' ? (
          <div className="st-scrollpage">
            <ListView studio={studio} build={build} containerId={containerId} group={group} savedLine={savedLine} />
          </div>
        ) : (
          <TextView key={textStart?.round ?? 0} studio={studio} items={items} start={textStart?.text ?? null} />
        )}
      </section>

      {narrow ? (
        <div className="st-phonebar" hidden={!bottomBarShown(frame.size, typing)}>
          {view === 'canvas' ? (
            <>
              <button type="button" className="st-tool" data-tour="palette-phone" onClick={() => setPaletteOpen(true)}>
                <UiIcon name="plus" />
                <span className="st-tool-word">{STUDIO.palette}</span>
              </button>
              <button
                type="button"
                className="st-tool st-tool-icon"
                aria-label={STUDIO.panelsLabel}
                title={STUDIO.panelsLabel}
                onClick={() => {
                  // «Проверка теста» has its own button: «Настройки» opens the settings themselves.
                  if (panel === 'check') setPanel('block');
                  setSideOpen(true);
                }}
              >
                <UiIcon name="sliders" />
              </button>
            </>
          ) : null}
          {sendButton}
        </div>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite">
        {studio.notice}
      </p>

      {port === 'export' ? <ExportSheet title={summary.title} items={pageItems} numbers={itemNumbers} onClose={() => setPort(null)} /> : null}
      {port === 'generate' ? (
        <GenerateSheet userId={user?.id ?? null} onAdd={async (inputs) => (await studio.addInputs(inputs)).length} onClose={() => setPort(null)} />
      ) : null}
      {preview ? <Preview doc={studio.doc} items={studio.rows} dark={dark} device={preview.device} percent={preview.percent} onClose={() => setPreview(null)} /> : null}
      {touring && user?.id && view === 'canvas' ? <Tour userId={user.id} phone={narrow} onDone={() => setTouring(false)} /> : null}
      {leaving ? (
        <LeavePrompt
          title={textHeld ? STUDIO.textUnapplied : editors.length > 0 ? STUDIO.leaveQuestion(editors.map((editor) => editor.number)) : STUDIO.leavePage}
          text={textHeld ? STUDIO.leaveTextText : editors.length > 0 ? STUDIO.leaveQuestionText : stale ? STUDIO.leaveStale : STUDIO.leavePageText}
          problem={
            leaving.failed === 'question'
              ? textHeld
                ? STUDIO.leaveFailedText
                : STUDIO.leaveFailedQuestion
              : leaving.failed === 'page'
                ? STUDIO.leaveFailedPage(pageWhy(studio.save))
                : null
          }
          busy={leaving.busy}
          saveLabel={editors.length === 0 && stale ? null : textHeld ? STUDIO.leaveApply[askKind] : STUDIO.leaveSave[askKind]}
          discardLabel={STUDIO.leaveDiscard}
          stayLabel={STUDIO.leaveStay}
          onSave={() => void saveAndLeave()}
          onDiscard={() => proceed(leaving.step, true)}
          onStay={stay}
        />
      ) : null}
    </div>
    </UnsavedContext.Provider>
  );
}
