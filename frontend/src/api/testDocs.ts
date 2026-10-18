/**
 * «Студия теста»: the test's page document (migration 20261019100000_test_docs.sql; plan
 * docs/superpowers/plans/2026-10-18-studio.md, «Data contract — database»). Two functions, the exam's owner only:
 *
 * - `test_doc_get(p_container_id)` → `{container_id, doc, rev, updated_at}`, or null when the exam has no page yet;
 * - `test_doc_save(p_container_id, p_doc, p_rev)` → `{rev, updated_at}`. `p_rev` is the revision the page was read at
 *   (0 for the first save). Another tab saved since → MC020 (detail «stale», the message carries nothing: the page
 *   reads the document again); a document the server refuses → 22023 with the broken rule as the detail (or «size»);
 *   an exam that is not the caller's → P0002.
 *
 * Errors come as ContainerApiError (api/containers.ts), MC020 with its own words. The stored document is returned as
 * it came (`doc: unknown`): the studio passes it through lib/studio/doc.ts normalizeDoc before showing it.
 */
import { supabase } from '../lib/supabase';
import { CONTAINER_ERROR_TEXT, ContainerApiError, containerError } from './containers';
import type { Uuid } from '../types/container';
import type { TestDoc } from '../types/testDoc';

/** MC020: the page was saved in another tab after this one read it. */
export const STALE_CODE = 'MC020';
export const STALE_TEXT = 'Тест изменён в другой вкладке.';

/** The stored page as test_doc_get gives it; `doc` is raw until normalizeDoc. */
export interface StoredDoc {
  container_id: Uuid;
  doc: unknown;
  rev: number;
  updated_at: string;
}

export interface DocSaved {
  rev: number;
  updated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function revOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function badShape(what: string): ContainerApiError {
  return new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { detail: `bad shape: ${what}` });
}

function docError(error: unknown, status: number): ContainerApiError {
  if (isRecord(error) && text(error.code) === STALE_CODE) {
    return new ContainerApiError(STALE_CODE, STALE_TEXT, { status, detail: text(error.details) || 'stale' });
  }
  return containerError(error, status);
}

async function rpc(name: 'test_doc_get' | 'test_doc_save', args: Record<string, unknown>): Promise<unknown> {
  let result: { data: unknown; error: unknown; status?: number };
  try {
    result = await supabase.rpc(name, args);
  } catch (error) {
    const kind = error instanceof Error ? error.name : '';
    if (kind === 'TypeError' || kind === 'AbortError') throw new ContainerApiError('network', CONTAINER_ERROR_TEXT.network, { status: 0 });
    throw new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown);
  }
  if (result.error) throw docError(result.error, typeof result.status === 'number' ? result.status : 0);
  return result.data;
}

/** The exam's page with its revision, or null when it has none yet. */
export async function fetchTestDoc(containerId: Uuid): Promise<StoredDoc | null> {
  const raw = await rpc('test_doc_get', { p_container_id: containerId });
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw) || !('doc' in raw)) throw badShape('test_doc_get');
  const rev = revOf(raw.rev);
  if (rev === null) throw badShape('test_doc_get rev');
  return {
    container_id: typeof raw.container_id === 'string' ? raw.container_id : containerId,
    doc: raw.doc,
    rev,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : '',
  };
}

/** Saves the whole page over revision `rev` (0 — the first save); the new revision comes back. */
export async function saveTestDoc(containerId: Uuid, doc: TestDoc, rev: number): Promise<DocSaved> {
  const raw = await rpc('test_doc_save', { p_container_id: containerId, p_doc: doc, p_rev: rev });
  const next = isRecord(raw) ? revOf(raw.rev) : null;
  if (!isRecord(raw) || next === null) throw badShape('test_doc_save');
  return { rev: next, updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : '' };
}

/** Another tab saved the page after this one read it (MC020). */
export function isStale(error: unknown): boolean {
  return error instanceof ContainerApiError && error.code === STALE_CODE;
}

/** The server refused the document: the rule it named (22023 detail: «title», «block:3:text», «size» …), else null. */
export function refusedRule(error: unknown): string | null {
  return error instanceof ContainerApiError && error.code === '22023' && error.detail ? error.detail : null;
}
