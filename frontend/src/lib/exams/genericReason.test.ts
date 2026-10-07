import { describe, expect, it } from 'vitest';
import { isGenericReason } from './genericReason';

// The same sentences as backend tests/test_exams_map.py (GENERIC_REASONS, CONTENT_REASONS): the two lists agree.
const GENERIC = [
  'Вопрос полностью раскрыт в приложенных фрагментах.',
  'Вопрос полностью раскрыт в материалах.',
  'Вопрос полностью освещен во фрагментах.',
  'Вопрос полностью освещён во фрагментах',
  'Материалы содержат исчерпывающий ответ на вопрос.',
  'Ответ есть во фрагментах',
  'Фрагменты содержат ответ.',
  'ОТВЕТ ЕСТЬ ВО ФРАГМЕНТАХ ЛЕКЦИЙ',
  'Во фрагментах лекций есть часть ответа',
  'Тема раскрыта полностью.',
  'Во фрагменте 14 есть полный ответ на вопрос.',
];
const CONTENT = [
  'Понятие транзакции, операторы и свойства ACID полностью описаны в тексте.',
  'Аномалии параллельного выполнения и уровни изоляции подробно рассмотрены во фрагментах.',
  'Определения первой и второй нормальных форм даны, но во фрагментах нет разбора примера для 2НФ.',
  'Есть определение',
  'Ответственность сторон раскрыта полностью.',
  'Температура описана подробно.',
  'Освещённость описана подробно.',
];

describe('isGenericReason: a reason that says nothing about the content', () => {
  it.each(GENERIC)('«%s» is a general verdict', (reason) => {
    expect(isGenericReason(reason)).toBe(true);
  });

  it.each(CONTENT)('«%s» names what is there', (reason) => {
    expect(isGenericReason(reason)).toBe(false);
  });

  it('is false for nothing at all', () => {
    expect(isGenericReason('')).toBe(false);
    expect(isGenericReason('   ')).toBe(false);
    expect(isGenericReason(null)).toBe(false);
    expect(isGenericReason(undefined)).toBe(false);
  });
});
