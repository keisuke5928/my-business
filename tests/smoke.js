// かんたんな動作確認。使い方: node tests/smoke.js dist/entaiji.html [dist/mizunara.html ...]
// すべての画面をライトとダークで開き、エラーと横のはみ出しがないかを見る。
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('HTMLのパスを渡してください');
    process.exit(2);
  }
  const browser = await chromium.launch();
  let bad = 0;
  for (const f of files) {
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      const problems = [];
      page.on('pageerror', (e) => problems.push(e.message));
      await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
      await page.goto('file://' + path.resolve(f));
      await page.waitForTimeout(200);
      let screens = 0;
      for (const role of ['new', 'admin']) {
        await page.click('#role-' + role);
        const tabs = await page.$$eval('#tabs button', (bs) => bs.map((b) => b.dataset.tab));
        for (const tab of tabs) {
          await page.click(`#tabs [data-tab="${tab}"]`);
          screens++;
          await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
          const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
          if (over) problems.push(`横にはみ出し: ${role}/${tab}`);
        }
      }
      await page.click('#role-new');
      await page.click('#tabs [data-tab="ask"]');
      const n = await page.$$eval('[data-say]', (bs) => bs.length);
      for (let i = 0; i < n; i++) {
        await page.click(`[data-say] >> nth=${i}`);
        await page.waitForTimeout(80);
      }
      const answers = await page.$$eval('.msg.bot', (ms) => ms.length);
      console.log(`${problems.length ? 'NG' : 'OK'}  ${f} (${scheme})  画面${screens}  返事${answers}  ${problems.join(' / ')}`);
      bad += problems.length;
      await page.close();
    }
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
