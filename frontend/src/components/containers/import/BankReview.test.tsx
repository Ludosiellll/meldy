import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BankItem, BankItemVersion, BankParseResult } from '../../../types/container';
import { ContainerApiError } from '../../../api/containers';
import { REVIEW } from '../copyImport';
import BankReview from './BankReview';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');

function item(position: number, patch: Partial<BankItem> = {}): BankItem {
  return {
    position,
    label: String(position),
    subject: 1,
    topic: null,
    kind: 'single',
    text: `Вопрос ${position}?`,
    options: ['один', 'два', 'три'],
    correct: [1],
    order: [],
    pairs: [],
    answer: null,
    evidence: 'bold',
    flags: [],
    code: false,
    where: '',
    marks: { bold: [0, 1, 0] },
    lines: [position * 4 - 3, position * 4],
    confidence: 1,
    doubts: [],
    ...patch,
  };
}

function bank(items: BankItem[], patch: Partial<BankParseResult> = {}): BankParseResult {
  return {
    method: 'rules', layout: 'numbered_paragraphs', layouts_seen: {}, confidence: 1, key_source: {}, format_signal: 'bold',
    format_signals: {}, mark_share: 0.6, marker: null, markers: [],
    subjects: [{ index: 1, title: null, evidence: 'none', items: items.length }], topics: [], skipped: [], warnings: [], items,
    stats: { items: items.length, with_key: 1, no_key: 1, ambiguous: 0, to_check: 1, duplicates: 0, kinds: {}, options: {}, gaps: [], key_lists: 0 },
    ...patch,
  };
}

const RESULT = bank(
  [
    item(1),
    item(2, { correct: [], evidence: '', flags: ['no_key'], confidence: 0.25, doubts: ['key', 'option_merged'], options: ['азот', 'кислород Ответ: б', 'водород'] }),
    item(3),
  ],
  {
    doubtful: 1,
    source_lines: [
      { n: 5, runs: [{ t: '2. Вопрос 2?', m: '' }], cell: null, checkbox: null, images: 0 },
      { n: 6, runs: [{ t: 'а) ', m: '' }, { t: 'азот', m: 'b' }], cell: 'T1 R2 C1', checkbox: null, images: 0 },
    ],
    ai_offer: { worth: true, reasons: ['doubtful'], questions: 3, units: 5, doubtful: 1 },
  },
);

afterEach(cleanup);

function show(runAi?: () => Promise<BankParseResult>) {
  const onDone = vi.fn();
  const onBack = vi.fn();
  render(<BankReview result={RESULT} fileName="Химия.docx" runAi={runAi} onDone={onDone} onBack={onBack} />);
  return { onDone, onBack };
}

describe('«Сомнительные места»', () => {
  it('shows the counts, only the doubtful question, why it is doubtful and the file lines with their marks', () => {
    show();
    expect(plain(screen.getByRole('status').textContent)).toBe('3 вопроса · сомнительных: 1');
    const cards = screen.getAllByRole('listitem').filter((node) => node.classList.contains('br-card'));
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(within(card).getByText(REVIEW.doubts.no_key)).toBeTruthy();
    expect(within(card).getByText(REVIEW.doubts.option_merged)).toBeTruthy();
    expect(within(card).getByText('азот', { selector: 'strong' })).toBeTruthy();
    expect(within(card).getByText('табл. 1, стр. 2, кол. 1')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(REVIEW.onlyDoubtful));
    expect(screen.getAllByRole('listitem').filter((node) => node.classList.contains('br-card'))).toHaveLength(3);
  });

  it('a press on an option sets the key, the card stays in the list as checked, and Готово hands back the fixed parse', () => {
    const { onDone } = show();
    fireEvent.click(screen.getByRole('button', { name: /водород/ }));
    expect(screen.getByRole('button', { name: /водород/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(REVIEW.checked)).toBeTruthy();
    expect(plain(screen.getByRole('status').textContent)).toBe('3 вопроса · сомнительных: 0 · проверено: 1');
    fireEvent.click(screen.getByRole('button', { name: REVIEW.undo }));
    expect(screen.getByRole('button', { name: /водород/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: REVIEW.notQuestion }));
    fireEvent.click(screen.getByRole('button', { name: REVIEW.done }));
    expect(onDone).toHaveBeenCalledTimes(1);
    const fixed = onDone.mock.calls[0][0] as BankParseResult;
    expect(fixed.items.map((entry) => entry.text)).toEqual(['Вопрос 1?', 'Вопрос 3?']);
  });

  it('offers the model pass with its price, and shows what the model read', async () => {
    const after = bank([item(1), item(2, { source: 'ai', options: ['азот', 'кислород', 'водород'], correct: [1], evidence: 'answer_line' }), item(3)], {
      ai: { chunks: 1, failed_chunks: 0, questions: 3, units: 5, found: 1, rejected_keys: 0, disagreements: 1, replaced: 1, added: 0 },
    });
    const runAi = vi.fn(async () => after);
    show(runAi);
    expect(plain(screen.getByText(/Отправим в модель/).textContent)).toBe('Отправим в модель только непонятные куски файла, 5 единиц.');
    fireEvent.click(screen.getByRole('button', { name: REVIEW.aiButton }));
    await waitFor(() => expect(screen.getByText(/Сложные места разобраны/)).toBeTruthy());
    expect(runAi).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: REVIEW.aiButton })).toBeNull();
    // the filter keeps what the model read, so the student sees it next to the file
    const cards = screen.getAllByRole('listitem').filter((node) => node.classList.contains('br-card'));
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByText(REVIEW.fromModel)).toBeTruthy();
    expect(within(cards[0]).getByText(/ключ строкой «Ответ»/)).toBeTruthy();
  });

  it('after the pass: the model’s question goes by its place in the list, next to its file lines', async () => {
    // the model named its questions by line numbers of the file («8»), and the answer of the pass left out their lines
    const after = bank([item(1), item(2, { source: 'ai', label: '8', options: ['азот', 'кислород', 'водород'], correct: [1], evidence: 'answer_line', lines: [5, 6] }), item(3)], {
      ai: { chunks: 1, failed_chunks: 0, questions: 3, units: 5, found: 1, rejected_keys: 0, disagreements: 1, replaced: 1, added: 0 },
      source_lines: [],
    });
    show(async () => after);
    fireEvent.click(screen.getByRole('button', { name: REVIEW.aiButton }));
    await waitFor(() => expect(screen.getByText(/Сложные места разобраны/)).toBeTruthy());
    const [card] = screen.getAllByRole('listitem').filter((node) => node.classList.contains('br-card'));
    expect(plain(card.querySelector('.br-num > span')?.textContent)).toBe('Вопрос 2');
    expect(within(card).queryByText(REVIEW.noFragment)).toBeNull();
    expect(within(card).getByText('азот', { selector: 'strong' })).toBeTruthy();
  });

  it('the other version says what differs: only the key, the options, or the words', () => {
    const version = (patch: Partial<BankItemVersion>): BankItemVersion => ({
      text: 'Вопрос 1?', options: ['один', 'два', 'три'], correct: [1], kind: 'single', answer: null, evidence: 'bold', source: 'ai', ...patch,
    });
    const differ = bank([
      item(1, { source: 'rules', flags: ['ai_disagrees'], correct: [0], alt: version({ correct: [2] }) }),
      item(2, { source: 'rules', flags: ['ai_disagrees'], alt: version({ text: 'Вопрос 2?', correct: [] }) }),
      item(3, { source: 'rules', flags: ['ai_disagrees'], alt: version({ text: 'Вопрос 3?', options: ['один', 'два'] }) }),
      item(4, { source: 'rules', flags: ['ai_disagrees'], alt: version({ text: 'Сколько будет 2 + 2?' }) }),
    ]);
    render(<BankReview result={differ} fileName="Химия.docx" onDone={vi.fn()} onBack={vi.fn()} />);
    const lines = [...document.querySelectorAll('.br-alt')].map((node) => plain(node.textContent));
    expect(lines).toEqual([
      'Другая версия: ключ В вместо А',
      'Другая версия: без ключа',
      'Другая версия: варианты А) один; Б) два',
      'Другая версия: «Сколько будет 2 + 2?»',
    ]);
  });

  it('a failed pass keeps the rules parse and says so in plain words', async () => {
    show(async () => {
      throw new ContainerApiError('unknown', 'Что-то пошло не так', { status: 502 });
    });
    fireEvent.click(screen.getByRole('button', { name: REVIEW.aiButton }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(REVIEW.aiFailed));
    expect(screen.getAllByRole('listitem').filter((node) => node.classList.contains('br-card'))).toHaveLength(1);
  });

  it('«Отсюда новый вопрос» on a glued block checks neither part, and the first part takes one key', () => {
    const glued = bank([
      item(1, {
        kind: 'multiple',
        text: 'Какой частью речи является слово «стол»?',
        options: ['существительное', 'глагол', 'прилагательное', '2. Какой частью речи является слово «бежать»?', 'существительное', 'глагол', 'наречие', '3. Какой частью речи является слово «красный»?', 'прилагательное', 'глагол'],
        correct: [0, 5, 8],
        evidence: 'answer_line',
        flags: ['several_marked', 'many_options'],
        marks: {},
        confidence: 0.1,
        doubts: ['structure', 'key', 'option_merged'],
      }),
    ]);
    render(<BankReview result={glued} fileName="Русский.docx" onDone={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: REVIEW.splitHere })[0]);
    expect(plain(screen.getByRole('status').textContent)).toBe('2 вопроса · сомнительных: 2');
    expect(screen.queryByText(REVIEW.checked)).toBeNull();
    const [first, second] = screen.getAllByRole('listitem').filter((node) => node.classList.contains('br-card'));
    expect(within(first).getByText(REVIEW.doubts.key_split)).toBeTruthy();
    expect(within(first).getByText(REVIEW.noAnswer)).toBeTruthy();
    expect(within(first).getByText(REVIEW.pickKey)).toBeTruthy();
    // the second part still holds the third question: it still offers the split
    expect(within(second).getByRole('button', { name: REVIEW.splitHere })).toBeTruthy();
    fireEvent.click(within(first).getByRole('button', { name: /прилагательное/ }));
    fireEvent.click(within(first).getByRole('button', { name: /глагол/ }));
    const pressed = within(first).getAllByRole('button').filter((node) => node.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((node) => node.textContent)).toEqual(['Бглагол']);
    expect(plain(within(first).getByText(/^Ответ:/).textContent)).toBe('Ответ: Б · ключ отмечен вами');
  });

  it('does not offer the pass without a way to run it, and Назад leaves without changes', () => {
    const { onBack, onDone } = show();
    expect(screen.queryByRole('button', { name: REVIEW.aiButton })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: REVIEW.back }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
