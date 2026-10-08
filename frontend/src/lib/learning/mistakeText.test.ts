import { describe, expect, it } from 'vitest';
import { groupMistakes, mistakeDay, nestQuotes, notNamed, quoted, splitOralAnswer } from './mistakeText';

describe('the stored answer of a ticket’s point', () => {
  it('splits into the point, the lecture and the lecture’s words', () => {
    expect(
      splitOralAnswer('Схема отношения — конечный набор пар имя атрибута и домен. «Реляционная модель данных: ключи и связи», фрагмент 4: «Схема отношения (заголовок отношения) — конечный набор пар «имя атрибута : домен»»'),
    ).toEqual({
      point: 'Схема отношения — конечный набор пар имя атрибута и домен',
      source: '«Реляционная модель данных: ключи и связи», фрагмент 4',
      quote: 'Схема отношения (заголовок отношения) — конечный набор пар «имя атрибута : домен»',
    });
    expect(splitOralAnswer('Канал кредита. Лекция: «ставка влияет на кредиты»')).toEqual({ point: 'Канал кредита', source: 'Лекция', quote: 'ставка влияет на кредиты' });
    expect(splitOralAnswer('Два канала. «Деньги», фрагменты 13, 14: «через ставку и через кредит»').source).toBe('«Деньги», фрагменты 13, 14');
  });

  it('keeps a point without a quote whole, and an answer of another shape as it is', () => {
    expect(splitOralAnswer('Канал кредита')).toEqual({ point: 'Канал кредита', source: null, quote: null });
    expect(splitOralAnswer('Беспорядок системы — мера беспорядка')).toEqual({ point: 'Беспорядок системы — мера беспорядка', source: null, quote: null });
    expect(splitOralAnswer(null)).toEqual({ point: '', source: null, quote: null });
  });

  it('reads a quote that lost its closing mark', () => {
    const parts = splitOralAnswer('Схема отношения. «Модель», фрагмент 4: «конечный набор пар «имя атрибута : домен»');
    expect(parts.quote).toBe('конечный набор пар «имя атрибута : домен');
    expect(quoted(parts.quote!)).toBe('«конечный набор пар „имя атрибута : домен“»');
  });
});

describe('quotes inside quotes', () => {
  it('turns an inner «…» into „…“, closes a pair left open and drops a stray closing mark', () => {
    expect(nestQuotes('пар «имя атрибута : домен»')).toBe('пар „имя атрибута : домен“');
    expect(nestQuotes('пар «имя атрибута')).toBe('пар „имя атрибута“');
    expect(nestQuotes('конец» текста')).toBe('конец текста');
    expect(nestQuotes('без кавычек')).toBe('без кавычек');
    expect(quoted('Транзакция — «единое целое»')).toBe('«Транзакция — „единое целое“»');
  });
});

describe('the diary’s rows', () => {
  const row = (id: string, question: string, origin: string | null, created_at = '2026-10-07T10:00:00Z') => ({ id, question, origin, created_at });

  it('gathers the missed points of one ticket question under it, at the place of its newest mistake', () => {
    const entries = groupMistakes([
      row('a', 'Подзапросы. Предикаты IN и EXISTS.', 'oral_ticket'),
      row('q', 'Что измеряет энтропия?', 'quiz'),
      row('b', 'Ключи отношения.', 'oral_ticket'),
      row('c', 'Подзапросы.  Предикаты IN и EXISTS. ', 'oral_ticket'),
      row('d', 'Подзапросы. Предикаты IN и EXISTS.', 'oral_ticket'),
      row('p', 'Функции денег', 'professor'),
      row('q2', 'Что измеряет энтропия?', 'quiz'),
    ]);
    expect(entries.map((entry) => (entry.kind === 'ticket' ? `${entry.question}: ${entry.items.map((item) => item.id).join(',')}` : entry.item.id))).toEqual([
      'Подзапросы. Предикаты IN и EXISTS.: a,c,d',
      'q',
      'Ключи отношения.: b',
      'p',
      'q2',
    ]);
  });

  it('says that a point was not named, and dates as the other pages do', () => {
    expect(notNamed('(не названо)')).toBe(true);
    expect(notNamed('')).toBe(true);
    expect(notNamed('ставка растёт')).toBe(false);
    const now = new Date(2026, 9, 8, 12);
    expect(mistakeDay('2026-10-07T09:00:00Z', now)).toBe('7 окт.');
    expect(mistakeDay('2025-12-30T09:00:00Z', now)).toBe('30 дек. 2025');
    expect(mistakeDay('garbage', now)).toBe('');
  });
});
