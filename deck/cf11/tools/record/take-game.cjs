'use strict';
// Slide 12 and the reel: one real game «Битва с монстром» on the live site, filmed from both sides at once — the
// teacher's projector (account A) and one student's phone (a guest who joins by PIN and builds a character). The
// rest of the class are classmates from game-sims.cjs. The monster loses about a sixth of its health per question
// and falls on the last one; the phone answers right except on question 3 (it freezes) and thaws on question 4.
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/take-game.cjs <takes dir> <test id>
//   STILLS=1 … — the same game, stills only (no screencast), for a draft slide.
//
// Before the take (not filmed): the test «Спрос и предложение» on account A, six questions, made through the
// studio's «Текст» view (questions-game.cjs). Two takes land in <takes dir>/game-host and <takes dir>/game-phone,
// on one clock (wall-clock seconds), so the cut can pair them. Host window 1536 × 864 CSS at 1.25 (1920 × 1080),
// light theme, as on a classroom projector; phone 390 × 844 at 2. The host moves on with the space bar (no pointer
// in the clip); the phone's taps are logged for the touch mark. At the end the game is closed by its host.
const fs = require('fs');
const path = require('path');
const R = require('./rec.cjs');
const { Classmates } = require('./game-sims.cjs');
const Q = require('./questions-game.cjs');

const DIR = path.resolve(process.argv[2] || 'takes');
const TEST = process.argv[3];
if (!/^[0-9a-f-]{36}$/.test(TEST || '')) {
  console.error('Give the test id (account A, «Спрос и предложение») as the second argument.');
  process.exit(2);
}
const HW = 1536, HH = 864, HDPR = 1.25;
const PW = 390, PH = 844, PDPR = 2;
const PHONE_NAME = 'Аня';
// The phone's answers: 'right' or 'wrong', and how long it thinks (ms after the buttons unlock).
const PHONE = [['right', 2600], ['right', 3400], ['wrong', 4200], ['right', 2900], ['right', 3100], ['right', 2400]];
// Health left after each question (share of the start): the class wins on the last one.
const TARGETS = [0.84, 0.68, 0.53, 0.36, 0.18, 0];

const hostSig = (page) => page.evaluate(() => {
  if (document.querySelector('.lvh-lobby')) return 'lobby';
  if (document.querySelector('.lvh-podium')) return 'podium';
  const qn = (document.querySelector('.lvh-q-no b') || {}).textContent || '';
  if (document.querySelector('.lvh-board')) return 'leaderboard|' + qn;
  if (document.querySelector('[data-revealed]')) return 'reveal|' + qn;
  if (document.querySelector('.lvh-closing')) return 'beat|' + qn;
  const ring = document.querySelector('.lvh-ring');
  if (ring) return (ring.dataset.mode === 'ready' ? 'countdown' : 'open') + '|' + qn;
  return 'other';
}).catch(() => '');

async function waitSig(page, re, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) {
    const s = await hostSig(page);
    if (re.test(s)) return s;
    if (Date.now() > end) throw new Error(`host: waited for ${re}, last ${s}`);
    await R.sleep(50);
  }
}

(async () => {
  const hostBrowser = await R.launch([`--force-device-scale-factor=${HDPR}`]);
  const phoneBrowser = await R.launch([`--force-device-scale-factor=${PDPR}`]);
  const result = { test: TEST };
  let host = null, phone = null, sims = null, hp = null;
  try {
    // The host: signed in, the setup page, the room opened (not filmed).
    const hctx = await R.context(hostBrowser, { w: HW, h: HH, dpr: HDPR });
    hp = await hctx.newPage();
    hp.setDefaultTimeout(30000);
    await R.u.signIn(hp, 'A');
    await R.u.go(hp, `/exams/c/${TEST}?live=1`, 'test');
    await hp.getByRole('link', { name: 'Провести игру' }).click();
    await hp.waitForSelector('.lvs-foot button');
    await R.settle(hp, 1200);
    await hp.click('.lvs-foot button');
    await hp.waitForURL(/\/live\/[0-9a-f-]{36}/);
    await hp.waitForSelector('.lvh-lobby-pin');
    const pin = (await hp.textContent('.lvh-lobby-pin')).replace(/\D/g, '');
    result.game = /\/live\/([0-9a-f-]{36})/.exec(hp.url())[1];
    await hp.mouse.move(HW - 4, HH - 4);
    await R.settle(hp, 1500);

    // The phone: the PIN screen, ready to type (not filmed).
    const pctx = await R.context(phoneBrowser, { w: PW, h: PH, dpr: PDPR, phone: true });
    const pp = await pctx.newPage();
    pp.setDefaultTimeout(30000);
    await pp.goto(`${R.u.SITE}/play`, { waitUntil: 'load' });
    await pp.waitForSelector('#lp-pin');
    await R.settle(pp, 1200);

    host = new R.Take(hp, path.join(DIR, 'game-host'), { dpr: HDPR, viewport: { width: HW, height: HH }, quality: 88 });
    phone = new R.Take(pp, path.join(DIR, 'game-phone'), { dpr: PDPR, viewport: { width: PW, height: PH }, quality: 88 });
    host.stillScale = 2 / HDPR;
    phone.stillScale = 3 / PDPR;
    if (process.env.STILLS) {
      // Stills only (a draft slide): no screencast, the stills are taken as in a take.
      for (const t of [host, phone]) {
        fs.rmSync(t.dir, { recursive: true, force: true });
        fs.mkdirSync(t.dir, { recursive: true });
        t.cdp = await t.page.context().newCDPSession(t.page);
        t.t0 = R.now();
      }
    } else {
      await host.start();
      await phone.start();
    }
    await R.sleep(1500);
    await host.still('lobby-empty');

    // The class comes in while the phone types the PIN and builds its character.
    sims = new Classmates({ pin, keyOf: Q.keyOf, targets: TARGETS, phoneDmg: (qi) => (PHONE[qi][0] === 'right' ? 150 : 0) });
    const joining = sims.join();
    phone.mark('pin');
    await phone.tap(pp.locator('#lp-pin'));
    await phone.type(pin, { delay: 120 });
    await R.sleep(300);
    await phone.tap(pp.locator('.lp-bar .lp-btn--main'));
    await pp.waitForSelector('#lp-name');
    phone.mark('builder');
    await R.sleep(700);
    await phone.tap(pp.locator('#lp-name'));
    await phone.type(PHONE_NAME, { delay: 140 });
    await R.sleep(500);
    for (const [tab, pick] of [[1, 3], [3, 2]]) {
      await phone.tap(pp.locator('.lp-tab').nth(tab));
      await R.sleep(600);
      await phone.tap(pp.locator('.lp-opt[data-locked="false"]').nth(pick));
      await R.sleep(900);
    }
    await phone.still('builder');
    await phone.tap(pp.locator('.lp-bar .lp-btn--main'));
    await pp.waitForSelector('main.lp[data-step="game"]');
    phone.mark('lobby');
    result.joined = await joining;
    await R.sleep(2500);
    host.mark('full');
    await host.still('lobby-full');
    await phone.still('lobby');
    await R.sleep(1500);

    sims.start();
    host.mark('go');
    await hp.keyboard.press('Space');
    for (let qi = 0; qi < PHONE.length; qi += 1) {
      const n = qi + 1;
      await waitSig(hp, new RegExp(`^(countdown|open)\\|${n}$`));
      host.mark(`q${n}`);
      phone.mark(`q${n}`);
      await pp.waitForSelector('.lp-answers[data-wait="false"] .lp-ans[aria-disabled="false"]', { timeout: 30000 });
      phone.mark(`q${n}-open`);
      const [kind, think] = PHONE[qi];
      await R.sleep(think);
      const q = await pp.evaluate(() => ({ text: (document.querySelector('.lp-q') || {}).textContent || '', options: Array.from(document.querySelectorAll('.lp-ans__t')).map((x) => x.textContent) }));
      const key = Q.keyOf(q.text, q.options);
      if (key < 0) throw new Error(`the phone does not know question ${n}: ${q.text}`);
      await phone.tap(pp.locator(`.lp-ans--${kind === 'right' ? key : (key + 1) % q.options.length}`));
      phone.mark(`q${n}-tap`, { kind });
      if (qi === 0) { await R.sleep(1200); await phone.still('answered'); }
      await waitSig(hp, new RegExp(`^(beat|reveal)\\|${n}$`), 60000);
      host.mark(`q${n}-close`);
      await waitSig(hp, new RegExp(`^reveal\\|${n}$`), 30000);
      host.mark(`q${n}-reveal`);
      phone.mark(`q${n}-reveal`);
      await R.sleep(2600);
      if (qi === 0) { await host.still('reveal'); await phone.still('reveal'); }
      if (qi === 2) await phone.still('frozen');
      await hp.waitForFunction(() => !document.querySelector('.lvh-fx[data-film]'), null, { timeout: 12000 }).catch(() => {});
      await R.sleep(1600);
      await hp.keyboard.press('Space');
      const next = await waitSig(hp, new RegExp(`^(leaderboard\\|${n}|podium)$`), 20000);
      if (next === 'podium') break;
      host.mark(`q${n}-top`);
      await R.sleep(3200);
      if (qi === 1) { await host.still('top5'); await phone.still('place'); }
      await hp.keyboard.press('Space');
    }
    await waitSig(hp, /^podium$/, 30000);
    host.mark('podium');
    phone.mark('podium');
    await R.sleep(4500);
    await host.still('podium');
    await phone.still('final');
    await R.sleep(3000);
    host.mark('end');
    phone.mark('end');
    result.phoneFinal = (await pp.evaluate(() => document.querySelector('main.lp')?.innerText || '')).replace(/\s+/g, ' ').slice(0, 300);
    result.podium = await hp.evaluate(() => Array.from(document.querySelectorAll('.lvh-pod-name')).map((x) => x.textContent));
  } catch (e) {
    R.fail(e);
  } finally {
    if (sims) { sims.stop(); result.simErrors = sims.errors.slice(0, 10); }
    if (host) await host.stop();
    if (phone) await phone.stop();
    // The game is closed by its host, as a teacher would after the podium.
    if (hp) {
      await hp.getByRole('button', { name: 'Закончить игру' }).click({ timeout: 5000 }).catch(() => {});
      await R.sleep(1500);
    }
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'game-result.json'), JSON.stringify(result, null, 1));
    console.log(JSON.stringify(result, null, 1).slice(0, 2000));
    await hostBrowser.close();
    await phoneBrowser.close();
  }
})();
