import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import previewJson from '../../../../contracts/container/link_preview.json';
import type { LinkPreview } from '../../types/container';

const api = vi.hoisted(() => ({
  previewLink: vi.fn(),
  joinByCode: vi.fn(),
  oralSync: vi.fn(),
  signInWithOAuth: vi.fn(),
  auth: { user: null as null | { id: string }, loading: false },
}));
vi.mock('../../api/containers', () => ({ previewLink: api.previewLink, joinByCode: api.joinByCode, oralSync: api.oralSync }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: api.auth.user, loading: api.auth.loading, requestSession: vi.fn() }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { signInWithOAuth: (...args: unknown[]) => api.signInWithOAuth(...args) } } }));

import JoinContainerPage from './JoinContainerPage';
import { GUIDE_LATER_KEY } from '../../components/guide/guideLater';
import { JOIN_PENDING_KEY } from '../../lib/returnTo';
import { JOIN } from '../../components/containers/copyImport';

const CODE = 'abcd2fghjkmn';
const ACTIVE = previewJson as unknown as LinkPreview;
const CONTAINER = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';

let where = '';
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}`;
  return null;
}

function renderAt(path = `/g/${CODE}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/g/:code" element={<JoinContainerPage />} />
        <Route path="/exams/c/:id" element={<p>Экзамен открыт</p>} />
        <Route path="*" element={<p>Другая страница</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  where = '';
  api.auth.user = null;
  api.auth.loading = false;
  api.previewLink.mockReset().mockResolvedValue(ACTIVE);
  api.joinByCode.mockReset().mockResolvedValue({ container_id: CONTAINER, joined: true, oral_subjects: 1 });
  api.oralSync.mockReset().mockResolvedValue({ container_id: CONTAINER, oral: [] });
  api.signInWithOAuth.mockReset().mockResolvedValue({});
});
afterEach(() => cleanup());

describe('JoinContainerPage: /g/<код> (spec decisions 24, 25, 52)', () => {
  it('signed out: what the exam holds, that the author sees the name, and sign-in that comes back to /g/', async () => {
    renderAt();
    expect(window.sessionStorage.getItem(GUIDE_LATER_KEY)).toBe('1');
    expect(await screen.findByRole('heading', { name: 'Вас пригласили готовиться к экзамену «Зимняя сессия» в Meldy' })).toBeInTheDocument();
    expect(screen.getByText(/3\sпредмета,\s18\sвопросов\s· экзамен\s12\sянваря/)).toBeInTheDocument();
    expect(screen.getByText(JOIN.lede)).toBeInTheDocument();
    expect(screen.getByText(JOIN.oral)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Войти по почте' })).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/g/${CODE}`)}`);
    expect(screen.getByRole('link', { name: 'Создать аккаунт' })).toHaveAttribute('href', `/register?next=${encodeURIComponent(`/g/${CODE}`)}`);
    fireEvent.click(screen.getByRole('link', { name: 'Войти по почте' }));
    // Not the /join device memory: that one leads to /join/<код>.
    expect(window.localStorage.getItem(JOIN_PENDING_KEY)).toBeNull();
    expect(api.joinByCode).not.toHaveBeenCalled();
    expect(document.body.textContent?.toLowerCase()).not.toContain('копи');
  });

  it('Google comes back through /auth/callback with ?next=/g/<код>', async () => {
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: 'Войти через Google' }));
    await waitFor(() => expect(api.signInWithOAuth).toHaveBeenCalled());
    const [{ provider, options }] = api.signInWithOAuth.mock.calls[0] as [{ provider: string; options: { redirectTo: string } }];
    expect(provider).toBe('google');
    expect(options.redirectTo).toBe(`${window.location.origin}/auth/callback?next=${encodeURIComponent(`/g/${CODE}`)}`);
  });

  it('signed in: joins, asks for the oral copies and opens the exam', async () => {
    api.auth.user = { id: 'member-1' };
    renderAt();
    await waitFor(() => expect(where).toBe(`/exams/c/${CONTAINER}`));
    expect(api.joinByCode).toHaveBeenCalledWith(CODE);
    expect(api.oralSync).toHaveBeenCalledWith(CONTAINER);
    expect(window.sessionStorage.getItem('meldy_container_titles')).toContain('Зимняя сессия');
  });

  it('a test-only exam opens without asking for oral copies', async () => {
    api.auth.user = { id: 'member-1' };
    api.previewLink.mockResolvedValue({ ...ACTIVE, subjects: ACTIVE.subjects!.filter((subject) => !subject.oral), needs_consent_text: false });
    api.joinByCode.mockResolvedValue({ container_id: CONTAINER, joined: true, oral_subjects: 0 });
    renderAt();
    await waitFor(() => expect(where).toBe(`/exams/c/${CONTAINER}`));
    expect(api.oralSync).not.toHaveBeenCalled();
  });

  it('a member already in goes straight to the exam', async () => {
    api.auth.user = { id: 'member-1' };
    api.previewLink.mockResolvedValue({ ...ACTIVE, status: 'joined', container_id: CONTAINER });
    api.joinByCode.mockResolvedValue({ container_id: CONTAINER, joined: false });
    renderAt();
    await waitFor(() => expect(where).toBe(`/exams/c/${CONTAINER}`));
  });

  it('a refusal of the database is said in Russian; a full link offers no retry', async () => {
    api.auth.user = { id: 'member-1' };
    api.joinByCode.mockRejectedValue(Object.assign(new Error('no seat left'), { code: 'MC004' }));
    renderAt();
    expect(await screen.findByText(JOIN.errors.MC004)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: JOIN.retry })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: JOIN.today })).toHaveAttribute('href', '/dashboard');
  });

  it('a network failure can be tried again', async () => {
    api.auth.user = { id: 'member-1' };
    api.joinByCode.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { code: 'network' }));
    renderAt();
    fireEvent.click(await screen.findByRole('button', { name: JOIN.retry }));
    await waitFor(() => expect(where).toBe(`/exams/c/${CONTAINER}`));
  });

  it.each([
    ['revoked', JOIN.status.revoked],
    ['expired', JOIN.status.expired],
    ['full', JOIN.status.full],
    ['removed', JOIN.status.removed],
    ['not_found', JOIN.status.not_found],
  ])('a link that is %s says why and offers the example to a guest', async (status, text) => {
    api.previewLink.mockResolvedValue({ status });
    renderAt();
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: JOIN.failedTitle })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: JOIN.example })).toHaveAttribute('href', '/try');
  });

  it('a link the database does not know names both reasons: a deleted exam or a cut link (usability check m10)', async () => {
    api.previewLink.mockResolvedValue({ status: 'not_found' });
    renderAt();
    const said = await screen.findByRole('alert');
    expect(said.textContent).toBe('Ссылка не работает: экзамен удалили или она пришла не целиком.');
    expect(screen.queryByText(/Ссылка не найдена/)).not.toBeInTheDocument();
    // Signed in, a link gone between the preview and the join says the same.
    cleanup();
    api.auth.user = { id: 'member-1' };
    api.previewLink.mockResolvedValue(ACTIVE);
    api.joinByCode.mockRejectedValue(Object.assign(new Error('no such link'), { code: 'MC001' }));
    renderAt();
    expect(await screen.findByText(JOIN.status.not_found)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: JOIN.retry })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: JOIN.today })).toHaveAttribute('href', '/dashboard');
  });

  it('the author on their own link: «Это ваша ссылка» and the way to the exam', async () => {
    api.auth.user = { id: 'author-1' };
    api.previewLink.mockResolvedValue({ ...ACTIVE, status: 'own', container_id: CONTAINER });
    renderAt();
    expect(await screen.findByRole('heading', { name: JOIN.own })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: JOIN.openExam })).toHaveAttribute('href', `/exams/c/${CONTAINER}`);
    expect(api.joinByCode).not.toHaveBeenCalled();
  });

  it('a malformed code is said at once, without asking the server', () => {
    renderAt('/g/not-a-code');
    expect(screen.getByText(JOIN.unreadable)).toBeInTheDocument();
    expect(api.previewLink).not.toHaveBeenCalled();
  });
});
