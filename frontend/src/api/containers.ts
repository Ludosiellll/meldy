/**
 * The exam container's data API (package D1 builds it; this file is the agreed surface, so the screens and the
 * integration can be built against it in parallel). Every RPC is typed by `ContainerRpc` (types/container.ts).
 *
 * Errors: functions throw `ContainerApiError` with Russian `message` (see `containerErrorText`).
 * A database without the container functions (PGRST202 / 42883, an old migration) makes `fetchOverview`
 * resolve `null` and `isContainersUnavailable(error)` true, so the screens hide the container UI.
 */
import type {
  AnswerInput, BankParseResult, ContainerCreated, ContainerSettings, ContainerSummary, ContainersOverview,
  CreateSubjectInput, DayKey, DoubtRow, ItemInput, ItemPatch, ItemUpdated, ItemsAdded, LinkCreated, LinkPreview,
  MemberRow, MockRunInput, MockRunResult, OralSyncResponse, PlanInputsWire, RecordAnswersResponse, TestItem, Uuid,
} from '../types/container';

export class ContainerApiError extends Error {
  /** SQLSTATE or our code: 'MC001'…'MC009', '42501', 'P0002', '22023', 'unavailable', 'network', 'unknown'. */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ContainerApiError';
    this.code = code;
  }
}

function notBuilt(name: string): never {
  throw new ContainerApiError('unknown', `api/containers.${name}: not built yet (package D1)`);
}

/** True when the database has no container functions yet (the UI then shows exactly today's screens). */
export function isContainersUnavailable(error: unknown): boolean {
  return error instanceof ContainerApiError && error.code === 'unavailable';
}
/** True when the request failed for lack of network (the UI then draws from the device's cache). */
export function isOffline(error: unknown): boolean {
  return error instanceof ContainerApiError && error.code === 'network';
}
/** Russian text for any error of this module. */
export function containerErrorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Не получилось. Попробуйте ещё раз.';
}

// reads
export async function fetchOverview(_localDate?: DayKey): Promise<ContainersOverview | null> { return notBuilt('fetchOverview'); }
export async function fetchSummary(_containerId: Uuid, _localDate?: DayKey): Promise<ContainerSummary> { return notBuilt('fetchSummary'); }
export async function fetchPlanInputs(_localDate?: DayKey, _containerId?: Uuid): Promise<PlanInputsWire> { return notBuilt('fetchPlanInputs'); }
/** One keyset page (≤ 500) of a subject's items, ordered by position, after `afterPosition`. */
export async function fetchItemsPage(_subjectId: Uuid, _afterPosition = 0): Promise<TestItem[]> { return notBuilt('fetchItemsPage'); }
/** Every item of the given subjects (paged under the hood). */
export async function fetchAllItems(_subjectIds: Uuid[]): Promise<TestItem[]> { return notBuilt('fetchAllItems'); }
export async function fetchAnswerDays(_since: DayKey): Promise<Array<{ local_date: DayKey; answers: number }>> { return notBuilt('fetchAnswerDays'); }

// answers
export async function recordAnswers(_answers: AnswerInput[]): Promise<RecordAnswersResponse> { return notBuilt('recordAnswers'); }
export async function finishMock(_run: MockRunInput): Promise<MockRunResult> { return notBuilt('finishMock'); }

// writing
export async function createContainer(_title: string, _examDate: DayKey | null, _subjects: CreateSubjectInput[]): Promise<ContainerCreated> { return notBuilt('createContainer'); }
export async function addSubject(_containerId: Uuid, _subject: CreateSubjectInput): Promise<{ id: Uuid; position: number; title: string }> { return notBuilt('addSubject'); }
/** Adds items in batches of ≤ 250 (refs make a resent batch a no-op); `onProgress(done, total)` after each batch. */
export async function addItems(_subjectId: Uuid, _items: ItemInput[], _onProgress?: (done: number, total: number) => void): Promise<ItemsAdded[]> { return notBuilt('addItems'); }
export async function updateItem(_itemId: Uuid, _patch: ItemPatch): Promise<ItemUpdated> { return notBuilt('updateItem'); }
export async function deleteItem(_itemId: Uuid): Promise<void> { return notBuilt('deleteItem'); }
export async function updateContainer(_containerId: Uuid, _patch: { title?: string; exam_date?: DayKey | null }): Promise<void> { return notBuilt('updateContainer'); }
export async function updateSubject(_subjectId: Uuid, _patch: { title?: string; exam_date?: DayKey | null; position?: number }): Promise<void> { return notBuilt('updateSubject'); }
export async function deleteSubject(_subjectId: Uuid): Promise<void> { return notBuilt('deleteSubject'); }
export async function deleteContainer(_containerId: Uuid): Promise<void> { return notBuilt('deleteContainer'); }
export async function saveSettings(_containerId: Uuid, _settings: ContainerSettings): Promise<void> { return notBuilt('saveSettings'); }

// keys
export async function doubtKey(_itemId: Uuid, _proposed?: number[], _note?: string): Promise<void> { return notBuilt('doubtKey'); }
export async function withdrawDoubt(_itemId: Uuid): Promise<void> { return notBuilt('withdrawDoubt'); }
export async function fetchDoubts(_containerId: Uuid): Promise<DoubtRow[]> { return notBuilt('fetchDoubts'); }
export async function keepKey(_itemId: Uuid): Promise<number> { return notBuilt('keepKey'); }

// group
export async function createLink(_containerId: Uuid, _maxMembers?: number, _consent?: string | null): Promise<LinkCreated> { return notBuilt('createLink'); }
export async function revokeLink(_linkId: Uuid): Promise<void> { return notBuilt('revokeLink'); }
/** Works signed out (anon). */
export async function previewLink(_code: string): Promise<LinkPreview> { return notBuilt('previewLink'); }
export async function joinByCode(_code: string): Promise<{ container_id: Uuid; joined: boolean; oral_subjects?: number }> { return notBuilt('joinByCode'); }
/** POST /api/containers/{id}/oral-sync: the member's oral copies through the oral path (package C). */
export async function oralSync(_containerId: Uuid): Promise<OralSyncResponse> { return notBuilt('oralSync'); }
export async function leaveContainer(_containerId: Uuid): Promise<void> { return notBuilt('leaveContainer'); }
export async function fetchMembers(_containerId: Uuid): Promise<MemberRow[]> { return notBuilt('fetchMembers'); }
/** `userId` null removes (or with `restore`, restores) everyone. */
export async function removeMember(_containerId: Uuid, _userId: Uuid | null, _restore?: boolean): Promise<number> { return notBuilt('removeMember'); }

// import
export interface ParseBankInput {
  file?: File;
  text?: string;
  keyMode?: 'auto' | 'first_option' | 'none';
  keyText?: string;
  format?: 'auto' | 'test' | 'open';
}
/** POST /api/exams/parse-bank (multipart); throws ContainerApiError with the server's Russian `detail` and `code`. */
export async function parseBank(_input: ParseBankInput): Promise<BankParseResult> { return notBuilt('parseBank'); }
