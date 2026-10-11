'use strict';
// Slide 08, the phone: test account A's oral exam «Базы данных» → «Тянуть билет из N вопросов» → «Отвечать» →
// «Отвечать голосом»: the answer is spoken into the microphone and the app's own recognition (on its server)
// writes it down → «Готово» → the examiner asks about a point the answer missed → «Не знаю» → the protocol: points
// named and missed, each with its quote from the lectures.
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/take-08.cjs <take dir> <voice dir> [--dry]
//
// The voice: <voice dir>/q<N>.wav, made by speak.py (offline TTS) from answers-08.json. Chromium's fake microphone
// plays <voice dir>/mic.wav; once the ticket is drawn, the answer to its first question is copied there (the file is
// read when the microphone opens). The page is told to use the server's recognition from the start (localStorage
// meldy_voice_engine=server, as after the app's own switch on a browser without Google's recognition).
// --dry stops before «Готово»: no AI check, no units.
// The window: 390 × 844 CSS px, rendered at device scale 2 (frames 780 × 1688); stills at 3×.
const fs = require('fs');
const path = require('path');
const R = require('./rec.cjs');

const DIR = path.resolve(process.argv[2] || 'take-08');
const VOICE = path.resolve(process.argv[3] || 'voice');
const DRY = process.argv.includes('--dry');
const EXAM = '2b56c75a-e933-463a-866d-7d658124a481';
const MIC = path.join(VOICE, 'mic.wav');
const W = 390, H = 844, DPR = 2;

function wavSeconds(file) {
  const b = fs.readFileSync(file);
  const rate = b.readUInt32LE(24), bytesPerSec = b.readUInt32LE(28);
  return (b.length - 44) / (bytesPerSec || rate * 2);
}

(async () => {
  fs.copyFileSync(path.join(VOICE, 'q1.wav'), MIC);
  const browser = await R.launch([`--force-device-scale-factor=${DPR}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${MIC}%noloop`]);
  const result = {};
  let take = null;
  try {
    const ctx = await R.context(browser, { w: W, h: H, dpr: DPR, phone: true, init: ["try{localStorage.setItem('meldy_voice_engine','server')}catch(e){}"] });
    await ctx.grantPermissions(['microphone'], { origin: R.u.SITE });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', R.u.redact(e.message).slice(0, 200)));
    await R.u.signIn(page, 'A');
    await R.u.go(page, `/exams/${EXAM}`, 'exam');
    const cta = page.locator('a').filter({ hasText: /Тянуть билет/ }).first();
    await cta.waitFor({ timeout: 30000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await R.settle(page, 800);

    take = new R.Take(page, DIR, { dpr: DPR, viewport: { width: W, height: H } });
    take.stillScale = 1.5; // × the device's 2 = 3×
    await take.start();
    await R.sleep(900);

    // «Тянуть билет из N вопросов»: N questions await a check
    take.mark('draw');
    await take.tap(cta);
    await page.waitForURL(/\/draw/, { timeout: 30000 });
    const answerLink = page.locator('a, button').filter({ hasText: /^Отвечать$/ }).first();
    await answerLink.waitFor({ timeout: 30000 });
    take.mark('drawn');
    const drawn = (await page.locator('body').innerText()).match(/вопрос[ыа]? (\d+)(?: и (\d+))?/);
    const first = drawn ? drawn[1] : null;
    result.drawn = drawn ? drawn[0] : null;
    const wav = path.join(VOICE, `q${first}.wav`);
    if (!first || !fs.existsSync(wav)) throw new Error(`no spoken answer for question ${first}: draw again`);
    fs.copyFileSync(wav, MIC);
    result.answerSeconds = +wavSeconds(wav).toFixed(1);
    await R.sleep(1500);

    // «Отвечать» → the ticket; the answer's points are gathered from the lectures.
    take.mark('answer');
    await take.tap(answerLink);
    await page.waitForURL(/\/ticket/, { timeout: 30000 });
    const voice = page.getByRole('button', { name: 'Отвечать голосом' }).first();
    await voice.waitFor({ timeout: 60000 });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => b.disabled && /Отвечать голосом/.test(b.innerText)), null, { timeout: 60000 }).catch(() => {});
    take.mark('ticket');
    await R.sleep(1600);

    // «Отвечать голосом»: the microphone opens, the file plays, the server writes each phrase down after its pause.
    take.mark('speak');
    await take.tap(voice);
    const t0 = Date.now();
    await R.sleep(Math.round(result.answerSeconds * 1000));
    // Then until the last phrase is written down (no «Распознаём…» for 3 s).
    let quiet = 0;
    for (let i = 0; i < 40 && quiet < 3; i += 1) {
      await R.sleep(1000);
      const busy = await page.getByText(/Распознаём/).count();
      quiet = busy ? 0 : quiet + 1;
    }
    take.mark('spoken');
    result.transcript = ((await page.locator('body').innerText()).match(/Ваш ответ[^\n]*\n([\s\S]*?)\n(Говорите|Слушаю|Распознаём|Готово)/) || [])[1] || '';
    result.speakSeconds = +((Date.now() - t0) / 1000).toFixed(1);
    await take.still('spoken');
    await R.sleep(600);
    if (DRY) { take.mark('dry-stop'); return; }

    // «Готово» → the examiner thinks, then asks about a point the answer missed.
    take.mark('done');
    await take.tap(page.getByRole('button', { name: 'Готово' }).first());
    const dontKnow = page.getByRole('button', { name: 'Не знаю' }).first();
    await dontKnow.waitFor({ timeout: 120000 });
    take.mark('asked');
    result.followup = R.u.redact(((await page.locator('body').innerText()).match(/«[^»]{8,200}\?»/) || [''])[0]);
    await R.sleep(2600);
    await take.still('asked');
    await R.sleep(400);
    take.mark('dontknow');
    await take.tap(dontKnow);

    // The protocol: «Итог» first, then every point — named or not — with its quote from the lectures.
    await page.getByText('Итог', { exact: true }).first().waitFor({ timeout: 180000 });
    take.mark('protocol');
    await R.sleep(1800);
    await take.still('protocol');
    result.protocol = R.u.redact((await page.locator('body').innerText()).replace(/\n+/g, ' / ')).slice(0, 2500);
    // The finger brings the points up under the bar: as far as the list's top, in drags of a reading pace.
    const listTop = await page.evaluate(() => {
      const el = document.querySelector('.or-left');
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    });
    result.listTop = listTop;
    let need = Math.max(0, (listTop ?? 700) - 70);
    let k = 0;
    while (need > 8 && k < 4) {
      const dy = Math.min(need, 400);
      take.mark(`scroll${k}`);
      await take.drag(205, 690, 690 - dy, { ms: 520 + dy });
      need -= dy;
      k += 1;
      await R.sleep(need > 8 ? 700 : 1600);
    }
    take.mark('points');
    await take.still('points');
    result.points = R.u.redact((await page.locator('.or-left').first().innerText().catch(() => '')).replace(/\n+/g, ' / ')).slice(0, 1200);
    await R.sleep(900);
    // «Пункт N не назван — о нём спросил экзаменатор.»: the page's own way to the point that was not named,
    // with the lecture's words for it.
    const asked = page.getByRole('button', { name: /спросил экзаменатор/ }).first();
    if (await asked.count()) {
      take.mark('asked-point');
      await take.tap(asked);
      await R.sleep(2600);
      take.mark('missed');
      await take.still('missed');
      result.missed = R.u.redact((await page.locator('[data-point]:focus, .or-left [tabindex="-1"]').first().innerText().catch(() => '')).replace(/\n+/g, ' / ')).slice(0, 800);
      await R.sleep(600);
    }
    take.mark('end');
  } catch (e) {
    R.fail(e);
  } finally {
    if (take) await take.stop();
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify(result, null, 1));
    console.log(JSON.stringify(result, null, 1).slice(0, 4000));
    await browser.close();
  }
})();
