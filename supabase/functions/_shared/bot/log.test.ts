import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanEntry, errorName, log, setLogSink } from './log.ts';
import { TEST_TOKEN } from './fixtures/fake_telegram.ts';

test('one JSON line with only the allowed fields; free text never passes', () => {
  const lines: Array<{ line: string; failed: boolean }> = [];
  const restore = setLogSink((line, failed) => lines.push({ line, failed }));
  try {
    log({ route: 'webhook', update_id: 9001, kind: 'message', ms: 12.4, outcome: 'ok' });
    log({ route: 'webhook', update_id: 9002, kind: 'callback', outcome: 'failed', error_name: 'DbError', tg_code: 0 });
    log({ route: 'tick', kind: 'reminders', outcome: 'ok', counts: { claimed: 3, sent: 2, 'bad key with spaces': 1 } });
    // Whatever a caller passes by mistake, the line holds none of it.
    log({ route: 'webhook', outcome: `sent to ${TEST_TOKEN}`, error_name: `error sending request for url (https://api.telegram.org/bot${TEST_TOKEN}/getMe)`,
      kind: 'Привет, Иван', ...({ text: 'Секрет', chat_id: 555, user_id: 777 } as object) } as never);
  } finally {
    restore();
  }
  assert.equal(lines.length, 4);
  assert.deepEqual(JSON.parse(lines[0].line), { route: 'webhook', outcome: 'ok', update_id: 9001, kind: 'message', ms: 12 });
  assert.equal(lines[0].failed, false);
  assert.equal(lines[1].failed, true);
  assert.deepEqual(JSON.parse(lines[2].line).counts, { claimed: 3, sent: 2 });
  const last = lines[3].line;
  assert.ok(!last.includes('TEST_TOKEN_NOT_REAL') && !last.includes('api.telegram.org') && !last.includes('Иван') && !last.includes('555') && !last.includes('777'), last);
  assert.deepEqual(JSON.parse(last), { route: 'webhook', outcome: 'invalid', kind: 'invalid', error_name: 'invalid' });
});

test('errorName keeps only a plain name', () => {
  assert.equal(errorName(new TypeError('x')), 'TypeError');
  assert.equal(errorName(Object.assign(new Error('x'), { name: 'bad name with spaces' })), 'Error');
  assert.equal(errorName('a string'), 'Error');
  assert.equal(errorName(null), 'Error');
  assert.deepEqual(cleanEntry({ route: 'status', outcome: 'ok', ms: Number.NaN }), { route: 'status', outcome: 'ok' });
});
