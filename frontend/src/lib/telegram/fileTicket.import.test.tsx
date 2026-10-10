import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import twoSubjects from '../../../../contracts/container/parse_bank_two_subjects.json';
import type { BankParseResult, ContainersOverview } from '../../types/container';

// The import page with ?tg=<ticket> (Telegram bot spec §4.7 F1): the file the bot was sent enters the page's own pick
// path. The mocks are the import page's own test's (pages/container/ImportPage.test.tsx), plus telegram_file_take on the
// client and the function's GET /telegram/file on fetch.
const api = vi.hoisted(() => {
  class ContainerApiError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    ContainerApiError,
    parseBank: vi.fn(),
    parseQuestionList: vi.fn(),
    rpc: vi.fn(),
    overview: { data: null as ContainersOverview | null },
  };
});

vi.mock('../../api/containers', () => ({
  ContainerApiError: api.ContainerApiError,
  containerError: (error: unknown) => error,
  parseBank: api.parseBank,
  createContainer: vi.fn(),
  addSubject: vi.fn(),
  addItems: vi.fn(),
  saveSettings: vi.fn(),
}));
vi.mock('../../api/exams', () => ({
  createExam: vi.fn(),
  parseQuestionList: api.parseQuestionList,
  examErrorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
vi.mock('../containers/plan', () => ({
  feasibility: () => ({ neededMin: 45, option: 45, seenByDateEst: 10_000 }),
  windowDays: () => 4,
}));
vi.mock('../containers/hooks', () => ({
  useContainersOverview: () => ({ data: api.overview.data, loading: false, offline: false, unavailable: false, error: null, reload: () => undefined }),
  useContainerData: () => ({ data: null, loading: false, offline: false, unavailable: false, error: null, reload: () => undefined }),
}));
vi.mock('../supabase', () => ({ supabase: { rpc: api.rpc, supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co' } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../../components/containers/import/targets', async () => {
  const actual = await vi.importActual<typeof import('../../components/containers/import/targets')>('../../components/containers/import/targets');
  return { ...actual, fetchOldExams: vi.fn().mockResolvedValue([]) };
});

import ImportPage from '../../pages/container/ImportPage';
import { TELEGRAM_FILE } from './fileTicket';

const TWO = twoSubjects as unknown as BankParseResult;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const NAME = 'Банк_БД_2026.docx';
const TOKEN = 'c3'.repeat(32);
const BYTES = new Uint8Array([80, 75, 3, 4, 20, 0, 6, 0, 8, 0, 0, 0, 33, 0, 7, 7]);
let seq = 0;
const ticket = () => `F${(0x20000000 + (seq += 1)).toString(16)}${'fedcba9876543210'.repeat(2).slice(0, 24)}`;

let where = '';
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}${location.hash}`;
  return null;
}
function renderAt(path: string) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/exams/import" element={<ImportPage />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </StrictMode>,
  );
}

const fileFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (/\/functions\/v1\/telegram\/file\?t=/.test(url)) return new Response(BYTES, { status: 200, headers: { 'Content-Type': DOCX } });
  return new Response(null, { status: 404 });
});
const fileCalls = () => fileFetch.mock.calls.map(([input]) => String(input)).filter((url) => url.includes('/telegram/file'));

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  where = '';
  api.parseBank.mockReset();
  api.rpc.mockReset();
  fileFetch.mockClear();
  vi.stubGlobal('fetch', fileFetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ImportPage + ?tg=: a file forwarded to the bot opens in the import', () => {
  it('takes the ticket once, fetches the file and reads it through the page’s own path; the ticket leaves the address', async () => {
    const t = ticket();
    api.rpc.mockResolvedValue({ data: { status: 'ok', token: TOKEN, expires_at: '2026-10-16T17:01:00Z', name: NAME, size: BYTES.length, mime: DOCX }, error: null });
    api.parseBank.mockResolvedValue(TWO);
    renderAt(`/exams/import?tg=${t}`);
    expect(await screen.findByRole('heading', { name: /Нашли 2\sпредмета и 18\sвопросов/ })).toBeInTheDocument();
    expect(api.rpc).toHaveBeenCalledTimes(1);
    expect(api.rpc).toHaveBeenCalledWith('telegram_file_take', { p_ticket: t });
    // The build's project (VITE_SUPABASE_URL), the one-time token, the function's region.
    expect(fileCalls()).toHaveLength(1);
    expect(fileCalls()[0]).toMatch(new RegExp(`^https://[a-z0-9-]+\\.supabase\\.co/functions/v1/telegram/file\\?t=${TOKEN}&forceFunctionRegion=eu-central-1$`));
    expect(api.parseBank).toHaveBeenCalledTimes(1);
    const input = api.parseBank.mock.calls[0][0] as { file: File; format: string };
    expect(input.format).toBe('auto');
    expect(input.file).toBeInstanceOf(File);
    expect(input.file.name).toBe(NAME);
    expect(input.file.size).toBe(BYTES.length);
    expect(new Uint8Array(await input.file.arrayBuffer())).toEqual(BYTES);
    await waitFor(() => expect(where).toBe('/exams/import'));
    expect(screen.queryByText(TELEGRAM_FILE.opening)).not.toBeInTheDocument();
  });

  it('says «Открываем файл из Telegram…» while the file comes', async () => {
    const t = ticket();
    let answer: (value: unknown) => void = () => undefined;
    api.rpc.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderAt(`/exams/import?tg=${t}`);
    expect(await screen.findByRole('status')).toHaveTextContent(TELEGRAM_FILE.opening);
    expect(screen.getByRole('button', { name: 'Выбрать файлы' })).toBeInTheDocument();
    answer({ data: { status: 'expired' }, error: null });
    expect(await screen.findByRole('alert')).toHaveTextContent(TELEGRAM_FILE.stale);
  });

  it('a stale or used ticket: the exact line, the picker stays, nothing is read', async () => {
    const t = ticket();
    api.rpc.mockResolvedValue({ data: { status: 'used' }, error: null });
    renderAt(`/exams/import?tg=${t}`);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Ссылка из Telegram устарела — перешлите файл боту ещё раз.');
    expect(screen.getByRole('button', { name: 'Выбрать файлы' })).toBeInTheDocument();
    expect(api.parseBank).not.toHaveBeenCalled();
    expect(fileCalls()).toEqual([]);
    await waitFor(() => expect(where).toBe('/exams/import'));
  });

  it('without ?tg= the page is as before: no take, no line', async () => {
    renderAt('/exams/import');
    expect(screen.getByRole('button', { name: 'Выбрать файлы' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(TELEGRAM_FILE.opening)).not.toBeInTheDocument();
  });
});
