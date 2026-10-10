import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import summaryJson from '../../../../../contracts/container/summary.json';
import type { ContainerSummary, MemberRow } from '../../../types/container';

const api = vi.hoisted(() => ({
  createLink: vi.fn(),
  revokeLink: vi.fn(),
  fetchMembers: vi.fn(),
  removeMember: vi.fn(),
  copyText: vi.fn(),
}));
vi.mock('../../../api/containers', () => ({
  createLink: api.createLink,
  revokeLink: api.revokeLink,
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
  api.createLink.mockReset().mockResolvedValue({ link_id: 'link-new', code: 'abcd2fghjkmn', path: '/g/abcd2fghjkmn', oral_subjects: 0, expires_at: '2026-10-30T00:00:00Z' });
  api.revokeLink.mockReset().mockResolvedValue(undefined);
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
    expect(keptLinks(SUMMARY.id)).toEqual([]);
    expect(onChanged).toHaveBeenCalled();
    // The window shows what is so now: the link is closed, said on screen (with the focus on it), and «Создать ссылку».
    const said = await screen.findByText(INVITE.revoked);
    await waitFor(() => expect(document.activeElement).toBe(said));
    expect(screen.queryByLabelText(INVITE.linkLabel)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ссылка открыта/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Закрыть ссылку' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeInTheDocument();
    expect(screen.getByText(/В экзамене 12\sучастников/)).toBeInTheDocument();
  });

  it('an open link made on another device: says before the tap that a new link replaces it, and closes it first (M2)', async () => {
    const onChanged = vi.fn();
    render(
      <InviteExam summary={{ ...TEST_ONLY, owner: { members: 3, doubts_open: 0, links: [{ ...LINK, members: 3 }] } }} onClose={() => undefined} onChanged={onChanged} />,
    );
    expect(screen.getByText(`${INVITE.openElsewhere} ${INVITE.newLinkNote}`)).toBeInTheDocument();
    expect(INVITE.newLinkNote).toMatch(/по старой больше никто не войдёт/);
    fireEvent.click(screen.getByRole('button', { name: INVITE.newLink }));
    // The focus goes on to the window's next step.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Создать ссылку' })));
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    await waitFor(() => expect(api.createLink).toHaveBeenCalled());
    expect(api.revokeLink).toHaveBeenCalledWith('link-1');
    expect(api.revokeLink.mock.invocationCallOrder[0]).toBeLessThan(api.createLink.mock.invocationCallOrder[0]);
    expect(await screen.findByLabelText(INVITE.linkLabel)).toHaveValue(`${window.location.origin}/g/abcd2fghjkmn`);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: INVITE.copy })));
    // One reload of the page for the whole step.
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('«Закрыть ссылку» closes every open link of the exam, the unseen ones too (M2)', async () => {
    keepLink(SUMMARY.id, 'link-2', 'qrst2vwxyz01');
    const older = { ...LINK, id: 'link-1', created_at: '2026-10-07T10:00:00Z' };
    const newer = { ...LINK, id: 'link-2', created_at: '2026-10-09T10:00:00Z', members: 0 };
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 12, doubts_open: 0, links: [older, newer] } }} onClose={() => undefined} />);
    expect(screen.getByLabelText(INVITE.linkLabel)).toHaveValue(`${window.location.origin}/g/qrst2vwxyz01`);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть ссылку' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }));
    expect(await screen.findByText(INVITE.revoked)).toBeInTheDocument();
    expect(api.revokeLink.mock.calls.map(([id]) => id)).toEqual(['link-2', 'link-1']);
    // The page has not read its summary again yet: the window still knows both are closed.
    expect(screen.queryByText(/Ссылка открыта/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать ссылку' })).toBeInTheDocument();
  });

  it('a close that fails halfway: the closed one stays closed, the error is said, the rest can be closed again', async () => {
    const older = { ...LINK, id: 'link-1', created_at: '2026-10-07T10:00:00Z' };
    const newer = { ...LINK, id: 'link-2', created_at: '2026-10-09T10:00:00Z', members: 0 };
    keepLink(SUMMARY.id, 'link-2', 'qrst2vwxyz01');
    keepLink(SUMMARY.id, 'link-1', 'zzzz2vwxyz01');
    api.revokeLink.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { code: 'network' }));
    const onChanged = vi.fn();
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 12, doubts_open: 0, links: [older, newer] } }} onClose={() => undefined} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть ссылку' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }));
    expect((await screen.findByRole('alert')).textContent).toBe(INVITE.errors.network);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(keptLinks(SUMMARY.id)).toEqual([{ link: 'link-1', code: 'zzzz2vwxyz01' }]);
    // What is still open is on screen (the older link, kept here too), not «Ссылка закрыта».
    expect(screen.queryByText(INVITE.revoked)).not.toBeInTheDocument();
    expect(screen.getByLabelText(INVITE.linkLabel)).toHaveValue(`${window.location.origin}/g/zzzz2vwxyz01`);
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }));
    expect(await screen.findByText(INVITE.revoked)).toBeInTheDocument();
    expect(api.revokeLink.mock.calls.map(([id]) => id)).toEqual(['link-2', 'link-1', 'link-1']);
  });

  it('a new link does not come while an old one could not be closed', async () => {
    api.revokeLink.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { code: 'network' }));
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 3, doubts_open: 0, links: [{ ...LINK, members: 3 }] } }} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: INVITE.newLink }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    expect((await screen.findByRole('alert')).textContent).toBe(INVITE.errors.network);
    expect(api.createLink).not.toHaveBeenCalled();
    // «Создать ссылку» gets the focus back, ready for another try.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Создать ссылку' })));
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

  it('a full link: says that no seat is left under the group line and offers a new link, which closes it first', async () => {
    keepLink(SUMMARY.id, 'link-1', 'qrst2vwxyz01');
    const full = { ...LINK, members: 60 };
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 58, doubts_open: 0, links: [full] } }} onClose={() => undefined} />);
    expect(screen.getByText(/В экзамене 58\sучастников/)).toBeInTheDocument();
    expect(screen.getByText(/Мест по этой ссылке больше нет: заняты все\s60\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать новую ссылку' }));
    expect(screen.getByText(/Новая ссылка заменит открытую: по старой больше никто не войдёт\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    await waitFor(() => expect(api.revokeLink).toHaveBeenCalledWith('link-1'));
    await waitFor(() => expect(api.createLink).toHaveBeenCalled());
    expect(api.revokeLink.mock.invocationCallOrder[0]).toBeLessThan(api.createLink.mock.invocationCallOrder[0]);
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

  it('closes on Escape and on ×', () => {
    const onClose = vi.fn();
    render(<InviteExam summary={TEST_ONLY} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
