import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Callback, decode, encode, MAX_BYTES } from './codec.ts';

const CID = '6f1c2a9e-3b4d-4e5f-8a7b-0c1d2e3f4a5b';
const SID = '7k2pm9qa';

const ALL: Array<[Callback, string]> = [
  [{ kind: 'session', sid: SID, pos: 3, act: { a: 'option', i: 4 } }, `s|${SID}|3|4`],
  [{ kind: 'session', sid: SID, pos: 3, act: { a: 'dont_know' } }, `s|${SID}|3|x`],
  [{ kind: 'session', sid: SID, pos: 3, act: { a: 'next' } }, `s|${SID}|3|n`],
  [{ kind: 'session', sid: SID, pos: 3, act: { a: 'misclick' } }, `s|${SID}|3|m`],
  [{ kind: 'session', sid: SID, pos: 3, act: { a: 'doubt' } }, `s|${SID}|3|d`],
  [{ kind: 'session', sid: SID, pos: 3, act: { a: 'doubt_mark' } }, `s|${SID}|3|D`],
  [{ kind: 'session', sid: SID, pos: 3, act: { a: 'doubt_back' } }, `s|${SID}|3|b`],
  [{ kind: 'session', sid: SID, pos: 12, act: { a: 'toggle', mask: 5 } }, `s|${SID}|12|t5`],
  [{ kind: 'session', sid: SID, pos: 12, act: { a: 'submit', mask: 255 } }, `s|${SID}|12|a255`],
  [{ kind: 'session', sid: SID, pos: 19, act: { a: 'finish' } }, `s|${SID}|19|f`],
  [{ kind: 'session', sid: SID, pos: 7, act: { a: 'continue' } }, `s|${SID}|7|c`],
  [{ kind: 'session', sid: SID, pos: 20, act: { a: 'done' } }, `s|${SID}|20|g`],
  [{ kind: 'go', cid: CID, mode: 'p' }, `go|${CID}|p`],
  [{ kind: 'go', cid: CID, mode: 'e' }, `go|${CID}|e`],
  [{ kind: 'go', cid: CID, mode: 'x' }, `go|${CID}|x`],
  [{ kind: 'exam', cid: CID }, `ex|${CID}`],
  [{ kind: 'exam', cid: null }, 'ex|l'],
  [{ kind: 'settings', screen: 'time' }, 'st|time'],
  [{ kind: 'settings', screen: 'pause' }, 'st|pause'],
  [{ kind: 'settings', screen: 'off' }, 'st|off'],
  [{ kind: 'settings', screen: 'back' }, 'st|back'],
  [{ kind: 'time', minutes: 19 * 60 + 30, from: 'link' }, 't|1930'],
  [{ kind: 'time', minutes: 7 * 60 + 30, from: 'settings' }, 't|0730|s'],
  [{ kind: 'time', minutes: null, from: 'link' }, 't|other'],
  [{ kind: 'time', minutes: null, from: 'settings' }, 't|other|s'],
  [{ kind: 'pause', choice: '1' }, 'p|1'],
  [{ kind: 'pause', choice: '3' }, 'p|3'],
  [{ kind: 'pause', choice: 'mon' }, 'p|mon'],
  [{ kind: 'pause', choice: 'date' }, 'p|date'],
  [{ kind: 'pause', choice: 'off' }, 'p|off'],
  [{ kind: 'unlink' }, 'off|y'],
  [{ kind: 'ask', answer: 'y' }, 'ask|y'],
  [{ kind: 'ask', answer: 'p' }, 'ask|p'],
  [{ kind: 'ask', answer: 'n' }, 'ask|n'],
  [{ kind: 'group', post: '1z4', i: 2 }, 'g|1z4|2'],
  // release 47: «Экзамены» and «Перенести экзамен»
  [{ kind: 'exams', from: 's' }, 'xl|s'],
  [{ kind: 'exams', from: 'c' }, 'xl|c'],
  [{ kind: 'remind', cid: CID, on: true, from: 's' }, `xr|${CID}|1|s`],
  [{ kind: 'remind', cid: CID, on: false, from: 'c' }, `xr|${CID}|0|c`],
  [{ kind: 'card' }, 'xc'],
  [{ kind: 'move', cid: CID, act: 'open' }, `mv|${CID}|o`],
  [{ kind: 'move', cid: CID, act: 'w1' }, `mv|${CID}|7`],
  [{ kind: 'move', cid: CID, act: 'w2' }, `mv|${CID}|14`],
  [{ kind: 'move', cid: CID, act: 'date' }, `mv|${CID}|d`],
  [{ kind: 'moveFor', cid: CID, date: '2026-10-25', who: 'all' }, `mf|${CID}|20261025|a`],
  [{ kind: 'moveFor', cid: CID, date: '2028-02-29', who: 'me' }, `mf|${CID}|20280229|m`],
];

test('every form of §6.5 round-trips and fits 64 bytes; the longest is mf|<uuid>|<date>|a (50; before release 47 go|<uuid>|p, 41)', () => {
  let longest = 0;
  for (const [cb, data] of ALL) {
    assert.equal(encode(cb), data);
    assert.deepEqual(decode(data), cb, data);
    const bytes = new TextEncoder().encode(data).length;
    assert.ok(bytes <= MAX_BYTES);
    longest = Math.max(longest, bytes);
  }
  assert.equal(longest, 50);
});

test('release 47: malformed «Экзамены» and move data decode to null; encode refuses a day that is not one', () => {
  for (const data of [
    'xl', 'xl|x', 'xl|s|1', `xr|${CID}|2|s`, `xr|${CID}|1|x`, `xr|${CID}|1`, 'xr|not-a-uuid|1|s', 'xc|1', `mv|${CID}`, `mv|${CID}|30`,
    `mv|${CID}|w1`, `mf|${CID}|20261025`, `mf|${CID}|20260230|a`, `mf|${CID}|2026-10-25|a`, `mf|${CID}|20261025|x`, 'mf|x|20261025|a',
  ]) {
    assert.equal(decode(data), null, data);
  }
  assert.throws(() => encode({ kind: 'moveFor', cid: CID, date: '2026-02-30', who: 'all' }));
  assert.throws(() => encode({ kind: 'moveFor', cid: CID, date: '25.10', who: 'all' }));
  assert.throws(() => encode({ kind: 'move', cid: 'x', act: 'w1' }));
  assert.throws(() => encode({ kind: 'remind', cid: CID, on: true, from: 'x' as 's' }));
});

test('malformed, old or forged data decodes to null', () => {
  for (const data of [
    '', 'x', 's', `s|${SID}|3`, `s|${SID}|3|9`, `s|${SID}|-1|1`, `s|${SID}|01|1`, `s|${SID}|1000|1`, `s|../etc/p|1|1`, `s|${SID.toUpperCase()}|1|1`,
    `s|${SID}|1|t256`, `s|${SID}|1|a`, `s|${SID}|1|z`, `s|${SID}|1|1|extra`, 'go|not-a-uuid|p', `go|${CID}|q`, `go|${CID}`, 'ex|', 'ex|x',
    'st|other', 't|2400', 't|1960', 't|730', 't|1930|x', 'p|2', 'off|n', 'ask|maybe', 'g|1z4|8', 'g||1', 'a|7k2pm9qa|12|3', 'é'.repeat(40),
    `go|${CID}|p|${'x'.repeat(30)}`, null, 42,
  ]) {
    assert.equal(decode(data), null, String(data));
  }
});

test('encode refuses what decode would refuse', () => {
  assert.throws(() => encode({ kind: 'session', sid: 'short', pos: 1, act: { a: 'next' } }));
  assert.throws(() => encode({ kind: 'session', sid: SID, pos: 1000, act: { a: 'next' } }));
  assert.throws(() => encode({ kind: 'session', sid: SID, pos: 1, act: { a: 'option', i: 8 } }));
  assert.throws(() => encode({ kind: 'session', sid: SID, pos: 1, act: { a: 'toggle', mask: 256 } }));
  assert.throws(() => encode({ kind: 'go', cid: 'x', mode: 'p' }));
  assert.throws(() => encode({ kind: 'time', minutes: 1440, from: 'link' }));
  assert.throws(() => encode({ kind: 'group', post: 'TOO-LONG-POST-ID', i: 1 }));
});
