// The bot's own words (spec §3–§5 with the container's v2.1/v2.2 overrides): every string through the copy rules,
// numbers worded by the copied words.ts, the overridden lines exactly as the brief gives them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyProblems } from './lint.ts';
import * as W from './words.ts';

/** Every Russian string the module can make: constants, lists, and the builders with sample values. */
function everyString(): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(W)) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) out.push(...value.filter((v): v is string => typeof v === 'string'));
    else if (name === 'PROFILE') out.push(W.PROFILE.name, W.PROFILE.shortDescription, W.PROFILE.description, ...W.PROFILE.commands.map((c) => c.description));
  }
  for (const n of [1, 2, 5, 21]) {
    out.push(W.dateWhen('2026-11-03', n), W.aboutMinutes(n * 10), W.alsoToday('Зимняя', n * 10), W.keysFixed(n), W.k2Body(n * 3, 45), W.k2Body(null, n),
      W.k3Days(n * 13, n, String(n * 1000), n * 1000), W.k3Figure(n, 960), W.onlyErrors(n), W.throughErrors(n), W.resume(n, 20));
  }
  out.push(W.examIs('Экзамен', '2026-11-03'), W.examIs('Экзамен', null), W.m2Time('20:00'), W.m3Title('7:30'), W.examLine('Экзамен', null),
    W.moreNewNote('Ещё 20 новых'), W.k2Yes('20:00'), W.k2YesDone('20:00'), W.examPassed('2026-11-03'), W.planAt('20:00', 'по Минску'),
    W.dateAfterExam('2026-11-03'), W.pauseUntil('2026-10-19', '2026-10-17'), W.pauseBack('2026-10-19', '2026-10-17', 3, '20:00'),
    W.unpaused('сегодня', '20:00'), W.examGone('Экзамен'));
  return out.filter((s) => s.length > 0);
}

test('every string of the bot passes the copy rules (forbidden words, emoji, «!», capitals, «не X, а Y»)', () => {
  const strings = everyString();
  assert.ok(strings.length > 120);
  for (const s of strings) {
    const problems = copyProblems(s, s.slice(0, 40));
    assert.deepEqual(problems, [], s);
    assert.ok(!/сгор|вместо|повторени|засчит|тест(?![а-яё])/i.test(s), s);
  }
});

test('the container\'s overrides, word for word (BUILD_BRIEF «Copy rules»)', () => {
  assert.equal(W.S3_BODY, 'До какого дня ничего не присылать? Вопросы разойдутся по следующим дням.');
  assert.equal(W.k2Body(15, 70).replace(/ /g, ' '), 'Три дня он оставался без ответа. До экзамена 15 дней, сегодня около 70 минут.');
  assert.equal(W.k2Body(null, 70).replace(/ /g, ' '), 'Три дня он оставался без ответа. Сегодня около 70 минут.');
});

test('numbers are worded by the copied words.ts (no plural rules of the bot\'s own)', () => {
  const plain = (s: string) => s.replace(/ /g, ' ');
  assert.equal(plain(W.dateWhen('2026-11-03', 18)), '3 ноября, через 18 дней');
  assert.equal(plain(W.dateWhen('2026-11-03', 21)), '3 ноября, через 21 день');
  assert.equal(plain(W.dateWhen('2026-11-03', 3)), '3 ноября, через 3 дня');
  assert.equal(plain(W.dateWhen('2026-11-03', 1)), '3 ноября, завтра');
  assert.equal(plain(W.dateWhen('2026-11-03', 0)), '3 ноября, сегодня');
  assert.equal(plain(W.keysFixed(1)), 'Автор исправил ключ в 1 вопросе — он начнётся заново.');
  assert.equal(plain(W.keysFixed(2)), 'Автор исправил ключ в 2 вопросах — они начнутся заново.');
  assert.equal(plain(W.keysFixed(5)), 'Автор исправил ключ в 5 вопросах — они начнутся заново.');
  assert.equal(plain(W.aboutMinutes(21)), 'около 21 минуты');
  assert.equal(plain(W.aboutMinutes(0)), 'около 1 минуты');
  assert.equal(plain(W.k3Days(26, 21, '6 480', 6480)), 'За 26 дней — 21 с занятиями, 6 480 ответов.');
  assert.equal(plain(W.k3Days(1, 1, '1', 1)), 'За 1 день — 1 с занятиями, 1 ответ.');
  assert.equal(plain(W.alsoToday('Зимняя сессия', 20)), 'Ещё сегодня: «Зимняя сессия» — около 20 минут.');
});

test('the pause\'s days and zones', () => {
  assert.equal(W.pauseUntil('2026-10-17', '2026-10-17'), 'Пауза до завтра.');
  assert.equal(W.pauseUntil('2026-10-19', '2026-10-17').replace(/ /g, ' '), 'Пауза до понедельника, 19 октября.');
  assert.equal(W.pauseUntil('2026-10-21', '2026-10-17').replace(/ /g, ' '), 'Пауза до среды, 21 октября.');
  assert.equal(W.pauseBack('2026-10-20', '2026-10-17', 4, '20:00'), 'Во вторник план снова придёт в 20:00. Заниматься можно и раньше — /today.');
  assert.equal(W.zoneText('Europe/Minsk'), 'по Минску');
  assert.equal(W.zoneText('Asia/Vladivostok'), 'по Владивостоку');
  assert.equal(W.zoneText('Pacific/Auckland'), '(Pacific/Auckland)');
});
