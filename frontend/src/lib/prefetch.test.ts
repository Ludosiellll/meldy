import { describe, expect, it, vi } from 'vitest';
import prefetchSource from './prefetch.ts?raw';
import appSource from '../App.tsx?raw';

/** Which page files a signed-in first screen fetches together with the shell (App.tsx PrivateRoute). */
const { loaded, page } = vi.hoisted(() => {
  const loaded = new Set<string>();
  const page = (name: string) => () => {
    loaded.add(name);
    return { default: () => null };
  };
  return { loaded, page };
});

vi.mock('../components/Layout', () => ({ default: () => null }));
vi.mock('../contexts/ConfirmContext', () => ({ confirmDialogPart: { load: () => Promise.resolve(null) } }));
vi.mock('../components/pro/ProWindow', () => ({ proWindowPart: { load: () => Promise.resolve(null) } }));
vi.mock('../components/guide/clipPart', () => ({
  guideClipPart: { load: () => Promise.resolve(null) },
  guideSeenHere: () => true,
  isNewAccount: () => false,
}));
vi.mock('./supabaseClient', () => ({
  loadSupabase: () => Promise.resolve({}),
  signInInAddress: () => false,
  storedAccountCreatedAt: () => null,
}));
vi.mock('../pages/container/ImportPage', page('ImportPage'));
vi.mock('../pages/container/StudyPage', page('StudyPage'));
vi.mock('../pages/ExamDetail', page('ExamDetail'));
vi.mock('../pages/ExamEditor', page('ExamEditor'));

import { preloadSignedInScreen, screenOfLink, signedInPageOf } from './prefetch';

describe('the page fetched with the shell', () => {
  it('the exam container’s pages come before the oral exam’s /exams/:id', () => {
    expect(signedInPageOf('/exams/import')).toBe('ImportPage');
    expect(signedInPageOf('/exams/import/')).toBe('ImportPage');
    expect(signedInPageOf('/exams/c/abc')).toBe('ContainerPage');
    expect(signedInPageOf('/exams/c/abc/')).toBe('ContainerPage');
    expect(signedInPageOf('/exams/c/abc/s/sub-1')).toBe('SubjectPage');
    expect(signedInPageOf('/exams/c/abc/study')).toBe('StudyPage');
    expect(signedInPageOf('/exams/c/abc/mock')).toBe('MockPage');
    expect(signedInPageOf('/exams/c/abc/keys')).toBe('KeysPage');
    expect(signedInPageOf('/exams/c/abc/settings')).toBe('SettingsPage');
    // «Студия теста» (release 47.2) beside the constructor it replaces in the menu.
    expect(signedInPageOf('/exams/c/abc/build')).toBe('BuildPage');
    expect(signedInPageOf('/exams/c/abc/studio')).toBe('StudioPage');
  });

  it('/exams/new is a redirect to the import page: no editor', () => {
    expect(signedInPageOf('/exams/new')).toBe('ImportPage');
    expect(signedInPageOf('/exams/abc/edit')).toBe('ExamEditor');
  });

  it('the oral exam’s pages and the sections stay as they were', () => {
    expect(signedInPageOf('/exams/abc')).toBe('ExamDetail');
    expect(signedInPageOf('/exams/abc/draw')).toBe('ExamDraw');
    expect(signedInPageOf('/exams/abc/report')).toBe('ExamReport');
    expect(signedInPageOf('/dashboard')).toBe('Dashboard');
    expect(signedInPageOf('/exams')).toBe('Exams');
    expect(signedInPageOf('/library/abc/talk')).toBe('LectureTalk');
    expect(signedInPageOf('/exams/abc/ticket')).toBeNull();
    expect(signedInPageOf('/profile')).toBeNull();
    expect(signedInPageOf('/g/abcdefghjkmn')).toBeNull();
  });

  it('names the same files as the routes of App.tsx', () => {
    const files = [...prefetchSource.matchAll(/import\('\.\.\/pages\/([^']+)'\)/g)].map((match) => match[1]);
    expect(files).toEqual(expect.arrayContaining(['container/ImportPage', 'container/ContainerPage', 'container/StudyPage', 'ExamDetail']));
    for (const file of files) expect(appSource, file).toContain(`import('./pages/${file}')`);
  });

  it('/exams/import fetches the import page, never the oral exam page; /exams/new not the editor', async () => {
    preloadSignedInScreen('/exams/import');
    await vi.waitFor(() => expect(loaded.has('ImportPage')).toBe(true));
    preloadSignedInScreen('/exams/new');
    preloadSignedInScreen('/exams/c/abc/study');
    await vi.waitFor(() => expect(loaded.has('StudyPage')).toBe(true));
    expect(loaded.has('ExamDetail')).toBe(false);
    expect(loaded.has('ExamEditor')).toBe(false);
  });
});

describe('the landing fetches a screen when the visitor reaches for its link', () => {
  it('knows the screens its links open, a public test by its /k/ address', () => {
    expect(screenOfLink('/try')).toBe('/try');
    expect(screenOfLink('/login')).toBe('/login');
    expect(screenOfLink('/register?next=%2Fdashboard')).toBe('/register');
    expect(screenOfLink('/k/kb0dxmwb21fb')).toBe('/k');
    expect(screenOfLink('/#builder')).toBeNull();
    expect(screenOfLink('/dashboard')).toBeNull();
  });

  it('fetches nothing at idle on the landing: the reel and the studio keep the phone to themselves', () => {
    // likelyNext('/') is empty, so prefetchLikelyNext returns at once there (the screens come with prefetchLink).
    expect(prefetchSource).toMatch(/if \(pathname === '\/'\) return \[\];/);
  });
});
