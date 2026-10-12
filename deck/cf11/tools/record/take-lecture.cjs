'use strict';
// The «Лекции» slide, the laptop: «Разобрать лекцию» → the four ways in → «Аудио и видео» → the lecture video →
// «Что сделать из лекции», all five ticked → «Запустить анализ» → (the wait: cut in the clip) → the results the analysis
// lands on, all on the result screen (release 44.1): «Конспект», a retelling (its «Ключевые тезисы», each section of the
// lecture held in turn, then «Термины»), «Карточки» (one card turned over), «Тест» (one question answered, the check and
// its «Пояснение»), «Выжимка» (a tab of its own) and «Подкаст» (the player: its scene and subtitles, ▶, the second
// line; the deck has no sound). Outside the clip, «Открыть лекцию» gives the saved lecture's id. The card and the
// question are the first ones whose text has no slip (slipOf: the model speaking about «the text», another alphabet
// inside a word), so the clip can show them; the sections are all held so the cut can choose one.
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/take-lecture.cjs <take dir> [--file <lecture.mp4>]
//                                                                     [--input mp4|mp3|m4a|pdf] [--dry] [--dpr 1.5]
//                                                                     [--quiz-difficulty easy|medium|hard|mixed]
// (--input m4a needs --file: make.py writes the MP4, an MP3 and the slides' PDF. --dry rehearses the beats up to
// «Запустить анализ» and does not press it: nothing is spent, nothing is saved. --quiz-difficulty sets «Сложность
// теста» off the clip, before the press: the server answers a text it has seen with the materials it made for it, so
// only another setting gets a new test.)
//
// The lecture is our own (tools/record/lecture: the text, the slides, a synthetic voice; make.py builds the video,
// and the same lecture as an MP3 and as a PDF of its slides should the video path fail). The take uploads it as
// «Рыночное равновесие (лекция).mp4» and leaves the lecture in the library of test account A (its id goes to
// <take dir>/material.json). It measures what the deck may say about time: from the press on «Запустить анализ» to
// each material's «Готово» in the progress card (watched in the page), to the results, to the lecture being saved; and
// the AI units the analysis spent (the limit's ring in the top line, before and after). The analysis' own answer (its
// «results» event) goes to <take dir>/materials.json, to read the materials the clip shows against the lecture.
//
// The window: 1024 × 800 CSS px, the site's desktop layout at its narrowest (as 07 and 09), rendered at device scale
// 1.5 (frames 1536 × 1200; stills at 3×). At 1.75 this machine paints the site's scrolls and transitions at 15–20
// frames a second (screencast gaps of 50–100 ms, with the CPU idle), at 1.5 the result screen at 30 (the upload page's
// coloured panels stay near 20 at any scale); the screen on the slide is 1152 px wide, so the beats framed 770 CSS px
// and wider are still drawn from more pixels than they show. Calm: each beat held for real, the hand at a person's
// pace, each beat's rectangle logged for the camera (Take.box). No pointer is drawn in the clip, only a ring where it
// presses. The top line (the limit, the avatar) is never framed: the camera keeps below it (cut-lecture.json,
// camera.y_min), and the master and its poster paint it over (cut-lecture.json, mask). The first 15 s after the press
// are recorded as they come (the rows of the progress card turn «Готово»); a longer analysis pauses the screencast
// (its spinners would paint a frame every 16 ms for minutes) until the results, and the card's own log keeps the times.
// The lecture page's first-use tip («Поговорить о лекции») is put away on this device, as if dismissed before.
const fs = require('fs');
const path = require('path');
const R = require('./rec.cjs');

const DIR = path.resolve(process.argv[2] || 'take-lecture');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const DRY = process.argv.includes('--dry');
const QUIZ_DIFFICULTY = arg('quiz-difficulty', null);
if (QUIZ_DIFFICULTY && !['easy', 'medium', 'hard', 'mixed'].includes(QUIZ_DIFFICULTY)) throw new Error('--quiz-difficulty is easy, medium, hard or mixed');
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
const W = 1024, H = 800, DPR = Number(arg('dpr', 1.5));
const TOP = 84; // the top line ends at 76 CSS px: what the camera frames starts below it

// Text out of the page goes through ulib's redact() and loses anything shaped like an e-mail address.
const clean = (t) => R.u.redact(String(t || '')).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<e-mail>');
const flat = (t, n = 400) => clean(t).replace(/\n+/g, ' / ').slice(0, n);
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

/** The analysis' «results» event, read off its stream (the last one wins). */
function resultsOf(sse) {
  let results = null;
  for (const line of String(sse).split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim());
      if (ev && ev.type === 'results') results = ev;
    } catch { /* a keepalive or a partial line */ }
  }
  return results;
}

/** The right option of each question, from the analysis' own answer (its quiz, read off the stream). */
function quizKey(sse) {
  const results = resultsOf(sse);
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

/**
 * What would make a line of the materials wrong to show: the model speaking about its input («Согласно тексту…», «в
 * тексте упомянут как…», «В лекции сказано…») or a letter of another alphabet inside a word. Null when none is found
 * (the facts are read by a person: materials.json).
 */
function slipOf(...texts) {
  const t = texts.map((x) => String(x || '')).join(' \n ');
  const remark = /(текст|упомина|упомян|лекци|лектор|согласно|говорится|сказано|указано|отмечается|по словам)/i.exec(t);
  if (remark) return `remark «${remark[1]}»`;
  if (/[А-Яа-яЁё][A-Za-z]|[A-Za-z][А-Яа-яЁё]/.test(t)) return 'mixed alphabets in a word';
  if (/[\u0370-\u03FF\u0590-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/.test(t)) return 'a letter of another script';
  return null;
}

/** The first item of a list the clip can show without a slip (its index), else 0; and what was found in each. */
function firstClean(items, fields) {
  const slips = (items || []).map((it) => slipOf(...fields(it)));
  const k = slips.findIndex((s) => s === null);
  return { index: k < 0 ? 0 : k, slips };
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
  const result = { input: INPUT, file: path.basename(FILE), fileName: FILE_NAME, bytes: fs.statSync(FILE).size, dry: DRY };
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

    // --quiz-difficulty (off the clip): «Сложность теста» under the list. The server keeps the model's answers for a
    // text it has already seen, so another take of the same recording gets the very same materials; another difficulty
    // asks the model for a new test and leaves the other four as they were.
    if (QUIZ_DIFFICULTY) {
      const group = page.locator('.ac-set').filter({ hasText: 'Сложность теста' }).first();
      const label = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный', mixed: 'Смешанный' }[QUIZ_DIFFICULTY];
      const btn = group.getByRole('button', { name: label, exact: true }).first();
      take.mark('difficulty');
      await take.move(560, 520, { ms: 400 });
      await bring(take, group, 420, { ms: 900 });
      await take.click(btn, { ms: 600 });
      await R.sleep(500);
      result.quizDifficulty = (await btn.getAttribute('aria-pressed')) === 'true' ? QUIZ_DIFFICULTY : `not set (${QUIZ_DIFFICULTY})`;
      await take.move(560, 520, { ms: 400 });
      await bring(take, page.locator('.ac-settings-h').first(), 280, { ms: 900 });
      take.mark('difficulty-done');
      await R.sleep(800);
    }

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
    if (DRY) {
      // The rehearsal ends here: the hand rests on «Запустить анализ» and does not press it.
      take.mark('dry-end');
      await R.sleep(1500);
      result.unitsAfter = await meter(page);
      return;
    }
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
    take.mark('wait');

    // The wait (cut in the clip). The page keeps its own log of the rows; the results or an error end it. Release 44.1
    // makes the five materials of a three-minute recording in about ten seconds: the first 15 s from the press are
    // recorded as they come (the rows turn «Готово» one by one, the card gives way to the results); a longer wait is
    // not (the screencast pauses until the results).
    const t0 = Date.now();
    let outcome = null;
    let paused = false;
    while (Date.now() - t0 < 11 * 60 * 1000) {
      outcome = await page.evaluate(() => {
        if (document.querySelector('#analysis-error-heading')) return 'error';
        if (document.querySelector('.rp-result-head')) return 'results';
        return null;
      }).catch(() => null);
      if (outcome) break;
      if (!paused && Date.now() - pressedAt > 15000) {
        take.mark('pause');
        await pause(take);
        paused = true;
      }
      await R.sleep(100);
    }
    const log = await page.evaluate(() => window.__ag || []);
    result.timeline = log.map(([t, ...e]) => [Math.round((t - pressedAt) / 100) / 10, ...e.map((x) => clean(x).slice(0, 160))]);
    result.pausedForTheWait = paused;
    console.log('  progress log (s from the press):');
    for (const row of result.timeline) console.log('   ', JSON.stringify(row));
    // The card's moments as the take's own marks (the page's clock is the take's): «done-Конспект» …, «results-in».
    const NAMES = { 'Конспект': 'konspekt', 'Карточки': 'kartochki', 'Тест': 'test', 'Выжимка': 'vyzhimka', 'Подкаст': 'podcast' };
    for (const [t, kind, name, status] of log) {
      if (kind === 'row' && status === 'done' && NAMES[name]) take.events.push({ kind: 'mark', name: `done-${NAMES[name]}`, t: t / 1000 });
      if (kind === 'results') take.events.push({ kind: 'mark', name: 'results-in', t: t / 1000 });
    }
    if (outcome !== 'results') {
      if (paused) await resume(take);
      await R.sleep(1500);
      result.error = outcome === 'error' ? clean(await page.locator('.az-fail').first().innerText()).replace(/\n+/g, ' / ') : 'no results within 11 minutes';
      await take.box('error', page.locator('.az-fail').first());
      await R.sleep(1500);
      throw new Error(`the analysis did not finish: ${result.error}`);
    }
    // The results are in: the window at its top, the screencast on.
    await page.evaluate(() => window.scrollTo(0, 0));
    if (paused) await resume(take);
    take.mark('results');
    await R.sleep(1200);
    const head = page.locator('.rp-result-head').first();
    const tabsRow = page.locator('.rp-tabsrow').first();
    result.title = clean(await page.locator('h1.rp-title').first().innerText().catch(() => ''));
    result.resultHead = flat(await head.innerText());
    result.tabs = clean(await tabsRow.innerText().catch(() => '')).replace(/\n+/g, ' ');
    await take.box('results', head, tabsRow);
    await take.box('results-top', head, tabsRow, page.locator('.sv-sec').first());
    // What the analysis made, as its own answer says it (to read against the lecture); it holds no account data.
    const answer = resultsOf(await page.evaluate(() => window.__sse || ''));
    if (answer) fs.writeFileSync(path.join(DIR, 'materials.json'), clean(JSON.stringify(answer, null, 1)));
    await R.sleep(2000);

    // «Конспект», a retelling: «Ключевые тезисы», then the lecture's sections in its order, «Выводы»; «Термины» last.
    // Each section of the lecture is held in turn, so the clip can show one the model retold without a slip.
    await beat(result, 'summary', async () => {
      const secs = page.locator('.sv-sec:not(.sv-terms)');
      result.sections = await page.locator('.sv-sec h2.sv-h2').allInnerTexts().catch(() => []);
      const theses = secs.first();
      result.theses = flat(await theses.innerText(), 900);
      await take.move(520, 560, { ms: 450 });
      await bring(take, tabsRow, 96, { ms: 1000 });
      take.mark('theses');
      await take.box('theses', tabsRow, theses);
      await take.box('theses-only', theses);
      await R.sleep(2600);
      // The sections of the lecture: after the theses, before «Выводы».
      const n = await secs.count();
      result.sectionTexts = [];
      for (let i = 1; i < n - 1; i += 1) {
        const sec = secs.nth(i);
        result.sectionTexts.push(flat(await sec.innerText(), 900));
        await bring(take, sec, 110, { ms: 1000 });
        take.mark(`section-${i}`);
        if (i === 1) take.mark('section');
        await take.box(`section-${i}`, sec);
        await R.sleep(2400);
      }
      // «Термины», where the конспект keeps them.
      const terms = page.locator('section.sv-terms').first();
      if (await terms.count()) {
        await bring(take, terms, 110, { ms: 1100 });
        take.mark('terms');
        result.terms = (await page.locator('.sv-term').allInnerTexts().catch(() => [])).map((t) => flat(t, 300)).slice(0, 14);
        await take.box('terms', terms);
        await R.sleep(2600);
      }
    });

    // «Карточки»: one card turned over (the first one without a slip).
    await beat(result, 'cards', async () => {
      await take.move(520, 400, { ms: 450 });
      await bring(take, tabsRow, 120, { ms: 900 });
      const cardsTab = tabsRow.getByRole('button', { name: /Карточки/ }).first();
      take.mark('cards-tab');
      await take.click(cardsTab, { ms: 700 });
      const pickCard = firstClean(answer && answer.flashcards && answer.flashcards.flashcards, (c) => [c.question, c.answer]);
      result.cardPick = pickCard;
      const card1 = page.locator('li.fc-card').nth(pickCard.index);
      await card1.waitFor({ timeout: 15000 });
      await R.sleep(500);
      if (pickCard.index > 0) await bring(take, card1, 200, { ms: 900 });
      await take.box('cards', tabsRow, card1);
      take.mark('cards');
      await R.sleep(1200);
      take.mark('flip');
      await take.click(card1.locator('.fc-q').first(), { ms: 700, fx: 0.35 });
      await card1.locator('.fc-answer').first().waitFor({ timeout: 10000 });
      take.mark('flipped');
      await R.sleep(700);
      result.card = flat(await card1.innerText(), 500);
      await take.box('card', tabsRow, card1);
      await take.box('card-only', card1);
      await R.sleep(2200);
    });

    // «Тест»: one question answered — the first whose question, options and «Пояснение» have no slip; the rest are
    // answered too (cut), «Проверить ответы», then that question again with its «Пояснение».
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
      const pickQ = firstClean(answer && answer.quiz && answer.quiz.quiz, (q) => [q.question, ...(q.options || []), q.explanation]);
      result.quizPick = pickQ;
      const qk = page.locator('li.qz-card').nth(pickQ.index);
      result.quizShown = flat(await qk.innerText(), 500);
      if (pickQ.index > 0) {
        await take.move(520, 420, { ms: 400 });
        await bring(take, qk, 150, { ms: 900 });
        await take.box('quiz', qk);
      } else {
        await take.box('quiz', page.locator('.qz-head').first(), qk);
      }
      take.mark('quiz');
      await R.sleep(1200);
      take.mark('answer');
      await take.click(qk.locator('button.qz-opt').nth(pick(pickQ.index)), { ms: 750, fx: 0.3 });
      take.mark('answered');
      await R.sleep(1600);
      for (let i = 0; i < nq; i += 1) {
        if (i === pickQ.index) continue;
        const qi = page.locator('li.qz-card').nth(i);
        const b = await qi.boundingBox();
        if (b && (b.y + b.height > H - 40 || b.y < TOP)) await bring(take, qi, 160, { ms: 600 });
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
      if (pickQ.index > 0) await bring(take, qk, 150, { ms: 1000 });
      else await bring(take, page.locator('.qz-head').first(), 110, { ms: 1000 });
      take.mark('explained');
      result.quizScore = flat(await resultBox.innerText(), 200);
      result.explainShown = clean(await qk.locator('.qz-explain').first().innerText().catch(() => '')).slice(0, 400);
      if (pickQ.index === 0) await take.box('explain', resultBox, qk);
      await take.box('explain-q', qk);
      await R.sleep(2800);
    });

    // «Выжимка»: a tab of the result screen now (release 44.1), the one page to repeat before the exam.
    await beat(result, 'brief', async () => {
      await take.move(520, 420, { ms: 400 });
      await bring(take, tabsRow, 120, { ms: 1000 });
      const briefTab = tabsRow.getByRole('button', { name: /Выжимка/ }).first();
      take.mark('brief-tab');
      await take.click(briefTab, { ms: 700 });
      const sheet = page.locator('article.xp-sheet').first();
      await sheet.waitFor({ timeout: 15000 });
      take.mark('brief');
      await R.sleep(500);
      result.brief = flat(await sheet.innerText(), 1200);
      await take.box('brief', tabsRow, sheet);
      await take.box('brief-head', tabsRow, page.locator('.xp-sheet-head').first());
      await R.sleep(2800);
    });

    // «Подкаст»: the player on the result screen (it brings itself into view), its scene and subtitles; ▶ (no sound in
    // the deck). Its first lines' speech is prepared while the other tabs are read.
    await beat(result, 'podcast', async () => {
      const podcastTab = tabsRow.getByRole('button', { name: /Подкаст/ }).first();
      take.mark('podcast-tab');
      await take.click(podcastTab, { ms: 700 });
      const player = page.locator('section.cv-show[aria-label="Подкаст по лекции"]').first();
      await player.waitFor({ timeout: 15000 });
      take.mark('podcast');
      await R.sleep(1500); // the page scrolls the player into view by itself, smoothly
      result.podcastMeta = clean(await page.locator('.cv-meta').first().innerText().catch(() => ''));
      const stage = page.locator('.cv-stage').first();
      const voice = page.locator('.cv-voice').first();
      const controls = page.locator('.cv-player').first();
      const pb = await controls.boundingBox();
      const sb = await stage.boundingBox();
      if ((pb && pb.y + pb.height > H - 8) || (sb && sb.y < TOP)) {
        // The player whole in the window: the scene, the subtitles, ▶.
        await take.move(520, 560, { ms: 450 });
        await bring(take, page.locator('.cv-meta').first(), 96, { ms: 900 });
      }
      take.mark('player');
      await take.box('podcast', tabsRow, stage);
      await take.box('player', stage, voice, controls);
      await take.box('scene', stage);
      await take.box('voice', voice, controls);
      result.subtitle1 = flat(await page.locator('.cv-line').first().innerText().catch(() => ''), 300);
      result.scene1 = flat(await stage.innerText().catch(() => ''), 400);
      await R.sleep(1500);
      const play = page.locator('button.cv-play').first();
      take.mark('play');
      const playAt = Date.now();
      await take.click(play, { ms: 700 });
      await page.locator('button.cv-play[aria-label="Пауза"]').first().waitFor({ timeout: 30000 }).catch(() => {});
      take.mark('playing');
      result.playingAfter = Math.round((Date.now() - playAt) / 100) / 10;
      result.playing = await play.getAttribute('aria-label');
      await R.sleep(1800);
      await page.locator('.cv-pos').filter({ hasText: /Реплика 2 из/ }).first().waitFor({ timeout: 40000 }).catch(() => {});
      take.mark('line2');
      result.line2After = Math.round((Date.now() - playAt) / 100) / 10;
      await R.sleep(2400);
      result.subtitle2 = flat(await page.locator('.cv-line').first().innerText().catch(() => ''), 300);
      result.scene2 = flat(await stage.innerText().catch(() => ''), 400);
      await take.still('podcast');
      await R.sleep(2200);
      take.mark('end');
      await play.click().catch(() => {}); // pause, so nothing keeps playing
      await R.sleep(300);
    });

    // Outside the clip: «Открыть лекцию» (under the results) opens the saved lecture; its id is the take's.
    await take.stop();
    const open = page.locator('.az-after button').filter({ hasText: 'Открыть лекцию' }).first();
    await open.waitFor({ timeout: 60000 });
    const savedAt = (await page.evaluate(() => (window.__ag || []).find((e) => e[1] === 'saved')).catch(() => null)) || null;
    result.savedAt = savedAt ? Math.round((savedAt[0] - pressedAt) / 100) / 10 : null;
    await open.scrollIntoViewIfNeeded();
    await open.click();
    await page.waitForURL(/\/library\/[0-9a-f-]{36}$/, { timeout: 30000 });
    result.materialId = (page.url().match(/\/library\/([0-9a-f-]{36})/) || [])[1];
    fs.writeFileSync(path.join(DIR, 'material.json'), JSON.stringify({ id: result.materialId }));
    await page.getByRole('tablist', { name: 'Режим' }).first().waitFor({ timeout: 30000 }).catch(() => {});
    result.lectureHead = flat(await page.locator('header.md-head').first().innerText().catch(() => ''), 300);

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
    console.log(JSON.stringify(result, null, 1).slice(0, 8000));
    await browser.close();
  }
})();
