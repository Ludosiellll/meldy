import { describe, expect, it } from 'vitest';
import timeSource from './time.ts?raw';
import ruleSource from './rule.ts?raw';
import planSource from './plan.ts?raw';
import sessionSource from './session.ts?raw';
import wordsSource from './words.ts?raw';
import groupSource from './group.ts?raw';
import paceSource from './pace.ts?raw';

/**
 * The engine modules are copied verbatim into the Telegram bot (a Deno Edge Function): pure TS, no clock, no
 * randomness, no npm imports, explicit relative `.ts` imports, no enums / namespaces / parameter properties.
 */
const SOURCES: Record<string, string> = {
  'time.ts': timeSource, 'rule.ts': ruleSource, 'plan.ts': planSource, 'session.ts': sessionSource,
  'words.ts': wordsSource, 'group.ts': groupSource, 'pace.ts': paceSource,
};

const FORBIDDEN: Array<[string, RegExp]> = [
  ['Date.now', /Date\.now/],
  ['new Date(', /new\s+Date\s*\(/],
  ['Math.random', /Math\.random/],
  ['enum', /\benum\s/],
  ['namespace', /\bnamespace\s/],
  ['a parameter property', /constructor\s*\([^)]*\b(public|private|protected|readonly)\s/],
  ['the device clock or zone', /\b(performance\.now|getTimezoneOffset|toLocale\w*String|resolvedOptions)\b/],
  ['the browser', /\b(window|document|localStorage|sessionStorage|navigator|indexedDB|fetch)\b\s*[.(]/],
];

describe('engine sources stay portable', () => {
  for (const [file, source] of Object.entries(SOURCES)) {
    it(`${file}: no clock, no randomness, no enums, namespaces or parameter properties`, () => {
      expect(source.length).toBeGreaterThan(200);
      for (const [name, re] of FORBIDDEN) expect(re.test(source), `${file}: ${name}`).toBe(false);
    });

    it(`${file}: only relative .ts imports, nothing from npm`, () => {
      const specifiers = [...source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
      for (const spec of specifiers) {
        expect(spec.startsWith('./') || spec.startsWith('../'), `${file}: ${spec}`).toBe(true);
        expect(spec.endsWith('.ts'), `${file}: ${spec}`).toBe(true);
      }
      expect(/\brequire\s*\(|\bimport\s*\(/.test(source), `${file}: dynamic import`).toBe(false);
    });
  }

  it('the engine imports only itself and the shared types', () => {
    for (const [file, source] of Object.entries(SOURCES)) {
      for (const m of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        expect(/^\.\/(time|rule|plan|session|words|group|pace)\.ts$|^\.\.\/\.\.\/types\/container\.ts$/.test(m[1]), `${file}: ${m[1]}`).toBe(true);
      }
    }
  });
});
