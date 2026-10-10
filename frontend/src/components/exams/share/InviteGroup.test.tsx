import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InviteGroup, { groupMessage } from './InviteGroup';
import { rememberGroupLink, storedGroupLinks } from '../../../lib/groups/groupLinks';
import { sha256Hex } from '../../../lib/sha256';

// The author's links as the table keeps them (for «Вопрос дня»); the rest of the dialog talks to the server below.
const rows = vi.hoisted(() => vi.fn());
vi.mock('../../../api/examShares', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/examShares')>()),
  fetchOwnShareRows: (...args: unknown[]) => rows(...args),
}));

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
    if (method === 'GET' && url === `/api/oral/sheet?exam_id=${encodeURIComponent(EXAM)}`) {
      return json(200, { exam_id: EXAM, mapping_state: 'done', questions: [sheetQuestion(1)], to_write: 0, units: 0, job: null });
    }
    return json(404, { detail: 'Нет такого адреса' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

let location = '';
function Where() {
  const current = useLocation();
  location = `${current.pathname}${current.hash}`;
  return null;
}

/** The exam page's button, under a router (the dialog links into the exam's lectures). */
function renderInvite() {
  return render(
    <MemoryRouter initialEntries={[`/exams/${EXAM}`]}>
      <Routes>
        <Route path="/exams/:id" element={<InviteGroup examId={EXAM} examTitle="Макроэкономика" />} />
        <Route path="/exams/:id/edit" element={<p>Лекции экзамена</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

function sheetQuestion(position: number) {
  return {
    question_id: `00000000-0000-4000-8000-00000000000${position}`,
    position,
    label: String(position),
    section: null,
    text: 'Эластичность спроса по цене',
    question_hash: position.toString(16).padStart(32, '0'),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rubric: {
      rubric_id: `00000000-0000-4000-8000-0000000000a${position}`,
      built_at: null,
      coverage: 'full',
      coverage_note: '',
      materials: [],
      points: [{ id: 'p1', title: 'Пункт', short: '', essential: true, source_quote: '', source_ids: [] }],
    },
  };
}

async function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Пригласить группу' }));
  return screen.findByRole('dialog', { name: 'Пригласить группу' });
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  rows.mockReset().mockResolvedValue([]);
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
    renderInvite();
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
    // The server keeps only the hash; this device keeps the code for «Вопрос дня».
    expect(plain(within(dialog).getByText(/Meldy хранит у себя только отпечаток/).textContent)).toBe(
      'Meldy хранит у себя только отпечаток ссылки. Сама ссылка останется на этом устройстве — для «Вопроса дня». Потеряете — создайте новую, а эту закройте.',
    );
    expect(storedGroupLinks(EXAM)).toEqual([{ code: CODE, share: SHARE }]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
    expect(await within(dialog).findByRole('button', { name: 'Скопировано' })).toBeInTheDocument();

    const message = within(dialog).getByLabelText('Текст для беседы группы') as HTMLTextAreaElement;
    expect(message.value).toBe(groupMessage('Макроэкономика', url));
    // What the copy gives, then the link; no word about browsers: Google sign-in works in Telegram's links (owner).
    expect(message.value.split('\n')).toEqual([
      'Готовимся к экзамену «Макроэкономика» в Meldy. По ссылке у каждого будет своя копия: вопросы и текст лекций. Ваши ответы видите только вы.',
      url,
    ]);
    expect(message.value).not.toMatch(/Google|Telegram|Viber|Chrome|Safari|браузер/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Скопировать текст' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(message.value));

    // The new link heads the list of this exam's links.
    expect(plain(within(dialog).getByRole('list').textContent)).toContain('пока никто не вошёл');
  });

  it('says what to do when the exam is not ready, and offers no link', async () => {
    server({ ready: false, reason: { code: 'not_ready', reason: 'needs_sheet', questions: 2, detail: 'Сначала допишите шпаргалку: у 2 вопросов ещё нет пунктов ответа.' } });
    renderInvite();
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
    renderInvite();
    const dialog = await openDialog();
    expect(await within(dialog).findByText(/копия из ссылки группы/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Создать ссылку' })).toBeNull();
  });

  it('lists earlier links with how many came in; closing one asks first and keeps the copies', async () => {
    const calls = server({
      shares: [share(OLD, { members: 5 }), share('5a000000-0000-4000-8000-000000000003', { state: 'revoked', revoked_at: '2026-10-06T10:00:00Z' })],
    });
    renderInvite();
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

  it('says the link is shown only now when this browser keeps nothing; «Вопрос дня» still has it while the dialog is open', async () => {
    server({});
    rows.mockResolvedValue([{ id: SHARE, codeHash: sha256Hex(CODE), state: 'active' }]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError');
    });
    renderInvite();
    const dialog = await openDialog();
    fireEvent.click(await within(dialog).findByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать ссылку' }));
    expect(plain((await within(dialog).findByText(/Ссылку видно только сейчас/)).textContent)).toBe(
      'Ссылку видно только сейчас: Meldy хранит не её, а отпечаток. Потеряете — создайте новую, а эту закройте.',
    );
    const field = (await within(dialog).findByRole('textbox', { name: 'Вопрос дня для беседы группы' })) as HTMLTextAreaElement;
    expect(field.value.split('\n').pop()).toBe(`Ответить в Meldy: ${window.location.origin}/join/${CODE}`);
  });

  it('ends with «Вопрос дня» while a link is open, and forgets the code of a closed link', async () => {
    rememberGroupLink(EXAM, CODE, OLD);
    rows.mockResolvedValue([{ id: OLD, codeHash: sha256Hex(CODE), state: 'active' }]);
    server({ shares: [share(OLD, { members: 5 })] });
    renderInvite();
    const dialog = await openDialog();
    const section = (await within(dialog).findByRole('heading', { name: 'Вопрос дня' })).closest('section')!;
    const field = (await within(section).findByRole('textbox', { name: 'Вопрос дня для беседы группы' })) as HTMLTextAreaElement;
    expect(field.value.split('\n')).toEqual([
      'Вопрос дня — «Макроэкономика»',
      '1. Эластичность спроса по цене',
      `Ответить в Meldy: ${window.location.origin}/join/${CODE}`,
    ]);
    fireEvent.click(within(section).getByRole('button', { name: 'Скопировать вопрос дня' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(field.value));

    // Closing the link forgets its code here; with no open link left, «Вопрос дня» goes.
    rows.mockResolvedValue([{ id: OLD, codeHash: sha256Hex(CODE), state: 'revoked' }]);
    const [first] = within(within(dialog).getByRole('list')).getAllByRole('listitem');
    fireEvent.click(within(first).getByRole('button', { name: 'Закрыть ссылку' }));
    fireEvent.click(within(first).getByRole('button', { name: 'Да, закрыть' }));
    await waitFor(() => expect(plain(first.textContent)).toContain('· закрыта'));
    expect(storedGroupLinks(EXAM)).toEqual([]);
    await waitFor(() => expect(within(dialog).queryByRole('heading', { name: 'Вопрос дня' })).toBeNull());
  });

  it('offers no link when the lectures answer none of the questions, says why and leads to the lectures', async () => {
    const calls = server({
      ready: false,
      reason: {
        code: 'nothing_found',
        questions: 18,
        found: 0,
        detail: 'В лекциях не нашлось ответа ни на один вопрос — однокурсникам будет не с чем заниматься. Добавьте лекции по этим темам и сверьте заново, потом приглашайте.',
      },
      coverage: { questions: 18, found: 0 },
    });
    renderInvite();
    const dialog = await openDialog();
    const note = (await within(dialog).findByText(/В лекциях не нашлось ответа ни на один вопрос/)).closest('.ig-note')!;
    expect(plain(note.textContent)).toBe(
      'В лекциях не нашлось ответа ни на один вопрос — однокурсникам будет не с чем заниматься. Добавьте лекции по этим темам и сверьте заново, потом приглашайте.Добавить лекции',
    );
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Создать ссылку' })).toBeNull();
    // The intro does not promise written points over a refusal (live check 07.10).
    expect(plain(dialog.querySelector('.ig-lede')?.textContent)).toBe(
      'Каждый однокурсник получит свою копию экзамена: вопросы и текст ваших лекций. Ваши ответы и прогресс никто не увидит.',
    );
    const lectures = within(note as HTMLElement).getByRole('link', { name: 'Добавить лекции' });
    expect(lectures).toHaveAttribute('href', `/exams/${EXAM}/edit#lectures`);
    fireEvent.click(lectures);
    await waitFor(() => expect(location).toBe(`/exams/${EXAM}/edit#lectures`));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('warns with the numbers when less than half of the list is in the lectures, and still makes the link', async () => {
    const calls = server({ coverage: { questions: 18, found: 4 } });
    renderInvite();
    const dialog = await openDialog();
    const make = await within(dialog).findByRole('button', { name: 'Создать ссылку' });
    const note = within(dialog).getByText(/Ответы нашлись к 4 из 18 вопросов/).closest('.ig-note')!;
    expect(plain(note.querySelector('p')?.textContent)).toBe(
      'Ответы нашлись к 4 из 18 вопросов. У остальных 14 в копиях однокурсников не будет пунктов ответа.',
    );
    expect(within(note as HTMLElement).getByRole('link', { name: 'Добавить лекции' })).toHaveAttribute('href', `/exams/${EXAM}/edit#lectures`);
    // A link can be made: the intro says why it costs the classmates nothing.
    expect(plain(dialog.querySelector('.ig-lede')?.textContent)).toContain('Пункты ответа уже готовы, поэтому вход им ничего не стоит.');
    // The warning comes before the consent: read first, then decide.
    const consent = within(dialog).getByRole('checkbox', { name: CONSENT });
    expect(note.compareDocumentPosition(consent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(consent);
    fireEvent.click(make);
    expect(await within(dialog).findByLabelText('Ссылка для группы')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST' && call.url === '/api/exam-shares')).toBe(true);
  });

  it.each([
    [{ questions: 18, found: 9 }, 'half'],
    [{ questions: 18, found: 18 }, 'all'],
  ])('says nothing about the lectures when %j of the list is found (%s)', async (coverage) => {
    server({ coverage });
    renderInvite();
    const dialog = await openDialog();
    await within(dialog).findByRole('button', { name: 'Создать ссылку' });
    expect(within(dialog).queryByText(/Ответы нашлись/)).toBeNull();
    expect(within(dialog).queryByRole('link', { name: 'Добавить лекции' })).toBeNull();
  });

  it('has two columns when there is a text for the chat: a new link, or «Вопрос дня» of an open link', async () => {
    server({});
    renderInvite();
    let dialog = await openDialog();
    await within(dialog).findByRole('button', { name: 'Создать ссылку' });
    // Nothing for the chat yet: one column.
    expect(dialog).not.toHaveAttribute('data-wide');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать ссылку' }));
    await within(dialog).findByLabelText('Текст для беседы группы');
    expect(dialog).toHaveAttribute('data-wide');
    expect(dialog).toHaveAttribute('data-made');
    // The parts in the order of one column (and of the keyboard): the link, its message, the exam's links.
    const parts = Array.from(dialog.children).map((child) => child.className);
    expect(parts.filter((name) => /^ig-(main|chat|links|day)$/.test(name))).toEqual(['ig-main', 'ig-chat', 'ig-links', 'ig-day']);
    expect(within(dialog.querySelector('.ig-main') as HTMLElement).getByLabelText('Ссылка для группы')).toBeInTheDocument();
    expect(within(dialog.querySelector('.ig-chat') as HTMLElement).getByLabelText('Текст для беседы группы')).toBeInTheDocument();
    cleanup();

    // An open link of this device: «Вопрос дня» on the right, the dialog wide before any new link.
    rememberGroupLink(EXAM, CODE, OLD);
    rows.mockResolvedValue([{ id: OLD, codeHash: sha256Hex(CODE), state: 'active' }]);
    server({ shares: [share(OLD, { members: 5 })] });
    renderInvite();
    dialog = await openDialog();
    const section = (await within(dialog).findByRole('heading', { name: 'Вопрос дня' })).closest('section')!;
    expect(dialog.querySelector('.ig-day')?.contains(section)).toBe(true);
    expect(dialog).toHaveAttribute('data-wide');
    expect(dialog).not.toHaveAttribute('data-made');
    cleanup();

    // The links cannot be read: no «Вопрос дня», back to one column.
    rows.mockRejectedValue(new Error('offline'));
    server({ shares: [share(OLD, { members: 5 })] });
    renderInvite();
    dialog = await openDialog();
    await within(dialog).findByRole('button', { name: 'Создать ссылку' });
    await waitFor(() => expect(dialog).not.toHaveAttribute('data-wide'));
    expect(within(dialog).queryByText('Подбираем вопрос дня…')).toBeNull();
  });

  it('keeps the focus inside; Esc closes and gives it back to the button', async () => {
    server({});
    renderInvite();
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
