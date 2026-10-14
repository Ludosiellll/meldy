/**
 * Reading one file or one pasted list for the import page (package D3a).
 *
 * - DOCX, XLSX, TXT, MD and pasted text go to the question-bank importer (api/containers.ts parseBank,
 *   POST /api/exams/parse-bank) with the file's format (auto | test | open) and the student's key list (key_text).
 * - A PDF has no formatting to find a key in: it is read by the oral list's parser (api/exams.ts parseQuestionList,
 *   the existing POST /api/exams/parse, which also reads scans) as a list of open questions (Concept 1 §3.2: «PDF и
 *   сканы — для списков без вариантов»).
 * - What can be told before sending is told at once: a Word 97–2003 file (.doc), another format, an empty or too big
 *   file. Errors carry the importer's code and the spec's Russian line (copyImport.ts PARSE_ERRORS).
 */
import { parseBank } from '../../../api/containers';
import { examErrorMessage, parseQuestionList, type ParseResult } from '../../../api/exams';
import type { BankItem, BankParseResult } from '../../../types/container';
import { PARSE_ERRORS } from '../copyImport';
import type { FileFormat } from './importModel';

export const ACCEPT = '.docx,.xlsx,.txt,.md,.pdf,.doc';
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const READABLE = new Set(['docx', 'xlsx', 'txt', 'md']);

export class ReadError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? PARSE_ERRORS[code] ?? PARSE_ERRORS.unknown);
    this.name = 'ReadError';
    this.code = code;
  }
}

export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

/** The refusal that needs no request, or null. */
export function precheck(file: File): ReadError | null {
  const extension = extensionOf(file.name);
  if (extension === 'doc') return new ReadError('old_doc');
  if (extension !== 'pdf' && !READABLE.has(extension)) return new ReadError('unsupported');
  if (file.size === 0) return new ReadError('empty_file');
  if (file.size > MAX_FILE_BYTES) return new ReadError('file_too_big');
  return null;
}

/** The oral parser's list as an importer result: one subject, its sections as topics, every question open. */
export function oralListAsBank(parsed: ParseResult): BankParseResult {
  const sectionTitle = new Map(parsed.sections.map((section) => [section.index, section.title]));
  const items: BankItem[] = parsed.questions.map((question, index) => ({
    position: index + 1,
    label: question.label,
    subject: 1,
    topic: question.section,
    kind: 'open',
    text: question.text,
    options: [],
    correct: [],
    order: [],
    pairs: [],
    answer: null,
    evidence: '',
    flags: [],
    code: false,
    where: '',
    marks: {},
  }));
  const topicIds = Array.from(new Set(items.map((item) => item.topic).filter((topic): topic is number => topic !== null)));
  return {
    method: 'oral_list',
    layout: 'oral_list',
    layouts_seen: {},
    confidence: 1,
    key_source: {},
    format_signal: null,
    format_signals: {},
    mark_share: 0.6,
    marker: null,
    markers: [],
    subjects: [{ index: 1, title: null, evidence: 'none', items: items.length }],
    topics: topicIds.map((id) => ({
      index: id,
      title: sectionTitle.get(id) || `Раздел ${id}`,
      subject: 1,
      items: items.filter((item) => item.topic === id).length,
    })),
    skipped: (parsed.skipped ?? []).map((line) => line.text),
    warnings: parsed.warnings,
    items,
    stats: {
      items: items.length,
      with_key: 0,
      no_key: 0,
      ambiguous: 0,
      to_check: 0,
      duplicates: 0,
      kinds: { open: items.length },
      options: { '0': items.length },
      gaps: [],
      key_lists: 0,
    },
  };
}

function asReadError(error: unknown): ReadError {
  if (error instanceof ReadError) return error;
  const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? String((error as { code: string }).code) : 'unknown';
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 429 || code === '429' || code === 'rate_limit') return new ReadError('rate_limited');
  if (PARSE_ERRORS[code]) return new ReadError(code);
  const message = error instanceof Error ? error.message.trim() : '';
  return new ReadError(code, message && /[а-яё]/i.test(message) ? message : PARSE_ERRORS.unknown);
}

export interface ReadInput {
  file?: File;
  text?: string;
  format: FileFormat;
  keyText?: string;
  keyFile?: File | null;
  keySection?: number | null;
}

/** Reads one file (or pasted text) into an importer result; throws ReadError with the Russian line. */
export async function readBank(input: ReadInput): Promise<{ result: BankParseResult; pdf: boolean }> {
  if (input.file) {
    const refused = precheck(input.file);
    if (refused) throw refused;
    if (extensionOf(input.file.name) === 'pdf') {
      try {
        return { result: oralListAsBank(await parseQuestionList({ file: input.file })), pdf: true };
      } catch (error) {
        throw new ReadError('unknown', examErrorMessage(error, PARSE_ERRORS.unknown));
      }
    }
  }
  try {
    const result = await parseBank({
      file: input.file,
      text: input.file ? undefined : input.text,
      format: input.format,
      keyText: input.keyText?.trim() ? input.keyText : undefined,
      keyFile: input.keyFile ?? undefined,
      keySection: input.keySection ?? null,
    });
    return { result, pdf: false };
  } catch (error) {
    throw asReadError(error);
  }
}
