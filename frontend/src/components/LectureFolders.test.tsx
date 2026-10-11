import { describe, expect, it } from 'vitest';
import { deleteLectureConfirm } from './LectureFolders';

describe('deleteLectureConfirm (QA 2026-10-11: «карточками и тестом» was said of every lecture)', () => {
  const message = (has: Parameters<typeof deleteLectureConfirm>[1]) => deleteLectureConfirm('Клетка', has).message;

  it('names only what the lecture has, in the order of its tabs', () => {
    expect(message({ summary: true })).toBe('«Клетка» исчезнет из библиотеки вместе с конспектом. Это нельзя отменить.');
    expect(message({ summary: true, quiz: true })).toBe('«Клетка» исчезнет из библиотеки вместе с конспектом и тестом. Это нельзя отменить.');
    expect(message({ summary: true, cards: true, quiz: true, cheatsheet: true, podcast: true })).toBe(
      '«Клетка» исчезнет из библиотеки вместе с конспектом, карточками, тестом, выжимкой и подкастом. Это нельзя отменить.',
    );
  });

  it('says only that the lecture goes when it has nothing else (a lecture kept as text)', () => {
    expect(message({})).toBe('«Клетка» исчезнет из библиотеки. Это нельзя отменить.');
    expect(deleteLectureConfirm('Клетка')).toEqual({
      title: 'Удалить лекцию?',
      message: '«Клетка» исчезнет из библиотеки. Это нельзя отменить.',
      confirmText: 'Удалить',
      cancelText: 'Оставить',
    });
  });
});
