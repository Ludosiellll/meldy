import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BankItem, BankParseResult } from '../../../types/container';
import { deriveSubjects, NO_EDITS, type ImportEdits, type ImportFile } from './importModel';
import { AiKeysCheck, AiKeysOffer, AiKeysStatus } from './AiKeys';
import ImportQueue from './ImportQueue';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');

function q(position: number): BankItem {
  return {
    position, label: String(position), subject: 1, topic: null, kind: 'single', text: `Вопрос ${position}?`, options: ['один', 'два', 'три'],
    correct: [], order: [], pairs: [], answer: null, evidence: '', flags: ['no_key'], code: false, where: '', marks: {},
  };
}
const FILE: ImportFile = {
  id: 'f1', name: 'Сети.docx', importId: 'imp-1', source: 'file', format: 'auto', keyText: '',
  result: {
    method: 'rules', layout: 'numbered_paragraphs', layouts_seen: {}, confidence: 1, key_source: {}, format_signal: null, format_signals: {},
    mark_share: 0.6, marker: null, markers: [], subjects: [{ index: 1, title: 'Сети', evidence: 'heading', items: 2 }], topics: [], skipped: [],
    warnings: [], items: [q(1), q(2)],
    stats: { items: 2, with_key: 0, no_key: 2, ambiguous: 0, to_check: 2, duplicates: 0, kinds: {}, options: {}, gaps: [], key_lists: 0 },
  } as BankParseResult,
};
const AI: ImportEdits = { ...NO_EDITS, items: { 'f1:1': { correct: [2], kind: 'single', aiKey: true, aiOk: false } } };

afterEach(cleanup);

describe('«Подобрать ключи с ИИ» on the page', () => {
  it('the button says how many questions go and what it costs; the run says what came of it', () => {
    const onRun = vi.fn();
    render(<AiKeysOffer count={25} cost={5} busy={false} onRun={onRun} />);
    expect(plain(document.body.textContent)).toContain('Подобрать ключи с ИИ 25 вопросов без ключа · 5 единиц');
    expect(document.body.textContent).toContain('Ключ ставим, только если ИИ дважды ответил одинаково и уверенно.');
    fireEvent.click(screen.getByRole('button', { name: 'Подобрать ключи с ИИ' }));
    expect(onRun).toHaveBeenCalled();
    cleanup();

    render(<AiKeysStatus run={{ status: 'running', scope: null, done: 25, total: 60, outcome: null, error: null }} />);
    expect(plain(screen.getByRole('status').textContent)).toBe('ИИ подбирает ключи: 25 из 60. Можно проверять остальные вопросы.');
    cleanup();

    const outcome = { sent: 25, keyed: 18, notes: { 'ИИ не уверен': 4, 'ответы ИИ разошлись': 3 }, units: 5, error: null };
    render(<AiKeysStatus run={{ status: 'done', scope: null, done: 25, total: 25, outcome, error: null }} />);
    expect(plain(screen.getByRole('status').textContent)).toBe(
      'Ключи подобраны для 18 из 25 вопросов. Без ключа остались 7: ИИ не уверен — 4, ответы ИИ разошлись — 3. Списано 5 единиц.',
    );
    cleanup();

    render(<AiKeysStatus run={{ status: 'failed', scope: null, done: 0, total: 25, outcome: { ...outcome, sent: 0, keyed: 0, notes: {}, units: 0 }, error: 'ИИ сейчас занят. Попробуйте подобрать ключи через минуту.' }} />);
    expect(screen.getByRole('alert').textContent).toBe('ИИ сейчас занят. Попробуйте подобрать ключи через минуту.');
    cleanup();

    const onOpen = vi.fn();
    render(<AiKeysCheck count={18} busy={false} label="Проверить" onOpen={onOpen} />);
    expect(plain(document.body.textContent)).toContain('Проверьте ключи от ИИ (18).');
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('the queue labels the AI key; «Ключ верный» accepts it, another option changes it, its own option accepts it', () => {
    const subjects = deriveSubjects([FILE], AI);
    const onFix = vi.fn();
    render(<ImportQueue subjects={subjects} uids={['f1:1']} index={0} onIndex={vi.fn()} onFix={onFix} onDone={vi.fn()} />);
    expect(document.body.textContent).toContain('Ключ подобран ИИ, не из файла. Если он верный, нажмите «Ключ верный». Если нет — нажмите верный вариант.');
    fireEvent.click(screen.getByRole('button', { name: 'Ключ верный' }));
    expect(onFix).toHaveBeenLastCalledWith('f1:1', { aiOk: true });
    fireEvent.click(screen.getByRole('button', { name: /один/ }));
    expect(onFix).toHaveBeenLastCalledWith('f1:1', { correct: [0], kind: 'single', aiKey: false });
    fireEvent.click(screen.getByRole('button', { name: /три/ }));
    expect(onFix).toHaveBeenLastCalledWith('f1:1', { aiOk: true });
  });
});
