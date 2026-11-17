// Firebase へのつなぎ。データは端末にも残すので、電波が弱い所でもメモを書いて見られる。
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

declare const __FB__: { config: Record<string, string>; emulator: { host: string; auth: number; firestore: number; functions: number; storage?: number } | null };

export const app = initializeApp(__FB__.config);
export const auth = getAuth(app);
export const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
export const fn = getFunctions(app, "asia-northeast1");
export const storage = getStorage(app);
if (__FB__.emulator) {
  const e = __FB__.emulator;
  connectAuthEmulator(auth, `http://${e.host}:${e.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, e.host, e.firestore);
  connectFunctionsEmulator(fn, e.host, e.functions);
  connectStorageEmulator(storage, e.host, e.storage || 9199);
}
export function call<T, R>(name: string, data: T): Promise<R> {
  return httpsCallable<T, R>(fn, name, { timeout: 70000 })(data).then((r) => r.data);
}
// サーバーの「上限に達した」を見分ける
export function isLimit(e: unknown): boolean {
  const x = e as { code?: string; message?: string; details?: { limit?: string } };
  return !!x && String(x.code || "").includes("resource-exhausted") && (!!(x.details && x.details.limit) || /\blimit\b/.test(String(x.message || "")));
}
