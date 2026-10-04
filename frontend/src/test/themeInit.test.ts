import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import themeInitSource from '../../public/theme-init.js?raw';
import indexHtml from '../../index.html?raw';
import offlineHtml from '../../public/offline.html?raw';
import viteConfigSource from '../../vite.config.ts?raw';

let osDark = false;
let matchMediaThrows = false;

function stubMatchMedia(present = true) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: present
      ? (query: string) => {
          if (matchMediaThrows) throw new Error('no media queries');
          return { matches: query.includes('dark') ? osDark : false, media: query };
        }
      : undefined,
  });
}

function addThemeColorMetas() {
  document.head.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.remove());
  for (const [media, color] of [
    ['(prefers-color-scheme: light)', '#f3f3f0'],
    ['(prefers-color-scheme: dark)', '#0b0f16'],
  ]) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.media = media;
    meta.content = color;
    document.head.appendChild(meta);
  }
}

const runThemeInit = () => new Function(themeInitSource)();
const html = () => document.documentElement.classList;
const metaColors = () => Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(meta => meta.getAttribute('content'));

beforeEach(() => {
  osDark = false;
  matchMediaThrows = false;
  stubMatchMedia();
  addThemeColorMetas();
  document.documentElement.className = '';
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('public/theme-init.js', () => {
  it('stored dark → html.dark and dark browser bar', () => {
    window.localStorage.setItem('studyforge-theme', 'dark');
    runThemeInit();
    expect(html().contains('dark')).toBe(true);
    expect(html().contains('light')).toBe(false);
    expect(metaColors()).toEqual(['#0b0f16', '#0b0f16']);
  });

  it('stored light wins over a dark OS', () => {
    osDark = true;
    window.localStorage.setItem('studyforge-theme', 'light');
    runThemeInit();
    expect(html().contains('light')).toBe(true);
    expect(html().contains('dark')).toBe(false);
    expect(metaColors()).toEqual(['#f3f3f0', '#f3f3f0']);
  });

  it('no stored choice → the OS preference', () => {
    osDark = true;
    runThemeInit();
    expect(html().contains('dark')).toBe(true);
    window.localStorage.setItem('studyforge-theme', 'system');
    osDark = false;
    runThemeInit();
    expect(html().contains('light')).toBe(true);
    expect(html().contains('dark')).toBe(false);
  });

  it('a throwing getItem raises nothing and falls back to the OS', () => {
    osDark = true;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(runThemeInit).not.toThrow();
    expect(html().contains('dark')).toBe(true);
  });

  it('never writes to storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    osDark = true;
    runThemeInit();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('works without matchMedia or with a throwing one', () => {
    stubMatchMedia(false);
    expect(runThemeInit).not.toThrow();
    expect(html().contains('light')).toBe(true);
    stubMatchMedia(true);
    matchMediaThrows = true;
    document.documentElement.className = 'dark';
    expect(runThemeInit).not.toThrow();
    expect(html().contains('light')).toBe(true);
    expect(html().contains('dark')).toBe(false);
  });

  it('does not set an inline color-scheme', () => {
    window.localStorage.setItem('studyforge-theme', 'dark');
    runThemeInit();
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(themeInitSource).not.toMatch(/\.style\b|colorScheme/);
  });
});

describe('index.html, offline.html and the manifest', () => {
  it('loads theme-init.js from a file right after two media-scoped theme-color metas', () => {
    const light = indexHtml.indexOf('<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f3f3f0" />');
    const dark = indexHtml.indexOf('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0f16" />');
    const script = indexHtml.indexOf('<script src="/theme-init.js"></script>');
    expect(light).toBeGreaterThan(-1);
    expect(dark).toBeGreaterThan(light);
    expect(script).toBeGreaterThan(dark);
    expect(script).toBeLessThan(indexHtml.indexOf('</head>'));
    expect(indexHtml).not.toContain('#0868b2');
    // CSP (nginx.conf: script-src 'self') запрещает встроенные скрипты.
    const inlineScripts = indexHtml.match(/<script(?![^>]*\ssrc=)[^>]*>/g) ?? [];
    expect(inlineScripts).toEqual([]);
  });

  it('uses the canvas colour for the offline page and the PWA manifest', () => {
    expect(offlineHtml).toContain('<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f3f3f0">');
    expect(offlineHtml).not.toContain('#0868b2"');
    expect(viteConfigSource).toContain("theme_color: '#f3f3f0'");
    expect(viteConfigSource).toContain("background_color: '#f3f3f0'");
  });
});
