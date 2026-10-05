/**
 * Чистые правила исхода анализа: какие разделы получились, годен ли запуск
 * для сохранения, что показать и что записать в materials.
 *
 * Запуск годен, если получился хотя бы один запрошенный основной раздел
 * (конспект, карточки, тест); если основных не просили — хотя бы один запрошенный.
 * Только годный запуск сохраняется и списывает энергию.
 */
import type {
  AnalysisResults,
  GroundingInfo,
  SectionName,
  SectionState,
  SectionStates,
  SectionStatus,
} from '../types';
import { getResultDisplayTitle } from './resultPresentation';

export const SECTION_NAMES: readonly SectionName[] = ['summarizer', 'flashcards', 'quiz', 'cheatsheet', 'podcast'];
export const CORE_SECTIONS: readonly SectionName[] = ['summarizer', 'flashcards', 'quiz'];
const STATUSES: readonly SectionStatus[] = ['ok', 'empty', 'busy', 'failed', 'timeout', 'missing'];

export const SECTION_LABELS: Record<SectionName, string> = {
  summarizer: 'Конспект',
  flashcards: 'Карточки',
  quiz: 'Тест',
  cheatsheet: 'Выжимка',
  podcast: 'Разговор',
};

/** «Готовим конспект, карточки и тест»: формы для перечня. */
export const SECTION_ACCUSATIVE: Record<SectionName, string> = {
  summarizer: 'конспект',
  flashcards: 'карточки',
  quiz: 'тест',
  cheatsheet: 'выжимку',
  podcast: 'разговор',
};

const FAILED_VERB: Record<SectionName, string> = {
  summarizer: 'не получился',
  flashcards: 'не получились',
  quiz: 'не получился',
  cheatsheet: 'не получилась',
  podcast: 'не получился',
};

/** Причины сбоя раздела, как их присылает сервер; missing — только клиент. */
export const SECTION_STATUS_MESSAGES: Record<Exclude<SectionStatus, 'ok'>, string> = {
  empty: 'Модель вернула пустой ответ',
  busy: 'Сервис ИИ был перегружен',
  failed: 'Модель не ответила',
  timeout: 'Модель не ответила вовремя',
  missing: 'Связь прервалась до этого раздела',
};

/** Тексты для запуска, в котором не получилось ничего годного (как у сервера). */
export const RUN_FAILURE_MESSAGES = {
  busy: 'Сервис ИИ сейчас занят. Материал не сохранён, лимит не списан. Попробуйте через минуту.',
  empty:
    'Не получилось подготовить ни конспект, ни карточки, ни тест. Материал не сохранён, лимит не списан. Попробуйте ещё раз.',
  failed: 'ИИ-сервис сейчас не ответил. Материал не сохранён, лимит не списан. Повторите через минуту.',
} as const;

export const PARTIAL_NOTICE = 'Связь прервалась. Показаны разделы, которые успели прийти.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isSectionName(value: unknown): value is SectionName {
  return typeof value === 'string' && (SECTION_NAMES as readonly string[]).includes(value);
}

export function isCoreSection(name: SectionName): boolean {
  return CORE_SECTIONS.includes(name);
}

export function isSectionStatus(value: unknown): value is SectionStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function parseSectionState(raw: unknown): SectionState | null {
  if (!isRecord(raw) || !isSectionStatus(raw.status)) return null;
  const message = nonEmptyString(raw.message) ? raw.message.trim().slice(0, 200) : undefined;
  return message ? { status: raw.status, message } : { status: raw.status };
}

/** results.sections или summary_json.sections → только известные разделы и статусы. */
export function parseSections(raw: unknown): SectionStates | undefined {
  if (!isRecord(raw)) return undefined;
  const out: SectionStates = {};
  let found = false;
  for (const name of SECTION_NAMES) {
    const state = parseSectionState(raw[name]);
    if (state) {
      out[name] = state;
      found = true;
    }
  }
  return found ? out : undefined;
}

/** Разделы, которые запрошены в запуске (по enabled_agents). */
export function requestedSections(enabled: readonly string[]): SectionName[] {
  return SECTION_NAMES.filter(name => enabled.includes(name));
}

export function sectionPayload(results: Partial<AnalysisResults> | null | undefined, name: SectionName): unknown {
  if (!results) return undefined;
  return (results as Record<string, unknown>)[name];
}

function listOf(payload: unknown, key: string): unknown[] | null {
  if (isRecord(payload) && Array.isArray(payload[key])) return payload[key] as unknown[];
  return null;
}

/** Есть ли в разделе годное содержимое (для старого backend без sections и как страховка). */
export function sectionHasContent(name: SectionName, payload: unknown): boolean {
  switch (name) {
    case 'summarizer':
    case 'cheatsheet':
      return isRecord(payload) && nonEmptyString(payload.content);
    case 'flashcards': {
      const list = listOf(payload, 'flashcards') ?? (Array.isArray(payload) ? payload : null);
      return !!list && list.some(card => isRecord(card) && nonEmptyString(card.question) && nonEmptyString(card.answer));
    }
    case 'quiz': {
      const list = listOf(payload, 'quiz');
      return (
        !!list &&
        list.some(item => isRecord(item) && nonEmptyString(item.question) && Array.isArray(item.options) && item.options.length >= 2)
      );
    }
    case 'podcast': {
      const list = listOf(payload, 'podcast');
      return !!list && list.some(line => isRecord(line) && nonEmptyString(line.text));
    }
    default:
      return false;
  }
}

/** Раздел показывает содержимое: статус ok или (на всякий случай) содержимое есть. */
export function sectionIsOk(results: Partial<AnalysisResults> | null | undefined, name: SectionName): boolean {
  const state = results?.sections?.[name];
  if (state?.status === 'ok') return true;
  return sectionHasContent(name, sectionPayload(results, name));
}

/** Статусы запрошенных разделов события results: из sections сервера, иначе по содержимому. */
export function statusesFromResults(results: Partial<AnalysisResults>, requested: readonly SectionName[]): SectionStates {
  const fromServer = parseSections(results.sections);
  const out: SectionStates = {};
  for (const name of requested) {
    const server = fromServer?.[name];
    if (server) {
      out[name] = server;
      continue;
    }
    const payload = sectionPayload(results, name);
    if (sectionHasContent(name, payload)) {
      out[name] = { status: 'ok' };
      continue;
    }
    const error = isRecord(payload) ? payload.error : undefined;
    const warned = (results.warnings || []).some(warning => warning?.agent === name);
    if (error === 'API_LIMIT_REACHED') out[name] = { status: 'busy', message: SECTION_STATUS_MESSAGES.busy };
    else if (error !== undefined || warned) out[name] = { status: 'failed', message: SECTION_STATUS_MESSAGES.failed };
    else out[name] = { status: 'empty', message: SECTION_STATUS_MESSAGES.empty };
  }
  return out;
}

function decisiveSections(requested: readonly SectionName[]): SectionName[] {
  const core = requested.filter(isCoreSection);
  return core.length > 0 ? core : [...requested];
}

/** Годен ли запуск: получился хотя бы один основной раздел (или любой, если основных не просили). */
export function isRunUsable(statuses: SectionStates, requested: readonly SectionName[]): boolean {
  return decisiveSections(requested).some(name => statuses[name]?.status === 'ok');
}

/** Почему запуск не годен: занято — только если всё занято; не успели — если хоть один не успел. */
export function runFailure(
  statuses: SectionStates,
  requested: readonly SectionName[],
): { kind: 'busy' | 'timeout' | 'empty' | 'server'; message: string } {
  const failed = decisiveSections(requested)
    .map(name => statuses[name]?.status ?? 'missing')
    .filter(status => status !== 'ok');
  if (failed.length > 0 && failed.every(status => status === 'busy')) return { kind: 'busy', message: RUN_FAILURE_MESSAGES.busy };
  if (failed.some(status => status === 'timeout')) return { kind: 'timeout', message: RUN_FAILURE_MESSAGES.failed };
  if (failed.length > 0 && failed.every(status => status === 'empty')) return { kind: 'empty', message: RUN_FAILURE_MESSAGES.empty };
  return { kind: 'server', message: RUN_FAILURE_MESSAGES.failed };
}

function sentenceReason(text: string): string {
  const clean = text.trim().replace(/[.!…]+$/, '');
  if (clean.length > 1 && clean[1] === clean[1].toLowerCase()) return clean[0].toLowerCase() + clean.slice(1);
  return clean;
}

/** «Тест не получился: сервис ИИ был перегружен.» */
export function sectionFailureSentence(name: SectionName, state?: SectionState | null): string {
  const status = state?.status && state.status !== 'ok' ? state.status : 'failed';
  const reason = state?.message || SECTION_STATUS_MESSAGES[status];
  return `${SECTION_LABELS[name]} ${FAILED_VERB[name]}: ${sentenceReason(reason)}.`;
}

/** Пустой контейнер раздела вместо {error} или мусора. */
export function emptySection(name: SectionName): unknown {
  switch (name) {
    case 'summarizer':
      return { content: '', terms: [], source_ids: [] };
    case 'flashcards':
      return { flashcards: [] };
    case 'quiz':
      return { quiz: [] };
    case 'cheatsheet':
      return { content: '' };
    case 'podcast':
      return { podcast: [] };
    default:
      return undefined;
  }
}

/** Результат для экрана: у раздела не «ok» — пустой контейнер, статусы — в sections. */
export function displayResults(results: Partial<AnalysisResults>, statuses: SectionStates): AnalysisResults {
  const next: Record<string, unknown> = { ...results };
  for (const name of SECTION_NAMES) {
    const state = statuses[name];
    if (state && state.status !== 'ok') next[name] = emptySection(name);
    else if (!state && next[name] !== undefined && !sectionHasContent(name, next[name])) next[name] = emptySection(name);
  }
  if (!isRecord(next.summarizer)) next.summarizer = emptySection('summarizer');
  if (!isRecord(next.flashcards)) next.flashcards = emptySection('flashcards');
  if (!isRecord(next.quiz)) next.quiz = emptySection('quiz');
  next.sections = statuses;
  next.warnings = [];
  return next as unknown as AnalysisResults;
}

export function parseGrounding(raw: unknown): GroundingInfo | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.sources)) return undefined;
  const sources = raw.sources
    .filter((item): item is { id: string; text: string } => isRecord(item) && typeof item.id === 'string' && typeof item.text === 'string')
    .map(item => ({ id: item.id, text: item.text }));
  return {
    source_count: typeof raw.source_count === 'number' ? raw.source_count : sources.length,
    citable_items: typeof raw.citable_items === 'number' ? raw.citable_items : 0,
    sources,
  };
}

interface CollectedSection {
  status: SectionStatus;
  message?: string;
  result?: unknown;
}

/**
 * Собирает события потока: текст, фрагменты источника и готовые разделы
 * (agent_done со статусом и результатом). Из них строится частичный результат,
 * если связь прервалась до события results.
 */
export class RunCollector {
  text = '';
  textLength = 0;
  grounding: GroundingInfo | undefined;
  private sections = new Map<SectionName, CollectedSection>();

  add(event: Record<string, unknown>): void {
    switch (event.type) {
      case 'text_extracted':
        this.text = typeof event.text === 'string' ? event.text : '';
        this.textLength = typeof event.length === 'number' ? event.length : this.text.length;
        break;
      case 'grounding':
        this.grounding = parseGrounding(event) ?? this.grounding;
        break;
      case 'agent_done': {
        if (!isSectionName(event.agent) || !isSectionStatus(event.status)) break;
        const message = nonEmptyString(event.message) ? event.message : undefined;
        if (event.status === 'ok') {
          if (sectionHasContent(event.agent, event.result)) {
            this.sections.set(event.agent, { status: 'ok', result: event.result });
          } else {
            this.sections.set(event.agent, { status: 'empty', message: SECTION_STATUS_MESSAGES.empty });
          }
        } else {
          this.sections.set(event.agent, { status: event.status, message: message ?? SECTION_STATUS_MESSAGES[event.status] });
        }
        break;
      }
      default:
        break;
    }
  }

  /** Пришёл ли хотя бы один годный раздел, решающий судьбу запуска. */
  hasUsableSection(requested: readonly SectionName[]): boolean {
    return isRunUsable(this.statuses(requested), requested);
  }

  statuses(requested: readonly SectionName[]): SectionStates {
    const out: SectionStates = {};
    for (const name of requested) {
      const got = this.sections.get(name);
      if (!got) out[name] = { status: 'missing', message: SECTION_STATUS_MESSAGES.missing };
      else out[name] = got.message ? { status: got.status, message: got.message } : { status: got.status };
    }
    return out;
  }

  /** Частичный результат из пришедших разделов (для экрана и сохранения). */
  partialResults(requested: readonly SectionName[]): AnalysisResults {
    const raw: Record<string, unknown> = {};
    for (const name of SECTION_NAMES) {
      const got = this.sections.get(name);
      if (got?.status === 'ok') raw[name] = got.result;
    }
    if (this.grounding) raw.grounding = this.grounding;
    return displayResults(raw as Partial<AnalysisResults>, this.statuses(requested));
  }
}

function stringList(value: unknown, limit = 50): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, limit) : [];
}

export interface MaterialRowInput {
  userId: string;
  /** Результат для экрана (displayResults): у неудавшихся разделов пустые контейнеры. */
  results: AnalysisResults;
  extractedText: string;
  sourceName: string;
  /** Для демо-текста: summary_json.origin = 'demo' и этот demo_text_id. */
  demoTextId?: string | null;
}

/**
 * Строка materials для годного запуска. flashcards_json и quiz_json — всегда списки
 * (у неудавшегося раздела пустые, никогда {error}); summary_json.sections — статусы
 * запрошенных разделов.
 */
export function buildMaterialRow(input: MaterialRowInput): Record<string, unknown> {
  const { results } = input;
  const summary = isRecord(results.summarizer) ? results.summarizer : ({} as Record<string, unknown>);
  const summaryOk = sectionIsOk(results, 'summarizer') && nonEmptyString(summary.content);
  const flashcards = sectionIsOk(results, 'flashcards') ? listOf(results.flashcards, 'flashcards') ?? [] : [];
  const quiz = sectionIsOk(results, 'quiz') ? listOf(results.quiz, 'quiz') ?? [] : [];
  const cheatsheet =
    sectionIsOk(results, 'cheatsheet') && isRecord(results.cheatsheet) && nonEmptyString(results.cheatsheet.content)
      ? results.cheatsheet.content
      : '';
  const podcast = sectionIsOk(results, 'podcast') ? listOf(results.podcast, 'podcast') ?? [] : [];
  const missions = isRecord(results.missions) && Array.isArray(results.missions.missions) ? results.missions : { missions: [] };

  const summaryJson: Record<string, unknown> = {
    content: summaryOk ? String(summary.content) : '',
    terms: summaryOk && Array.isArray(summary.terms) ? summary.terms : [],
    cheatsheet,
    podcast,
    source_ids: summaryOk ? stringList(summary.source_ids) : [],
    sections: results.sections ?? {},
  };
  if (results.grounding) summaryJson.grounding = results.grounding;
  // «Создать … заново» для неудавшегося раздела бесплатно только по квитанции сервера.
  if (typeof results.receipt === 'string' && results.receipt) summaryJson.receipt = results.receipt;
  if (input.demoTextId) {
    summaryJson.origin = 'demo';
    summaryJson.demo_text_id = input.demoTextId;
  }

  return {
    user_id: input.userId,
    title: getResultDisplayTitle(results, input.sourceName),
    subject: summaryOk && typeof summary.subject === 'string' ? summary.subject : '',
    original_text: input.extractedText,
    summary_json: summaryJson,
    missions_json: missions,
    flashcards_json: { flashcards },
    quiz_json: { quiz },
  };
}

/** Карточки, которые надо добавить в повторение. */
export function flashcardsOf(results: Partial<AnalysisResults> | null | undefined): { question: string; answer: string; source_ids?: string[] }[] {
  const list = listOf(results?.flashcards, 'flashcards') ?? [];
  return list.filter(
    (card): card is { question: string; answer: string; source_ids?: string[] } =>
      isRecord(card) && nonEmptyString(card.question) && nonEmptyString(card.answer),
  );
}
