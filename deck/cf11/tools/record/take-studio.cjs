'use strict';
// Slide 11 (deck v2), the laptop: «Студия теста» builds a page. A «Картинка» block is dragged from «Блоки» onto the
// page between the cover and the first question, the author's own picture goes into it, «Оформление» gets a theme
// and a colour, and «Посмотреть как участник» shows the test as a participant sees it.
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/take-studio.cjs <take dir> <picture.png>
//
// Before the take (not filmed): a fresh test «Рыночное равновесие» on account A, three questions pasted through the
// studio's «Текст» view, the studio's first-use tour skipped. The jury's own test is never touched. The take leaves
// the test in the account; its id goes to <take dir>/test.json. Window 1280 × 800 CSS px: under the site's top line
// (masked) the whole studio is 1280 × 734, the slide's box 1232 × 706 in shape; device scale 1.75; stills at 3×. No pointer is drawn in the clip, only a ring where it presses.
const fs = require('fs');
const path = require('path');
const R = require('./rec.cjs');

const DIR = path.resolve(process.argv[2] || 'take-studio');
const PICTURE = path.resolve(process.argv[3] || 'demand-curves.png');
const W = 1280, H = 800, DPR = 1.75;
const TITLE = 'Рыночное равновесие';
const TEXT = [
  '[обложка] Рыночное равновесие',
  'Проверочная по теме «Спрос и предложение»',
  '',
  'Что происходит на рынке, если цена выше равновесной?',
  '+ Излишек товара',
  '- Дефицит товара',
  '- Ничего не меняется',
  '> При цене выше равновесной продавцы предлагают больше, чем покупатели готовы купить.',
  '',
  'Как называется цена, при которой величина спроса равна величине предложения?',
  '+ Равновесная',
  '- Максимальная',
  '- Средняя',
  '',
  'При росте цены величина спроса обычно растёт.',
  '- Верно',
  '+ Неверно',
  '> По закону спроса при росте цены величина спроса снижается.',
].join('\n');

(async () => {
  const browser = await R.launch([`--force-device-scale-factor=${DPR}`]);
  const result = {};
  let take = null;
  try {
    // The studio's first-visit tour is put away on this device, as if seen before (its key holds the user's id).
    const noTour = "(()=>{const g=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(typeof k==='string'&&k.startsWith('meldy_studio_tour:'))return '1';return g.call(this,k);};})();";
    const ctx = await R.context(browser, { w: W, h: H, dpr: DPR, init: [noTour] });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    await R.u.signIn(page, 'A');

    // Setup, not filmed: the test and its three questions.
    await R.u.go(page, '/tests/new', 'newtest');
    await page.locator('main input').first().fill(TITLE);
    await page.getByRole('button', { name: 'Создать' }).click();
    await page.waitForURL(/\/exams\/c\/[0-9a-f-]{36}\/studio/, { timeout: 60000 });
    result.testId = (page.url().match(/\/exams\/c\/([0-9a-f-]{36})/) || [])[1];
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'test.json'), JSON.stringify({ id: result.testId }));
    await R.settle(page, 1500);
    for (let i = 0; i < 3; i += 1) {
      const skip = page.getByRole('button', { name: 'Пропустить' });
      if (await skip.count()) { await skip.first().click(); await R.sleep(500); }
    }
    await page.getByRole('button', { name: 'Текст', exact: true }).first().click();
    await page.locator('textarea.st-text-area').fill(TEXT);
    await page.getByRole('button', { name: 'Применить' }).first().click();
    await page.getByText('Применено.').first().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Холст', exact: true }).first().click();
    await page.locator('.st-block').nth(3).waitFor({ timeout: 30000 });
    await R.settle(page, 1500);
    await page.mouse.move(W * 0.5, H * 0.9);
    await R.sleep(600);

    const blocks = page.locator('.st-block');
    const palette = page.locator('.st-col-left');
    const side = page.locator('.st-side');

    take = new R.Take(page, DIR, { dpr: DPR, viewport: { width: W, height: H } });
    take.stillScale = 3 / DPR;
    take.pointer = { x: W * 0.5, y: H * 0.9 };
    await take.start();
    await take.box('studio', { x: 0, y: 60, width: W, height: H - 60 });
    await R.sleep(1800);

    // Drag «Картинка» from «Блоки» onto the page, between the cover and question 1.
    const source = palette.getByRole('button', { name: 'Картинка' });
    const p = await take.aim(source);
    await take.box('palette', palette, blocks.nth(1));
    await take.move(p.x, p.y, { ms: 800 });
    await R.sleep(250);
    take.mark('grab');
    take.events.push({ kind: 'down', x: p.x, y: p.y, t: R.now() });
    await page.mouse.down();
    await R.sleep(120);
    const q1 = await blocks.nth(1).boundingBox();
    await take.move(p.x + 40, p.y - 10, { ms: 220 });
    await take.move(q1.x + q1.width * 0.45, q1.y + 18, { ms: 1100 });
    await R.sleep(700);
    take.mark('over');
    await page.mouse.up();
    take.events.push({ kind: 'up', x: q1.x + q1.width * 0.45, y: q1.y + 18, t: R.now() });
    take.mark('dropped');
    await R.sleep(900);
    result.blocks = await blocks.count();
    await take.box('dropped', blocks.nth(0), blocks.nth(2));
    await R.sleep(1200);

    // The author's own picture into it.
    const upload = side.getByRole('button', { name: /Загрузить/ }).first();
    take.mark('upload');
    const chooser = page.waitForEvent('filechooser', { timeout: 15000 });
    await take.click(upload, { ms: 800 });
    const fc = await chooser;
    take.mark('chooser');
    await fc.setFiles(PICTURE);
    await side.getByRole('button', { name: 'Заменить' }).first().waitFor({ timeout: 60000 });
    await R.sleep(1200);
    take.mark('uploaded');
    const img = blocks.nth(1);
    await img.scrollIntoViewIfNeeded().catch(() => {});
    await R.sleep(500);
    await take.box('picture', img, side);
    await R.sleep(2200);

    // «Оформление»: a theme, then a colour.
    take.mark('design');
    await take.click(side.getByText('Оформление', { exact: true }).first(), { ms: 700 });
    await R.sleep(900);
    await take.box('designpanel', side, blocks.nth(0));
    await take.click(side.getByRole('button', { name: /Яркая/ }).first(), { ms: 700 });
    await R.sleep(1500);
    take.mark('themed');
    const green = side.getByRole('button', { name: 'Зелёный' }).first();
    await green.scrollIntoViewIfNeeded();
    await R.sleep(500);
    await take.click(green, { ms: 650 });
    await R.sleep(1600);
    take.mark('coloured');
    await page.mouse.move(W * 0.45, H * 0.6);
    await R.sleep(400);
    await take.still('poster');
    await R.sleep(1600);

    // As a participant.
    take.mark('preview');
    await take.click(page.getByRole('button', { name: /Как участник|Посмотреть как участник/ }).first(), { ms: 800 });
    const dialog = page.getByRole('dialog').first();
    await dialog.waitFor({ timeout: 15000 });
    await R.sleep(800);
    take.mark('previewed');
    await take.box('previewbox', dialog);
    await R.sleep(3000);
    await take.still('preview');
    await R.sleep(600);
    take.mark('end');
    result.text = R.u.redact(await page.locator('main').first().innerText()).replace(/\n+/g, ' / ').slice(0, 600);
  } catch (e) {
    R.fail(e);
  } finally {
    if (take) await take.stop();
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify(result, null, 1));
    console.log(JSON.stringify(result, null, 1).slice(0, 2000));
    await browser.close();
  }
})();
