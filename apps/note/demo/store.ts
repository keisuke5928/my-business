// 見本版のデータの置き場所。本番の Firestore の代わりに、この端末の中（localStorage）に置く。
// パスは本番と同じ形（users/<uid>/notes/<id> など）。書くたびに、見ている画面へ知らせる。
type Data = Record<string, unknown>;
const KEY = "note-demo-db";
let docs: Record<string, Data> = {};
try { docs = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { docs = {}; }
const listeners = new Set<() => void>();
let saveTimer = 0;

function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(docs)); } catch (e) { /* いっぱいのときは、この画面の間だけ残る */ } }, 50);
  queueMicrotask(() => listeners.forEach((f) => f()));
}
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const isObj = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v);
function deepMerge(a: Data, b: Data): Data { const out = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Data, v) : v; return out; }

export const store = {
  get: (path: string): Data | undefined => clone(docs[path]),
  set(path: string, data: Data, merge = false): void { docs[path] = clone(merge && docs[path] ? deepMerge(docs[path], data) : data); persist(); },
  update(path: string, patch: Data): void { if (!docs[path]) throw Object.assign(new Error("not-found"), { code: "not-found" }); docs[path] = clone({ ...docs[path], ...patch }); persist(); },
  delete(path: string): void { delete docs[path]; persist(); },
  // あるコレクションの直下の文書
  list(coll: string): { id: string; path: string; data: Data }[] {
    const depth = coll.split("/").length + 1;
    return Object.keys(docs).filter((p) => p.startsWith(coll + "/") && p.split("/").length === depth).map((p) => ({ id: p.split("/").pop()!, path: p, data: clone(docs[p]) }));
  },
  // どの深さでも、名前が同じコレクション（collectionGroup）
  group(name: string): { id: string; path: string; data: Data }[] {
    return Object.keys(docs).filter((p) => { const s = p.split("/"); return s.length % 2 === 0 && s[s.length - 2] === name; }).map((p) => ({ id: p.split("/").pop()!, path: p, data: clone(docs[p]) }));
  },
  subscribe(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); },
  newId: (): string => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""),
  // 見本版を最初に戻す
  reset(): void { docs = {}; try { Object.keys(localStorage).filter((k) => k.startsWith("note-")).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* なし */ } },
};
