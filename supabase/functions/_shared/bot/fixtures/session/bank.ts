// Questions for the session's tests and snapshots: the spec's invented ones (§4.3 Z1–Z5, «Осенняя сессия»), and a
// generator that gives every other planned item id a plain question of the same kind. Nothing here comes from a real
// bank or from the concepts' examples.

/** A test item as the database holds it (file order, the key included): only the fake database reads `correct`. */
export interface BankItem {
  id: string;
  containerId: string;
  subjectId: string;
  kind: 'single' | 'multiple' | 'short';
  stem: string;
  options: string[];
  correct: number[];
  answers: string[];
  code: boolean;
  keepOrder: boolean;
  fileNo: string;
  position: number;
  topicTitle: string | null;
  keySource: string;
  rev: number;
  updatedAt: string;
}

/** Z1: short options on full-width buttons. */
export const HTTPS: Omit<BankItem, 'id' | 'containerId' | 'subjectId'> = {
  kind: 'single',
  stem: 'Какой протокол передаёт веб-страницы в зашифрованном виде?',
  options: ['HTTP', 'FTP', 'HTTPS', 'SMTP', 'Telnet'],
  correct: [2],
  answers: [],
  code: false,
  keepOrder: false,
  fileNo: '12',
  position: 12,
  topicTitle: 'Тема 2. Прикладной уровень',
  keySource: 'bold',
  rev: 1,
  updatedAt: '2026-10-05T10:00:00Z',
};

/** Z2: long options, by letter; Z7's example (№ 57 · Тема 3. Транзакции). */
export const ACID: Omit<BankItem, 'id' | 'containerId' | 'subjectId'> = {
  kind: 'single',
  stem: 'Что гарантирует изолированность — буква I в ACID?',
  options: [
    'Изменения завершённой транзакции сохраняются даже после сбоя',
    'Параллельные транзакции не видят промежуточных изменений друг друга',
    'Транзакция выполняется целиком или не выполняется совсем',
    'После транзакции данные удовлетворяют всем ограничениям целостности',
  ],
  correct: [1],
  answers: [],
  code: false,
  keepOrder: false,
  fileNo: '57',
  position: 57,
  topicTitle: 'Тема 3. Транзакции',
  keySource: 'bold',
  rev: 1,
  updatedAt: '2026-10-05T10:00:00Z',
};

/** Z3: code in the options (always letters, each in <code>). */
export const DRAW: Omit<BankItem, 'id' | 'containerId' | 'subjectId'> = {
  kind: 'single',
  stem: 'Какое объявление позволяет переопределить метод в классе-наследнике?',
  options: ['public static void Draw()', 'public virtual void Draw()', 'public new void Draw()', 'private void Draw()'],
  correct: [1],
  answers: [],
  code: true,
  keepOrder: false,
  fileNo: '31',
  position: 31,
  topicTitle: 'Тема 4. Наследование',
  keySource: 'bold',
  rev: 1,
  updatedAt: '2026-10-05T10:00:00Z',
};

/** Z3: code in the question, short options stay buttons. */
export const POSTFIX: Omit<BankItem, 'id' | 'containerId' | 'subjectId'> = {
  kind: 'single',
  stem: 'Что выведет программа?\nint x = 7;\nint y = x++ + ++x;\nConsole.WriteLine(y);',
  options: ['14', '15', '16', '17'],
  correct: [2],
  answers: [],
  code: true,
  keepOrder: false,
  fileNo: '44',
  position: 44,
  topicTitle: 'Тема 2. Операторы',
  keySource: 'bold',
  rev: 1,
  updatedAt: '2026-10-05T10:00:00Z',
};

/** Z4: several correct answers. */
export const PRIVATE_IP: Omit<BankItem, 'id' | 'containerId' | 'subjectId'> = {
  kind: 'multiple',
  stem: 'Какие адреса относятся к частным диапазонам IPv4?',
  options: ['10.4.0.9', '172.20.1.1', '192.168.3.7', '8.8.4.4'],
  correct: [0, 1, 2],
  answers: [],
  code: false,
  keepOrder: false,
  fileNo: '9',
  position: 9,
  topicTitle: 'Тема 1. Адресация',
  keySource: 'bold',
  rev: 1,
  updatedAt: '2026-10-05T10:00:00Z',
};

/** Z5: a short answer, compared after normalisation with the file's forms. */
export const IPV4_BITS: Omit<BankItem, 'id' | 'containerId' | 'subjectId'> = {
  kind: 'short',
  stem: 'Сколько бит в адресе IPv4?',
  options: [],
  correct: [],
  answers: ['32', 'тридцать два'],
  code: false,
  keepOrder: false,
  fileNo: '11',
  position: 11,
  topicTitle: 'Тема 1. Адресация',
  keySource: 'answer_line',
  rev: 1,
  updatedAt: '2026-10-05T10:00:00Z',
};

/** keep_order and «все перечисленные»: letters in the file's order. */
export const KEEP_ORDER: Omit<BankItem, 'id' | 'containerId' | 'subjectId'> = {
  kind: 'single',
  stem: 'Какие уровни входят в модель TCP/IP?',
  options: ['Канальный', 'Сетевой', 'Транспортный', 'Все перечисленные'],
  correct: [3],
  answers: [],
  code: false,
  keepOrder: true,
  fileNo: '3',
  position: 3,
  topicTitle: 'Тема 1. Модели',
  keySource: 'bold',
  rev: 1,
  updatedAt: '2026-10-05T10:00:00Z',
};

/** «Все перечисленные» without keep_order: shuffled, but it stays last. */
export const ALL_LISTED: Omit<BankItem, 'id' | 'containerId' | 'subjectId'> = {
  kind: 'single',
  stem: 'Что относится к сетевым устройствам?',
  options: ['Маршрутизатор', 'Коммутатор', 'Все перечисленные', 'Точка доступа'],
  correct: [2],
  answers: [],
  code: false,
  keepOrder: false,
  fileNo: '5',
  position: 5,
  topicTitle: null,
  keySource: 'bold',
  rev: 1,
  updatedAt: '2026-10-05T10:00:00Z',
};

/** A question longer than a Telegram message: 4000 characters of question and five options of 300. */
export function tooLong(): Omit<BankItem, 'id' | 'containerId' | 'subjectId'> {
  const sentence = 'Какой из уровней модели отвечает за доставку данных между узлами разных сетей при заданных условиях? ';
  return {
    kind: 'single',
    stem: sentence.repeat(Math.ceil(4000 / sentence.length)).slice(0, 4000).trim(),
    options: ['Сетевой уровень ', 'Канальный уровень ', 'Транспортный уровень ', 'Физический уровень ', 'Сеансовый уровень '].map((o) => o.repeat(20).slice(0, 300).trim()),
    correct: [0],
    answers: [],
    code: false,
    keepOrder: false,
    fileNo: '99',
    position: 99,
    topicTitle: null,
    keySource: 'bold',
    rev: 1,
    updatedAt: '2026-10-05T10:00:00Z',
  };
}

/** A plain question for any other planned id: «Вопрос 37 по теме 2.», four short options, the first is the key. */
export function plain(n: number): Omit<BankItem, 'id' | 'containerId' | 'subjectId'> {
  return {
    kind: 'single',
    stem: `Вопрос ${n}: какой вариант стоит в файле первым?`,
    options: [`Первый ${n}`, `Второй ${n}`, `Третий ${n}`, `Четвёртый ${n}`],
    correct: [0],
    answers: [],
    code: false,
    keepOrder: false,
    fileNo: String(n),
    position: n,
    topicTitle: `Тема ${(n % 3) + 1}. Раздел ${(n % 3) + 1}`,
    keySource: 'bold',
    rev: 1,
    updatedAt: '2026-10-05T10:00:00Z',
  };
}
