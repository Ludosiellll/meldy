import { describe, expect, it } from 'vitest';
import type { LectureFit as FitAnswer } from '../../api/exams';
import { examFit, LECTURE_FIT_UNKNOWN } from './examLectureFit';

const LIBRARY = [
  { id: 'pr9', title: 'ПР 9' },
  { id: 't1', title: 'Тема 1. Информация' },
  { id: 't2', title: 'Тема 2. Представление информации' },
  { id: 'econ', title: 'Эластичность спроса' },
];
const OWN = new Set(['pr9']);

function answer(lectures: Array<[string, number[]]>, skipped: FitAnswer['skipped'] = []): FitAnswer {
  return { questions: [], lectures: new Map(lectures), unmatched: [], skipped };
}

describe('examFit: which of the student’s other lectures the exam page names', () => {
  it('names the other lectures that fit two questions or more, most questions first', () => {
    expect(examFit(answer([['t2', [0, 1]], ['t1', [2, 3, 4]], ['econ', [7]]]), LIBRARY, OWN, 18)).toEqual({
      state: 'some',
      titles: ['Тема 1. Информация', 'Тема 2. Представление информации'],
    });
  });

  it('never names the exam’s own lecture: the mapping has just found nothing in it', () => {
    expect(examFit(answer([['pr9', [0, 1, 2]]]), LIBRARY, OWN, 18)).toEqual({ state: 'none' });
  });

  it('a lecture that fits one question by a stray word is not named, and «none» is not claimed either', () => {
    expect(examFit(answer([['econ', [5]], ['t1', []]]), LIBRARY, OWN, 18)).toBe(LECTURE_FIT_UNKNOWN);
  });

  it('a one-question exam names a lecture that fits its only question', () => {
    expect(examFit(answer([['t1', [0]]]), LIBRARY, OWN, 1)).toEqual({ state: 'some', titles: ['Тема 1. Информация'] });
  });

  it('«none» only when every other lecture was checked: old lectures past the text limit leave it unknown', () => {
    expect(examFit(answer([['t1', []], ['t2', []]]), LIBRARY, OWN, 18)).toEqual({ state: 'none' });
    expect(examFit(answer([['t1', []]], [{ id: 't2', reason: 'limit' }]), LIBRARY, OWN, 18)).toBe(LECTURE_FIT_UNKNOWN);
    expect(examFit(answer([['t1', []]], [{ id: 't2', reason: 'no_text' }]), LIBRARY, OWN, 18)).toEqual({ state: 'none' });
  });

  it('a lecture the library does not list (deleted meanwhile) is not named', () => {
    expect(examFit(answer([['gone', [0, 1, 2]]]), LIBRARY, OWN, 18)).toBe(LECTURE_FIT_UNKNOWN);
  });
});
