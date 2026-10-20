import { describe, expect, it } from 'vitest';

/**
 * The how-to clips' stylesheet (scenes/scenes.css) is loaded with the clips and stays for the rest of the visit. Its class
 * names are short and some are the app's own: «.qz-opt» of the «Тест» scene drew the lecture's test options at 25 px with
 * a top border (live, 47.3), «.mv-note» reached the real «Перенести экзамен» dialog. Every rule therefore sits under a
 * clip's own root (`.sx-scene` — the Loop of kit.tsx, `.bx-scene` — the Telegram clip), so it cannot style the app.
 *
 * The styles are read from disk: Vitest turns every CSS import into an empty module, `?raw` included.
 */
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const nodeFs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const DIR = HERE.slice(0, HERE.lastIndexOf('/') + 1);

/** Every selector of a stylesheet without at-rules (comments left out), one entry per comma-separated selector. */
function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      if (depth === 0) {
        const head = text.slice(start, i).trim().replace(/\s+/g, ' ');
        if (!head.startsWith('@')) out.push(...head.split(',').map((part) => part.trim()));
      }
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      start = i + 1;
    }
  }
  return out;
}

const ROOTS = ['.sx-scene', '.bx-scene'];
const scoped = (selector: string) =>
  ROOTS.some((root) => selector === root || selector.startsWith(`:where(${root}) `) || selector === `.dark ${root}` || selector.startsWith(`.dark :where(${root}) `));

describe('the clips’ stylesheet', () => {
  it('styles nothing outside a clip: every selector starts at a clip’s root', async () => {
    const css = (await nodeFs()).readFileSync(`${DIR}scenes/scenes.css`, 'utf8');
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(200);
    expect(all.filter((selector) => !scoped(selector))).toEqual([]);
  });

  it('the scene roots are the elements the clips draw', async () => {
    const fs = await nodeFs();
    expect(fs.readFileSync(`${DIR}scenes/kit.tsx`, 'utf8')).toMatch(/className=\{`mr-scene sx-scene /);
    expect(fs.readFileSync(`${DIR}scenes/botExams.tsx`, 'utf8')).toMatch(/className="mr-scene bx-scene"/);
  });
});
