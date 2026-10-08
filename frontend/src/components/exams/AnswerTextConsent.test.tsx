import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  consent: 'unknown' as 'granted' | 'declined' | 'unknown',
  readFails: false,
  writeFails: false,
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../lib/oral/answerTexts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/oral/answerTexts')>()),
  readAnswerTextConsent: async (userId: string) => {
    mocks.read(userId);
    if (mocks.readFails) throw new Error('no table yet');
    return mocks.consent;
  },
  setAnswerTextConsent: async (userId: string, granted: boolean) => {
    mocks.write(userId, granted);
    if (mocks.writeFails) throw new Error('not saved');
  },
  onAnswerTextConsent: () => () => undefined,
}));

import AnswerTextConsent, { CONSENT_DECLINED_LINE, CONSENT_FAILED_LINE, CONSENT_GRANTED_LINE, CONSENT_SHORT_ASK } from './AnswerTextConsent';
import { ANSWER_TEXT_CONSENT_ASK, ANSWER_TEXT_CONSENT_TEXT } from '../../lib/oral/answerTexts';

beforeEach(() => {
  Object.assign(mocks, { user: { id: 'user-1' }, consent: 'unknown', readFails: false, writeFails: false });
});

afterEach(cleanup);

describe('the question about keeping answer texts on the exam page', () => {
  it('asks once with the agreed words; «Разрешить» saves yes and says thank you', async () => {
    render(<AnswerTextConsent />);
    expect(await screen.findByText(ANSWER_TEXT_CONSENT_TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Разрешить' }));
    expect(await screen.findByRole('status')).toHaveTextContent(CONSENT_GRANTED_LINE);
    expect(mocks.write).toHaveBeenCalledWith('user-1', true);
    expect(screen.queryByRole('button', { name: 'Разрешить' })).toBeNull();
  });

  it('«Нет, спасибо» saves no: the question is not asked again', async () => {
    render(<AnswerTextConsent />);
    fireEvent.click(await screen.findByRole('button', { name: 'Нет, спасибо' }));
    expect(await screen.findByRole('status')).toHaveTextContent(CONSENT_DECLINED_LINE);
    expect(mocks.write).toHaveBeenCalledWith('user-1', false);
  });

  it('a failed save says so and keeps the question', async () => {
    mocks.writeFails = true;
    render(<AnswerTextConsent />);
    fireEvent.click(await screen.findByRole('button', { name: 'Разрешить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(CONSENT_FAILED_LINE);
    expect(screen.getByRole('button', { name: 'Разрешить' })).toBeEnabled();
  });

  it.each([
    ['answered yes before', { consent: 'granted' as const }],
    ['answered no before', { consent: 'declined' as const }],
    ['the consent cannot be read', { readFails: true }],
  ])('shows nothing when %s', async (_case, state) => {
    Object.assign(mocks, state);
    const { container } = render(<AnswerTextConsent />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith('user-1'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('a phone asks in one quiet sentence with the terms — no name, deleted in the profile — and its two choices', async () => {
    const { container } = render(<AnswerTextConsent short />);
    const ask = await screen.findByRole('region', { name: 'Тексты ответов для проверки точности' });
    expect(ask).toHaveAttribute('data-short');
    expect(ask).not.toHaveClass('ex-note');
    const text = (ask.querySelector('p')?.textContent ?? '').replace(/\u00a0/g, ' ');
    expect(text).toBe(`${CONSENT_SHORT_ASK} Разрешить Нет, спасибо`);
    expect(CONSENT_SHORT_ASK).toBe('Помогите проверить точность Meldy: разрешите сохранять текст ответов — без имени, удалить можно в профиле.');
    // No «·» glue between the choices; the computer keeps its full text.
    expect(container.textContent).not.toContain('·');
    expect(ANSWER_TEXT_CONSENT_TEXT).toBe(`${ANSWER_TEXT_CONSENT_ASK} Имя к ним не прикладывается, удалить можно в профиле.`);
    fireEvent.click(screen.getByRole('button', { name: 'Нет, спасибо' }));
    expect(await screen.findByRole('status')).toHaveTextContent(CONSENT_DECLINED_LINE);
    expect(mocks.write).toHaveBeenCalledWith('user-1', false);
  });

  it('a phone’s failed save says so and keeps the two choices', async () => {
    mocks.writeFails = true;
    render(<AnswerTextConsent short />);
    fireEvent.click(await screen.findByRole('button', { name: 'Разрешить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(CONSENT_FAILED_LINE);
    expect(screen.getByRole('button', { name: 'Разрешить' })).toBeEnabled();
  });

  it('waits for the page above it and needs an account', async () => {
    const { container, rerender } = render(<AnswerTextConsent ready={false} />);
    await waitFor(() => expect(mocks.read).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    rerender(<AnswerTextConsent ready />);
    expect(await screen.findByText(ANSWER_TEXT_CONSENT_TEXT)).toBeInTheDocument();
    cleanup();
    mocks.read.mockClear();
    mocks.user = null;
    const signedOut = render(<AnswerTextConsent />);
    expect(signedOut.container).toBeEmptyDOMElement();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
