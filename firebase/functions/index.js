// 宿のはじめて帳 本番のサーバー側の処理（Cloud Functions for Firebase、東京リージョン）
//   ai          : AIの呼び出し（質問係、翻訳、教材づくりなど）。APIキーはサーバーにだけ置く
//   join        : 招待リンクの合言葉を確かめて、その宿のスタッフにする
//   whoami      : ログインした人の役割を返す。運営者のメールアドレスなら運営者にする
//   grantAdmin  : 運営者が、メールアドレスを指定して宿の管理者を追加する
//   invite      : 管理者と運営者が、スタッフ用の招待リンクを見る、作り直す
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret, defineString, defineInt } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const crypto = require("crypto");

initializeApp();
setGlobalOptions({ region: "asia-northeast1", maxInstances: 10 });

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const OPERATOR_EMAIL = defineString("OPERATOR_EMAIL");
const AI_DAILY_LIMIT = defineInt("AI_DAILY_LIMIT", { default: 300 });
const AI_MODEL = defineString("AI_MODEL", { default: "claude-opus-5-5" });

const db = () => getFirestore();
const INN_ID = /^[a-z0-9-]{2,40}$/;

function need(cond, code, msg) {
  if (!cond) throw new HttpsError(code, msg);
}
function claims(req) {
  return (req.auth && req.auth.token) || {};
}
function isOperator(req) {
  return claims(req).role === "operator";
}
function memberOf(req, inn) {
  const c = claims(req);
  return isOperator(req) || (c.inn === inn && (c.role === "staff" || c.role === "admin"));
}
function adminOf(req, inn) {
  const c = claims(req);
  return isOperator(req) || (c.inn === inn && c.role === "admin");
}
function agencyOf(req, inn) {
  const c = claims(req);
  return c.role === "agency" && c.inn === inn && typeof c.agency === "string" && c.agency.length > 0;
}
const priv = (inn, id) => db().doc(`inns/${inn}/private/${id}`);
const CODE = /^[A-Za-z0-9_-]{8,40}$/;
const DOC_ID = /^[A-Za-z0-9_-]{1,60}$/;
function today() {
  // 日本時間の日付
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function newCode() {
  return crypto.randomBytes(9).toString("base64url");
}

// ---------- ログインした人の役割 ----------
exports.whoami = onCall(async (req) => {
  need(req.auth, "unauthenticated", "ログインしてください");
  const t = req.auth.token;
  const op = (OPERATOR_EMAIL.value() || "").trim().toLowerCase();
  if (op && t.email && t.email_verified !== false && t.email.toLowerCase() === op && t.role !== "operator") {
    await getAuth().setCustomUserClaims(req.auth.uid, { role: "operator" });
    return { role: "operator", refresh: true };
  }
  return { role: t.role || null, inn: t.inn || null, refresh: false };
});

// ---------- 招待リンクで、その宿のスタッフになる ----------
exports.join = onCall(async (req) => {
  need(req.auth, "unauthenticated", "ログインしてください");
  const { inn, code, pcode, kcode } = req.data || {};
  need(typeof inn === "string" && INN_ID.test(inn), "invalid-argument", "宿の指定がありません");
  const old = claims(req);
  const keep = old.role === "operator" || (old.role === "admin" && old.inn === inn);
  const bad = "招待リンクが古いか、正しくありません。受け入れ担当に新しいリンクをもらってください";
  if (pcode !== undefined) {
    // 本人あてのリンク。入った端末を、受け入れ一覧のその人につなぐ
    need(typeof pcode === "string" && CODE.test(pcode), "invalid-argument", "招待リンクが正しくありません");
    const ps = await priv(inn, "p_" + pcode).get();
    need(ps.exists, "permission-denied", bad);
    if (keep) return { role: old.role, refresh: false };
    await getAuth().setCustomUserClaims(req.auth.uid, { role: "staff", inn, person: ps.get("person") });
    return { role: "staff", refresh: true };
  }
  if (kcode !== undefined) {
    // 休憩室の共有タブレット用のリンク
    need(typeof kcode === "string" && CODE.test(kcode), "invalid-argument", "招待リンクが正しくありません");
    const ks = await priv(inn, "kiosk").get();
    need(ks.exists && ks.get("code") === kcode, "permission-denied", bad);
    if (keep) return { role: old.role, refresh: false };
    await getAuth().setCustomUserClaims(req.auth.uid, { role: "staff", inn, kiosk: true });
    return { role: "staff", refresh: true };
  }
  need(typeof code === "string" && code.length >= 8 && code.length <= 40, "invalid-argument", "招待リンクが正しくありません");
  const snap = await db().doc(`inns/${inn}/private/invite`).get();
  need(snap.exists && snap.get("code") === code, "permission-denied", "招待リンクが古いか、正しくありません。受け入れ担当に新しいリンクをもらってください");
  const c = claims(req);
  if (c.role === "operator" || (c.role === "admin" && c.inn === inn)) return { role: c.role, refresh: false };
  await getAuth().setCustomUserClaims(req.auth.uid, { role: "staff", inn });
  return { role: "staff", refresh: true };
});

// ---------- 運営者が管理者を追加する ----------
exports.grantAdmin = onCall(async (req) => {
  need(isOperator(req), "permission-denied", "運営者だけが使えます");
  const { inn, email } = req.data || {};
  need(typeof inn === "string" && INN_ID.test(inn), "invalid-argument", "宿の指定がありません");
  need(typeof email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), "invalid-argument", "メールアドレスが正しくありません");
  let user;
  try {
    user = await getAuth().getUserByEmail(email);
  } catch (e) {
    user = await getAuth().createUser({ email });
  }
  await getAuth().setCustomUserClaims(user.uid, { role: "admin", inn });
  return { ok: true };
});

// ---------- 招待リンク（管理者と運営者） ----------
exports.invite = onCall(async (req) => {
  const { inn, rotate } = req.data || {};
  need(typeof inn === "string" && INN_ID.test(inn), "invalid-argument", "宿の指定がありません");
  need(adminOf(req, inn), "permission-denied", "管理者だけが使えます");
  const ref = db().doc(`inns/${inn}/private/invite`);
  const snap = await ref.get();
  if (rotate || !snap.exists) {
    const code = newCode();
    await ref.set({ code, at: Date.now() });
    return { code };
  }
  return { code: snap.get("code") };
});

// ---------- 本人あての招待リンク ----------
// 受け入れ一覧の1人につながるリンクを作る。管理者と運営者、または、その人を送った派遣会社が使える。
async function personCode(inn, person) {
  const link = priv(inn, "pl_" + person);
  const ls = await link.get();
  if (ls.exists) return ls.get("code");
  const code = newCode();
  await priv(inn, "p_" + code).set({ person, at: Date.now() });
  await link.set({ code, at: Date.now() });
  return code;
}
exports.personInvite = onCall(async (req) => {
  const { inn, person } = req.data || {};
  need(typeof inn === "string" && INN_ID.test(inn), "invalid-argument", "宿の指定がありません");
  need(typeof person === "string" && DOC_ID.test(person), "invalid-argument", "人の指定がありません");
  const pd = await db().doc(`inns/${inn}/people/${person}`).get();
  need(pd.exists, "not-found", "その人が受け入れ一覧にありません");
  const ok = adminOf(req, inn) || (agencyOf(req, inn) && pd.get("agency") === claims(req).agency);
  need(ok, "permission-denied", "この操作はできません");
  // 教材の進み具合を置く場所。派遣会社に見せるのは、ここにある「見終わった教材」と「終えたテスト」だけ
  const pr = db().doc(`inns/${inn}/progress/${person}`);
  if (!(await pr.get()).exists) await pr.set({ name: pd.get("name") || "", agency: pd.get("agency") || "", done: [], quiz: [], at: Date.now() });
  return { code: await personCode(inn, person) };
});

// ---------- 休憩室の共有タブレット ----------
exports.kioskInvite = onCall(async (req) => {
  const { inn, rotate } = req.data || {};
  need(typeof inn === "string" && INN_ID.test(inn), "invalid-argument", "宿の指定がありません");
  need(adminOf(req, inn), "permission-denied", "管理者だけが使えます");
  const ref = priv(inn, "kiosk");
  const snap = await ref.get();
  if (rotate || !snap.exists) {
    const code = newCode();
    await ref.set({ code, at: Date.now() });
    return { code };
  }
  return { code: snap.get("code") };
});
// 新人ごとの4けたの番号。管理者が見て、本人に伝える
exports.personPin = onCall(async (req) => {
  const { inn, person } = req.data || {};
  need(typeof inn === "string" && INN_ID.test(inn), "invalid-argument", "宿の指定がありません");
  need(typeof person === "string" && DOC_ID.test(person), "invalid-argument", "人の指定がありません");
  need(adminOf(req, inn), "permission-denied", "管理者だけが使えます");
  const pd = await db().doc(`inns/${inn}/people/${person}`).get();
  need(pd.exists, "not-found", "その人が受け入れ一覧にありません");
  const pr = db().doc(`inns/${inn}/progress/${person}`);
  if (!(await pr.get()).exists) await pr.set({ name: pd.get("name") || "", agency: pd.get("agency") || "", done: [], quiz: [], at: Date.now() });
  const ref = priv(inn, "pins");
  const pin = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const map = (s.exists && s.get("map")) || {};
    const have = Object.keys(map).find((k) => map[k] === person);
    if (have) return have;
    let p;
    for (let i = 0; i < 200; i++) { p = String(crypto.randomInt(1000, 10000)); if (!map[p]) break; p = null; }
    if (!p) throw new HttpsError("resource-exhausted", "番号を作れませんでした");
    map[p] = person;
    tx.set(ref, { map });
    return p;
  });
  return { pin };
});
// 共有タブレットで番号を入れる。5回まちがえると、10分使えない
exports.kioskEnter = onCall(async (req) => {
  const { inn, pin } = req.data || {};
  const c = claims(req);
  need(typeof inn === "string" && INN_ID.test(inn), "invalid-argument", "宿の指定がありません");
  need(c.role === "staff" && c.inn === inn && c.kiosk === true, "permission-denied", "この端末は、共有のタブレットとして登録されていません");
  need(typeof pin === "string" && /^\d{4}$/.test(pin), "invalid-argument", "番号は4けたです");
  const tries = priv(inn, "kt_" + req.auth.uid);
  const ts = await tries.get();
  need(!(ts.exists && (ts.get("until") || 0) > Date.now()), "resource-exhausted", "番号を何度もまちがえました。10分ほど待ってください");
  const ms = await priv(inn, "pins").get();
  const person = ms.exists ? (ms.get("map") || {})[pin] : null;
  if (!person) {
    const fails = ((ts.exists && ts.get("fails")) || 0) + 1;
    await tries.set(fails >= 5 ? { fails: 0, until: Date.now() + 10 * 60 * 1000 } : { fails, until: 0 });
    throw new HttpsError("permission-denied", "番号が違います");
  }
  if (ts.exists) await tries.delete();
  await getAuth().setCustomUserClaims(req.auth.uid, { role: "staff", inn, kiosk: true, person });
  return { person, refresh: true };
});
exports.kioskLeave = onCall(async (req) => {
  const { inn } = req.data || {};
  const c = claims(req);
  need(c.role === "staff" && c.inn === inn && c.kiosk === true, "permission-denied", "この端末は、共有のタブレットとして登録されていません");
  await getAuth().setCustomUserClaims(req.auth.uid, { role: "staff", inn, kiosk: true });
  return { refresh: true };
});

// ---------- 派遣会社 ----------
// 運営者が、宿ごとに派遣会社の担当者を追加する。派遣会社に見えるのは、自社から送った人の教材の進み具合だけ
exports.grantAgency = onCall(async (req) => {
  need(isOperator(req), "permission-denied", "運営者だけが使えます");
  const { inn, email, name } = req.data || {};
  need(typeof inn === "string" && INN_ID.test(inn), "invalid-argument", "宿の指定がありません");
  need(typeof email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), "invalid-argument", "メールアドレスが正しくありません");
  need(typeof name === "string" && name.trim().length > 0 && name.length <= 40, "invalid-argument", "会社の名前を入れてください");
  const ref = priv(inn, "agencies");
  const agency = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const map = (s.exists && s.get("map")) || {};
    let id = Object.keys(map).find((k) => map[k].name === name.trim());
    if (!id) { id = "ag_" + crypto.randomBytes(5).toString("hex"); map[id] = { name: name.trim() }; tx.set(ref, { map }); }
    return id;
  });
  let user;
  try { user = await getAuth().getUserByEmail(email); } catch (e) { user = await getAuth().createUser({ email }); }
  await getAuth().setCustomUserClaims(user.uid, { role: "agency", inn, agency, agencyName: name.trim() });
  return { ok: true, agency };
});
// 派遣会社が、自社から送る人を受け入れ一覧に足し、本人あての招待リンクを受け取る
exports.agencyInvite = onCall(async (req) => {
  const { inn, name, job, startISO } = req.data || {};
  need(typeof inn === "string" && INN_ID.test(inn), "invalid-argument", "宿の指定がありません");
  need(agencyOf(req, inn), "permission-denied", "派遣会社の担当者だけが使えます");
  need(typeof name === "string" && name.trim().length > 0 && name.length <= 40, "invalid-argument", "名前を入れてください");
  need(typeof job === "string" && job.length <= 40, "invalid-argument", "仕事の指定が正しくありません");
  need(startISO === "" || (typeof startISO === "string" && /^\d{4}-\d{2}-\d{2}$/.test(startISO)), "invalid-argument", "着任日が正しくありません");
  const c = claims(req);
  const start = startISO ? `${+startISO.slice(5, 7)}月${+startISO.slice(8, 10)}日` : "";
  const pd = await db().collection(`inns/${inn}/people`).add({ name: name.trim(), type: "派遣", job, start, startISO: startISO || "", host: "",
    agency: c.agency, agencyName: c.agencyName || "", prep: {}, ojt: {}, note: "", at: Date.now() });
  await db().doc(`inns/${inn}/progress/${pd.id}`).set({ name: name.trim(), agency: c.agency, done: [], quiz: [], at: Date.now() });
  return { person: pd.id, code: await personCode(inn, pd.id) };
});

// ---------- AIの呼び出し ----------
// 送るもの: { inn, input: 文字列, json: 真偽, tier: "quick" | "default", split: 数（任意） }
// split は、input の中で「毎回同じ部分」が終わる位置。そこまでをキャッシュして安く読み直す。
exports.ai = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: "512MiB" }, async (req) => {
  need(req.auth, "unauthenticated", "ログインしてください");
  const { inn, input, json, tier, split } = req.data || {};
  need(typeof inn === "string" && INN_ID.test(inn), "invalid-argument", "宿の指定がありません");
  need(memberOf(req, inn), "permission-denied", "この宿のメンバーではありません");
  need(typeof input === "string" && input.length > 0 && input.length <= 60000, "invalid-argument", "質問の文が長すぎるか、空です");

  // 宿ごとの1日の上限
  const usage = db().doc(`inns/${inn}/private/usage_${today()}`);
  const count = await db().runTransaction(async (tx) => {
    const s = await tx.get(usage);
    const n = (s.exists ? s.get("n") : 0) + 1;
    tx.set(usage, { n, at: Date.now() }, { merge: true });
    return n;
  });
  need(count <= AI_DAILY_LIMIT.value(), "resource-exhausted", "今日のAIの回数の上限に達しました。明日また使えます");

  if (process.env.AI_FAKE === "1") {
    return fakeAnswer(input, json);
  }

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

  const cut = Number.isInteger(split) && split > 0 && split < input.length ? split : 0;
  const content = cut
    ? [
        { type: "text", text: input.slice(0, cut), cache_control: { type: "ephemeral" } },
        { type: "text", text: input.slice(cut) },
      ]
    : [{ type: "text", text: input }];

  let res;
  try {
    res = await client.beta.messages.create({
      model: AI_MODEL.value(),
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: tier === "quick" ? "low" : "medium" },
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpsError("resource-exhausted", "AIが混み合っています");
    if (e instanceof Anthropic.APIConnectionError) throw new HttpsError("unavailable", "AIにつながりませんでした");
    if (e instanceof Anthropic.APIStatusError && e.status >= 500) throw new HttpsError("unavailable", "AIにつながりませんでした");
    throw new HttpsError("internal", "AIの呼び出しに失敗しました");
  }
  if (res.stop_reason === "refusal") {
    throw new HttpsError("failed-precondition", "AIがこの内容には答えませんでした。担当者に聞いてください");
  }
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  await usage.set({ tokensIn: FieldValue.increment(res.usage.input_tokens || 0),
    tokensCached: FieldValue.increment(res.usage.cache_read_input_tokens || 0),
    tokensOut: FieldValue.increment(res.usage.output_tokens || 0) }, { merge: true });
  if (!json) return { text, truncated: res.stop_reason === "max_tokens" };
  return { value: parseJson(text) };
});

// ---------- ホームページの相談フォーム ----------
// 送るもの: { inn, name, contact, body, site }。site は人には見えない欄で、入っていたら機械の書き込みとして捨てる。
// leads に残す。読めるのはサーバー側だけ（運営者は Firebase の画面で見る）。1日の件数に上限をつける。
exports.contact = onRequest({ cors: false, memory: "256MiB" }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const b = (req.body && typeof req.body === "object") ? req.body : {};
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const lead = { inn: str(b.inn, 100), name: str(b.name, 100), contact: str(b.contact, 200), body: str(b.body, 4000) };
  if (str(b.site, 10)) { res.json({ ok: true }); return; }
  if (!lead.inn || !lead.name || !lead.contact) { res.status(400).json({ error: "missing" }); return; }
  const day = db().doc(`site/leads_${today()}`);
  const n = await db().runTransaction(async (tx) => {
    const s = await tx.get(day);
    const c = (s.exists ? s.get("n") : 0) + 1;
    tx.set(day, { n: c }, { merge: true });
    return c;
  });
  if (n > 100) { res.status(429).json({ error: "busy" }); return; }
  await db().collection("leads").add({ ...lead, at: Date.now() });
  res.json({ ok: true });
});

function parseJson(text) {
  const t = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch (e) {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try { return JSON.parse(t.slice(a, b + 1)); } catch (e2) { /* 下へ */ }
    }
    throw new HttpsError("internal", "AIの答えを読み取れませんでした");
  }
}

// テスト用（エミュレーターで AI_FAKE=1 のとき）。本物のAIは呼ばない。
function fakeAnswer(input, json) {
  if (!json) return { text: "（テスト）回答案です。", truncated: false };
  const q = (input.split("新人の質問：").pop() || "");
  if (input.includes("質問係")) {
    if (/アレルギー|けが|体調/.test(q)) return { value: { status: "escalate", answer: "", source: "" } };
    if (q.includes("中抜け")) return { value: { status: "answer", answer: "（テスト）中抜けの時間は部署で違います。", source: "テスト" } };
    return { value: { status: "unknown", answer: "", source: "" } };
  }
  return { value: {} };
}

exports._test = { parseJson };
