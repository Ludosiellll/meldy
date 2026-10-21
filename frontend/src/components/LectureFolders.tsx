import { useState, type FormEvent } from 'react';
import { recognizedSource, type RecognizedSource } from '../lib/lectureFormats';
import './LectureFolders.css';

/**
 * Folders of «Лекции» and the lecture's own actions that both the list and the lecture page offer
 * (finding LIB-9: on a phone the list has no «⋯», so the lecture's «⋯» moves it to a folder and deletes it).
 *
 * Folders live only in this browser (localStorage, keys `library_folders_<user>` and
 * `library_folder_assignments_<user>`, unchanged since the first Library): the menus say so.
 */

export interface LibraryFolder {
  id: string;
  name: string;
  color?: string;
  icon?: string;
}

/** Folders the app once created for everyone: only folders the student made or filled are shown. */
export const DEFAULT_FOLDER_IDS = new Set(['folder_1', 'folder_2', 'folder_3']);
/** The menu's word for where folders are kept. */
export const FOLDER_LABEL = 'Папка — только на этом устройстве';
export const FOLDERS_HERE_NOTE = 'Папки видны только на этом устройстве';

const ownerKey = (userId: string | null | undefined) => userId || 'default_user';
const foldersKey = (userId: string | null | undefined) => `library_folders_${ownerKey(userId)}`;
const assignmentsKey = (userId: string | null | undefined) => `library_folder_assignments_${ownerKey(userId)}`;
/**
 * The Library's light list of this device. `library_cache_<id>` keeps the full rows the deployed older client
 * writes and reads without checking their shape: nothing else is ever written there.
 */
export const libraryCacheKey = (userId: string) => `library_entries_${userId}`;
export const legacyLibraryCacheKey = (userId: string) => `library_cache_${userId}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the page works without it.
  }
}

export function readFolders(userId: string | null | undefined): LibraryFolder[] {
  const list = readJson<unknown>(foldersKey(userId), []);
  return Array.isArray(list) ? list.filter((folder): folder is LibraryFolder => isRecord(folder) && typeof folder.id === 'string' && typeof folder.name === 'string') : [];
}

export function readAssignments(userId: string | null | undefined): Record<string, string> {
  const map = readJson<unknown>(assignmentsKey(userId), {});
  return isRecord(map) ? (Object.fromEntries(Object.entries(map).filter(([, value]) => typeof value === 'string')) as Record<string, string>) : {};
}

export function writeFolders(userId: string | null | undefined, folders: LibraryFolder[]) {
  writeJson(foldersKey(userId), folders);
}

export function writeAssignments(userId: string | null | undefined, assignments: Record<string, string>) {
  writeJson(assignmentsKey(userId), assignments);
}

/** A new folder with the lecture in it: the folders and the assignments to save. */
export function withNewFolder(folders: LibraryFolder[], assignments: Record<string, string>, materialId: string, name: string) {
  const folder: LibraryFolder = { id: `folder_${Date.now()}`, name };
  return { folders: [...folders, folder], assignments: { ...assignments, [materialId]: folder.id } };
}

/** The lecture moved to `folderId` ('' — out of every folder). */
export function withFolder(assignments: Record<string, string>, materialId: string, folderId: string): Record<string, string> {
  const next = { ...assignments };
  if (folderId) next[materialId] = folderId;
  else delete next[materialId];
  return next;
}

/** A deleted lecture leaves no folder mark and no row in the Library's list of this device. */
export function forgetLecture(userId: string | null | undefined, materialId: string) {
  const assignments = readAssignments(userId);
  if (assignments[materialId]) writeAssignments(userId, withFolder(assignments, materialId, ''));
  if (!userId) return;
  const cached = readJson<unknown>(libraryCacheKey(userId), null);
  if (isRecord(cached) && Array.isArray(cached.items)) {
    writeJson(libraryCacheKey(userId), { ...cached, items: cached.items.filter((item) => !(isRecord(item) && item.id === materialId)) });
  }
}

/** A lecture as the Library's list of this device has it (Library.toEntry): what the lecture page knows before it loads. */
export interface ListedLecture {
  textOnly: boolean;
  summary: boolean;
  cards: number;
  quiz: boolean;
  /** The test's questions; a list kept before they were noted has none. */
  questions?: number;
  /** How the text was got (summary_json.recognized). */
  recognized?: RecognizedSource;
}

/**
 * The lecture in the Library's list of this device, or null (the list was not opened here, or the lecture is someone
 * else's): the lecture page's placeholder draws the same tabs and «Текст распознан…» from it.
 */
export function listedLecture(userId: string | null | undefined, materialId: string | null | undefined): ListedLecture | null {
  if (!userId || !materialId) return null;
  const cached = readJson<unknown>(libraryCacheKey(userId), null);
  const items: unknown[] = isRecord(cached) && Array.isArray(cached.items) ? cached.items : [];
  const item = items.find((entry) => isRecord(entry) && entry.id === materialId);
  if (!isRecord(item) || typeof item.textOnly !== 'boolean') return null;
  return {
    textOnly: item.textOnly,
    summary: item.summary === true,
    cards: typeof item.cards === 'number' ? item.cards : 0,
    quiz: item.quiz === true,
    questions: typeof item.questions === 'number' ? item.questions : undefined,
    recognized: recognizedSource(item.recognized),
  };
}

/** What a lecture has, for the confirm of its deletion. */
export interface LectureMaterials {
  summary?: boolean;
  cards?: boolean;
  quiz?: boolean;
  cheatsheet?: boolean;
  podcast?: boolean;
}

const GONE_WITH: Array<[keyof LectureMaterials, string]> = [
  ['summary', 'конспектом'],
  ['cards', 'карточками'],
  ['quiz', 'самопроверкой'],
  ['cheatsheet', 'выжимкой'],
  ['podcast', 'подкастом'],
];

/**
 * The confirm of «Удалить лекцию…», the same in the list and on the lecture page: «… исчезнет из библиотеки вместе с
 * конспектом и тестом» — only what the lecture has (QA 2026-10-11: «карточками и тестом» was said of every lecture).
 */
export function deleteLectureConfirm(title: string, has: LectureMaterials = {}) {
  const named = GONE_WITH.filter(([key]) => has[key]).map(([, words]) => words);
  const together = named.length > 1 ? `${named.slice(0, -1).join(', ')} и ${named[named.length - 1]}` : named[0];
  return {
    title: 'Удалить лекцию?',
    message: `«${title}» исчезнет из библиотеки${together ? ` вместе с ${together}` : ''}. Это нельзя отменить.`,
    confirmText: 'Удалить',
    cancelText: 'Оставить',
  };
}

interface FolderItemsProps {
  folders: LibraryFolder[];
  folderId: string;
  onMove: (folderId: string) => void;
  onNewFolder: (name: string) => void;
}

/**
 * The folder part of a lecture's «⋯» menu: what is kept where, the folders as radio items, «Без папки» and
 * «Новая папка…» with its field. The menu's own arrow keys walk [role=menuitem] and [role=menuitemradio]; the
 * menu carries the class `lf-menu` (LectureFolders.css).
 */
export function FolderItems({ folders, folderId, onMove, onNewFolder }: FolderItemsProps) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    onNewFolder(clean);
  };
  const shown = folders.filter((folder) => !DEFAULT_FOLDER_IDS.has(folder.id) || folder.id === folderId);
  return (
    <>
      <p className="sf-menu-label">{FOLDER_LABEL}</p>
      {shown.map((folder) => (
        <button key={folder.id} type="button" role="menuitemradio" aria-checked={folderId === folder.id} onClick={() => onMove(folder.id)}>
          {folder.name}
        </button>
      ))}
      {folderId ? (
        <button type="button" role="menuitemradio" aria-checked={false} onClick={() => onMove('')}>
          Без папки
        </button>
      ) : null}
      {naming ? (
        <form onSubmit={submit}>
          <input
            className="sf-input lf-input"
            aria-label="Название папки"
            placeholder="Название папки"
            maxLength={60}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="lf-pill">
            Создать
          </button>
        </form>
      ) : (
        <button type="button" role="menuitem" onClick={() => setNaming(true)}>
          Новая папка…
        </button>
      )}
    </>
  );
}
