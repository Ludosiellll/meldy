'use strict';
// Slide 08, the phone: question 18 of test account A's oral exam «Базы данных», opened directly → «Отвечать голосом»:
// the answer is spoken into the microphone and the app's own recognition (on its server) writes it down → «Готово» →
// the examiner asks about a point the answer missed → «Не знаю» → the protocol: points named and missed, each with
// its quote from the lectures → «Пункт N не назван — о нём спросил экзаменатор» (the page's own way to it).
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/take-08.cjs <take dir> <voice dir> [--dry]
//
// The voice: <voice dir>/q18.wav, made by speak.py (offline TTS) from answers-08.json — a short answer (two
// sentences), so the clip shows it whole, in real time. Chromium's fake microphone plays <voice dir>/mic.wav (the
// file is read when the microphone opens). The page is told to use the server's recognition from the start
// (localStorage meldy_voice_engine=server, as after the app's own switch on a browser without Google's recognition).
// --dry stops before «Готово»: no AI check, no units.
// The window: 390 × 844 CSS px, rendered at device scale 2 (frames 780 × 1688); stills at 3×. Calm: every beat is
// held for real, the finger moves at a person's pace, the protocol is brought up by one slow drag that stops where the
// finger stops. No finger is drawn in the clip, only a ring where it taps.
const fs = require('fs');
const path = require('path');
const R = require('./rec.cjs');

const DIR = path.resolve(process.argv[2] || 'take-08');
const VOICE = path.resolve(process.argv[3] || 'voice');
const DRY = process.argv.includes('--dry');
const EXAM = '2b56c75a-e933-463a-866d-7d658124a481';
const Q18 = '269e204d-600a-4c10-ba0d-7e0f41808a2a';
const MIC = path.join(VOICE, 'mic.wav');
const W = 390, H = 844, DPR = 2;

function wavSeconds(file) {
  const b = fs.readFileSync(file);
  const rate = b.readUInt32LE(24), bytesPerSec = b.readUInt32LE(28);
  return (b.length - 44) / (bytesPerSec || rate * 2);
}

(async () => {
  const wav = path.join(VOICE, 'q18.wav');
  fs.copyFileSync(wav, MIC);
  const browser = await R.launch([`--force-device-scale-factor=${DPR}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${MIC}%noloop`]);
  const result = { answerSeconds: +wavSeconds(wav).toFixed(1) };
  let take = null;
  try {
    const ctx = await R.context(browser, { w: W, h: H, dpr: DPR, phone: true, init: [
      "try{localStorage.setItem('meldy_voice_engine','server');localStorage.setItem('meldy_tip_telegram','1')}catch(e){}",
    ] });
    await ctx.grantPermissions(['microphone'], { origin: R.u.SITE });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', R.u.redact(e.message).slice(0, 200)));
    await R.u.signIn(page, 'A');
    await R.u.go(page, `/exams/${EXAM}/ticket?q=${Q18}`, 'ticket');
    const voice = page.getByRole('button', { name: 'Отвечать голосом' }).first();
    await voice.waitFor({ timeout: 60000 });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => b.disabled && /Отвечать голосом/.test(b.innerText)), null, { timeout: 60000 }).catch(() => {});
    await R.settle(page, 1500);

    take = new R.Take(page, DIR, { dpr: DPR, viewport: { width: W, height: H } });
    take.stillScale = 1.5; // × the device's 2 = 3×
    await take.start();
    await R.sleep(2000);

    // «Отвечать голосом»: the microphone opens, the file plays, the server writes each phrase down after its pause.
    take.mark('speak');
    await take.tap(voice);
    const t0 = Date.now();
    await R.sleep(Math.round(result.answerSeconds * 1000) - 1500);
    // Then until the last phrase is written down (no «Распознаём…» for 1.5 s).
    let quiet = 0;
    for (let i = 0; i < 80 && quiet < 3; i += 1) {
      await R.sleep(500);
      const busy = await page.getByText(/Распознаём/).count();
      quiet = busy ? 0 : quiet + 1;
    }
    take.mark('spoken');
    result.transcript = ((await page.locator('body').innerText()).match(/Ваш ответ[^\n]*\n([\s\S]*?)\n(Говорите|Слушаю|Распознаём|Готово)/) || [])[1] || '';
    result.keywords = ((await page.locator('body').innerText()).match(/По ключевым словам: \d+ из \d+/) || [''])[0];
    result.speakSeconds = +((Date.now() - t0) / 1000).toFixed(1);
    await R.sleep(1300);
    if (DRY) { take.mark('dry-stop'); return; }

    // «Готово» → the examiner thinks (waiting: cut in the clip), then asks about a point the answer missed.
    take.mark('done');
    await take.tap(page.getByRole('button', { name: 'Готово' }).first());
    const dontKnow = page.getByRole('button', { name: 'Не знаю' }).first();
    await dontKnow.waitFor({ timeout: 120000 });
    take.mark('asked');
    result.followup = R.u.redact(((await page.locator('body').innerText()).match(/«[^»]{8,200}\?»/) || [''])[0]);
    await R.sleep(2700);
    take.mark('dontknow');
    await take.tap(dontKnow);

    // The protocol: «Итог» first, then every point — named or not — with its quote from the lectures.
    await page.getByText('Итог', { exact: true }).first().waitFor({ timeout: 180000 });
    take.mark('protocol');
    await R.sleep(2800);
    result.protocol = R.u.redact((await page.locator('body').innerText()).replace(/\n+/g, ' / ')).slice(0, 2500);
    // The protocol settles once it is saved (the card of the examiner's question comes in above the list).
    await page.getByText(/Сохранено в историю/).first().waitFor({ timeout: 30000 }).catch(() => {});
    await R.sleep(600);
    // One slow drag brings the points' list up under the top line: it eases in and out and stops where it stops.
    const top = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('body *')].filter((e) => /^Вопрос\s18\s·\sответ/.test((e.innerText || '').trim()) && e.getBoundingClientRect().height > 0);
      heads.sort((x, y) => x.innerText.length - y.innerText.length);
      return heads.length ? Math.round(heads[0].getBoundingClientRect().top) : null;
    });
    result.listTop = top;
    const need = Math.max(0, (top ?? 600) - 76); // (the head sits near 600 once the protocol is saved)
    take.mark('scroll');
    if (need <= 700) {
      await take.drag(195, 790, 790 - need, { ms: 1300, ease: 'inout', rest: 320 });
    } else {
      await take.drag(195, 790, 440, { ms: 1000, ease: 'inout', rest: 200 });
      await R.sleep(500);
      await take.drag(195, 790, 790 - (need - 350), { ms: 1100, ease: 'inout', rest: 320 });
    }
    take.mark('points');
    await R.sleep(700);
    await take.still('points');
    result.points = R.u.redact((await page.locator('.or-left').first().innerText().catch(() => '')).replace(/\n+/g, ' / ')).slice(0, 1500);
    await R.sleep(2500);
    // «Пункт N не назван — о нём спросил экзаменатор.»: the page's own way to the point that was not named.
    const asked = page.getByRole('button', { name: /спросил экзаменатор/ }).first();
    if (await asked.count()) {
      take.mark('asked-point');
      await take.tap(asked);
      await R.sleep(800);
      take.mark('missed');
      await R.sleep(1600);
      await take.still('missed');
      await R.sleep(1200);
    }
    take.mark('end');
  } catch (e) {
    R.fail(e);
  } finally {
    if (take) await take.stop();
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify(result, null, 1));
    console.log(JSON.stringify(result, null, 1).slice(0, 5000));
    await browser.close();
  }
})();
