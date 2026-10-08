import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { PickerMaterial } from '../../api/exams';
import MaterialPicker, { groupBySubject, matchesQuery, type ImportStatus, type PickerFit } from './MaterialPicker';
import type { FitView } from './lectureFit';

function material(id: string, title: string, subject: string, overrides: Partial<PickerMaterial> = {}): PickerMaterial {
  return { id, title, subject, created_at: '2026-10-01T10:00:00Z', textLength: 4000, fragments: 12, textOnly: false, ...overrides };
}

const SHORT = [
  material('m1', 'Денежный рынок', 'Макроэкономика'),
  material('m2', 'Лекция 3', '', { textOnly: true }),
  material('m3', 'Скан лекции', '', { textLength: 0, fragments: 0 }),
];

const LONG = [
  material('p1', '22_Тема_4_3_Использование_ролей_пользователей', 'Программирование'),
  material('p2', 'Основы нейронных сетей', 'Программирование'),
  material('p3', 'Ёмкость алгоритмов', 'Программирование'),
  material('e1', 'Спрос и предложение', 'Экономика'),
  material('e2', 'Эластичность спроса', 'Экономика'),
  material('e3', 'Инфляция', 'экономика'),
  material('h1', 'Реформы Петра I', 'История'),
  material('h2', 'Смутное время', 'История'),
  material('h3', 'Скан учебника', 'История', { textLength: 0, fragments: 0 }),
  material('t1', 'Лекция без предмета', '', { textOnly: true }),
];

function Harness(props: { materials: PickerMaterial[]; initial?: string[]; hint?: string; fit?: PickerFit | null; onSetMany?: (ids: string[], on: boolean) => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(props.initial ?? []));
  return (
    <div className="sf-page">
      <MaterialPicker
        materials={props.materials}
        selected={selected}
        onToggle={(id) =>
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onSetMany={(ids, on) => {
          props.onSetMany?.(ids, on);
          setSelected((current) => {
            const next = new Set(current);
            for (const id of ids) {
              if (on) next.add(id);
              else next.delete(id);
            }
            return next;
          });
        }}
        hint={props.hint}
        fit={props.fit}
        onImport={() => {}}
        imports={[]}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    </div>
  );
}

const summary = () => document.querySelector('#lectures .nx-line')?.textContent?.replace(/ /g, ' ') ?? '';

afterEach(cleanup);

describe('MaterialPicker: a short list', () => {
  it('ticks and unticks every lecture with text at once, never a scan', () => {
    const onSetMany = vi.fn();
    render(<Harness materials={SHORT} initial={['m1']} onSetMany={onSetMany} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('list', { name: 'Лекции для экзамена' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }));
    expect(onSetMany).toHaveBeenLastCalledWith(['m1', 'm2'], true);
    expect(summary()).toContain('Все 2 лекции');
    expect(screen.getByRole('button', { name: 'Выбрать все' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Скан лекции/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Снять все' }));
    expect(onSetMany).toHaveBeenLastCalledWith(['m1', 'm2'], false);
    expect(summary()).toContain('Лекции не выбраны');
    expect(screen.getByRole('button', { name: 'Снять все' })).toBeDisabled();
  });

  it('keeps the list in sight, with no button to unfold it, and says why these lectures are ticked', () => {
    render(<Harness materials={SHORT} initial={['m1', 'm2']} hint="Отмечены лекции, подходящие к названию экзамена." />);
    expect(screen.getByRole('list', { name: 'Лекции для экзамена' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'изменить' })).toBeNull();
    expect(screen.getByText('Отмечены лекции, подходящие к названию экзамена.')).toBeInTheDocument();
    expect(summary()).toContain('Все 2 лекции');
  });
});

describe('MaterialPicker: a long list', () => {
  it('splits the lectures by subject with a box per subject', () => {
    render(<Harness materials={LONG} initial={['p1', 'p2', 'p3', 'e1']} />);
    const group = screen.getByRole('group', { name: 'Лекции для экзамена' });
    // «Экономика» and «экономика» are one subject; lectures without a subject get their own group.
    expect(within(group).getAllByRole('list').map((list) => list.getAttribute('aria-label'))).toEqual([
      'Программирование',
      'Экономика',
      'История',
      'Без предмета',
    ]);

    const programming = screen.getByRole('checkbox', { name: 'Все лекции: Программирование' });
    const economics = screen.getByRole('checkbox', { name: 'Все лекции: Экономика' });
    const history = screen.getByRole('checkbox', { name: 'Все лекции: История' });
    expect(programming).toBeChecked();
    expect(economics).toBePartiallyChecked();
    expect(history).not.toBeChecked();
    expect(history).not.toBePartiallyChecked();

    fireEvent.click(economics);
    expect(economics).toBeChecked();
    fireEvent.click(programming);
    expect(programming).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Основы нейронных сетей/ })).not.toBeChecked();
    // A scan in the subject does not count and is never ticked.
    fireEvent.click(history);
    expect(history).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Скан учебника/ })).not.toBeChecked();
    expect(summary()).toContain('5 из 9 лекций');
  });

  it('finds lectures by words of the title or subject and ticks only the found ones', () => {
    const onSetMany = vi.fn();
    render(<Harness materials={LONG} onSetMany={onSetMany} />);
    const search = screen.getByRole('searchbox', { name: 'Найти лекцию' });

    fireEvent.change(search, { target: { value: 'спрос' } });
    expect(screen.getByRole('status')).toHaveTextContent('нашлось 2 из 10');
    expect(screen.getByRole('checkbox', { name: /Спрос и предложение/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Эластичность спроса/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Инфляция/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать найденные' }));
    expect(onSetMany).toHaveBeenLastCalledWith(['e1', 'e2'], true);
    expect(summary()).toContain('2 из 9 лекций');

    // A subject word finds the whole subject; «е» finds «ё».
    fireEvent.change(search, { target: { value: 'емкость' } });
    expect(screen.getByRole('checkbox', { name: /Ёмкость алгоритмов/ })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'история' } });
    expect(screen.getByRole('status')).toHaveTextContent('нашлось 3 из 10');

    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Выбрать все' })).toBeInTheDocument();
  });

  it('says when nothing is found and brings the list back', () => {
    render(<Harness materials={LONG} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Найти лекцию' }), { target: { value: 'квантовая' } });
    expect(screen.getByRole('status')).toHaveTextContent('ничего не нашлось');
    expect(screen.getByText(/По «квантовая» лекций нет/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выбрать найденные' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Показать все' }));
    expect(screen.getAllByRole('checkbox', { name: /^(?!Все лекции)/ }).length).toBe(LONG.length);
  });

  it('shows readable titles instead of file names', () => {
    render(<Harness materials={LONG} />);
    expect(screen.getByText('Тема 4.3 Использование ролей пользователей')).toBeInTheDocument();
    expect(screen.queryByText(/22_Тема/)).toBeNull();
  });
});

describe('MaterialPicker helpers', () => {
  it('matches every word of the query', () => {
    expect(matchesQuery({ title: 'Основы нейронных сетей', subject: 'Программирование' }, 'нейр сет')).toBe(true);
    expect(matchesQuery({ title: 'Основы нейронных сетей', subject: 'Программирование' }, 'нейр спрос')).toBe(false);
    expect(matchesQuery({ title: 'Тема_4_3_Роли', subject: '' }, 'тема 4.3')).toBe(true);
    expect(matchesQuery({ title: 'Что угодно', subject: '' }, '   ')).toBe(true);
  });

  it('keeps the order of the list when grouping', () => {
    expect(groupBySubject(LONG).map((group) => [group.subject, group.materials.length])).toEqual([
      ['Программирование', 3],
      ['Экономика', 3],
      ['История', 3],
      ['Без предмета', 1],
    ]);
  });
});

describe('MaterialPicker: «Добавить лекции»', () => {
  const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  function renderImports(imports: ImportStatus[] = []) {
    const onImport = vi.fn();
    render(
      <MaterialPicker
        materials={SHORT}
        selected={new Set()}
        onToggle={() => {}}
        onSetMany={() => {}}
        onImport={onImport}
        imports={imports}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    return onImport;
  }

  it('takes PPTX too and says in one line what it costs and who recognises scans', () => {
    const onImport = renderImports();
    const input = screen.getByLabelText('Файлы лекций');
    expect((input.getAttribute('accept') ?? '').split(',')).toEqual(
      expect.arrayContaining(['.pdf', '.docx', '.pptx', '.txt', '.md', PPTX]),
    );
    const line = document.querySelector('.nx-import-line')?.textContent ?? '';
    expect(line).toBe(
      'Добавить лекции — только текст, без конспекта и без расхода лимита: PDF, DOCX, PPTX, TXT, MD. Сканы PDF распознаёт ИИ-сервис Google Gemini — 5 единиц лимита за каждые 15 страниц.',
    );
    expect(document.querySelector('.nx-import-line .ex-nb')?.textContent).toBe('ИИ-сервис');
    const deck = new File(['PK'], 'Лекция 4.pptx', { type: PPTX });
    fireEvent.change(input, { target: { files: [deck] } });
    expect(onImport).toHaveBeenCalledWith([deck]);
  });

  it('asks to check formulas and numbers after a scan was recognised, and only then', () => {
    renderImports([
      { key: 'a', name: 'scan.pdf', state: 'done', ocr: true },
      { key: 'b', name: 'lecture.docx', state: 'done' },
    ]);
    expect(screen.getByText('«scan.pdf» добавлена. Текст распознан со скана — сверьте формулы и числа с оригиналом.')).toBeInTheDocument();
    expect(screen.getByText('«lecture.docx» добавлена.')).toBeInTheDocument();
  });
});

describe('MaterialPicker: which lectures fit the questions', () => {
  function view(counts: Record<string, number>, unmatched: string[] = [], total = 18, notChecked = 0): FitView {
    const entries = Object.entries(counts);
    return {
      counts: new Map(entries),
      fitting: entries.map(([id]) => id),
      unmatched,
      total,
      strong: entries.some(([, count]) => count >= 2),
      notChecked,
    };
  }

  function fit(overrides: Partial<PickerFit> = {}): PickerFit {
    return { status: 'ready', view: view({ p1: 3, p2: 1, e2: 2 }, ['9', '12', '17']), ticked: false, picked: false, onPick: vi.fn(), onRetry: vi.fn(), ...overrides };
  }

  const plainText = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\u00a0/g, ' ');

  it('writes on each fitting lecture and subject how much fits, and leaves the others as they were', () => {
    render(<Harness materials={LONG} fit={fit()} />);
    const neural = screen.getByRole('checkbox', { name: /Основы нейронных сетей/ });
    // «12 фрагментов · подходит к 1 вопросу»: the dot is drawn, not read out.
    expect(plainText(neural.closest('label')?.querySelector('.nx-pick-meta'))).toBe('·12 фрагментов·подходит к 1 вопросу');
    expect(neural.closest('label')?.querySelector('.nx-pick-sep')?.getAttribute('aria-hidden')).toBe('true');
    expect(plainText(neural.closest('label')?.querySelector('.nx-pick-fit'))).toBe('подходит к 1 вопросу');
    expect(plainText(screen.getByRole('checkbox', { name: /Тема 4.3/ }).closest('label'))).toContain('подходит к 3 вопросам');
    expect(plainText(screen.getByRole('checkbox', { name: /Реформы Петра I/ }).closest('label'))).not.toContain('подходит');
    // The subject says how many of its lectures fit, and its box says it to a screen reader too.
    expect(screen.getByRole('checkbox', { name: 'Все лекции: Программирование, подходят 2 лекции' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Все лекции: Экономика, подходит 1 лекция' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Все лекции: История' })).toBeInTheDocument();
    expect(document.querySelectorAll('.nx-pick-groupfit')).toHaveLength(2);
    // Above the list: how many fit and how it is counted; under it: the questions no lecture fits.
    expect(plainText(document.querySelector('.nx-pick-fitsum'))).toBe('К вопросам списка подходят 3 лекции.');
    expect(screen.getByText(/по совпадению слов в вопросах и лекциях, без ИИ/)).toBeInTheDocument();
    expect(plainText(document.querySelector('.nx-pick-unmatched'))).toBe(
      'Без подходящей лекции: вопросы 9, 12 и 17. Если лекции по ним есть, добавьте их — иначе сверка отметит, что их нет в лекциях.',
    );
  });

  it('«Отметить подходящие (N)» stands first among the bulk actions and is off when it has nothing to do', () => {
    const onPick = vi.fn();
    const { rerender } = render(<Harness materials={LONG} fit={fit({ onPick })} />);
    const action = screen.getByRole('button', { name: 'Отметить подходящие (3)' });
    expect(Array.from(document.querySelectorAll('.nx-pick-bulk button')).map((button) => button.textContent)).toEqual([
      'Отметить подходящие (3)',
      'Выбрать все',
      'Снять все',
    ]);
    fireEvent.click(action);
    expect(onPick).toHaveBeenCalledTimes(1);
    rerender(<Harness materials={LONG} fit={fit({ onPick, picked: true })} />);
    expect(screen.getByRole('button', { name: 'Отметить подходящие (3)' })).toBeDisabled();
    // No fitting lecture: no action, and one line instead of a list of every question.
    rerender(<Harness materials={LONG} fit={fit({ view: view({}, ['1', '2'], 2) })} />);
    expect(screen.queryByRole('button', { name: /Отметить подходящие/ })).toBeNull();
    expect(plainText(document.querySelector('.nx-pick-fitsum'))).toBe('Ни одна лекция не подходит к вопросам списка.');
    expect(plainText(document.querySelector('.nx-pick-unmatched'))).toContain('Ни к одному вопросу не нашлось подходящей лекции.');
  });

  it('keeps the count on screen when the questions ticked the lectures, under the hint that says so', () => {
    render(<Harness materials={LONG} hint="Отмечены лекции, которые подходят к вопросам списка." fit={fit({ ticked: true })} />);
    expect(screen.getByText('Отмечены лекции, которые подходят к вопросам списка.')).toBeInTheDocument();
    // How many fit stays visible (live check 07.10); a screen reader also hears that they are ticked.
    expect(plainText(document.querySelector('.nx-pick-fitsum'))).toBe('К вопросам списка подходят 3 лекции. Они отмечены.');
    expect(document.querySelector('.nx-pick-fitsum .ex-sr')?.textContent).toBe(' Они отмечены.');
    expect(screen.getByText(/по совпадению слов в вопросах и лекциях/)).toBeInTheDocument();
  });

  it('says quietly that it is loading or failed, keeps an older answer, and never touches the checkboxes', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<Harness materials={LONG} initial={['p1']} fit={fit({ status: 'loading', view: null })} />);
    const live = () => document.querySelector('.nx-pick-fitnote');
    expect(live()?.getAttribute('aria-live')).toBe('polite');
    expect(live()).toHaveTextContent('Подбираем лекции к вопросам…');
    expect(document.querySelector('.nx-pick-fit')).toBeNull();
    rerender(<Harness materials={LONG} initial={['p1']} fit={fit({ status: 'error', view: null, onRetry })} />);
    expect(screen.getByText(/Не удалось подобрать лекции к вопросам/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<Harness materials={LONG} initial={['p1']} fit={fit({ status: 'error', onRetry })} />);
    expect(screen.getByText(/Подсказка не обновилась/)).toBeInTheDocument();
    expect(plainText(screen.getByRole('checkbox', { name: /Тема 4.3/ }).closest('label'))).toContain('подходит к 3 вопросам');
    rerender(<Harness materials={LONG} initial={['p1']} fit={fit({ status: 'loading' })} />);
    expect(document.querySelector('.nx-pick-fitnote')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('checkbox', { name: /Тема 4.3/ })).toBeChecked();
  });

  it('puts the fitting lectures first, and their subjects with them', () => {
    const { rerender } = render(<Harness materials={LONG} fit={fit({ view: view({ h2: 2, t1: 1 }) })} />);
    const subjects = () => within(screen.getByRole('group', { name: 'Лекции для экзамена' })).getAllByRole('list').map((list) => list.getAttribute('aria-label'));
    expect(subjects()).toEqual(['История', 'Без предмета', 'Программирование', 'Экономика']);
    const history = within(screen.getByRole('list', { name: 'История' })).getAllByRole('checkbox').map((box) => box.closest('label')?.querySelector('.nx-pick-title')?.textContent);
    expect(history).toEqual(['Смутное время', 'Реформы Петра I', 'Скан учебника']);
    // Without an answer the list keeps its own order.
    rerender(<Harness materials={LONG} fit={fit({ status: 'loading', view: null })} />);
    expect(subjects()).toEqual(['Программирование', 'Экономика', 'История', 'Без предмета']);
    // A short list without subjects: the fitting lecture goes up too.
    cleanup();
    render(<Harness materials={SHORT} fit={fit({ view: view({ m2: 1 }) })} />);
    const rows = within(screen.getByRole('list', { name: 'Лекции для экзамена' })).getAllByRole('checkbox');
    expect(plainText(rows[0].closest('label'))).toContain('Лекция 3');
  });

  it('says how many old lectures were not checked when the library has too much text', () => {
    render(<Harness materials={LONG} fit={fit({ view: view({ p1: 2 }, [], 18, 2) })} />);
    expect(screen.getByText('2 старые лекции не проверены: в библиотеке слишком много текста.')).toBeInTheDocument();
    expect(document.querySelector('.nx-pick-unmatched')).toBeNull();
  });
});

describe('MaterialPicker on a phone (10_Project/Phone_Declutter_2026-10-08)', () => {
  const PHONE_QUERY = '(max-width: 639px)';
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: query === PHONE_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }),
    });
  });
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  function view(counts: Record<string, number>, unmatched: string[] = [], total = 18): FitView {
    const entries = Object.entries(counts);
    return { counts: new Map(entries), fitting: entries.map(([id]) => id), unmatched, total, strong: entries.some(([, count]) => count >= 2), notChecked: 0 };
  }
  function fit(overrides: Partial<PickerFit> = {}): PickerFit {
    return { status: 'ready', view: view({ p1: 3, p2: 1, e2: 2 }, ['9', '12', '17']), ticked: false, picked: false, onPick: vi.fn(), onRetry: vi.fn(), ...overrides };
  }
  const plainText = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\u00a0/g, ' ');

  it('keeps one link beside the count that changes: «Выбрать все» while a lecture is unticked, then «Снять все»', () => {
    const onSetMany = vi.fn();
    render(<Harness materials={SHORT} initial={['m1']} onSetMany={onSetMany} />);
    // No row of three bulk actions; the one link stands with the count.
    expect(document.querySelector('.nx-pick-bulk')).toBeNull();
    const top = document.querySelector('.nx-pick-top');
    expect(plainText(top?.querySelector('.nx-line'))).toBe('1 из 2 лекций');
    fireEvent.click(within(top as HTMLElement).getByRole('button', { name: 'Выбрать все' }));
    expect(onSetMany).toHaveBeenLastCalledWith(['m1', 'm2'], true);
    expect(summary()).toContain('Все 2 лекции');
    expect(screen.queryByRole('button', { name: 'Выбрать все' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Снять все' }));
    expect(onSetMany).toHaveBeenLastCalledWith(['m1', 'm2'], false);
    expect(summary()).toContain('Лекции не выбраны');
    expect(screen.getByRole('button', { name: 'Выбрать все' })).toBeEnabled();
    // A scan is never ticked by it.
    expect(screen.getByRole('checkbox', { name: /Скан лекции/ })).not.toBeChecked();
  });

  it('offers «Отметить подходящие (N)» only while it changes the ticks and differs from «Выбрать все»', () => {
    const onPick = vi.fn();
    const { rerender } = render(<Harness materials={LONG} fit={fit({ onPick })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отметить подходящие (3)' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    // The ticks are the fitting lectures already: nothing to offer (a computer shows it switched off).
    rerender(<Harness materials={LONG} fit={fit({ onPick, picked: true })} />);
    expect(screen.queryByRole('button', { name: /Отметить подходящие/ })).toBeNull();
    // Every lecture with text fits: it would do what «Выбрать все» does.
    cleanup();
    render(<Harness materials={SHORT} fit={fit({ view: view({ m1: 2, m2: 1 }) })} />);
    expect(screen.queryByRole('button', { name: /Отметить подходящие/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Выбрать все' })).toBeInTheDocument();
  });

  it('says how many fit and which questions have no lecture in one line each; the rest waits behind «Подробнее»', () => {
    render(<Harness materials={LONG} fit={fit()} />);
    expect(plainText(document.querySelector('.nx-pick-fitsum'))).toBe('К вопросам списка подходят 3 лекции.');
    expect(plainText(document.querySelector('.nx-pick-unmatched'))).toBe('Без подходящей лекции: вопросы 9, 12 и 17.');
    expect(document.querySelector('.nx-pick-foot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Добавить лекции' })).toBeInTheDocument();

    const more = screen.getByRole('button', { name: 'Подробнее' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    const region = document.getElementById(more.getAttribute('aria-controls') ?? '');
    expect(region).not.toBeNull();
    expect(region).not.toBeVisible();
    expect(screen.getByText(/по совпадению слов в вопросах и лекциях, без ИИ/)).not.toBeVisible();

    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveTextContent('Свернуть');
    expect(region).toBeVisible();
    // What to do about the questions without a lecture, what the import takes and what a scan costs (the user's limit),
    // how the hint is counted, what «только текст» means.
    expect(plainText(region)).toContain('Если лекции по ним есть, добавьте их — иначе сверка отметит, что их нет в лекциях.');
    expect(plainText(region)).toContain(
      '«Добавить лекции» — только текст, без конспекта и без расхода лимита: PDF, DOCX, PPTX, TXT, MD. Сканы PDF распознаёт ИИ-сервис Google Gemini — 5 единиц лимита за каждые 15 страниц.',
    );
    expect(region?.querySelector('.ex-nb')?.textContent).toBe('ИИ-сервис');
    expect(plainText(region)).toContain('Meldy подбирает лекции по совпадению слов в вопросах и лекциях, без ИИ. Точнее покажет сверка.');
    expect(plainText(region)).toContain('«Только текст» — лекция без конспекта: для сверки с лекциями этого хватает.');
  });

  it('a search still says what it found, and the link ticks only the found lectures', () => {
    const onSetMany = vi.fn();
    render(<Harness materials={LONG} onSetMany={onSetMany} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Найти лекцию' }), { target: { value: 'спрос' } });
    expect(screen.getByRole('status')).toHaveTextContent('нашлось 2 из 10');
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать найденные' }));
    expect(onSetMany).toHaveBeenLastCalledWith(['e1', 'e2'], true);
    expect(screen.getByRole('button', { name: 'Снять найденные' })).toBeInTheDocument();
  });

  it('without lectures says in one line that the list is saved anyway', () => {
    render(<Harness materials={[]} />);
    expect(screen.getByText('Список вопросов сохранится и без них.')).toBeInTheDocument();
    expect(screen.queryByText(/не сможет отметить покрытие/)).toBeNull();
  });
});
