'use strict';
// After the takes of 07: the exam of the take that became the clip is renamed «Демо: …» (so test account A says what
// it is), the exams of spare takes are deleted. Only ids a take wrote to its exam.json are touched, and only when the
// exam's title is the one the take gave it.
//
//   MELDY_ULIB=<ulib.cjs> node deck/cf11/tools/record/tidy-07.cjs --keep <id> [--delete <id> ...] [--title «Демо: …»]
const R = require('./rec.cjs');

const args = process.argv.slice(2);
const keep = args.includes('--keep') ? args[args.indexOf('--keep') + 1] : null;
const drop = args.flatMap((a, i) => (a === '--delete' ? [args[i + 1]] : []));
const TITLE = args.includes('--title') ? args[args.indexOf('--title') + 1] : 'Демо: Программирование на C#';
const TAKE_TITLES = ['Программирование на C#', TITLE];
const ID = /^[0-9a-f-]{36}$/;

async function titleOf(page, id) {
  await R.u.go(page, `/exams/c/${id}/settings`, 'settings');
  const input = page.locator('.st-form input.im-input').first();
  await input.waitFor({ timeout: 30000 });
  return input.inputValue();
}

(async () => {
  const browser = await R.launch();
  try {
    const ctx = await R.context(browser, { w: 1440, h: 900, dpr: 1 });
    const page = await ctx.newPage();
    await R.u.signIn(page, 'A');
    for (const id of drop) {
      if (!ID.test(id) || id === keep) continue;
      const title = await titleOf(page, id);
      if (!TAKE_TITLES.includes(title)) { console.log(`skip ${id}: title «${title}» is not a take's`); continue; }
      await page.locator('#settings-delete button', { hasText: 'Удалить экзамен' }).first().click();
      await page.locator('#settings-delete .st-ask button', { hasText: 'Удалить экзамен' }).first().click();
      await page.waitForURL((url) => !url.pathname.includes(id), { timeout: 30000 });
      console.log(`deleted ${id} («${title}»)`);
    }
    if (keep && ID.test(keep)) {
      const title = await titleOf(page, keep);
      if (title === TITLE) console.log(`kept ${keep}: already «${TITLE}»`);
      else if (!TAKE_TITLES.includes(title)) console.log(`not renamed ${keep}: title «${title}» is not a take's`);
      else {
        const input = page.locator('.st-form input.im-input').first();
        await input.fill(TITLE);
        await page.locator('.st-cta button.sf-primary').first().click();
        await page.locator('.st-cta', { hasText: 'Сохранено' }).first().waitFor({ timeout: 30000 }).catch(() => {});
        await R.sleep(1000);
        console.log(`kept ${keep}: renamed «${title}» → «${await titleOf(page, keep)}»`);
      }
    }
    await R.u.go(page, '/exams', 'exams');
    const rows = await page.evaluate(() => [...document.querySelectorAll('main a[href^="/exams/"]')].map((a) => a.innerText.split('\n')[0]).filter(Boolean));
    console.log('exams now:', [...new Set(rows)].join(' | '));
  } catch (e) {
    R.fail(e);
  } finally {
    await browser.close();
  }
})();
