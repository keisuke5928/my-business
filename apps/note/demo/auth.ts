// 見本版：firebase/auth の代わり。この端末の中で、名前のない利用者を1人作る。
// 見本版では、アカウントの紐づけとメールのログインはできない（本番だけ）。
interface User { uid: string; isAnonymous: boolean; getIdToken: (f?: boolean) => Promise<string>; getIdTokenResult: () => Promise<{ claims: Record<string, unknown> }> }
const KEY = "note-demo-uid";
const auth: { currentUser: User | null; onAuthStateChanged: (cb: (u: User | null) => void) => () => void } = { currentUser: null, onAuthStateChanged: (cb) => onAuthStateChanged(auth, cb) };
const subs = new Set<(u: User | null) => void>();
const mk = (uid: string): User => ({ uid, isAnonymous: true, getIdToken: async () => "demo", getIdTokenResult: async () => ({ claims: {} }) });
try { const u = localStorage.getItem(KEY); if (u) auth.currentUser = mk(u); } catch (e) { /* なし */ }

const notInDemo = () => Promise.reject(Object.assign(new Error("見本版ではできません"), { code: "auth/demo" }));
export const getAuth = (..._a: unknown[]) => auth;
export const connectAuthEmulator = (..._a: unknown[]) => {};
export function onAuthStateChanged(_a: unknown, cb: (u: User | null) => void): () => void { subs.add(cb); queueMicrotask(() => cb(auth.currentUser)); return () => subs.delete(cb); }
export async function signInAnonymously(_a: unknown) {
  const uid = "demo" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");
  try { localStorage.setItem(KEY, uid); } catch (e) { /* なし */ }
  auth.currentUser = mk(uid); subs.forEach((f) => f(auth.currentUser)); return { user: auth.currentUser };
}
export async function signOut(_a: unknown) { /* 見本版では、利用者を消さない */ }
export class GoogleAuthProvider {}
export const EmailAuthProvider = { credentialWithLink: (..._a: unknown[]) => ({}) };
export const isSignInWithEmailLink = (..._a: unknown[]) => false;
export const linkWithPopup = (..._a: unknown[]) => notInDemo();
export const linkWithCredential = (..._a: unknown[]) => notInDemo();
export const signInWithPopup = (..._a: unknown[]) => notInDemo();
export const sendSignInLinkToEmail = (..._a: unknown[]) => notInDemo();
export const signInWithEmailLink = (..._a: unknown[]) => notInDemo();
