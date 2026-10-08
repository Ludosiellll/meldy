import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SITE_TITLE, pageTitle, useDocumentTitle } from './useDocumentTitle';

afterEach(() => {
  cleanup();
  document.title = SITE_TITLE;
});

describe('pageTitle', () => {
  it('puts the page name before the product', () => {
    expect(pageTitle('Вход')).toBe('Вход — Meldy');
    expect(pageTitle('  Пример   экзамена ')).toBe('Пример экзамена — Meldy');
  });

  it('keeps the site title for an empty name', () => {
    expect(pageTitle('')).toBe(SITE_TITLE);
    expect(pageTitle(null)).toBe(SITE_TITLE);
    expect(pageTitle(undefined)).toBe(SITE_TITLE);
  });
});

describe('useDocumentTitle', () => {
  it('names the tab while the page is open and gives the old title back on leaving', () => {
    document.title = SITE_TITLE;
    const { rerender, unmount } = renderHook(({ name }) => useDocumentTitle(name), { initialProps: { name: 'Вход' } });
    expect(document.title).toBe('Вход — Meldy');
    rerender({ name: 'Регистрация' });
    expect(document.title).toBe('Регистрация — Meldy');
    unmount();
    expect(document.title).toBe(SITE_TITLE);
  });
});
