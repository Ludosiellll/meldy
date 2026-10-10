import { describe, expect, it } from 'vitest';

/**
 * Quiet links of the exam's screens keep a 44 px target (usability check m4). A link inside a line takes its room from
 * the line's own height — `min-height: 44px; margin: -12px 0` (as .ct-fig-sub) — so no block grows. CF2 left three at
 * `min-height: 0`: «Убрать» / «Отмена» under a member of the group, «Отмечен по-другому?» in the import's key check, and
 * «Удалить» / «Отмена» in «Ключи».
 *
 * The styles are read from disk: Vitest turns every CSS import into an empty module, `?raw` included.
 */
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { recursive: true }): string[];
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const nodeFs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
// src/, as a path from this file's own (jsdom's URL is not the one Node's fs takes, and Vite rewrites new URL(…, import.meta.url)).
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const SRC = HERE.slice(0, HERE.lastIndexOf('/src/') + '/src/'.length);

/** Every stylesheet of the exam's screens, by its path from src/. */
async function containerStyles(): Promise<Map<string, string>> {
  const fs = await nodeFs();
  const files = new Map<string, string>();
  for (const dir of ['components/containers/', 'pages/container/']) {
    for (const name of fs.readdirSync(SRC + dir, { recursive: true })) {
      if (String(name).endsWith('.css')) files.set(`${dir}${name}`, fs.readFileSync(`${SRC}${dir}${name}`, 'utf8'));
    }
  }
  files.set('pages/containerScreens.css', fs.readFileSync(`${SRC}pages/containerScreens.css`, 'utf8'));
  return files;
}

/** The rules of a stylesheet, those inside @media too: the selector and its declarations, comments left out. */
function rules(css: string): Array<{ selector: string; body: string }> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] }));
}

function declaration(body: string, property: string): string | null {
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return match ? match[1].trim() : null;
}

/** A min-height shorter than a finger: 0, or a length under 44 px. calc(), auto and the like are not judged here. */
function shortTarget(value: string): boolean {
  if (/^0(?:px)?$/.test(value)) return true;
  const px = value.match(/^(\d+(?:\.\d+)?)px$/);
  return px !== null && Number(px[1]) < 44;
}

describe('quiet links of the exam’s screens (usability m4)', () => {
  it('no link of the exam’s screens is shorter than 44 px', async () => {
    const files = await containerStyles();
    expect(files.size).toBeGreaterThan(5);
    const short: string[] = [];
    for (const [file, css] of files) {
      for (const rule of rules(css)) {
        if (!/\.sf-link\b/.test(rule.selector)) continue;
        const minHeight = declaration(rule.body, 'min-height');
        if (minHeight && shortTarget(minHeight)) short.push(`${file}: ${rule.selector} { min-height: ${minHeight} }`);
      }
    }
    expect(short).toEqual([]);
  });

  it('the three that CF2 left at 0 take their room from their line, so nothing grows', async () => {
    const files = await containerStyles();
    const rule = (file: string, selector: string) => rules(files.get(file) ?? '').find((r) => r.selector === selector)?.body ?? '';
    for (const [file, selector] of [
      ['components/containers/group/group.css', '.gr-person .gr-ask .sf-link'],
      ['components/containers/import/import.css', '.sf-page .im-spot-wrong .sf-link'],
      ['pages/container/KeysPage.css', '.sf-page.ky-page .ky-confirm .sf-link'],
    ] as const) {
      const body = rule(file, selector);
      expect(declaration(body, 'min-height'), `${file} ${selector}`).toBe('44px');
      expect(declaration(body, 'margin'), `${file} ${selector}`).toBe('-12px 0');
      expect(declaration(body, 'vertical-align'), `${file} ${selector}`).toBe('baseline');
    }
  });
});
