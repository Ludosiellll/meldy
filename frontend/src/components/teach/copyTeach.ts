/**
 * The teacher's words (owner, 21.11: «максимально не "иишно"… максимально понятно но при этом максимально информатично»):
 * what the thing is called in a staff room, what you need to have, what you get. No «ИИ», no «контейнер», no promises.
 */
export const TEACH_PATH = '/teach';

const QUESTIONS = ['вопрос', 'вопроса', 'вопросов'] as const;

function plural(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(n) % 10;
  const b = Math.abs(n) % 100;
  return forms[a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 1 : 2];
}

export const TEACH = {
  /** The menu's item and the page's title. */
  title: 'Главная',
  h1: 'Что будем делать?',
  actions: [
    {
      id: 'quiz',
      to: '/tests/quick',
      name: 'Провести контрольную',
      text: 'Вставьте вопросы из Word. Получите ссылку и QR-код: ученики отвечают с телефона, регистрация им не нужна. Результаты видны сразу.',
      go: 'Вставить вопросы',
    },
    {
      id: 'game',
      to: '/games',
      name: 'Сыграть на паре',
      text: 'Игра по вашим вопросам на проекторе. Ученики входят с телефона по коду и отвечают все вместе.',
      go: 'Выбрать игру',
    },
    {
      id: 'exam',
      to: '/exams/import',
      name: 'Подготовить группу к экзамену',
      text: 'Загрузите вопросы к экзамену и отправьте группе ссылку. У каждого будет план на каждый день, а вы увидите, как готовится группа.',
      go: 'Загрузить вопросы',
    },
  ],
  testsTitle: 'Ваши тесты и контрольные',
  examsTitle: 'Экзамены для группы',
  examMeta: (items: number) => (items > 0 ? `${items} ${plural(items, QUESTIONS)}` : 'Пока без вопросов'),
  open: 'Открыть',
  all: 'Все тесты и экзамены',
  /** For a teacher who also studies. */
  student: 'Учитесь сами?',
  studentGo: 'Открыть страницу студента',
} as const;

/** The one question, on «Сегодня», until it is answered. */
export const ROLE_ASK = {
  title: 'Вы преподаёте?',
  text: 'У преподавателей своя главная страница: контрольные, игры на паре и подготовка группы к экзамену.',
  yes: 'Да, преподаю',
  no: 'Нет, учусь',
} as const;

/** The switch in the account menu. */
export const ROLE_SWITCH = 'Я преподаватель';
