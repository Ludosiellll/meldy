// A question's code, the stems of the site's components/containers/stemCode.test.tsx (usability check m1): from the
// synthetic banks of the container's fixtures (Базы данных, Операционные системы, Компьютерные сети, Программирование на
// C#), nothing from a real bank. The bot splits them with the copied `stemParts` (lib/containers/stemCode.ts), as the
// site does: the same stems, the same split.

export const SQL = 'Какой операции реляционной алгебры соответствует запрос?\nSELECT *\nFROM Students\nWHERE course = 2;';
export const CREATE =
  'Что произойдёт со строками Orders при удалении клиента с id = 5?\nCREATE TABLE Orders (\n    id INT PRIMARY KEY,\n    customer_id INT REFERENCES Customers(id) ON DELETE CASCADE\n);';
export const PIPE = 'Что выведет команда на сервере, где запущен nginx?\nps aux | grep nginx';
export const SCRIPT = 'Чему равно значение выражения $((x * y + 1)) при x = 5 и y = 3?\nx=5\ny=3\necho $((x * y + 1))';
export const LS = 'Может ли пользователь из группы staff (не anna) изменить этот файл?\n$ ls -l report.txt\n-rw-r----- 1 anna staff 2048 мар 12 10:15 report.txt';
export const PING =
  'Что означает значение «время=24мс» в выводе команды?\nC:\\>ping 8.8.8.8\nОбмен пакетами с 8.8.8.8 по с 32 байтами данных:\nОтвет от 8.8.8.8: число байт=32 время=24мс TTL=117\nОтвет от 8.8.8.8: число байт=32 время=23мс TTL=117';
export const TABLE = 'Почему приведённая таблица не находится в 1НФ?\nСтудент   | Телефоны\nИванов    | 89001112233, 89004445566\nПетрова   | 89007778899';
export const ROUTES =
  'Дан фрагмент таблицы маршрутизации узла. Через какой шлюз будет отправлен пакет для адреса 10.20.5.7?\nСеть           Маска            Шлюз           Интерфейс\n0.0.0.0        0.0.0.0          192.168.1.1    192.168.1.10\n10.0.0.0       255.0.0.0        192.168.1.2    192.168.1.10';
export const HTTP = 'Браузер получил от сервера ответ, начало которого приведено ниже. Что означает этот ответ?\nHTTP/1.1 403 Forbidden\nServer: nginx\nContent-Type: text/html; charset=utf-8';

/** C# with the import's flag (stemCode.test.tsx «splits C# as model.splitStem does»). */
export const CSHARP = 'Что выведет программа?\nint a = 7;\nint b = 2;\nConsole.WriteLine(a / b);';
export const LOOP_C = 'Сколько раз выполнится цикл?\nfor (int i = 0; i < 10; i += 3)\n{\n    Console.Write(i);\n}';
/** A block that opens and closes on lines of their own, a call left open at a line's end. */
export const TRY_CATCH = 'Что выведет фрагмент?\ntry\n{\n    int x = int.Parse("abc");\n}\ncatch (Exception)\n{\n    Console.WriteLine("Ошибка");\n}';
export const MONGO = 'Какие документы вернёт запрос MongoDB?\ndb.students.find(\n    { course: 3, avgScore: { $gte: 4.5 } },\n    { name: 1, _id: 0 }\n)';
/** Shell scripts without the flag. */
export const SHEBANG = 'Какое число выведет команда echo в этом сценарии?\n#!/bin/bash\ncd /nonexistent\necho $?';
export const LOOP_SH = 'Что выведет цикл?\nfor i in 1 2 3; do\n    echo -n "$i "\ndone';
/** A question after a command's output stays words; so do words after the code. */
export const ASKED_AFTER = '$ ls -ld /tmp\ndrwxrwxrwt 18 root root 4096 окт  9 08:00 /tmp\nЧто означает буква t?';
export const WORDS_AFTER = 'Дан фрагмент:\nint x = 1;\nx++;\nЧто выведет программа?';

/** Words stay words without the flag: Russian lines, English questions, a formula, one row of numbers. */
export const WORDS = [
  'Какое утверждение верно?\nВыберите все верные ответы.',
  'Choose the right form:\nIf I were you, I ___ go.',
  'Choose the word:\nWhere is the station? Select the correct answer.',
  'Решите уравнение:\nx^2 - 5x + 6 = 0',
  'Найдите значение выражения:\n2 + 3 * 4',
  'Сколько байт в килобайте?\n1000   или   1024',
  'Где находится оператор FROM в запросе?\nFROM — это часть запроса, верно?',
];
