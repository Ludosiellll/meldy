import { describe, expect, it } from 'vitest';
import { NBSP, ty } from './typo';

const show = (s: string) => s.replace(new RegExp(NBSP, 'g'), '·');

describe('ty', () => {
  it('keeps one- and two-letter words with the next word', () => {
    expect(show(ty('Карточки с интервальным повторением'))).toBe('Карточки с·интервальным повторением');
    expect(show(ty('а сверка с текстом'))).toBe('а·сверка с·текстом');
    expect(show(ty('вспомнить главное и свериться'))).toBe('вспомнить главное и·свериться');
    expect(show(ty('И не только'))).toBe('И·не·только');
  });

  it('handles chains of short words and words after quotes and brackets', () => {
    expect(show(ty('и в лесу'))).toBe('и·в·лесу');
    expect(show(ty('«а не так» (и в нём)'))).toBe('«а·не·так» (и·в·нём)');
  });

  it('never starts a line with a dash', () => {
    expect(show(ty('узнать и вспомнить — разные вещи'))).toBe('узнать и·вспомнить·— разные вещи');
  });

  it('leaves longer words, latin and hyphenated words alone and is idempotent', () => {
    const text = 'PDF, DOCX или MD из-за формата';
    expect(show(ty(text))).toBe('PDF, DOCX или MD из-за формата');
    const once = ty('Запомнить лекцию, а не перечитывать её в пятый раз');
    expect(ty(once)).toBe(once);
    expect(show(once)).toBe('Запомнить лекцию, а·не·перечитывать её·в·пятый раз');
  });
});
