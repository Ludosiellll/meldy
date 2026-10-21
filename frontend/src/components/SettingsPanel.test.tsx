import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import SettingsPanel, { settingsSummary } from './SettingsPanel';
import { DEFAULT_SETTINGS, type AnalysisSettings } from '../types';

const settings = (patch: Partial<AnalysisSettings> = {}): AnalysisSettings => ({ ...DEFAULT_SETTINGS, ...patch });

afterEach(cleanup);

describe('what the analysis will make, in one line (finding LIB-8)', () => {
  it('names what is on, in the order of the list, with the numbers that matter', () => {
    expect(settingsSummary(settings({ enabledAgents: ['summarizer', 'flashcards', 'quiz'], flashcardCount: 6, quizCount: 5, summaryDetail: 'medium' }))).toBe(
      'конспект, 6 карточек и самопроверка из 5 вопросов',
    );
    expect(
      settingsSummary(settings({ enabledAgents: ['podcast', 'quiz', 'summarizer', 'cheatsheet', 'flashcards'], summaryDetail: 'detailed', flashcardCount: 1, quizCount: 3, quizType: 'truefalse' })),
    ).toBe('подробный конспект, 1 карточка, самопроверка из 3 вопросов «верно или неверно», выжимка и подкаст');
    expect(settingsSummary(settings({ enabledAgents: ['flashcards'], flashcardCount: 12 }))).toBe('12 карточек');
    expect(settingsSummary(settings({ enabledAgents: ['summarizer'], summaryDetail: 'brief' }))).toBe('краткий конспект');
  });
});

describe('the settings of an analysis', () => {
  it('say what each part is in the student’s words, the two-host audio as «Подкаст» (decision 1)', () => {
    render(<SettingsPanel settings={settings()} onChange={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Что сделать из лекции' });
    const parts = within(group).getAllByRole('checkbox').map((box) => box.querySelector('.ac-mod-t')?.textContent);
    expect(parts).toEqual(['Конспект', 'Карточки', 'Самопроверка', 'Выжимка', 'Подкаст']);
    expect(group.textContent).not.toMatch(/Модул|генерац|Флеш|интервальн|[Рр]азговор/);
  });

  it('change nothing while disabled (the demo text has its own settings)', () => {
    const onChange = vi.fn();
    render(<SettingsPanel settings={settings()} onChange={onChange} disabled />);
    const podcast = screen.getAllByRole('checkbox').find((box) => box.textContent?.includes('Подкаст')) as HTMLElement;
    expect(podcast).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(podcast);
    expect(onChange).not.toHaveBeenCalled();
  });
});
