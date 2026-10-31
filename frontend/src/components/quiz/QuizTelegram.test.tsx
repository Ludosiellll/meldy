import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuizTelegramState } from '../../types/quiz';

const api = vi.hoisted(() => ({ quizTelegramState: vi.fn(), setQuizNotice: vi.fn(), shareQuizToGroup: vi.fn() }));
vi.mock('../../api/quizzes', () => api);

import QuizTelegram from './QuizTelegram';
import { QA_TELEGRAM } from './copyAuthor';

/** Release 49 (20261105090100_quiz_telegram): Telegram on the author's results page. */
const QUIZ = '7a3e7c1e-1d2b-4c5e-9f0a-1b2c3d4e5f60';
const URL_ = 'https://meldy.example/k/k7m2p9q4r8st';
const plain = (value: string) => value.replace(/\u00a0/g, ' ');
const text = () => plain(document.body.textContent ?? '');
const state = (over: Partial<QuizTelegramState> = {}): QuizTelegramState => ({
  linked: true,
  blocked: false,
  notice: 'off',
  groups: [{ chat_id: -100500, title: '9 «А» — математика', shared_at: null }],
  ...over,
});
const show = (closed = false) =>
  render(
    <MemoryRouter>
      <QuizTelegram quizId={QUIZ} url={URL_} title="Контрольная 9 «А»" closed={closed} />
    </MemoryRouter>,
  );

beforeEach(() => {
  api.quizTelegramState.mockReset().mockResolvedValue(state());
  api.setQuizNotice.mockReset();
  api.shareQuizToGroup.mockReset();
});
afterEach(cleanup);

describe('the notices', () => {
  it('off by default; choosing «о каждой работе» saves it and says what it means', async () => {
    api.setQuizNotice.mockResolvedValue(state({ notice: 'each' }));
    show();
    const select = await screen.findByRole('combobox', { name: QA_TELEGRAM.notice });
    expect(select.textContent).toContain(QA_TELEGRAM.noticeOption('off'));
    expect(text()).toContain(plain(QA_TELEGRAM.noticeHint('off')));
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('option', { name: QA_TELEGRAM.noticeOption('each') }));
    await waitFor(() => expect(api.setQuizNotice).toHaveBeenCalledWith(QUIZ, 'each'));
    await waitFor(() => expect(text()).toContain(plain(QA_TELEGRAM.noticeHint('each'))));
  });

  it('a failed save goes back and says so', async () => {
    api.setQuizNotice.mockRejectedValue(new Error('down'));
    show();
    fireEvent.click(await screen.findByRole('combobox', { name: QA_TELEGRAM.notice }));
    fireEvent.click(screen.getByRole('option', { name: QA_TELEGRAM.noticeOption('digest') }));
    await waitFor(() => expect(text()).toContain(QA_TELEGRAM.failed));
    expect(screen.getByRole('combobox', { name: QA_TELEGRAM.notice }).textContent).toContain(QA_TELEGRAM.noticeOption('off'));
  });

  it('the link went meanwhile (22023 link): no switching on, the way to link again', async () => {
    api.setQuizNotice.mockRejectedValue(Object.assign(new Error('telegram not linked'), { code: '22023', detail: 'link' }));
    show();
    fireEvent.click(await screen.findByRole('combobox', { name: QA_TELEGRAM.notice }));
    fireEvent.click(screen.getByRole('option', { name: QA_TELEGRAM.noticeOption('each') }));
    await waitFor(() => expect(text()).toContain(QA_TELEGRAM.linkGone));
    expect(screen.getByRole('link', { name: QA_TELEGRAM.link })).toHaveAttribute('href', '/profile#telegram');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('not linked: the way to link, no choice, no group button', async () => {
    api.quizTelegramState.mockResolvedValue(state({ linked: false }));
    show();
    await waitFor(() => expect(text()).toContain(QA_TELEGRAM.notLinked));
    expect(screen.getByRole('link', { name: QA_TELEGRAM.link })).toHaveAttribute('href', '/profile#telegram');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: QA_TELEGRAM.toGroup('9 «А» — математика') })).toBeNull();
  });

  it('the bot stopped: said so, nothing to choose', async () => {
    api.quizTelegramState.mockResolvedValue(state({ blocked: true }));
    show();
    await waitFor(() => expect(text()).toContain(QA_TELEGRAM.blocked));
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('the link into a group chat', () => {
  it('one press: the bot posts it within a minute; a second the same day is said as already sent', async () => {
    api.shareQuizToGroup.mockResolvedValueOnce({ status: 'queued', title: '9 «А» — математика' }).mockResolvedValueOnce({ status: 'already', title: '9 «А» — математика' });
    show();
    const button = await screen.findByRole('button', { name: QA_TELEGRAM.toGroup('9 «А» — математика') });
    fireEvent.click(button);
    await waitFor(() => expect(text()).toContain(QA_TELEGRAM.shared('9 «А» — математика')));
    expect(api.shareQuizToGroup).toHaveBeenCalledWith(QUIZ, -100500);
    fireEvent.click(button);
    await waitFor(() => expect(text()).toContain(QA_TELEGRAM.already('9 «А» — математика')));
  });

  it('«Поделиться в Telegram» opens Telegram\'s own chooser with the link and the name', async () => {
    show();
    const link = await screen.findByRole('link', { name: QA_TELEGRAM.shareAnywhere });
    const href = new URL(link.getAttribute('href') ?? '');
    expect(href.origin + href.pathname).toBe('https://t.me/share/url');
    expect(href.searchParams.get('url')).toBe(URL_);
    expect(href.searchParams.get('text')).toBe(QA_TELEGRAM.shareText('Контрольная 9 «А»'));
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('a closed quiz offers no link to share', async () => {
    show(true);
    await waitFor(() => expect(api.quizTelegramState).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: QA_TELEGRAM.shareAnywhere })).toBeNull();
    expect(screen.queryByRole('button', { name: QA_TELEGRAM.toGroup('9 «А» — математика') })).toBeNull();
  });

  it('an older server without the functions: only «Поделиться в Telegram»', async () => {
    api.quizTelegramState.mockRejectedValue(new Error('PGRST202'));
    show();
    await waitFor(() => expect(api.quizTelegramState).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: QA_TELEGRAM.shareAnywhere })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(text()).not.toContain(QA_TELEGRAM.notLinked);
  });
});
