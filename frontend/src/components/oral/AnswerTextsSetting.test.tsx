import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  consent: 'unknown' as 'granted' | 'declined' | 'unknown',
  readFails: false,
  writeFails: false,
  /** While set, saving the choice waits for it. */
  gate: null as Promise<void> | null,
  count: 0,
  write: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(async () => true),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm, alert: vi.fn() }) }));
vi.mock('react-hot-toast', () => ({ default: { success: mocks.success, error: mocks.error } }));
vi.mock('../../lib/oral/answerTexts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/oral/answerTexts')>()),
  readAnswerTextConsent: async () => {
    if (mocks.readFails) throw new Error('no table yet');
    return mocks.consent;
  },
  setAnswerTextConsent: async (userId: string, granted: boolean) => {
    mocks.write(userId, granted);
    if (mocks.gate) await mocks.gate;
    if (mocks.writeFails) throw new Error('not saved');
  },
  countAnswerTexts: async () => mocks.count,
  deleteAnswerTexts: async (userId: string) => mocks.remove(userId),
  onAnswerTextConsent: () => () => undefined,
}));

import AnswerTextsSetting, { CHOICE_FAILED_TOAST, TEXTS_DELETED_TOAST, TEXTS_OFF_TOAST, TEXTS_ON_TOAST } from './AnswerTextsSetting';
import { ANSWER_TEXT_CONSENT_ASK, ANSWER_TEXT_CONSENT_TEXT, ANSWER_TEXT_PROFILE_TEXT } from '../../lib/oral/answerTexts';

beforeEach(() => {
  Object.assign(mocks, { consent: 'unknown', readFails: false, writeFails: false, gate: null, count: 0 });
  mocks.confirm.mockResolvedValue(true);
});

afterEach(cleanup);

describe('«Профиль»: keeping the texts of answers', () => {
  it('is off until the student says yes, and the switch says yes', async () => {
    render(<AnswerTextsSetting />);
    const toggle = await screen.findByRole('switch', { name: 'Сохранять текст ответов' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(toggle).toHaveTextContent('Выключено');
    expect(screen.getByText(ANSWER_TEXT_PROFILE_TEXT)).toBeInTheDocument();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(mocks.write).toHaveBeenCalledWith('user-1', true);
    expect(mocks.success).toHaveBeenCalledWith(TEXTS_ON_TOAST);
  });

  it('switches a yes off', async () => {
    mocks.consent = 'granted';
    render(<AnswerTextsSetting />);
    const toggle = await screen.findByRole('switch', { name: 'Сохранять текст ответов' });
    await waitFor(() => expect(toggle).toHaveTextContent('Включено'));
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(mocks.write).toHaveBeenCalledWith('user-1', false);
    expect(mocks.success).toHaveBeenCalledWith(TEXTS_OFF_TOAST);
  });

  it('a failed switch says so and stays as it was', async () => {
    mocks.writeFails = true;
    render(<AnswerTextsSetting />);
    const toggle = await screen.findByRole('switch', { name: 'Сохранять текст ответов' });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(CHOICE_FAILED_TOAST));
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('deletes the kept texts after the student confirms', async () => {
    mocks.count = 3;
    render(<AnswerTextsSetting />);
    expect(await screen.findByText('Сохранено текстов ответов: 3.')).toBeInTheDocument();
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('user-1'));
    await waitFor(() => expect(screen.queryByText('Сохранено текстов ответов: 3.')).toBeNull());
    expect(mocks.success).toHaveBeenCalledWith(TEXTS_DELETED_TOAST);
  });

  it('off looks like a state, not the page’s main action: a switch track and a word, no blue pill', async () => {
    render(<AnswerTextsSetting />);
    const toggle = await screen.findByRole('switch', { name: 'Сохранять текст ответов' });
    await waitFor(() => expect(toggle).toBeEnabled());
    // QA 2026-10-07: the blue pill «Выключено» read as the primary action.
    expect(toggle).toHaveClass('ac-switch');
    expect(toggle.className).not.toMatch(/ac-btn/);
    expect(toggle.querySelector('.ac-switch-box')).toHaveAttribute('aria-hidden', 'true');
    expect(toggle.querySelector('.ac-switch-state')).toHaveTextContent('Выключено');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(toggle.querySelector('.ac-switch-state')).toHaveTextContent('Включено');
    expect(toggle.className).not.toMatch(/ac-btn/);
  });

  it('keeps the keyboard focus while the choice is saved, so the switch can be pressed again', async () => {
    let release: () => void = () => undefined;
    mocks.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(<AnswerTextsSetting />);
    const toggle = await screen.findByRole('switch', { name: 'Сохранять текст ответов' });
    await waitFor(() => expect(toggle).toBeEnabled());
    toggle.focus();
    fireEvent.click(toggle);
    // Saving: aria-disabled, not disabled — a disabled button dropped the focus to the page.
    await waitFor(() => expect(toggle).toHaveAttribute('aria-disabled', 'true'));
    expect(toggle).toBeEnabled();
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle); // pressed again while saving: waits, no second write
    expect(mocks.write).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(toggle).not.toHaveAttribute('aria-disabled');
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(mocks.write).toHaveBeenLastCalledWith('user-1', false);
  });

  it('says the kept texts are deleted right here, not «в профиле» — the student is in the profile', async () => {
    mocks.count = 2;
    const { container } = render(<AnswerTextsSetting />);
    expect(await screen.findByText('Сохранено текстов ответов: 2.')).toBeInTheDocument();
    const description = (container.querySelector('#profile-answers-switch + .ac-row-d')?.textContent ?? '').replace(/\u00a0/g, ' ');
    expect(description).toBe(ANSWER_TEXT_PROFILE_TEXT);
    expect(description).toBe(
      'Помогите проверить точность Meldy: разрешите сохранять текст ваших ответов. Имя к ним не прикладывается, удалить их можно здесь.',
    );
    expect(description).not.toContain('в профиле');
    // The request is the consent the exam page asks, word for word; only where to delete differs.
    expect(ANSWER_TEXT_CONSENT_TEXT.startsWith(`${ANSWER_TEXT_CONSENT_ASK} `)).toBe(true);
    expect(ANSWER_TEXT_PROFILE_TEXT.startsWith(`${ANSWER_TEXT_CONSENT_ASK} `)).toBe(true);
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
  });

  it('is not shown when the consent cannot be read', async () => {
    mocks.readFails = true;
    const { container } = render(<AnswerTextsSetting />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
