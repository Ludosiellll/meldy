import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InviteGroup, { groupMessage } from './InviteGroup';

const EXAM = 'e1d2c3b4-a596-4877-8899-aabbccddeeff';
const SHARE = '5a000000-0000-4000-8000-000000000001';
const OLD = '5a000000-0000-4000-8000-000000000002';
const CODE = 'k7m2pq9rst4v';
const CONSENT = 'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа. Мои ответы и прогресс никто не увидит.';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function share(id: string, extra: Record<string, unknown> = {}) {
  return { id, created_at: '2026-10-07T09:00:00Z', expires_at: '2027-01-05T09:00:00Z', revoked_at: null, max_members: 80, members: 0, state: 'active', ...extra };
}

function server(state: Record<string, unknown>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method === 'GET' && url === `/api/exam-shares?exam_id=${EXAM}`) {
      return json(200, { exam_id: EXAM, consent: CONSENT, max_members: 80, shares: [], ready: true, copy: false, reason: null, ...state });
    }
    if (method === 'POST' && url === '/api/exam-shares') {
      return json(200, { share: share(SHARE), code: CODE, path: `/join/${CODE}` });
    }
    if (method === 'POST' && url === `/api/exam-shares/${OLD}/revoke`) {
      return json(200, { id: OLD, revoked_at: '2026-10-07T12:00:00Z' });
    }
    return json(404, { detail: 'Нет такого адреса' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

async function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Пригласить группу' }));
  return screen.findByRole('dialog', { name: 'Пригласить группу' });
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('«Пригласить группу»', () => {
  it('asks for the consent, then shows the link once with «Скопировать» and a message for the group', async () => {
    const calls = server({});
    render(<InviteGroup examId={EXAM} examTitle="Макроэкономика" />);
    const dialog = await openDialog();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(plain(within(dialog).getByText(/Каждый однокурсник получит свою копию/).textContent)).toContain(
      'Ваши ответы и прогресс никто не увидит.',
    );
    const make = await within(dialog).findByRole('button', { name: 'Создать ссылку' });
    expect(make).toBeDisabled();
    const consent = within(dialog).getByRole('checkbox', { name: CONSENT });
    expect(consent).not.toBeChecked();
    fireEvent.click(consent);
    expect(make).toBeEnabled();
    fireEvent.click(make);

    const link = (await within(dialog).findByLabelText('Ссылка для группы')) as HTMLInputElement;
    const url = `${window.location.origin}/join/${CODE}`;
    expect(link.value).toBe(url);
    expect(link).toHaveAttribute('readonly');
    expect(calls.find((call) => call.method === 'POST')).toEqual({
      method: 'POST',
      url: '/api/exam-shares',
      body: { exam_id: EXAM, consent: true },
    });
    expect(plain(within(dialog).getByText(/Ссылку видно только сейчас/).textContent)).toBe(
      'Ссылку видно только сейчас: Meldy хранит не её, а отпечаток. Потеряете — создайте новую, а эту закройте.',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
    expect(await within(dialog).findByRole('button', { name: 'Скопировано' })).toBeInTheDocument();

    const message = within(dialog).getByLabelText('Текст для беседы группы') as HTMLTextAreaElement;
    expect(message.value).toBe(groupMessage('Макроэкономика', url));
    expect(message.value).toContain('«Макроэкономика»');
    expect(message.value).toContain('Откройте ссылку в Chrome или Safari');
    expect(message.value.split('\n').pop()).toBe(url);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Скопировать текст' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(message.value));

    // The new link heads the list of this exam's links.
    expect(plain(within(dialog).getByRole('list').textContent)).toContain('пока никто не вошёл');
  });

  it('says what to do when the exam is not ready, and offers no link', async () => {
    server({ ready: false, reason: { code: 'not_ready', reason: 'needs_sheet', questions: 2, detail: 'Сначала допишите шпаргалку: у 2 вопросов ещё нет пунктов ответа.' } });
    render(<InviteGroup examId={EXAM} examTitle="Макроэкономика" />);
    const dialog = await openDialog();
    expect(await within(dialog).findByText('Сначала допишите шпаргалку: у 2 вопросов ещё нет пунктов ответа.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Создать ссылку' })).toBeNull();
  });

  it('does not share on a copy that came from a group link', async () => {
    server({
      ready: false,
      copy: true,
      reason: { code: 'is_copy', detail: 'Этот экзамен — копия из ссылки группы. Однокурсников приглашает автор экзамена своей ссылкой.' },
    });
    render(<InviteGroup examId={EXAM} examTitle="Макроэкономика" />);
    const dialog = await openDialog();
    expect(await within(dialog).findByText(/копия из ссылки группы/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Создать ссылку' })).toBeNull();
  });

  it('lists earlier links with how many came in; closing one asks first and keeps the copies', async () => {
    const calls = server({
      shares: [share(OLD, { members: 5 }), share('5a000000-0000-4000-8000-000000000003', { state: 'revoked', revoked_at: '2026-10-06T10:00:00Z' })],
    });
    render(<InviteGroup examId={EXAM} examTitle="Макроэкономика" />);
    const dialog = await openDialog();
    const list = await within(dialog).findByRole('list');
    const [first, second] = within(list).getAllByRole('listitem');
    expect(plain(first.textContent)).toMatch(/^Ссылка от 7 окт\. · вошли 5 из 80/);
    expect(plain(second.textContent)).toContain('· закрыта');
    expect(within(second).queryByRole('button')).toBeNull();

    fireEvent.click(within(first).getByRole('button', { name: 'Закрыть ссылку' }));
    expect(plain(first.textContent)).toContain('По ней больше никто не войдёт, копии останутся у тех, кто уже вошёл.');
    fireEvent.click(within(first).getByRole('button', { name: 'Да, закрыть' }));
    await waitFor(() => expect(plain(first.textContent)).toContain('· закрыта'));
    expect(calls.some((call) => call.method === 'POST' && call.url === `/api/exam-shares/${OLD}/revoke`)).toBe(true);
  });

  it('keeps the focus inside; Esc closes and gives it back to the button', async () => {
    server({});
    render(<InviteGroup examId={EXAM} examTitle="Макроэкономика" />);
    const opener = screen.getByRole('button', { name: 'Пригласить группу' });
    const dialog = await openDialog();
    expect(dialog).toHaveFocus();
    await within(dialog).findByRole('button', { name: 'Создать ссылку' });
    const close = within(dialog).getByRole('button', { name: 'Закрыть' });
    const consent = within(dialog).getByRole('checkbox');
    consent.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(consent).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
