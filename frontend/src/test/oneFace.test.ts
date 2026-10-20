import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import viteConfigSource from '../../vite.config.ts?raw';
import readme from '../../../README.md?raw';
import readmeHf from '../../../README_HF.md?raw';
import ogImage from '../../public/og-image-4.jpg?inline';
import icon192 from '../../public/pwa-192x192.png?inline';
import icon512 from '../../public/pwa-512x512.png?inline';
import iconMaskable from '../../public/pwa-maskable-512x512.png?inline';
import appleTouchIcon from '../../public/apple-touch-icon.png?inline';
import { HEADLINE, LEAD, SAMPLE_TEST_URL, SITE_TITLE_V3 } from '../pages/Landing';
import { SITE_TITLE } from '../lib/useDocumentTitle';

/**
 * One face on every entry: the page title, the link preview, the manifest and the README say what
 * the landing says (notes: 10_Project/CodingFest_11_Improvement_Plan_2026-10-07, «Одно лицо на всех входах»).
 */
const TITLE = 'Meldy — подготовка к экзамену и конструктор тестов';
const SITE = 'https://ludosiel-studyforge.hf.space/';
/** Older faces: the 2026-10 «тренажёр» and its promise, and the tagline before it. */
const OLD = /Конспекты, карточки и тесты|помощник для учёбы|засчит|тренажёр экзамена|ИИ не отвечает/i;

/** The public PNGs, inlined by Vite as data: URLs (their bytes, base64). */
const PNG: Record<string, string> = {
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

/** The link preview's bytes (a JPEG: the Space refuses a pushed binary file over 100 KB, see scripts/og/render.mjs). */
function ogBytes(): Uint8Array {
  expect(ogImage).toMatch(/^data:image\/jpeg;base64,/);
  return Uint8Array.from(atob(ogImage.slice(ogImage.indexOf(',') + 1)), (char) => char.charCodeAt(0));
}

/** Width and height from a JPEG's first start-of-frame marker (SOF0–SOF15 except DHT, JPG, DAC). */
function jpegSize(bytes: Uint8Array): [number, number] {
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) throw new Error(`no marker at ${at}`);
    const marker = bytes[at + 1];
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [(bytes[at + 7] << 8) | bytes[at + 8], (bytes[at + 5] << 8) | bytes[at + 6]];
    }
    at += 2 + length;
  }
  throw new Error('no start-of-frame marker');
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
  it('names the page as the landing does and describes it the same way for search and link previews', () => {
    expect(indexHtml).toContain(`<title>${TITLE}</title>`);
    expect(TITLE).toBe(SITE_TITLE_V3);
    expect(SITE_TITLE).toBe(TITLE);
    const description = meta('name', 'description');
    for (const words of ['конспект', 'вопросы кафедры', 'Свой тест']) expect(description).toContain(words);
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
    expect(meta('property', 'og:image')).toBe(`${SITE}og-image-4.jpg`);
    expect(meta('property', 'og:image:type')).toBe('image/jpeg');
    expect(meta('property', 'og:image:width')).toBe('1200');
    expect(meta('property', 'og:image:height')).toBe('630');
    expect(meta('property', 'og:image:alt')).toContain(HEADLINE);
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
    expect(jpegSize(ogBytes())).toEqual([1200, 630]);
    // Under the Space's 100 KB limit for binary files pushed without Xet (release 29 was refused at 143 KB).
    expect(ogBytes().length).toBeLessThan(100 * 1024);
  });

  it('links the SVG and PNG icons and the apple-touch-icon, and says the same without JavaScript', () => {
    expect(indexHtml).toContain('<link rel="icon" href="/pwa-192x192.svg" type="image/svg+xml" />');
    expect(indexHtml).toContain('<link rel="icon" href="/pwa-192x192.png" sizes="192x192" type="image/png" />');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />');
    expect(pngSize('apple-touch-icon.png')).toEqual([180, 180]);
    expect(indexHtml).toMatch(new RegExp(`<noscript>[\\s\\S]*${TITLE}[\\s\\S]*</noscript>`));
  });
});

describe('the PWA manifest (vite.config.ts)', () => {
  it('says the landing\'s title and lead and lists the PNG icons first, the maskable one among them', () => {
    expect(viteConfigSource).toContain(`name: '${TITLE}'`);
    expect(viteConfigSource).toContain("short_name: 'Meldy'");
    expect(viteConfigSource).toContain(`description: '${LEAD}'`);
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

  it('describe Meldy as the landing does, without the old faces', () => {
    expect(readme).toContain(`# ${TITLE}`);
    expect(readme).toContain('Отметку ставит преподаватель.');
    expect(readme).toContain(`${SITE}try`);
    expect(readme).toContain(`${SITE}${SAMPLE_TEST_URL.slice(1)}`);
    expect(readme).not.toMatch(OLD);
  });
});
