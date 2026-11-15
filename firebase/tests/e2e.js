// 本番の仕組みを、エミュレーター（練習用の環境）で通しで試す。
// 先に firebase/ で次を動かしておく:
//   python3 ../build.py --firebase config.emulator.json
//   firebase emulators:start --project demo-yado --only auth,firestore,functions,hosting
//   （functions/.env.local に AI_FAKE=1、OPERATOR_EMAIL=operator@example.com、AI_DAILY_LIMIT=5）
// 使い方: node tests/e2e.js
const { chromium } = require("playwright");
const P = "demo-yado", H = "http://127.0.0.1";
const FS = `${H}:8080/v1/projects/${P}/databases/(default)/documents`;
const BASE = `${H}:5000/entaiji/`;
const results = [];
const ok = (name, cond, extra) => { results.push([cond ? "OK" : "NG", name, extra || ""]); };

async function seedInvite(code) {
  const r = await fetch(`${FS}/inns/entaiji/private/invite`, {
    method: "PATCH", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ fields: { code: { stringValue: code }, at: { integerValue: String(Date.now()) } } }),
  });
  if (!r.ok) throw new Error("招待の準備に失敗: " + r.status);
}
async function wipe() {
  await fetch(`${H}:8080/emulator/v1/projects/${P}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`${H}:9099/emulator/v1/projects/${P}/accounts`, { method: "DELETE" });
}
async function emailLink(page, email) {
  await page.goto(BASE + "#login");
  await page.waitForSelector("#yado-email");
  await page.fill("#yado-email", email);
  await page.click("#yado-login button");
  await page.waitForSelector("#yado-login-msg:not([hidden])");
  const codes = await (await fetch(`${H}:9099/emulator/v1/projects/${P}/oobCodes`)).json();
  const c = codes.oobCodes.filter((x) => x.email === email && x.requestType === "EMAIL_SIGNIN").pop();
  await page.goto(`${BASE}?apiKey=demo-key&oobCode=${c.oobCode}&mode=signIn&lang=ja`);
}
const appReady = (page) => page.waitForFunction(() => window.YADO_RUNTIME && document.querySelector("#tabs button"), null, { timeout: 30000 });
async function askAndWait(page, act) {
  const before = await page.$$eval(".msg", (ms) => ms.length);
  await act();
  try {
    await page.waitForFunction((n) => (() => { const ms = document.querySelectorAll(".msg"); const last = ms[ms.length - 1]; return ms.length > n && last && last.classList.contains("bot") && !/考えています/.test(last.textContent); })(), before, { timeout: 30000 });
  } catch (e) {
    console.log("待ちきれず。画面の最後:", await page.$$eval(".msg", (ms) => ms.slice(-4).map((m) => m.className + " | " + m.textContent.slice(0, 60))), "入力:", await page.$eval("#askinput", (x) => x.value).catch(() => "-"), "送る:", await page.$eval("#sendbtn", (x) => x.disabled).catch(() => "-"));
    throw e;
  }
}
const badge = (page) => page.$eval("#livebadge", (e) => e.textContent);

(async () => {
  await wipe();
  const CODE = "testcode1234";
  await seedInvite(CODE);
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    return p;
  };

  // 1. リンクなしで開くと案内が出る
  let p = await newPage();
  await p.goto(BASE);
  await p.waitForSelector("#yado-gate h2");
  ok("リンクなしは案内が出る", (await p.$eval("#yado-gate h2", (e) => e.textContent)).includes("リンクから"));

  await p.context().close();

  // 2. 違う合言葉は入れない
  p = await newPage();
  await p.goto(BASE + "#join-wrongcode99");
  await p.waitForFunction(() => document.querySelector("#yado-gate p.empty") && /招待リンク/.test(document.querySelector("#yado-gate p.empty").textContent), null, { timeout: 30000 });
  ok("違う招待リンクは入れない", true);
  await p.context().close();

  // 3. スタッフが招待リンクで入る
  const staff = await newPage();
  await staff.goto(BASE + "#join-" + CODE);
  await appReady(staff);
  await staff.waitForFunction(() => document.querySelector("#livebadge").textContent === "データ共有中", null, { timeout: 30000 });
  ok("スタッフは入れて、共有データにつながる", true, await badge(staff));
  ok("スタッフには管理画面の切り替えが出ない", await staff.$eval(".role", (e) => e.hidden));
  ok("スタッフにはデモの案内と最初に戻すが出ない", await staff.$eval("#tourbtn", (e) => e.hidden) && await staff.$eval("#reset", (e) => e.hidden));
  ok("URLから合言葉が消える", !(await staff.evaluate(() => location.hash)).includes("join"));

  // 4. 質問（にせのAI）
  await staff.click('#tabs [data-tab="ask"]');
  for (const q of ["中抜けは何時から？", "卵アレルギーのお客様の料理は？", "地酒のおすすめは？"]) {
    await askAndWait(staff, () => staff.click(`[data-say="${q}"]`));
  }
  const last3 = await staff.$$eval(".msg.bot", (ms) => ms.slice(-3).map((m) => m.textContent.slice(0, 40)));
  ok("AIの答え（中抜け）", last3[0].includes("テスト"), last3[0]);
  ok("アレルギーは担当者へ", last3[1].includes("AIは答えません"), last3[1]);
  ok("資料にない質問は担当者へ", last3[2].includes("まだ宿の資料にない"), last3[2]);

  // 5. スタッフは管理者のデータを書けない
  const denied = await staff.evaluate(async () => {
    const db = await window.claude.use("db"); const out = {};
    try { await db.collection("notices").add({ text: "x", at: 1 }); out.notices = "書けた"; } catch (e) { out.notices = e.code; }
    try { await db.doc("people/p1").set({ name: "x" }); out.people = "書けた"; } catch (e) { out.people = e.code; }
    try { const s = await db.collection("voices").get(); out.voicesRead = "読めた " + s.size; } catch (e) { out.voicesRead = e.code; }
    return out;
  });
  ok("スタッフは今日の連絡を書けない", denied.notices === "invalid_argument", denied.notices);
  ok("スタッフは受け入れ一覧を書けない", denied.people === "invalid_argument", denied.people);
  ok("スタッフはほかの人の声を読めない", denied.voicesRead === "invalid_argument", denied.voicesRead);

  // 6. 外部の相談窓口に声を送る
  await staff.click('#tabs [data-tab="checkin"]');
  for (let i = 0; i < 5; i++) await staff.click(`[data-cv="${i}:${i === 1 ? 2 : 4}"]`);
  await staff.fill("#ctext", "テスト：質問しづらいです");
  await staff.click('[data-to="outside"]');
  await staff.click("#csend");
  await staff.waitForFunction(() => /送りました/.test(document.querySelector(".view").textContent), null, { timeout: 30000 });
  ok("外部の相談窓口に送れる", true);

  // 7. 運営者がメールでログイン
  const op = await newPage();
  await emailLink(op, "operator@example.com");
  await appReady(op);
  await op.waitForFunction(() => !document.querySelector(".role").hidden, null, { timeout: 30000 });
  ok("運営者は管理画面に入れる", true);
  const opTabs = await op.$$eval("#tabs button", (bs) => bs.map((b) => b.dataset.tab));
  ok("運営者には効果とメモが出る", opTabs.includes("effect") && opTabs.includes("memo"), opTabs.join(","));
  await op.click('#tabs [data-tab="memo"]');
  await op.waitForFunction(() => /テスト：質問しづらい/.test(document.querySelector(".view").textContent), null, { timeout: 30000 });
  ok("運営者は外部窓口の声を読める", true);
  const invite = await op.$eval("#op-invite", (e) => e.textContent);
  ok("運営者に招待リンクが出る", invite.includes("#join-" + CODE), invite);
  await op.fill("#op-email", "kanri@example.com");
  await op.click("#op-grant");
  await op.waitForFunction(() => /管理者にしました/.test(document.querySelector("#toast").textContent), null, { timeout: 30000 });
  ok("運営者が管理者を追加できる", true);

  // 8. 旅館の管理者
  const adm = await newPage();
  await emailLink(adm, "kanri@example.com");
  await appReady(adm);
  await adm.waitForFunction(() => !document.querySelector(".role").hidden, null, { timeout: 30000 });
  const admTabs = await adm.$$eval("#tabs button", (bs) => bs.map((b) => b.dataset.tab));
  ok("管理者には効果とメモが出ない", !admTabs.includes("effect") && !admTabs.includes("memo"), admTabs.join(","));
  const admVoices = await adm.evaluate(async () => { const db = await window.claude.use("db"); try { const s = await db.collection("voices").get(); return "読めた " + s.size; } catch (e) { return e.code; } });
  ok("管理者は外部窓口の声を読めない", admVoices === "invalid_argument", admVoices);
  await adm.click('#tabs [data-tab="queue"]');
  await adm.waitForFunction(() => [...document.querySelectorAll(".qitem b")].some((b) => b.textContent === "地酒のおすすめは？"), null, { timeout: 30000 });
  const id = await adm.$$eval(".qitem", (its) => { const it = its.find((i) => i.innerText.includes("地酒のおすすめは？")); return it.querySelector("[data-reply]").dataset.reply; });
  await adm.fill("#reply-" + id, "「◯◯」をおすすめしています。");
  await adm.click(`[data-reply="${id}"]`);
  await adm.waitForFunction(() => /資料に追加しました/.test(document.querySelector("#toast").textContent), null, { timeout: 30000 });
  ok("管理者が回答できる", true);
  await adm.click('#tabs [data-tab="dash"]');
  await adm.fill("#ntext", "テスト：今日は団体40名");
  await adm.click("#nsend");
  await adm.waitForFunction(() => /新人の画面に出しました/.test(document.querySelector("#toast").textContent), null, { timeout: 30000 });
  ok("管理者が今日の連絡を出せる", true);

  // 9. スタッフ側に届く
  await staff.click('#tabs [data-tab="ask"]');
  await staff.waitForFunction(() => /「地酒のおすすめは？」への/.test(document.querySelector("#chatlog").textContent), null, { timeout: 30000 });
  ok("担当者の回答がスタッフに届く", true);
  await staff.click('#tabs [data-tab="sheet"]');
  await staff.waitForFunction(() => /テスト：今日は団体40名/.test(document.querySelector(".view").textContent), null, { timeout: 30000 });
  ok("今日の連絡がスタッフに届く", true);

  // 10. AIの1日の上限（テストでは5回）
  await staff.click('#tabs [data-tab="ask"]');
  for (let i = 0; i < 4; i++) {
    await staff.fill("#askinput", "中抜けの時間を教えて " + i);
    if (process.env.DEBUG && i === 0) { staff.on("console", (m) => { if (m.text().startsWith("DBG")) console.log(m.text()); }); await staff.evaluate(() => { document.addEventListener("submit", (e) => console.log("DBG submit value=" + (document.querySelector("#askinput") || {}).value + " connected=" + e.target.isConnected), true); document.addEventListener("click", (e) => console.log("DBG click " + (e.target.id || e.target.tagName) + " connected=" + e.target.isConnected), true); const o = new MutationObserver(() => console.log("DBG main replaced")); o.observe(document.querySelector("#main"), { childList: true }); }); }
    if (process.env.DEBUG) console.log("送る前", i, await staff.evaluate(() => ({ v: document.querySelector("#askinput").value, dis: document.querySelector("#sendbtn").disabled, act: document.activeElement && document.activeElement.id, msgs: document.querySelectorAll(".msg").length })));
    await askAndWait(staff, async () => { await staff.click("#sendbtn"); if (process.env.DEBUG) console.log("送った直後", i, await staff.evaluate(() => ({ v: document.querySelector("#askinput").value, msgs: document.querySelectorAll(".msg").length, last: [...document.querySelectorAll(".msg")].slice(-1)[0].textContent.slice(0, 30) }))); });
  }
  const tail = await staff.$$eval(".msg.bot", (ms) => ms.slice(-2).map((m) => m.textContent.slice(0, 50)));
  ok("上限を超えると混み合いの案内が出て、資料から答える", tail.some((t) => /混み合って/.test(t)), tail.join(" / "));

  await browser.close();
  for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? "  （" + x + "）" : ""}`);
  if (errors.length) console.log("ページのエラー:", errors);
  process.exit(results.some((r) => r[0] === "NG") || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
