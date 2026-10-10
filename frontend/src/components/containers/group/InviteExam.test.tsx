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

  it('an open link kept on this device: the link again, «Вошли 12 из 60 · Кто вошёл», remove a member, close the link', async () => {
    keepLink(SUMMARY.id, 'link-1', 'qrst2vwxyz01');
    const onChanged = vi.fn();
    render(<InviteExam summary={{ ...SUMMARY, owner: { members: 12, doubts_open: 0, links: [LINK] } }} onClose={() => undefined} onChanged={onChanged} />);
    expect(screen.getByLabelText(INVITE.linkLabel)).toHaveValue(`${window.location.origin}/g/qrst2vwxyz01`);
    expect(screen.getByText(/Вошли 12 из 60/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Да, закрыть' }));
    await waitFor(() => expect(api.revokeLink).toHaveBeenCalledWith('link-1'));
    expect(keptLinks(SUMMARY.id)).toEqual([]);
    expect(onChanged).toHaveBeenCalled();
  });

  it('an open link made on another device: says so and offers a new one', async () => {
    render(<InviteExam summary={{ ...TEST_ONLY, owner: { members: 3, doubts_open: 0, links: [{ ...LINK, members: 3 }] } }} onClose={() => undefined} />);
    expect(screen.getByText(INVITE.openElsewhere)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: INVITE.newLink }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    await waitFor(() => expect(api.createLink).toHaveBeenCalled());
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
