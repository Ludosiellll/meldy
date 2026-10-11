'use strict';
// Slide 07, the laptop: «Экзамены» → «Новый экзамен» → a file of questions → «Нашли 240 вопросов» and where the key
// came from → the exam's date and minutes a day → «Сохранить» → the exam's page with today's plan → «План по дням».
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/take-07.cjs <take dir> [--date 2026-11-02] [--minutes 45]
//
// The file is the repository's synthetic bank backend/tests/fixtures/banks/synthetic/csharp_table.docx (240 C#
// questions, the key in bold), given the name a student would give it. The take creates a real exam on test account A
// and leaves it; its id goes to <take dir>/exam.json (tidy-07.cjs renames the kept one «Демо: …», deletes spares).
// The window: 1440 × 900 CSS px, device scale 2 (stills re-rendered at 2×; the screencast paints CSS pixels).
// The exam page's one-time Telegram tip is put away on this device (localStorage), as if dismissed before.
const fs = require('fs');
const path = require('path');
const R = require('./rec.cjs');

const DIR = path.resolve(process.argv[2] || 'take-07');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const DATE = arg('date', '2026-11-02');
const MINUTES = Number(arg('minutes', 45)); // 0: keep what Meldy suggests
const BANK = path.resolve(__dirname, '../../../../backend/tests/fixtures/banks/synthetic/csharp_table.docx');
const FILE_NAME = 'Программирование на C#.docx';
const W = 1440, H = 900, DPR = 2;

(async () => {
  const browser = await R.launch();
  const result = { date: DATE, minutes: MINUTES };
  let take = null;
  try {
    const ctx = await R.context(browser, { w: W, h: H, dpr: DPR, init: ["try{localStorage.setItem('meldy_tip_telegram','1')}catch(e){}"] });
    const page = await ctx.newPage();
    await R.u.signIn(page, 'A');
    await R.u.go(page, '/exams', 'exams');
    await page.getByRole('heading', { name: 'Экзамены' }).first().waitFor({ timeout: 30000 });
    await R.settle(page, 800);
    // The list must not hold an exam a take made before: the clip shows this one being made.
    const titles = await page.evaluate(() => [...document.querySelectorAll('main a[href^="/exams/"]')].map((a) => a.innerText.split('\n')[0]));
    if (titles.some((t) => /Программирование на C#/.test(t))) throw new Error('an earlier take\'s exam is still in «Экзамены»: run tidy-07.cjs first');

    take = new R.Take(page, DIR, { dpr: DPR, viewport: { width: W, height: H } });
    take.pointer = { x: 1000, y: 640 };
    await take.start();
    await take.still('exams');
    await R.sleep(500);
    await take.move(1030, 610, { ms: 300 });
    await R.sleep(500);

    // «Новый экзамен»
    take.mark('new');
    await take.click(page.locator('main a[href="/exams/import"]').first(), { ms: 750 });
    await page.waitForURL(/\/exams\/import/, { timeout: 30000 });
    await page.getByRole('button', { name: 'Выбрать файлы' }).first().waitFor({ timeout: 30000 });
    take.mark('import');
    await R.sleep(500);

    // The file: «Выбрать файлы» opens the system's file window (not part of the page); the file is chosen in it.
    const pick = page.getByRole('button', { name: 'Выбрать файлы' }).first();
    const chooser = page.waitForEvent('filechooser', { timeout: 15000 });
    await take.click(pick, { ms: 700 });
    const fc = await chooser;
    take.mark('chooser');
    // In the system's file window the hand goes elsewhere; on the page it comes to rest on an empty spot.
    await take.move(690, 610, { ms: 300 });
    await fc.setFiles({ name: FILE_NAME, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fs.readFileSync(BANK) });
    take.mark('file');
    await page.locator('h2.im-found', { hasText: 'Нашли' }).first().waitFor({ timeout: 180000 });
    take.mark('found');
    result.found = await page.locator('h2.im-found').first().innerText();
    result.row = (await page.locator('.im-row').first().innerText().catch(() => '')).replace(/\n/g, ' · ');
    await R.sleep(900);
    await take.still('found');
    await R.sleep(300);

    // The date: typed into the field — day, month, year. The hand steps aside so the typed date shows.
    const date = page.locator('input.im-date').first();
    await take.click(date, { ms: 650, fx: 0.16 });
    const box = await date.boundingBox();
    await take.move(box.x + box.width * 0.62, box.y + box.height + 34, { ms: 260 });
    const [y, m, d] = DATE.split('-');
    take.mark('date');
    await take.type(`${d}${m}${y}`, { delay: 105 });
    take.mark('dated');
    result.dateValue = await date.inputValue();
    await page.locator('.im-form .im-hint').filter({ hasText: /нужно|увидите/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
    take.mark('hint');
    result.hint = (await page.locator('.im-form .im-hint').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    result.minutesSuggested = await page.getByRole('combobox', { name: 'Время в день' }).first().innerText().catch(() => '');
    await R.sleep(1300);

    // Minutes a day: the list opens, one option is chosen.
    const minutesBox = page.getByRole('combobox', { name: 'Время в день' }).first();
    if (MINUTES) {
      take.mark('minutes');
      await take.click(minutesBox, { ms: 650 });
      await R.sleep(600);
      const option = page.getByRole('option', { name: `${MINUTES} минут` }).first();
      await take.click(option, { ms: 500 });
      take.mark('minuted');
      await R.sleep(1000);
    }
    result.minutesChosen = await minutesBox.innerText().catch(() => '');
    result.hintAfter = (await page.locator('.im-form .im-hint').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    await take.still('form');

    // «Сохранить» → the exam's page.
    const save = page.locator('.im-cta button.sf-primary').first();
    take.mark('save');
    await take.click(save, { ms: 750 });
    page.locator('.im-cta', { hasText: 'Сохраняем' }).first().waitFor({ timeout: 10000 }).then(() => take.mark('saving')).catch(() => {});
    await page.waitForURL(/\/exams\/c\/[0-9a-f-]{36}/, { timeout: 120000 });
    take.mark('exam');
    result.examId = (page.url().match(/\/exams\/c\/([0-9a-f-]{36})/) || [])[1];
    fs.writeFileSync(path.join(DIR, 'exam.json'), JSON.stringify({ id: result.examId }));
    const planLink = page.locator('main button').filter({ hasText: /^План по дням$/ }).first();
    await planLink.waitFor({ timeout: 60000 });
    take.mark('today');
    await take.move(1080, 690, { ms: 650 });
    await R.sleep(900);
    result.today = R.u.redact(await page.locator('main').first().innerText()).replace(/\n+/g, ' / ').slice(0, 700);
    await take.still('poster');
    await R.sleep(700);

    // «План по дням»
    take.mark('plan');
    await take.click(planLink, { ms: 750 });
    await page.getByRole('dialog').first().waitFor({ timeout: 15000 });
    take.mark('planned');
    await R.sleep(1300);
    result.plan = R.u.redact(await page.getByRole('dialog').first().innerText()).replace(/\n+/g, ' / ').slice(0, 700);
    await take.still('plan');
    await R.sleep(1500);
  } catch (e) {
    R.fail(e);
  } finally {
    if (take) await take.stop();
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify(result, null, 1));
    console.log(JSON.stringify(result, null, 1).slice(0, 3000));
    await browser.close();
  }
})();
