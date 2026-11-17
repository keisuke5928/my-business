// 上限に達したときのお知らせ。画面の下に小さく、閉じられる形で、1日1回だけ出す。
// 上限に達しても、メモを見る、手で書いて保存する、カードの練習、PDF出力は止めない。
import { copy } from "./config";
import { jstDay } from "./lib/dates";
import { track } from "./events";
import { notice } from "./ui";

const KEY = "note-limit-shown";
export function limitHit(kind: "ai" | "photos"): void {
  track("limit_hit", { kind });
  const key = `${KEY}-${kind}`, today = jstDay(Date.now());
  try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today); } catch (e) { /* 保存できなくても出す */ }
  notice(kind === "ai" ? copy.limitNotice : copy.photoLimitNotice, () => track("limit_dismiss", { kind }));
}
