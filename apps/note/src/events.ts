// 計測。何が使われているかを見るための記録。名前やメール、メモの中身は入れない。
import { addDoc, collection } from "firebase/firestore";
import { db } from "./fb";
import { S } from "./state";

export const DEVICE = /iPhone|iPad|iPod/.test(navigator.userAgent) ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "other";
export function track(type: string, meta: Record<string, string | number | boolean> = {}): void {
  if (!S.uid) return;
  addDoc(collection(db, "events"), { uid: S.uid, type, ts: Date.now(), wid: S.user?.workplaceId || "", dept: S.user?.dept || "", device: DEVICE, meta }).catch(() => {});
}
// 来た場所（SNSの投稿ごと）。最初に開いたときのURLから取り、登録のときに保存する
const UTM_KEY = "note-utm";
export function captureUtm(): void {
  const q = new URLSearchParams(location.search), s = q.get("utm_source");
  if (!s) return;
  const clean = (v: string | null) => (v || "").replace(/[^\w\-.]/g, "").slice(0, 60);
  try { if (!localStorage.getItem(UTM_KEY)) localStorage.setItem(UTM_KEY, JSON.stringify({ source: clean(s), medium: clean(q.get("utm_medium")), campaign: clean(q.get("utm_campaign")) })); } catch (e) { /* 保存できなくても続ける */ }
}
export function readUtm(): { source: string; medium: string; campaign: string } {
  try { const v = JSON.parse(localStorage.getItem(UTM_KEY) || "null"); if (v && typeof v.source === "string") return v; } catch (e) { /* なし */ }
  return { source: "", medium: "", campaign: "" };
}
