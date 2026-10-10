// The «занятие» as messages (spec §4.3 Z1–Z12, §4.8): every message as a snapshot (text + keyboard JSON) through the
// linter; the layout rules; the bold that moves to the answer from the file; 4096.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode } from './codec.ts';
import { visibleLength, visibleText } from './html.ts';
import { lintMessage } from './lint.ts';
import type { Out } from './tg.ts';
import * as W from './words.ts';
import { layoutOf, optionLabel, type QuestionItem } from './question.ts';
import {
  examGoneOut, fitsTelegram, headerText, keysUrl, movedOut, questionKeyboard, questionOut, retryOut, reviewOut, rightToast, S,
  shortRightOut, userWords, type QuestionView, type Shown,
} from './render.ts';
import { ACID, DRAW, HTTPS, IPV4_BITS, POSTFIX, PRIVATE_IP, tooLong, type BankItem } from './fixtures/session/bank.ts';
import { matchSnapshots, type Shot } from './fixtures/session/snapshot.ts';
import { TITLE } from './fixtures/scenario.ts';

const SITE = 'https://ludosiel-studyforge.hf.space';
const SID = '7k2pm9qa';
const CID = 'a1b2c3d4-0000-4000-8000-000000000001';
const SUBJECT = 'b1b2c3d4-0000-4000-8000-000000000101';

type Spec = Omit<BankItem, 'id' | 'containerId' | 'subjectId'>;

/** A question as the session shows it, the options in the spec's (file) order unless `order` says otherwise. */
function view(spec: Spec, subject: string, n: number, extra: Partial<QuestionView> = {}, order?: number[]): QuestionView {
  const o = order ?? spec.options.map((_, i) => i);
  const item: QuestionItem = {
    id: 'e1e2c3d4-0000-4000-8000-000000000001', kind: spec.kind, stem: spec.stem, options: o.map((i) => spec.options[i]), code: spec.code,
    keepOrder: spec.keepOrder, fileNo: spec.fileNo, position: spec.position, topicTitle: spec.topicTitle, keySource: spec.keySource, rev: spec.rev,
    keyChangedAt: null,
  };
  return { sid: SID, pos: n - 1, subject, n, of: 20, retry: false, item, role: 'member', containerId: CID, subjectId: SUBJECT, ...extra };
}

/** The visible words with plain spaces (the renderer glues numbers and short words with no-break spaces). */
const words = (html: string) => visibleText(html).replace(/\u00a0/g, ' ');

const shown = (s: Partial<Shown>): Shown => ({ dontKnow: false, key: [], chosen: [], forms: [], text: null, again: true, recorded: false, ...s });

function check(name: string, out: Out, v: QuestionView, s?: Shown | null, toasts?: string[]): Shot {
  const options = layoutOf(v.item).mode === 'buttons' ? v.item.options.map(optionLabel) : [];
  const problems = lintMessage({ text: out.text, keyboard: out.keyboard, chat: 'private', user: [...userWords(v, s), TITLE], options, toasts });
  assert.deepEqual(problems, [], `${name}: ${problems.join('; ')}`);
  return toasts ? { text: out.text, keyboard: out.keyboard ?? null, toasts } : { text: out.text, keyboard: out.keyboard ?? null };
}

const NETS = 'Компьютерные сети';
const DB = 'Базы данных';
const CS = 'Основы программирования';

test('every message of the «занятие» (Z1–Z12, §4.8) passes the linter and matches its snapshot', () => {
  const z1 = view(HTTPS, NETS, 3);
  const z2 = view(ACID, DB, 7);
  const z3 = view(DRAW, CS, 5);
  const z3stem = view(POSTFIX, CS, 6);
  const z4 = view(PRIVATE_IP, NETS, 9);
  const z4letters = view({ ...PRIVATE_IP, options: ['Адрес из диапазона 10.0.0.0/8', 'Адрес из диапазона 172.16.0.0/12', 'Адрес из диапазона 192.168.0.0/16', 'Публичный адрес DNS-сервера', 'Адрес обратной петли 127.0.0.1'], correct: [0, 1, 2] }, NETS, 10);
  const z5 = view(IPV4_BITS, NETS, 11);
  const z10 = view(ACID, DB, 9, { retry: true, pos: 9 });
  const author = view(ACID, DB, 7, { role: 'owner' });
  const noted = view({ ...ACID, keySource: 'manual' }, DB, 7);
  noted.item.keyChangedAt = '2026-10-16T08:00:00Z';

  const wrongButtons = shown({ key: [2], chosen: [0] });
  const wrongLetters = shown({ key: [1], chosen: [2] });
  const wrongCode = shown({ key: [1], chosen: [0] });
  const wrongMultiple = shown({ key: [0, 1, 2], chosen: [0, 2] });
  const wrongMultipleLetters = shown({ key: [0, 1, 2], chosen: [0, 3] });
  const typedWrong = shown({ forms: IPV4_BITS.answers, text: '23' });
  const dontKnow = shown({ dontKnow: true, key: [1] });

  const toasts = [rightToast('single', 1, null), rightToast('single', 1, { twoDays: 144, inPlan: 960 }), rightToast('multiple', 3, null),
    rightToast('multiple', 2, null), rightToast('multiple', 3, { twoDays: 144, inPlan: 960 }), S.markOne];
  const shots: Record<string, Shot> = {
    z1_buttons: check('z1', questionOut(z1), z1),
    z2_letters: check('z2', questionOut(z2), z2),
    z3_code_options: check('z3', questionOut(z3), z3),
    z3_code_question: check('z3stem', questionOut(z3stem), z3stem),
    z4_multiple: check('z4', questionOut(z4), z4),
    z4_multiple_marked: check('z4m', questionOut(z4, 0b0010), z4),
    z4_multiple_letters: check('z4l', questionOut(z4letters, 0b00101), z4letters),
    z5_short: check('z5', questionOut(z5), z5),
    z5_short_right: check('z5r', shortRightOut(z5, 'тридцать два'), z5, shown({ forms: IPV4_BITS.answers, text: 'ТРИДЦАТЬ  ДВА' })),
    z5_short_wrong: check('z5w', reviewOut(z5, typedWrong, 'review', { site: SITE }), z5, typedWrong),
    z5_short_dont_know: check('z5x', reviewOut(z5, shown({ dontKnow: true, forms: IPV4_BITS.answers }), 'review', { site: SITE }), z5, shown({ forms: IPV4_BITS.answers })),
    z6_lines: check('z6', questionOut(z1), z1, null, toasts),
    z7_wrong_buttons: check('z7b', reviewOut(z1, wrongButtons, 'review', { site: SITE }), z1, wrongButtons),
    z7_wrong_letters: check('z7l', reviewOut(z2, wrongLetters, 'review', { site: SITE }), z2, wrongLetters),
    z7_wrong_code: check('z7c', reviewOut(z3, wrongCode, 'review', { site: SITE }), z3, wrongCode),
    z7_wrong_multiple: check('z7m', reviewOut(z4, wrongMultiple, 'review', { site: SITE }), z4, wrongMultiple),
    z7_wrong_multiple_letters: check('z7ml', reviewOut(z4letters, wrongMultipleLetters, 'review', { site: SITE }), z4letters, wrongMultipleLetters),
    z7_last_repeat: check('z7r', reviewOut(z2, { ...wrongLetters, again: false }, 'review', { site: SITE }), z2, wrongLetters),
    z7_recorded: check('z7rec', reviewOut(z2, { ...wrongLetters, recorded: true }, 'review', { site: SITE }), z2, wrongLetters),
    z7_notes: check('z7n', reviewOut(noted, wrongLetters, 'review', { site: SITE }), noted, wrongLetters),
    z8_dont_know: check('z8', reviewOut(z2, dontKnow, 'review', { site: SITE }), z2, dontKnow),
    z9_misclick: check('z9', reviewOut(z2, wrongLetters, 'misclick', { site: SITE }), z2, wrongLetters),
    z10_repeat: check('z10', questionOut(z10), z10),
    z11_doubt: check('z11', reviewOut(z2, wrongLetters, 'doubt', { site: SITE }), z2, wrongLetters),
    z11_doubted: check('z11d', reviewOut(z2, wrongLetters, 'doubted', { site: SITE }), z2, wrongLetters),
    z12_author: check('z12', reviewOut(author, wrongLetters, 'review', { site: SITE }), author, wrongLetters),
    f_db_down_again: check('f1', retryOut(headerText({ subject: DB, n: 8, of: 20, retry: false }), `s|${SID}|7|1`), z2),
    f_exam_gone: check('f2', examGoneOut(TITLE), z2),
    f_moved: check('f3', movedOut(), z2),
  };
  for (const toast of toasts) assert.ok([...toast].length <= 200);
  matchSnapshots('session', shots);
});

test('Z1/Z2: the question in bold; letters in the text with U+2002, no empty lines between them; «Не знаю · Закончить» last; no blue', () => {
  const z1 = questionOut(view(HTTPS, NETS, 3));
  assert.equal(visibleText(z1.text).replace(/\u00a0/g, ' '), 'Компьютерные сети · 3 из 20\n\nКакой протокол передаёт веб-страницы в зашифрованном виде?');
  assert.match(z1.text, /<b>Какой протокол/);
  assert.deepEqual(z1.keyboard!.map((r) => r.map((b) => b.text)), [['HTTP'], ['FTP'], ['HTTPS'], ['SMTP'], ['Telnet'], ['Не знаю', 'Закончить']]);
  assert.deepEqual(z1.keyboard!.map((r) => r.map((b) => decode(b.data)!)).flat().map((c) => (c.kind === 'session' ? c.act : null)),
    [{ a: 'option', i: 0 }, { a: 'option', i: 1 }, { a: 'option', i: 2 }, { a: 'option', i: 3 }, { a: 'option', i: 4 }, { a: 'dont_know' }, { a: 'finish' }]);
  assert.ok(z1.keyboard!.flat().every((b) => b.style === undefined), 'the answer is the action: no blue');
  const z2 = questionOut(view(ACID, DB, 7));
  assert.ok(z2.text.includes('<b>А</b> Изменения завершённой транзакции'));
  assert.ok(!/\n\n<b>Б/.test(z2.text), 'no empty line between the letters');
  assert.deepEqual(z2.keyboard![0].map((b) => b.text), ['А', 'Б', 'В', 'Г']);
});

test('Z3: code options in <code> (never inside <b>), the question\'s code in <pre><code class="language-csharp">', () => {
  const z3 = questionOut(view(DRAW, CS, 5));
  assert.ok(z3.text.includes('<b>Б</b> <code>public virtual void Draw()</code>'));
  const stem = questionOut(view(POSTFIX, CS, 6));
  assert.ok(stem.text.includes('<b>Что выведет программа?</b>\n<pre><code class="language-csharp">int x = 7;\nint y = x++ + ++x;\nConsole.WriteLine(y);</code></pre>'));
  assert.deepEqual(stem.keyboard!.slice(0, 4).map((r) => r.map((b) => b.text)), [['14'], ['15'], ['16'], ['17']]);
  const review = reviewOut(view(DRAW, CS, 5), shown({ key: [1], chosen: [0] }), 'review', { site: SITE });
  assert.ok(review.text.includes('<b>В\u00a0файле\u00a0— Б</b>\n<code>public virtual void Draw()</code>'), 'bold may not hold code: the heading is bold');
  assert.ok(review.text.includes('Ваш ответ\u00a0— А\n<code>public static void Draw()</code>'));
});

test('Z4: a mark changes only the keyboard, the marks ride in callback_data (t<mask>), «Ответить» a<mask> is the one blue', () => {
  const v = view(PRIVATE_IP, NETS, 9);
  const keyboard = questionKeyboard(v, 0b0010);
  assert.deepEqual(keyboard.map((r) => r.map((b) => b.text)), [['10.4.0.9'], ['✓ 172.20.1.1'], ['192.168.3.7'], ['8.8.4.4'], ['Ответить'], ['Не знаю', 'Закончить']]);
  assert.deepEqual(keyboard.slice(0, 4).map((r) => r[0].data), [`s|${SID}|8|t3`, `s|${SID}|8|t0`, `s|${SID}|8|t6`, `s|${SID}|8|t10`]);
  assert.equal(keyboard[4][0].data, `s|${SID}|8|a2`);
  assert.equal(keyboard[4][0].style, 'primary');
  assert.equal(questionOut(v, 0b0010).text, questionOut(v, 0).text, 'the text stays');
  assert.match(words(questionOut(v).text), /Верных ответов несколько — отметьте все\./);
});

test('Z7: the question loses its bold, the answer from the file takes it; «В файле» / «Ваш ответ»; № and the topic from the file', () => {
  const out = reviewOut(view(ACID, DB, 7), shown({ key: [1], chosen: [2] }), 'review', { site: SITE });
  const words = visibleText(out.text).replace(/\u00a0/g, ' ');
  assert.equal(words, [
    'Базы данных · 7 из 20', '', 'Что гарантирует изолированность — буква I в ACID?', '',
    'В файле — Б', 'Параллельные транзакции не видят промежуточных изменений друг друга', 'Ваш ответ — В',
    'Транзакция выполняется целиком или не выполняется совсем', '', 'Неверно. Вернётся через пару вопросов и завтра.', '№ 57 · Тема 3. Транзакции',
  ].join('\n'));
  assert.ok(!out.text.includes('<b>Что гарантирует'), 'the question is no longer bold');
  assert.ok(out.text.includes('<b>Параллельные транзакции'));
  assert.deepEqual(out.keyboard!.map((r) => r.map((b) => b.text)), [['Дальше'], ['Нажали не туда?'], ['Сомневаюсь в ключе']]);
  assert.equal(out.keyboard!.flat().filter((b) => b.style === 'primary').length, 1);
  const buttons = reviewOut(view(HTTPS, NETS, 3), shown({ key: [2], chosen: [0] }), 'review', { site: SITE });
  assert.ok(visibleText(buttons.text).replace(/\u00a0/g, ' ').includes('В файле — HTTPS\nВаш ответ — HTTP'));
  const multiple = reviewOut(view(PRIVATE_IP, NETS, 9), shown({ key: [0, 1, 2], chosen: [0, 2] }), 'review', { site: SITE });
  assert.ok(multiple.text.includes('<b>10.4.0.9, 172.20.1.1, 192.168.3.7</b>'));
  assert.ok(visibleText(multiple.text).replace(/\u00a0/g, ' ').includes('В файле верны: 10.4.0.9, 172.20.1.1, 192.168.3.7\nВаш ответ: 10.4.0.9, 192.168.3.7'));
});

test('Z8, Z9, Z11, Z12: «Не знаю» has no «Ваш ответ» nor «Неверно.»; the misclick keeps «В файле»; the author\'s key goes to «Ключи»', () => {
  const v = view(ACID, DB, 7);
  const z8 = words(reviewOut(v, shown({ dontKnow: true, key: [1] }), 'review', { site: SITE }).text);
  assert.ok(!z8.includes('Ваш ответ') && !z8.includes('Неверно'));
  assert.ok(z8.includes('Вернётся через пару вопросов и завтра.'));
  const z9 = reviewOut(v, shown({ key: [1], chosen: [2] }), 'misclick', { site: SITE });
  assert.ok(!visibleText(z9.text).includes('Ваш ответ'));
  assert.ok(visibleText(z9.text).replace(/\u00a0/g, ' ').includes('Отменили: ошибку не считаем. Ответ вы уже видели — вопрос вернётся завтра.'));
  assert.deepEqual(z9.keyboard!.map((r) => r.map((b) => b.text)), [['Дальше']]);
  const z11 = reviewOut(v, shown({ key: [1], chosen: [2] }), 'doubt', { site: SITE });
  assert.deepEqual(z11.keyboard!.map((r) => r.map((b) => [b.text, b.data])), [[['Отметить', `s|${SID}|6|D`]], [['Отмена', `s|${SID}|6|b`]]]);
  const author = reviewOut(view(ACID, DB, 7, { role: 'owner' }), shown({ key: [1], chosen: [2] }), 'review', { site: SITE });
  assert.deepEqual(author.keyboard!.at(-1), [{ text: 'Ключ неверный?', url: `${SITE}/exams/c/${CID}/keys?s=${SUBJECT}&no=57` }]);
  assert.equal(keysUrl(SITE, { containerId: CID, subjectId: SUBJECT, item: { ...view(ACID, DB, 1).item, fileNo: '' } }), `${SITE}/exams/c/${CID}/keys?s=${SUBJECT}&no=57`);
  const typed = reviewOut(view(IPV4_BITS, NETS, 11), shown({ forms: ['32'], text: '23' }), 'review', { site: SITE });
  assert.ok(!typed.keyboard!.flat().some((b) => b.text === 'Нажали не туда?'), 'Z5: a typed answer is not a press');
  const flushed = reviewOut(v, shown({ key: [1], chosen: [2], recorded: true }), 'review', { site: SITE });
  assert.ok(!flushed.keyboard!.flat().some((b) => b.text === 'Нажали не туда?'), 'recorded by the flush: no «Нажали не туда?»');
});

test('Z6: «Верно.»; on the step two_days the figure in the plan\'s words; several: «Верно: все 3.» / «Верно: оба.»', () => {
  assert.equal(rightToast('single', 1, null), 'Верно.');
  assert.equal(rightToast('single', 1, { twoDays: 144, inPlan: 960 }), 'Верно. Теперь 144 из 960 — верно в два разных дня.');
  assert.equal(rightToast('multiple', 3, null), 'Верно: все 3.');
  assert.equal(rightToast('multiple', 2, null), 'Верно: оба.');
  assert.equal(visibleText(shortRightOut(view(IPV4_BITS, NETS, 11), 'тридцать два').text).split('\n')[4], 'Верно: тридцать два.');
});

test('4096: a question that fits, and one that does not (question up to 4000 + options up to 600) — left to the site', () => {
  assert.ok(fitsTelegram(view(ACID, DB, 7), { site: SITE }));
  assert.ok(fitsTelegram(view(IPV4_BITS, NETS, 11), { site: SITE }));
  const long = view(tooLong(), DB, 8);
  assert.ok(!fitsTelegram(long, { site: SITE }));
  assert.ok(visibleLength(questionOut(long).text) > 4096);
  const almost = view({ ...ACID, stem: 'Вопрос '.repeat(480).trim() }, DB, 8);
  assert.ok(visibleLength(questionOut(almost).text) <= 4096);
  assert.equal(fitsTelegram(almost, { site: SITE }), visibleLength(reviewOut(almost, shown({ key: [1], chosen: [0] }), 'doubt', { site: SITE }).text) <= 4096
    && visibleLength(reviewOut(almost, shown({ key: [1], chosen: [0] }), 'review', { site: SITE }).text) <= 4096);
});

test('§4.8: «Повторить» repeats the press\'s own data; the exam gone names it; the words come from words.ts', () => {
  const out = retryOut('Базы данных · 8 из 20', `s|${SID}|7|1`);
  assert.deepEqual(out.keyboard, [[{ text: W.RETRY, data: `s|${SID}|7|1`, style: 'primary' }]]);
  assert.equal(visibleText(out.text).replace(/\u00a0/g, ' '), `Базы данных · 8 из 20\n${W.DB_DOWN_AGAIN}`);
  assert.equal(visibleText(retryOut(null, 'x').text).replace(/\u00a0/g, ' '), W.DB_DOWN_AGAIN);
  assert.equal(words(examGoneOut(TITLE).text), 'Экзамен «Осенняя сессия» больше недоступен — занятие закрыто.');
});
