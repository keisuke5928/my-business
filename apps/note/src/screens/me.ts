// わたし：アカウントの紐づけ（機種を変えても続けられる）、職場の変更、同意した内容、規約。
import { EmailAuthProvider, GoogleAuthProvider, isSignInWithEmailLink, linkWithCredential, linkWithPopup, sendSignInLinkToEmail, signInWithEmailLink, signInWithPopup } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../fb";
import { copy, deptName } from "../config";
import { track } from "../events";
import { S, rerender } from "../state";
import { fmtDate, h, sheet, toast } from "../ui";
import { textSheet } from "./consent";
import { resetPlace } from "./place";

const MAIL_KEY = "note-link-mail", MODE_KEY = "note-link-mode";
const here = () => location.origin + location.pathname;

async function markLinked(): Promise<void> {
  try { await setDoc(doc(db, "users", S.uid), { linked: true }, { merge: true }); } catch (e) { /* 次に開いたときに直る */ }
  track("account_link", {}); S.anonymous = false; toast("紐づけました。ほかのスマホでも、同じ方法で入れば続きから使えます。"); rerender();
}
function linkErr(e: unknown): void {
  const c = (e as { code?: string }).code || "";
  if (c.includes("credential-already-in-use") || c.includes("email-already-in-use")) toast("このアカウントは、もう別のデータに紐づいています。「前に使っていた人」から入ってください。");
  else if (c.includes("popup")) toast("画面が開けませんでした。もう一度お試しください。");
  else toast("紐づけられませんでした");
}
export async function linkGoogle(): Promise<void> { try { await linkWithPopup(auth.currentUser!, new GoogleAuthProvider()); await markLinked(); } catch (e) { linkErr(e); } }
export async function signInGoogle(): Promise<void> { try { await signInWithPopup(auth, new GoogleAuthProvider()); toast("入りました"); } catch (e) { linkErr(e); } }
async function sendMail(mail: string, mode: "link" | "signin"): Promise<void> {
  try {
    await sendSignInLinkToEmail(auth, mail, { url: here(), handleCodeInApp: true });
    try { localStorage.setItem(MAIL_KEY, mail); localStorage.setItem(MODE_KEY, mode); } catch (e) { /* なし */ }
    toast("メールを送りました。届いたリンクを、このスマホで開いてください。");
  } catch (e) { toast("メールを送れませんでした"); }
}
// メールのリンクから戻ってきたとき
export async function finishEmailLink(): Promise<void> {
  if (!isSignInWithEmailLink(auth, location.href)) return;
  let mail = "", mode = "link"; try { mail = localStorage.getItem(MAIL_KEY) || ""; mode = localStorage.getItem(MODE_KEY) || "link"; } catch (e) { /* なし */ }
  history.replaceState(null, "", here() + location.hash);
  if (!mail) { toast("メールを送ったのと同じスマホで、リンクを開いてください"); return; }
  try {
    if (mode === "link" && auth.currentUser) { await linkWithCredential(auth.currentUser, EmailAuthProvider.credentialWithLink(mail, location.href)); await markLinked(); }
    else { await signInWithEmailLink(auth, mail, location.href); toast("入りました"); }
  } catch (e) { linkErr(e); }
  try { localStorage.removeItem(MAIL_KEY); localStorage.removeItem(MODE_KEY); } catch (e) { /* なし */ }
}
export function mailSheet(mode: "link" | "signin"): void {
  sheet((close) => { const m = h("input", { type: "email", id: "lmail", autocomplete: "email", placeholder: "例：name@example.com" }) as HTMLInputElement;
    return h("div", { class: "stack" }, h("h2", null, mode === "link" ? "メールで紐づける" : "メールで入る"), h("p", null, "ログインのリンクをメールで送ります。パスワードはいりません。"),
      h("label", { class: "field" }, "メールアドレス", m), h("button", { class: "btn", onclick: async () => { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.value.trim())) { toast("メールアドレスを確かめてください"); return; } await sendMail(m.value.trim(), mode); close(); } }, "リンクを送る"),
      h("button", { class: "btn ghost", onclick: close }, "やめる")); });
}
export function loginSheet(): void {
  sheet((close) => h("div", { class: "stack" }, h("h2", null, "前に使っていた人"), h("p", null, "前に紐づけた方法で入ると、続きから使えます。"),
    h("button", { class: "btn ghost", onclick: async () => { close(); await signInGoogle(); } }, "Googleで入る"),
    h("button", { class: "btn ghost", onclick: () => { close(); mailSheet("signin"); } }, "メールで入る"),
    h("button", { class: "link", onclick: close }, "やめる")));
}
export function meScreen(): HTMLElement {
  const u = S.user!;
  return h("div", { class: "view" },
    h("section", { class: "card" }, h("span", { class: "label" }, "職場"), h("h2", null, S.place?.name || "未選択"),
      h("p", { class: "empty" }, `${S.place?.area || ""} ・ ${deptName(u.dept || "")}`),
      h("button", { class: "btn ghost small", id: "chgplace", onclick: () => { S.changingPlace = true; resetPlace(); rerender(); scrollTo(0, 0); } }, "職場や部署を変える"),
      (u.places || []).length > 1 ? h("p", { class: "note" }, "前の職場のメモも、職場を選び直すと見られます。") : null),
    h("section", { class: "card" }, h("span", { class: "label" }, "機種を変えても続けるために"), h("h2", null, S.anonymous ? "アカウントを紐づける" : "紐づけ済みです"),
      __DEMO__ ? h("p", { class: "empty" }, "見本版では、紐づけはできません。本番では、Googleかメールで紐づけると、スマホを変えてもメモやカードが残ります。")
      : S.anonymous ? [h("p", { class: "empty" }, "いまは、このスマホの中だけで使っています。紐づけると、スマホを変えても、メモやカードが残ります。"),
        h("div", { class: "row" }, h("button", { class: "btn ghost small", id: "lgoogle", onclick: linkGoogle }, "Googleで紐づける"), h("button", { class: "btn ghost small", id: "lmailbtn", onclick: () => mailSheet("link") }, "メールで紐づける"))]
        : h("p", { class: "empty" }, "ほかのスマホでも、同じ方法で入れば続きから使えます。")),
    h("section", { class: "card" }, h("span", { class: "label" }, "同意した内容"), h("ol", { class: "plain" }, copy.consent.points.map((p) => h("li", null, p))),
      h("p", { class: "note" }, `${fmtDate(u.consent?.at || 0)}に同意しました（版 ${u.consent?.version || ""}）`),
      h("p", { class: "note" }, h("button", { class: "link", onclick: () => textSheet(copy.terms.title, copy.terms.body) }, "利用規約"), " ・ ", h("button", { class: "link", onclick: () => textSheet(copy.privacy.title, copy.privacy.body) }, "プライバシーポリシー"))),
    h("section", { class: "card" }, h("span", { class: "label" }, "書かないでください"), h("ol", { class: "plain" }, copy.forbidden.items.map((x) => h("li", null, x)))));
}
