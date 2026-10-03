import { describe, expect, it } from 'vitest';
import { DEMO_SETTINGS, DEMO_TEXT, DEMO_TEXT_ID, DEMO_TITLE, isDemoText } from './index';
import { DEFAULT_SETTINGS } from '../../types';

/** Разбивка как у backend build_source_chunks: абзацы по пустой строке. */
const paragraphs = DEMO_TEXT.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);

describe('demo lecture text', () => {
  it('has no bare-heading fragment: every blank-line paragraph is at least 60 characters', () => {
    expect(paragraphs.length).toBeGreaterThan(10);
    const short = paragraphs.filter(paragraph => paragraph.length < 60);
    expect(short).toEqual([]);
  });

  it('has headings directly above their paragraphs', () => {
    expect(paragraphs[0].split('\n')[0]).toBe(DEMO_TITLE);
    expect(paragraphs.some(paragraph => paragraph.startsWith('Функции активации\nФункция активации'))).toBe(true);
  });

  it('has the typo fixed and no slang or unsupported claims', () => {
    expect(DEMO_TEXT).not.toContain('предпочтая');
    expect(DEMO_TEXT).toContain('предпочитая');
    expect(DEMO_TEXT).not.toMatch(/ванильн/i);
    expect(DEMO_TEXT).not.toMatch(/сверхчеловеческ/i);
  });

  it('exports the id, title and default settings', () => {
    expect(DEMO_TEXT_ID).toBe('demo-v1');
    expect(DEMO_SETTINGS).toBe(DEFAULT_SETTINGS);
    expect(DEMO_TEXT).toBe(DEMO_TEXT.trim());
  });

  it('recognises the demo text regardless of surrounding whitespace only', () => {
    expect(isDemoText(`\n  ${DEMO_TEXT}\n\n`)).toBe(true);
    expect(isDemoText(`${DEMO_TEXT}!`)).toBe(false);
    expect(isDemoText('')).toBe(false);
    expect(isDemoText(undefined)).toBe(false);
  });
});
