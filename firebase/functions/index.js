// 宿のはじめて帳 本番のサーバー側の処理（Cloud Functions for Firebase、東京リージョン）
//   ai          : AIの呼び出し（質問係、翻訳、教材づくりなど）。APIキーはサーバーにだけ置く
//   join        : 招待リンクの合言葉を確かめて、その宿のスタッフにする
//   whoami      : ログインした人の役割を返す。運営者のメールアドレスなら運営者にする
//   grantAdmin  : 運営者が、メールアドレスを指定して宿の管理者を追加する
//   invite      : 管理者と運営者が、スタッフ用の招待リンクを見る、作り直す
const { onCall, HttpsError } = require("firebase-functions/v2/https");
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
  const { inn, code } = req.data || {};
  need(typeof inn === "string" && INN_ID.test(inn), "invalid-argument", "宿の指定がありません");
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
