import { describe, expect, it } from 'vitest';

/**
 * What the first screen of /try carries. The jury opened it from phones in a hall (QA, 2026-10-11): on Slow 4G the sheet
 * took 12.3 s to become usable, and it brought along the Supabase client (56 KB gzip) through the sheet's journal module
 * (api/learning) and the whole answer room (the protocol, speech recognition, the AI check) which the sheet does not
 * show. The modules reached from pages/TryExample.tsx by static imports are what its chunk and the chunks it imports
 * bring before the sheet shows; an import() is a file of its own, fetched later (components/example/tryParts,
 * lib/supabaseClient). Vitest has no bundle, so the sources are read from disk and their static imports followed.
 */
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
}
// A specifier TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const nodeFs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
// src/, as a path from this file's own (jsdom's URL is not the one Node's fs takes).
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const SRC = HERE.slice(0, HERE.lastIndexOf('/src/') + '/src/'.length);

/**
 * A static import or re-export at the start of a line (the code style here), named or bare, over several lines too.
 * `import type` / `export type` are left out: they are gone from the build. An inline `{ type X }` is kept (an over-count
 * at worst, never a miss).
 */
const STATIC_IMPORT = /^(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

interface Graph {
  /** Every module of src/ reached, by its path from src/. */
  modules: Set<string>;
  /** Packages imported for their values by the modules reached, with one importer each. */
  packages: Map<string, string>;
}

async function staticClosure(start: string): Promise<Graph> {
  const fs = await nodeFs();
  const modules = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (modules.has(file)) continue;
    modules.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    const code = fs.readFileSync(SRC + file, 'utf8');
    for (const match of code.matchAll(STATIC_IMPORT)) {
      if (match[1]) continue;
      const specifier = match[2].replace(/\?.*$/, '');
      if (!specifier.startsWith('.')) {
        if (!packages.has(specifier)) packages.set(specifier, file);
        continue;
      }
      const base = new URL(specifier, `file:///${file}`).pathname.slice(1);
      const found = EXTENSIONS.map((extension) => base + extension).find((path) => /\.[a-z]+$/.test(path) && fs.existsSync(SRC + path));
      if (!found) throw new Error(`${file}: cannot resolve ${specifier}`);
      queue.push(found);
    }
  }
  return { modules, packages };
}

describe('the first screen of /try (jury QA, 2026-10-11: Slow 4G)', () => {
  it('does not carry the Supabase client: the sheet never touches an account', async () => {
    const graph = await staticClosure('pages/TryExample.tsx');
    expect(graph.modules.has('components/example/ExampleSheet.tsx')).toBe(true);
    expect(graph.modules.has('components/exams/sheet/CheatSheet.tsx')).toBe(true);
    expect(graph.modules.has('lib/supabase.ts')).toBe(false);
    expect(graph.packages.get('@supabase/supabase-js') ?? null).toBeNull();
  });

  it('does not carry the draw or the answer room: they come with their own files, after the sheet', async () => {
    const graph = await staticClosure('pages/TryExample.tsx');
    const room = ['components/example/ExampleTicket.tsx', 'components/example/ExampleDraw.tsx', 'hooks/useSpeechAnswer.ts', 'components/oral/OralProtocol.tsx'];
    expect(room.filter((module) => graph.modules.has(module))).toEqual([]);
  });

  it('the check sees what it looks for: a screen with an account reaches the client, the room reaches its parts', async () => {
    const detail = await staticClosure('pages/ExamDetail.tsx');
    expect(detail.modules.has('lib/supabase.ts')).toBe(true);
    expect(detail.packages.has('@supabase/supabase-js')).toBe(true);
    const ticket = await staticClosure('components/example/ExampleTicket.tsx');
    expect(ticket.modules.has('hooks/useSpeechAnswer.ts')).toBe(true);
    expect(ticket.modules.has('components/oral/OralProtocol.tsx')).toBe(true);
  });
});
