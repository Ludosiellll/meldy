// «Экзамены» and «Перенести экзамен» (release 47, docs/superpowers/plans/2026-10-18-exam-move-bot-exams.md): every
// screen through the linter and its snapshot; the rows' labels fit a full-width button; the typed dates of a move.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choiceLabel, examsScreen, isMovePrompt, MAX_EXAM_ROWS, moveAskScreen, moveDateProblem, movedScreen } from './exams.ts';
import { decode } from './codec.ts';
import { isDatePrompt } from './settings.ts';
import { lintMessage, WIDTH } from './lint.ts';
import { t, visibleText } from './html.ts';
import type { BotExam } from './db.ts';
import type { Out } from './tg.ts';
import { AUTUMN, botExamsOf, CID, CID2, TITLE, TITLE2 } from './fixtures/scenario.ts';
import { matchSnapshots, type Shot } from './fixtures/snapshot.ts';
import * as W from './words.ts';

const WINTER = { id: CID2, title: TITLE2, date: '2026-12-20' };
const EXAMS: BotExam[] = botExamsOf([AUTUMN, { ...WINTER, on: false }]);

function check(name: string, out: Out, user: string[] = [], toasts?: string[]): Shot {
  const labels = (out.keyboard ?? []).flat().map((b) => b.text);
  const problems = lintMessage({ text: out.text, keyboard: out.keyboard, user: [...user, ...labels.filter((l) => /^[✓—] /.test(l))], toasts });
  assert.deepEqual(problems, [], `${name}: ${problems.join('; ')}`);
  return toasts ? { text: out.text, keyboard: out.keyboard ?? null, toasts } : { text: out.text, keyboard: out.keyboard ?? null };
}
const prompt = (text: string): Out => ({ text: t(text), keyboard: null });

test('every screen of «Экзамены» and «Перенести экзамен» passes the linter and matches its snapshot', () => {
  const shots: Record<string, Shot> = {
    exams_from_settings: check('exams_from_settings', examsScreen(EXAMS, 's'), [TITLE, TITLE2]),
    exams_from_card: check('exams_from_card', examsScreen(EXAMS, 'c'), [TITLE, TITLE2]),
    exams_none: check('exams_none', examsScreen([], 's')),
    move_ask: check('move_ask', moveAskScreen(TITLE, '2026-11-10', CID), [TITLE]),
    moved: check('moved', movedScreen(TITLE, '2026-11-10'), [TITLE]),
    move_prompt: check('move_prompt', prompt(W.MOVE_PROMPT)),
    move_bad: check('move_bad', prompt(W.MOVE_BAD)),
    move_past: check('move_past', prompt(W.MOVE_PAST)),
    move_far: check('move_far', prompt(W.MOVE_FAR)),
    move_lost: check('move_lost', prompt(W.MOVE_LOST)),
    move_toasts: check('move_toasts', { text: t(W.examMoved(TITLE, '2026-11-10')), keyboard: null }, [TITLE], [W.MOVE_ONLY_OWNER, W.EXAM_GONE, W.MOVE_PAST, W.MOVE_FAR, W.NOT_LINKED]),
  };
  matchSnapshots('exams', shots);
});

test('«Какие экзамены присылать»: ✓ in the plan, — not; a press switches it; «‹ Назад» to S1 or to the card', () => {
  const screen = examsScreen(EXAMS, 's');
  assert.deepEqual(visibleText(screen.text).replace(/ /g, ' ').split('\n'),
    ['Какие экзамены присылать', 'Отметьте экзамены, по которым приходит план на день. Можно несколько.']);
  const rows = screen.keyboard!.map((r) => r.map((b) => [b.text, b.data]));
  // «✓ Осенняя сессия · 3 ноября» is 27 characters: past a full-width button (26, §3), so the date gives way.
  assert.deepEqual(rows, [
    [['✓ Осенняя сессия', `xr|${CID}|0|s`]],
    [['— Зимняя сессия', `xr|${CID2}|1|s`]],
    [['‹ Назад', 'st|back']],
  ]);
  assert.deepEqual(decode(rows[1][0][1]), { kind: 'remind', cid: CID2, on: true, from: 's' });
  assert.equal(examsScreen(EXAMS, 'c').keyboard!.at(-1)![0].data, 'xc');
  const many = Array.from({ length: 20 }, (_, i) => ({ ...EXAMS[0], id: `a1b2c3d4-0000-4000-8000-0000000001${String(i).padStart(2, '0')}` }));
  assert.equal(examsScreen(many, 'c').keyboard!.length, MAX_EXAM_ROWS + 1);
});

test('a row\'s label fits a full-width button: the date when it fits, else the title alone, a long title shortened with «…»', () => {
  const plain = (s: string) => s.replace(/ /g, ' ');
  assert.equal(plain(choiceLabel({ on: true, title: 'Анатомия', date: '2026-11-03' })), '✓ Анатомия · 3 ноября');
  assert.equal(choiceLabel({ on: true, title: TITLE, date: '2026-11-03' }), '✓ Осенняя сессия');
  assert.equal(choiceLabel({ on: false, title: 'Без даты', date: null }), '— Без даты');
  const label = choiceLabel({ on: true, title: 'Государственный междисциплинарный экзамен по специальности', date: '2026-09-30' });
  assert.equal([...label].length, WIDTH.full, label);
  assert.ok(label.startsWith('✓ Государственный') && label.endsWith('…'), label);
});

test('the move: for everyone or only for me (two rows: each label is wider than half a row); the answer and «План на сегодня»', () => {
  const ask = moveAskScreen(TITLE, '2026-11-10', CID);
  assert.equal(visibleText(ask.text).replace(/ /g, ' '),
    'Перенести «Осенняя сессия» на 10 ноября?\nВ экзамене есть участники. Новая дата может быть у всех или только у вас.');
  assert.deepEqual(ask.keyboard!.map((r) => r.map((b) => decode(b.data))), [
    [{ kind: 'moveFor', cid: CID, date: '2026-11-10', who: 'all' }],
    [{ kind: 'moveFor', cid: CID, date: '2026-11-10', who: 'me' }],
  ]);
  const moved = movedScreen(TITLE, '2026-11-10');
  assert.equal(visibleText(moved.text).replace(/ /g, ' '), 'Экзамен «Осенняя сессия» перенесён на 10 ноября. План пересчитан.');
  assert.deepEqual(moved.keyboard, [[{ text: 'План на сегодня', data: 'xc' }]]);
});

test('a typed date of a move: its prompts are told from the pause\'s; past, too far and not a date ask again', () => {
  for (const text of [W.MOVE_PROMPT, W.MOVE_BAD, W.MOVE_PAST, W.MOVE_FAR]) {
    assert.ok(isMovePrompt(text), text);
    assert.ok(!isDatePrompt(text), `${text} is not the pause's`);
  }
  for (const text of [W.DATE_PROMPT, W.DATE_BAD, W.DATE_PAST]) assert.ok(!isMovePrompt(text), text);
  const today = '2026-10-18';
  assert.equal(moveDateProblem(null, today), W.MOVE_BAD);
  assert.equal(moveDateProblem('2026-10-17', today), W.MOVE_PAST);
  assert.equal(moveDateProblem('2026-10-18', today), null, 'today: the exam day');
  assert.equal(moveDateProblem('2028-10-17', today), null, '730 days ahead');
  assert.equal(moveDateProblem('2028-10-18', today), W.MOVE_FAR);
});
