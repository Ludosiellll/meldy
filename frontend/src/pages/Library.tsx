import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, MoreHorizontal, Plus, RotateCcw, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../contexts/ConfirmContext';
import { deleteMaterial, getMaterials, updateMaterialTitle } from '../api/materials';
import { listExamShelves, type ExamShelf } from '../api/exams';
import { pluralRu } from '../components/conversation/visuals';
import { KIND_LABELS, KIND_WORDS, formatDay, lecturesWord, subjectOf } from '../lib/exams/format';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { usePhone } from '../lib/usePhone';
import { orderExamLectures } from '../lib/lectureOrder';
import { cardsLine as cardCountLine, followupCardsByLecture } from '../lib/followupCards';
import {
  DEFAULT_FOLDER_IDS,
  FOLDERS_HERE_NOTE,
  FolderItems,
  deleteLectureConfirm,
  forgetLecture,
  legacyLibraryCacheKey,
  libraryCacheKey,
  readAssignments,
  readFolders,
  readJson,
  withFolder,
  withNewFolder,
  writeAssignments,
  writeFolders,
  writeJson,
  type LibraryFolder,
} from '../components/LectureFolders';
import '../styles/paper.css';
import './Library.css';
import { displayMaterialTitle } from '../utils/materialTitle';

/**
 * The Library as the course's table of contents (redesign spec 5.1): the lectures grouped by the
 * exam they were added to, in the order they were added (lib/lectureOrder, the map numbers them the
 * same way); one line per lecture with what it has («конспект · 8 карточек · ещё 2 из ответов на
 * билеты · тест · подкаст» or «только текст, конспекта нет») and its date. No cards grid, chips,
 * capitals, statistics tiles or quick-view drawer: a click opens the lecture. Folders (kept on this
 * device, and the page says so) and search appear only when they help (a folder the student made,
 * 13+ lectures).
 */

/** One lecture as the list shows it (a light view of the materials row; cached on this device). */
export interface LibraryEntry {
  id: string;
  title: string;
  created_at: string;
  textOnly: boolean;
  summary: boolean;
  cards: number;
  quiz: boolean;
  talk: boolean;
}

type Folder = LibraryFolder;

/** A search field appears from this many lectures (spec 5.1). */
export const SEARCH_FROM = 13;
/** A number keeps its word and «·» its word before it: a line never starts with «·» or «окт.» (finding LIB-21). */
const NBSP = '\u00a0';
const DOT = `${NBSP}· `;
const LOADING_LINE_MS = 300;
const CACHE_VERSION = 2;
/**
 * The light entries live under their own key. `library_cache_<id>` keeps the full rows the deployed older
 * client writes and reads without checking their shape: writing anything else there would break the Library
 * in an old tab (or after a rollback). It is only read here, as a fallback.
 */
const cacheKey = libraryCacheKey;
const legacyCacheKey = legacyLibraryCacheKey;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A materials row (or an entry cached by this page) → what the list shows. */
export function toEntry(raw: unknown): LibraryEntry | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  if (typeof raw.textOnly === 'boolean') {
    return {
      id: raw.id,
      title: typeof raw.title === 'string' ? raw.title : '',
      created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
      textOnly: raw.textOnly,
      summary: raw.summary === true,
      cards: typeof raw.cards === 'number' ? raw.cards : 0,
      quiz: raw.quiz === true,
      talk: raw.talk === true,
    };
  }
  const summary = isRecord(raw.summary_json) ? raw.summary_json : {};
  const cards = isRecord(raw.flashcards_json) && Array.isArray(raw.flashcards_json.flashcards) ? raw.flashcards_json.flashcards.length : 0;
  const quiz = isRecord(raw.quiz_json) && Array.isArray(raw.quiz_json.quiz) ? raw.quiz_json.quiz.length : 0;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '',
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    textOnly: summary.text_only === true,
    summary: typeof summary.content === 'string' && summary.content.trim() !== '',
    cards,
    quiz: quiz > 0,
    talk: Array.isArray(summary.podcast) && summary.podcast.length > 0,
  };
}

/**
 * «конспект · 8 карточек · тест · подкаст» (only what exists) or «только текст, конспекта нет». Cards the
 * lecture got from ticket answers are named apart (decision 4): «6 карточек · ещё 4 из ответов на билеты».
 * `short` (a phone, 10_Project/Phone_Declutter_2026-10-08): «6 карточек · тест» — a summary goes without saying
 * and only its absence is named; the cards from ticket answers are counted on the lecture's «Карточки».
 */
export function lectureMeta(entry: LibraryEntry, followups = 0, short = false): string {
  const cards = cardCountLine(entry.cards, short && entry.cards > 0 ? 0 : followups);
  if (entry.textOnly) return ['только текст, конспекта нет', cards].filter(Boolean).join(DOT);
  const parts: string[] = [];
  if (entry.summary && !short) parts.push('конспект');
  if (!entry.summary && short) parts.push('без конспекта');
  if (cards) parts.push(cards);
  if (entry.quiz) parts.push('тест');
  if (entry.talk) parts.push('подкаст');
  return parts.join(DOT);
}

/** «15 сент.», with the year when it is not this year. */
export function shortDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return format(date, date.getFullYear() === now.getFullYear() ? `d'${NBSP}'MMM` : `d'${NBSP}'MMM yyyy`, { locale: ru });
}

/** «9 лекций: 3 разобраны, 6 загружены только текстом». */
export function lecturesLine(entries: LibraryEntry[]): string {
  const total = entries.length;
  const textOnly = entries.filter((entry) => entry.textOnly).length;
  const analyzed = total - textOnly;
  const head = `${total}${NBSP}${lecturesWord(total)}`;
  if (textOnly === 0) return head;
  const loaded = `${pluralRu(textOnly, ['загружена', 'загружены', 'загружены'])} только текстом`;
  if (analyzed === 0) return `${head}, ${loaded}`;
  return `${head}: ${analyzed}${NBSP}${pluralRu(analyzed, ['разобрана', 'разобраны', 'разобраны'])}, ${textOnly}${NBSP}${loaded}`;
}

function cardsLine(entries: LibraryEntry[], followups: ReadonlyMap<string, number> = new Map(), short = false): string {
  const own = entries.reduce((sum, entry) => sum + entry.cards, 0);
  const extra = entries.reduce((sum, entry) => sum + (followups.get(entry.id) ?? 0), 0);
  // A phone's line is the lectures' own cards; the ones from ticket answers are on each lecture's «Карточки».
  return cardCountLine(own, short && own > 0 ? 0 : extra);
}

/** «Экзамен 15 октября» / «экзамен 15 октября»; without a date just the kind. */
function examWhen(exam: ExamShelf, capital: boolean): string {
  const kind = capital ? KIND_LABELS[exam.kind] : KIND_WORDS[exam.kind];
  const day = formatDay(exam.exam_date);
  return day ? `${kind} ${day}` : kind;
}

export interface LibraryGroup {
  key: string;
  exam: ExamShelf | null;
  entries: LibraryEntry[];
}

export type LibraryLayout =
  | { mode: 'plain'; entries: LibraryEntry[] }
  | { mode: 'single'; exam: ExamShelf; entries: LibraryEntry[] }
  | { mode: 'sections'; groups: LibraryGroup[] };

function time(entry: LibraryEntry): number {
  const value = new Date(entry.created_at).getTime();
  return Number.isNaN(value) ? 0 : value;
}

/**
 * How the lectures are grouped (spec 5.1): by exam (exam_materials), in the order they were added to
 * it and then uploaded (lib/lectureOrder, as the knowledge map numbers them); lectures in no exam under
 * «Другие материалы», newest first. All lectures in one exam: the exam is the page. No exams: one list,
 * newest first. A lecture in two exams is shown in both.
 */
export function libraryLayout(entries: LibraryEntry[], shelves: ExamShelf[]): LibraryLayout {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const placed = new Set<string>();
  const groups: LibraryGroup[] = [];
  for (const shelf of shelves) {
    const items = orderExamLectures(shelf.materials, (id) => byId.get(id)?.created_at)
      .map((link) => byId.get(link.id))
      .filter((entry): entry is LibraryEntry => Boolean(entry));
    if (items.length === 0) continue;
    for (const item of items) placed.add(item.id);
    groups.push({ key: shelf.id, exam: shelf, entries: items });
  }
  const newestFirst = (list: LibraryEntry[]) => [...list].sort((a, b) => time(b) - time(a));
  if (groups.length === 0) return { mode: 'plain', entries: newestFirst(entries) };
  const rest = newestFirst(entries.filter((entry) => !placed.has(entry.id)));
  if (groups.length === 1 && rest.length === 0) return { mode: 'single', exam: groups[0].exam as ExamShelf, entries: groups[0].entries };
  if (rest.length > 0) groups.push({ key: 'other', exam: null, entries: rest });
  return { mode: 'sections', groups };
}

function normalizeQuery(text: string): string {
  return text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
}


/** The cached list of this device: the new light entries, or the full rows an older version stored. */
export function readCache(userId: string): LibraryEntry[] | null {
  const raw = readJson<unknown>(cacheKey(userId), null);
  const legacy = raw === null ? readJson<unknown>(legacyCacheKey(userId), null) : null;
  const list = isRecord(raw) && raw.v === CACHE_VERSION && Array.isArray(raw.items) ? raw.items : Array.isArray(legacy) ? legacy : null;
  if (!list) return null;
  return list.map(toEntry).filter((entry): entry is LibraryEntry => entry !== null);
}

interface RowMenuProps {
  entry: LibraryEntry;
  folders: Folder[];
  folderId: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onRename: () => void;
  onMove: (folderId: string) => void;
  onNewFolder: (name: string) => void;
  onDelete: () => void;
}

/** «⋯» of a lecture row: rename, folder (kept on this device), delete. The lecture page's «⋯» has the same. */
function RowMenu({ entry, folders, folderId, open, onToggle, onClose, onRename, onMove, onNewFolder, onDelete }: RowMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]')?.focus();
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) onClose();
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open, onClose]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      buttonRef.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]') ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div className="sf-toc-more" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="sf-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Действия: ${entry.title}`}
        onClick={onToggle}
      >
        <MoreHorizontal aria-hidden="true" strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="sf-menu lf-menu" role="menu" aria-label={entry.title}>
          <button type="button" role="menuitem" onClick={onRename}>
            Переименовать
          </button>
          <div className="sf-menu-sep" role="separator" />
          <FolderItems folders={folders} folderId={folderId} onMove={onMove} onNewFolder={onNewFolder} />
          <div className="sf-menu-sep" role="separator" />
          <button type="button" role="menuitem" data-danger="" onClick={onDelete}>
            Удалить лекцию…
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface LectureListProps {
  entries: LibraryEntry[];
  /** Cards each lecture got from ticket answers (lib/followupCards). */
  followups: ReadonlyMap<string, number>;
  folders: Folder[];
  assignments: Record<string, string>;
  openMenu: string | null;
  setOpenMenu: (key: string | null) => void;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
  listKey: string;
  /** A phone: the rows' short meta line (lectureMeta). */
  short: boolean;
  actions: {
    rename: (entry: LibraryEntry, title: string) => Promise<void>;
    move: (entry: LibraryEntry, folderId: string) => void;
    newFolder: (entry: LibraryEntry, name: string) => void;
    remove: (entry: LibraryEntry) => Promise<void>;
  };
}

function RenameRow({ entry, onSave, onCancel }: { entry: LibraryEntry; onSave: (title: string) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(entry.title);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean || clean === entry.title) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      await onSave(clean);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="sf-toc-edit" onSubmit={(event) => void submit(event)}>
      <input
        className="sf-input"
        aria-label="Название лекции"
        maxLength={200}
        autoFocus
        value={title}
        disabled={saving}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <button type="submit" className="lib-small-pill" disabled={saving}>
        {saving ? 'Сохраняем…' : 'Сохранить'}
      </button>
      <button type="button" className="sf-link" data-muted="" onClick={onCancel} disabled={saving}>
        Отмена
      </button>
    </form>
  );
}

function LectureList({ entries, followups, folders, assignments, openMenu, setOpenMenu, renaming, setRenaming, listKey, short, actions }: LectureListProps) {
  return (
    <ol className="sf-toc">
      {entries.map((entry, index) => {
        const menuKey = `${listKey}:${entry.id}`;
        const meta = lectureMeta(entry, followups.get(entry.id) ?? 0, short);
        const date = shortDate(entry.created_at);
        return (
          <li
            key={entry.id}
            className="sf-toc-row"
            data-open={openMenu === menuKey ? '' : undefined}
            data-text-only={entry.textOnly ? '' : undefined}
          >
            {renaming === menuKey ? (
              <RenameRow
                entry={entry}
                onCancel={() => setRenaming(null)}
                onSave={async (title) => {
                  await actions.rename(entry, title);
                  setRenaming(null);
                }}
              />
            ) : (
              <>
                <Link className="sf-toc-link" to={`/library/${entry.id}`}>
                  <span className="sf-toc-n" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span>
                    <span className="sf-toc-title">{displayMaterialTitle(entry.title)}</span>
                    {meta || date ? (
                      <span className="sf-toc-meta">
                        {meta}
                        {date ? <span className="sf-toc-date-inline">{`${meta ? DOT : ''}${date}`}</span> : null}
                      </span>
                    ) : null}
                  </span>
                  <span className="sf-toc-date">{date}</span>
                </Link>
                <RowMenu
                  entry={entry}
                  folders={folders}
                  folderId={assignments[entry.id] ?? ''}
                  open={openMenu === menuKey}
                  onToggle={() => setOpenMenu(openMenu === menuKey ? null : menuKey)}
                  onClose={() => setOpenMenu(null)}
                  onRename={() => {
                    setOpenMenu(null);
                    setRenaming(menuKey);
                  }}
                  onMove={(folderId) => {
                    setOpenMenu(null);
                    actions.move(entry, folderId);
                  }}
                  onNewFolder={(name) => {
                    setOpenMenu(null);
                    actions.newFolder(entry, name);
                  }}
                  onDelete={() => {
                    setOpenMenu(null);
                    void actions.remove(entry);
                  }}
                />
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function Library() {
  useDocumentTitle('Лекции');
  const { user } = useAuth();
  const { confirm } = useConfirm();
  // A phone: «Разобрать лекцию» opens the page (the top line has no «+ Лекция» there), «Лист экзамена» is a quiet
  // link, and the lines are shorter (10_Project/Phone_Declutter_2026-10-08).
  const phone = usePhone();
  const userId = user?.id ?? '';
  const [followups, setFollowups] = useState<ReadonlyMap<string, number>>(() => new Map());

  const [entries, setEntries] = useState<LibraryEntry[] | null>(() => (userId ? readCache(userId) : null));
  const [shelves, setShelves] = useState<ExamShelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingLine, setLoadingLine] = useState(false);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [folderFilter, setFolderFilter] = useState('');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    const shelvesRequest = listExamShelves(userId).catch(() => null);
    // Cards from ticket answers come in their own request; the list does not wait for them.
    void followupCardsByLecture(userId).then(setFollowups);
    try {
      const rows = await getMaterials(userId);
      const next = (rows ?? []).map(toEntry).filter((entry): entry is LibraryEntry => entry !== null);
      setEntries(next);
      writeJson(cacheKey(userId), { v: CACHE_VERSION, items: next });
    } catch (error) {
      console.error(error);
      setFailed(true);
    }
    const loadedShelves = await shelvesRequest;
    if (loadedShelves) setShelves(loadedShelves);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading) {
      setLoadingLine(false);
      return;
    }
    const timer = setTimeout(() => setLoadingLine(true), LOADING_LINE_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  // Folders of this device (the app no longer creates default ones).
  useEffect(() => {
    setFolders(readFolders(userId));
    setAssignments(readAssignments(userId));
  }, [userId]);

  const saveAssignments = (next: Record<string, string>) => {
    setAssignments(next);
    writeAssignments(userId, next);
  };
  const saveFolders = (next: Folder[]) => {
    setFolders(next);
    writeFolders(userId, next);
  };

  const list = entries ?? [];
  const folderCount = (folderId: string) => list.filter((entry) => assignments[entry.id] === folderId).length;
  const visibleFolders = folders.filter((folder) => !DEFAULT_FOLDER_IDS.has(folder.id) || folderCount(folder.id) > 0);

  const query = normalizeQuery(search);
  const shown = list.filter(
    (entry) => (!folderFilter || assignments[entry.id] === folderFilter) && (!query || normalizeQuery(entry.title).includes(query)),
  );
  const filtering = Boolean(folderFilter || query);
  const layout = useMemo(() => libraryLayout(shown, shelves), [shown, shelves]);
  // The page's own heading follows the whole library, not a search: one exam stays the title while filtering.
  const whole = useMemo(() => libraryLayout(list, shelves), [list, shelves]);

  const actions: LectureListProps['actions'] = {
    rename: async (entry, title) => {
      try {
        await updateMaterialTitle(entry.id, title);
        setEntries((previous) => (previous ?? []).map((item) => (item.id === entry.id ? { ...item, title } : item)));
      } catch {
        toast.error('Не удалось переименовать. Повторите через минуту.');
      }
    },
    move: (entry, folderId) => saveAssignments(withFolder(assignments, entry.id, folderId)),
    newFolder: (entry, name) => {
      const next = withNewFolder(folders, assignments, entry.id, name);
      saveFolders(next.folders);
      saveAssignments(next.assignments);
    },
    remove: async (entry) => {
      const ok = await confirm(deleteLectureConfirm(displayMaterialTitle(entry.title)));
      if (!ok) return;
      try {
        await deleteMaterial(entry.id);
      } catch {
        toast.error('Не удалось удалить лекцию. Повторите через минуту.');
        return;
      }
      setEntries((previous) => (previous ?? []).filter((item) => item.id !== entry.id));
      // Its folder mark and its row in this device's list go too (the same as from the lecture page).
      forgetLecture(userId, entry.id);
      if (assignments[entry.id]) setAssignments(withFolder(assignments, entry.id, ''));
    },
  };

  const listProps = { followups, folders, assignments, openMenu, setOpenMenu, renaming, setRenaming, actions, short: phone };

  // ── The heading: the exam when every lecture belongs to it, else «Библиотека» ──
  let heading = 'Лекции';
  let lede = '';
  let sheetLink: string | null = null;
  if (whole.mode === 'single') {
    heading = subjectOf(whole.exam.title) || 'Лекции';
    lede = [examWhen(whole.exam, true), lecturesLine(whole.entries), cardsLine(whole.entries, followups, phone)].filter(Boolean).join(DOT);
    sheetLink = `/exams/${whole.exam.id}`;
  } else if (list.length > 0) {
    lede = [`${list.length}${NBSP}${lecturesWord(list.length)}`, cardsLine(list, followups, phone)].filter(Boolean).join(DOT);
  }

  if (entries === null && loading) {
    return (
      <div className="sf-page lib-page">
        <div className="sf-head lib-head" role="status" aria-label="Загружаем библиотеку">
          {loadingLine ? <p className="lib-loading-text">Загружаем библиотеку…</p> : null}
        </div>
        {loadingLine ? (
          // The shape of the list while it loads: four quiet rows, no numbers or titles.
          <ol className="sf-toc lib-skeleton" aria-hidden="true">
            {[0, 1, 2, 3].map((row) => (
              <li key={row} className="lib-skel-row">
                <span className="lib-skel-tile" />
                <span className="lib-skel-lines">
                  <i />
                  <i />
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    );
  }

  if (entries === null && failed) {
    return (
      <div className="sf-page lib-page">
        <section className="lib-note-card" aria-labelledby="library-failed-title">
          <h1 id="library-failed-title" className="sf-h2">
            Не удалось загрузить библиотеку
          </h1>
          <p>Лекции на месте — повторите через минуту.</p>
          <button type="button" className="lib-pill" onClick={() => void load()}>
            Повторить
            <span className="lib-dot" aria-hidden="true">
              <RotateCcw strokeWidth={2} />
            </span>
          </button>
        </section>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="sf-page lib-page">
        <section className="lib-empty" aria-labelledby="library-empty-title">
          <div className="lib-empty-text">
            <h1 id="library-empty-title" className="sf-h1">
              Здесь будут ваши лекции
            </h1>
            <p className="lib-empty-p">Загрузите первую — Meldy сделает конспект, карточки и тест и сошлётся на её фрагменты.</p>
            <Link className="sf-primary" to="/analyze">
              Разобрать лекцию
            </Link>
          </div>
          {/* A lecture on a blue panel: the cards behind it and the window of its summary (no words, no numbers). */}
          <div className="lib-art" aria-hidden="true">
            <span className="lib-art-card" data-n="1" />
            <span className="lib-art-card" data-n="2" />
            <span className="lib-art-card" data-n="3">
              <i />
              <i />
              <i />
              <i />
              <span className="lib-art-pills">
                <b />
                <b />
                <b />
              </span>
            </span>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="sf-page lib-page">
      <header className="sf-head lib-head">
        <div className="lib-head-main">
          <h1 className="sf-h1">{heading}</h1>
          {lede ? <p className="sf-lede">{lede}</p> : null}
        </div>
        {phone ? (
          // The page's one start on a phone, as «Новый экзамен» on «Экзамены»; «Лист экзамена» a quiet link by it.
          <div className="lib-head-acts">
            <Link className="lib-pill lib-new" to="/analyze">
              Разобрать лекцию
              <span className="lib-dot" aria-hidden="true">
                <Plus strokeWidth={2.2} />
              </span>
            </Link>
            {sheetLink ? (
              <Link className="sf-link lib-sheet" to={sheetLink}>
                Лист экзамена
              </Link>
            ) : null}
          </div>
        ) : sheetLink ? (
          <Link className="lib-pill" to={sheetLink}>
            Лист экзамена
            <span className="lib-dot" aria-hidden="true">
              <ArrowRight strokeWidth={2} />
            </span>
          </Link>
        ) : null}
      </header>

      {failed ? <p className="lib-offline">Нет связи. Показываем сохранённое на этом устройстве.</p> : null}

      {visibleFolders.length > 0 || list.length >= SEARCH_FROM ? (
        <div className="lib-filters">
          {visibleFolders.length > 0 ? (
            <ul className="sf-tabs lib-folders" aria-label="Папки">
              <li>
                <button type="button" aria-pressed={folderFilter === ''} onClick={() => setFolderFilter('')}>
                  Все<span className="sf-tabs-n">{list.length}</span>
                </button>
              </li>
              {visibleFolders.map((folder) => (
                <li key={folder.id}>
                  <button type="button" aria-pressed={folderFilter === folder.id} onClick={() => setFolderFilter(folderFilter === folder.id ? '' : folder.id)}>
                    {folder.name}
                    <span className="sf-tabs-n">{folderCount(folder.id)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {visibleFolders.length > 0 ? <p className="lib-folders-note">{FOLDERS_HERE_NOTE}</p> : null}
          {list.length >= SEARCH_FROM ? (
            <label className="lib-search">
              <Search aria-hidden="true" strokeWidth={2} />
              <input
                className="sf-input"
                type="search"
                aria-label="Найти лекцию"
                placeholder="Найти лекцию"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="lib-list">
        {shown.length === 0 ? (
          <p className="lib-empty-line">{filtering ? 'Таких лекций нет.' : 'Лекций пока нет.'}</p>
        ) : layout.mode === 'sections' ? (
          layout.groups.map((group) => (
            <section key={group.key} className="lib-section" aria-labelledby={`library-group-${group.key}`}>
              <div className="lib-section-head">
                <div className="min-w-0">
                  <h2 id={`library-group-${group.key}`} className="sf-h2">
                    {group.exam ? subjectOf(group.exam.title) : 'Другие материалы'}
                  </h2>
                  <p className="sf-lede">
                    {group.exam
                      ? `${examWhen(group.exam, false)} · ${group.entries.length} ${lecturesWord(group.entries.length)}`
                      : `${group.entries.length} ${lecturesWord(group.entries.length)}, новые сверху`}
                  </p>
                </div>
                {group.exam ? (
                  <Link className="lib-more" to={`/exams/${group.exam.id}`}>
                    Лист экзамена
                    <ArrowRight aria-hidden="true" strokeWidth={2} />
                  </Link>
                ) : null}
              </div>
              <LectureList {...listProps} entries={group.entries} listKey={group.key} />
            </section>
          ))
        ) : (
          <LectureList {...listProps} entries={layout.entries} listKey={layout.mode === 'single' ? layout.exam.id : 'all'} />
        )}
      </div>
    </div>
  );
}
