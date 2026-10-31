import { describe, expect, it } from 'vitest';
import { answered, answerFields, fromSaved, gradeAnswer, isKindAnswer, quizInput } from './answer';

describe('answers of every kind', () => {
  it('knows when a question is answered', () => {
    expect(answered(null)).toBe(false);
    expect(answered('  ')).toBe(false);
    expect(answered('5')).toBe(true);
    expect(answered([])).toBe(false);
    expect(answered([2])).toBe(true);
    expect(answered([-1, -1])).toBe(false);
    expect(answered([-1, 0])).toBe(true);
    expect(answered(['', ' '])).toBe(false);
    expect(answered(['', 'Москва'])).toBe(true);
  });
  it('sends each kind as the server takes it', () => {
    expect(answerFields('single', [2])).toEqual({ chosen: 2 });
    expect(answerFields('multiple', [2, 0])).toEqual({ chosen: [0, 2] });
    expect(answerFields('order', [2, 0, 1])).toEqual({ chosen: [2, 0, 1] });
    expect(answerFields('match', [1, -1])).toEqual({ chosen: [1, -1] });
    expect(answerFields('match', [-1, -1])).toEqual({ chosen: null });
    expect(answerFields('number', ' 9,8 ')).toEqual({ text: '9,8' });
    expect(answerFields('cloze', ['Москва ', ''])).toEqual({ texts: ['Москва', ''] });
    expect(answerFields('cloze', null)).toEqual({ texts: null });
    expect(answerFields('short', null)).toEqual({ text: null });
  });
  it('keeps order and match unsorted for the quiz, and empties take the answer back', () => {
    expect(quizInput('i', 'order', [3, 1, 0, 2])).toEqual({ item_id: 'i', chosen: [3, 1, 0, 2] });
    expect(quizInput('i', 'match', [-1, -1])).toEqual({ item_id: 'i', chosen: [] });
    expect(quizInput('i', 'multiple', [2, 0])).toEqual({ item_id: 'i', chosen: [0, 2] });
    expect(quizInput('i', 'cloze', ['', ''])).toEqual({ item_id: 'i', texts: null });
    expect(quizInput('i', 'essay', ' Ответ ')).toEqual({ item_id: 'i', text: 'Ответ' });
  });
  it('reads a saved answer back', () => {
    expect(fromSaved('cloze', { chosen: null, text: null, texts: ['a', ''] })).toEqual(['a', '']);
    expect(fromSaved('order', { chosen: [1, 0], text: null })).toEqual([1, 0]);
    expect(fromSaved('number', { chosen: null, text: '5' })).toBe('5');
    expect(isKindAnswer([-1, 2])).toBe(true);
    expect(isKindAnswer(['a', 'b'])).toBe(true);
    expect(isKindAnswer([1, 'a'])).toBe(false);
  });
  it('grades on the device', () => {
    const order = { kind: 'order' as const, options: ['a', 'b', 'c'], correct: [0, 1, 2], answers: [] };
    expect(gradeAnswer(order, [0, 1, 2]).correct).toBe(true);
    expect(gradeAnswer({ ...order, partial: true }, [1, 0, 2]).credit).toBeCloseTo(0.6667, 4);
    expect(gradeAnswer(order, null).result).toBe('dont_know');
  });
});
