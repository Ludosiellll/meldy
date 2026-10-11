import type { AnalysisResults, CoreSectionName, Material, SectionStates } from '../types';
import { useCallback, useState, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Globe, MoreHorizontal } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import ResultsPanel from '../components/ResultsPanel';
import ExpressPrepView from '../components/ExpressPrepView';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { deleteMaterial, getMaterialById, updateMaterialSubject, setMaterialVisibility, updateMaterialTitle } from '../api/materials';
import { SECTION_LABELS, parseSections, sectionHasContent } from '../utils/analysisSections';
import TipCard from '../components/tips/TipCard';
import { TIPS } from '../components/tips/tips';
import { useFirstUseTip } from '../components/tips/useFirstUseTip';
import {
  FolderItems,
  deleteLectureConfirm,
  forgetLecture,
  readAssignments,
  readFolders,
  withFolder,
  withNewFolder,
  writeAssignments,
  writeFolders,
  type LibraryFolder,
} from '../components/LectureFolders';
import { followupCardsOf } from '../lib/followupCards';
import { recognizedNotice } from '../lib/lectureFormats';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { usePhone } from '../lib/usePhone';
import { openingResultTab, resultTabs, type ResultExportItem, type ResultTab } from '../components/resultSections';
import '../styles/paper.css';
import './MaterialDetail.css';
import { displayMaterialTitle } from '../utils/materialTitle';

type Mode = 'full' | 'express' | 'podcast';

/** A tab of the phone's one row: a section of «Материал» (Конспект, Карточки, Тест) or a mode of the page. */
interface LectureTab {
  key: string;
  label: string;
  count?: number;
  mode: Mode;
  section?: ResultTab;
}

const PANEL_ID = 'material-mode-panel';
const tabId = (key: string) => `material-mode-${key}`;
/**
 * Decision 1 of 2026-10-08: the two hosts' audio is «Подкаст»; «Поговорить о лекции» is the tutor. The lecture's
 * выжимка has one name everywhere — the picker, its card, the analysis result's tab, the lecture's row in «Лекции» and
 * this tab (it was «Кратко» here until QA 2026-10-11).
 */
const MODE_LABELS: Record<Mode, string> = { full: 'Материал', express: SECTION_LABELS.cheatsheet, podcast: SECTION_LABELS.podcast };
const NBSP = '\u00a0';
/**
 * What opening a material means, said plainly: the link shows the title and the summary without an account
 * (public.shared_material — never the lecture's own text). There is no public feed of materials any more.
 */
export const PUBLISH_MESSAGE =
  'По ссылке любой сможет открыть название и конспект этого материала, без входа в Meldy. Исходный текст лекции по ссылке не показывается. Закрыть доступ можно в любой момент.';
/** Spec 4.6: nothing for the first 300 ms, then one quiet line instead of a spinner. */
const LOADING_LINE_MS = 300;

/**
 * «13 сентября, 23:16»: when the lecture was added, in words; the day and the month never part (finding LIB-21).
 * Without `withTime` the day alone, «13 сентября».
 */
export function addedAt(iso: string | null | undefined, withTime = true): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? format(date, withTime ? `d'${NBSP}'MMMM, H:mm` : `d'${NBSP}'MMMM`, { locale: ru }) : '';
}

/**
 * One meta line under the title (design critique 12, spec 5.2) instead of chips and «13.09.2026, 23:16»:
 * «Экономика · только для меня · 3 октября, 20:35». A line breaks only after a dot, never before one.
 * `short` (a phone, 10_Project/Phone_Declutter_2026-10-08): «Экономика · 3 октября» — the usual «только для меня» is
 * left out («⋯» has «Поделиться»), and so is the time of day; a lecture open by link or someone else's still says so.
 */
export function materialMeta(input: { subject?: string | null; isPublic: boolean; own: boolean; createdAt: string | null | undefined; short?: boolean }): string {
  const whoSees = input.own ? (input.isPublic ? 'открыт по ссылке' : input.short ? '' : 'только для меня') : 'материал другого автора';
  const line = [
    typeof input.subject === 'string' ? input.subject.trim() : '',
    whoSees,
    addedAt(input.createdAt, !input.short),
  ]
    .filter(Boolean)
    .join(`${NBSP}· `);
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * A phone too short for the first-use tip's sheet (320×640): under the lecture's header the sheet could only lie over
 * the tabs (finding LIB-4), so the tip waits for a taller screen; the pill's own words say what it does.
 */
const NO_ROOM_FOR_TIP = '(max-width: 639px) and (max-height: 719px)';

function useMediaQuery(query: string): boolean {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

/** The lecture's cards: an array (older materials) or `{ flashcards: [...] }`. */
function cardCountOf(material: any): number {
  if (Array.isArray(material?.flashcards_json)) return material.flashcards_json.length;
  return Array.isArray(material?.flashcards_json?.flashcards) ? material.flashcards_json.flashcards.length : 0;
}

/**
 * «Поговорить о лекции»: репетитор спрашивает по тексту лекции и её карточкам. Разговаривать можно только
 * о своей лекции (сервер отвечает 404 на чужую); без карточек комната сама скажет «сначала разберите лекцию».
 */
function canTalkAbout(material: any, userId: string | undefined): boolean {
  return Boolean(userId) && material?.user_id === userId && typeof material?.original_text === 'string' && material.original_text.trim() !== '';
}

function hasSavedCheatsheet(summary: Record<string, unknown>): boolean {
  return sectionHasContent('cheatsheet', { content: summary.cheatsheet });
}

/**
 * Статусы разделов для панели. Анализ записал их в момент запуска, а выжимку и
 * подкаст могли создать позже в «Выжимке» и «Подкасте»: если они сохранены, раздел есть,
 * что бы ни было записано тогда. Так панель не пишет о сбое того, что уже создано.
 */
function panelSections(summary: Record<string, unknown>): SectionStates | undefined {
  const saved = parseSections(summary.sections);
  if (!saved) return undefined;
  const next: SectionStates = { ...saved };
  if (next.cheatsheet && hasSavedCheatsheet(summary)) next.cheatsheet = { status: 'ok' };
  if (next.podcast && sectionHasContent('podcast', { podcast: summary.podcast })) next.podcast = { status: 'ok' };
  return next;
}

/**
 * Поля, которые «Создать … заново» записало в материал (ResultsPanel, persistSection):
 * созданный раздел, статусы и фрагменты. Остальное (другие разделы, выжимка, подкаст)
 * могло измениться, пока раздел создавался, поэтому в состояние страницы попадает только это.
 */
function recreatedFields(materialId: string, next: AnalysisResults, section: CoreSectionName) {
  const summaryJson: Record<string, unknown> = { sections: next.sections };
  if (next.grounding) summaryJson.grounding = next.grounding;
  if (section === 'summarizer') {
    const summary = (next.summarizer ?? {}) as unknown as Record<string, unknown>;
    summaryJson.content = summary.content;
    summaryJson.terms = summary.terms;
    summaryJson.source_ids = summary.source_ids;
    return { id: materialId, summary_json: summaryJson };
  }
  if (section === 'flashcards') return { id: materialId, flashcards_json: next.flashcards, summary_json: summaryJson };
  return { id: materialId, quiz_json: next.quiz, summary_json: summaryJson };
}

interface MaterialMenuProps {
  open: boolean;
  /** The author's actions (rename, subject, share, folder, delete); without them the menu is «Экспорт» only. */
  own: boolean;
  /**
   * A phone: «Экспорт» of the section on screen lives here (ResultsPanel's items, read when the menu opens), as
   * «Экспорт…» that turns the menu into the list of formats. Elsewhere «Экспорт» is a link by the tabs.
   */
  exportItems?: () => ResultExportItem[];
  isPublic: boolean;
  hasSubject: boolean;
  folders: LibraryFolder[];
  folderId: string;
  onToggle: () => void;
  onClose: () => void;
  onRename: () => void;
  onSubject: () => void;
  onShare: () => void;
  onCloseAccess: () => void;
  onMove: (folderId: string) => void;
  onNewFolder: (name: string) => void;
  onDelete: () => void;
}

const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"]';

/**
 * «⋯» of the lecture (spec 5.2): rename, subject, share, close access, the folder (kept on this device) and
 * «Удалить лекцию…» — on a phone the list of lectures has no «⋯» of its own, so this one has everything
 * (finding LIB-9). Only the author sees them; on a phone «Экспорт…» is here too, for anyone who can read the
 * lecture. Arrows move between items, Escape closes and returns focus to «⋯».
 */
function MaterialMenu({
  open,
  own,
  exportItems,
  isPublic,
  hasSubject,
  folders,
  folderId,
  onToggle,
  onClose,
  onRename,
  onSubject,
  onShare,
  onCloseAccess,
  onMove,
  onNewFolder,
  onDelete,
}: MaterialMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // «Экспорт…» turns the open menu into the list of formats; the menu opens on the actions again.
  const [formats, setFormats] = useState(false);
  const exportList = open && exportItems ? exportItems() : [];
  const onlyExport = !own;

  useEffect(() => {
    if (!open) {
      setFormats(false);
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) onClose();
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open, onClose]);

  // The focus goes to the first item when the menu opens and when it turns into the formats.
  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLButtonElement>(MENU_ITEMS)?.focus();
  }, [open, formats]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      onClose();
      buttonRef.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(MENU_ITEMS) ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
  };

  // A field opens for rename and subject and takes the focus; other actions give it back to «⋯».
  const pick = (action: () => void, refocus: boolean) => () => {
    onClose();
    if (refocus) buttonRef.current?.focus();
    action();
  };
  const move = (folderId: string) => pick(() => onMove(folderId), true)();
  const newFolder = (name: string) => pick(() => onNewFolder(name), true)();

  return (
    <div className="sf-head-more" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="sf-more md-round"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Действия с лекцией"
        onClick={onToggle}
      >
        <MoreHorizontal aria-hidden="true" strokeWidth={1.75} />
      </button>
      {open && (formats || onlyExport) ? (
        <div className="sf-menu md-menu lf-menu" role="menu" aria-label="Экспорт">
          {exportList.map((item) => (
            <button key={item.key} type="button" role="menuitem" onClick={pick(item.run, true)}>
              {item.label}
            </button>
          ))}
        </div>
      ) : open ? (
        <div className="sf-menu md-menu lf-menu" role="menu" aria-label="Действия с лекцией">
          <button type="button" role="menuitem" onClick={pick(onRename, false)}>
            Переименовать
          </button>
          <button type="button" role="menuitem" onClick={pick(onSubject, false)}>
            {hasSubject ? 'Изменить предмет' : 'Указать предмет'}
          </button>
          <div className="sf-menu-sep" role="separator" />
          <button type="button" role="menuitem" onClick={pick(onShare, true)}>
            Поделиться
          </button>
          {isPublic ? (
            <button type="button" role="menuitem" onClick={pick(onCloseAccess, true)}>
              Закрыть доступ
            </button>
          ) : null}
          {exportList.length > 0 ? (
            <button type="button" role="menuitem" aria-haspopup="menu" onClick={() => setFormats(true)}>
              Экспорт…
            </button>
          ) : null}
          <div className="sf-menu-sep" role="separator" />
          <FolderItems folders={folders} folderId={folderId} onMove={move} onNewFolder={newFolder} />
          <div className="sf-menu-sep" role="separator" />
          <button type="button" role="menuitem" data-danger="" onClick={pick(onDelete, true)}>
            Удалить лекцию…
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function MaterialDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // «Прогресс» links straight to a tab of the material: ?section=quiz | flashcards | summary.
  const sectionValue = searchParams.get('section');
  const sectionParam = sectionValue === 'quiz' || sectionValue === 'flashcards' || sectionValue === 'summary' ? sectionValue : undefined;
  const { user } = useAuth();
  const { confirm } = useConfirm();
  // A phone draws one row of tabs, «Конспект · Карточки 6 · Тест 5 · Подкаст», in place of the modes and the
  // results' own row, and keeps «Экспорт» in «⋯» (10_Project/Phone_Declutter_2026-10-08).
  const phone = usePhone();
  const tabRefs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});
  // The section of «Материал» the phone's row chose (null: the one the lecture opens on).
  const [sectionChoice, setSectionChoice] = useState<ResultTab | null>(null);
  // What «Экспорт» offers on the section on screen: ResultsPanel keeps it current, «⋯» reads it when it opens.
  const exportItemsRef = useRef<ResultExportItem[]>([]);
  // The phone's row fades at an edge while more tabs are hidden past it (320 px, or with «Выжимка»).
  const phoneRowRef = useRef<HTMLDivElement | null>(null);
  const [rowMore, setRowMore] = useState<'' | 'right' | 'left' | 'both'>('');
  const measureRow = useCallback(() => {
    const row = phoneRowRef.current;
    const right = Boolean(row && row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
    const left = Boolean(row && row.scrollLeft > 1);
    setRowMore(right && left ? 'both' : right ? 'right' : left ? 'left' : '');
  }, []);
  // The tab selected in the phone's row (set while rendering it) and the one last brought into the row's view.
  const rowSelectedRef = useRef<string | null>(null);
  const rowShownRef = useRef<string | null>(null);
  // After every render (the tabs may have changed) and when the window or the fonts change. A newly selected tab
  // that the row hides on the right (or left) is brought into it: the row scrolls, never the page.
  useEffect(() => {
    measureRow();
    const key = rowSelectedRef.current;
    const row = phoneRowRef.current;
    if (!key || !row || key === rowShownRef.current) return;
    rowShownRef.current = key;
    const tab = tabRefs.current[key];
    if (!tab) return;
    const bounds = row.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (box.right > bounds.right) row.scrollLeft += box.right - bounds.right + 28;
    else if (box.left < bounds.left) row.scrollLeft -= bounds.left - box.left;
  });
  useEffect(() => {
    window.addEventListener('resize', measureRow);
    void document.fonts?.ready?.then(measureRow);
    return () => window.removeEventListener('resize', measureRow);
  }, [measureRow]);
  const [material, setMaterial] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingLine, setLoadingLine] = useState(false);
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectInput, setSubjectInput] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(
    searchParams.get('mode') === 'express'
      ? (searchParams.get('tab') === 'podcast' ? 'podcast' : 'express')
      : 'full'
  );
  // Ссылки «Повторить за 5 минут» ведут сюда и без выжимки: тогда вкладка «Выжимка»
  // остаётся видна, чтобы выжимку можно было создать.
  const [expressRequested] = useState(() => searchParams.get('mode') === 'express' && searchParams.get('tab') !== 'podcast');
  // Ссылка прямо на подкаст: один раз показываем плеер целиком, дальше прокрутку не трогаем.
  const [revealPlayer, setRevealPlayer] = useState(() => searchParams.get('mode') === 'express' && searchParams.get('tab') === 'podcast');
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const talkPillRef = useRef<HTMLAnchorElement | null>(null);
  const headActsRef = useRef<HTMLDivElement | null>(null);
  // Folders of «Лекции» (this device only) for the lecture's «⋯».
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  // Cards this lecture got from ticket answers: they are reviewed with its own (lib/followupCards).
  const [followups, setFollowups] = useState(0);
  // The browser tab carries the lecture's name (page titles, 2026-10-08).
  useDocumentTitle(material ? displayMaterialTitle(material.title) : !loading ? 'Лекция не найдена' : null);
  // The first time a lecture the tutor can talk about is open (its own, with text and cards), a tip points at
  // «Поговорить о лекции» — on «Материал», the tab a lecture opens on, with no menu or field open, on a screen
  // with room for it.
  const noRoomForTip = useMediaQuery(NO_ROOM_FOR_TIP);
  const talkTip = useFirstUseTip('talk', {
    enabled:
      !noRoomForTip &&
      !loading &&
      Boolean(material) &&
      canTalkAbout(material, user?.id) &&
      cardCountOf(material) > 0 &&
      mode === 'full' &&
      !menuOpen &&
      !editingTitle &&
      !editingSubject,
  });

  useEffect(() => {
    if (!id) return;
    // A deleted lecture or an incomplete link reads as no row, not as an error: «Лекция не найдена».
    getMaterialById(id)
      .then(data => {
        if (!data) return;
        setMaterial(data);
        setSubjectInput(data.subject || '');
        setTitleInput(data.title || '');
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setLoadingLine(true), LOADING_LINE_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    setFolders(readFolders(user?.id));
    setAssignments(readAssignments(user?.id));
  }, [user?.id]);

  const ownLecture = Boolean(material && user?.id && material.user_id === user.id);
  useEffect(() => {
    setFollowups(0);
    if (!ownLecture || !user?.id || !id) return;
    let live = true;
    void followupCardsOf(user.id, id).then(count => {
      if (live) setFollowups(count);
    });
    return () => {
      live = false;
    };
  }, [ownLecture, user?.id, id]);

  const saveSubject = async () => {
    if (!id) return;
    try {
      await updateMaterialSubject(id, subjectInput);
    } catch (err) {
      console.error(err);
      toast.error('Не удалось сохранить предмет. Попробуйте ещё раз.');
      return;
    }
    setMaterial((prev: Material) => ({ ...prev, subject: subjectInput }));
    setEditingSubject(false);
  };

  const saveTitle = async () => {
    if (!id || !titleInput.trim()) return;
    try {
      await updateMaterialTitle(id, titleInput.trim());
    } catch (err) {
      console.error(err);
      toast.error('Не удалось сохранить название. Попробуйте ещё раз.');
      return;
    }
    setMaterial((prev: Material) => ({ ...prev, title: titleInput.trim() }));
    setEditingTitle(false);
  };

  const cancelTitle = () => {
    setEditingTitle(false);
    setTitleInput(material?.title || '');
  };

  const cancelSubject = () => {
    setEditingSubject(false);
    setSubjectInput(material?.subject || '');
  };

  /**
   * Открыть материал всем — заметное решение: открытый материал читается без входа,
   * поэтому полный текст, конспект и карточки сможет открыть и скопировать любой, у кого
   * есть ссылка («другие студенты» это преуменьшало, записка жюри, п. 13). Поэтому сначала
   * спрашиваем, а ссылку копируем и «В открытых материалах» показываем только после удачной записи.
   */
  const confirmPublish = () =>
    confirm({
      title: 'Открыть материал по ссылке?',
      message: PUBLISH_MESSAGE,
      confirmText: 'Открыть',
      cancelText: 'Отмена',
      type: 'warning',
      icon: Globe,
    });

  const publish = async (): Promise<boolean> => {
    if (!id) return false;
    if (!(await confirmPublish())) return false;
    try {
      await setMaterialVisibility(id, true);
    } catch (err) {
      console.error(err);
      toast.error('Не удалось открыть доступ. Попробуйте ещё раз.');
      return false;
    }
    setMaterial((prev: Material) => ({ ...prev, is_public: true }));
    return true;
  };

  const shareMaterial = async () => {
    if (!id || !material) return;
    const wasPublic = Boolean(material.is_public);
    if (!wasPublic && !(await publish())) return;
    const shareUrl = `${window.location.origin}/shared/${id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(wasPublic ? 'Ссылка скопирована' : 'Доступ открыт, ссылка скопирована');
    } catch (err) {
      console.error(err);
      toast(`Доступ открыт. Ссылка: ${shareUrl}`);
    }
  };

  const moveToFolder = (folderId: string) => {
    if (!id) return;
    const next = withFolder(assignments, id, folderId);
    setAssignments(next);
    writeAssignments(user?.id, next);
  };

  const newFolder = (name: string) => {
    if (!id) return;
    const next = withNewFolder(folders, assignments, id, name);
    setFolders(next.folders);
    setAssignments(next.assignments);
    writeFolders(user?.id, next.folders);
    writeAssignments(user?.id, next.assignments);
  };

  /** «Удалить лекцию…»: the same question as in «Лекции», naming what goes with it; afterwards the list, without it. */
  const removeLecture = async () => {
    if (!id || !material) return;
    const summary = material.summary_json && typeof material.summary_json === 'object' ? material.summary_json : {};
    const has = {
      summary: summary.text_only !== true && sectionHasContent('summarizer', summary),
      cards: cardCountOf(material) > 0,
      quiz: sectionHasContent('quiz', material.quiz_json),
      cheatsheet: hasSavedCheatsheet(summary),
      podcast: sectionHasContent('podcast', { podcast: summary.podcast }),
    };
    if (!(await confirm(deleteLectureConfirm(displayMaterialTitle(material.title), has)))) return;
    try {
      await deleteMaterial(id);
    } catch (err) {
      console.error(err);
      toast.error('Не удалось удалить лекцию. Повторите через минуту.');
      return;
    }
    forgetLecture(user?.id, id);
    toast.success('Лекция удалена');
    navigate('/library', { replace: true });
  };

  const closeAccess = async () => {
    if (!id || !material?.is_public) return;
    try {
      await setMaterialVisibility(id, false);
      setMaterial((prev: Material) => ({ ...prev, is_public: false }));
    } catch (err) {
      console.error(err);
      toast.error('Не удалось закрыть доступ. Попробуйте ещё раз.');
    }
  };

  // Результат для панели: статусы разделов и «только текст» берутся из summary_json.
  // Выжимка передаётся, чтобы строка о её сбое смотрела на сохранённый текст; подкаст
  // панель здесь не показывает (у него свой режим), поэтому его реплики не передаются.
  const panelResults = useMemo<AnalysisResults | null>(() => {
    if (!material) return null;
    const summary = material.summary_json && typeof material.summary_json === 'object' ? material.summary_json : {};
    return {
      summarizer: summary,
      flashcards: material.flashcards_json,
      quiz: material.quiz_json,
      cheatsheet: { content: typeof summary.cheatsheet === 'string' ? summary.cheatsheet : '' },
      grounding: summary.grounding,
      sections: panelSections(summary),
      text_only: summary.text_only === true,
    };
  }, [material]);
  // The sections as ResultsPanel shows them (no podcast: the page has its own «Подкаст»).
  const sectionTabs = useMemo(() => (panelResults ? resultTabs(panelResults) : []), [panelResults]);
  // «Текст распознан из записи…» (or from a scan, a photo) stands over the lecture's sections here as on the result
  // screen: the analysis saved how the text was got (summary_json.recognized; QA 2026-10-11: it was on the result only).
  const recognized = recognizedNotice(material?.summary_json?.recognized);

  if (loading) {
    return (
      <div className="sf-page md-page">
        <p className="sf-lede sf-loading-line" aria-live="polite">
          {loadingLine ? 'Загружаем лекцию…' : ' '}
        </p>
        {loadingLine ? (
          // The shape of the page while the lecture loads: a title, the tabs and the white sheet.
          <div className="md-skeleton" aria-hidden="true">
            <i className="md-skel-title" />
            <i className="md-skel-tabs" />
            <div className="md-skel-card">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (!material) {
    return (
      <div className="sf-page md-page">
        <div className="sf-state md-state">
          <h1 className="sf-h2">Лекция не найдена</h1>
          <p className="sf-state-text">Возможно, её удалили или ссылка неполная.</p>
          <p className="md-state-acts">
            <Link className="sf-secondary md-pill md-pill-back" to="/library">
              <span className="md-dot" aria-hidden="true">
                <ArrowLeft strokeWidth={2} />
              </span>
              Лекции
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const summaryJson: Record<string, unknown> =
    material.summary_json && typeof material.summary_json === 'object' ? material.summary_json : {};
  const hasCheatsheet = hasSavedCheatsheet(summaryJson);
  // Выжимку просили при анализе, а её нет: «Материал» пишет о сбое, «Выжимка» предлагает создать.
  const cheatsheetMissing = Boolean(parseSections(summaryJson.sections)?.cheatsheet) && !hasCheatsheet;
  // Менять материал (создавать выжимку и подкаст, открывать доступ) может только автор:
  // назначенные преподавателем и чужие открытые материалы только для чтения.
  const canEdit = Boolean(user?.id) && material.user_id === user?.id;
  const cardCount = cardCountOf(material);
  const canTalk = canTalkAbout(material, user?.id);
  // «Подкаст» доступен всегда: если его ещё нет, там можно его создать.
  const showExpress = hasCheatsheet || expressRequested || cheatsheetMissing;
  const modes: Mode[] = ['full', ...(showExpress ? (['express'] as const) : []), 'podcast'];

  const selectMode = (next: Mode) => {
    setRevealPlayer(false);
    setMode(next);
  };

  // Вкладки по образцу WAI-ARIA: стрелки, Home и End переключают и переносят фокус.
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % modes.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + modes.length) % modes.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = modes.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = modes[next];
    selectMode(target);
    tabRefs.current[target]?.focus();
  };

  // The section of «Материал» on screen: the phone row's choice, else the one the lecture opens on (?section=…).
  const section: ResultTab =
    sectionChoice && sectionTabs.some(tab => tab.id === sectionChoice)
      ? sectionChoice
      : openingResultTab(sectionTabs, panelResults as AnalysisResults, sectionParam);
  // The phone's one row: the sections of «Материал» («Материал» itself when there are none, as for a text-only
  // lecture), then the page's «Выжимка» and «Подкаст».
  const lectureTabs: LectureTab[] = [
    ...(sectionTabs.length > 0
      ? sectionTabs.map(tab => ({ key: tab.id, label: tab.label, count: tab.count, mode: 'full' as Mode, section: tab.id }))
      : [{ key: 'full', label: MODE_LABELS.full, mode: 'full' as Mode }]),
    ...(showExpress ? [{ key: 'express', label: MODE_LABELS.express, mode: 'express' as Mode }] : []),
    { key: 'podcast', label: MODE_LABELS.podcast, mode: 'podcast' as Mode },
  ];
  const lectureTab = mode === 'full' && sectionTabs.length > 0 ? section : mode;
  rowSelectedRef.current = phone ? lectureTab : null;
  const selectLectureTab = (item: LectureTab) => {
    selectMode(item.mode);
    if (item.section) setSectionChoice(item.section);
  };
  const handleLectureTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = lectureTabs.length;
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % count;
    else if (event.key === 'ArrowLeft') next = (index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = lectureTabs[next];
    selectLectureTab(target);
    tabRefs.current[target.key]?.focus();
  };
  // On a phone «Экспорт» of the section on screen is in «⋯»: for anyone who can read the lecture, as the link was.
  const exportInMenu = phone && mode === 'full' && sectionTabs.length > 0;

  const updateMaterialFields = (updatedFields: any) => {
    setMaterial((prev: any) => {
      if (!prev) return prev;
      // Работа модели могла закончиться, когда на странице уже другой материал: её результат не для него.
      if (updatedFields?.id && updatedFields.id !== prev.id) return prev;
      return {
        ...prev,
        ...updatedFields,
        summary_json: {
          ...prev.summary_json,
          ...(updatedFields.summary_json || {})
        }
      };
    });
  };

  const lectureTitle = displayMaterialTitle(material.title);
  const metaLine = materialMeta({ subject: material.subject, isPublic: Boolean(material.is_public), own: canEdit, createdAt: material.created_at, short: phone });
  const reviewHref = `/review?material=${encodeURIComponent(material.id)}`;
  const talkHref = `/library/${encodeURIComponent(material.id)}/talk`;
  // Below 1024 px the tab bar steps aside on a lecture (Layout.hidesBottomNav: a detail page keeps its one action
  // at the bottom), so the lecture's own action stays there while the page scrolls (finding LIB-31). On «Подкаст»
  // the player's controls hold the bottom of the screen instead.
  const bottomAction = cardCount > 0 && mode !== 'podcast';

  return (
    <div className="sf-page md-page" data-tab={mode === 'podcast' ? 'talk' : undefined} data-bottom={bottomAction ? '' : undefined}>
      {/* One header for every tab (finding LIB-3): the crumb (a desktop with room to spare), the title on a row of its
          own across the whole column at a size for long lecture titles, one meta line; then the tabs with the
          lecture's actions on their row. Nothing moves when a tab changes. */}
      <header className="md-head">
        <Link to="/library" className="sf-crumb md-crumb">
          <ArrowLeft aria-hidden="true" strokeWidth={2} />
          Лекции
        </Link>
        {editingTitle ? (
          <form
            className="sf-inline-edit"
            onSubmit={event => {
              event.preventDefault();
              void saveTitle();
            }}
          >
            <input
              className="sf-input sf-inline-title"
              aria-label="Название лекции"
              value={titleInput}
              onChange={event => setTitleInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') cancelTitle();
              }}
              autoFocus
            />
            <button type="submit" className="md-small-pill">
              Сохранить
            </button>
            <button type="button" className="sf-link" data-muted="" onClick={cancelTitle}>
              Отмена
            </button>
          </form>
        ) : (
          <h1 className="sf-h1 sf-h1-serif md-title">{lectureTitle}</h1>
        )}
        {editingSubject ? (
          <form
            className="sf-inline-edit"
            onSubmit={event => {
              event.preventDefault();
              void saveSubject();
            }}
          >
            <input
              className="sf-input"
              aria-label="Предмет"
              placeholder="Предмет"
              value={subjectInput}
              onChange={event => setSubjectInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') cancelSubject();
              }}
              autoFocus
            />
            <button type="submit" className="md-small-pill">
              Сохранить
            </button>
            <button type="button" className="sf-link" data-muted="" onClick={cancelSubject}>
              Отмена
            </button>
          </form>
        ) : (
          <p className="sf-lede md-meta">{metaLine}</p>
        )}
      </header>

      <div className="md-toolbar">
        {/* Режимы: вкладки-пилюли в белой капсуле, текущая — тёмная пилюля (язык Meldy). A phone has its one row
            below the actions instead. */}
        {phone ? null : (
          <div role="tablist" aria-label="Режим" className="sf-viewtabs md-tabs">
            {modes.map((item, index) => {
              const selected = mode === item;
              return (
                <button
                  key={item}
                  ref={element => {
                    tabRefs.current[item] = element;
                  }}
                  id={tabId(item)}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={PANEL_ID}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectMode(item)}
                  onKeyDown={event => handleTabKeyDown(event, index)}
                >
                  {MODE_LABELS[item]}
                </button>
              );
            })}
          </div>
        )}

        {/* A low window (1532×734, the 1280×720 projector) has no row for the meta line under the title: it is shown
            here, between the tabs and the actions, and read from the header (MaterialDetail.css). Where it is cut
            short (a 1024 px window), the pointer shows it whole. */}
        {editingSubject ? null : (
          <p className="md-toolbar-meta" aria-hidden="true" title={metaLine}>
            {metaLine}
          </p>
        )}

        {/* Spec 5.2 and the Meldy prototype (Material.dc.html): the white pills with the black circle and «⋯» as a
            round button. No chips and no second filled button. */}
        {cardCount > 0 || canEdit || exportInMenu ? (
          <div className="sf-head-actions md-acts" ref={headActsRef}>
            {canTalk && (
              <Link ref={talkPillRef} className="sf-secondary md-pill md-talk" to={talkHref} onClick={talkTip.done}>
                Поговорить о лекции
                <span className="md-dot" aria-hidden="true">
                  <ArrowRight strokeWidth={2} />
                </span>
              </Link>
            )}
            {/* Right after the pill, so Tab goes from the pill to its tip; the card lies over the page. */}
            {canTalk && talkTip.show ? (
              <TipCard tip={TIPS.talk} anchor={talkPillRef} alignTo={headActsRef} to={talkHref} onAction={talkTip.done} onDismiss={talkTip.dismiss} />
            ) : null}
            {cardCount > 0 && (
              <Link className="sf-secondary md-pill md-review" to={reviewHref}>
                Повторить карточки
                <span className="md-dot" aria-hidden="true">
                  <ArrowRight strokeWidth={2} />
                </span>
              </Link>
            )}
            {(canEdit || exportInMenu) && (
              <MaterialMenu
                open={menuOpen}
                own={canEdit}
                exportItems={exportInMenu ? () => exportItemsRef.current : undefined}
                isPublic={Boolean(material.is_public)}
                hasSubject={Boolean(material.subject)}
                folders={folders}
                folderId={assignments[material.id] ?? ''}
                onToggle={() => setMenuOpen(value => !value)}
                onClose={closeMenu}
                onRename={() => {
                  setTitleInput(material.title || '');
                  setEditingTitle(true);
                }}
                onSubject={() => {
                  setSubjectInput(material.subject || '');
                  setEditingSubject(true);
                }}
                onShare={() => void shareMaterial()}
                onCloseAccess={() => void closeAccess()}
                onMove={moveToFolder}
                onNewFolder={newFolder}
                onDelete={() => void removeLecture()}
              />
            )}
          </div>
        ) : null}
      </div>

      {/* A phone: one row of tabs, the sections of «Материал» next to the page's own modes (spec «Лекция»). */}
      {phone ? (
        <div
          role="tablist"
          aria-label="Разделы лекции"
          className="md-ptabs"
          ref={phoneRowRef}
          onScroll={measureRow}
          data-many={lectureTabs.length > 4 ? '' : undefined}
          data-more={rowMore || undefined}
        >
          {lectureTabs.map((item, index) => {
            const selected = lectureTab === item.key;
            return (
              <button
                key={item.key}
                ref={element => {
                  tabRefs.current[item.key] = element;
                }}
                id={tabId(item.key)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={PANEL_ID}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectLectureTab(item)}
                onKeyDown={event => handleLectureTabKeyDown(event, index)}
              >
                {item.label}
                {item.count ? (
                  <>
                    {' '}
                    <span className="md-ptab-n">{item.count}</span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Контент в зависимости от выбранного режима */}
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(phone ? lectureTab : mode)} className="md-panel">
        {mode === 'full' ? (
          <ResultsPanel
            results={panelResults as AnalysisResults}
            onReset={() => navigate('/analyze')}
            textLength={material.original_text?.length || material.summary_json?.content?.length || 0}
            sourceFileName={material.title}
            materialId={material.id}
            originalText={material.original_text || ''}
            canEdit={canEdit}
            onResultsChange={(next, changed) => updateMaterialFields(recreatedFields(material.id, next, changed))}
            embedded
            initialTab={sectionParam}
            followupCards={followups}
            notices={recognized ? <p>{recognized}</p> : undefined}
            pageTabs={phone ? { section, onSection: setSectionChoice, exportItems: exportItemsRef } : undefined}
          />
        ) : (
          <ExpressPrepView
            materialId={material.id}
            materialTitle={lectureTitle}
            originalText={material.original_text || ''}
            summaryJson={material.summary_json}
            flashcards={Array.isArray(material.flashcards_json) ? material.flashcards_json : material.flashcards_json?.flashcards}
            tab={mode === 'podcast' ? 'podcast' : 'cheatsheet'}
            revealPlayer={revealPlayer}
            onUpdate={updateMaterialFields}
            canEdit={canEdit}
          />
        )}
      </div>

      {bottomAction ? (
        <div className="md-bottom">
          <Link className="sf-primary md-bottom-go" to={reviewHref}>
            Повторить карточки
          </Link>
        </div>
      ) : null}
    </div>
  );
}
