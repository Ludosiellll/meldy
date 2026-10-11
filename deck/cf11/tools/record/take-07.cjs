'use strict';
// Slide 07, the laptop: «Новый экзамен» → a file of questions → «Нашли 240 вопросов» and where the key came from →
// the exam's date and minutes a day → «Сохранить» → the exam's page with today's plan → «План по дням».
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/take-07.cjs <take dir> [--date 2026-11-02] [--minutes 45]
//
// The file is the repository's synthetic bank backend/tests/fixtures/banks/synthetic/csharp_table.docx (240 C#
// questions, the key in bold), given the name a student would give it. The take creates a real exam on test account A
// and leaves it; its id goes to <take dir>/exam.json (tidy-07.cjs renames the kept one «Демо: …», deletes spares).
// The window: 1024 × 800 CSS px — the site's own desktop layout at its narrowest (a 1440-wide laptop at 140 %), so
// each beat sits in a part of the screen the camera can frame — rendered at device scale 1.75 (frames 1792 × 1400;
// stills at 3×). Calm: each beat is held for real, the hand moves at a person's pace, and each beat's rectangle is
// logged for the camera (Take.box). No pointer is drawn in the clip, only a ring where it presses.
// The exam page's one-time Telegram tip is put away on this device (localStorage), as if dismissed before.
const fs = require('fs');
const path = require('path');
const R = require('./rec.cjs');

const DIR = path.resolve(process.argv[2] || 'take-07');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const DATE = arg('date', '2026-11-02');
const MINUTES = Number(arg('minutes', 45));
const BANK = path.resolve(__dirname, '../../../../backend/tests/fixtures/banks/synthetic/csharp_table.docx');
const FILE_NAME = 'Программирование на C#.docx';
const TITLE = 'Программирование на C#';
const W = 1024, H = 800, DPR = 1.75;

(async () => {
  const browser = await R.launch([`--force-device-scale-factor=${DPR}`]);
  const result = { date: DATE, minutes: MINUTES };
  let take = null;
  try {
    const ctx = await R.context(browser, { w: W, h: H, dpr: DPR, init: ["try{localStorage.setItem('meldy_tip_telegram','1')}catch(e){}"] });
    const page = await ctx.newPage();
    await R.u.signIn(page, 'A');
    await R.u.go(page, '/exams', 'exams');
    await page.getByRole('heading', { name: 'Экзамены' }).first().waitFor({ timeout: 30000 });
    await R.settle(page, 800);
    // No exam of an earlier take under this very name: the clip shows this one being made.
    const titles = await page.evaluate(() => [...document.querySelectorAll('main a[href^="/exams/"]')].map((a) => a.innerText.split('\n')[0].trim()));
    if (titles.includes(TITLE)) throw new Error(`an exam «${TITLE}» is already in «Экзамены»: run tidy-07.cjs first`);

    await R.u.go(page, '/exams/import', 'import');
    const pick = page.getByRole('button', { name: 'Выбрать файлы' }).first();
    await pick.waitFor({ timeout: 30000 });
    await R.settle(page, 1500);

    take = new R.Take(page, DIR, { dpr: DPR, viewport: { width: W, height: H } });
    take.stillScale = 3 / DPR;
    take.pointer = { x: 640, y: 560 };
    await take.start();
    await take.box('import', page.getByRole('heading', { name: 'Новый экзамен' }).first(), page.getByText('Загрузите вопросы').first(), pick,
      page.getByText(/^Word, Excel/).first());
    await R.sleep(2700);

    // The file: «Выбрать файлы» opens the system's file window (not part of the page); the file is chosen in it.
    take.mark('pick');
    const chooser = page.waitForEvent('filechooser', { timeout: 15000 });
    await take.click(pick, { ms: 800 });
    const fc = await chooser;
    take.mark('chooser');
    await R.sleep(700);
    await fc.setFiles({ name: FILE_NAME, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fs.readFileSync(BANK) });
    take.mark('file');
    await page.locator('h2.im-found', { hasText: 'Нашли' }).first().waitFor({ timeout: 180000 });
    take.mark('found');
    result.found = await page.locator('h2.im-found').first().innerText();
    result.row = (await page.locator('.im-row').first().innerText().catch(() => '')).replace(/\n/g, ' · ');
    await R.sleep(500);
    await take.box('found', page.getByRole('heading', { name: 'Новый экзамен' }).first(), page.locator('h2.im-found').first(), page.locator('.im-row').first());
    await R.sleep(2400);

    // The form: the camera moves to it; then the date, typed — day, month, year.
    const date = page.locator('input.im-date').first();
    const minutesBox = page.getByRole('combobox', { name: 'Время в день' }).first();
    const save = page.locator('.im-cta button.sf-primary').first();
    await take.box('form', page.locator('.im-form').first(), save);
    take.mark('form');
    await R.sleep(1200);
    // On the day: the field's first part (дд.мм.гггг), so the digits fill day, month and year in turn.
    await take.click(date, { ms: 700, fx: 0.09 });
    await R.sleep(350);
    const [y, m, d] = DATE.split('-');
    take.mark('date');
    await take.type(`${d}${m}${y}`, { delay: 170 });
    take.mark('dated');
    result.dateValue = await date.inputValue();
    if (result.dateValue !== DATE) throw new Error(`the date field reads «${result.dateValue}», not ${DATE}: nothing saved`);
    await page.locator('.im-form .im-hint').filter({ hasText: /нужно|увидите/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
    result.hint = (await page.locator('.im-form .im-hint').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    result.minutesSuggested = await minutesBox.innerText().catch(() => '');
    await R.sleep(1100);

    // Minutes a day: the list opens, one option is chosen.
    if (MINUTES) {
      take.mark('minutes');
      await take.click(minutesBox, { ms: 650 });
      await R.sleep(800);
      take.mark('menu');
      await take.click(page.getByRole('option', { name: `${MINUTES} минут` }).first(), { ms: 500 });
      take.mark('minuted');
    }
    result.minutesChosen = await minutesBox.innerText().catch(() => '');
    result.hintAfter = (await page.locator('.im-form .im-hint').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
    await take.box('form2', page.locator('.im-form').first(), save);
    await R.sleep(2200);

    // «Сохранить» → the exam's page (the save itself is waiting: cut in the clip).
    take.mark('save');
    await take.click(save, { ms: 700 });
    await page.waitForURL(/\/exams\/c\/[0-9a-f-]{36}/, { timeout: 120000 });
    take.mark('exam');
    result.examId = (page.url().match(/\/exams\/c\/([0-9a-f-]{36})/) || [])[1];
    fs.writeFileSync(path.join(DIR, 'exam.json'), JSON.stringify({ id: result.examId }));
    const planLink = page.locator('main button').filter({ hasText: /^План по дням$/ }).first();
    await planLink.waitFor({ timeout: 60000 });
    const today = page.locator('main').getByText(/Сегодня/).first();
    await today.waitFor({ timeout: 60000 });
    take.mark('today');
    await R.sleep(600);
    const planCard = await R.cardOf(today);
    await take.box('plan', page.getByRole('heading', { level: 1 }).first(), planCard);
    result.today = R.u.redact(await page.locator('main').first().innerText()).replace(/\n+/g, ' / ').slice(0, 700);
    await R.sleep(900);
    await take.still('poster');
    await R.sleep(1700);

    // «План по дням»
    take.mark('plan');
    await take.click(planLink, { ms: 750 });
    const dialog = page.getByRole('dialog').first();
    await dialog.waitFor({ timeout: 15000 });
    take.mark('dialog');
    await R.sleep(600);
    await take.box('dialog', dialog);
    result.plan = R.u.redact(await dialog.innerText()).replace(/\n+/g, ' / ').slice(0, 700);
    await R.sleep(2600);
    await take.still('plan');
    await R.sleep(800);
    take.mark('end');
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
