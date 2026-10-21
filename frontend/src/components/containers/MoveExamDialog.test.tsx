import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({
  fetchSummary: vi.fn(),
  moveExamDate: vi.fn(),
}));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  fetchSummary: api.fetchSummary,
  moveExamDate: api.moveExamDate,
}));

import MoveExamDialog, { addMonths, moveFacts, quickDate, type MoveExamDialogProps } from './MoveExamDialog';
import { ContainerApiError } from '../../api/containers';
import { CONTAINER, SUBJECT_DB, summary } from './testkit/fixtures';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
/** A role's name with its no-break spaces read as spaces. */
const starts = (text: string) => (name: string) => plain(name).startsWith(text);

/** Sunday, 18 October 2026: the day the owner found «Осенняя сессия» passed on the 17th. */
const TODAY = '2026-10-18';

function show(props: Partial<MoveExamDialogProps> = {}) {
  const onClose = vi.fn();
  const onMoved = vi.fn();
  const view = render(
    <MoveExamDialog
      containerId={CONTAINER}
      role="owner"
      today={TODAY}
      facts={{ members: 0, authorDate: '2026-10-17' }}
      onClose={onClose}
      onMoved={onMoved}
      {...props}
    />,
  );
  return { ...view, onClose, onMoved, dialog: () => screen.getByRole('dialog', { name: 'Перенести экзамен' }) };
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));

beforeEach(() => {
  api.fetchSummary.mockReset();
  api.moveExamDate.mockReset().mockImplementation(async (id: string, date: string | null, forWhom: string) => ({
    for: forWhom, container_id: id, exam_date: date, own_exam_date: null, subjects: [],
  }));
});
afterEach(() => cleanup());

describe('the quick dates (counted from today, not from the passed date)', () => {
  it('a week, two weeks and a month from a fixed today', () => {
    expect(quickDate('week', TODAY)).toBe('2026-10-25');
    expect(quickDate('two_weeks', TODAY)).toBe('2026-11-01');
    expect(quickDate('month', TODAY)).toBe('2026-11-18');
    // Over the year's end.
    expect(quickDate('week', '2026-12-28')).toBe('2027-01-04');
    expect(quickDate('month', '2026-12-15')).toBe('2027-01-15');
  });

  it('a month keeps the day where the month has it, else its last day', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-10-18', 12)).toBe('2027-10-18');
  });

  it('the dialog says each choice’s date and sends the chosen one', async () => {
    const { dialog, onMoved } = show();
    const when = within(dialog()).getByRole('group', { name: 'Новая дата' });
    const radios = within(when).getAllByRole('radio');
    expect(radios.map((radio) => plain(radio.closest('label')?.textContent))).toEqual([
      'Через неделю25 октября',
      'Через 2 недели1 ноября',
      'Через месяц18 ноября',
      'Своя дата',
    ]);
    expect(radios[0]).toBeChecked();
    fireEvent.click(within(when).getByRole('radio', { name: starts('Через месяц') }));
    save();
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(api.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-11-18', 'all', null);
    expect(onMoved.mock.calls[0][0]).toBe('2026-11-18');
  });
});

describe('«Своя дата»', () => {
  it('opens a date field from today to two years ahead, and says what is wrong with a date before sending', async () => {
    const { dialog } = show();
    expect(within(dialog()).queryByLabelText('Дата')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Своя дата' }));
    const field = within(dialog()).getByLabelText('Дата') as HTMLInputElement;
    expect(field.type).toBe('date');
    expect(field.min).toBe(TODAY);
    expect(field.max).toBe('2028-10-17');
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Выберите дату.');
    fireEvent.change(field, { target: { value: '2026-10-17' } });
    expect(screen.queryByRole('alert')).toBeNull();
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Выберите сегодня или дату позже.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Выберите сегодня или дату позже.');
    fireEvent.change(field, { target: { value: '2028-10-18' } });
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Можно перенести не дальше чем на два года.');
    expect(api.moveExamDate).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '2026-12-03' } });
    save();
    await waitFor(() => expect(api.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-12-03', 'all', null));
  });

  it('today itself can be the new date (the exam is today after all)', async () => {
    show();
    fireEvent.click(screen.getByRole('radio', { name: 'Своя дата' }));
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: TODAY } });
    save();
    await waitFor(() => expect(api.moveExamDate).toHaveBeenCalledWith(CONTAINER, TODAY, 'all', null));
  });
});

describe('whose date moves', () => {
  it('the author without members moves it for everyone, with no question', async () => {
    show();
    expect(screen.queryByRole('group', { name: 'Для кого' })).toBeNull();
    expect(screen.queryByText(/Это ваша дата/)).toBeNull();
    save();
    await waitFor(() => expect(api.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-10-25', 'all', null));
  });

  it('the author with members chooses «Для всех участников» (first) or «Только для меня»', async () => {
    show({ facts: { members: 2, authorDate: '2026-10-17' } });
    const who = screen.getByRole('group', { name: 'Для кого' });
    expect(within(who).getByRole('radio', { name: 'Для всех участников' })).toBeChecked();
    save();
    await waitFor(() => expect(api.moveExamDate).toHaveBeenLastCalledWith(CONTAINER, '2026-10-25', 'all', null));
    cleanup();
    show({ facts: { members: 2, authorDate: '2026-10-17' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Только для меня' }));
    save();
    await waitFor(() => expect(api.moveExamDate).toHaveBeenLastCalledWith(CONTAINER, '2026-10-25', 'me', null));
  });

  it('a member moves only their own date and is told the author’s stays', async () => {
    const { dialog } = show({ role: 'member', facts: { members: 0, authorDate: '2026-10-17' } });
    expect(screen.queryByRole('group', { name: 'Для кого' })).toBeNull();
    expect(plain(dialog().textContent)).toContain('Это ваша дата. У автора остаётся 17 октября.');
    save();
    await waitFor(() => expect(api.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-10-25', 'me', null));
    cleanup();
    show({ role: 'member', facts: { members: 0, authorDate: null } });
    expect(plain(screen.getByRole('dialog').textContent)).toContain('Это ваша дата. У автора дата не меняется.');
  });

  it('a subject’s page passes its subject', async () => {
    show({ subjectId: SUBJECT_DB });
    save();
    await waitFor(() => expect(api.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-10-25', 'all', SUBJECT_DB));
  });
});

describe('«Сегодня»: the dialog reads the exam itself', () => {
  it('a member: the author’s date from the summary (their own date stands in for the others)', async () => {
    api.fetchSummary.mockResolvedValue(summary({ role: 'member', owner: null, exam_date: '2026-10-30', own_exam_date: '2026-10-30', author_exam_date: '2026-10-17' }));
    show({ role: 'member', facts: null });
    expect(screen.getByText('Загружаем экзамен…')).toBeInTheDocument();
    expect(await screen.findByText((_, node) => node?.tagName === 'P' && plain(node.textContent) === 'Это ваша дата. У автора остаётся 17 октября.')).toBeInTheDocument();
    expect(api.fetchSummary).toHaveBeenCalledWith(CONTAINER, TODAY);
  });

  it('the author with members gets the question once the summary has come; nothing is sent before', async () => {
    let answer: (value: unknown) => void = () => undefined;
    api.fetchSummary.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    show({ facts: null });
    expect(screen.getByRole('button', { name: 'Перенести' })).toHaveAttribute('aria-disabled', 'true');
    save();
    expect(api.moveExamDate).not.toHaveBeenCalled();
    await act(async () => answer(summary({ owner: { members: 4, doubts_open: 0, links: [] } })));
    expect(screen.getByRole('group', { name: 'Для кого' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перенести' })).not.toHaveAttribute('aria-disabled');
  });

  it('a summary that cannot be read: the author moves the exam for everyone, as the page’s own date would', async () => {
    api.fetchSummary.mockRejectedValue(new ContainerApiError('network', 'Нет сети.'));
    show({ facts: null });
    await waitFor(() => expect(screen.queryByText('Загружаем экзамен…')).toBeNull());
    expect(screen.queryByRole('group', { name: 'Для кого' })).toBeNull();
    save();
    await waitFor(() => expect(api.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-10-25', 'all', null));
  });
});

describe('saving', () => {
  it('says a refusal in the dialog and lets the student try again; a second press while sending sends nothing', async () => {
    let fail: (reason: unknown) => void = () => undefined;
    api.moveExamDate.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    const { onMoved } = show();
    save();
    const button = screen.getByRole('button', { name: 'Переносим…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(api.moveExamDate).toHaveBeenCalledTimes(1);
    await act(async () => fail(new ContainerApiError('22023', 'Нужна дата не раньше сегодняшней и не дальше чем через два года.')));
    expect(screen.getByRole('alert')).toHaveTextContent('Нужна дата не раньше сегодняшней и не дальше чем через два года.');
    expect(onMoved).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(api.moveExamDate).toHaveBeenCalledTimes(2);
  });

  it('an error in other words than Russian is said in the app’s words', async () => {
    api.moveExamDate.mockRejectedValueOnce(new Error('boom'));
    show();
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Не получилось. Попробуйте ещё раз.');
  });
});

describe('a dialog to the keyboard', () => {
  it('is a modal dialog named by its title; the first choice takes the focus; Escape closes it and gives the focus back', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Перенести экзамен';
    document.body.appendChild(opener);
    opener.focus();
    const { dialog, onClose, unmount } = show();
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: starts('Через неделю') }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('names its controls: the choices as radios in groups, the date field by its label, «Закрыть» and «Перенести»', () => {
    const { dialog } = show({ facts: { members: 1, authorDate: null } });
    expect(within(dialog()).getAllByRole('radio')).toHaveLength(6);
    expect(within(dialog()).getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Перенести' })).toHaveAttribute('type', 'submit');
  });
});

describe('moveFacts', () => {
  it('the author’s members; for a member none', () => {
    expect(moveFacts(summary({ owner: { members: 3, doubts_open: 0, links: [] } })).members).toBe(3);
    expect(moveFacts(summary({ role: 'member', owner: null })).members).toBe(0);
  });

  it('the author’s date: the exam’s last, a subject’s own, or author_exam_date while the caller has an own date', () => {
    const base = summary({ exam_date: '2026-10-17' });
    const dated = { ...base, subjects: base.subjects.map((entry, index) => ({ ...entry, exam_date: index === 0 ? '2026-10-15' : '2026-10-17' })) };
    expect(moveFacts(dated).authorDate).toBe('2026-10-17');
    expect(moveFacts(dated, dated.subjects[0].id).authorDate).toBe('2026-10-15');
    const own = { ...dated, own_exam_date: '2026-11-01', author_exam_date: '2026-10-17', subjects: dated.subjects.map((entry) => ({ ...entry, exam_date: '2026-11-01' })) };
    expect(moveFacts(own, dated.subjects[0].id).authorDate).toBe('2026-10-17');
    const none = { ...summary({ exam_date: null }), subjects: [] };
    expect(moveFacts(none).authorDate).toBeNull();
  });
});
