import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import summaryJson from '../../../../../contracts/container/summary.json';
import type { ContainerSummary, MemberRow } from '../../../types/container';

const api = vi.hoisted(() => ({
  createLink: vi.fn(),
  revokeLink: vi.fn(),
  extendLink: vi.fn(),
  fetchMembers: vi.fn(),
  removeMember: vi.fn(),
  copyText: vi.fn(),
}));
vi.mock('../../../api/containers', () => ({
  createLink: api.createLink,
  revokeLink: api.revokeLink,
  extendLink: api.extendLink,
  fetchMembers: api.fetchMembers,
  removeMember: api.removeMember,
}));
vi.mock('../../../lib/clipboard', () => ({ copyText: api.copyText }));

import InviteExam from './InviteExam';
import { keepLink, keptLinks } from './linkStore';
import { INVITE } from '../copyImport';

const SUMMARY = summaryJson as unknown as ContainerSummary;
const TEST_ONLY: ContainerSummary = {
  ...SUMMARY,
  subjects: SUMMARY.subjects.filter((subject) => !subject.oral).map((subject, index) => ({ ...subject, no_key: index === 0 ? 4 : 0 })),
  owner: { members: 0, doubts_open: 0, links: [] },
};
const LINK = { id: 'link-1', created_at: '2026-10-08T10:00:00Z', expires_at: '2099-01-01T00:00:00Z', revoked_at: null, members: 12, max_members: 60, oral: 0 };
const MEMBERS: MemberRow[] = [
  { user_id: 'u-1', name: 'Аня Ковалёва', joined_at: '2026-10-08T12:00:00Z', left_at: null, removed_at: null },
  { user_id: 'u-2', name: 'Денис', joined_at: '2026-10-09T08:00:00Z', left_at: null, removed_at: null },
  { user_id: 'u-3', name: 'Вика', joined_at: '2026-10-08T15:00:00Z', left_at: null, removed_at: '2026-10-09T09:00:00Z' },
];

beforeEach(() => {
  window.localStorage.clear();
  api.createLink.mockReset().mockResolvedValue({ link_id: 'link-new', code: 'abcd2fghjkmn', path: '/g/abcd2fghjkmn', oral_subjects: 0, expires_at: '2099-10-30T00:00:00Z' });
  api.revokeLink.mockReset().mockResolvedValue(undefined);
  api.extendLink.mockReset();
  api.fetchMembers.mockReset().mockResolvedValue(MEMBERS);
  api.removeMember.mockReset().mockResolvedValue(1);
  api.copyText.mockReset().mockResolvedValue(true);
});
afterEach(() => cleanup());

describe('InviteExam: «Пригласить группу» (spec decisions 24, 52)', () => {
  it('a test-only exam: one paragraph, no consent box, the link and the text for the chat', async () => {
    const onChanged = vi.fn();
    render(<InviteExam summary={TEST_ONLY} onClose={() => undefined} onChanged={onChanged} />);
    const dialog = screen.getByRole('dialog', { name: 'Пригласить группу' });
    expect(within(dialog).getByText(/По ссылке каждый получит весь экзамен: 2\sпредмета, 22\sвопроса\. Прогресс у каждого свой, а исправленный вами ключ придёт всем\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/4\sвопроса пока без ключа: участникам они придут, когда вы отметите ответ\./)).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать ссылку' }));
    await waitFor(() => expect(api.createLink).toHaveBeenCalledWith(SUMMARY.id, 60, null));
    const url = `${window.location.origin}/g/abcd2fghjkmn`;
    expect(await within(dialog).findByLabelText(INVITE.linkLabel)).toHaveValue(url);
    expect(within(dialog).getByLabelText(INVITE.textLabel)).toHaveValue(
      `Готовимся вместе в Meldy: «Зимняя сессия», 2 предмета, 22 вопроса. Ссылка: ${url}`,
    );
    expect(keptLinks(SUMMARY.id)).toEqual([{ link: 'link-new', code: 'abcd2fghjkmn' }]);
    expect(onChanged).toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: INVITE.copy }));
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith(url, expect.anything()));
    expect(await within(dialog).findByRole('button', { name: INVITE.copied })).toBeInTheDocument();
  });

  it('an exam with oral subjects asks for the consent before the link', async () => {
    render(<InviteExam summary={{ ...SUMMARY, owner: { members: 0, doubts_open: 0, links: [] } }} onClose={() => undefined} />);
    const create = screen.getByRole('button', { name: 'Создать ссылку' });
    expect(create).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: INVITE.consent }));
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() => expect(api.createLink).toHaveBeenCalledWith(SUMMARY.id, 60, INVITE.consent));
  });

  it('an open link kept on this device: the link again, «В экзамене 12 участников · Кто вошёл», remove a member, close the link', async () => {
    keepLink(SUMMARY.id, 'link-1', 'qrst2vwxyz01');
    const onChanged = vi.fn();
    render(<InviteExam summary={{ ...SUMMARY, owner: { members: 12, doubts_open: 0, links: [LINK] } }} onClose={() => undefined} onChanged={onChanged} />);
    expect(screen.getByLabelText(INVITE.linkLabel)).toHaveValue(`${window.location.origin}/g/qrst2vwxyz01`);
    expect(screen.getByText(/В экзамене 12\sучастников/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Кто вошёл' }));
    expect(await screen.findByText('Аня Ковалёва')).toBeInTheDocument();
    expect(screen.getByText('Убраны')).toBeInTheDocument();
    const anya = screen.getByText('Аня Ковалёва').closest('li')!;
    fireEvent.click(within(anya).getByRole('button', { name: 'Убрать' }));
    expect(within(anya).getByText(/Убрать из экзамена: Аня Ковалёва\?/)).toBeInTheDocument();
    fireEvent.click(within(anya).getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith(SUMMARY.id, 'u-1', false));
    const vika = screen.getByText('Вика').closest('li')!;
    fireEvent.click(within(vika).getByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith(SUMMARY.id, 'u-3', true));

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть ссылку' }));
    expect(screen.getByText(INVITE.revokeAsk)).toBeInTheDocument();
    // The confirm takes the focus on «Отмена» and gives it back to «Закрыть ссылку» (m9).
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' })));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Закрыть ссылку' })));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть ссылку' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }));
    await waitFor(() => expect(api.revokeLink).toHaveBeenCalledWith('link-1'));
    // The code stays on this device: opened again, the link is on screen again.
    expect(keptLinks(SUMMARY.id)).toEqual([{ link: 'link-1', code: 'qrst2vwxyz01' }]);
    expect(onChanged).toHaveBeenCalled();
    // The window shows what is so now: the link is closed, said on screen (with the focus on it), and «Создать ссылку».
    const said = await screen.findByText(INVITE.revoked);
    await waitFor(() => expect(document.activeElement).toBe(said));
    expect(screen.queryByLabelText(INVITE.linkLabel)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ссылка открыта/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Закрыть ссылку' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeInTheDocument();
    expect(screen.getByText(/В экзамене 12\sучастников/)).toBeInTheDocument();
    // …and it is listed with the closed ones, ready to be opened again.
    const shut = screen.getByRole('heading', { name: INVITE.shut }).parentElement!;
    expect(within(shut).getByText(/Ссылка от 8\sоктября/)).toBeInTheDocument();
    expect(within(shut).getByRole('button', { name: INVITE.reopen })).toBeInTheDocument();
  });

  it('an open link made on another device: said with who came in by it; a new link leaves it open (owner, 04.11)', async () => {
    const onChanged = vi.fn();
    render(
      <InviteExam summary={{ ...TEST_ONLY, owner: { members: 19, doubts_open: 0, links: [{ ...LINK, members: 19 }] } }} onClose={() => undefined} onChanged={onChanged} />,
    );
    expect(screen.getByText(INVITE.openElsewhere(1))).toBeInTheDocument();
    expect(screen.getByText(/^Открыта ссылка от 8\sоктября: по ней вошли 19\. Работает до 1\sянваря\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать ссылку' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: INVITE.newLink }));
    // Beside the button that makes it: the new link closes nothing.
    expect(screen.getByText(INVITE.newLinkNote(1))).toBeInTheDocument();
    expect(INVITE.newLinkNote(1)).toMatch(/не закроет открытую/);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Создать ссылку' })));
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    expect(await screen.findByLabelText(INVITE.linkLabel)).toHaveValue(`${window.location.origin}/g/abcd2fghjkmn`);
    expect(api.createLink).toHaveBeenCalledTimes(1);
    expect(api.revokeLink).not.toHaveBeenCalled();
    // What else is open is said plainly, with the way to close it.
    expect(screen.getByText(/^Ещё открыта ссылка от 8\sоктября: по ней вошли 19\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: INVITE.closeOther })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: INVITE.copy })));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('«Закрыть ссылку» closes only the link on screen; the other open one stays and is said', async () => {
    keepLink(SUMMARY.id, 'link-2', 'qrst2vwxyz01');
    const older = { ...LINK, id: 'link-1', created_at: '2026-10-07T10:00:00Z' };
    const newer = { ...LINK, id: 'link-2', created_at: '2026-10-09T10:00:00Z', members: 0 };
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 12, doubts_open: 0, links: [older, newer] } }} onClose={() => undefined} />);
    expect(screen.getByLabelText(INVITE.linkLabel)).toHaveValue(`${window.location.origin}/g/qrst2vwxyz01`);
    expect(screen.getByText(/^Ещё открыта ссылка от 7\sоктября: по ней вошли 12\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть ссылку' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }));
    expect(await screen.findByText(INVITE.revoked)).toBeInTheDocument();
    expect(api.revokeLink.mock.calls.map(([id]) => id)).toEqual(['link-2']);
    // The older one is still open (its code is not on this device): said, and no «Создать ссылку» over it.
    expect(screen.getByText(INVITE.openElsewhere(1))).toBeInTheDocument();
    expect(screen.getByText(/^Открыта ссылка от 7\sоктября/)).toBeInTheDocument();
    expect(screen.queryByLabelText(INVITE.linkLabel)).not.toBeInTheDocument();
  });

  it('«Закрыть её»: another open link closes after a confirm and goes to the closed ones', async () => {
    keepLink(SUMMARY.id, 'link-2', 'qrst2vwxyz01');
    const older = { ...LINK, id: 'link-1', created_at: '2026-10-07T10:00:00Z', members: 19 };
    const newer = { ...LINK, id: 'link-2', created_at: '2026-10-09T10:00:00Z', members: 0 };
    const onChanged = vi.fn();
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 19, doubts_open: 0, links: [older, newer] } }} onClose={() => undefined} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: INVITE.closeOther }));
    expect(screen.getByText(/^Закрыть ссылку от 7\sоктября\? По ней больше никто не войдёт\./)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' })));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: INVITE.closeOther })));
    expect(api.revokeLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: INVITE.closeOther }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }));
    await waitFor(() => expect(api.revokeLink).toHaveBeenCalledWith('link-1'));
    const said = await screen.findByText(/^Ссылка от 7\sоктября закрыта\. По ней больше никто не войдёт\.$/);
    await waitFor(() => expect(document.activeElement).toBe(said));
    expect(api.revokeLink).toHaveBeenCalledTimes(1);
    // The link on screen stays; the closed one is listed with «Открыть снова».
    expect(screen.getByLabelText(INVITE.linkLabel)).toHaveValue(`${window.location.origin}/g/qrst2vwxyz01`);
    expect(screen.queryByText(/Ещё открыта ссылка/)).not.toBeInTheDocument();
    expect(screen.getByText(/закрыта \d+\s\S+ · вошли 19/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a close that fails: the error is said and the link stays on screen, ready to be closed again', async () => {
    keepLink(SUMMARY.id, 'link-1', 'qrst2vwxyz01');
    api.revokeLink.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { code: 'network' }));
    const onChanged = vi.fn();
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 12, doubts_open: 0, links: [LINK] } }} onClose={() => undefined} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть ссылку' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }));
    expect((await screen.findByRole('alert')).textContent).toBe(INVITE.errors.network);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByText(INVITE.revoked)).not.toBeInTheDocument();
    expect(screen.getByLabelText(INVITE.linkLabel)).toHaveValue(`${window.location.origin}/g/qrst2vwxyz01`);
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }));
    expect(await screen.findByText(INVITE.revoked)).toBeInTheDocument();
    expect(api.revokeLink.mock.calls.map(([id]) => id)).toEqual(['link-1', 'link-1']);
  });

  it('closed and expired links: «Открыть снова» opens one again, and a code kept here is on screen again', async () => {
    keepLink(SUMMARY.id, 'link-1', 'qrst2vwxyz01');
    const closed = { ...LINK, id: 'link-1', created_at: '2026-10-14T10:00:00Z', revoked_at: '2026-11-03T14:21:08Z', members: 19 };
    const expired = { ...LINK, id: 'link-2', created_at: '2026-09-01T10:00:00Z', expires_at: '2026-10-01T00:00:00Z', members: 0 };
    api.extendLink.mockResolvedValue({ id: 'link-1', container_id: SUMMARY.id, expires_at: '2099-03-01T00:00:00Z', revoked_at: null, reopened: true });
    const onChanged = vi.fn();
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 19, doubts_open: 0, links: [closed, expired] } }} onClose={() => undefined} onChanged={onChanged} />);
    const shut = screen.getByRole('heading', { name: INVITE.shut }).parentElement!;
    const rows = within(shut).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent!.replace(/\u00a0/g, ' '))).toEqual([
      'Ссылка от 14 октябрязакрыта 3 ноября · вошли 19Открыть снова',
      'Ссылка от 1 сентябрясрок кончился 1 октября · никто не вошёлОткрыть снова',
    ]);
    // Nothing open: the way to a new link is there too.
    expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeInTheDocument();
    fireEvent.click(within(rows[0]).getByRole('button', { name: INVITE.reopen }));
    await waitFor(() => expect(api.extendLink).toHaveBeenCalledWith('link-1'));
    const said = await screen.findByText(/^Ссылка от 14\sоктября снова работает до 1\sмарта\./);
    await waitFor(() => expect(document.activeElement).toBe(said));
    expect(screen.getByLabelText(INVITE.linkLabel)).toHaveValue(`${window.location.origin}/g/qrst2vwxyz01`);
    expect(screen.getByText(/^Ссылка работает до 1\sмарта\.$/)).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: INVITE.shut }).parentElement!).getAllByRole('listitem')).toHaveLength(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('«Продлить» is offered when it moves the end, and says the new one; never for a link that lasts longer', async () => {
    keepLink(SUMMARY.id, 'link-1', 'qrst2vwxyz01');
    const soon = { ...LINK, expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString() };
    api.extendLink.mockResolvedValue({ id: 'link-1', container_id: SUMMARY.id, expires_at: '2099-02-11T00:00:00Z', revoked_at: null, reopened: false });
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 12, doubts_open: 0, links: [soon] } }} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: INVITE.extend }));
    await waitFor(() => expect(api.extendLink).toHaveBeenCalledWith('link-1'));
    expect(await screen.findByText(/^Ссылка продлена до 11\sфевраля\.$/)).toBeInTheDocument();
    expect(screen.getByText(/^Ссылка работает до 11\sфевраля\.$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: INVITE.extend })).not.toBeInTheDocument();
    cleanup();
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 12, doubts_open: 0, links: [LINK] } }} onClose={() => undefined} />);
    expect(screen.getByText(/^Ссылка работает до 1\sянваря\.$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: INVITE.extend })).not.toBeInTheDocument();
  });

  it('opening again past ten open links: the refusal in Russian', async () => {
    api.extendLink.mockRejectedValue(Object.assign(new Error('at most 10 open links'), { code: 'MC007' }));
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 0, doubts_open: 0, links: [{ ...LINK, revoked_at: '2026-10-09T10:00:00Z' }] } }} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: INVITE.reopen }));
    expect(await screen.findByText(INVITE.errors.MC007)).toBeInTheDocument();
  });

  it('nobody left and the link closed: «Кто вошёл» stays, so a removed member can be returned (M1, m3)', async () => {
    api.fetchMembers.mockResolvedValue([MEMBERS[2]]);
    const onChanged = vi.fn();
    render(
      <InviteExam
        summary={{ ...TEST_ONLY, owner: { members: 0, doubts_open: 0, links: [{ ...LINK, revoked_at: '2026-10-09T10:00:00Z', members: 1 }] } }}
        onClose={() => undefined}
        onChanged={onChanged}
      />,
    );
    expect(screen.getByText(/Сейчас в экзамене никого/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Кто вошёл' }));
    const vika = (await screen.findByText('Вика')).closest('li')!;
    expect(screen.queryByText(/Пока никто не вошёл/)).not.toBeInTheDocument();
    fireEvent.click(within(vika).getByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith(SUMMARY.id, 'u-3', true));
    expect(onChanged).toHaveBeenCalled();
  });

  it('one truthful line: a member in through an older link with a fresh link open says «В экзамене 1 участник» (m3)', () => {
    const fresh = { ...LINK, id: 'link-2', created_at: '2026-10-09T10:00:00Z', members: 0 };
    const older = { ...LINK, id: 'link-1', revoked_at: '2026-10-08T12:00:00Z', members: 1 };
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 1, doubts_open: 0, links: [fresh, older] } }} onClose={() => undefined} />);
    expect(screen.getByText(/В экзамене 1\sучастник/)).toBeInTheDocument();
    expect(screen.queryByText(/Пока никто не вошёл/)).not.toBeInTheDocument();
    cleanup();
    // Nobody ever: «Пока никто не вошёл» beside the open link, without «Кто вошёл».
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 0, doubts_open: 0, links: [fresh] } }} onClose={() => undefined} />);
    expect(screen.getByText('Пока никто не вошёл')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Кто вошёл' })).not.toBeInTheDocument();
  });

  it('a full link: says that no seat is left under the group line and offers a new link, which closes nothing', async () => {
    keepLink(SUMMARY.id, 'link-1', 'qrst2vwxyz01');
    const full = { ...LINK, members: 60 };
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 58, doubts_open: 0, links: [full] } }} onClose={() => undefined} />);
    expect(screen.getByText(/В экзамене 58\sучастников/)).toBeInTheDocument();
    expect(screen.getByText(/Мест по этой ссылке больше нет: заняты все\s60\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать новую ссылку' }));
    expect(screen.getByText(/Новая ссылка не закроет открытую: по старой тоже можно будет войти\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    // While the new one is made, the place is the new link's; the full one is said with the others.
    expect(screen.getByLabelText(INVITE.linkLabel)).toHaveAttribute('placeholder', INVITE.creating);
    expect(screen.queryByText(/Мест по этой ссылке больше нет/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Ещё открыта ссылка от 8\sоктября: по ней вошли 60\./)).toBeInTheDocument();
    await waitFor(() => expect(api.createLink).toHaveBeenCalled());
    expect(api.revokeLink).not.toHaveBeenCalled();
  });

  it('a link with seats left says nothing about seats', () => {
    keepLink(SUMMARY.id, 'link-1', 'qrst2vwxyz01');
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 12, doubts_open: 0, links: [LINK] } }} onClose={() => undefined} />);
    expect(screen.queryByText(/Мест по этой ссылке больше нет/)).not.toBeInTheDocument();
  });

  it('shows the refusal of the database in Russian (too many open links)', async () => {
    api.createLink.mockRejectedValue(Object.assign(new Error('at most 10 open links'), { code: 'MC007' }));
    render(<InviteExam summary={TEST_ONLY} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    expect(await screen.findByText(INVITE.errors.MC007)).toBeInTheDocument();
  });

  it('«Создать ссылку» draws the link’s place at the press; the answer only fills it in (third live check: CLS 0.46)', async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.createLink.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<InviteExam summary={TEST_ONLY} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    // Before the server answers: the field says what happens, its buttons wait, the group's line is there.
    const field = screen.getByLabelText(INVITE.linkLabel);
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', INVITE.creating);
    expect(field.closest('.gr-made')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(document.activeElement).toBe(field));
    const copyLink = screen.getByRole('button', { name: INVITE.copy });
    expect(copyLink).toBeDisabled();
    expect(screen.getByRole('button', { name: INVITE.copyText })).toBeDisabled();
    expect(screen.getByText(INVITE.once)).toBeInTheDocument();
    expect(screen.getByText('Пока никто не вошёл')).toBeInTheDocument();
    const revoke = screen.getByRole('button', { name: 'Закрыть ссылку' });
    expect(revoke).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Создать ссылку' })).not.toBeInTheDocument();
    answer({ link_id: 'link-new', code: 'abcd2fghjkmn', path: '/g/abcd2fghjkmn', oral_subjects: 0, expires_at: '2099-10-30T00:00:00Z' });
    // The same lines, filled in: nothing new comes in above or under them.
    await waitFor(() => expect(field).toHaveValue(`${window.location.origin}/g/abcd2fghjkmn`));
    expect(screen.getByLabelText(INVITE.linkLabel)).toBe(field);
    expect(field).not.toHaveAttribute('placeholder');
    expect(field.closest('.gr-made')).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: INVITE.copy })).toBe(copyLink);
    expect(copyLink).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Закрыть ссылку' })).toBe(revoke);
    expect(revoke).toBeEnabled();
    await waitFor(() => expect(document.activeElement).toBe(copyLink));
  });

  it('while a call is out the link’s part keeps its height, so a closed link or a failure moves nothing; the next press gives it back', async () => {
    const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains('gr-area') ? 412.5 : 0, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    try {
      keepLink(SUMMARY.id, 'link-1', 'qrst2vwxyz01');
      render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 0, doubts_open: 0, links: [{ ...LINK, members: 0 }] } }} onClose={() => undefined} />);
      const area = document.querySelector<HTMLElement>('.gr-area')!;
      expect(area.style.minHeight).toBe('');
      fireEvent.click(screen.getByRole('button', { name: 'Закрыть ссылку' }));
      fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }));
      expect(await screen.findByText(INVITE.revoked)).toBeInTheDocument();
      // The link went, its room stayed: what is under it does not move up when the answer comes.
      expect(area.style.minHeight).toBe('412.5px');
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Создать ссылку' }));
      expect(area.style.minHeight).toBe('');
      // A link that could not be made: «Создать ссылку» and the error come back in the room the link’s place took.
      api.createLink.mockRejectedValue(Object.assign(new Error('Failed to fetch'), { code: 'network' }));
      fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
      expect((await screen.findByRole('alert')).textContent).toBe(INVITE.errors.network);
      expect(area.style.minHeight).toBe('412.5px');
      fireEvent.keyDown(screen.getByRole('button', { name: 'Создать ссылку' }), { key: 'Tab' });
      expect(area.style.minHeight).toBe('');
    } finally {
      box.mockRestore();
    }
  });

  it('closes on Escape and on ×', () => {
    const onClose = vi.fn();
    render(<InviteExam summary={TEST_ONLY} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('InviteExam: «Показать QR» (release 47.3)', () => {
  it('puts the link’s code over the whole screen; Escape closes it alone and the focus goes back', async () => {
    const onClose = vi.fn();
    render(<InviteExam summary={TEST_ONLY} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Пригласить группу' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать ссылку' }));
    const url = `${window.location.origin}/g/abcd2fghjkmn`;
    expect(await within(dialog).findByLabelText(INVITE.linkLabel)).toHaveValue(url);
    const show = within(dialog).getByRole('button', { name: INVITE.qr });
    expect(show).toHaveAttribute('aria-haspopup', 'dialog');
    show.focus();
    fireEvent.click(show);
    const qr = screen.getByRole('dialog', { name: SUMMARY.title });
    expect(within(qr).getByRole('img', { name: INVITE.qrTitle })).toBeInTheDocument();
    expect(qr.textContent).toContain('/g/abcd2fghjkmn');
    expect(qr.textContent).toContain(INVITE.qrHint);
    expect(document.activeElement).toBe(within(qr).getByRole('button', { name: INVITE.qrClose }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: SUMMARY.title })).toBeNull();
    // The invite under it stays open, and «Показать QR» has the focus again.
    expect(screen.getByRole('dialog', { name: 'Пригласить группу' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(show);
  });

  it('no link on screen yet: no QR to show', () => {
    render(<InviteExam summary={TEST_ONLY} onClose={() => undefined} />);
    expect(screen.queryByRole('button', { name: INVITE.qr })).toBeNull();
  });
});
