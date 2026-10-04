/**
 * A realistic sample for tests and visual checks of the knowledge map (not used by the app): a
 * macroeconomics course of nine lectures with their glossaries, an exam of 24 questions mapped to
 * them with answers in the journal, an econometrics colloquium of four lectures, two lectures
 * imported as text only, open mistakes and due cards. Rows look like Supabase rows.
 */

import type { LearningEvent } from '../../api/learning';
import { statesByHash } from '../../lib/learning/readiness';
import type { KnowledgeInput, RawExam, RawMaterial, RawMistake, RawQuestion } from './model';

const DAY = 86_400_000;

interface LectureSpec {
  title: string;
  subject: string;
  terms: Array<[string, string]>;
  textOnly?: boolean;
}

export const MACRO_LECTURES: LectureSpec[] = [
  {
    title: '01_Предмет_макроэкономики_и_ВВП.pdf',
    subject: 'Макроэкономика',
    terms: [
      ['ВВП', 'Рыночная стоимость всех конечных товаров и услуг, произведённых в стране за год.'],
      ['Реальный ВВП', 'ВВП в ценах базового года: показывает изменение физического объёма выпуска.'],
      ['Дефлятор ВВП', 'Отношение номинального ВВП к реальному; измеряет общий уровень цен.'],
      ['Совокупный спрос', 'Общий объём товаров и услуг, который готовы купить при каждом уровне цен.'],
      ['Инфляция', 'Устойчивый рост общего уровня цен.'],
      ['Безработица', 'Положение, когда часть рабочей силы ищет работу и не может её найти.'],
    ],
  },
  {
    title: 'Совокупный спрос и совокупное предложение',
    subject: 'Макроэкономика',
    terms: [
      ['Совокупный спрос', 'Сумма потребления, инвестиций, госрасходов и чистого экспорта.'],
      ['Совокупное предложение', 'Объём выпуска, который фирмы готовы произвести при каждом уровне цен.'],
      ['Мультипликатор', 'Во сколько раз изменится выпуск при изменении автономных расходов.'],
      ['Инвестиции', 'Расходы фирм на новый капитал: оборудование, здания, запасы.'],
      ['Ставка процента', 'Цена кредита: плата за пользование деньгами в течение года.'],
      ['Шок предложения', 'Внезапное изменение издержек, сдвигающее кривую совокупного предложения.'],
    ],
  },
  {
    title: 'Деньги и денежный рынок',
    subject: 'Макроэкономика',
    terms: [
      ['Денежная масса', 'Совокупность наличных денег и средств на счетах в экономике.'],
      ['Денежная база', 'Наличные деньги и резервы коммерческих банков в центральном банке.'],
      ['Денежный мультипликатор', 'Отношение денежной массы к денежной базе.'],
      ['Спрос на деньги', 'Желание хранить богатство в ликвидной форме: для сделок, из предосторожности и спекулятивно.'],
      ['Ставка процента', 'Цена денег во времени; растёт, когда спрос на деньги превышает их предложение.'],
      ['Ликвидность', 'Способность актива быстро превратиться в деньги без потерь.'],
      ['Центральный банк', 'Банк банков: выпускает наличные и проводит денежно-кредитную политику.'],
    ],
  },
  {
    title: 'Банковская система',
    subject: 'Макроэкономика',
    terms: [
      ['Центральный банк', 'Регулятор, который отвечает за устойчивость банков и ценовую стабильность.'],
      ['Коммерческий банк', 'Принимает депозиты и выдаёт кредиты.'],
      ['Обязательные резервы', 'Доля депозитов, которую банк обязан хранить в центральном банке.'],
      ['Денежный мультипликатор', 'Показывает, сколько денег создаёт банковская система из единицы резервов.'],
      ['Денежная база', 'Деньги центрального банка: наличные и резервы.'],
      ['Ликвидность', 'Способность банка вовремя расплатиться по обязательствам.'],
    ],
  },
  {
    title: 'Денежно-кредитная политика',
    subject: 'Макроэкономика',
    terms: [
      ['Центральный банк', 'Проводит денежно-кредитную политику, меняя ключевую ставку и резервы.'],
      ['Ключевая ставка', 'Ставка, по которой центральный банк кредитует банки и принимает их депозиты.'],
      ['Операции на открытом рынке', 'Покупка и продажа центральным банком государственных облигаций.'],
      ['Обязательные резервы', 'Инструмент политики: рост норм сокращает денежный мультипликатор.'],
      ['Таргетирование инфляции', 'Режим, при котором банк объявляет цель по инфляции и меняет ставку ради неё.'],
      ['Трансмиссионный механизм', 'Путь от решения по ставке до цен и выпуска: кредит, курс, ожидания.'],
      ['Инфляция', 'Главная цель политики — низкая и предсказуемая инфляция.'],
    ],
  },
  {
    title: 'Инфляция: причины и последствия',
    subject: 'Макроэкономика',
    terms: [
      ['Инфляция', 'Рост общего уровня цен, измеряемый индексом потребительских цен.'],
      ['Индекс потребительских цен', 'Стоимость фиксированной корзины товаров по сравнению с базовым годом.'],
      ['Дефлятор ВВП', 'Индекс цен всех конечных товаров, а не только потребительской корзины.'],
      ['Инфляция спроса', 'Рост цен, когда совокупный спрос опережает производственные возможности.'],
      ['Инфляция издержек', 'Рост цен из-за подорожания ресурсов: энергии, сырья, труда.'],
      ['Гиперинфляция', 'Рост цен более чем на 50 % в месяц.'],
      ['Кривая Филлипса', 'Краткосрочная обратная связь инфляции и безработицы.'],
    ],
  },
  {
    title: 'Безработица и рынок труда',
    subject: 'Макроэкономика',
    terms: [
      ['Безработица', 'Доля рабочей силы, которая ищет работу и не может её найти.'],
      ['Естественный уровень безработицы', 'Безработица при полной занятости: фрикционная плюс структурная.'],
      ['Циклическая безработица', 'Безработица из-за спада деловой активности.'],
      ['Закон Оукена', 'Рост безработицы на 1 п. п. сверх естественной снижает ВВП примерно на 2–2,5 %.'],
      ['Кривая Филлипса', 'В долгосрочном периоде вертикальна: инфляция не снижает безработицу.'],
    ],
  },
  {
    title: 'Бюджетная политика и государственный долг',
    subject: 'Макроэкономика',
    terms: [
      ['Государственные расходы', 'Закупки государства, трансферты и обслуживание долга.'],
      ['Бюджетный дефицит', 'Превышение расходов бюджета над доходами.'],
      ['Государственный долг', 'Сумма накопленных дефицитов бюджета.'],
      ['Мультипликатор', 'Мультипликатор госрасходов больше налогового.'],
      ['Эффект вытеснения', 'Рост госрасходов повышает ставку процента и снижает частные инвестиции.'],
      ['Совокупный спрос', 'Растёт при увеличении госрасходов и снижении налогов.'],
    ],
  },
  {
    title: 'Экономический рост',
    subject: 'Макроэкономика',
    terms: [
      ['Экономический рост', 'Долгосрочное увеличение реального ВВП.'],
      ['Реальный ВВП', 'Главный показатель роста: выпуск в неизменных ценах.'],
      ['Модель Солоу', 'Объясняет рост накоплением капитала, ростом населения и технологиями.'],
      ['Инвестиции', 'Источник накопления капитала; финансируются сбережениями.'],
      ['Технический прогресс', 'Главный источник долгосрочного роста выпуска на работника.'],
    ],
  },
];

export const METRICS_LECTURES: LectureSpec[] = [
  {
    title: 'Парная регрессия',
    subject: 'Эконометрика',
    terms: [
      ['Метод наименьших квадратов', 'Оценки, при которых сумма квадратов остатков минимальна.'],
      ['Остатки', 'Разница между наблюдаемым и предсказанным значением.'],
      ['Коэффициент детерминации', 'Доля дисперсии зависимой переменной, объяснённая моделью.'],
    ],
  },
  {
    title: 'Множественная регрессия',
    subject: 'Эконометрика',
    terms: [
      ['Метод наименьших квадратов', 'Те же оценки для нескольких регрессоров в матричном виде.'],
      ['Мультиколлинеарность', 'Сильная связь между регрессорами, раздувающая стандартные ошибки.'],
      ['Коэффициент детерминации', 'Растёт с каждым новым регрессором; поэтому смотрят скорректированный.'],
    ],
  },
  {
    title: 'Гетероскедастичность',
    subject: 'Эконометрика',
    terms: [
      ['Гетероскедастичность', 'Непостоянная дисперсия ошибок.'],
      ['Остатки', 'По графику остатков видно непостоянство дисперсии.'],
      ['Тест Уайта', 'Проверка гетероскедастичности по вспомогательной регрессии квадратов остатков.'],
    ],
  },
  {
    title: 'Временные ряды',
    subject: 'Эконометрика',
    terms: [
      ['Автокорреляция', 'Связь ошибки с её прошлыми значениями.'],
      ['Стационарность', 'Постоянство среднего и дисперсии ряда во времени.'],
      ['Остатки', 'Проверяются на автокорреляцию тестом Дарбина — Уотсона.'],
    ],
  },
];

export const TEXT_ONLY_LECTURES: LectureSpec[] = [
  { title: 'Лекция_10_Открытая_экономика.docx', subject: '', terms: [], textOnly: true },
  { title: 'Международная торговля', subject: '', terms: [], textOnly: true },
];

/** Questions of the macroeconomics exam: text, the lecture indexes and fragments they were found in, coverage. */
export const MACRO_QUESTIONS: Array<{ text: string; lectures: Array<[number, string[]]>; coverage: 'full' | 'partial' | 'none' }> = [
  { text: 'Предмет и методы макроэкономики. ВВП и способы его измерения.', lectures: [[0, ['S02', 'S03']]], coverage: 'full' },
  { text: 'Номинальный и реальный ВВП. Дефлятор ВВП.', lectures: [[0, ['S04']]], coverage: 'full' },
  { text: 'Совокупный спрос и его составляющие.', lectures: [[1, ['S02']]], coverage: 'full' },
  { text: 'Совокупное предложение в краткосрочном и долгосрочном периодах.', lectures: [[1, ['S03', 'S04']]], coverage: 'partial' },
  { text: 'Мультипликатор автономных расходов.', lectures: [[1, ['S05']]], coverage: 'full' },
  { text: 'Функции денег и денежные агрегаты.', lectures: [[2, ['S02']]], coverage: 'full' },
  { text: 'Спрос на деньги: мотивы и факторы.', lectures: [[2, ['S04']]], coverage: 'full' },
  { text: 'Денежный мультипликатор и денежная база.', lectures: [[2, ['S03']], [3, ['S05']]], coverage: 'full' },
  { text: 'Равновесие на денежном рынке.', lectures: [[2, ['S06']]], coverage: 'partial' },
  { text: 'Двухуровневая банковская система.', lectures: [[3, ['S02']]], coverage: 'full' },
  { text: 'Обязательные резервы и их роль.', lectures: [[3, ['S04']], [4, ['S05']]], coverage: 'full' },
  { text: 'Ключевая ставка ЦБ и её влияние на инфляцию.', lectures: [[4, ['S03']]], coverage: 'full' },
  { text: 'Операции на открытом рынке.', lectures: [[4, ['S04']]], coverage: 'full' },
  { text: 'Трансмиссионный механизм денежно-кредитной политики.', lectures: [[4, ['S07']]], coverage: 'partial' },
  { text: 'Инфляция: виды и причины.', lectures: [[5, ['S02', 'S04']]], coverage: 'full' },
  { text: 'Издержки инфляции и гиперинфляция.', lectures: [[5, ['S06']]], coverage: 'full' },
  { text: 'Кривая Филлипса в краткосрочном и долгосрочном периоде.', lectures: [[5, ['S08']], [6, ['S06']]], coverage: 'full' },
  { text: 'Виды безработицы и естественный уровень безработицы.', lectures: [[6, ['S02', 'S03']]], coverage: 'full' },
  { text: 'Закон Оукена.', lectures: [[6, ['S05']]], coverage: 'full' },
  { text: 'Бюджетный дефицит и государственный долг.', lectures: [[7, ['S03']]], coverage: 'full' },
  { text: 'Эффект вытеснения.', lectures: [[7, ['S06']]], coverage: 'partial' },
  { text: 'Модель Солоу.', lectures: [[8, ['S03']]], coverage: 'full' },
  { text: 'Платёжный баланс и валютный курс.', lectures: [], coverage: 'none' },
  { text: 'Теория реального делового цикла.', lectures: [], coverage: 'none' },
];

/** Readiness plan by question index (0-based): what the journal says about the answers. */
export const MACRO_READINESS: Record<number, 'confirmed' | 'once' | 'not_passed'> = {
  0: 'confirmed',
  2: 'confirmed',
  4: 'once',
  6: 'confirmed',
  7: 'not_passed',
  10: 'once',
  11: 'confirmed',
  14: 'not_passed',
  16: 'once',
  17: 'confirmed',
  19: 'not_passed',
};

export interface SampleRows {
  materials: Array<Record<string, unknown>>;
  mistake_diary: Array<Record<string, unknown>>;
  exams: Array<Record<string, unknown>>;
  exam_materials: Array<Record<string, unknown>>;
  exam_questions: Array<Record<string, unknown>>;
  learning_events: Array<Record<string, unknown>>;
  flashcard_progress: Array<Record<string, unknown>>;
}

function dayKey(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function hash(index: number): string {
  return (0xabc000 + index).toString(16).padStart(32, '0');
}

/** Supabase-like rows of the whole sample, dated relative to `now`. */
export function sampleRows(now: Date = new Date(), userId = 'user-1'): SampleRows {
  const base = now.getTime();
  const materials: SampleRows['materials'] = [];
  const all = [
    ...MACRO_LECTURES.map((spec, index) => ({ spec, id: `macro-${index + 1}`, created: base - (30 - index * 2) * DAY })),
    ...METRICS_LECTURES.map((spec, index) => ({ spec, id: `metrics-${index + 1}`, created: base - (14 - index) * DAY })),
    ...TEXT_ONLY_LECTURES.map((spec, index) => ({ spec, id: `text-${index + 1}`, created: base - (3 - index) * DAY })),
  ];
  for (const { spec, id, created } of all) {
    materials.push({
      id,
      user_id: userId,
      title: spec.title,
      subject: spec.subject,
      created_at: new Date(created).toISOString(),
      summary_json: spec.textOnly
        ? { text_only: true }
        : {
            content: `## ${spec.title}\n\nКонспект лекции.`,
            terms: spec.terms.map(([term, definition], index) => ({ term, definition, source_ids: [`S${String(index + 2).padStart(2, '0')}`] })),
          },
    });
  }

  const exams = [
    {
      id: 'exam-macro',
      user_id: userId,
      title: 'Макроэкономика',
      kind: 'exam',
      exam_date: dayKey(base + 12 * DAY),
      created_at: new Date(base - 10 * DAY).toISOString(),
    },
    {
      id: 'exam-metrics',
      user_id: userId,
      title: 'Эконометрика',
      kind: 'colloquium',
      exam_date: dayKey(base + 26 * DAY),
      created_at: new Date(base - 8 * DAY).toISOString(),
    },
  ];
  const exam_materials = [
    ...MACRO_LECTURES.map((_, index) => ({ exam_id: 'exam-macro', material_id: `macro-${index + 1}`, user_id: userId, added_at: new Date(base - (9 - index) * DAY).toISOString() })),
    ...METRICS_LECTURES.map((_, index) => ({ exam_id: 'exam-metrics', material_id: `metrics-${index + 1}`, user_id: userId, added_at: new Date(base - (7 - index) * DAY).toISOString() })),
  ];
  const exam_questions = MACRO_QUESTIONS.map((question, index) => ({
    id: `q-${index + 1}`,
    exam_id: 'exam-macro',
    user_id: userId,
    position: index + 1,
    label: String(index + 1),
    section: null,
    text: question.text,
    question_hash: hash(index + 1),
    coverage: question.coverage,
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    evidence: question.lectures.flatMap(([lecture, sources]) =>
      sources.map((source) => ({ material_id: `macro-${lecture + 1}`, material_title: MACRO_LECTURES[lecture].title, source_id: source, excerpt: 'Фрагмент лекции.' })),
    ),
    nearest: [],
    created_at: new Date(base - 10 * DAY).toISOString(),
  }));

  const learning_events: SampleRows['learning_events'] = [];
  const answer = (index: number, time: number, correct: boolean) => {
    learning_events.push({
      id: `ev-${learning_events.length + 1}`,
      user_id: userId,
      created_at: new Date(time).toISOString(),
      local_date: dayKey(time),
      material_id: null,
      kind: 'exam_answer',
      item_key: `q:${hash(index + 1)}`,
      correct,
      score: correct ? 0.82 : 0.4,
      confidence: null,
      source_ids: [],
      session_id: null,
      payload: { grade: correct ? 4 : 3 },
    });
  };
  for (const [key, state] of Object.entries(MACRO_READINESS)) {
    const index = Number(key);
    if (state === 'confirmed') {
      answer(index, base - 6 * DAY + index * 60_000, true);
      answer(index, base - 4 * DAY + index * 60_000, true);
    } else if (state === 'once') {
      answer(index, base - 2 * DAY + index * 60_000, true);
    } else {
      answer(index, base - 3 * DAY + index * 60_000, true);
      answer(index, base - 1 * DAY + index * 60_000, false);
    }
  }

  const mistake_diary = [
    { id: 'm-1', user_id: userId, question: 'Почему рост норм обязательных резервов сокращает денежный мультипликатор?', topic: 'Денежный мультипликатор', is_resolved: false, material_id: 'macro-3', origin: 'quiz', created_at: new Date(base - 3 * DAY).toISOString() },
    { id: 'm-2', user_id: userId, question: 'Чем инфляция издержек отличается от инфляции спроса?', topic: 'Инфляция', is_resolved: false, material_id: 'macro-6', origin: 'oral_ticket', created_at: new Date(base - 2 * DAY).toISOString() },
    { id: 'm-3', user_id: userId, question: 'Как выглядит кривая Филлипса в долгосрочном периоде?', topic: 'Кривая Филлипса', is_resolved: false, material_id: 'macro-7', origin: 'oral_ticket', created_at: new Date(base - 1 * DAY).toISOString() },
    { id: 'm-4', user_id: userId, question: 'Что такое ВВП?', topic: 'ВВП', is_resolved: true, material_id: 'macro-1', origin: 'quiz', created_at: new Date(base - 9 * DAY).toISOString() },
  ];

  const flashcard_progress: SampleRows['flashcard_progress'] = [];
  const due = (materialId: string, n: number) => {
    for (let i = 0; i < n; i += 1) {
      flashcard_progress.push({ id: `card-${materialId}-${i}`, user_id: userId, material_id: materialId, question: `Карточка ${i + 1}`, answer: 'Ответ', next_review: new Date(base - DAY).toISOString() });
    }
  };
  due('macro-2', 3);
  due('macro-3', 5);
  due('macro-6', 4);

  return { materials, mistake_diary, exams, exam_materials, exam_questions, learning_events, flashcard_progress };
}

/** The sample as the model's input (what useKnowledgeData would read). */
export function sampleInput(now: Date = new Date()): KnowledgeInput {
  const rows = sampleRows(now);
  const exams: RawExam[] = rows.exams.map((exam) => ({
    id: String(exam.id),
    title: String(exam.title),
    kind: exam.kind as RawExam['kind'],
    exam_date: (exam.exam_date as string) ?? null,
    created_at: String(exam.created_at),
    materials: rows.exam_materials
      .filter((link) => link.exam_id === exam.id)
      .sort((a, b) => String(a.added_at).localeCompare(String(b.added_at)))
      .map((link) => ({ id: String(link.material_id), addedAt: String(link.added_at) })),
  }));
  const due = new Map<string, number>();
  for (const card of rows.flashcard_progress) due.set(String(card.material_id), (due.get(String(card.material_id)) ?? 0) + 1);
  return {
    materials: rows.materials as unknown as RawMaterial[],
    mistakes: rows.mistake_diary as unknown as RawMistake[],
    exams,
    questions: rows.exam_questions as unknown as RawQuestion[],
    states: statesByHash(rows.learning_events as unknown as LearningEvent[], now),
    dueByMaterial: due,
    now,
  };
}
