import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import viteConfigSource from '../../vite.config.ts?raw';
import readme from '../../../README.md?raw';
import readmeHf from '../../../README_HF.md?raw';
import ogImage from '../../public/og-image.png?inline';
import icon192 from '../../public/pwa-192x192.png?inline';
import icon512 from '../../public/pwa-512x512.png?inline';
import iconMaskable from '../../public/pwa-maskable-512x512.png?inline';
import appleTouchIcon from '../../public/apple-touch-icon.png?inline';
import { EYEBROW } from '../pages/Landing';

/**
 * One face on every entry: the page title, the link preview, the manifest and the README say what
 * the landing says (notes: 10_Project/CodingFest_11_Improvement_Plan_2026-10-07, «Одно лицо на всех входах»).
 */
const TITLE = 'Meldy — тренажёр устного экзамена по билетам кафедры';
const PROMISE = 'ИИ не отвечает за студента — он его спрашивает';
const SITE = 'https://ludosiel-studyforge.hf.space/';
const OLD = /Конспекты, карточки и тесты|помощник для учёбы|засчит/i;

/** The public PNGs, inlined by Vite as data: URLs (their bytes, base64). */
const PNG: Record<string, string> = {
  'og-image.png': ogImage,
  'pwa-192x192.png': icon192,
  'pwa-512x512.png': icon512,
  'pwa-maskable-512x512.png': iconMaskable,
  'apple-touch-icon.png': appleTouchIcon,
};

function pngBytes(name: string): Uint8Array {
  const url = PNG[name];
  expect(url, name).toMatch(/^data:image\/png;base64,/);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (char) => char.charCodeAt(0));
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(name: string): [number, number] {
  const bytes = pngBytes(name);
  expect(String.fromCharCode(...bytes.subarray(1, 4))).toBe('PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

function meta(attribute: 'name' | 'property', key: string): string | null {
  const match = indexHtml.match(new RegExp(`<meta ${attribute}="${key.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`));
  return match ? match[1] : null;
}

describe('index.html', () => {
  it('names the page by the promise and describes it the same way for search and link previews', () => {
    expect(indexHtml).toContain(`<title>${TITLE}</title>`);
    expect(TITLE).toBe(`Meldy — ${EYEBROW.charAt(0).toLowerCase()}${EYEBROW.slice(1)}`);
    const description = meta('name', 'description');
    expect(description).toContain(PROMISE);
    expect(description).toContain('шпаргалки');
    expect(description!.length).toBeLessThanOrEqual(160);
    expect(meta('property', 'og:title')).toBe(TITLE);
    expect(meta('property', 'og:description')).toBe(description);
    expect(indexHtml).not.toMatch(OLD);
  });

  it('carries Open Graph and a large Twitter card with an absolute 1200 × 630 image', () => {
    expect(meta('property', 'og:type')).toBe('website');
    expect(meta('property', 'og:site_name')).toBe('Meldy');
    expect(meta('property', 'og:locale')).toBe('ru_RU');
    expect(meta('property', 'og:url')).toBe(SITE);
    expect(meta('property', 'og:image')).toBe(`${SITE}og-image.png`);
    expect(meta('property', 'og:image:type')).toBe('image/png');
    expect(meta('property', 'og:image:width')).toBe('1200');
    expect(meta('property', 'og:image:height')).toBe('630');
    expect(meta('property', 'og:image:alt')).toBeTruthy();
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
    expect(pngSize('og-image.png')).toEqual([1200, 630]);
    // A preview image that messengers fetch quickly.
    expect(pngBytes('og-image.png').length).toBeLessThan(300 * 1024);
  });

  it('links the SVG and PNG icons and the apple-touch-icon, and says the same without JavaScript', () => {
    expect(indexHtml).toContain('<link rel="icon" href="/pwa-192x192.svg" type="image/svg+xml" />');
    expect(indexHtml).toContain('<link rel="icon" href="/pwa-192x192.png" sizes="192x192" type="image/png" />');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />');
    expect(pngSize('apple-touch-icon.png')).toEqual([180, 180]);
    expect(indexHtml).toMatch(/<noscript>[\s\S]*Meldy — тренажёр устного экзамена по билетам кафедры[\s\S]*<\/noscript>/);
  });
});

describe('the PWA manifest (vite.config.ts)', () => {
  it('says the promise and lists the PNG icons first, the maskable one among them', () => {
    expect(viteConfigSource).toContain("name: 'Meldy — тренажёр устного экзамена'");
    expect(viteConfigSource).toContain("short_name: 'Meldy'");
    expect(viteConfigSource).toContain(`description: 'Тренажёр устного экзамена по билетам кафедры. ${PROMISE}.'`);
    expect(viteConfigSource).toContain("display: 'standalone'");
    expect(viteConfigSource).not.toMatch(OLD);
    const icons = [...viteConfigSource.matchAll(/src: '([^']+)',\s*sizes: '([^']+)',\s*type: '([^']+)'(?:,\s*purpose: '([^']+)')?/g)].map(([, src, sizes, type, purpose]) => ({
      src,
      sizes,
      type,
      purpose: purpose ?? null,
    }));
    expect(icons.slice(0, 3)).toEqual([
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: null },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: null },
      { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    // The service worker shows /pwa-192x192.svg on notifications: the SVGs stay.
    expect(icons.map((icon) => icon.src)).toEqual(expect.arrayContaining(['pwa-192x192.svg', 'pwa-512x512.svg']));
    for (const icon of icons.filter((item) => item.type === 'image/png')) {
      const [w, h] = pngSize(icon.src);
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });

  it('keeps start_url and scope at the plugin defaults: an installed app keeps its identity', () => {
    expect(viteConfigSource).not.toMatch(/^\s*(start_url|scope|id):/m);
  });
});

describe('README.md and README_HF.md (the Space card)', () => {
  it('are the same file and keep the Space settings', () => {
    expect(readmeHf).toBe(readme);
    const frontMatter = readme.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    expect(frontMatter).toContain('sdk: docker');
    expect(frontMatter).toContain('app_port: 7860');
    expect(frontMatter).toMatch(/^title: .{1,30}$/m);
  });

  it('describe Meldy by the promise, without the old tagline', () => {
    expect(readme).toContain(`# ${TITLE}`);
    expect(readme).toContain(`${PROMISE}.`);
    expect(readme).toContain('Отметку ставит преподаватель.');
    expect(readme).toContain(`${SITE}try`);
    expect(readme).not.toMatch(OLD);
  });
});
