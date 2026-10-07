/**
 * «Группа по ссылке» (backend/exam_shares.py): the author makes a secret link of a ready exam; a classmate who
 * opens it gets their own copy — questions, the lectures' text and the cheat sheet with its answer points — at
 * no AI units. The session's token is added by lib/apiAuth (every /api/* path); the preview needs none.
 */

export type ShareState = 'active' | 'revoked' | 'expired';

export interface ShareInfo {
  id: string;
  createdAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  maxMembers: number;
  members: number;
  state: ShareState;
}

export interface ShareReason {
  /** not_ready (with `reason`), is_copy … */
  code: string;
  /** What to do, in the server's words. */
  detail: string;
  reason: string | null;
  questions: number | null;
}

export interface ExamShareState {
  ready: boolean;
  /** The exam is itself a copy from a group link: it is not shared on. */
  copy: boolean;
  reason: ShareReason | null;
  consent: string;
  maxMembers: number;
  shares: ShareInfo[];
}

export interface CreatedShare {
  share: ShareInfo;
  /** Shown once: only its hash is stored. */
  code: string;
  path: string;
}

export type PreviewStatus = 'active' | 'own' | 'joined' | 'revoked' | 'expired' | 'full' | 'not_found';

export interface SharePreview {
  status: PreviewStatus;
  title: string;
  kind: 'exam' | 'credit' | 'colloquium';
  examDate: string | null;
  questions: number;
  lectures: number;
  /** own — the author's exam, joined — the visitor's copy. */
  examId: string | null;
}

export interface JoinResult {
  examId: string;
  /** false — the copy was made earlier (joining again opens it). */
  joined: boolean;
  /** Questions copied without answer points (they did not pass the quote check for the author). */
  withoutPoints: number;
}

export class ShareApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, options: { status?: number | null; code?: string | null } = {}) {
    super(message);
    this.name = 'ShareApiError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }
}

export const SHARE_MESSAGES = {
  offline: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
  failed: 'Не получилось. Попробуйте через минуту.',
  session: 'Сессия истекла. Войдите снова.',
} as const;

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = 400): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function count(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

async function call(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ShareApiError(SHARE_MESSAGES.offline, { code: 'offline' });
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = isRecord(body) && typeof body.detail === 'string' && body.detail.trim() ? body.detail : null;
    const code = isRecord(body) && typeof body.code === 'string' ? body.code : null;
    const message = response.status === 401 ? SHARE_MESSAGES.session : detail ?? SHARE_MESSAGES.failed;
    const error = new ShareApiError(message, { status: response.status, code });
    (error as ShareApiError & { body?: unknown }).body = body;
    throw error;
  }
  return body;
}

function post(path: string, body: unknown): Promise<unknown> {
  return call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function parseShare(value: unknown): ShareInfo | null {
  if (!isRecord(value) || !uuid(value.id)) return null;
  const state = value.state === 'revoked' || value.state === 'expired' ? value.state : 'active';
  return {
    id: value.id as string,
    createdAt: strOrNull(value.created_at),
    expiresAt: strOrNull(value.expires_at),
    revokedAt: strOrNull(value.revoked_at),
    maxMembers: count(value.max_members) || 80,
    members: count(value.members),
    state,
  };
}

function parseReason(value: unknown): ShareReason | null {
  if (!isRecord(value) || typeof value.detail !== 'string') return null;
  return {
    code: str(value.code, 40),
    detail: str(value.detail),
    reason: typeof value.reason === 'string' ? value.reason : null,
    questions: typeof value.questions === 'number' ? value.questions : null,
  };
}

/** The author: is the exam ready for the group, and its links. */
export async function fetchShareState(examId: string): Promise<ExamShareState> {
  const raw = await call(`/api/exam-shares?exam_id=${encodeURIComponent(examId)}`);
  if (!isRecord(raw)) throw new ShareApiError(SHARE_MESSAGES.failed, { code: 'bad_shape' });
  return {
    ready: raw.ready === true,
    copy: raw.copy === true,
    reason: parseReason(raw.reason),
    consent: str(raw.consent),
    maxMembers: count(raw.max_members) || 80,
    shares: Array.isArray(raw.shares) ? raw.shares.map(parseShare).filter((item): item is ShareInfo => item !== null) : [],
  };
}

/** The author makes a link after the consent; the code comes once. */
export async function createShare(examId: string): Promise<CreatedShare> {
  const raw = await post('/api/exam-shares', { exam_id: examId, consent: true });
  const share = isRecord(raw) ? parseShare(raw.share) : null;
  const code = isRecord(raw) ? str(raw.code, 40) : '';
  if (!share || !/^[0-9a-hjkmnp-tv-z]{12}$/.test(code)) throw new ShareApiError(SHARE_MESSAGES.failed, { code: 'bad_shape' });
  return { share, code, path: `/join/${code}` };
}

/** The author closes a link: copies already made stay with the classmates. */
export async function revokeShare(shareId: string): Promise<string | null> {
  const raw = await post(`/api/exam-shares/${encodeURIComponent(shareId)}/revoke`, {});
  return isRecord(raw) ? strOrNull(raw.revoked_at) : null;
}

/** The invitation page: what the link is (works signed out). The code goes in the body: addresses are logged. */
export async function previewShare(code: string): Promise<SharePreview> {
  const raw = await post('/api/exam-shares/preview', { code });
  const value = isRecord(raw) ? raw : {};
  const statuses: PreviewStatus[] = ['active', 'own', 'joined', 'revoked', 'expired', 'full', 'not_found'];
  const status = statuses.includes(value.status as PreviewStatus) ? (value.status as PreviewStatus) : 'not_found';
  const kind = value.kind === 'credit' || value.kind === 'colloquium' ? value.kind : 'exam';
  return {
    status,
    title: str(value.title, 200),
    kind,
    examDate: strOrNull(value.exam_date),
    questions: count(value.questions),
    lectures: count(value.lectures),
    examId: uuid(value.exam_id),
  };
}

/** The classmate joins by the code: their own copy (joining again — the same copy). */
export async function joinShare(code: string): Promise<JoinResult> {
  const raw = await post('/api/exam-shares/join', { code });
  const examId = isRecord(raw) ? uuid(raw.exam_id) : null;
  if (!examId) throw new ShareApiError(SHARE_MESSAGES.failed, { code: 'bad_shape' });
  return { examId, joined: (raw as Record<string, unknown>).joined === true, withoutPoints: count((raw as Record<string, unknown>).without_points) };
}
