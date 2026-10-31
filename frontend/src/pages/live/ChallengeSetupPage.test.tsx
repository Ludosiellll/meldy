/**
 * «Соревнование по ссылке» — the setup (/live/challenge?c=<test>): the deadline, the time, «Без спешки» (which hides
 * «Очки за скорость»), the count; the questions a challenge skips with their reasons (a picture among them);
 * «Создать ссылку» sends the settings and opens the challenge's page; a refusal says what to do.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setChallengeApi } from '../../lib/challenge/api';
import type { ChallengeApi } from '../../lib/challenge/types';
import { LiveError } from '../../lib/live/types';
import { CSETUP } from '../../components/challenge/copyAuthor';

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null, loading: false, requestSession: () => {} }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../components/live/host/source', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/live/host/source')>();
  return {
    ...real,
    loadSource: vi.fn(async (containerId: string) => ({
      containerId,
      title: 'Базы данных',
      subjectIds: ['s1'],
      questions: [
        ...Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, text: `Вопрос ${i + 1}`, skip: null, wideSkip: null, playSkip: null, standSkip: null, challengeSkip: null })),
        { id: 'p', text: 'Какая связь на схеме?', skip: 'picture', wideSkip: null, playSkip: null, standSkip: null, challengeSkip: 'picture' },
        { id: 'o', text: 'Расставьте по порядку', skip: 'order', wideSkip: 'order', playSkip: 'order', standSkip: 'order', challengeSkip: 'order' },
      ],
    })),
  };
});

import ChallengeSetupPage from './ChallengeSetupPage';

const create = vi.fn();
beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ challenge_id: 'ch1', code: 'k7m2p9q4r8st', path: '/s/k7m2p9q4r8st', url: 'https://x/s/k7m2p9q4r8st', q_count: 10, skipped: 2, deadline: new Date().toISOString() });
  setChallengeApi({ kind: 'fake', create } as unknown as ChallengeApi);
});
afterEach(() => {
  cleanup();
  setChallengeApi(null);
});

async function open() {
  const view = render(
    <MemoryRouter initialEntries={['/live/challenge?c=c1']}>
      <Routes>
        <Route path="/live/challenge" element={<ChallengeSetupPage />} />
        <Route path="/live/challenge/:id" element={<p>Страница соревнования</p>} />
        <Route path="/login" element={<p>Вход</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
  return view;
}

describe('the setup of «Соревнование по ссылке»', () => {
  it('says what it is, offers the deadline, the time, «Без спешки» and the count, and lists what it skips', async () => {
    const view = await open();
    expect(screen.getByRole('heading', { level: 1, name: 'Соревнование по тесту «Базы данных»' })).toBeInTheDocument();
    expect(view.container.textContent).toContain('Входить в аккаунт не нужно');
    expect(within(screen.getByRole('radiogroup', { name: CSETUP.deadline })).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Час', 'Сегодня', '3 дня', 'Неделя', '2 недели', 'Другая дата',
    ]);
    expect(screen.getByRole('radiogroup', { name: CSETUP.speed })).toBeInTheDocument();
    expect(within(screen.getByRole('radiogroup', { name: CSETUP.amount })).getAllByRole('radio').map((r) => r.textContent)).toEqual(['10', 'все 12']);
    const skipped = view.container.querySelector('.lvs-skipped')!;
    expect(skipped.textContent!.replace(/\u00a0/g, ' ')).toContain('2 вопроса не войдут в соревнование');
    expect(skipped.textContent).toContain('Какая связь на схеме? Есть картинка.');
    expect(skipped.textContent).toContain('Нужно расставить по порядку.');
    // «Без спешки» hides the speed row
    await act(async () => {
      fireEvent.click(within(screen.getByRole('radiogroup', { name: CSETUP.calm })).getByRole('radio', { name: 'Да' }));
    });
    expect(screen.queryByRole('radiogroup', { name: CSETUP.speed })).toBeNull();
  });

  it('«Создать ссылку» sends the settings and the source, then opens the challenge’s page', async () => {
    await open();
    await act(async () => {
      fireEvent.click(within(screen.getByRole('radiogroup', { name: CSETUP.calm })).getByRole('radio', { name: 'Да' }));
      fireEvent.click(within(screen.getByRole('radiogroup', { name: CSETUP.deadline })).getByRole('radio', { name: 'Неделя' }));
      fireEvent.click(within(screen.getByRole('radiogroup', { name: CSETUP.time })).getByRole('radio', { name: /^30\s/ }));
      fireEvent.click(within(screen.getByRole('radiogroup', { name: CSETUP.amount })).getByRole('radio', { name: 'все 12' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: CSETUP.create }));
    });
    expect(create).toHaveBeenCalledTimes(1);
    const [source, settings] = create.mock.calls[0];
    expect(source).toEqual({ container_id: 'c1', subject_ids: ['s1'], count: 12 });
    expect(settings).toMatchObject({ time_s: 30, speed: false, calm: true });
    expect(settings).not.toHaveProperty('reveal');
    const days = (Date.parse(settings.deadline) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThan(8.1);
    expect(screen.getByText('Страница соревнования')).toBeInTheDocument();
  });

  it('«Верный ответ — в конце» goes with the settings, and the setup names what it cannot stop', async () => {
    const view = await open();
    expect(view.container.textContent).toContain(CSETUP.revealHint);
    expect(within(screen.getByRole('radiogroup', { name: CSETUP.reveal })).getAllByRole('radio').map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      [CSETUP.revealEach, 'true'],
      [CSETUP.revealEnd, 'false'],
    ]);
    await act(async () => {
      fireEvent.click(within(screen.getByRole('radiogroup', { name: CSETUP.reveal })).getByRole('radio', { name: CSETUP.revealEnd }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: CSETUP.create }));
    });
    expect(create.mock.calls[0][1]).toMatchObject({ reveal: 'end' });
  });

  it('a date of one’s own outside 5 minutes to 30 days keeps the button shut', async () => {
    await open();
    await act(async () => {
      fireEvent.click(within(screen.getByRole('radiogroup', { name: CSETUP.deadline })).getByRole('radio', { name: 'Другая дата' }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(CSETUP.deadlineCustom), { target: { value: '2020-01-01T10:00' } });
    });
    expect(screen.getByText(CSETUP.deadlineBad)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CSETUP.create })).toBeDisabled();
  });

  it('a refusal says what to do', async () => {
    create.mockRejectedValueOnce(new LiveError('ML009'));
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: CSETUP.create }));
    });
    expect(screen.getByRole('alert').textContent).toBe(CSETUP.error.ML009);
  });
});
