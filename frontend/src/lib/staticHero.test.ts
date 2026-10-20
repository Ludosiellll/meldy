import { afterEach, describe, expect, it } from 'vitest';
import mainSource from '../main.tsx?raw';
import { dropStaticHero } from './staticHero';

/** index.html's body as the browser has it before the app's script: the static first screen and #root. */
function page(hidden: boolean) {
  document.body.innerHTML = '<div id="static-hero" class="h3"><main><h1>Готовьтесь к экзамену</h1></main></div><div id="root"></div>';
  document.documentElement.classList.toggle('sh-off', hidden);
}

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.classList.remove('sh-off');
  window.history.replaceState(null, '', '/');
});

describe('the landing’s static first screen', () => {
  it('leaves the page when it is not shown (another address, a signed-in visitor): one <main>, one <h1>', () => {
    window.history.replaceState(null, '', '/dashboard');
    page(true);
    dropStaticHero();
    expect(document.getElementById('static-hero')).toBeNull();
    expect(document.getElementById('root')).not.toBeNull();
  });

  it('stays for a guest on «/» until the landing takes its place', () => {
    page(false);
    dropStaticHero();
    expect(document.getElementById('static-hero')).not.toBeNull();
    expect(document.documentElement.classList.contains('sh-off')).toBe(false);
  });

  it('goes before the app renders (main.tsx)', () => {
    const at = mainSource.indexOf('dropStaticHero()');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(mainSource.indexOf('createRoot('));
  });

  it('off «/» it goes even when theme-init.js did not run, and the app is no longer hidden', () => {
    window.history.replaceState(null, '', '/login');
    page(false);
    dropStaticHero();
    expect(document.getElementById('static-hero')).toBeNull();
    expect(document.documentElement.classList.contains('sh-off')).toBe(true);
  });
});
