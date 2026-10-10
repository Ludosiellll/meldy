// The group's test data: the spec's invented exam «Осенняя сессия» (3 ноября; today is Friday, 16 October 2026, Minsk),
// its group «3-ПО», four people and invented questions (the spec's own examples; nothing from a real bank), with the
// candidates' summaries the pick reads (`bot.group_candidates`: counts across the members, no names).
import type { GroupItemCounts } from '../../../plan/group.ts';
import { CID, CID2, TG, USER } from '../scenario.ts';
import { GROUP, OTHER_TG } from '../updates.ts';
import type { FakeExam, FakeItem } from './fake_group.ts';

export { CID, GROUP };

/** 12:01 in Minsk (UTC+3) on Friday, 16 October 2026: the post hour has come. */
export const AT_1201 = Date.UTC(2026, 9, 16, 9, 1);
export const AT_2101 = Date.UTC(2026, 9, 16, 18, 1);
export const DAY = '2026-10-16';

/** The author (owner) and a member of the exam, a linked student of another exam, and a Telegram user not linked. */
export const AUTHOR = { userId: USER, tg: TG };
export const MEMBER = { userId: 'c1c2c3d4-0000-4000-8000-000000000002', tg: OTHER_TG };
export const OUTSIDER = { userId: 'c1c2c3d4-0000-4000-8000-000000000003', tg: 700300 };
export const STRANGER = { tg: 700400 };

export const CODE = `G${'7e'.repeat(16)}`;

const item = (n: number, rest: Omit<FakeItem, 'id'>): FakeItem => ({ id: `f1f2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`, ...rest });

/** Short options: buttons (G2). The key is DHCP. */
export const DHCP = item(1, {
  subject: 'Компьютерные сети',
  topic: 2,
  stem: 'Какой протокол выдаёт устройству IP-адрес при подключении к сети?',
  options: ['DNS', 'DHCP', 'ARP', 'NAT'],
  correct: 1,
});

/** Long options: letters, as Z2. The key is the second. */
export const ACID = item(2, {
  subject: 'Базы данных',
  topic: 3,
  stem: 'Что гарантирует изолированность — буква I в ACID?',
  options: [
    'Изменения завершённой транзакции сохраняются даже после сбоя',
    'Параллельные транзакции не видят промежуточных изменений друг друга',
    'Транзакция выполняется целиком или не выполняется совсем',
    'После транзакции данные удовлетворяют всем ограничениям целостности',
  ],
  correct: 1,
});

/** Options in code: letters in <code>, as Z3. */
export const OVERRIDE = item(3, {
  subject: 'Основы программирования',
  topic: 4,
  stem: 'Какое объявление позволяет переопределить метод в классе-наследнике?',
  options: ['public static void Draw()', 'public virtual void Draw()', 'public new void Draw()', 'private void Draw()'],
  correct: 1,
  code: true,
});

/** Code in the question, short options: a <pre> block and buttons (Z3). x++ + ++x with x = 7 is 7 + 9 = 16. */
export const OUTPUT = item(4, {
  subject: 'Основы программирования',
  topic: 5,
  stem: 'Что выведет программа?\nint x = 7;\nint y = x++ + ++x;\nConsole.WriteLine(y);',
  options: ['14', '15', '16', '17'],
  correct: 2,
  code: true,
});

/** Six long options: letters in rows of 4 and 2. */
export const CONTEXT = item(5, {
  subject: 'Операционные системы',
  topic: 1,
  stem: 'Что происходит при переключении контекста между процессами?',
  options: [
    'Состояние текущего процесса сохраняется, а состояние следующего загружается',
    'Все процессы системы останавливаются до конца операции ввода-вывода',
    'Ядро копирует всю память процесса на диск и освобождает оперативную',
    'Планировщик удаляет завершённые процессы из таблицы процессов',
    'Процессор переходит в режим энергосбережения до следующего прерывания',
    'Операционная система перезапускает драйверы устройств текущего процесса',
  ],
  correct: 0,
});

/** The file's order kept (`keep_order`): letters even with short options (decision 13). */
export const OSI = item(6, {
  subject: 'Компьютерные сети',
  topic: 1,
  stem: 'Какой уровень модели OSI отвечает за маршрутизацию пакетов между сетями?',
  options: ['Канальный', 'Сетевой', 'Транспортный', 'Сеансовый'],
  correct: 1,
  keepOrder: true,
});

/** An option far longer than a window: «В файле — …» is cut with «…». */
export const LONG = item(7, {
  subject: 'Базы данных',
  topic: 6,
  stem: 'Что описывает третья нормальная форма?',
  options: [
    'Каждый неключевой атрибут отношения зависит только от первичного ключа, а не от других неключевых атрибутов, поэтому в отношении нет транзитивных зависимостей неключевых атрибутов от ключа, и при этом отношение уже находится во второй нормальной форме',
    'Каждое значение атрибута атомарно и не делится на части, повторяющихся групп нет, а у каждой строки отношения есть свой уникальный ключ, по которому её можно найти среди всех остальных строк этого отношения',
    'Отношение не содержит многозначных зависимостей',
    'Отношение не содержит зависимостей соединения',
  ],
  correct: 0,
});

export const ITEMS = [DHCP, ACID, OVERRIDE, OUTPUT, CONTEXT, OSI, LONG];

/** One candidate row (`rev` here is the item id). */
export function counts(it: FakeItem, c: Partial<Omit<GroupItemCounts, 'rev'>> = {}): GroupItemCounts {
  return { rev: it.id, label: `№ ${it.id.slice(-2)}`, topic: it.topic, members: 12, confirmable: 0, relearn: 0, due: 0, unseen: 0, blocked: false, ...c };
}

/** The exam with only `item` worth posting (every other candidate is blocked). */
export function only(it: FakeItem): GroupItemCounts[] {
  return ITEMS.map((x) => counts(x, x === it ? { confirmable: 3, unseen: 4 } : { blocked: true }));
}

export function autumn(extra: Partial<FakeExam> = {}): FakeExam {
  return {
    id: CID,
    title: 'Осенняя сессия',
    ownerUserId: AUTHOR.userId,
    members: [MEMBER.userId],
    examDate: '2026-11-03',
    linkActive: true,
    items: ITEMS,
    counts: only(DHCP),
    ...extra,
  };
}

/** Another exam the outsider studies (so they are linked but not in «Осенняя сессия»). */
export const WINTER_ID = CID2;
