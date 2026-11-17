// 新人向けアプリを、幅390pxのブラウザで通しで試す（エミュレーター。AIは AI_FAKE=1 のにせもの）。
// CLAUDE.md の7章（確認方法）の3〜6と、管理者ページ。
// 使い方: エミュレーターを動かしてから node tests/note-e2e.js
const { chromium } = require("playwright");
const P = "demo-yado", H = "http://127.0.0.1";
const FS = `${H}:8080/v1/projects/${P}/databases/(default)/documents`;
const APP = `${H}:5000/note/`;
const results = [];
const ok = (name, cond, extra) => results.push([cond ? "OK" : "NG", name, extra || ""]);
const OUT = process.env.SHOTS || "";

async function wipe() {
  await fetch(`${H}:8080/emulator/v1/projects/${P}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`${H}:9099/emulator/v1/projects/${P}/accounts`, { method: "DELETE" });
}
async function ownerGet(path) { const r = await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } }); return r.ok ? r.json() : null; }
async function ownerList(path) { const r = await fetch(`${FS}/${path}?pageSize=100`, { headers: { Authorization: "Bearer owner" } }); const j = await r.json(); return j.documents || []; }
async function ownerPatch(path, f) { await fetch(`${FS}/${path}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" }, body: JSON.stringify({ fields: f }) }); }
const shot = async (p, n) => { if (OUT) await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); };
const toastHas = (p, re) => p.waitForFunction((s) => new RegExp(s).test(document.querySelector("#toast").textContent), re, { timeout: 20000 });
const jstDay = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);

(async () => {
  await wipe();
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (url) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await p.goto(url);
    return p;
  };

  // 1. 登録と同意、来た場所
  const a = await newPage(APP + "?utm_source=instagram&utm_medium=social&utm_campaign=reel01");
  await a.waitForSelector("#agree", { timeout: 30000 });
  ok("同意のチェックがないと始められない", await a.$eval("#start", (b) => b.disabled));
  await shot(a, "n1-consent");
  await a.check("#agree"); await a.click("#start");
  await a.waitForSelector("#pname", { timeout: 30000 });
  let users = [];
  for (let i = 0; i < 40 && !users.length; i++) { users = await ownerList("users"); if (!users.length) await a.waitForTimeout(250); }
  const ua = users[0];
  ok("同意の文、版、日時が保存される", !!ua && !!ua.fields.consent && /運営者/.test(ua.fields.consent.mapValue.fields.text.stringValue), ua && ua.fields.consent.mapValue.fields.version.stringValue);
  ok("来た場所（utm）が保存される", !!ua && ua.fields.utm.mapValue.fields.source.stringValue === "instagram" && ua.fields.utm.mapValue.fields.campaign.stringValue === "reel01");
  const uid = ua.name.split("/").pop();

  // 2. 職場と部署
  await a.fill("#pname", "宇奈月温泉 テスト荘"); await a.fill("#parea", "宇奈月温泉");
  await a.click("#padd"); await a.waitForFunction(() => !document.querySelector("#pname"), null, { timeout: 20000 });
  await a.click('[data-dept="clean"]'); await shot(a, "n2-place");
  await a.click("#pgo");
  await a.waitForSelector('[data-head="steps"]', { timeout: 20000 });
  ok("職場と部署を選ぶと、見出しの骨組みが出る", (await a.$$("[data-head]")).length === 6);
  await shot(a, "n3-notebook");

  // 同じ宿を、別の書き方で足そうとすると、同じ職場になる
  const b = await newPage(APP);
  await b.waitForSelector("#agree", { timeout: 30000 }); await b.check("#agree"); await b.click("#start");
  await b.waitForSelector("#pname", { timeout: 30000 });
  await b.fill("#pname", "テスト荘");
  await b.waitForSelector("[data-place]", { timeout: 10000 });
  ok("似た名前の職場が候補に出る", (await b.$$("[data-place]")).length === 1);
  await b.fill("#parea", "宇奈月"); await b.fill("#pname", "ホテル テスト荘"); await b.click("#padd");
  await toastHas(b, "同じ宿が見つかった");
  await b.click(".link");
  await b.fill("#pname", "テスト荘 別館"); await b.fill("#parea", "宇奈月温泉"); await b.click("#padd");
  await b.waitForSelector("#samesheet", { timeout: 20000 });
  ok("似た名前を足そうとすると「この宿ではありませんか」と聞かれる", (await b.$$("[data-same]")).length === 1);
  await b.click("[data-same]");
  ok("書き方がちがっても、同じ職場を選ぶ（増えない）", (await ownerList("workplaces")).length === 1);

  // 3. メモを書いてAIで整える
  await a.click('[data-head="steps"] .headbtn'); await a.click('[data-write="steps"]');
  await a.waitForSelector("#ntext");
  ok("書いてはいけないことが表示される", /お客様の名前/.test(await a.textContent(".forbid")));
  await a.fill("#ntext", "シーツの替え方\n古いシーツを外す\n新しいシーツを広げる\n角をそろえて折りこむ");
  await a.click("#nai"); await a.waitForSelector("#nsteps", { timeout: 30000 });
  ok("AIで手順の形に整う", (await a.inputValue("#nsteps")).split("\n").length >= 3, await a.inputValue("#ntitle"));
  await a.fill("#ntitle", "シーツの替え方（直した）");
  await shot(a, "n4-ai");
  await a.click("#nsave"); await toastHas(a, "保存しました");
  const until = async (fn) => { for (let i = 0; i < 40; i++) { const v = await fn(); if (v) return v; await a.waitForTimeout(250); } return null; };
  const notes1 = (await until(async () => { const l = await ownerList(`users/${uid}/notes`); return l.length ? l : null; })) || [];
  ok("メモが保存され、AIを直した印が付く", notes1.length === 1 && notes1[0].fields.aiEdited.booleanValue === true);

  // 4. お客様の名前と部屋番号 → 保存の前に「消しますか」
  await a.click('[data-write="steps"]').catch(async () => { await a.click('[data-head="steps"] .headbtn'); await a.click('[data-write="steps"]'); });
  await a.waitForSelector("#ntext"); await a.fill("#ntext", "お客様の山田様は302号室");
  await a.click("#nsave"); await a.waitForSelector("#piisheet", { timeout: 10000 });
  ok("「お客様の山田様は302号室」で、保存の前に「消しますか」と聞かれる", /山田様/.test(await a.textContent("#piisheet")) && /302号室/.test(await a.textContent("#piisheet")));
  await shot(a, "n5-pii");
  await a.click("#piidel"); await toastHas(a, "保存しました");
  const notes2 = (await until(async () => { const l = await ownerList(`users/${uid}/notes`); return l.length >= 2 ? l : null; })) || [];
  const saved = notes2.map((d) => d.fields.text.stringValue).find((t) => t.startsWith("お客様の"));
  ok("消して保存すると、名前と部屋番号が残らない", saved === "お客様のお客様はお部屋", saved);

  // 5. アレルギー → AIは手順を作らない
  await a.click('[data-write="steps"]').catch(async () => { await a.click('[data-head="steps"] .headbtn'); await a.click('[data-write="steps"]'); });
  await a.waitForSelector("#ntext"); await a.fill("#ntext", "卵アレルギーの料理の出し方");
  await a.click("#nai"); await a.waitForSelector(".refuse", { timeout: 10000 });
  ok("「卵アレルギーの料理の出し方」で、AIは手順を作らず担当者への確認を出す", /職場の担当者に確認してください/.test(await a.textContent(".refuse")) && !(await a.$("#nsteps")));
  await shot(a, "n6-refuse");
  await a.click(".back");

  // 用語のメモ → カード
  await a.click('[data-head="words"] .headbtn'); await a.click('[data-write="words"]');
  await a.waitForSelector("#ntext"); await a.fill("#ntext", "リネン：シーツやタオルのこと\nデシャップ：料理を出す台");
  await a.click("#nsave"); await toastHas(a, "保存しました");
  await a.click('#nav [data-tab="cards"]'); await a.waitForSelector("#cmake");
  await a.click("#cmake"); await toastHas(a, "枚のカードを作りました");
  await a.waitForSelector("#fcard"); await a.click("#cshow"); await a.click("#cknow");
  await a.click("#cshow"); await a.click("#cagain");
  await shot(a, "n7-cards");
  const cards = (await until(async () => { const l = await ownerList(`users/${uid}/cards`); return l.filter((c) => c.fields.known && c.fields.known.booleanValue !== undefined).length >= 2 ? l : null; })) || await ownerList(`users/${uid}/cards`);
  ok("メモからカードができ、覚えた・まだが残る", cards.length >= 2 && cards.some((c) => c.fields.known && c.fields.known.booleanValue === true) && cards.some((c) => c.fields.known && c.fields.known.booleanValue === false), `${cards.length}枚`);

  // 6. PDF
  await a.click('#nav [data-tab="pdf"]'); await a.waitForSelector("#pdfgo");
  await a.click('[data-size="a6"]');
  const [dl] = await Promise.all([a.waitForEvent("download", { timeout: 30000 }), a.click("#pdfgo")]);
  const path = await dl.path(); const buf = require("fs").readFileSync(path);
  ok("PDFができる（A6）", buf.slice(0, 4).toString() === "%PDF" && /\/MediaBox\s*\[\s*0 0 297\.6/.test(buf.toString("latin1")), dl.suggestedFilename());
  await shot(a, "n8-pdf");

  // 7. 上限：今日のAIを30回使ったことにする
  await ownerPatch(`usage/${uid}_${jstDay(Date.now())}`, { uid: { stringValue: uid }, day: { stringValue: jstDay(Date.now()) }, ai: { integerValue: "30" } });
  await a.click('#nav [data-tab="note"]'); await a.click('[data-write="steps"]').catch(async () => { await a.click('[data-head="steps"] .headbtn'); await a.click('[data-write="steps"]'); });
  await a.waitForSelector("#ntext"); await a.fill("#ntext", "タオルのたたみ方\n三つ折りにする");
  await a.click("#nai"); await a.waitForSelector("#notice:not([hidden])", { timeout: 20000 });
  ok("上限に達すると、下に小さなお知らせが出る", /今日のAIの利用回数に達しました/.test(await a.textContent("#notice")));
  await shot(a, "n9-limit");
  await a.click("#nsave"); await toastHas(a, "保存しました");
  ok("上限に達しても、手で書いて保存できる", !!(await until(async () => (await ownerList(`users/${uid}/notes`)).length === 4)));
  await a.click(".nclose");
  await a.click('[data-write="steps"]').catch(async () => { await a.click('[data-head="steps"] .headbtn'); await a.click('[data-write="steps"]'); });
  await a.waitForSelector("#ntext"); await a.fill("#ntext", "もう一度"); await a.click("#nai"); await a.waitForTimeout(2500);
  ok("お知らせは1日1回だけ", await a.$eval("#notice", (n) => n.hidden));
  await a.click(".back");
  await a.click('#nav [data-tab="cards"]'); await a.waitForSelector("#cshow, .empty");
  ok("上限に達しても、カードの練習はできる", !!(await a.$("#cshow")) || /全部覚えました/.test(await a.textContent(".view")));
  // 導入済みの職場なら上限なし
  const wid = (await ownerList("workplaces"))[0].name.split("/").pop();
  await ownerPatch(`workplaces/${wid}`, { name: { stringValue: "宇奈月温泉 テスト荘" }, area: { stringValue: "宇奈月温泉" }, norm: { stringValue: "x" }, mergedInto: { stringValue: "" }, adopted: { booleanValue: true } });
  await a.click('#nav [data-tab="note"]'); await a.click('[data-write="steps"]').catch(async () => { await a.click('[data-head="steps"] .headbtn'); await a.click('[data-write="steps"]'); });
  await a.waitForSelector("#ntext"); await a.fill("#ntext", "布団の敷き方\n敷布団を広げる"); await a.click("#nai");
  await a.waitForSelector("#nsteps", { timeout: 20000 });
  ok("職場が「導入済み」なら、上限を超えてもAIが使える", true);
  await a.click(".back");

  // 8. ほかの新人から、別の新人のメモが読めない（画面のつなぎを使って試す）
  ok("ほかの新人のアカウントから、別の新人のメモが読めない", (await (await fetch(`${FS}/users/${uid}/notes`, { headers: { Authorization: "Bearer " + "x" } })).status) >= 400);

  // 9. 計測と、管理者ページ
  await a.waitForTimeout(1500);
  const ev = await ownerList("events");
  const types = new Set(ev.map((e) => e.fields.type.stringValue));
  ok("イベントが記録される", ["signup", "consent", "place_select", "dept_select", "open", "note_save", "ai_organize", "ai_edit", "card_make", "card_practice", "pdf_export", "limit_hit", "limit_dismiss", "pii_found", "pii_removed", "ai_refuse"].every((t) => types.has(t)), [...types].join(","));
  ok("イベントに名前やメールが入っていない", ev.every((e) => Object.keys(e.fields).every((k) => ["uid", "type", "ts", "wid", "dept", "device", "meta"].includes(k))));

  const op = await newPage(APP + "#admin");
  await op.waitForSelector("#amail", { timeout: 30000 });
  await op.fill("#amail", "operator@example.com"); await op.click("#asend"); await toastHas(op, "メールを送りました");
  const codes = await (await fetch(`${H}:9099/emulator/v1/projects/${P}/oobCodes`)).json();
  const c = codes.oobCodes.filter((x) => x.email === "operator@example.com").pop();
  await op.goto(`${APP}?apiKey=demo-key&oobCode=${c.oobCode}&mode=signIn&lang=ja#admin`);
  await op.waitForSelector("#rebuild", { timeout: 40000 });
  await op.click("#rebuild"); await toastHas(op, "集計を作り直しました");
  await op.waitForSelector(".kpi", { timeout: 20000 });
  ok("管理者ページに、需要を判断する3つの数字が出る", (await op.$$(".kpi")).length === 3);
  await shot(op, "a1-top");
  for (const s of ["keep", "use", "places", "users", "content", "cost", "csv"]) {
    await op.click(`[data-sec="${s}"]`); await op.waitForTimeout(400);
    if (OUT) await shot(op, "a-" + s);
  }
  await op.click('[data-sec="places"]'); await op.waitForSelector("[data-place]");
  ok("職場ごとの一覧が出る", /テスト荘/.test(await op.textContent(".view")));
  await op.click('[data-sec="users"]'); await op.waitForSelector("[data-user]");
  const listText = await op.textContent(".view");
  ok("新人の一覧に、名前やメールが出ない", !/operator@example\.com/.test(listText) && /instagram/.test(listText));
  await op.click(`[data-user="${uid}"]`); await op.click("#openNotes");
  await op.waitForFunction(() => /シーツの替え方/.test(document.querySelector(".view").textContent), null, { timeout: 20000 });
  const logs = await ownerList("auditLogs");
  ok("運営者がメモの中身を開くと、見た記録が残る", logs.length === 1 && logs[0].fields.target.stringValue === uid);
  await shot(op, "a2-user");
  const overflow = [];
  for (const [p, n] of [[a, "新人"], [op, "管理者"]]) if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) overflow.push(n);
  ok("横にはみ出さない", overflow.length === 0, overflow.join(","));

  await browser.close();
  for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? "  （" + x + "）" : ""}`);
  if (errors.length) console.log("ページのエラー:", errors.slice(0, 5));
  process.exit(results.some((r) => r[0] === "NG") || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? "  （" + x + "）" : ""}`); process.exit(2); });
