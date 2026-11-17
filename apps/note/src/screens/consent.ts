// はじめる前の同意。チェックが入らないと使えない。同意の文、版、日時を保存する。
import { doc, setDoc } from "firebase/firestore";
import { db } from "../fb";
import { copy } from "../config";
import { DEVICE, readUtm, track } from "../events";
import { S } from "../state";
import { h, sheet, toast } from "../ui";

export function textSheet(title: string, body: string): void {
  sheet((close) => h("div", { class: "stack" }, h("h2", null, title), h("p", { class: "pre" }, body), h("button", { class: "btn ghost", onclick: close }, "閉じる")));
}
export function consentScreen(): HTMLElement {
  const c = copy.consent;
  const check = h("input", { type: "checkbox", id: "agree" });
  const start = h("button", { class: "btn", id: "start", disabled: true }, c.start);
  check.addEventListener("change", () => { start.disabled = !check.checked; });
  start.addEventListener("click", async () => {
    if (!check.checked) return;
    start.disabled = true;
    const now = Date.now(), again = !!S.user;
    try {
      await setDoc(doc(db, "users", S.uid), { createdAt: S.user?.createdAt || now, consent: { version: c.version, termsVersion: c.termsVersion, at: now, text: c.points.join("\n") },
        ...(again ? {} : { utm: readUtm(), device: DEVICE, linked: !S.anonymous }), lastAt: now }, { merge: true });
      if (!again) track("signup", readUtm());
      track("consent", { version: c.version });
    } catch (e) { toast("保存できませんでした。電波のよい所で、もう一度お試しください。"); start.disabled = false; }
  });
  return h("div", { class: "view" },
    h("section", { class: "card hero" }, h("span", { class: "label" }, "旅館・ホテルで働きはじめた人へ"), h("h1", null, copy.appName), h("p", null, copy.tagline)),
    h("section", { class: "card" }, h("h2", null, c.title),
      h("ol", { class: "plain" }, c.points.map((p) => h("li", null, p))),
      h("label", { class: "checkrow" }, check, h("span", null, c.check)),
      start,
      h("p", { class: "note" },
        h("button", { class: "link", onclick: () => textSheet(copy.terms.title, copy.terms.body) }, "利用規約"), " ・ ",
        h("button", { class: "link", onclick: () => textSheet(copy.privacy.title, copy.privacy.body) }, "プライバシーポリシー"))));
}
