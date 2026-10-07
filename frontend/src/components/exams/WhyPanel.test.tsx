import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ExamQuestion } from '../../api/exams';
import type { LearningEvent } from '../../api/learning';
import WhyPanel, { attemptLabel, nearestSentence, readinessLine, unverifiedLead, type WhyPanelProps } from './WhyPanel';
import { questionState } from '../../lib/learning/readiness';
import type { SheetCoverage } from './marks';

const EXCERPT = 'Потребитель делает выбор между наборами благ, сравнивая их полезность при заданном бюджете.';

function question(overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  return {
    id: 'q17',
    exam_id: 'exam-1',
    position: 17,
    label: '17',
    section: 2,
    text: 'Выбор в условиях неопределённости. Отношение к риску.',
    question_hash: 'a'.repeat(32),
    coverage: 'none',
    coverage_method: 'llm',
    coverage_reason: 'Во фрагментах нет выбора при риске',
    missing_note: '',
    evidence: [],
    nearest: [{ material_id: 'm3', material_title: 'Поведение потребителя', source_id: 'S12', excerpt: EXCERPT, matched: ['выбор'] }],
    materials_fingerprint: 'fp',
    mapping_version: 1,
    mapped_at: '2026-10-03T06:40:00Z',
    created_at: '2026-10-01T06:40:00Z',
    ...overrides,
  };
}

function answer(id: string, day: string, grade: number, session: string | null): LearningEvent {
  return {
    id,
    created_at: `${day}T10:00:00Z`,
    local_date: day,
    material_id: null,
    kind: 'exam_answer',
    item_key: `q:${'a'.repeat(32)}`,
    correct: grade >= 4,
    score: grade / 5,
    confidence: null,
    source_ids: [],
    session_id: session,
    payload: { grade },
  };
}

/** Accessible names keep the no-break spaces of Russian typesetting; compare them as plain spaces. */
const named = (text: string) => (name: string) => name.replace(/\u00a0/g, ' ') === text;

function renderPanel(overrides: Partial<WhyPanelProps> = {}, coverage: SheetCoverage = 'none') {
  const props: WhyPanelProps = {
    examId: 'exam-1',
    question: question(),
    number: '17',
    coverage,
    lectureCount: 9,
    examMaterialIds: new Set(['m1', 'm3']),
    answers: [],
    answersError: null,
    variant: 'column',
    headingId: 'why-title',
    onClose: vi.fn(),
    onManualMark: vi.fn(),
    manualPending: false,
    manualError: null,
    onRecheck: null,
    ...overrides,
  };
  render(
    <MemoryRouter>
      <WhyPanel {...props} />
    </MemoryRouter>,
  );
  return props;
}

afterEach(() => {
  cleanup();
});

describe('WhyPanel: a question that is not in the lectures', () => {
  it('names the gap, the nearest fragment and the word that matched, and offers the manual mark', () => {
    const props = renderPanel();
    expect(screen.getByRole('heading', { name: named('Ни в одной из 9 лекций нет фрагмента об этом') })).toBeInTheDocument();
    expect(screen.getByText(/Ближе всего — «Поведение потребителя», фрагмент.12: совпало только слово «выбор»/)).toBeInTheDocument();
    expect(screen.getByText(/Лекция «Поведение потребителя», фрагмент.12/)).toBeInTheDocument();
    expect(screen.getByText('выбор')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Добавить материал к вопросу' })).toHaveAttribute('href', '/exams/exam-1/edit#lectures');
    expect(screen.queryByRole('link', { name: 'Ответить на этот вопрос' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Это есть в лекции…' }));
    expect(props.onManualMark).toHaveBeenCalledTimes(1);
  });

  it('says when no fragment shares a word with the question', () => {
    renderPanel({ question: question({ coverage_method: 'lexical', coverage_reason: 'Ни одного фрагмента с этими словами', nearest: [] }) });
    expect(screen.getByRole('heading', { name: named('Ни в одной из 9 лекций нет фрагмента с этими словами') })).toBeInTheDocument();
    expect(screen.getByText('Похожих фрагментов не нашлось.')).toBeInTheDocument();
  });

  it('explains a «yes» without a valid fragment', () => {
    renderPanel({ question: question({ coverage_reason: 'Нет подтверждающего фрагмента' }) });
    expect(screen.getByRole('heading', { name: named('Нет фрагмента, который подтверждает ответ') })).toBeInTheDocument();
    expect(screen.getByText(/без ссылки на конкретный фрагмент вопрос не считается найденным/)).toBeInTheDocument();
  });

  it('says «В лекции» when there is only one («ни в одной из 1 лекции» is not Russian)', () => {
    renderPanel({ lectureCount: 1 });
    expect(screen.getByRole('heading', { name: named('В лекции нет фрагмента об этом') })).toBeInTheDocument();
  });

  it('shows a failed manual mark', () => {
    renderPanel({ manualError: 'Отметка не сохранена. Проверьте связь и повторите.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Отметка не сохранена');
  });
});

describe('WhyPanel: a question that is in the lectures', () => {
  const evidence = [
    { material_id: 'm1', material_title: 'Денежный рынок', source_id: 'S14', excerpt: 'Инфляция — это устойчивый рост общего уровня цен.' },
    { material_id: 'm9', material_title: 'Старая лекция', source_id: 'S03', excerpt: 'Фрагмент из лекции, которую убрали.' },
  ];

  it('shows the verdict, the whole fragment with its lecture and number, and what to do next', () => {
    renderPanel(
      { question: question({ id: 'q7', coverage: 'full', coverage_reason: 'Во фрагменте есть определение и виды', evidence, nearest: [] }) },
      'full',
    );
    expect(screen.getByRole('heading', { name: named('Есть в ваших лекциях') })).toBeInTheDocument();
    expect(screen.getByText('Во фрагменте есть определение и виды')).toBeInTheDocument();
    expect(screen.getByText(/Лекция «Денежный рынок», фрагмент.14/)).toBeInTheDocument();
    expect(screen.getByText('Инфляция — это устойчивый рост общего уровня цен.')).toBeInTheDocument();
    expect(screen.getByText(/Лекция «Старая лекция», фрагмент.3 — лекция убрана из экзамена/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Открыть материал' })[0]).toHaveAttribute('href', '/library/m1');
    expect(screen.getByRole('link', { name: 'Ответить на этот вопрос' })).toHaveAttribute('href', '/exams/exam-1/ticket?q=q7');
    expect(screen.getByRole('link', { name: 'Повторить карточки этой лекции' })).toHaveAttribute('href', '/review?material=m1');
    expect(screen.queryByRole('button', { name: 'Это есть в лекции…' })).toBeNull();
  });

  it('names what is missing for a partial question', () => {
    renderPanel(
      { question: question({ coverage: 'partial', coverage_reason: 'Есть определение', missing_note: 'нет классификации видов инфляции', evidence: evidence.slice(0, 1), nearest: [] }) },
      'partial',
    );
    expect(screen.getByRole('heading', { name: named('Есть частично') })).toBeInTheDocument();
    expect(screen.getByText('Не хватает: нет классификации видов инфляции')).toBeInTheDocument();
  });

  it('says «Отмечено вами» for a manual mark', () => {
    renderPanel({ question: question({ coverage: 'full', coverage_method: 'manual', coverage_reason: 'Отмечено вами', evidence: [], nearest: [] }) }, 'full');
    expect(screen.getByRole('heading', { name: named('Отмечено вами') })).toBeInTheDocument();
    expect(screen.getByText(/Meldy этого не проверял/)).toBeInTheDocument();
  });

  it('offers «Проверить снова» for a question checked only by words', () => {
    const onRecheck = vi.fn();
    renderPanel({ question: question({ coverage: 'unverified', coverage_method: 'lexical' }), onRecheck }, 'unverified');
    expect(screen.getByRole('heading', { name: named('Проверено только по словам') })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it('says why a question was checked only by words, in the server\'s own words', () => {
    // The reasons exams_map.py stores for a question the model did not judge.
    const cases: Array<[string | null, string]> = [
      ['Проверено только по словам: сервис ИИ был занят', 'Сервис ИИ был занят, поэтому вопрос сопоставлен с лекциями только по совпадению слов.'],
      ['Проверено только по словам: сервис ИИ не ответил вовремя', 'Сервис ИИ не ответил вовремя, поэтому вопрос сопоставлен с лекциями только по совпадению слов.'],
      [
        'Проверено только по словам: модель не вернула ответ по этому вопросу',
        'Модель не вернула ответ по этому вопросу, поэтому вопрос сопоставлен с лекциями только по совпадению слов.',
      ],
      [
        'Проверено только по словам: модель не подтвердила ответ цитатой из лекции',
        'Модель не подтвердила ответ цитатой из лекции, поэтому вопрос сопоставлен с лекциями только по совпадению слов.',
      ],
      [null, 'Модель этот вопрос не проверила: он сопоставлен с лекциями только по совпадению слов.'],
      ['что-то старое', 'Модель этот вопрос не проверила: он сопоставлен с лекциями только по совпадению слов.'],
    ];
    for (const [reason, lead] of cases) expect(unverifiedLead(reason)).toBe(lead);
    renderPanel(
      {
        question: question({
          coverage: 'unverified',
          coverage_method: 'lexical',
          coverage_reason: 'Проверено только по словам: модель не подтвердила ответ цитатой из лекции',
        }),
        onRecheck: vi.fn(),
      },
      'unverified',
    );
    expect(screen.getByText(/^Модель не подтвердила ответ цитатой из лекции, поэтому/)).toBeInTheDocument();
    expect(screen.queryByText(/был занят/)).toBeNull();
  });

  it('keeps the lecture heading of a fragment on its own line', () => {
    const excerpt = 'Обучение нейронной сети\nОбучение сети заключается в подборе весов, минимизирующих функцию потерь.';
    renderPanel({ question: question({ coverage: 'full', evidence: [{ material_id: 'm1', material_title: 'Лекция', source_id: 'S08', excerpt }], nearest: [] }) }, 'full');
    const heading = document.querySelector('[data-fragment-heading]');
    expect(heading).toHaveTextContent('Обучение нейронной сети');
    expect(heading?.closest('blockquote')).toHaveTextContent(/Обучение нейронной сети\s*Обучение сети заключается/);
  });

  it('cuts a long fragment at 600 characters and opens it whole on demand', () => {
    const long = `${'Слово '.repeat(150)}конец.`;
    renderPanel({ question: question({ coverage: 'full', evidence: [{ material_id: 'm1', material_title: 'Лекция', source_id: 'S01', excerpt: long }], nearest: [] }) }, 'full');
    expect(screen.queryByText(/конец\./)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Показать фрагмент целиком' }));
    expect(screen.getByText(/конец\./)).toBeInTheDocument();
  });
});

/** The live run of 07.10, Q6 «Ограничения целостности»: 849 characters, the answer near the end. */
const Q6_EXCERPT =
  'составлен из этих внешних ключей. Связь M:N тем самым распадается на две связи 1:N: «студент — его оценки» и «дисциплина — оценки по ней». В связующее отношение естественно помещаются атрибуты самой связи: дата экзамена, оценка. Кроме вида, у связи есть обязательность. Если каждый студент обязан состоять в группе, связь со стороны студента обязательная, и внешний ключ объявляют NOT NULL. Если у дисциплины может не быть закреплённого преподавателя, связь необязательная, и внешний ключ допускает NULL. 7. Ограничения целостности Ограничения целостности — правила, которым должны удовлетворять данные в любой момент времени. СУБД проверяет их сама при каждой вставке, изменении и удалении и отклоняет операцию, которая их нарушает. Различают: 1. Целостность сущностей — у каждого отношения есть первичный ключ, его значения уникальны и не содержат';
const Q6_QUOTE = 'Ограничения целостности — правила, которым должны удовлетворять данные в любой момент времени';

describe('WhyPanel: why a question is in the lectures', () => {
  const q6 = (focus?: [number, number]) => [
    {
      material_id: 'm1',
      material_title: 'Реляционная модель данных: ключи и связи',
      source_id: 'S15',
      excerpt: Q6_EXCERPT,
      ...(focus ? { focus } : {}),
    },
  ];
  const blockquote = () => document.querySelector('blockquote') as HTMLElement;

  it('says nothing under «Есть в ваших лекциях» when the reason is a general verdict', () => {
    for (const reason of ['Вопрос полностью раскрыт в приложенных фрагментах.', 'Ответ есть во фрагментах лекций', 'Материалы содержат исчерпывающий ответ на вопрос.']) {
      renderPanel({ question: question({ coverage: 'full', coverage_reason: reason, evidence: q6(), nearest: [] }) }, 'full');
      expect(screen.queryByText(reason)).toBeNull();
      expect(document.querySelectorAll('.ex-why > .ex-stmt')).toHaveLength(0);
      cleanup();
    }
    renderPanel(
      { question: question({ coverage: 'partial', coverage_reason: 'Во фрагментах лекций есть часть ответа', missing_note: 'примеров', evidence: q6(), nearest: [] }) },
      'partial',
    );
    expect(screen.queryByText('Во фрагментах лекций есть часть ответа')).toBeNull();
    expect(screen.getByText('Не хватает: примеров')).toBeInTheDocument();
    cleanup();
    renderPanel({ question: question({ coverage: 'full', coverage_reason: 'Свойства ACID полностью описаны в тексте', evidence: q6(), nearest: [] }) }, 'full');
    expect(screen.getByText('Свойства ACID полностью описаны в тексте')).toBeInTheDocument();
  });

  it('opens a long fragment around the verified quote and underlines it, not at the start', () => {
    renderPanel({ question: question({ coverage: 'full', coverage_reason: '', evidence: q6([532, 625]), nearest: [] }) }, 'full');
    const quote = blockquote();
    expect(quote.textContent).toMatch(/^…Если каждый студент обязан/);
    expect(quote.textContent).toContain('7. Ограничения целостности');
    expect(quote.textContent).not.toContain('составлен из этих внешних ключей');
    // The words of the quote are underlined in pencil (a mark, not a highlighter); screen readers hear what it is.
    const underlined = quote.querySelector('.sf-under.ex-focus') as HTMLElement;
    expect(underlined.textContent).toBe(Q6_QUOTE);
    expect(quote.querySelector('.ex-sr')).toHaveTextContent('Место ответа:');
    expect(quote.querySelector('mark')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Показать фрагмент целиком' }));
    expect(blockquote().textContent).toMatch(/^составлен из этих внешних ключей/);
    expect((blockquote().querySelector('.sf-under.ex-focus') as HTMLElement).textContent).toBe(Q6_QUOTE);
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть фрагмент' }));
    expect(blockquote().textContent).toMatch(/^…Если/);
  });

  it('shows a row mapped before the place was stored as before: from the start, cut at 600 characters', () => {
    renderPanel({ question: question({ coverage: 'full', coverage_reason: '', evidence: q6(), nearest: [] }) }, 'full');
    const quote = blockquote();
    expect(quote.textContent).toMatch(/^составлен из этих внешних ключей/);
    expect(quote.textContent?.endsWith('…')).toBe(true);
    expect(quote.querySelector('.ex-focus')).toBeNull();
  });

  it('marks nothing when the quote is the whole fragment, and reads a table row with dashes', () => {
    const excerpt = 'READ COMMITTED | нет | возможно | возможно';
    renderPanel(
      { question: question({ coverage: 'full', evidence: [{ material_id: 'm1', material_title: 'Транзакции', source_id: 'S20', excerpt, focus: [0, excerpt.length] }], nearest: [] }) },
      'full',
    );
    expect(blockquote()).toHaveTextContent('READ COMMITTED — нет — возможно — возможно');
    expect(blockquote().querySelector('.ex-focus')).toBeNull();
  });
});

describe('WhyPanel: answers', () => {
  /** An answer at 10:00 local time (the label shows the local moment). */
  const local = (id: string, day: string, grade: number, session: string | null): LearningEvent => {
    const [y, m, d] = day.split('-').map(Number);
    return { ...answer(id, day, grade, session), created_at: new Date(y, m - 1, d, 10, 0).toISOString() };
  };

  it('lists every attempt with its moment and whether it named enough, newest first, each opening its protocol (no grade, Ф1)', () => {
    renderPanel({
      question: question({ coverage: 'full', evidence: [], nearest: [] }),
      coverage: 'full',
      answers: [local('e1', '2026-09-29', 4, 'session-1'), local('e2', '2026-10-07', 3, 'session-2'), local('e3', '2026-10-08', 5, null)],
    });
    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      '8 окт., 10:00 · названо достаточно',
      '7 окт., 10:00 · названо недостаточно',
      '29 сент., 10:00 · названо достаточно',
    ]);
    expect(within(list).getByRole('link', { name: '7 окт., 10:00 · названо недостаточно' })).toHaveAttribute('href', '/exams/exam-1/ticket?session=session-2');
    expect(within(list).getByRole('link', { name: '29 сент., 10:00 · названо достаточно' })).toHaveAttribute('href', '/exams/exam-1/ticket?session=session-1');
    expect(within(list).queryByRole('link', { name: '8 окт., 10:00 · названо достаточно' })).toBeNull();
    expect(list.textContent).not.toMatch(/отлично|хорошо|удовлетвор|[2-5] ·|засчит/);
  });

  it('says when the history could not be read', () => {
    renderPanel({ answersError: 'Не удалось загрузить историю ответов. Повторите попытку.' });
    expect(screen.getByText('Не удалось загрузить историю ответов. Повторите попытку.')).toBeInTheDocument();
  });

  it('formats an attempt without a verdict honestly: its moment only, or its day', () => {
    expect(attemptLabel({ ...local('e9', '2026-10-07', 4, 's'), correct: null, payload: {} })).toBe('7 окт., 10:00');
    expect(attemptLabel({ ...answer('e9', '2026-10-07', 4, 's'), created_at: 'not a date', correct: null })).toBe('7 окт.');
  });
});

describe('WhyPanel: where the question stands by the rule «подтверждено»', () => {
  const NOW = new Date(2026, 9, 5, 12, 0);
  /** An answer at a local wall-clock time. */
  function at(day: string, hh: number, mm: number, grade: number, id = `${day}-${hh}`): LearningEvent {
    const [y, m, d] = day.split('-').map(Number);
    return { ...answer(id, day, grade, `s-${id}`), created_at: new Date(y, m - 1, d, hh, mm).toISOString() };
  }
  const plain = (text: string | null) => (text ?? '').replace(/[\u00a0\u202f]/g, ' ');
  const line = (answers: LearningEvent[], now = NOW) => plain(readinessLine(questionState(answers, [], now), answers, now));

  it('dates a confirmation by the last passed answer, the moment the 14-day rule counts from', () => {
    const answers = [at('2026-09-29', 14, 2, 4), at('2026-10-01', 9, 0, 5), at('2026-10-03', 10, 0, 4)];
    expect(line(answers)).toBe('Подтверждено 3 октября — 2 дня назад.');
    expect(line(answers, new Date(2026, 9, 3, 18, 0))).toBe('Подтверждено сегодня.');
    expect(line(answers, new Date(2026, 9, 4, 18, 0))).toBe('Подтверждено вчера.');
  });

  it('says «пора проверить» 14 days after the last passed answer', () => {
    const answers = [at('2026-09-17', 10, 0, 4), at('2026-09-19', 10, 0, 5)];
    expect(line(answers)).toBe('Подтверждено 16 дней назад — пора проверить.');
  });

  it('names the earliest moment a question passed once can be confirmed', () => {
    const answers = [at('2026-10-03', 14, 2, 4)];
    expect(line(answers, new Date(2026, 9, 3, 18, 0))).toBe(
      'Ответ 3 окт., 14:02 — названо достаточно. Подтвердит такой же ответ на другой день, не раньше 4 окт., 10:02.',
    );
    // That moment has come: such an answer now confirms it.
    expect(line(answers, new Date(2026, 9, 4, 11, 0))).toBe('Ответ 3 окт., 14:02 — названо достаточно. Такой же ответ сейчас подтвердит вопрос.');
  });

  it('says a failed answer named too little and the series starts over, with no grade word', () => {
    const answers = [at('2026-10-01', 10, 0, 4), at('2026-10-03', 10, 0, 3)];
    expect(line(answers)).toBe(
      'Последний ответ 3 окт. — названо недостаточно. Серия начнётся заново со следующего ответа, где названо достаточно.',
    );
    expect(readinessLine(questionState([], []), [], NOW)).toBeNull();
  });

  it('shows the line above the answers of the question', () => {
    renderPanel({
      question: question({ coverage: 'full', evidence: [], nearest: [] }),
      coverage: 'full',
      answers: [at('2026-10-01', 10, 0, 4), at('2026-10-03', 10, 0, 5)],
      now: NOW,
    });
    const ready = document.querySelector('.ex-why-ready') as HTMLElement;
    expect(plain(ready.textContent)).toBe('Подтверждено 3 октября — 2 дня назад.');
    expect(ready.compareDocumentPosition(screen.getByRole('list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('WhyPanel on a phone', () => {
  it('is a modal bottom sheet: focus on «Закрыть», Esc closes, Tab stays inside', () => {
    const onClose = vi.fn();
    renderPanel({ variant: 'sheet', onClose, frameBox: { left: 0, right: 0 } });
    const dialog = screen.getByRole('dialog', { name: named('Ни в одной из 9 лекций нет фрагмента об этом') });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = within(dialog).getByRole('button', { name: 'Закрыть' });
    expect(close).toHaveFocus();

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
    focusable[focusable.length - 1].focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(focusable[0]).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(focusable[focusable.length - 1]).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('nearestSentence', () => {
  it('names several matched words', () => {
    expect(
      nearestSentence({ material_id: 'm', material_title: 'Деньги', source_id: 'M1:S07', excerpt: '', matched: ['ставка', 'кредит'] }),
    ).toBe('Ближе всего — «Деньги», фрагмент 7: совпали слова «ставка», «кредит».');
  });
});
