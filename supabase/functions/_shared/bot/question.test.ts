// One question of a «занятие» (spec §4.3, decisions 13–16): buttons or letters, code, masks, the short answer's
// normalisation, the seeded order («все перечисленные» last, keep_order), repeats 3–5 later at most twice.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  codeLike, comesAgain, counterAt, fileOptionsOf, flip, isMarked, layoutOf, letterRows, marked, matchedForm, orderFor,
  queueAfter, requeueAfterMiss, shortNorm, shownOrder, splitStem, typedAnswer, validMask, type QueueEntry,
} from './question.ts';
import { ACID, ALL_LISTED, DRAW, HTTPS, IPV4_BITS, KEEP_ORDER, POSTFIX, PRIVATE_IP } from './fixtures/session/bank.ts';
import { optionOrder, pinnedLast } from '../plan/session.ts';

const q = (spec: typeof HTTPS) => ({ kind: spec.kind, options: spec.options, code: spec.code, keepOrder: spec.keepOrder });
const ids = (n: number): QueueEntry[] => Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, retry: 0 as const }));

test('decision 13: short options on full-width buttons; long, multi-line, keep_order and code → letters; short answer → text', () => {
  assert.equal(layoutOf(q(HTTPS)).mode, 'buttons');
  assert.equal(layoutOf(q(PRIVATE_IP)).mode, 'buttons');
  assert.equal(layoutOf(q(ACID)).mode, 'letters', 'over 24 characters');
  assert.equal(layoutOf(q(KEEP_ORDER)).mode, 'letters', 'keep_order keeps the file order: letters');
  assert.equal(layoutOf(q(DRAW)).mode, 'letters', 'code options are always letters');
  assert.deepEqual(layoutOf(q(DRAW)).code, [true, true, true, true]);
  assert.equal(layoutOf(q(POSTFIX)).mode, 'buttons', 'code in the question only: short options stay buttons');
  assert.deepEqual(layoutOf(q(POSTFIX)).code, [false, false, false, false]);
  assert.equal(layoutOf(q(IPV4_BITS)).mode, 'text');
  assert.equal(layoutOf({ kind: 'single', options: ['Один', 'Два\nстроки'], code: false, keepOrder: false }).mode, 'letters', 'two lines');
  assert.equal(layoutOf({ kind: 'single', options: ['x'.repeat(24), 'y'], code: false, keepOrder: false }).mode, 'buttons', '24 fits');
  assert.equal(layoutOf({ kind: 'single', options: ['x'.repeat(25), 'y'], code: false, keepOrder: false }).mode, 'letters', '25 does not');
});

test('letters: up to 5 a row, by 4 for 6–8; five marked letters of several correct go 3 + 2', () => {
  assert.deepEqual(letterRows(4, false), [[0, 1, 2, 3]]);
  assert.deepEqual(letterRows(5, false), [[0, 1, 2, 3, 4]]);
  assert.deepEqual(letterRows(6, false), [[0, 1, 2, 3], [4, 5]]);
  assert.deepEqual(letterRows(8, false), [[0, 1, 2, 3], [4, 5, 6, 7]]);
  assert.deepEqual(letterRows(5, true), [[0, 1, 2], [3, 4]]);
  assert.deepEqual(letterRows(4, true), [[0, 1, 2, 3]]);
});

test('masks of several correct: shown indices as bits, a tap flips one, 0 < mask < 2^n', () => {
  assert.equal(flip(0, 1), 2);
  assert.equal(flip(2, 1), 0);
  assert.equal(flip(flip(0, 0), 3), 9);
  assert.ok(isMarked(9, 0) && isMarked(9, 3) && !isMarked(9, 1));
  assert.deepEqual(marked(13, 4), [0, 2, 3]);
  assert.ok(validMask(15, 4));
  assert.ok(!validMask(16, 4));
  assert.ok(!validMask(-1, 4));
  assert.ok(!validMask(1.5, 4));
});

test('a short answer is compared as the server does (meldy_short_norm): case, ё/е, spaces, one final period', () => {
  assert.equal(shortNorm('Ёлка  Зелёная.'), 'елка зеленая'); // the site's vector (model.test.ts)
  assert.equal(shortNorm('  rollback. '), 'rollback');
  assert.equal(shortNorm('ТРИДЦАТЬ\u00a0ДВА'), 'тридцать два');
  assert.equal(shortNorm('32..'), '32.');
  assert.equal(shortNorm(' \t\n '), '');
  // The normalisation shown: «Верно: <the file's form>.»
  assert.equal(matchedForm('ТРИДЦАТЬ  ДВА.', IPV4_BITS.answers), 'тридцать два');
  assert.equal(matchedForm(' 32 ', IPV4_BITS.answers), '32');
  assert.equal(matchedForm('23', IPV4_BITS.answers), null);
  assert.equal(typedAnswer('  '), null);
  assert.equal(typedAnswer('...'), '...', 'only one final period is dropped: «..» is left, a (wrong) answer');
  assert.equal([...(typedAnswer('я'.repeat(1500)) as string)].length, 1000, 'longer than the server grades: cut to 1000');
});

test('code: the site\'s codeLike and splitStem, the same vectors', () => {
  const stem = 'Что выведет программа?\nint a = 7;\nint b = 2;\nConsole.WriteLine(a / b);';
  assert.deepEqual(splitStem(stem, true), { before: 'Что выведет программа?', code: 'int a = 7;\nint b = 2;\nConsole.WriteLine(a / b);', after: '' });
  assert.equal(splitStem('Какая команда удаляет таблицу?', true).code, null);
  assert.equal(splitStem(stem, false).code, null);
  assert.equal(codeLike('    return x;'), true);
  assert.equal(codeLike('Какая нормальная форма (третья) нужна?'), false);
  assert.equal(codeLike('public virtual void Draw()'), true);
  assert.equal(codeLike('14'), false);
});

test('the order: seeded by <sid>:<pos> (the same everywhere), a retry gets a new one; keep_order keeps the file; «Все перечисленные» last', () => {
  const a = shownOrder(HTTPS.options, false, '7k2pm9qa', 3);
  assert.deepEqual(a, shownOrder(HTTPS.options, false, '7k2pm9qa', 3), 'the same seed, the same order');
  assert.deepEqual(a, optionOrder(5, false, pinnedLast(HTTPS.options), '7k2pm9qa:3'), 'the copied optionOrder, seed <sid>:<pos>');
  assert.deepEqual([...a].sort(), [0, 1, 2, 3, 4]);
  const others = [4, 5, 6, 7, 8, 9].map((pos) => shownOrder(HTTPS.options, false, '7k2pm9qa', pos).join());
  assert.ok(others.some((o) => o !== a.join()), 'another position (a retry): another order');
  assert.deepEqual(shownOrder(KEEP_ORDER.options, true, '7k2pm9qa', 3), [0, 1, 2, 3]);
  for (let pos = 0; pos < 30; pos += 1) {
    const order = shownOrder(ALL_LISTED.options, false, 'abcdefgh', pos);
    assert.equal(order[order.length - 1], 2, `«Все перечисленные» stays last (pos ${pos})`);
  }
  assert.deepEqual(orderFor({ kind: 'short', keepOrder: false, options: [] }, 'abcdefgh', 0), []);
  assert.deepEqual(fileOptionsOf(['C', 'A', 'B'], [2, 0, 1]), ['A', 'B', 'C']);
  assert.equal(fileOptionsOf(['A', 'B'], [0, 0]), null);
});

test('«7 из 20»: the planned question shown, a retry repeats its place', () => {
  const queue = ids(20);
  assert.deepEqual(counterAt(queue, 0), { n: 1, of: 20 });
  assert.deepEqual(counterAt(queue, 6), { n: 7, of: 20 });
  const withRetry = [...queue.slice(0, 9), { id: 'id-6', retry: 1 as const }, ...queue.slice(9)];
  assert.deepEqual(counterAt(withRetry, 9), { n: 9, of: 20 }, 'the retry at 9 reads «9 из 20»');
  assert.deepEqual(counterAt(withRetry, 10), { n: 10, of: 20 });
});

test('repeats: a mistake comes back 3–5 questions later, at most twice, with a new option order', () => {
  const queue = ids(20);
  for (const sid of ['7k2pm9qa', 'abcdefgh', '00000000', 'zzzzzzzz']) {
    for (let pos = 0; pos < 18; pos += 1) {
      const after = queueAfter(queue, pos, { correct: false }, sid);
      const at = after.findIndex((e, i) => i > pos && e.id === `id-${pos}`);
      assert.ok(at - pos >= 3 && at - pos <= 5 || at === after.length - 1, `${sid}@${pos}: back after ${at - pos}`);
      assert.equal(after[at].retry, 1);
    }
  }
  assert.ok(comesAgain(queue, 0, 'abcdefgh'));
  const second = [{ id: 'a', retry: 2 as const }];
  assert.ok(!comesAgain(second, 0, 'abcdefgh'), 'a second retry does not come back');
  assert.deepEqual(queueAfter(queue, 2, { correct: false, misclick: true }, 'abcdefgh'), queue, '«Нажали не туда?» changes nothing');
  assert.deepEqual(queueAfter(queue, 2, { correct: true }, 'abcdefgh'), queue);

  const facts = { id: 'id-4', kind: 'single' as const, keepOrder: false, fileOptions: HTTPS.options };
  const requeued = requeueAfterMiss(queue, 4, 'abcdefgh', facts)!;
  const at = requeued.findIndex((e, i) => i > 4 && e.id === 'id-4');
  assert.equal(requeued[at].retry, 1);
  assert.deepEqual(requeued[at].shown, shownOrder(HTTPS.options, false, 'abcdefgh', at), 'the repeat\'s order: seed <sid>:<its position>');
  assert.ok(requeued.every((e, i) => i === at || e.shown === undefined), 'only the new entry carries an order');
  assert.equal(requeueAfterMiss(queue, 4, 'abcdefgh', { ...facts, id: 'other' }), null);
  assert.equal(requeueAfterMiss([{ id: 'id-4', retry: 2 }], 0, 'abcdefgh', facts), null, 'twice already: nothing to add');
});
