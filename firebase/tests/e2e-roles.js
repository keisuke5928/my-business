// 本人あてのリンク、休憩室の共有タブレット、派遣会社の役割を、エミュレーターで通しで試す。
// 権限（だれが何を読めて、何を読めないか）を確かめるのが目的。
// 先に e2e.js と同じ準備をしておく。使い方: node tests/e2e-roles.js
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
const appReady = (page) => page.waitForFunction(() => window.YADO_RUNTIME && window.YADO_RUNTIME.role && document.querySelector("#main .view"), null, { timeout: 30000 });
const toastHas = (page, re) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector("#toast").textContent), re, { timeout: 30000 });
// 読めるか、書けるかを、その人のログインのままで試す。返す値は "ok" か "denied"
const tryDb = (page, kind, path, data) => page.evaluate(async ([kind, path, data]) => {
  const db = await window.claude.use("db");
  try {
    if (kind === "getDoc") { await db.doc(path).get(); return "ok"; }
    if (kind === "list") { await db.collection(path).get(); return "ok"; }
    if (kind === "update") { await db.doc(path).update(data); return "ok"; }
    if (kind === "set") { await db.doc(path).set(data); return "ok"; }
  } catch (e) { return e.code === "invalid_argument" ? "denied" : "error:" + e.code; }
}, [kind, path, data]);

(async () => {
  await wipe();
  await seedInvite("testcode1234");
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    return p;
  };

  // 1. 運営者が、管理者と派遣会社の担当者を追加する
  const op = await newPage();
  await emailLink(op, "operator@example.com");
  await appReady(op);
  await op.waitForFunction(() => !document.querySelector(".role").hidden, null, { timeout: 30000 });
  await op.click('#tabs [data-tab="memo"]');
  await op.fill("#op-email", "kanri@example.com"); await op.click("#op-grant"); await toastHas(op, "管理者にしました");
  await op.fill("#op-agname", "テスト派遣"); await op.fill("#op-agmail", "haken@example.com"); await op.click("#op-aggrant"); await toastHas(op, "追加しました");
  ok("運営者が派遣会社の担当者を追加できる", true);

  // 2. 管理者が新人Aを足し、本人あてのリンク、番号、タブレット用のリンクを作る
  const adm = await newPage();
  await emailLink(adm, "kanri@example.com");
  await appReady(adm);
  await adm.waitForFunction(() => !document.querySelector(".role").hidden, null, { timeout: 30000 });
  const idA = await adm.evaluate(async () => { const db = await window.claude.use("db");
    const r = await db.collection("people").add({ name: "山田 太郎", type: "パート", job: "朝食ホール", start: "11月20日", startISO: "2026-11-20", host: "フロントの教育担当", prep: {}, ojt: {}, note: "腰に注意と本人から", at: Date.now(),
      sheet: { date: "11月20日（金）", time: "6:00", meet: "従業員入口", host: "フロントの教育担当" } }); return r.id; });
  await adm.click('#tabs [data-tab="dash"]');
  await adm.waitForSelector(`[data-nb="${idA}"]`, { timeout: 30000 });
  await adm.click(`[data-nb="${idA}"]`);
  await adm.click("#plmake"); await adm.waitForSelector("#plcopy", { timeout: 30000 });
  const linkA = await adm.evaluate((id) => state.plinks[id], idA);
  ok("管理者が本人あてのリンクを作れる", /#p-[A-Za-z0-9_-]{8,}/.test(linkA), linkA);
  await adm.click("#pinmake"); await adm.waitForSelector(".pin", { timeout: 30000 });
  const pinA = await adm.$eval(".pin", (e) => e.textContent);
  ok("管理者が4けたの番号を出せる", /^\d{4}$/.test(pinA), pinA);
  await adm.click("#nback"); await adm.click("#kmake"); await adm.waitForSelector("#kcopy", { timeout: 30000 });
  const kurl = await adm.evaluate(() => state.kurl);
  ok("管理者がタブレット用のリンクを作れる", /#kiosk-/.test(kurl), kurl);

  // 3. 新人Aが、本人あてのリンクで入る
  const a = await newPage();
  await a.goto(linkA); await appReady(a);
  await a.waitForFunction(() => /山田 太郎さんの初日シート/.test(document.querySelector(".hero .label")?.textContent || ""), null, { timeout: 30000 });
  ok("本人あてのリンクで入ると、自分の初日シートが出る", true, await a.$eval(".hero .when", (e) => e.textContent));
  ok("新人は、自分の1人分を読める", (await tryDb(a, "getDoc", "people/" + idA)) === "ok");
  ok("新人は、受け入れ一覧の全員は読めない", (await tryDb(a, "list", "people")) === "denied");
  await a.click('#tabs [data-tab="learn"]');
  await a.click(".lesson >> nth=0"); await a.click("#markdone").catch(async () => { await a.evaluate(() => { state.done[state.lesson] = true; pushProgress(); }); });
  await a.waitForTimeout(300); await a.evaluate(() => pushProgress());
  await adm.waitForFunction((id) => (liveProgress[id] && (liveProgress[id].done || []).length) > 0, idA, { timeout: 30000 });
  ok("教材の進み具合が、管理者に届く", true, await adm.evaluate((id) => JSON.stringify(liveProgress[id].done), idA));
  ok("新人は、進み具合の「どの派遣会社か」を書き換えられない", (await tryDb(a, "update", "progress/" + idA, { agency: "ag_x" })) === "denied");

  // 4. 派遣会社の担当者が入り、新人Bを足す
  const ag = await newPage();
  await emailLink(ag, "haken@example.com");
  await appReady(ag);
  await ag.waitForSelector("#ag-add", { timeout: 30000 });
  const agTabs = await ag.$$eval("#tabs button", (bs) => bs.map((b) => b.dataset.tab));
  ok("派遣会社には、派遣会社の画面だけが出る", agTabs.join(",") === "agency" && await ag.$eval(".role", (e) => e.hidden), agTabs.join(","));
  await ag.fill("#ag-name", "鈴木 花子"); await ag.fill("#ag-start", "2026-11-25"); await ag.click("#ag-add");
  await ag.waitForFunction(() => /鈴木 花子/.test(document.querySelector(".nlist")?.textContent || ""), null, { timeout: 30000 });
  await ag.waitForFunction(() => Object.keys(state.aglinks || {}).length > 0, null, { timeout: 30000 });
  const linkB = await ag.evaluate(() => Object.values(state.aglinks || {})[0]);
  const idB = await ag.evaluate(() => Object.keys(state.aglinks || {})[0]);
  ok("派遣会社が新人を足して、招待リンクを受け取れる", /#p-/.test(linkB || ""), linkB);
  ok("派遣会社は、自社の人の進み具合を読める", (await tryDb(ag, "getDoc", "progress/" + idB)) === "ok");
  ok("派遣会社は、ほかの人の進み具合を読めない", (await tryDb(ag, "getDoc", "progress/" + idA)) === "denied");
  const denied = [];
  for (const [kind, path] of [["list", "people"], ["getDoc", "people/" + idB], ["list", "questions"], ["list", "innvoices"], ["list", "voices"], ["list", "learnlog"], ["list", "notices"], ["list", "metrics"], ["list", "orders"]]) {
    const r = await tryDb(ag, kind, path); if (r !== "denied") denied.push(path + "=" + r);
  }
  ok("派遣会社は、受け入れ一覧、質問、ふりかえり、相談、学習の記録を読めない", denied.length === 0, denied.join(" "));
  const agAi = await ag.evaluate(async () => { const s = await window.claude.use("sample"); try { await s("テスト"); return "ok"; } catch (e) { return e.code; } });
  ok("派遣会社はAIを使えない", agAi === "not_granted", agAi);
  await adm.waitForSelector(`[data-nb="${idB}"]`, { timeout: 30000 });
  ok("派遣会社が足した人が、管理者の受け入れ一覧に出る", true);

  // 5. 新人Bが入ると、派遣会社に何が伝わるかの知らせが出る
  const bp = await newPage();
  await bp.goto(linkB); await appReady(bp);
  await bp.waitForFunction(() => /鈴木 花子さんの初日シート/.test(document.querySelector(".hero .label")?.textContent || ""), null, { timeout: 30000 });
  ok("派遣会社から来た新人に、伝わる範囲の知らせが出る", await bp.evaluate(() => /テスト派遣/.test(document.querySelector(".view").textContent) && /本数だけが伝わります/.test(document.querySelector(".view").textContent)));
  ok("新人Bは、新人Aの1人分を読めない", (await tryDb(bp, "getDoc", "people/" + idA)) === "denied");

  // 6. 休憩室の共有タブレット
  const k = await newPage();
  await k.goto(kurl);
  await k.waitForSelector("#kpin", { timeout: 30000 });
  ok("タブレット用のリンクで開くと、番号を入れる画面になる", true);
  ok("番号を入れる前は、だれの分も読めない", (await tryDb(k, "getDoc", "people/" + idA)) === "denied");
  await k.fill("#kpin", pinA === "1234" ? "4321" : "1234"); await k.click("#kenter");
  await k.waitForSelector("#kerr:not([hidden])", { timeout: 30000 });
  ok("違う番号では入れない", /番号が違います/.test(await k.$eval("#kerr", (e) => e.textContent)));
  await k.fill("#kpin", pinA); await k.click("#kenter");
  await k.waitForFunction(() => /山田 太郎/.test(document.querySelector(".kbar")?.textContent || ""), null, { timeout: 30000 });
  await k.waitForFunction(() => /山田 太郎さんの初日シート/.test(document.querySelector(".hero .label")?.textContent || ""), null, { timeout: 30000 });
  ok("正しい番号で、その人の初日シートが出る", true);
  await k.waitForFunction(() => Object.keys(state.done).length > 0, null, { timeout: 30000 });
  ok("スマホで見終わった教材が、タブレットでも見終わった印になる", true);
  await k.click('#tabs [data-tab="checkin"]');
  for (let i = 0; i < 5; i++) await k.click(`[data-cv="${i}:3"]`);
  await k.fill("#ctext", "タブレットからの相談です");
  await k.click("#csend"); await toastHas(k, "送りました");
  ok("共有タブレットでは、送ったあとに入力が消える", await k.evaluate(() => !state.checkin.sent && !state.checkin.text && !(document.querySelector("#ctext") || {}).value));
  await k.click("#kexit");
  await k.waitForSelector("#kpin", { timeout: 30000 });
  ok("「終わる」で最初の画面に戻り、端末に相談の文が残らない", await k.evaluate(() => !JSON.stringify(localStorage).includes("タブレットからの相談")));
  await k.waitForTimeout(500);
  ok("終わったあとは、その人の分を読めない", (await tryDb(k, "getDoc", "people/" + idA)) === "denied");

  // 7. 宿の全員用のリンクで入った新人（だれにもつながっていない）
  const g = await newPage();
  await g.goto(BASE + "#join-testcode1234"); await appReady(g);
  await g.waitForFunction(() => /見本/.test(document.querySelector(".hero .label")?.textContent || ""), null, { timeout: 30000 });
  ok("全員用のリンクで入ると、見本と分かる表示になる", await g.evaluate(() => /あなたあてのリンク/.test(document.querySelector(".view").textContent)));
  ok("つながっていない新人は、だれの1人分も読めない", (await tryDb(g, "getDoc", "people/" + idA)) === "denied");

  await browser.close();
  for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? "  （" + x + "）" : ""}`);
  if (errors.length) console.log("ページのエラー:", errors);
  process.exit(results.some((r) => r[0] === "NG") || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? "  （" + x + "）" : ""}`); process.exit(2); });
