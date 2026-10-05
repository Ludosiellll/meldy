import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { PickerMaterial } from '../../api/exams';
import MaterialPicker, { groupBySubject, matchesQuery, type ImportStatus } from './MaterialPicker';

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

function Harness(props: { materials: PickerMaterial[]; initial?: string[]; hint?: string; onSetMany?: (ids: string[], on: boolean) => void }) {
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
