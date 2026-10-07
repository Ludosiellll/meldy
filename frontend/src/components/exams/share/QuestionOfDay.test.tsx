import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SheetQuestion } from '../../../lib/exams/cheatSheet';
import { sha256Hex } from '../../../lib/sha256';
import { rememberGroupLink } from '../../../lib/groups/groupLinks';
import { questionOfDay, questionOfDayMessage } from '../../../lib/groups/questionOfDay';
import QuestionOfDay, { NO_LINK_NOTE } from './QuestionOfDay';

const mocks = vi.hoisted(() => ({
  rows: vi.fn(),
  fetchSheet: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../../../api/examShares', () => ({ fetchOwnShareRows: (...args: unknown[]) => mocks.rows(...args) }));
vi.mock('../../../api/cheatSheet', () => ({ fetchSheet: (...args: unknown[]) => mocks.fetchSheet(...args) }));
vi.mock('../../../lib/telemetry', () => ({ track: (...args: unknown[]) => mocks.track(...args) }));

const EXAM = 'e1d2c3b4-a596-4877-8899-aabbccddeeff';
const SHARE = '5a000000-0000-4000-8000-000000000001';
const CODE = 'k7m2pq9rst4v';
const TITLE = 'Экзамен: цифровая экономика';

function question(position: number, overrides: Partial<SheetQuestion> = {}): SheetQuestion {
  return {
    question_id: `q${position}`,
    position,
    label: String(position),
    section: null,
    text: `Вопрос номер ${position}`,
    question_hash: position.toString(16).padStart(32, '0'),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rubric: {
      rubric_id: `r${position}`,
      built_at: null,
      coverage: 'full',
      coverage_note: '',
      materials: [],
      points: [{ id: 'p1', title: 'Пункт', short: '', essential: true, source_quote: '', source_ids: [] }],
    },
    ...overrides,
  };
}

const QUESTIONS = [question(1), question(2), question(3, { coverage: 'none', rubric: null }), question(4), question(5)];
const openRow = { id: SHARE, codeHash: sha256Hex(CODE), state: 'active' as const };
const plain = (text: string | null | undefined) => (text ?? '').replace(/[\s ]+/g, ' ').trim();

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 7, 19, 0) });
  window.localStorage.clear();
  mocks.rows.mockReset().mockResolvedValue([openRow]);
  mocks.fetchSheet.mockReset().mockResolvedValue({ examId: EXAM, mappingState: 'done', questions: QUESTIONS, toWrite: 0, units: 0, unwritable: 0, job: null });
  mocks.track.mockReset();
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const today = () => questionOfDay(QUESTIONS, EXAM, '2026-10-07')!;

describe('«Скопировать вопрос дня» on «Сегодня»', () => {
  it('copies the exam, today’s question and the group link kept on this device', async () => {
    rememberGroupLink(EXAM, CODE, SHARE);
    render(<QuestionOfDay examId={EXAM} examTitle={TITLE} questions={QUESTIONS} from="today" />);
    const button = await screen.findByRole('button', { name: 'Скопировать вопрос дня' });
    expect(mocks.rows).toHaveBeenCalledWith(EXAM);
    // The page passed the sheet: it is not read again.
    expect(mocks.fetchSheet).not.toHaveBeenCalled();
    fireEvent.click(button);
    const url = `${window.location.origin}/join/${CODE}`;
    const expected = questionOfDayMessage({ title: TITLE, question: today(), url });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    expect(expected.split('\n')).toEqual([
      'Вопрос дня — «Цифровая экономика»',
      `${today().label}. ${today().text}`,
      `Ответить в Meldy: ${url}`,
    ]);
    expect(plain(screen.getByRole('status').textContent)).toBe(`Скопировано: вопрос ${today().label} и ссылка группы. Вставьте сообщение в беседу.`);
    expect(mocks.track).toHaveBeenCalledWith('group_question_copied', { from: 'today', link: true, copied: true });
    expect(screen.getByRole('button', { name: 'Скопировано' })).toBeInTheDocument();
  });

  it('never asks about a question the lectures do not answer', async () => {
    rememberGroupLink(EXAM, CODE, SHARE);
    render(<QuestionOfDay examId={EXAM} examTitle={TITLE} questions={QUESTIONS} from="today" />);
    const button = await screen.findByRole('button', { name: 'Скопировать вопрос дня' });
    for (let day = 0; day < 8; day += 1) {
      act(() => {
        vi.setSystemTime(new Date(2026, 9, 7 + day, 19, 0));
      });
      fireEvent.click(button);
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(day + 1));
      expect(writeText.mock.calls[day][0]).not.toContain('Вопрос номер 3');
    }
    // A new day, a new question: the first two days differ.
    expect(writeText.mock.calls[0][0]).not.toBe(writeText.mock.calls[1][0]);
  });

  it('copies without the link when this device does not keep its code, and says why', async () => {
    render(<QuestionOfDay examId={EXAM} examTitle={TITLE} questions={QUESTIONS} from="today" />);
    const button = await screen.findByRole('button', { name: 'Скопировать вопрос дня без ссылки' });
    const note = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(plain(note?.textContent)).toBe(NO_LINK_NOTE);
    expect(NO_LINK_NOTE).toBe(
      'Ссылки группы на этом устройстве нет: Meldy хранит только её отпечаток. Откройте ссылку из беседы здесь — и Meldy её запомнит.',
    );
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(questionOfDayMessage({ title: TITLE, question: today(), url: null })));
    expect(writeText.mock.calls[0][0]).not.toContain('/join/');
    expect(writeText.mock.calls[0][0].split('\n').pop()).toBe('Ответить можно в Meldy — в своей копии экзамена.');
    expect(mocks.track).toHaveBeenCalledWith('group_question_copied', { from: 'today', link: false, copied: true });
  });

  it('shows nothing without an open link: closed links, a classmate’s copy, an unreadable table', async () => {
    rememberGroupLink(EXAM, CODE, SHARE);
    mocks.rows.mockResolvedValue([{ ...openRow, state: 'revoked' }]);
    const { container } = render(<QuestionOfDay examId={EXAM} examTitle={TITLE} questions={QUESTIONS} from="today" />);
    await waitFor(() => expect(mocks.rows).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    cleanup();

    mocks.rows.mockResolvedValue([]);
    const copy = render(<QuestionOfDay examId={EXAM} examTitle={TITLE} from="invite" />);
    await waitFor(() => expect(mocks.rows).toHaveBeenCalledTimes(2));
    expect(copy.container).toBeEmptyDOMElement();
    expect(mocks.fetchSheet).not.toHaveBeenCalled();
    cleanup();

    mocks.rows.mockRejectedValue(new Error('offline'));
    const failed = render(<QuestionOfDay examId={EXAM} examTitle={TITLE} questions={QUESTIONS} from="today" />);
    await waitFor(() => expect(mocks.rows).toHaveBeenCalledTimes(3));
    expect(failed.container).toBeEmptyDOMElement();
  });

  it('shows nothing when no question has answer points', async () => {
    rememberGroupLink(EXAM, CODE, SHARE);
    const { container } = render(<QuestionOfDay examId={EXAM} examTitle={TITLE} questions={[question(3, { coverage: 'none', rubric: null })]} from="today" />);
    await waitFor(() => expect(mocks.rows).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the message to copy by hand when the browser does not copy', async () => {
    rememberGroupLink(EXAM, CODE, SHARE);
    writeText.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    render(<QuestionOfDay examId={EXAM} examTitle={TITLE} questions={QUESTIONS} from="today" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Скопировать вопрос дня' }));
    const field = (await screen.findByRole('textbox', { name: 'Вопрос дня для беседы группы' })) as HTMLTextAreaElement;
    expect(field.value).toBe(questionOfDayMessage({ title: TITLE, question: today(), url: `${window.location.origin}/join/${CODE}` }));
    expect(field).toHaveAttribute('readonly');
    expect(plain(screen.getByRole('status').textContent)).toBe('Не получилось скопировать: выделите текст и скопируйте его сами.');
    expect(mocks.track).toHaveBeenCalledWith('group_question_copied', { from: 'today', link: true, copied: false });
  });
});

describe('«Вопрос дня» in «Пригласить группу»', () => {
  it('reads the sheet itself and shows the message before copying it', async () => {
    rememberGroupLink(EXAM, CODE, SHARE);
    render(<QuestionOfDay examId={EXAM} examTitle={TITLE} from="invite" />);
    const field = (await screen.findByRole('textbox', { name: 'Вопрос дня для беседы группы' })) as HTMLTextAreaElement;
    expect(mocks.fetchSheet).toHaveBeenCalledWith(EXAM);
    expect(screen.getByRole('heading', { name: 'Вопрос дня' })).toBeInTheDocument();
    expect(field.value).toBe(questionOfDayMessage({ title: TITLE, question: today(), url: `${window.location.origin}/join/${CODE}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать вопрос дня' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(field.value));
    expect(await screen.findByRole('button', { name: 'Скопировано' })).toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith('group_question_copied', { from: 'invite', link: true, copied: true });
  });

  it('finds a code opened here from the chat by its hash', async () => {
    rememberGroupLink(EXAM, CODE);
    render(<QuestionOfDay examId={EXAM} examTitle={TITLE} from="invite" />);
    const field = (await screen.findByRole('textbox', { name: 'Вопрос дня для беседы группы' })) as HTMLTextAreaElement;
    expect(field.value).toContain(`/join/${CODE}`);
  });
});
