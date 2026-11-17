// 宿のはじめて帳（新人向け）。はじめに同意 → 職場と部署 → ノート、カード、PDF、わたし。
// #admin で開くと、運営者だけの管理者ページ（別に読み込む）。
import "./style.css";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "./fb";
import { copy } from "./config";
import { captureUtm, track } from "./events";
import { S, setRerender, watchUser } from "./state";
import { $, h, toast } from "./ui";
import { consentScreen } from "./screens/consent";
import { placeScreen } from "./screens/place";
import { notesScreen, editing } from "./screens/notes";
import { cardsScreen } from "./screens/cards";
import { pdfScreen } from "./screens/pdf";
import { finishEmailLink, loginSheet, meScreen } from "./screens/me";

captureUtm();
const main = $("#main")!, nav = $("#nav")!;
const TABS: [typeof S.tab, string, string][] = [["note", "帳", "ノート"], ["cards", "札", "カード"], ["pdf", "刷", "PDF"], ["me", "私", "わたし"]];
let lastKey = "", composing = false, pending = false, opened = false, adminMode = location.hash === "#admin";
addEventListener("compositionstart", () => { composing = true; }, true);
addEventListener("compositionend", () => { composing = false; if (pending) { pending = false; render(); } }, true);
addEventListener("hashchange", () => { adminMode = location.hash === "#admin"; render(); });

function body(): HTMLElement {
  if (!S.uid || !S.loaded) return h("div", { class: "view" }, h("p", { class: "empty center" }, "読み込んでいます…"));
  const u = S.user;
  if (!u || !u.consent || u.consent.version !== copy.consent.version)
    return h("div", null, consentScreen(), h("p", { class: "note center" }, h("button", { class: "link", id: "olduser", onclick: loginSheet }, "前に使っていた人は、こちらから入る")));
  if (!u.workplaceId || S.changingPlace) return placeScreen();
  if (!opened) { opened = true; track("open", {}); }
  return S.tab === "cards" ? cardsScreen() : S.tab === "pdf" ? pdfScreen() : S.tab === "me" ? meScreen() : notesScreen();
}
function render(): void {
  if (adminMode) { void import("./admin/admin").then((m) => m.renderAdmin(main, nav)); return; }
  if (composing) { pending = true; return; }
  const a = document.activeElement as HTMLInputElement | null, fid = a && main.contains(a) && a.id ? a.id : "";
  let sel: [number, number] | null = null; try { if (fid && typeof a!.selectionStart === "number") sel = [a!.selectionStart!, a!.selectionEnd!]; } catch (e) { /* なし */ }
  main.textContent = ""; main.appendChild(body());
  // 画面が変わったときだけ、入りの動きをつける（データが届いて描き直すたびに動かさない）
  const key = [S.uid ? 1 : 0, S.loaded ? 1 : 0, S.user?.consent ? 1 : 0, S.user?.workplaceId || "", S.changingPlace ? 1 : 0, S.tab, editing() ? 1 : 0].join("/");
  if (key !== lastKey) { lastKey = key; main.querySelector(".view")?.classList.add("enter"); }
  const ready = !!(S.user?.consent && S.user.workplaceId && !S.changingPlace);
  nav.hidden = !ready || editing();
  nav.textContent = "";
  if (ready) TABS.forEach(([id, ic, label]) => nav.appendChild(h("button", { "data-tab": id, "aria-current": S.tab === id ? "page" : null, onclick: () => { S.tab = id; render(); scrollTo(0, 0); } }, h("span", { class: "ic" }, ic), label)));
  if (fid) { const el = document.getElementById(fid) as HTMLInputElement | null; if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* なし */ } } }
}
setRerender(render);

onAuthStateChanged(auth, async (user) => {
  if (!user) { if (adminMode) { render(); return; } try { await signInAnonymously(auth); } catch (e) { toast("つながりません。電波のよい所で開き直してください。"); } return; }
  S.uid = user.uid; S.anonymous = user.isAnonymous; opened = false;
  if (!adminMode) watchUser(user.uid);
  render();
});
if (!adminMode) void finishEmailLink();   // 管理者ページのログインのリンクは、管理者ページの側で受け取る
render();
