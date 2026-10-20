'use strict';
// Slide 11 (deck v2, release 47.4), the laptop: «Студия теста» builds a page. The author's own picture is dropped from
// the computer straight onto the page («Отпустите — картинка встанет сюда»), a «Видео» block comes from «Блоки»
// (pressed, it comes after the selected block and asks for a YouTube, RuTube or VK Видео link), and «Оформление» gets
// a theme and a colour.
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/take-studio2.cjs <take dir> <picture.png>
//
// Before the take (not filmed): a fresh test «Рыночное равновесие» on account A, three questions pasted through the
// studio's «Текст» view; the studio's first-visit tour is put away. The jury's own test is never touched. The file
// drop is the browser's own drag events with the file in their DataTransfer, as when a file is dragged from a folder.
// Window 1280 × 800 CSS px: under the site's top line (masked) the studio is 1280 × 734, the slide's box 1232 × 706
// in shape; device scale 1.75; stills at 3×. No pointer is drawn in the clip, only a ring where it presses.
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

    // The author's own picture, dropped from the computer onto the page between the cover and question 1.
    const canvas = page.locator('[data-tour="canvas"]').first();
    const q1 = await blocks.nth(1).boundingBox();
    const at = { x: q1.x + q1.width * 0.5, y: q1.y + 12 };
    await take.box('drop', blocks.nth(0), blocks.nth(1));
    await take.move(at.x, at.y + 90, { ms: 700 });
    const b64 = fs.readFileSync(PICTURE).toString('base64');
    const dt = await page.evaluateHandle(({ b64, name }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const d = new DataTransfer();
      d.items.add(new File([bytes], name, { type: 'image/png' }));
      return d;
    }, { b64, name: 'Равновесие.png' });
    const fire = (type, x, y) => canvas.evaluate((el, { type, x, y, dt }) => {
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: dt }));
    }, { type, x, y, dt });
    take.mark('fileover');
    await fire('dragenter', at.x, at.y + 90);
    await fire('dragover', at.x, at.y + 90);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    result.overlay = await canvas.getAttribute('data-file-over');
    for (let k = 0; k <= 30; k += 1) {
      const y = at.y + 90 - (90 * k) / 30;
      await page.mouse.move(at.x, y);
      take.events.push({ kind: 'move', x: at.x, y, t: R.now() });
      await fire('dragover', at.x, y);
      await R.sleep(45);
    }
    for (let k = 0; k < 24; k += 1) { await fire('dragover', at.x, at.y); await R.sleep(60); }
    await take.still('over');
    take.mark('drophold');
    await fire('drop', at.x, at.y);
    take.mark('dropped');
    await blocks.nth(1).locator('img').first().waitFor({ timeout: 60000 }).catch(() => {});
    await R.sleep(1500);
    take.mark('uploaded');
    result.blocks = await blocks.count();
    await take.box('picture', blocks.nth(1), side);
    await R.sleep(600);
    await take.still('poster');
    await R.sleep(1800);

    // A «Видео» block from «Блоки»: pressed, it comes after the selected block (the picture).
    take.mark('video');
    await take.click(palette.getByRole('button', { name: 'Видео' }), { ms: 900 });
    await R.sleep(1200);
    take.mark('videoin');
    const video = blocks.nth(2);
    await video.scrollIntoViewIfNeeded().catch(() => {});
    await R.sleep(500);
    await take.box('video', video, side);
    result.videoBlock = (await video.innerText().catch(() => '')).replace(/\n+/g, ' / ').slice(0, 200);
    await R.sleep(2600);
    await blocks.nth(1).scrollIntoViewIfNeeded().catch(() => {});
    await R.sleep(600);

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
    await take.still('end');
    await R.sleep(1600);

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
