// 宿のはじめて帳 新人向けアプリのサーバー側（Cloud Functions、東京リージョン）
//   noteAi            : メモをAIで整える、覚えるカードを作る。1人1日の上限つき
//   notePhotoSlot     : 写真を送る前に、1日の枚数を確かめる
//   noteWorkplaceAdd  : 職場を足す（表記をそろえ、同じ宿があればそれを返す）
//   noteAdminMerge    : 運営者が、同じ宿の職場を1つにまとめる
//   noteAdminAdopt    : 運営者が、職場に「導入済み」の印をつける
//   noteAdminNotes    : 運営者が、1人のメモの中身を見る。見た記録を必ず残す
//   noteAdminStats    : 運営者が、集計を今すぐ作り直す
//   noteNightly       : 毎晩3時（日本時間）に集計を作る
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret, defineString } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { randomBytes } from "node:crypto";
import { placeKey, similarNorm } from "./shared/normalize";
import { dangerKind } from "./shared/danger";
import { jstDay } from "./shared/dates";
import { SYSTEM_CARDS, SYSTEM_ORGANIZE, cleanCards, cleanOrganized, fakeCards, fakeOrganize, parseJsonText } from "./shared/ai";
import { buildStats } from "./stats";
import limits from "./config/limits.json";
import aiCfg from "./config/ai.json";
import skeleton from "./config/skeleton.json";

initializeApp();
setGlobalOptions({ region: "asia-northeast1", maxInstances: 10 });

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const NOTE_AI_MODEL = defineString("NOTE_AI_MODEL", { default: "" });
const db = () => getFirestore();
const HEADINGS = skeleton.headings.map((h) => h.id);
const DEPTS = skeleton.depts.map((d) => d.id);

function need(cond: unknown, code: "unauthenticated" | "permission-denied" | "invalid-argument" | "not-found" | "resource-exhausted" | "failed-precondition", msg: string): asserts cond {
  if (!cond) throw new HttpsError(code, msg);
}
const uidOf = (req: CallableRequest): string => { need(req.auth, "unauthenticated", "ログインしてください"); return req.auth.uid; };
const isOperator = (req: CallableRequest): boolean => !!req.auth && req.auth.token.role === "operator";

// 統合された職場は、統合先をたどる
async function resolvePlace(id: string): Promise<{ id: string; adopted: boolean } | null> {
  let cur = id;
  for (let i = 0; i < 5 && cur; i++) {
    const s = await db().doc(`workplaces/${cur}`).get();
    if (!s.exists) return null;
    const to = s.get("mergedInto");
    if (!to) return { id: cur, adopted: !!s.get("adopted") };
    cur = to;
  }
  return null;
}

// 1人1日の上限。職場が「導入済み」なら上限なし
async function spend(uid: string, field: "ai" | "photos", limit: number): Promise<void> {
  const user = await db().doc(`users/${uid}`).get();
  need(user.exists && user.get("consent"), "failed-precondition", "先に、はじめる前の同意をしてください");
  const wid = user.get("workplaceId");
  const place = wid ? await resolvePlace(wid) : null;
  const ref = db().doc(`usage/${uid}_${jstDay(Date.now())}`);
  const n = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const cur = (s.exists ? s.get(field) : 0) || 0;
    if (!(place && place.adopted) && cur >= limit) return -1;
    tx.set(ref, { uid, day: jstDay(Date.now()), [field]: cur + 1, wid: (place && place.id) || "" }, { merge: true });
    return cur + 1;
  });
  if (n < 0) throw new HttpsError("resource-exhausted", "limit", { limit: field });
}

// ---------- AI ----------
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
// 指示と、答えの整え方は apps/note/src/lib/ai.ts（見本版と同じもの）
async function callClaude(system: string, user: string, uid: string): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  let res;
  try {
    res = await client.messages.create({ model: NOTE_AI_MODEL.value() || aiCfg.model, max_tokens: aiCfg.maxTokens, system, messages: [{ role: "user", content: user }] });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpsError("unavailable", "AIが混み合っています");
    throw new HttpsError("unavailable", "AIにつながりませんでした");
  }
  await db().doc(`usage/${uid}_${jstDay(Date.now())}`).set({ tokIn: FieldValue.increment(res.usage.input_tokens || 0), tokOut: FieldValue.increment(res.usage.output_tokens || 0) }, { merge: true });
  if (res.stop_reason === "refusal") return JSON.stringify({ refuse: true });
  return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
}

export const noteAi = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, memory: "512MiB" }, async (req) => {
  const uid = uidOf(req);
  const { kind, text } = (req.data || {}) as { kind?: string; text?: string };
  need(kind === "organize" || kind === "cards", "invalid-argument", "種類の指定が正しくありません");
  need(typeof text === "string" && text.trim().length > 0 && text.length <= limits.noteMaxChars * 4, "invalid-argument", "文が空か、長すぎます");
  // AIが手順を作らない話題は、AIを呼ぶ前に止める（回数にも数えない）
  if (kind === "organize" && dangerKind(text)) return { refuse: true };
  await spend(uid, "ai", limits.aiPerDay);
  const fake = process.env.AI_FAKE === "1";
  const parse = (t: string) => { try { return parseJsonText(t); } catch (e) { throw new HttpsError("internal", "AIの答えを読み取れませんでした"); } };
  if (kind === "organize") return cleanOrganized(fake ? fakeOrganize(text) : parse(await callClaude(SYSTEM_ORGANIZE, text, uid)));
  return { cards: cleanCards(fake ? { cards: fakeCards(text) } : parse(await callClaude(SYSTEM_CARDS, text, uid))) };
});

// ---------- 写真 ----------
// 送ってよい枠を1つ出す。写真の置き場所の決まり（storage.rules）は、この枠があるときだけ書き込みを通す
export const notePhotoSlot = onCall(async (req) => {
  const uid = uidOf(req);
  await spend(uid, "photos", limits.photosPerDay);
  const id = randomBytes(9).toString("hex");
  await db().doc(`users/${uid}/slots/${id}`).set({ at: Date.now() });
  return { id, path: `users/${uid}/photos/${id}.jpg` };
});

// ---------- 職場 ----------
export const noteWorkplaceAdd = onCall(async (req) => {
  const uid = uidOf(req);
  const { name, area, force } = (req.data || {}) as { name?: string; area?: string; force?: boolean };
  const nm = str(name, 40), ar = str(area, 30);
  need(nm.length >= 2, "invalid-argument", "宿の名前を入れてください");
  need(ar.length >= 2, "invalid-argument", "温泉地か、市町村を入れてください");
  const norm = placeKey(nm, ar);
  need(norm.length >= 2, "invalid-argument", "宿の名前をもう少しくわしく入れてください");
  const same = await db().collection("workplaces").where("norm", "==", norm).limit(5).get();
  for (const d of same.docs) {
    const p = await resolvePlace(d.id);
    if (p) { const s = await db().doc(`workplaces/${p.id}`).get(); return { id: p.id, name: s.get("name"), area: s.get("area"), existed: true }; }
  }
  // 似た名前の宿があれば、足す前に「この宿ではありませんか」と返す（本人が「ちがう宿」と言えば足す）
  if (!force) {
    const all = await db().collection("workplaces").where("mergedInto", "==", "").limit(2000).get();
    const cands = all.docs.filter((d) => similarNorm(String(d.get("norm") || ""), norm)).slice(0, 5).map((d) => ({ id: d.id, name: d.get("name"), area: d.get("area") }));
    if (cands.length) return { candidates: cands };
  }
  // 1人が1日に足せる数を小さくしておく（いたずらで増やされないように）
  const ref = db().doc(`usage/${uid}_${jstDay(Date.now())}`);
  const n = await db().runTransaction(async (tx) => { const s = await tx.get(ref); const c = ((s.exists && s.get("places")) || 0) + 1; tx.set(ref, { uid, day: jstDay(Date.now()), places: c }, { merge: true }); return c; });
  need(n <= 5, "resource-exhausted", "今日はこれ以上、職場を足せません");
  const doc = await db().collection("workplaces").add({ name: nm, area: ar, norm, mergedInto: "", adopted: false, createdBy: uid, createdAt: Date.now() });
  return { id: doc.id, name: nm, area: ar, existed: false };
});

export const noteAdminMerge = onCall(async (req) => {
  need(isOperator(req), "permission-denied", "運営者だけが使えます");
  const { from, to } = (req.data || {}) as { from?: string; to?: string };
  need(typeof from === "string" && typeof to === "string" && from && to && from !== to, "invalid-argument", "まとめる職場を2つ選んでください");
  const [a, b] = await Promise.all([db().doc(`workplaces/${from}`).get(), db().doc(`workplaces/${to}`).get()]);
  need(a.exists && b.exists && !b.get("mergedInto"), "not-found", "職場が見つかりません");
  await a.ref.update({ mergedInto: to, mergedAt: Date.now() });
  const users = await db().collection("users").where("workplaceId", "==", from).get();
  const notes = await db().collectionGroup("notes").where("wid", "==", from).get();
  const refs = [...users.docs.map((d) => ({ ref: d.ref, data: { workplaceId: to } })), ...notes.docs.map((d) => ({ ref: d.ref, data: { wid: to } }))];
  for (let i = 0; i < refs.length; i += 400) { const batch = db().batch(); refs.slice(i, i + 400).forEach((x) => batch.update(x.ref, x.data)); await batch.commit(); }
  return { ok: true, users: users.size, notes: notes.size };
});

export const noteAdminAdopt = onCall(async (req) => {
  need(isOperator(req), "permission-denied", "運営者だけが使えます");
  const { id, adopted } = (req.data || {}) as { id?: string; adopted?: boolean };
  need(typeof id === "string" && id, "invalid-argument", "職場の指定がありません");
  const s = await db().doc(`workplaces/${id}`).get();
  need(s.exists, "not-found", "職場が見つかりません");
  await s.ref.update({ adopted: !!adopted, adoptedAt: Date.now() });
  return { ok: true };
});

// ---------- 運営者がメモの中身を見る ----------
// 決まり（firestore.rules）では、運営者もメモを直接は読めない。ここを通すことで、見た記録が必ず残る
export const noteAdminNotes = onCall(async (req) => {
  need(isOperator(req), "permission-denied", "運営者だけが使えます");
  const { uid } = (req.data || {}) as { uid?: string };
  need(typeof uid === "string" && uid, "invalid-argument", "利用者の指定がありません");
  const snap = await db().collection(`users/${uid}/notes`).orderBy("createdAt", "desc").limit(200).get();
  await db().collection("auditLogs").add({ by: req.auth!.uid, target: uid, count: snap.size, at: Date.now() });
  return { notes: snap.docs.map((d) => ({ id: d.id, heading: d.get("heading") || "", dept: d.get("dept") || "", title: d.get("title") || "", text: d.get("text") || "",
    steps: d.get("steps") || [], photos: (d.get("photos") || []).length, createdAt: d.get("createdAt") || 0, wid: d.get("wid") || "" })) };
});

// ---------- 集計 ----------
export const noteAdminStats = onCall({ timeoutSeconds: 300, memory: "1GiB" }, async (req) => {
  need(isOperator(req), "permission-denied", "運営者だけが使えます");
  return buildStats(db(), Date.now());
});
export const noteNightly = onSchedule({ schedule: "0 3 * * *", timeZone: "Asia/Tokyo", timeoutSeconds: 540, memory: "1GiB" }, async () => { await buildStats(db(), Date.now()); });

export const _test = { DEPTS, HEADINGS };
