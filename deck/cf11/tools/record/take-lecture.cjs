'use strict';
// The «Лекции» slide, the laptop: «Разобрать лекцию» → the four ways in → «Аудио и видео» → the lecture video →
// «Что сделать из лекции», all five ticked → «Запустить анализ» → (the wait: cut in the clip) → the results the analysis
// lands on: «Конспект» (the sections, «Термины»), «Карточки» (one card turned over), «Тест» (the first question
// answered, the check and its «Пояснение»); then «Открыть лекцию», the lecture's page: «Кратко» (the выжимка) and
// «Подкаст» (the player: its scene and subtitles; the deck has no sound).
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/take-lecture.cjs <take dir> [--file <lecture.mp4>]
//                                                                     [--input mp4|mp3|m4a|pdf]
// (--input m4a needs --file: make.py writes the MP4, an MP3 and the slides' PDF.)
//
// The lecture is our own (tools/record/lecture: the text, the slides, a synthetic voice; make.py builds the video,
// and the same lecture as an MP3 and as a PDF of its slides should the video path fail). The take uploads it as
// «Рыночное равновесие (лекция).mp4» and leaves the lecture in the library of test account A (its id goes to
// <take dir>/material.json). It measures what the deck may say about time: from the press on «Запустить анализ» to
// each material's «Готово» in the progress card (watched in the page), to the results, to the lecture being saved; and
// the AI units the analysis spent (the limit's ring in the top line, before and after).
//
// The window: 1024 × 800 CSS px, the site's desktop layout at its narrowest (as 07 and 09), rendered at device scale
// 1.75 (frames 1792 × 1400; stills at 3×). Calm: each beat held for real, the hand at a person's pace, each beat's
// rectangle logged for the camera (Take.box). No pointer is drawn in the clip, only a ring where it presses. The top
// line (the limit, the avatar) is never framed: the camera keeps below it (cut-lecture.json, camera.y_min), and the
// master and its poster paint it over (cut-lecture.json, mask). While the
// analysis runs, the screencast is paused (the spinners would paint a frame every 16 ms for minutes) and resumed when
// the results are in; the progress card's own log keeps the timings meanwhile.
// The lecture page's first-use tip («Поговорить о лекции») is put away on this device, as if dismissed before.
const fs = require('fs');
const path = require('path');
const R = require('./rec.cjs');

const DIR = path.resolve(process.argv[2] || 'take-lecture');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const INPUT = arg('input', 'mp4');
const KINDS = {
  mp4: { tab: 'Аудио и видео', mime: 'video/mp4', file: 'lecture/lecture.mp4' },
  mp3: { tab: 'Аудио и видео', mime: 'audio/mpeg', file: 'lecture/lecture.mp3' },
  m4a: { tab: 'Аудио и видео', mime: 'audio/mp4', file: 'lecture/lecture.m4a' },
  pdf: { tab: 'Файл', mime: 'application/pdf', file: 'lecture/slides.pdf' },
};
if (!KINDS[INPUT]) throw new Error(`--input is one of ${Object.keys(KINDS).join(', ')}`);
const KIND = KINDS[INPUT];
const FILE = path.resolve(arg('file', path.join(__dirname, KIND.file)));
const FILE_NAME = `Рыночное равновесие (лекция).${INPUT}`;
const W = 1024, H = 800, DPR = 1.75;
const TOP = 84; // the top line ends at 76 CSS px: what the camera frames starts below it

// Text out of the page goes through ulib's redact() and loses anything shaped like an e-mail address.
const clean = (t) => R.u.redact(String(t || '')).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<e-mail>');
const units = (label) => {
  const m = /осталось\s+(\d+)\s+из\s+(\d+)/.exec(label || '');
  return m ? { left: Number(m[1]), of: Number(m[2]), pro: /PRO/.test(label) } : null;
};

/** The limit as the ring in the top line says it (its accessible name), read again on demand. */
async function meter(page) {
  const ring = page.locator('[aria-label^="Лимит ИИ"]').first();
  for (let i = 0; i < 20; i += 1) {
    const label = await ring.getAttribute('aria-label').catch(() => null);
    if (label && /осталось/.test(label)) return units(label);
    await R.sleep(500);
  }
  return null;
}

/** The hand turns the wheel: an eased run of small steps, so the page glides rather than jumps. */
async function wheel(take, dy, { ms = 700 } = {}) {
  const steps = Math.max(8, Math.round(ms / 35));
  let done = 0;
  const t0 = Date.now();
  for (let i = 1; i <= steps; i += 1) {
    const p = i / steps;
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const to = Math.round(dy * e);
    if (to !== done) await take.page.mouse.wheel(0, to - done);
    done = to;
    const wait = t0 + (ms * i) / steps - Date.now();
    if (wait > 0) await R.sleep(wait);
  }
  take.events.push({ kind: 'wheel', dy, t: R.now() });
  await R.sleep(450); // the page's own smooth scrolling comes to rest
}

/** Scrolls so that the top of `locator` lands at window y `at` (CSS px), with the wheel. */
async function bring(take, locator, at, opts) {
  const box = await locator.boundingBox();
  if (!box) return;
  const dy = Math.round(box.y - at);
  if (Math.abs(dy) > 4) await wheel(take, dy, opts);
}

/** The screencast paused / resumed (the long wait): frames stop coming, the take's clock runs on. */
async function pause(take) {
  await take.cdp.send('Page.stopScreencast').catch(() => {});
  take.events.push({ kind: 'pause', t: R.now() });
}
async function resume(take) {
  await take.cdp.send('Page.startScreencast', { format: 'jpeg', quality: take.quality, everyNthFrame: 1 });
  take.events.push({ kind: 'resume', t: R.now() });
  await take.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
}

/**
 * The analysis' own stream, kept in the page as it comes (window.__sse): the page's fetch is wrapped so that the answer
 * of /api/analyze… is cloned before the app reads it (DevTools keeps no copy of a stream the page consumed). Only those
 * answers are copied: the quiz's key is read from them, so the take answers the test as a student who knows the lecture
 * (no wrong answers go to the account's «Работа над ошибками»).
 */
const TEE = `(() => {
  try {
    const orig = window.fetch.bind(window);
    window.__sse = '';
    window.fetch = function (input, init) {
      const p = orig(input, init);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\\/api\\/analyze(\\/media|\\/url)?$/.test(new URL(url, location.href).pathname)) {
          p.then((res) => {
            try {
              const reader = res.clone().body.getReader();
              const dec = new TextDecoder();
              const pump = () => reader.read().then(({ done, value }) => { if (done) return; window.__sse += dec.decode(value, { stream: true }); return pump(); });
              pump().catch(() => {});
            } catch (e) {}
          }, () => {});
        }
      } catch (e) {}
      return p;
    };
  } catch (e) {}
})();`;

/** The progress card and the results, watched in the page: each change with its time (Date.now()). */
const WATCH = () => {
  window.__ag = [];
  const seen = {};
  const log = (...e) => window.__ag.push([Date.now(), ...e]);
  const scan = () => {
    const h = document.querySelector('#analysis-progress-heading');
    if (h && seen.h !== h.textContent) { seen.h = h.textContent; log('heading', h.textContent); }
    const lede = document.querySelector('.ag-lede');
    if (lede && seen.lede !== lede.textContent) { seen.lede = lede.textContent; log('lede', lede.textContent); }
    for (const row of document.querySelectorAll('.ag-row')) {
      const name = (row.querySelector('.ag-name') || {}).textContent || '?';
      const st = (row.querySelector('.ag-status') || { getAttribute: () => '' }).getAttribute('data-status');
      if (seen[`r:${name}`] !== st) { seen[`r:${name}`] = st; log('row', name, st); }
    }
    if (!seen.res && document.querySelector('.rp-result-head')) { seen.res = 1; log('results'); }
    const open = [...document.querySelectorAll('.az-after button')].find((b) => /Открыть лекцию/.test(b.textContent));
    if (!seen.saved && open) { seen.saved = 1; log('saved'); }
    const fail = document.querySelector('#analysis-error-heading');
    if (!seen.fail && fail) { seen.fail = 1; log('error', ((document.querySelector('.az-fail-text') || {}).textContent || '').trim()); }
  };
  new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-status'] });
  scan();
};

/** The right option of each question, from the analysis' own answer (its quiz, read off the stream). */
function quizKey(sse) {
  let results = null;
  for (const line of String(sse).split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim());
      if (ev && ev.type === 'results') results = ev;
    } catch { /* a keepalive or a partial line */ }
  }
  const quiz = results && results.quiz && Array.isArray(results.quiz.quiz) ? results.quiz.quiz : null;
  if (!quiz) return null;
  const norm = (s) => String(s || '').replace(/\[S\d+\]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const LAT = 'ABCD', CYR = 'АБВГ';
  return quiz.map((q) => {
    const options = Array.isArray(q.options) ? q.options.map(String) : [];
    const want = norm(q.correct);
    const body = (o) => norm(o.replace(/^\s*[A-Za-zА-ЯЁа-яё]\s*[).:]\s*/, ''));
    let index = options.findIndex((o) => norm(o) === want);
    if (index < 0) index = options.findIndex((o) => body(o) === want);
    if (index < 0) {
      const m = /^([A-Za-zА-ЯЁа-яё])\s*(?:[).:]|$)/.exec(String(q.correct || '').trim());
      if (m) {
        const ch = m[1].toUpperCase();
        index = LAT.indexOf(ch) >= 0 ? LAT.indexOf(ch) : CYR.indexOf(ch);
      }
    }
    return { question: norm(q.question).slice(0, 80), index: index >= 0 && index < options.length ? index : null };
  });
}

/** One beat after the analysis: a failure is logged and the take goes on (the analysis cannot be had again for free). */
async function beat(result, name, fn) {
  try {
    await fn();
  } catch (e) {
    const msg = clean(e && e.message ? e.message : e).split('\n')[0].slice(0, 300);
    (result.beatErrors = result.beatErrors || {})[name] = msg;
    console.log(`  beat ${name} failed: ${msg}`);
  }
}

(async () => {
  if (!fs.existsSync(FILE)) throw new Error(`no lecture file at ${FILE}: build it with lecture/make.py`);
  const browser = await R.launch([`--force-device-scale-factor=${DPR}`, '--autoplay-policy=no-user-gesture-required']);
  const result = { input: INPUT, file: path.basename(FILE), fileName: FILE_NAME, bytes: fs.statSync(FILE).size };
  let take = null;
  try {
    const ctx = await R.context(browser, {
      w: W, h: H, dpr: DPR,
      init: ["try{localStorage.setItem('meldy_tip_talk','1');localStorage.setItem('meldy_tip_telegram','1')}catch(e){}", TEE],
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', clean(e.message).slice(0, 200)));

    await R.u.signIn(page, 'A');
    await R.u.go(page, '/analyze', 'analyze');
    const heading = page.getByRole('heading', { name: /Разобрать/ }).first();
    await heading.waitFor({ timeout: 30000 });
    result.unitsBefore = await meter(page);
    console.log('  units before:', JSON.stringify(result.unitsBefore));
    await R.settle(page, 1500);

    const tablist = page.getByRole('tablist', { name: 'Источник' }).first();
    const sourceTab = page.getByRole('tab', { name: KIND.tab }).first();
    take = new R.Take(page, DIR, { dpr: DPR, viewport: { width: W, height: H } });
    take.stillScale = 3 / DPR;
    take.pointer = { x: 600, y: 610 };
    await take.start();

    // «Разобрать лекцию»: the heading, its line, «Что разобрать» and the four ways in.
    await take.box('start', page.locator('h1.az-h1').first(), page.locator('.az-lede').first(), page.locator('.az-step-head').first());
    await R.sleep(500);
    await take.still('poster');
    await R.sleep(1900);

    // The four tabs, then the one for a recording (or «Файл» for the PDF).
    await take.box('tabs', tablist);
    take.mark('tabs');
    await R.sleep(500);
    await take.click(sourceTab, { ms: 900 });
    take.mark('tab');
    await R.sleep(700);
    await take.box('media', page.locator('.az-panel').first(), page.locator('.az-media-note, .az-scan-note').first());
    await R.sleep(1700);

    // The file: the window of the system (not part of the page) opens, the lecture is chosen in it.
    const drop = page.locator('button.az-drop').first();
    take.mark('pick');
    const chooser = page.waitForEvent('filechooser', { timeout: 15000 });
    await take.click(drop, { ms: 800 });
    const fc = await chooser;
    take.mark('chooser');
    await R.sleep(300);
    await fc.setFiles({ name: FILE_NAME, mimeType: KIND.mime, buffer: fs.readFileSync(FILE) });
    const fileRow = page.locator('.az-file').first();
    await fileRow.waitFor({ timeout: 15000 });
    take.mark('chosen');
    result.fileRow = clean(await fileRow.innerText()).replace(/\n+/g, ' · ');
    await R.sleep(300);
    await take.box('file', tablist, fileRow);
    await R.sleep(2200);

    // Step 2, «Что подготовить»: its line says what will be made; «Изменить» opens the list.
    const plan = page.locator('.az-plan').first();
    await take.move(560, 560, { ms: 500 });
    await bring(take, plan, 300, { ms: 750 });
    take.mark('step2');
    result.planBefore = clean(await page.locator('.az-plan-line').first().innerText());
    const change = page.getByRole('button', { name: 'Изменить' }).first();
    await take.box('step2', plan, page.locator('.az-launch').first());
    await R.sleep(1200);
    await take.click(change, { ms: 700 });
    take.mark('change');
    await R.sleep(700);

    // «Что сделать из лекции»: Конспект, Карточки, Тест are on by default; Выжимка and Подкаст are ticked.
    const mods = page.locator('.ac-mods').first();
    await take.move(560, 520, { ms: 450 });
    await bring(take, page.locator('.ac-settings-h').first(), 280, { ms: 850 });
    await take.box('grid', page.locator('.ac-settings-h').first(), mods);
    take.mark('grid');
    await R.sleep(1300);
    for (const name of ['Выжимка', 'Подкаст']) {
      const box = page.getByRole('checkbox', { name: new RegExp(name) }).first();
      if ((await box.getAttribute('aria-checked')) !== 'true') {
        take.mark(`tick-${name === 'Выжимка' ? 'brief' : 'podcast'}`);
        await take.click(box, { ms: 650, fx: 0.5, fy: 0.42 });
        await R.sleep(650);
      }
    }
    take.mark('ticked');
    result.ticked = await page.getByRole('checkbox').evaluateAll((els) => els.map((e) => `${e.innerText.split('\n')[0]}=${e.getAttribute('aria-checked')}`));
    result.planAfter = clean(await page.locator('.az-plan-line').first().innerText());
    await R.sleep(1100);
    await take.still('grid');
    await R.sleep(900);

    // «Запустить анализ» (just above the list): the press starts the clock.
    const start = page.locator('button.az-start').first();
    if ((await start.innerText()).trim() !== 'Запустить анализ' || !(await start.isEnabled())) {
      throw new Error(`the start reads «${clean(await start.innerText())}» (enabled ${await start.isEnabled()}): nothing started`);
    }
    await take.box('go', start, page.locator('.ac-settings-h').first(), mods);
    await page.evaluate(WATCH);
    take.mark('go');
    await R.sleep(600);
    const p = await take.aim(start);
    await take.move(p.x, p.y, { ms: 750 });
    await R.sleep(140);
    take.events.push({ kind: 'down', x: p.x, y: p.y, t: R.now() });
    await page.mouse.down();
    await R.sleep(90);
    const pressedAt = Date.now();
    await page.mouse.up();
    take.events.push({ kind: 'up', x: p.x, y: p.y, t: R.now() });
    take.mark('pressed');

    // The progress card: what is read and made, one row a material.
    const card = page.locator('.ag-card').first();
    await card.waitFor({ timeout: 30000 });
    take.mark('progress');
    await R.sleep(250);
    const cardBox = await card.boundingBox();
    if (cardBox && (cardBox.y < TOP || cardBox.y + cardBox.height > H)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await R.sleep(300);
    }
    await take.box('progress', card);
    await R.sleep(2600);
    take.mark('wait');
    await pause(take);

    // The wait (cut in the clip). The page keeps its own log of the rows; the results or an error end it.
    const t0 = Date.now();
    let outcome = null;
    while (Date.now() - t0 < 11 * 60 * 1000) {
      outcome = await page.evaluate(() => {
        if (document.querySelector('#analysis-error-heading')) return 'error';
        if (document.querySelector('.rp-result-head')) return 'results';
        return null;
      }).catch(() => null);
      if (outcome) break;
      await R.sleep(150);
    }
    const log = await page.evaluate(() => window.__ag || []);
    result.timeline = log.map(([t, ...e]) => [Math.round((t - pressedAt) / 100) / 10, ...e.map((x) => clean(x).slice(0, 160))]);
    console.log('  progress log (s from the press):');
    for (const row of result.timeline) console.log('   ', JSON.stringify(row));
    if (outcome !== 'results') {
      await resume(take);
      await R.sleep(1500);
      result.error = outcome === 'error' ? clean(await page.locator('.az-fail').first().innerText()).replace(/\n+/g, ' / ') : 'no results within 11 minutes';
      await take.box('error', page.locator('.az-fail').first());
      await R.sleep(1500);
      throw new Error(`the analysis did not finish: ${result.error}`);
    }
    // The results are in: the window at its top, the screencast back on.
    await page.evaluate(() => window.scrollTo(0, 0));
    await resume(take);
    take.mark('results');
    await R.sleep(1200);
    const head = page.locator('.rp-result-head').first();
    const tabsRow = page.locator('.rp-tabsrow').first();
    result.title = clean(await page.locator('h1.rp-title').first().innerText().catch(() => ''));
    result.resultHead = clean(await head.innerText()).replace(/\n+/g, ' / ').slice(0, 400);
    result.tabs = clean(await tabsRow.innerText().catch(() => '')).replace(/\n+/g, ' ');
    await take.box('results', head, tabsRow);
    await R.sleep(1600);

    // «Конспект»: its sections, then «Термины».
    await beat(result, 'summary', async () => {
    const firstSec = page.locator('.sv-sec').first();
    await take.box('summary', tabsRow, firstSec);
    take.mark('summary');
    result.sections = await page.locator('.sv-sec h2.sv-h2').allInnerTexts().catch(() => []);
    await R.sleep(1800);
    const terms = page.locator('section.sv-terms').first();
    const outlineTerms = page.locator('nav.sv-outline').getByText(/^Термины/).first();
    if (await outlineTerms.isVisible().catch(() => false)) {
      take.mark('outline');
      await take.click(outlineTerms, { ms: 700 });
      await R.sleep(1100);
    } else {
      await take.move(520, 560, { ms: 450 });
      await bring(take, terms, 150, { ms: 1100 });
    }
    take.mark('terms');
    result.terms = (await page.locator('.sv-term dt, .sv-term .sv-term-t, .sv-term').allInnerTexts().catch(() => [])).map((t) => clean(t).split('\n')[0]).slice(0, 14);
    await take.box('terms', terms);
    await R.sleep(2600);
    });

    // «Карточки»: one card turned over.
    await beat(result, 'cards', async () => {
    await take.move(520, 400, { ms: 450 });
    await bring(take, tabsRow, 120, { ms: 900 });
    const cardsTab = tabsRow.getByRole('button', { name: /Карточки/ }).first();
    take.mark('cards-tab');
    await take.click(cardsTab, { ms: 700 });
    const card1 = page.locator('li.fc-card').first();
    await card1.waitFor({ timeout: 15000 });
    await R.sleep(500);
    await take.box('cards', tabsRow, card1);
    take.mark('cards');
    await R.sleep(1200);
    take.mark('flip');
    await take.click(card1.locator('.fc-q').first(), { ms: 700, fx: 0.35 });
    await card1.locator('.fc-answer').first().waitFor({ timeout: 10000 });
    take.mark('flipped');
    await R.sleep(700);
    result.card = clean(await card1.innerText()).replace(/\n+/g, ' / ').slice(0, 300);
    await take.box('card', tabsRow, card1);
    await R.sleep(2200);
    });

    // «Тест»: the first question answered; the rest are answered too (cut), «Проверить ответы», its «Пояснение».
    await beat(result, 'quiz', async () => {
    await bring(take, tabsRow, 120, { ms: 700 });
    const quizTab = tabsRow.getByRole('button', { name: /Тест/ }).first();
    take.mark('quiz-tab');
    await take.click(quizTab, { ms: 700 });
    const q1 = page.locator('li.qz-card').first();
    await q1.waitFor({ timeout: 15000 });
    await R.sleep(500);
    const key = quizKey(await page.evaluate(() => window.__sse || ''));
    const nq = await page.locator('li.qz-card').count();
    const domQs = await page.locator('li.qz-card p.qz-q').allInnerTexts();
    const pick = (i) => {
      const norm = (s) => String(s).replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
      const k = key && (key.find((q) => q.question && q.question === norm(domQs[i])) || key[i]);
      return k && k.index !== null ? k.index : 0;
    };
    result.quizKeyRead = Boolean(key);
    await take.box('quiz', page.locator('.qz-head').first(), q1);
    take.mark('quiz');
    await R.sleep(1200);
    take.mark('answer');
    await take.click(q1.locator('button.qz-opt').nth(pick(0)), { ms: 750, fx: 0.3 });
    take.mark('answered');
    await R.sleep(1600);
    for (let i = 1; i < nq; i += 1) {
      const qi = page.locator('li.qz-card').nth(i);
      const b = await qi.boundingBox();
      if (b && b.y + b.height > H - 40) await bring(take, qi, 160, { ms: 600 });
      await take.click(qi.locator('button.qz-opt').nth(pick(i)), { ms: 550, fx: 0.3 });
      await R.sleep(350);
    }
    const check = page.getByRole('button', { name: 'Проверить ответы' }).first();
    await check.waitFor({ timeout: 10000 });
    const cb = await check.boundingBox();
    if (cb && cb.y + cb.height > H - 20) await bring(take, check, 500, { ms: 600 });
    take.mark('check');
    await take.click(check, { ms: 650 });
    const resultBox = page.locator('section.qz-result').first();
    await resultBox.waitFor({ timeout: 10000 });
    await R.sleep(400);
    await take.move(520, 420, { ms: 400 });
    await bring(take, page.locator('.qz-head').first(), 110, { ms: 1000 });
    take.mark('explained');
    result.quizScore = clean(await resultBox.innerText()).replace(/\n+/g, ' / ').slice(0, 200);
    result.explain1 = clean(await q1.locator('.qz-explain').first().innerText().catch(() => '')).slice(0, 300);
    await take.box('explain', resultBox, q1);
    await R.sleep(2800);
    });

    // «Открыть лекцию» (under the results): the lecture's page.
    const open = page.locator('.az-after button').filter({ hasText: 'Открыть лекцию' }).first();
    await open.waitFor({ timeout: 60000 });
    const savedAt = (await page.evaluate(() => (window.__ag || []).find((e) => e[1] === 'saved')).catch(() => null)) || null;
    result.savedAt = savedAt ? Math.round((savedAt[0] - pressedAt) / 100) / 10 : null;
    await take.move(520, 600, { ms: 400 });
    await bring(take, open, 560, { ms: 1200 });
    take.mark('open');
    await take.click(open, { ms: 700 });
    await page.waitForURL(/\/library\/[0-9a-f-]{36}$/, { timeout: 30000 });
    result.materialId = (page.url().match(/\/library\/([0-9a-f-]{36})/) || [])[1];
    fs.writeFileSync(path.join(DIR, 'material.json'), JSON.stringify({ id: result.materialId }));
    const modes = page.getByRole('tablist', { name: 'Режим' }).first();
    await modes.waitFor({ timeout: 30000 });
    take.mark('lecture');
    await R.sleep(900);
    result.lectureHead = clean(await page.locator('header.md-head').first().innerText()).replace(/\n+/g, ' / ');
    result.modes = await modes.getByRole('tab').allInnerTexts();
    await take.box('lecture', page.locator('header.md-head').first(), page.locator('.md-toolbar').first());
    await R.sleep(1600);

    // «Кратко»: the выжимка.
    await beat(result, 'brief', async () => {
    const brief = modes.getByRole('tab', { name: 'Кратко' }).first();
    take.mark('brief-tab');
    await take.click(brief, { ms: 700 });
    const sheet = page.locator('article.xp-sheet').first();
    await sheet.waitFor({ timeout: 15000 });
    take.mark('brief');
    await R.sleep(500);
    result.brief = clean(await sheet.innerText()).replace(/\n+/g, ' / ').slice(0, 400);
    await take.box('brief', page.locator('.md-toolbar').first(), sheet);
    await R.sleep(2600);
    });

    // «Подкаст»: the player, its scene and subtitles; ▶ (no sound in the deck).
    await beat(result, 'podcast', async () => {
    const podcast = modes.getByRole('tab', { name: 'Подкаст' }).first();
    take.mark('podcast-tab');
    await take.click(podcast, { ms: 700 });
    const player = page.locator('section[aria-label="Подкаст по лекции"]').first();
    await player.waitFor({ timeout: 15000 });
    take.mark('podcast');
    await R.sleep(700);
    result.podcastMeta = clean(await page.locator('.cv-meta').first().innerText().catch(() => ''));
    await take.box('podcast', page.locator('.md-toolbar').first(), page.locator('.cv-stage').first());
    await R.sleep(1500);
    // The player whole in the window: the scene, the subtitles, ▶.
    await take.move(520, 560, { ms: 450 });
    await bring(take, page.locator('.cv-meta').first(), 96, { ms: 900 });
    take.mark('player');
    await take.box('player', page.locator('.cv-stage').first(), page.locator('.cv-voice').first(), page.locator('.cv-player').first());
    await take.box('scene', page.locator('.cv-stage').first());
    await take.box('voice', page.locator('.cv-voice').first(), page.locator('.cv-player').first());
    await R.sleep(1300);
    const play = page.locator('button.cv-play').first();
    take.mark('play');
    await take.click(play, { ms: 700 });
    await page.locator('button.cv-play[aria-label="Пауза"]').first().waitFor({ timeout: 20000 }).catch(() => {});
    take.mark('playing');
    result.playing = await play.getAttribute('aria-label');
    await page.locator('.cv-pos').filter({ hasText: /Реплика 2 из/ }).first().waitFor({ timeout: 20000 }).catch(() => {});
    take.mark('line2');
    await R.sleep(2600);
    result.subtitle = clean(await page.locator('.cv-line').first().innerText().catch(() => '')).slice(0, 200);
    await take.still('podcast');
    await R.sleep(2200);
    take.mark('end');
    await play.click().catch(() => {}); // pause, so nothing keeps playing
    await R.sleep(300);
    });

    result.unitsAfter = await meter(page);
    const at = (name, kind = 'row') => {
      const hit = (result.timeline || []).filter((e) => e[1] === kind && (kind !== 'row' || (e[2] === name && e[3] === 'done')));
      return hit.length ? hit[0][0] : null;
    };
    result.ready = {
      text: (result.timeline.find((e) => e[1] === 'heading' && /^Готовим/.test(e[2])) || [null])[0],
      'Конспект': at('Конспект'), 'Карточки': at('Карточки'), 'Тест': at('Тест'), 'Выжимка': at('Выжимка'), 'Подкаст': at('Подкаст'),
      results: at(null, 'results'), saved: at(null, 'saved'),
    };
    if (result.unitsBefore && result.unitsAfter) result.unitsSpent = result.unitsBefore.left - result.unitsAfter.left;
  } catch (e) {
    R.fail(e);
  } finally {
    if (take) await take.stop();
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify(result, null, 1));
    console.log(JSON.stringify(result, null, 1).slice(0, 6000));
    await browser.close();
  }
})();
