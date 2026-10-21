'use strict';
// Slide 11 (deck v2, release 47.22), the laptop: a fast tour of the test studio, every step done for real on the live
// site, one test from the empty page to its link. «Тесты» → «Тест в студии» → the page «Новый тест»: the name typed,
// «Создать тест» → the empty studio. From «Блоки»: a heading and a text typed in place, the author's own picture
// dragged in from the computer («Отпустите, и картинка встанет сюда»), a «Видео» block with a YouTube link pasted
// (the player comes in). The four kinds of question from «Вопросы» («Один ответ», «Несколько ответов», «Верно /
// неверно», «Короткий ответ»), then 3 points on the last one. «Оформление»: the theme «Яркая», the colour «Зелёный»,
// the font «С засечками». «Результат»: a message for 0–49 % and one for 50–100 %. «Как участник» on the phone, then
// «Отправить по ссылке» → «Получить ссылку» → the link and its QR.
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/take-studio3.cjs <take dir> <picture.png>
//
// Before the take (not filmed): sign-in and the «Тесты» tab; the studio's first-visit tour is put away. A new test
// «Рыночное равновесие» on account A; the jury's own test is never touched. The take leaves the test and its
// контрольная in the account (ids in <take dir>/test.json). The file drop is the browser's own drag events with the
// file in their DataTransfer, as when a file is dragged from a folder. Window 1280 × 800 CSS px at device scale 1.5
// (frames 1920 × 1200); stills at 3×. The pointer is logged on every move: fit.py draws it, with a ring where it
// presses. The waits (the pages loading, the upload, the server's answers) are cut in cut-studio3.json.
const fs = require('fs');
const path = require('path');
const R = require('./rec.cjs');

const DIR = path.resolve(process.argv[2] || 'take-studio3');
const PICTURE = path.resolve(process.argv[3] || 'equilibrium.png');
const W = 1280, H = 800, DPR = 1.5;
const TITLE = 'Рыночное равновесие';
const HEADING = 'Спрос и предложение';
const TEXT = 'Посмотрите график и видео, потом ответьте на вопросы.';
const VIDEO = 'https://youtu.be/DfRJcwz38HE'; // «Рыночное равновесие», «Видеоуроки» (Экономика 10 класс)

(async () => {
  const browser = await R.launch([`--force-device-scale-factor=${DPR}`]);
  const result = {};
  let take = null;
  try {
    const noTour = "(()=>{const g=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(typeof k==='string'&&k.startsWith('meldy_studio_tour:'))return '1';return g.call(this,k);};})();";
    const ctx = await R.context(browser, { w: W, h: H, dpr: DPR, init: [noTour] });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => console.log('[pageerror]', R.u.redact(e.message).slice(0, 200)));
    await R.u.signIn(page, 'A');
    await R.u.go(page, '/exams?view=tests', 'tests');
    await page.getByRole('button', { name: /Тест в студии/ }).or(page.getByRole('link', { name: /Тест в студии/ })).first().waitFor();
    await R.settle(page, 1200);
    await page.mouse.move(W * 0.62, H * 0.62);

    take = new R.Take(page, DIR, { dpr: DPR, viewport: { width: W, height: H } });
    take.stillScale = 3 / DPR;
    take.pointer = { x: W * 0.62, y: H * 0.62 };
    await take.start();
    const studioBtn = page.getByRole('button', { name: /Тест в студии/ }).or(page.getByRole('link', { name: /Тест в студии/ })).first();
    await take.box('tests', studioBtn, page.getByText('Тесты', { exact: true }).last());
    await R.sleep(500);

    // 1 · «Тест в студии» → «Новый тест»: the name, «Создать тест» → the empty studio.
    take.mark('new');
    await take.click(studioBtn, { ms: 600 });
    const name = page.locator('main input').first();
    await name.waitFor({ timeout: 60000 });
    await R.settle(page, 300);
    take.mark('newpage');
    await take.box('newform', page.locator('main form').first().or(name).first(), page.getByRole('heading', { name: 'Новый тест' }).first());
    await take.click(name, { ms: 450, fx: 0.25 });
    await take.type(TITLE, { delay: 55 });
    await R.sleep(200);
    take.mark('create');
    await take.click(page.getByRole('button', { name: /Создать/ }).first(), { ms: 450 });
    await page.waitForURL(/\/exams\/c\/[0-9a-f-]{36}\/studio/, { timeout: 60000 });
    result.testId = (page.url().match(/\/exams\/c\/([0-9a-f-]{36})/) || [])[1];
    fs.writeFileSync(path.join(DIR, 'test.json'), JSON.stringify({ id: result.testId }));
    const palette = page.locator('.st-col-left');
    const side = page.locator('.st-side');
    const blocks = page.locator('.st-block');
    await palette.getByRole('button', { name: 'Заголовок', exact: true }).first().waitFor({ timeout: 60000 });
    await page.getByText('Открываю студию').first().waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
    await R.settle(page, 500);
    take.mark('studio');
    await take.box('studio', { x: 0, y: 76, width: W, height: H - 76 });
    await R.sleep(700);

    // 2 · Blocks: a heading and a text typed in place.
    take.mark('heading');
    await take.box('top', palette.getByRole('button', { name: 'Заголовок', exact: true }).first(), page.locator('[data-tour="canvas"]').first());
    await take.click(palette.getByRole('button', { name: 'Заголовок', exact: true }).first(), { ms: 550 });
    await blocks.first().waitFor({ timeout: 30000 });
    await R.sleep(250);
    await take.type(HEADING, { delay: 55 });
    await R.sleep(250);
    take.mark('text');
    await take.click(palette.getByRole('button', { name: 'Текст', exact: true }).first(), { ms: 450 });
    await blocks.nth(1).waitFor({ timeout: 30000 });
    await R.sleep(250);
    await page.keyboard.insertText(TEXT); // Ctrl+V of a copied sentence
    take.events.push({ kind: 'key', t: R.now() });
    await R.sleep(500);
    await take.box('texts', blocks.nth(0), blocks.nth(1), palette.getByRole('button', { name: 'Текст', exact: true }).first());

    // The author's own picture, dragged in from the computer onto the page under the text.
    const canvas = page.locator('[data-tour="canvas"]').first();
    const tb = await blocks.nth(1).boundingBox();
    const at = { x: tb.x + tb.width * 0.5, y: tb.y + tb.height + 14 };
    await take.box('drop', blocks.nth(0), { x: tb.x - 20, y: tb.y, width: tb.width + 40, height: 420 });
    take.mark('drag');
    // The hand comes in from the window's right edge with the file.
    await take.move(W - 30, at.y + 120, { ms: 250 });
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
    let first = true;
    const steps = 26;
    for (let k = 1; k <= steps; k += 1) {
      const p = k / steps;
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const x = (W - 30) + (at.x - (W - 30)) * e, y = at.y + 120 - 120 * e;
      await page.mouse.move(x, y);
      take.events.push({ kind: 'move', x, y, t: R.now() });
      take.pointer = { x, y };
      if (x < 890) {
        if (first) { await fire('dragenter', x, y); first = false; }
        await fire('dragover', x, y);
      }
      await R.sleep(22);
    }
    for (let k = 0; k < 12; k += 1) { await fire('dragover', at.x, at.y); await R.sleep(45); }
    result.overlay = await canvas.getAttribute('data-file-over');
    take.mark('drophold');
    await fire('drop', at.x, at.y);
    take.events.push({ kind: 'down', x: at.x, y: at.y, t: R.now() });
    take.events.push({ kind: 'up', x: at.x, y: at.y, t: R.now() });
    take.mark('dropped');
    const pic = blocks.nth(2);
    await pic.locator('img').first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForFunction(() => ![...document.querySelectorAll('.st-block')].some((b) => /Загружаю картинку|Готовлю картинку|Уменьшаю фото/.test(b.innerText)), null, { timeout: 60000 }).catch(() => {});
    await R.sleep(500);
    take.mark('uploaded');
    await take.box('picture', pic);
    await R.sleep(700);

    // A «Видео» block: pressed, it comes after the selected block (the picture) with its link field in focus.
    take.mark('video');
    await take.click(palette.getByRole('button', { name: 'Видео', exact: true }).first(), { ms: 500 });
    const link = page.locator('.st-block input[placeholder^="https://youtu"]').first();
    await link.waitFor({ timeout: 30000 });
    await R.sleep(300);
    take.mark('paste');
    await page.keyboard.insertText(VIDEO); // Ctrl+V of a copied link
    take.events.push({ kind: 'key', t: R.now() });
    await R.sleep(350);
    await take.click(page.locator('.st-block').getByRole('button', { name: 'Вставить', exact: true }).first(), { ms: 380 });
    const frame = page.locator('.st-block iframe').first();
    await frame.waitFor({ timeout: 30000 });
    take.mark('videoin');
    // The player's poster arrives from YouTube: wait for the frame to load (cut in the clip).
    await page.waitForFunction(() => { const f = document.querySelector('.st-block iframe'); return f && f.getBoundingClientRect().height > 100; }, null, { timeout: 30000 }).catch(() => {});
    await R.sleep(2600);
    take.mark('videoshown');
    await take.box('video', page.locator('.st-block').filter({ has: page.locator('iframe') }).first());
    await R.sleep(800);

    // 3 · The four kinds of question, each after the one before; 3 points on the last.
    const kinds = ['Один ответ', 'Несколько ответов', 'Верно / неверно', 'Короткий ответ'];
    const lastKind = palette.getByRole('button', { name: kinds[3], exact: true }).first();
    await take.move(118, 560, { ms: 350 });
    for (let i = 0; i < 10; i += 1) {
      const lb = await lastKind.boundingBox();
      if (!lb || lb.y + lb.height < H - 16) break;
      await page.mouse.wheel(0, 100);
      await R.sleep(60);
    }
    await R.sleep(300);
    take.mark('questions');
    await take.box('qpalette', palette.getByRole('button', { name: kinds[0], exact: true }).first(), palette.getByRole('button', { name: kinds[3], exact: true }).first());
    for (const [i, kind] of kinds.entries()) {
      const before = await page.locator('.st-block').count();
      await take.click(palette.getByRole('button', { name: kind, exact: true }).first(), { ms: i ? 300 : 450 });
      await page.waitForFunction((n) => document.querySelectorAll('.st-block').length > n, before, { timeout: 30000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('.st-pal-item[aria-disabled="true"]'), null, { timeout: 30000 }).catch(() => {});
      take.mark(`q${i + 1}`);
      await R.sleep(i < 3 ? 250 : 500);
    }
    await take.box('qblocks', page.locator('.st-block').last(), palette.getByRole('button', { name: kinds[3], exact: true }).first());
    take.mark('points');
    const more = side.getByRole('button', { name: 'Больше' }).first();
    await take.box('pointsbox', side.getByText('Баллы', { exact: true }).first(), more, page.locator('.st-block').last());
    await take.click(more, { ms: 520 });
    await R.sleep(260);
    await take.click(more, { ms: 120 });
    await R.sleep(900);
    take.mark('pointed');

    // 4 · «Оформление»: a theme, a colour, a font.
    take.mark('design');
    await take.click(side.getByText('Оформление', { exact: true }).first(), { ms: 500 });
    await R.sleep(450);
    // The panel's list is long: the hand scrolls it to the themes.
    await take.move(1096, 560, { ms: 300 });
    const themes = side.getByRole('button', { name: /Яркая/ }).first();
    for (let i = 0; i < 6; i += 1) {
      const tb2 = await themes.boundingBox();
      if (!tb2 || tb2.y + tb2.height < 600) break;
      await page.mouse.wheel(0, 120);
      await R.sleep(70);
    }
    await R.sleep(250);
    await take.box('designpanel', side, page.locator('.st-block').last());
    await take.click(themes, { ms: 420 });
    await R.sleep(800);
    take.mark('themed');
    const green = side.getByRole('button', { name: 'Зелёный' }).first();
    for (let i = 0; i < 6; i += 1) {
      const gb = await green.boundingBox();
      if (!gb || gb.y + gb.height < 640) break;
      await page.mouse.wheel(0, 120);
      await R.sleep(70);
    }
    await R.sleep(200);
    await take.click(green, { ms: 380 });
    await R.sleep(700);
    take.mark('coloured');
    const serif = side.getByRole('button', { name: 'С засечками' }).first();
    for (let i = 0; i < 6; i += 1) {
      const sb = await serif.boundingBox();
      if (!sb || sb.y + sb.height < 700) break;
      await page.mouse.wheel(0, 120);
      await R.sleep(70);
    }
    await R.sleep(200);
    await take.click(serif, { ms: 380 });
    await R.sleep(900);
    take.mark('fonted');

    // 5 · «Результат»: a message for 0–49 % and one for 50–100 %.
    take.mark('result');
    await take.click(side.getByText('Результат', { exact: true }).first(), { ms: 500 });
    await R.sleep(450);
    const add = side.getByRole('button', { name: 'Добавить сообщение' }).first();
    await take.box('resultpanel', side);
    await take.click(add, { ms: 450 });
    await R.sleep(650);
    const to = side.locator('input').nth(1);
    await take.click(to, { ms: 420 });
    await to.selectText().catch(() => {});
    await take.type('49', { delay: 90 });
    await R.sleep(350);
    take.mark('band1');
    const add2 = side.getByRole('button', { name: 'Добавить сообщение' }).first();
    await add2.scrollIntoViewIfNeeded();
    await R.sleep(150);
    await take.click(add2, { ms: 450 });
    await R.sleep(900);
    take.mark('band2');
    await take.box('bands', side);
    result.bands = R.u.redact(await side.innerText()).replace(/\n+/g, ' / ').slice(0, 600);
    await R.sleep(500);

    // 6 · The participant's view on the phone, then the link.
    take.mark('preview');
    await take.click(page.getByRole('button', { name: /как участник/i }).first(), { ms: 550 });
    const phone = page.locator('[role="dialog"] button', { hasText: 'Телефон' }).first();
    await phone.waitFor({ timeout: 30000 });
    await R.sleep(500);
    await take.click(phone, { ms: 450 });
    await R.sleep(1300);
    take.mark('phone');
    await take.box('phonebox', page.locator('[role="dialog"]').first());
    await R.sleep(1000);
    take.mark('previewclose');
    await take.click(page.locator('[role="dialog"] button', { hasText: 'Закрыть' }).first(), { ms: 450 });
    await R.sleep(500);

    take.mark('send');
    await take.click(page.getByRole('button', { name: /Отправить по ссылке/ }).or(page.getByRole('link', { name: /Отправить по ссылке/ })).first(), { ms: 500 });
    const getLink = page.getByRole('button', { name: /Получить ссылку/ }).first();
    await getLink.waitFor({ timeout: 60000 });
    await R.settle(page, 300);
    take.mark('sendpage');
    await take.box('sendform', getLink, page.getByRole('heading', { name: /Новая контрольная/ }).first());
    await R.sleep(500);
    await take.click(getLink, { ms: 500 });
    const showQr = page.getByRole('button', { name: /Показать QR/ }).first();
    await showQr.waitFor({ timeout: 60000 });
    await R.settle(page, 300);
    take.mark('linked');
    result.quizUrl = R.u.cleanUrl(page.url());
    await take.box('linkbox', page.locator('input[value*="/k/"]').first().or(showQr).first(), showQr);
    await R.sleep(700);
    take.mark('qr');
    await take.click(showQr, { ms: 450 });
    await R.sleep(900);
    take.mark('qrshown');
    const qrImg = page.locator('[role="dialog"] svg, [role="dialog"] canvas, [role="dialog"] img').first();
    await take.box('qrbox', page.locator('[role="dialog"]').first().or(qrImg).first());
    await R.sleep(500);
    await take.still('qr');
    await R.sleep(1500);
    take.mark('end');
    result.text = R.u.redact(await page.locator('body').innerText()).replace(/\n+/g, ' / ').slice(0, 800);
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
