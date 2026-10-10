import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { splitStem } from './model';
import QuestionCard from './QuestionCard';
import KeyQuestion from './keys/KeyQuestion';
import { laterLinesCodeLike, sqlOrShellLine, stemParts } from './stemCode';
import { item } from './testkit/fixtures';

afterEach(cleanup);

/**
 * Code on the screen (usability check of 2026-10-10, m1). Stems from the synthetic banks of the container's
 * fixtures (Базы данных, Операционные системы, Компьютерные сети): 90 of 203 such questions were imported without the
 * code flag and showed SQL and commands in the heading font.
 */

const SQL = 'Какой операции реляционной алгебры соответствует запрос?\nSELECT *\nFROM Students\nWHERE course = 2;';
const CREATE =
  'Что произойдёт со строками Orders при удалении клиента с id = 5?\nCREATE TABLE Orders (\n    id INT PRIMARY KEY,\n    customer_id INT REFERENCES Customers(id) ON DELETE CASCADE\n);';
const PIPE = 'Что выведет команда на сервере, где запущен nginx?\nps aux | grep nginx';
const SCRIPT = 'Чему равно значение выражения $((x * y + 1)) при x = 5 и y = 3?\nx=5\ny=3\necho $((x * y + 1))';
const LS = 'Может ли пользователь из группы staff (не anna) изменить этот файл?\n$ ls -l report.txt\n-rw-r----- 1 anna staff 2048 мар 12 10:15 report.txt';
const PING =
  'Что означает значение «время=24мс» в выводе команды?\nC:\\>ping 8.8.8.8\nОбмен пакетами с 8.8.8.8 по с 32 байтами данных:\nОтвет от 8.8.8.8: число байт=32 время=24мс TTL=117\nОтвет от 8.8.8.8: число байт=32 время=23мс TTL=117';
const TABLE = 'Почему приведённая таблица не находится в 1НФ?\nСтудент   | Телефоны\nИванов    | 89001112233, 89004445566\nПетрова   | 89007778899';
const ROUTES =
  'Дан фрагмент таблицы маршрутизации узла. Через какой шлюз будет отправлен пакет для адреса 10.20.5.7?\nСеть           Маска            Шлюз           Интерфейс\n0.0.0.0        0.0.0.0          192.168.1.1    192.168.1.10\n10.0.0.0       255.0.0.0        192.168.1.2    192.168.1.10';
const HTTP = 'Браузер получил от сервера ответ, начало которого приведено ниже. Что означает этот ответ?\nHTTP/1.1 403 Forbidden\nServer: nginx\nContent-Type: text/html; charset=utf-8';

const lines = (text: string) => text.split('\n');

describe('a question’s code without the import’s flag (the safety net)', () => {
  it.each([
    ['SQL', SQL],
    ['a table made in SQL, with its indented lines', CREATE],
    ['a pipe of commands', PIPE],
    ['a script that starts with its variables', SCRIPT],
  ])('%s: the first line is the question, the rest is code as typed', (_name, stem) => {
    expect(laterLinesCodeLike(stem)).toBe(true);
    const parts = stemParts(stem, false);
    expect(parts.before).toBe(lines(stem)[0]);
    expect(parts.code).toBe(lines(stem).slice(1).join('\n'));
    expect(parts.after).toBe('');
  });

  it('after a prompt the command’s output is code too, its Russian lines included', () => {
    for (const stem of [LS, PING]) {
      const parts = stemParts(stem, false);
      expect(parts.before).toBe(lines(stem)[0]);
      expect(parts.code).toBe(lines(stem).slice(1).join('\n'));
    }
    // A question after the output stays words.
    const asked = stemParts('$ ls -ld /tmp\ndrwxrwxrwt 18 root root 4096 окт  9 08:00 /tmp\nЧто означает буква t?', true);
    expect(asked).toEqual({ before: '', code: '$ ls -ld /tmp\ndrwxrwxrwt 18 root root 4096 окт  9 08:00 /tmp', after: 'Что означает буква t?' });
  });

  it('two rows of a table drawn with spaces or bars keep their columns in the code’s monospace', () => {
    for (const stem of [TABLE, ROUTES]) {
      const parts = stemParts(stem, false);
      expect(parts.before).toBe(lines(stem)[0]);
      expect(parts.code).toBe(lines(stem).slice(1).join('\n'));
    }
  });

  it('words stay words: Russian lines, English questions, a formula, one row of numbers', () => {
    for (const stem of [
      'Какое утверждение верно?\nВыберите все верные ответы.',
      'Choose the right form:\nIf I were you, I ___ go.',
      'Choose the word:\nWhere is the station? Select the correct answer.',
      'Решите уравнение:\nx^2 - 5x + 6 = 0',
      'Найдите значение выражения:\n2 + 3 * 4',
      'Сколько байт в килобайте?\n1000   или   1024',
      'Где находится оператор FROM в запросе?\nFROM — это часть запроса, верно?',
    ]) {
      expect(laterLinesCodeLike(stem)).toBe(false);
      expect(stemParts(stem, false)).toEqual({ before: stem.trim(), code: null, after: '' });
    }
    expect(stemParts('Какая команда удаляет таблицу?', false).code).toBeNull();
  });
});

describe('a question with the import’s flag', () => {
  it('splits C# as model.splitStem does', () => {
    const csharp = [
      'Что выведет программа?\nint a = 7;\nint b = 2;\nConsole.WriteLine(a / b);',
      'Что будет выведено?\nstatic void Change(int x)\n{\n    x = 100;\n}\n\nint value = 5;\nChange(value);\nConsole.WriteLine(value);',
      'Какая директива сворачивает блок кода в именованную область?',
      'Сколько раз выполнится цикл?\nfor (int i = 0; i < 10; i += 3)\n{\n    Console.Write(i);\n}',
    ];
    for (const stem of csharp) expect(stemParts(stem, true)).toEqual(splitStem(stem, true));
  });

  it('knows shell lines, the output after a prompt, tables and HTTP, which C’s rules missed', () => {
    expect(stemParts(PIPE, true).code).toBe('ps aux | grep nginx');
    expect(splitStem(PIPE, true).code).toBeNull();
    expect(stemParts(HTTP, true)).toEqual({ before: lines(HTTP)[0], code: lines(HTTP).slice(1).join('\n'), after: '' });
    expect(stemParts(PING, true).code).toBe(lines(PING).slice(1).join('\n'));
    expect(stemParts(TABLE, true).code).toBe(lines(TABLE).slice(1).join('\n'));
  });

  it('keeps the block whole: the line that opens it and the line that closes it', () => {
    const tryCatch = 'Что выведет фрагмент?\ntry\n{\n    int x = int.Parse("abc");\n}\ncatch (Exception)\n{\n    Console.WriteLine("Ошибка");\n}';
    expect(stemParts(tryCatch, true).code).toBe(lines(tryCatch).slice(1).join('\n'));
    const mongo = 'Какие документы вернёт запрос MongoDB?\ndb.students.find(\n    { course: 3, avgScore: { $gte: 4.5 } },\n    { name: 1, _id: 0 }\n)';
    expect(stemParts(mongo, true).code).toBe(lines(mongo).slice(1).join('\n'));
    const script = 'Какое число выведет команда echo в этом сценарии?\n#!/bin/bash\ncd /nonexistent\necho $?';
    expect(stemParts(script, false).code).toBe(lines(script).slice(1).join('\n'));
    const loop = 'Что выведет цикл?\nfor i in 1 2 3; do\n    echo -n "$i "\ndone';
    expect(stemParts(loop, false).code).toBe(lines(loop).slice(1).join('\n'));
  });

  it('words after the code stay words', () => {
    expect(stemParts('Дан фрагмент:\nint x = 1;\nx++;\nЧто выведет программа?', true)).toEqual({
      before: 'Дан фрагмент:',
      code: 'int x = 1;\nx++;',
      after: 'Что выведет программа?',
    });
  });
});

describe('SQL and shell lines (the same rule as the importer, backend/bank_parse.py)', () => {
  it.each([
    'SELECT *', 'FROM Students', 'WHERE course = 2;', 'ORDER BY name DESC;', 'LEFT JOIN Groups g ON s.group_id = g.id;', 'CREATE TABLE Orders (',
    'INSERT INTO Students (student_id, full_name, group_id)', "VALUES (1, 'Иванов Иван', 99);", 'SET session:42 "user=ivanov" EX 3600',
    'select name from students where id = 1', 'uname -r', 'kill -9 2741', '$ ls -l report.txt', '#!/bin/bash', '@echo off', 'C:\\>ping 8.8.8.8', 'echo $?',
    'sudo chown -R www-data:www-data /var/www/site', 'grep -q "ERROR" app.log && echo "Есть ошибки" || echo "Ошибок нет"',
    'Get-Process | Where-Object { $_.CPU -gt 100 }',
  ])('«%s» is code', (line) => expect(sqlOrShellLine(line)).toBe(true));

  it.each([
    'Какой оператор SQL удаляет таблицу?', 'Выберите все верные ответы.', 'FROM — это часть запроса, верно?', 'Where is the station?',
    'Select the correct answer.', 'Find the odd one out', 'Type of memory: ROM', 'Set-up of the network', 'Read-Only Memory (ROM)', 'ON/OFF',
    'Windows XP', 'TCP/IP', 'x = 5', 'ls?', '',
  ])('«%s» is not', (line) => expect(sqlOrShellLine(line)).toBe(false));
});

describe('on the screen', () => {
  const sqlItem = item({ id: 'q-sql', stem: SQL, options: ['Селекции (выборке)', 'Проекции', 'Объединению'], correct: [0], code: false });

  it('a «занятие» shows the question as its heading and the SQL as code, though the import gave no flag', () => {
    render(
      <QuestionCard
        item={sqlItem}
        order={[0, 1, 2]}
        context="Базы данных"
        mode="learn"
        answered={null}
        ticked={[]}
        text=""
        onPick={() => undefined}
        onText={() => undefined}
        onSubmitText={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Какой операции реляционной алгебры соответствует запрос\?$/);
    const code = document.querySelector('pre.ct-code');
    expect(code?.textContent).toBe('SELECT *FROM StudentsWHERE course = 2;');
    expect(Array.from(code!.querySelectorAll('.ct-code-line')).map((row) => row.textContent)).toEqual(['SELECT *', 'FROM Students', 'WHERE course = 2;']);
  });

  it('«Ключи» and the import page show the same split', () => {
    render(<KeyQuestion context="№ 13 · Базы данных" stem={SQL} code={false} options={sqlItem.options} kind="single" tapMode="none" />);
    const block = screen.getByRole('group', { name: 'Код' });
    expect(Array.from(block.querySelectorAll('.kq-code-line')).map((row) => row.textContent)).toEqual(['SELECT *', 'FROM Students', 'WHERE course = 2;']);
    expect(document.querySelector('.kq-stem-lead')).toHaveTextContent('Какой операции реляционной алгебры соответствует запрос?');
  });
});
