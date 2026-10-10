import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlProblems, lintMessage, lintProfile } from './lint.ts';
import { b, NBSP, t } from './html.ts';

const has = (problems: string[], re: RegExp) => problems.some((p) => re.test(p));

test('a good message passes', () => {
  const text = `${b('Сегодня около 45 минут: 30 новых и 60 знакомых.')}\n${t('Осенняя сессия · 3 ноября, через 18 дней')}`;
  assert.deepEqual(lintMessage({ text, keyboard: [[{ text: 'Начать: 20 вопросов', data: 'go|x|p', style: 'primary' }]], user: ['Осенняя сессия'] }), []);
});

test('tags: only the allowed ones, well nested, no code inside bold', () => {
  assert.deepEqual(htmlProblems('<b>a</b> <code>x</code> <pre><code class="language-csharp">y</code></pre> <a href="https://e.example/x">l</a> <blockquote expandable>q</blockquote>'), []);
  assert.ok(has(htmlProblems('<i>x</i>'), /not allowed/));
  assert.ok(has(htmlProblems('<b><code>x</code></b>'), /<code> inside <b>/));
  assert.ok(has(htmlProblems('<b>x'), /unclosed/));
  assert.ok(has(htmlProblems('<b>x</code>'), /closes/));
  assert.ok(has(htmlProblems('a < b'), /unescaped/));
  assert.ok(has(htmlProblems('a & b'), /unescaped/));
  assert.ok(has(htmlProblems('&nbsp;'), /entity/));
  assert.ok(has(htmlProblems('<a href="http://x">y</a>'), /<a /));
  assert.ok(has(htmlProblems('<code class="language-csharp">y</code>'), /<code /));
  assert.ok(has(htmlProblems('<tg-spoiler>x</tg-spoiler>'), /not allowed/));
});

test('length, callback bytes, blue and red buttons, url', () => {
  assert.ok(has(lintMessage({ text: 'я'.repeat(4097) }), /4097 visible/));
  assert.ok(has(lintMessage({ text: '' }), /empty text/));
  assert.ok(has(lintMessage({ text: 'Текст', keyboard: [[{ text: 'Да', data: 'x'.repeat(65) }]] }), /65 bytes/));
  const two = [[{ text: 'Дальше', data: 'a', style: 'primary' as const }], [{ text: 'Ещё', data: 'b', style: 'primary' as const }]];
  assert.ok(has(lintMessage({ text: 'Текст', keyboard: two }), /2 blue/));
  assert.ok(has(lintMessage({ text: 'Текст', chat: 'group', keyboard: [[{ text: 'Ответ', data: 'g|1|0', style: 'primary' }]] }), /in a group/));
  assert.ok(has(lintMessage({ text: 'Текст', keyboard: [[{ text: 'Отмена', data: 'a', style: 'danger' }]] }), /red is only/));
  assert.deepEqual(lintMessage({ text: 'Текст', keyboard: [[{ text: 'Отключить', data: 'off|y', style: 'danger' }]] }), []);
  assert.ok(has(lintMessage({ text: 'Текст', keyboard: [[{ text: 'Сайт', url: 'http://x.example' }]] }), /url/));
  assert.ok(has(lintMessage({ text: 'Текст', keyboard: [[{ text: 'Сайт', url: 'https://x.example', data: 'a' }]] }), /exactly one/));
});

test('button widths and rows (spec §3)', () => {
  const row = (...labels: string[]) => [labels.map((text, i) => ({ text, data: `d${i}` }))];
  assert.deepEqual(lintMessage({ text: 'Т', keyboard: row('7:30', '19:00', '20:00', '21:00') }), []);
  assert.ok(has(lintMessage({ text: 'Т', keyboard: row('Другое', 'время', 'потом', 'сейчас') }), /limit 5/));
  assert.deepEqual(lintMessage({ text: 'Т', keyboard: row('Другая дата', '‹ Назад') }), []);
  assert.ok(has(lintMessage({ text: 'Т', keyboard: row('Другая дата сейчас', 'Назад') }), /limit 12/));
  assert.ok(has(lintMessage({ text: 'Т', keyboard: row('Один', 'Два', 'Девятьбукв') }), /limit 8/));
  assert.deepEqual(lintMessage({ text: 'Т', keyboard: row('А', 'Б', 'В', 'Г', 'Д') }), []);
  assert.ok(has(lintMessage({ text: 'Т', keyboard: row('А', 'Б', 'В', 'Г', 'Д', 'Е') }), /row of 6/));
  assert.deepEqual(lintMessage({ text: 'Т', keyboard: row('Дальше: Компьютерные сети') }), []);
  assert.ok(has(lintMessage({ text: 'Т', keyboard: row('Дальше: Компьютерные сети и') }), /limit 26/));
  assert.ok(has(lintMessage({ text: 'Т', keyboard: row('Вариант длиной в двадцать пять'), options: ['Вариант длиной в двадцать пять'] }), /limit 24/));
});

test('copy rules: emoji, «!», capitals, «не X, а Y», forbidden words; the user\'s own names are exempt', () => {
  assert.ok(has(lintMessage({ text: 'Готово 🎉' }), /emoji/));
  assert.ok(has(lintMessage({ text: 'Готово!' }), /«!»/));
  assert.ok(has(lintMessage({ text: 'ВНИМАНИЕ' }), /capitals/));
  assert.ok(has(lintMessage({ text: 'Это не тренажёр, а план' }), /не X, а Y/));
  for (const word of ['тест', 'контейнер', 'преподавателю', 'колледжа', 'аккредитация', 'пробный', 'правильный ответ', 'засчитано', 'сгорело',
    'повторение', 'на проверку', 'спорный', 'сессия', 'вместо']) {
    assert.ok(has(lintMessage({ text: `Слово ${word} здесь` }), /forbidden/), word);
  }
  assert.deepEqual(lintMessage({ text: t('Экзамен — «Осенняя сессия», 3 ноября.'), user: ['Осенняя сессия'] }), []);
  assert.ok(has(lintMessage({ text: 'Экзамен', keyboard: [[{ text: 'Пробный тест', data: 'x' }]] }), /button/));
  assert.ok(has(lintMessage({ text: 'Текст', toasts: ['Верно!'] }), /toast/));
  assert.ok(has(lintMessage({ text: 'Текст', toasts: ['я'.repeat(201)] }), /201/));
  assert.deepEqual(lintMessage({ text: '<code>if (!ok) return;</code>' }), [], 'code is not copy');
});

test('no-break spaces after numbers and one-letter words', () => {
  assert.ok(has(lintMessage({ text: 'Сегодня 20 вопросов' }), /after a number/));
  assert.ok(has(lintMessage({ text: 'верно в два разных дня' }), /one-letter/));
  assert.deepEqual(lintMessage({ text: `Сегодня 20${NBSP}вопросов, верно в${NBSP}два дня` }), []);
});

test('profile: Telegram limits, command names, copy', () => {
  const good = { name: 'Meldy', shortDescription: 'Коротко', description: 'Описание', commands: [{ command: 'today', description: 'План на сегодня' }] };
  assert.deepEqual(lintProfile(good), []);
  assert.ok(has(lintProfile({ ...good, name: 'М'.repeat(65) }), /name 65/));
  assert.ok(has(lintProfile({ ...good, shortDescription: 'к'.repeat(121) }), /short description 121/));
  assert.ok(has(lintProfile({ ...good, description: 'о'.repeat(513) }), /description 513/));
  assert.ok(has(lintProfile({ ...good, commands: [{ command: 'Today', description: 'x' }] }), /command Today/));
  assert.ok(has(lintProfile({ ...good, commands: [{ command: 'a'.repeat(33), description: 'x' }] }), /command a/));
});
