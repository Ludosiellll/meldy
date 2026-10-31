/**
 * Release 48 (docs/kinds/CONTRACT.md §4) in the bot: a number and a one-gap cloze are asked as typed answers, the
 * review says the author's explanation, and the questions the chat cannot ask are named with «Открыть в приложении».
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { reviewOut, shortRightOut, type QuestionView, type Shown } from './render.ts';
import { sessionApi } from './session.ts';
import * as W from './words.ts';

const view = (kind: 'short' | 'single'): QuestionView => ({
  sid: 'kd000001', pos: 0, subject: 'Физика', n: 1, of: 2, retry: false, role: 'member', containerId: 'c', subjectId: 's',
  item: { id: 'i', kind, stem: 'Ускорение свободного падения', options: kind === 'short' ? [] : ['9,8', '10'], code: false, keepOrder: false,
          fileNo: '7', position: 7, topicTitle: null, keySource: 'manual', rev: 1, keyChangedAt: null },
});
const shown = (explanation: string | null): Shown => ({ dontKnow: false, key: [], chosen: [], forms: ['9.8 м/с²'], text: '10', again: true, explanation });

test('the review of a wrong answer says the explanation, escaped', () => {
  const out = reviewOut(view('short'), shown('У поверхности <Земли>.'), 'review', { site: 'https://x' });
  assert.match(out.text, /<b>Пояснение:<\/b> У поверхности &lt;Земли&gt;\./);
  assert.match(out.text, /9\.8 м\/с²/);
});

test('without an explanation the review is as before', () => {
  const before = reviewOut(view('short'), shown(null), 'review', { site: 'https://x' });
  assert.doesNotMatch(before.text, /Пояснение/);
});

test('a right typed answer says the explanation too; a long one is cut', () => {
  const out = shortRightOut(view('short'), '9.8 м/с²', 'слово '.repeat(400));
  assert.match(out.text, /<b>Пояснение:<\/b> слово/);
  assert.ok(out.text.length < 4096);
  assert.match(out.text, /…/);
});

test('number and cloze come from the database as typed questions; order and match do not come at all', async () => {
  const db = {
    rpc: async () => ({
      status: 'ok',
      in_app: 2,
      items: [
        { id: 'n', subject_id: 's', kind: 'number', options: [], rev: 1 },
        { id: 'c', subject_id: 's', kind: 'cloze', options: [], rev: 1 },
        { id: 'o', subject_id: 's', kind: 'order', options: ['a', 'b'], rev: 1 },
        { id: 'x', subject_id: 's', kind: 'single', options: ['a', 'b'], rev: 1 },
      ],
    }),
  };
  const api = sessionApi(db as never);
  const reply = await api.items(1, 'c', ['n', 'c', 'o', 'x']);
  assert.deepEqual(reply.items.map((item) => [item.id, item.kind]), [['n', 'short'], ['c', 'short'], ['x', 'single']]);
  assert.equal(reply.inApp, 2);
});

test('the words of the questions left to the site', () => {
  const plain = (text: string) => text.split(String.fromCharCode(160)).join(' ');
  assert.equal(plain(W.inApp(1)), '1 вопрос этого занятия — на порядок, пары или пропуски. Их удобнее решать в приложении.');
  assert.equal(plain(W.inApp(3)).startsWith('3 вопроса'), true);
  assert.equal(W.OPEN_IN_APP, 'Открыть в приложении');
});
