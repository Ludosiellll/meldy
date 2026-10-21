/** Parses of pasted text for the quick test's tests: the shape POST /api/tests/paste answers (backend/paste_api.py). */
import type { BankItem, BankParseResult } from '../../types/container';

export function bankItem(partial: Partial<BankItem> & Pick<BankItem, 'text'>): BankItem {
  return {
    position: 1,
    label: '',
    subject: 1,
    topic: null,
    kind: partial.options && partial.options.length > 0 ? 'single' : 'open',
    options: [],
    correct: [],
    order: [],
    pairs: [],
    answer: null,
    evidence: partial.correct && partial.correct.length > 0 ? 'marker' : '',
    flags: partial.correct && partial.correct.length > 0 ? [] : partial.options && partial.options.length > 0 ? ['no_key'] : [],
    code: false,
    where: '',
    marks: {},
    ...partial,
  };
}

export function bankResult(items: BankItem[], skipped: string[] = []): BankParseResult {
  return {
    method: 'rules',
    layout: 'numbered_paragraphs',
    layouts_seen: {},
    confidence: 1,
    key_source: {},
    format_signal: null,
    format_signals: {},
    mark_share: 0,
    marker: null,
    markers: [],
    subjects: [{ index: 1, title: null, evidence: 'none', items: items.length }],
    topics: [],
    skipped,
    warnings: [],
    items: items.map((item, at) => ({ ...item, position: at + 1, label: item.label || String(at + 1) })),
    stats: { items: items.length, with_key: 0, no_key: 0, ambiguous: 0, to_check: 0, duplicates: 0, kinds: {}, options: {}, gaps: [], key_lists: 0 },
  };
}

/** The mockup's chemistry test: a starred variant, an answer line, a short answer and a question without its answer. */
export const CHEMISTRY = bankResult(
  [
    bankItem({ text: 'Какой индикатор краснеет в кислой среде?', options: ['фенолфталеин', 'лакмус', 'метилоранж'], correct: [1] }),
    bankItem({ text: 'Формула серной кислоты?', options: ['HCl', 'H2SO4', 'HNO3'], correct: [1], evidence: 'answer_line' }),
    bankItem({ text: 'Сколько атомов водорода в молекуле воды?', answer: '2', evidence: 'answer_line' }),
    bankItem({ text: 'Какая кислота есть в желудке?', options: ['соляная', 'уксусная', 'лимонная'] }),
  ],
  ['Удачи!'],
);
