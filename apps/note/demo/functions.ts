// 見本版：firebase/functions の代わり。本番のサーバーの処理（firebase/functions-note）を、この端末の中で同じ決まりで動かす。
// AIは、Claudeのアプリの「sample」で本物のClaudeを使う。使えないときは、決まった形で整える（fakeOrganize）。
import { store } from "./store";
import { getAuth } from "./auth";
import { buildStats } from "../../../firebase/functions-note/src/stats";
import limits from "../config/limits.json";
import { dangerKind } from "../src/lib/danger";
import { placeKey, similarNorm } from "../src/lib/normalize";
import { jstDay } from "../src/lib/dates";
import { SYSTEM_CARDS, SYSTEM_ORGANIZE, cleanCards, cleanOrganized, fakeCards, fakeOrganize } from "../src/lib/ai";

type Data = Record<string, unknown>;
const err = (code: string, message: string, details?: Data) => Object.assign(new Error(message), { code: "functions/" + code, details });
const uid = () => { const u = getAuth().currentUser; if (!u) throw err("unauthenticated", "ログインしてください"); return u.uid; };

// ---------- AI（本物のClaude、だめなら決まった形） ----------
interface Sample { json: (input: string, o?: Data) => Promise<unknown> }
let samplePromise: Promise<Sample | null> | null = null;
let aiMode: "claude" | "fake" | "unknown" = "unknown";
const showMode = () => { (window as unknown as { __noteAiMode?: string }).__noteAiMode = aiMode; window.dispatchEvent(new Event("note-ai-mode")); };
function sample(): Promise<Sample | null> {
  const w = window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } };
  if (!samplePromise) samplePromise = (w.claude?.use ? (w.claude.use("sample") as Promise<Sample | null>).catch(() => null) : Promise.resolve(null)).then((s) => { aiMode = s ? "claude" : "fake"; showMode(); return s; });
  return samplePromise;
}
void sample();
async function ask(system: string, text: string): Promise<unknown | null> {
  const s = await sample(); if (!s) return null;
  try { return await s.json(`${system}\n\n新人のメモ：\n${text}`, { modelTier: "quick" }); }
  catch (e) { const c = (e as { code?: string }).code; if (c === "not_granted") { aiMode = "fake"; samplePromise = Promise.resolve(null); showMode(); } return null; }
}

// ---------- 上限（本番の spend と同じ決まり） ----------
function resolvePlace(id: string): { id: string; adopted: boolean } | null {
  let cur = id;
  for (let i = 0; i < 5 && cur; i++) { const s = store.get(`workplaces/${cur}`); if (!s) return null; if (!s.mergedInto) return { id: cur, adopted: !!s.adopted }; cur = String(s.mergedInto); }
  return null;
}
function spend(u: string, field: "ai" | "photos", lim: number): void {
  const user = store.get(`users/${u}`);
  if (!user || !user.consent) throw err("failed-precondition", "先に、はじめる前の同意をしてください");
  const place = user.workplaceId ? resolvePlace(String(user.workplaceId)) : null;
  const path = `usage/${u}_${jstDay(Date.now())}`, cur = Number((store.get(path) || {})[field] || 0);
  if (!(place && place.adopted) && cur >= lim) throw err("resource-exhausted", "limit", { limit: field });
  store.set(path, { uid: u, day: jstDay(Date.now()), [field]: cur + 1, wid: place ? place.id : "" }, true);
}

// ---------- 運営者の集計（本番の buildStats を、この端末のデータで動かす） ----------
const snap = (r: { id: string; path: string; data: Data }) => ({ id: r.id, ref: { path: r.path }, get: (f: string) => r.data[f] });
const qs = (rows: { id: string; path: string; data: Data }[]) => ({ docs: rows.map(snap), size: rows.length });
const adminDb = {
  collection: (name: string) => ({
    get: async () => qs(store.list(name)),
    where: (f: string, op: string, v: unknown) => ({ get: async () => qs(store.list(name).filter((r) => (op === ">=" ? (r.data[f] as number) >= (v as number) : r.data[f] === v))) }),
  }),
  collectionGroup: (name: string) => ({ get: async () => qs(store.group(name)) }),
  doc: (path: string) => ({ set: async (d: Data) => store.set(path, d) }),
};

// ---------- 呼び出し ----------
const handlers: Record<string, (d: Data) => Promise<unknown>> = {
  async noteAi(d) {
    const u = uid(), kind = String(d.kind || ""), text = String(d.text || "");
    if (!text.trim()) throw err("invalid-argument", "文が空です");
    if (kind === "organize" && dangerKind(text)) return { refuse: true };
    spend(u, "ai", limits.aiPerDay);
    if (kind === "organize") { const r = await ask(SYSTEM_ORGANIZE, text); return cleanOrganized(r ?? fakeOrganize(text)); }
    const r = await ask(SYSTEM_CARDS, text); return { cards: cleanCards(r ?? { cards: fakeCards(text) }) };
  },
  async notePhotoSlot() { const u = uid(); spend(u, "photos", limits.photosPerDay); const id = store.newId(); store.set(`users/${u}/slots/${id}`, { at: Date.now() }); return { id, path: `users/${u}/photos/${id}.jpg` }; },
  async noteWorkplaceAdd(d) {
    uid();
    const nm = String(d.name || "").trim().slice(0, 40), ar = String(d.area || "").trim().slice(0, 30);
    if (nm.length < 2 || ar.length < 2) throw err("invalid-argument", "宿の名前と、温泉地か市町村を入れてください");
    const norm = placeKey(nm, ar), all = store.list("workplaces").filter((r) => !r.data.mergedInto);
    const same = all.find((r) => r.data.norm === norm);
    if (same) return { id: same.id, name: same.data.name, area: same.data.area, existed: true };
    if (!d.force) { const c = all.filter((r) => similarNorm(String(r.data.norm || ""), norm)).slice(0, 5).map((r) => ({ id: r.id, name: r.data.name, area: r.data.area })); if (c.length) return { candidates: c }; }
    const id = store.newId(); store.set(`workplaces/${id}`, { name: nm, area: ar, norm, mergedInto: "", adopted: false, createdBy: uid(), createdAt: Date.now() });
    return { id, name: nm, area: ar, existed: false };
  },
  async whoami() { return { role: "operator" }; },
  async noteAdminStats() { return buildStats(adminDb as never, Date.now()); },
  async noteAdminAdopt(d) { store.update(`workplaces/${d.id}`, { adopted: !!d.adopted, adoptedAt: Date.now() }); return { ok: true }; },
  async noteAdminMerge(d) {
    const from = String(d.from), to = String(d.to);
    store.update(`workplaces/${from}`, { mergedInto: to, mergedAt: Date.now() });
    const users = store.list("users").filter((r) => r.data.workplaceId === from), notes = store.group("notes").filter((r) => r.data.wid === from);
    users.forEach((r) => store.update(r.path, { workplaceId: to })); notes.forEach((r) => store.update(r.path, { wid: to }));
    return { ok: true, users: users.length, notes: notes.length };
  },
  async noteAdminNotes(d) {
    const target = String(d.uid), rows = store.list(`users/${target}/notes`).sort((a, b) => Number(b.data.createdAt) - Number(a.data.createdAt));
    store.set(`auditLogs/${store.newId()}`, { by: uid(), target, count: rows.length, at: Date.now() });
    return { notes: rows.map((r) => ({ id: r.id, heading: r.data.heading || "", dept: r.data.dept || "", title: r.data.title || "", text: r.data.text || "", steps: r.data.steps || [], photos: ((r.data.photos as unknown[]) || []).length, createdAt: r.data.createdAt || 0, wid: r.data.wid || "" })) };
  },
};
export const getFunctions = (..._a: unknown[]) => ({});
export const connectFunctionsEmulator = (..._a: unknown[]) => {};
export function httpsCallable<T, R>(_f: unknown, name: string, _o?: unknown) {
  return async (data: T): Promise<{ data: R }> => {
    const h = handlers[name]; if (!h) throw err("not-found", "見本版にはない機能です");
    return { data: (await h((data || {}) as Data)) as R };
  };
}
