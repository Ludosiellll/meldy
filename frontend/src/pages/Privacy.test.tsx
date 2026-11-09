import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

/* /privacy: what is kept, who sees it, who processes it, how to delete and how to write — and that its sentences agree
   with what the other screens say. */

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: auth.user, loading: false }) }));

import Privacy, { PRIVACY } from './Privacy';
import { PRIVACY_LINE } from './ExamTicket';
import { TAKE } from '../components/quiz/copyTake';
import { FOOTER_NOTE } from '../components/home3/copy3';
import { DELETION_DAYS } from '../components/account/AccountData';

afterEach(() => {
  cleanup();
  auth.user = null;
});

const open = () =>
  render(
    <MemoryRouter>
      <Privacy />
    </MemoryRouter>,
  );

describe('«Данные и приватность»', () => {
  it('opens without an account: five parts, the bot for writing, no way to the profile', () => {
    open();
    expect(screen.getByRole('heading', { level: 1, name: PRIVACY.title })).toBeInTheDocument();
    for (const part of [PRIVACY.kept.title, PRIVACY.seen.title, PRIVACY.sent.title, PRIVACY.remove.title, PRIVACY.write.title]) {
      expect(screen.getByRole('heading', { level: 2, name: part })).toBeInTheDocument();
    }
    const write = screen.getByRole('region', { name: PRIVACY.write.title });
    expect(within(write).getByRole('link', { name: 'Написать автору Meldy' })).toHaveAttribute('href', 'https://t.me/Meldyteach_bot?start=support');
    expect(screen.queryByRole('link', { name: PRIVACY.toProfile })).toBeNull();
    expect(document.title).toContain(PRIVACY.title);
  });

  it('a signed-in visitor gets the way to the profile, where the request is made', () => {
    auth.user = { id: 'user-1' };
    open();
    expect(screen.getByRole('link', { name: PRIVACY.toProfile })).toHaveAttribute('href', '/profile');
  });

  it('says what the other screens say', () => {
    const page = [...PRIVACY.kept.items, ...PRIVACY.seen.items, ...PRIVACY.sent.items, ...PRIVACY.remove.items].join(' ');
    // the answer screen: no voice recording, the checks and short excerpts stay
    expect(PRIVACY_LINE).toContain('Запись голоса Meldy не получает');
    expect(page).toContain('Запись голоса не хранится');
    expect(page).toContain('итоги проверки по пунктам и короткие отрывки ответа');
    // the same AI services the answer screen names
    for (const name of ['Google Gemini', 'Groq']) {
      expect(PRIVACY_LINE).toContain(name);
      expect(page).toContain(name);
    }
    // a контрольная: its own line before the start
    expect(TAKE.privacy).toBe('Автор увидит ваше имя, ответы и результат.');
    expect(page).toContain('В контрольной автор видит ваше имя, ответы и результат');
    // the landing's note about the statistics
    expect(FOOTER_NOTE).toContain('Тексты лекций и ответы туда не попадают');
    expect(page).toContain('Тексты лекций и ответы туда не попадают');
    // the request's days are the profile's
    expect(page).toContain(`Удаляем в течение ${DELETION_DAYS} дней`);
  });
});
