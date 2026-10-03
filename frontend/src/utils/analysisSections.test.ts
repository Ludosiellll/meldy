import { describe, expect, it } from 'vitest';
import type { AnalysisResults, SectionName } from '../types';
import {
  buildMaterialRow,
  displayResults,
  flashcardsOf,
  isRunUsable,
  parseSections,
  RUN_FAILURE_MESSAGES,
  RunCollector,
  runFailure,
  sectionFailureSentence,
  sectionHasContent,
  statusesFromResults,
} from './analysisSections';

const CORE: SectionName[] = ['summarizer', 'flashcards', 'quiz'];
const summary = { title: 'Энтропия', subject: 'Физика', content: '# Энтропия\nМера беспорядка', terms: [{ term: 'Энтропия', definition: 'Мера' }], source_ids: ['S01'] };
const cards = { flashcards: [{ id: 1, question: 'Что такое энтропия?', answer: 'Мера беспорядка', source_ids: ['S01'] }] };
const quiz = { quiz: [{ id: 1, question: 'Энтропия растёт?', options: ['A) Да', 'B) Нет'], correct: 'A', explanation: 'Да', source_ids: [] }] };

describe('content checks (old backend fallback)', () => {
  it('recognises usable payloads and rejects empty or broken ones', () => {
    expect(sectionHasContent('summarizer', summary)).toBe(true);
    expect(sectionHasContent('summarizer', { content: '  ', source_ids: [] })).toBe(false);
    expect(sectionHasContent('summarizer', { error: 'API_LIMIT_REACHED' })).toBe(false);
    expect(sectionHasContent('flashcards', cards)).toBe(true);
    expect(sectionHasContent('flashcards', { flashcards: [{ id: 1 }] })).toBe(false);
    expect(sectionHasContent('quiz', quiz)).toBe(true);
    expect(sectionHasContent('quiz', { quiz: [{ question: 'Q', options: ['A) один'] }] })).toBe(false);
    expect(sectionHasContent('podcast', { podcast: [{ speaker: 'Макс', text: 'Привет' }] })).toBe(true);
    expect(sectionHasContent('cheatsheet', { content: '' })).toBe(false);
  });
});

describe('statuses and usability', () => {
  it('takes statuses from results.sections when the server sends them', () => {
    const statuses = statusesFromResults(
      { summarizer: summary, flashcards: { error: 'Сервис ИИ был перегружен' } as never, quiz: quiz, sections: { summarizer: { status: 'ok' }, flashcards: { status: 'busy', message: 'Сервис ИИ был перегружен' }, quiz: { status: 'ok' } } },
      CORE,
    );
    expect(statuses).toEqual({
      summarizer: { status: 'ok' },
      flashcards: { status: 'busy', message: 'Сервис ИИ был перегружен' },
      quiz: { status: 'ok' },
    });
    expect(isRunUsable(statuses, CORE)).toBe(true);
  });

  it('falls back to a content check for an old backend without sections', () => {
    const statuses = statusesFromResults(
      { summarizer: { content: '', source_ids: [] } as never, flashcards: { flashcards: [] }, quiz: { error: 'API_LIMIT_REACHED' } as never, warnings: [{ agent: 'quiz', message: 'API_LIMIT_REACHED' }] },
      CORE,
    );
    expect(statuses.summarizer?.status).toBe('empty');
    expect(statuses.flashcards?.status).toBe('empty');
    expect(statuses.quiz?.status).toBe('busy');
    expect(isRunUsable(statuses, CORE)).toBe(false);
    expect(runFailure(statuses, CORE).kind).toBe('server');
  });

  it('only requested core sections decide; with no core requested any requested section does', () => {
    expect(isRunUsable({ summarizer: { status: 'failed' }, podcast: { status: 'ok' } }, ['summarizer', 'podcast'])).toBe(false);
    expect(isRunUsable({ podcast: { status: 'ok' } }, ['podcast'])).toBe(true);
    expect(isRunUsable({ podcast: { status: 'busy' }, cheatsheet: { status: 'empty' } }, ['cheatsheet', 'podcast'])).toBe(false);
  });

  it('explains a failed run like the server does', () => {
    expect(runFailure({ summarizer: { status: 'busy' }, quiz: { status: 'busy' } }, ['summarizer', 'quiz'])).toEqual({ kind: 'busy', message: RUN_FAILURE_MESSAGES.busy });
    expect(runFailure({ summarizer: { status: 'busy' }, quiz: { status: 'timeout' } }, ['summarizer', 'quiz']).kind).toBe('timeout');
    expect(runFailure({ summarizer: { status: 'empty' }, quiz: { status: 'empty' } }, ['summarizer', 'quiz'])).toEqual({ kind: 'empty', message: RUN_FAILURE_MESSAGES.empty });
    expect(runFailure({ summarizer: { status: 'failed' }, quiz: { status: 'empty' } }, ['summarizer', 'quiz']).kind).toBe('server');
  });

  it('parses only known names and statuses', () => {
    expect(parseSections({ quiz: { status: 'busy', message: 'Сервис ИИ был перегружен' }, missions: { status: 'ok' }, flashcards: { status: 'weird' } })).toEqual({
      quiz: { status: 'busy', message: 'Сервис ИИ был перегружен' },
    });
    expect(parseSections(undefined)).toBeUndefined();
    expect(parseSections({})).toBeUndefined();
  });
});

describe('failure sentence', () => {
  it('builds one plain sentence from the section message', () => {
    expect(sectionFailureSentence('quiz', { status: 'busy', message: 'Сервис ИИ был перегружен' })).toBe('Тест не получился: сервис ИИ был перегружен.');
    expect(sectionFailureSentence('flashcards', { status: 'empty' })).toBe('Карточки не получились: модель вернула пустой ответ.');
    expect(sectionFailureSentence('summarizer', { status: 'missing' })).toBe('Конспект не получился: связь прервалась до этого раздела.');
    expect(sectionFailureSentence('cheatsheet', { status: 'timeout' })).toBe('Шпаргалка не получилась: модель не ответила вовремя.');
    expect(sectionFailureSentence('quiz', { status: 'failed', message: 'ИИ-сервис сейчас не ответил.' })).toBe('Тест не получился: ИИ-сервис сейчас не ответил.');
  });
});

describe('partial results from agent_done events', () => {
  it('keeps arrived ok sections, marks never-arrived ones as missing', () => {
    const collector = new RunCollector();
    collector.add({ type: 'text_extracted', text: 'Текст лекции', length: 12 });
    collector.add({ type: 'grounding', source_count: 1, sources: [{ id: 'S01', text: 'Текст лекции' }] });
    collector.add({ type: 'agent_done', agent: 'summarizer', status: 'ok', result: summary });
    collector.add({ type: 'agent_done', agent: 'flashcards', status: 'busy', message: 'Сервис ИИ был перегружен' });
    expect(collector.hasUsableSection(CORE)).toBe(true);
    const results = collector.partialResults(CORE);
    expect(results.summarizer.content).toBe(summary.content);
    expect(results.flashcards).toEqual({ flashcards: [] });
    expect(results.quiz).toEqual({ quiz: [] });
    expect(results.grounding).toEqual({ source_count: 1, citable_items: 0, sources: [{ id: 'S01', text: 'Текст лекции' }] });
    expect(results.sections).toEqual({
      summarizer: { status: 'ok' },
      flashcards: { status: 'busy', message: 'Сервис ИИ был перегружен' },
      quiz: { status: 'missing', message: 'Связь прервалась до этого раздела' },
    });
    expect(collector.text).toBe('Текст лекции');
  });

  it('an agent_done without status (old backend) or with an empty ok result is not usable', () => {
    const collector = new RunCollector();
    collector.add({ type: 'agent_done', agent: 'summarizer', progress: 1, total: 3 });
    collector.add({ type: 'agent_done', agent: 'quiz', status: 'ok', result: { quiz: [] } });
    expect(collector.hasUsableSection(CORE)).toBe(false);
  });
});

describe('material row', () => {
  it('stores empty lists for failed sections, statuses and demo markers, never {error}', () => {
    const results = displayResults(
      { summarizer: summary, flashcards: { error: 'x' } as never, quiz: quiz, grounding: { source_count: 2, citable_items: 1, sources: [] } },
      { summarizer: { status: 'ok' }, flashcards: { status: 'failed', message: 'Модель не ответила' }, quiz: { status: 'ok' } },
    );
    const row = buildMaterialRow({ userId: 'u1', results, extractedText: 'Текст', sourceName: 'lecture.pdf', demoTextId: 'demo-v1' });
    expect(row).toMatchObject({
      user_id: 'u1',
      title: 'Энтропия',
      subject: 'Физика',
      original_text: 'Текст',
      flashcards_json: { flashcards: [] },
      quiz_json: quiz,
      missions_json: { missions: [] },
    });
    const summaryJson = row.summary_json as Record<string, unknown>;
    expect(summaryJson).toMatchObject({
      content: summary.content,
      source_ids: ['S01'],
      cheatsheet: '',
      podcast: [],
      origin: 'demo',
      demo_text_id: 'demo-v1',
      grounding: { source_count: 2, citable_items: 1, sources: [] },
      sections: { summarizer: { status: 'ok' }, flashcards: { status: 'failed', message: 'Модель не ответила' }, quiz: { status: 'ok' } },
    });
    expect(JSON.stringify(row)).not.toContain('"error"');
  });

  it('falls back to the source name for the title and has no demo keys for a normal run', () => {
    const results = displayResults(
      { flashcards: cards, summarizer: undefined as never, quiz: undefined as never },
      { summarizer: { status: 'missing' }, flashcards: { status: 'ok' }, quiz: { status: 'missing' } },
    );
    const row = buildMaterialRow({ userId: 'u1', results, extractedText: 'Текст', sourceName: 'Лекция 3. Эластичность спроса.txt' });
    expect(row.title).toBe('Лекция 3. Эластичность спроса');
    expect(row.subject).toBe('');
    expect(row.flashcards_json).toEqual(cards);
    expect(row.quiz_json).toEqual({ quiz: [] });
    expect(row.summary_json).not.toHaveProperty('origin');
    expect(row.summary_json).not.toHaveProperty('demo_text_id');
    expect(flashcardsOf(results as AnalysisResults)).toHaveLength(1);
  });
});
