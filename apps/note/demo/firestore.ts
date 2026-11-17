// 見本版：firebase/firestore の代わり。アプリが使っている関数だけを、同じ呼び方で用意する。
import { store } from "./store";

type Data = Record<string, unknown>;
interface DocRef { type: "doc"; path: string; id: string }
interface CollRef { type: "collection"; path: string }
interface Cons { kind: "where" | "orderBy" | "limit"; f?: string; op?: string; v?: unknown; dir?: string; n?: number }
interface Query { type: "query"; path: string; cons: Cons[] }
type Target = DocRef | CollRef | Query;

const join = (segs: string[]) => segs.join("/").replace(/\/+/g, "/");
export const initializeFirestore = (..._a: unknown[]) => ({ demo: true });
export const persistentLocalCache = (..._a: unknown[]) => ({});
export const persistentMultipleTabManager = (..._a: unknown[]) => ({});
export const connectFirestoreEmulator = (..._a: unknown[]) => {};

export function collection(_db: unknown, ...segs: string[]): CollRef {
  const base = (_db as { type?: string; path?: string })?.type ? [(_db as { path: string }).path] : [];
  return { type: "collection", path: join([...base, ...segs]) };
}
export function doc(parent: unknown, ...segs: string[]): DocRef {
  const p = parent as { type?: string; path?: string };
  const path = p && p.type === "collection" ? join([p.path!, segs[0] || store.newId()]) : join(segs);
  return { type: "doc", path, id: path.split("/").pop()! };
}
export const where = (f: string, op: string, v: unknown): Cons => ({ kind: "where", f, op, v });
export const orderBy = (f: string, dir = "asc"): Cons => ({ kind: "orderBy", f, dir });
export const limit = (n: number): Cons => ({ kind: "limit", n });
export const query = (c: CollRef | Query, ...cons: Cons[]): Query => ({ type: "query", path: c.path, cons: [...(c.type === "query" ? c.cons : []), ...cons] });

function docSnap(path: string) {
  const data = store.get(path);
  return { id: path.split("/").pop()!, ref: { type: "doc", path, id: path.split("/").pop()! }, exists: () => data !== undefined, data: () => data, get: (f: string) => data?.[f] };
}
function run(q: CollRef | Query) {
  let rows = store.list(q.path);
  const cons = q.type === "query" ? q.cons : [];
  for (const c of cons) {
    if (c.kind === "where") rows = rows.filter((r) => { const x = r.data[c.f!] ?? ""; return c.op === "==" ? x === c.v : c.op === ">=" ? (x as number) >= (c.v as number) : c.op === "<=" ? (x as number) <= (c.v as number) : true; });
    if (c.kind === "orderBy") rows.sort((a, b) => { const x = a.data[c.f!] as number, y = b.data[c.f!] as number; return (x > y ? 1 : x < y ? -1 : 0) * (c.dir === "desc" ? -1 : 1); });
    if (c.kind === "limit") rows = rows.slice(0, c.n);
  }
  const docs = rows.map((r) => docSnap(r.path));
  return { docs, size: docs.length, empty: !docs.length, forEach: (f: (d: ReturnType<typeof docSnap>) => void) => docs.forEach(f) };
}
export const getDoc = async (r: DocRef) => docSnap(r.path);
export const getDocs = async (q: CollRef | Query) => run(q);
export function onSnapshot(t: Target, next: (s: never) => void, _err?: unknown): () => void {
  const fire = () => next((t.type === "doc" ? docSnap(t.path) : run(t)) as never);
  queueMicrotask(fire);
  return store.subscribe(fire);
}
export async function setDoc(r: DocRef, data: Data, opts?: { merge?: boolean }): Promise<void> { store.set(r.path, data, !!opts?.merge); }
export async function updateDoc(r: DocRef, patch: Data): Promise<void> { store.update(r.path, patch); }
export async function addDoc(c: CollRef, data: Data): Promise<DocRef> { const r = doc(c); store.set(r.path, data); return r; }
export async function deleteDoc(r: DocRef): Promise<void> { store.delete(r.path); }
export function writeBatch(_db: unknown) {
  const ops: (() => void)[] = [];
  return { set(r: DocRef, d: Data, o?: { merge?: boolean }) { ops.push(() => store.set(r.path, d, !!o?.merge)); }, update(r: DocRef, d: Data) { ops.push(() => store.update(r.path, d)); }, delete(r: DocRef) { ops.push(() => store.delete(r.path)); },
    async commit() { ops.forEach((f) => f()); } };
}
