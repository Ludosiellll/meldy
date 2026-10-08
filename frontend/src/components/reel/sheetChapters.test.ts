import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeSentence } from '../exams/sheet/copy';
import { changeSummary, type LineChange } from '../../lib/exams/cheatSheet';
import { inkAt, keepsNoteRow, statesAt, type InkLine } from '../film/ink';
import { HERO_SHEET } from '../home/HeroSheet';
import { AFTER_QUESTION } from '../authReel/StoryScenes';
import { SHEET_WORDS, TICKET, TICKET_LINES } from './content';
import { DAYS_CAPTION, DAYS_DATES, DAYS_LINES, SECOND, THIRD } from './scenes/Days';
import { SHEET_CAPTION, SHEET_LINES, SHEET_LEAVE } from './scenes/Sheet';
import { RETURNING } from './scenes/ticketSheet';
import { SCENES, sceneWindow } from './timeline';

afterEach(() => {
  vi.useRealTimers();
});

const NEVER = 1e9;
/** The lines an answer changed between two moments, as the exam page lists them (sheetChanges). */
const changes = (lines: readonly InkLine[], from: number, to: number): LineChange[] =>
  lines
    .map((line, index) => ({ key: String(index), questionId: 'q7', from: inkAt(line, from).state, to: inkAt(line, to).state }))
    .filter((change) => change.from !== change.to);

describe('chapters 03–04: the ticket\'s cheat sheet', () => {
  it('writes one line for each point of the oral chapter\'s answer sheet', () => {
    expect(TICKET_LINES).toHaveLength(TICKET.points.length);
    expect(SHEET_LINES.map((line) => line.text)).toEqual([...TICKET_LINES]);
    expect(DAYS_LINES.map((line) => line.text)).toEqual([...TICKET_LINES]);
  });

  it('hands the same paper from chapter 03 to chapter 04: the same lines, notes and rows, in the same place', () => {
    const end = sceneWindow('sheet').to - sceneWindow('sheet').from;
    expect(SHEET_LINES.map((line) => inkAt(line, end).state)).toEqual(DAYS_LINES.map((line) => line.from));
    expect(SHEET_LINES.map((line) => inkAt(line, end).note)).toEqual(DAYS_LINES.map((line) => line.note ?? null));
    expect(SHEET_LINES.map(keepsNoteRow)).toEqual(DAYS_LINES.map(keepsNoteRow));
    // The paper stays still while both chapters are on the stage.
    const overlap = sceneWindow('days').from - sceneWindow('sheet').from;
    expect(SHEET_LEAVE).toBeLessThan(overlap);
    expect(SHEET_LINES.every((line) => (line.steps ?? []).every((step) => step.at + 900 < overlap))).toBe(true);
    expect(DAYS_DATES[0].at).toBeLessThan(0);
    // What the answer did is handed over too, and goes when the next day is written.
    expect(DAYS_CAPTION[0]).toMatchObject({ text: SHEET_CAPTION[SHEET_CAPTION.length - 1].text, until: DAYS_DATES[1].at });
    expect(DAYS_CAPTION[0].at).toBeLessThan(0);
  });

  it('after the oral chapter\'s answer: four lines rubbed half-way, the one asked about by the examiner left with the wave', () => {
    expect(statesAt(SHEET_LINES, NEVER)).toEqual(['missed', 'rubbed', 'rubbed', 'rubbed', 'rubbed']);
    expect(inkAt(SHEET_LINES[TICKET.missed], NEVER).note).toBe(SHEET_WORDS.afterQuestion);
    expect(SHEET_WORDS.afterQuestion).toBe(AFTER_QUESTION);
    expect(SHEET_CAPTION[0].text).toBe(changeSentence(changeSummary(changes(SHEET_LINES, -1, NEVER))));
  });

  it('on another day the named lines go; a few days later one more goes and an erased line not named comes back', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 10, 12));
    expect(DAYS_DATES.map((date) => date.text)).toEqual(['7 окт.', '8 окт.', '10 окт.']);
    expect(statesAt(DAYS_LINES, THIRD - 1)).toEqual(['rubbed', 'erased', 'erased', 'erased', 'erased']);
    expect(DAYS_CAPTION[1].text).toBe(changeSentence(changeSummary(changes(DAYS_LINES, -1, THIRD - 1)), '2026-10-08'));
    const end = statesAt(DAYS_LINES, NEVER);
    expect(end.filter((state) => state === 'returned')).toHaveLength(1);
    expect(end[RETURNING]).toBe('returned');
    expect(end.filter((state) => state === 'erased')).toHaveLength(TICKET_LINES.length - 1);
    expect(DAYS_CAPTION[2].text).toBe(changeSentence(changeSummary(changes(DAYS_LINES, THIRD - 1, NEVER)), '2026-10-10'));
    // Each line says what an answer did once that answer has played.
    expect(DAYS_CAPTION[1].at).toBeGreaterThan(Math.max(...DAYS_LINES.flatMap((line) => (line.steps ?? []).filter((step) => step.at < THIRD).map((step) => step.at + 900))));
    // Each answer is dated in the paper's corner before it plays.
    expect(DAYS_DATES[1].at).toBeLessThan(SECOND);
    expect(DAYS_DATES[2].at).toBeLessThan(THIRD);
  });

  it('notes the line that came back as the landing\'s own sheet does', () => {
    const hero = HERO_SHEET.flatMap((question) => question.lines).find((line) => line.after === 'returned');
    expect(inkAt(DAYS_LINES[RETURNING], NEVER).note).toBe(hero?.note);
  });

  it('ends before the reel\'s ending starts', () => {
    const days = SCENES.find((scene) => scene.id === 'days')!;
    const last = Math.max(...DAYS_LINES.flatMap((line) => (line.steps ?? []).map((step) => step.at + 1100)));
    expect(days.from + last).toBeLessThan(sceneWindow('outro').from);
    // The last line is read for at least a second before the ending opens.
    expect(sceneWindow('outro').from - (days.from + DAYS_CAPTION[2].at + 320)).toBeGreaterThanOrEqual(1000);
  });
});
