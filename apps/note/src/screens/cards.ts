// 覚えるカード。メモからAIで作るか、手で足す。表と裏で練習し、覚えた・まだを残す。
// 上限に達しても、練習と手で足すことはできる。
import { addDoc, collection, deleteDoc, doc, updateDoc, writeBatch } from "firebase/firestore";
import { call, db, isLimit } from "../fb";
import { HEADINGS, headingName } from "../config";
import { track } from "../events";
import { limitHit } from "../limit";
import { S, myNotes, rerender, type Card } from "../state";
import { h, toast } from "../ui";

let idx = 0, show = false, filter = "notyet", busy = false, adding = false;
const KINDS: Record<string, string> = { word: "用語", menu: "お品書き", place: "館内の場所", order: "手順の順番" };
const mine = (): Card[] => S.cards.filter((c) => c.wid === (S.user?.workplaceId || "") && c.dept === (S.user?.dept || ""));

async function makeFromNotes(): Promise<void> {
  const notes = myNotes().filter((n) => ["words", "places", "steps", "flow", "here"].includes(n.heading));
  if (!notes.length) { toast("先に、用語や手順のメモを書いてください"); return; }
  const text = notes.slice(-15).map((n) => `【${headingName(n.heading)}】${n.title}\n${(n.steps?.length ? n.steps.join("\n") : n.text)}`).join("\n\n");
  busy = true; rerender();
  try {
    const r = await call<{ kind: string; text: string }, { cards: { front: string; back: string; kind: string }[] }>("noteAi", { kind: "cards", text });
    const have = new Set(mine().map((c) => c.front));
    const fresh = r.cards.filter((c) => !have.has(c.front));
    if (!fresh.length) toast("新しいカードはありませんでした");
    else {
      const b = writeBatch(db), now = Date.now();
      fresh.forEach((c, i) => b.set(doc(collection(db, "users", S.uid, "cards")), { front: c.front, back: c.back, kind: c.kind, heading: c.kind === "place" ? "places" : c.kind === "order" ? "steps" : "words",
        wid: S.user?.workplaceId || "", dept: S.user?.dept || "", known: null, practiced: 0, createdAt: now + i }));
      await b.commit(); track("card_make", { n: fresh.length, ai: true }); toast(`${fresh.length}枚のカードを作りました`); filter = "notyet"; idx = 0;
    }
  } catch (e) { if (isLimit(e)) limitHit("ai"); else toast("いまAIが使えません。カードは手で足せます。"); }
  busy = false; rerender();
}
async function mark(c: Card, known: boolean): Promise<void> {
  try { await updateDoc(doc(db, "users", S.uid, "cards", c.id), { known, practiced: (c.practiced || 0) + 1, lastAt: Date.now() }); } catch (e) { /* 端末に残り、つながったら送られる */ }
  track("card_practice", { known, kind: c.kind }); show = false; idx++; rerender();
}
function addForm(): HTMLElement {
  const f = h("input", { id: "cfront", placeholder: "表（例：リネン）", maxlength: 80 }) as HTMLInputElement;
  const bk = h("input", { id: "cback", placeholder: "裏（例：シーツやタオルのこと）", maxlength: 200 }) as HTMLInputElement;
  const kind = h("select", { id: "ckind" }, Object.entries(KINDS).map(([k, v]) => h("option", { value: k }, v))) as HTMLSelectElement;
  return h("section", { class: "card" }, h("h3", null, "カードを手で足す"), h("label", { class: "field" }, "表", f), h("label", { class: "field" }, "裏", bk), h("label", { class: "field" }, "種類", kind),
    h("div", { class: "row" }, h("button", { class: "btn small", id: "cadd", onclick: async () => {
      if (!f.value.trim() || !bk.value.trim()) { toast("表と裏を入れてください"); return; }
      await addDoc(collection(db, "users", S.uid, "cards"), { front: f.value.trim(), back: bk.value.trim(), kind: kind.value, heading: kind.value === "place" ? "places" : kind.value === "order" ? "steps" : "words",
        wid: S.user?.workplaceId || "", dept: S.user?.dept || "", known: null, practiced: 0, createdAt: Date.now() });
      track("card_make", { n: 1, ai: false }); adding = false; toast("足しました"); rerender(); } }, "足す"), h("button", { class: "btn ghost small", onclick: () => { adding = false; rerender(); } }, "やめる")));
}
export function cardsScreen(): HTMLElement {
  const all = mine(), pool = all.filter((c) => filter === "all" || c.known !== true), knownN = all.filter((c) => c.known === true).length;
  const c = pool.length ? pool[idx % pool.length] : null;
  return h("div", { class: "view" },
    h("section", { class: "card" }, h("span", { class: "label" }, `覚えた ${knownN} / ${all.length}`), h("h2", null, "覚えるカード"),
      h("div", { class: "seg", role: "group", "aria-label": "どのカード" },
        h("button", { "aria-pressed": String(filter === "notyet"), onclick: () => { filter = "notyet"; idx = 0; show = false; rerender(); } }, "まだのカード"),
        h("button", { "aria-pressed": String(filter === "all"), onclick: () => { filter = "all"; idx = 0; show = false; rerender(); } }, "すべて"))),
    c ? h("section", { class: "card flash", "aria-live": "polite" },
      h("span", { class: "label" }, KINDS[c.kind] || "カード"),
      h("button", { class: "fcard", id: "fcard", onclick: () => { show = !show; rerender(); } }, h("span", { class: "front" }, c.front), show ? h("span", { class: "back" }, c.back) : h("span", { class: "note" }, "思い出してから、押して答えを見る")),
      show ? h("div", { class: "actions" }, h("button", { class: "btn", id: "cknow", onclick: () => mark(c, true) }, "覚えた"), h("button", { class: "btn ghost", id: "cagain", onclick: () => mark(c, false) }, "まだ"))
        : h("div", { class: "actions" }, h("button", { class: "btn", id: "cshow", onclick: () => { show = true; rerender(); } }, "答えを見る")),
      h("button", { class: "link danger", onclick: async () => { await deleteDoc(doc(db, "users", S.uid, "cards", c.id)); rerender(); } }, "このカードを消す"))
      : h("section", { class: "card" }, h("p", { class: "empty" }, all.length ? "まだのカードはありません。全部覚えました。" : "まだカードがありません。メモから作るか、手で足してください。")),
    h("section", { class: "card" }, h("h3", null, "メモからカードを作る"), h("p", { class: "empty" }, `${HEADINGS.filter((x) => ["words", "places", "steps"].includes(x.id)).map((x) => x.name).join("、")}などのメモから、AIがカードを作ります。`),
      h("div", { class: "row" }, h("button", { class: "btn ghost", id: "cmake", disabled: busy || S.aiOff, onclick: makeFromNotes }, busy ? "作っています…" : "AIでカードを作る"),
        h("button", { class: "btn ghost", onclick: () => { adding = true; rerender(); } }, "手で足す"))),
    adding ? addForm() : null);
}
