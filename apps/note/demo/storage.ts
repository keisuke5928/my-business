// 見本版：firebase/storage の代わり。写真は、縮めたものをこの端末の中に置く。
const P = "note-demo-photo:";
const mem = new Map<string, string>();
export const getStorage = (..._a: unknown[]) => ({});
export const connectStorageEmulator = (..._a: unknown[]) => {};
export const ref = (_s: unknown, path: string) => ({ path });
export async function uploadBytes(r: { path: string }, blob: Blob, _m?: unknown) {
  const url = await new Promise<string>((ok, ng) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = ng; fr.readAsDataURL(blob); });
  mem.set(r.path, url);
  try { localStorage.setItem(P + r.path, url); } catch (e) { /* いっぱいのときは、この画面の間だけ残る */ }
  return { ref: r };
}
export async function getDownloadURL(r: { path: string }): Promise<string> {
  const url = mem.get(r.path) || (() => { try { return localStorage.getItem(P + r.path) || ""; } catch (e) { return ""; } })();
  if (!url) throw new Error("写真が見つかりません");
  return url;
}
