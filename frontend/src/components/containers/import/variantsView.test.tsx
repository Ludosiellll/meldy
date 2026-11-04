import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BankItem, BankParseResult } from '../../../types/container';
import { deriveSubjects, NO_EDITS, type ImportFile } from './importModel';
import ImportQueue from './ImportQueue';
import SubjectDetail from './SubjectDetail';
import { rowMeta } from './SubjectRows';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ').split('\u2060').join('');
const OPTIONS = ['один', 'два', 'три', 'четыре'];

function q(position: number, text: string, correct: number): BankItem {
  return {
    position, label: String(position), subject: 1, topic: null, kind: 'single', text, options: [...OPTIONS], correct: [correct],
    order: [], pairs: [], answer: null, evidence: 'bold', flags: [], code: false, where: '',
    marks: { bold: OPTIONS.map((_, index) => (index === correct ? 1 : 0)) },
  };
}

function file(index: number, items: BankItem[]): ImportFile {
  const result = {
    method: 'rules', layout: 'numbered_paragraphs', layouts_seen: {}, confidence: 1, key_source: { bold: items.length }, format_signal: 'bold',
    format_signals: {}, mark_share: 0.6, marker: null, markers: [], subjects: [{ index: 1, title: 'Сети', evidence: 'heading', items: items.length }],
    topics: [], skipped: [], warnings: [], items, variant: index,
    stats: { items: items.length, with_key: items.length, no_key: 0, ambiguous: 0, to_check: 0, duplicates: 0, kinds: {}, options: {}, gaps: [], key_lists: 0 },
  } as BankParseResult;
  return { id: `f${index}`, name: `Сети_Вариант_${index}.docx`, importId: `imp-${index}`, source: 'file', format: 'auto', keyText: '', result };
}

// 12 variants of 3 questions; «Что такое IP?» in every one, its key in variant 7 another
const FILES = Array.from({ length: 12 }, (_, at) => file(at + 1, [q(1, 'Что такое IP?', at === 6 ? 3 : 1), q(2, `Вопрос ${at + 1}.2?`, 0), q(3, `Вопрос ${at + 1}.3?`, 2)]));

afterEach(cleanup);

const handlers = () => ({
  onBack: vi.fn(), onRename: vi.fn(), onRemove: vi.fn(), onRestore: vi.fn(), onCheck: vi.fn(), onKeySource: vi.fn(), onMerge: vi.fn(),
  onFormat: vi.fn(), onSplit: vi.fn(),
});

describe('a subject made of variants on the import page', () => {
  it('the row says how many variants, the detail names the files, the repeats left out and the way back', () => {
    const [subject] = deriveSubjects(FILES);
    expect(plain(rowMeta(subject))).toBe('12 вариантов · 25 вопросов · ключ жирным');
    const props = handlers();
    render(<SubjectDetail subject={subject} phone={false} {...props} />);
    expect(screen.getByRole('heading', { name: 'Сети' })).toBeTruthy();
    expect(plain(document.body.textContent)).toContain('Варианты одного предмета: 12 файлов (Вариант 1 – Вариант 12).');
    expect(plain(document.body.textContent)).toContain('11 повторов из других вариантов не добавлены.');
    expect(plain(document.body.textContent)).toContain('В 1 вопросе варианты дают разные ответы. Проверить');
    fireEvent.click(screen.getByRole('button', { name: 'Разделить по файлам' }));
    expect(props.onSplit).toHaveBeenCalledWith(true);
  });

  it('a file of a split group offers to join the variants again', () => {
    const [merged] = deriveSubjects(FILES.slice(0, 2));
    const split = deriveSubjects(FILES.slice(0, 2), { ...NO_EDITS, split: { [merged.key]: true } });
    expect(split).toHaveLength(2);
    expect(plain(rowMeta(split[1]))).toBe('3 вопроса · ключ жирным');
    const props = handlers();
    render(<SubjectDetail subject={split[1]} phone={false} {...props} />);
    expect(plain(document.body.textContent)).toContain('Вариант 2: один из 2 файлов с вариантами одного предмета.');
    fireEvent.click(screen.getByRole('button', { name: 'Объединить варианты' }));
    expect(props.onSplit).toHaveBeenCalledWith(false);
  });

  it('the queue names the variants and their keys; a tap settles the key', () => {
    const subjects = deriveSubjects(FILES);
    const item = subjects[0].test.find((entry) => entry.text === 'Что такое IP?')!;
    const onFix = vi.fn();
    render(<ImportQueue subjects={subjects} uids={[item.uid]} index={0} onIndex={vi.fn()} onFix={onFix} onDone={vi.fn()} />);
    expect(plain(document.body.textContent)).toContain('Этот вопрос есть в нескольких вариантах, а ответы в них отмечены разные: варианты 1–6, 8–12 — Б, вариант 7 — Г.');
    expect(plain(document.body.textContent)).toContain('Сети · № 1 · Вариант 1');
    fireEvent.click(screen.getByRole('button', { name: /два/ }));
    expect(onFix).toHaveBeenCalledWith(item.uid, { correct: [1], kind: 'single', aiKey: false });
  });
});
