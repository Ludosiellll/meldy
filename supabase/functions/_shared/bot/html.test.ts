import assert from 'node:assert/strict';
import { test } from 'node:test';
import { b, code, esc, lines, NBSP, pre, t, thousands, typo, visibleLength, visibleText } from './html.ts';

const n = (s: string) => s.replace(/ /g, NBSP);

test('esc escapes what parse_mode=HTML needs', () => {
  assert.equal(esc('a < b && c > d "q"'), 'a &lt; b &amp;&amp; c &gt; d &quot;q&quot;');
  assert.equal(esc('#region A\nx -= 1;'), '#region A\nx -= 1;');
});

test('typo glues numbers, «N из M», short words, « ·», « —» and «№»', () => {
  assert.equal(typo('143 из 960 — верно в два разных дня'), `143${NBSP}из${NBSP}960${NBSP}— верно в${NBSP}два разных дня`);
  assert.equal(typo('Осенняя сессия · 3 ноября, через 18 дней'), `Осенняя сессия${NBSP}· 3${NBSP}ноября, через 18${NBSP}дней`);
  assert.equal(typo('и в два'), n('и в два'));
  assert.equal(typo('№ 57 · Тема 3'), `№${NBSP}57${NBSP}· Тема 3`);
  assert.equal(typo('План на день — в 20:00 по Минску.'), `План на${NBSP}день${NBSP}— в${NBSP}20:00${NBSP}по${NBSP}Минску.`);
  assert.equal(typo('В Meldy'), `В${NBSP}Meldy`);
  assert.equal(typo(typo('143 из 960 — верно')), typo('143 из 960 — верно'), 'idempotent');
  assert.equal(typo('7:30 и 19:00'), `7:30${NBSP}и${NBSP}19:00`);
});

test('builders: bold, code, pre, lines', () => {
  assert.equal(b('Сегодня 5 вопросов'), `<b>Сегодня 5${NBSP}вопросов</b>`);
  assert.equal(code('if (a < b) {}'), '<code>if (a &lt; b) {}</code>');
  assert.equal(pre('int x = 7;'), '<pre><code class="language-csharp">int x = 7;</code></pre>');
  assert.equal(pre('x', 'bad lang"'), '<pre><code class="language-csharp">x</code></pre>');
  assert.equal(lines('a', null, '', false, 'b', undefined), 'a\n\nb');
  assert.equal(t('a & b'), 'a &amp; b');
});

test('visible length counts what Telegram shows', () => {
  assert.equal(visibleText('<b>А</b> a &lt; b &amp; c'), 'А a < b & c');
  assert.equal(visibleLength('<b>А.</b> a &lt; b'), 'А. a < b'.length);
  assert.equal(visibleLength('<pre><code class="language-csharp">x &gt; 1</code></pre>'), 5);
});

test('thousands with a no-break space', () => {
  assert.equal(thousands(6480), `6${NBSP}480`);
  assert.equal(thousands(960), '960');
  assert.equal(thousands(1234567), `1${NBSP}234${NBSP}567`);
});
