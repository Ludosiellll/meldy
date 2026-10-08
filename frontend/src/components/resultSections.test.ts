import { describe, expect, it } from 'vitest';
import type { AnalysisResults } from '../types';
import { openingResultTab, resultSectionFailed, resultTabs } from './resultSections';

const summary = { content: 'Энтропия — мера беспорядка.' };
const cards = { flashcards: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, question: `Вопрос ${i + 1}`, answer: 'Ответ' })) };
const quiz = { quiz: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, question: `Вопрос ${i + 1}`, options: ['A) Да', 'B) Нет'], correct: 'A' })) };

const result = (patch: Partial<AnalysisResults> = {}) => ({ summarizer: summary, flashcards: cards, quiz, ...patch }) as AnalysisResults;

describe('resultTabs', () => {
  it('names the sections with content and their counts: «Конспект · Карточки 6 · Тест 5»', () => {
    expect(resultTabs(result())).toEqual([
      { id: 'summary', label: 'Конспект' },
      { id: 'flashcards', label: 'Карточки', count: 6 },
      { id: 'quiz', label: 'Тест', count: 5 },
    ]);
  });

  it('keeps a section that failed, so its tab can say so and make it again; drops an empty one', () => {
    const failed = result({ quiz: { quiz: [] }, sections: { quiz: { status: 'busy' } } });
    expect(resultTabs(failed).map(tab => tab.id)).toEqual(['summary', 'flashcards', 'quiz']);
    expect(resultSectionFailed(failed, 'quiz')).toBe(true);
    expect(resultTabs(result({ quiz: { quiz: [] } })).map(tab => tab.id)).toEqual(['summary', 'flashcards']);
  });

  it('has the podcast only where the page shows it as a tab, and nothing for a text-only material', () => {
    expect(resultTabs(result(), { showConversation: true, conversationCount: 3 }).map(tab => tab.id)).toEqual(['summary', 'flashcards', 'quiz', 'podcast']);
    expect(resultTabs(result(), { conversationCount: 3 }).map(tab => tab.id)).not.toContain('podcast');
    expect(resultTabs(result({ text_only: true }))).toEqual([]);
  });
});

describe('openingResultTab', () => {
  it('opens on the asked tab when it has content, else on the first with content', () => {
    const tabs = resultTabs(result());
    expect(openingResultTab(tabs, result(), 'quiz')).toBe('quiz');
    const noSummary = result({ summarizer: { content: '' } as AnalysisResults['summarizer'], sections: { summarizer: { status: 'failed' } } });
    const failedFirst = resultTabs(noSummary);
    expect(failedFirst[0].id).toBe('summary');
    expect(openingResultTab(failedFirst, noSummary)).toBe('flashcards');
    expect(openingResultTab(failedFirst, noSummary, 'summary')).toBe('flashcards');
  });
});
