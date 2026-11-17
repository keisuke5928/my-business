// 職場と部署を選ぶ。同じ宿が別々に登録されないように、似た名前の候補を先に出す。
import { collection, doc, getDocs, limit, query, setDoc, where } from "firebase/firestore";
import { call, db } from "../fb";
import { DEPTS } from "../config";
import { normName, similarNorm } from "../lib/normalize";
import { track } from "../events";
import { S, rerender, type Place } from "../state";
import { h, sheet, toast } from "../ui";

let all: Place[] | null = null, picked: Place | null = null, q = "", area = "", dept = "";
async function load(): Promise<void> {
  try { const s = await getDocs(query(collection(db, "workplaces"), where("mergedInto", "==", ""), limit(500))); all = s.docs.map((d) => ({ ...(d.data() as Omit<Place, "id">), id: d.id })); }
  catch (e) { all = []; }
  rerender();
}
export function resetPlace(): void { picked = null; q = ""; area = ""; dept = S.user?.dept || ""; all = null; }

async function choose(p: Place, d: string): Promise<void> {
  const now = Date.now(), prev = S.user?.places || [];
  await setDoc(doc(db, "users", S.uid), { workplaceId: p.id, dept: d, places: [...prev.filter((x) => !(x.id === p.id && x.dept === d)), { id: p.id, dept: d, from: now }].slice(-20), lastAt: now }, { merge: true });
  track("place_select", { existed: true }); track("dept_select", { dept: d });
  S.changingPlace = false; resetPlace();
}

interface AddResult { id?: string; name?: string; area?: string; existed?: boolean; candidates?: { id: string; name: string; area: string }[]; }
async function addPlace(force: boolean): Promise<void> {
  try {
    const r = await call<{ name: string; area: string; force: boolean }, AddResult>("noteWorkplaceAdd", { name: q.trim(), area: area.trim(), force });
    if (r.candidates) {
      const cands = r.candidates;
      sheet((close) => h("div", { class: "stack", id: "samesheet" }, h("h2", null, "この宿ではありませんか"), h("p", null, "似た名前の宿が、もう登録されています。同じ宿なら選んでください。"),
        cands.map((c) => h("button", { class: "rowbtn", "data-same": c.id, onclick: () => { close(); picked = { id: c.id, name: c.name, area: c.area, norm: normName(c.name), mergedInto: "", adopted: false }; rerender(); } }, h("b", null, c.name), h("span", { class: "sub" }, c.area))),
        h("button", { class: "btn ghost", id: "notsame", onclick: () => { close(); void addPlace(true); } }, "ちがう宿として足す")));
      return;
    }
    picked = { id: r.id || "", name: r.name || "", area: r.area || "", norm: normName(r.name || ""), mergedInto: "", adopted: false };
    if (r.existed) toast("同じ宿が見つかったので、そちらを選びました");
    rerender();
  } catch (e) { toast((e as Error).message || "足せませんでした"); }
}
export function placeScreen(): HTMLElement {
  if (all === null) { void load(); return h("div", { class: "view" }, h("p", { class: "empty" }, "読み込んでいます…")); }
  const nq = normName(q);
  const cands = nq.length >= 1 ? all.filter((p) => similarNorm(p.norm, nq) || p.norm.includes(nq) || normName(p.area).includes(nq)).slice(0, 6) : [];
  const list = h("div", { class: "list", id: "cands" });
  const draw = () => {
    list.textContent = "";
    const n = normName(q), c = n.length >= 1 ? all!.filter((p) => similarNorm(p.norm, n) || p.norm.includes(n)).slice(0, 6) : [];
    c.forEach((p) => list.append(h("button", { class: "rowbtn", "data-place": p.id, onclick: () => { picked = p; rerender(); } }, h("b", null, p.name), h("span", { class: "sub" }, p.area))));
    if (n.length >= 2) list.append(h("p", { class: "note" }, c.length ? "同じ宿があれば、上から選んでください。なければ、下で足せます。" : "まだ登録がありません。下で足せます。"));
  };
  const nameIn = h("input", { id: "pname", placeholder: "例：みずなら亭", autocomplete: "off", value: q, oninput: (e: Event) => { q = (e.target as HTMLInputElement).value; draw(); } });
  const areaIn = h("input", { id: "parea", placeholder: "例：宇奈月温泉、黒部市", autocomplete: "off", value: area, oninput: (e: Event) => { area = (e.target as HTMLInputElement).value; } });
  const deptPick = h("div", { class: "chips", role: "group", "aria-label": "部署" }, DEPTS.map((d) => h("button", { "data-dept": d.id, "aria-pressed": String(dept === d.id), onclick: () => { dept = d.id; rerender(); } }, d.name)));
  const addBtn = h("button", { class: "btn ghost", id: "padd", onclick: async () => {
    if (normName(q).length < 2 || area.trim().length < 2) { toast("宿の名前と、温泉地か市町村を入れてください"); return; }
    addBtn.disabled = true;
    await addPlace(false); addBtn.disabled = false;
  } }, "この宿を足す");
  void cands;
  const view = h("div", { class: "view" },
    h("section", { class: "card" }, h("span", { class: "label" }, S.user?.workplaceId ? "職場が変わったとき" : "はじめに"), h("h2", null, "働いている宿と、部署を選ぶ"),
      h("p", { class: "empty" }, "前の職場のメモは、そのまま手元に残ります。")),
    picked
      ? h("section", { class: "card" }, h("span", { class: "label" }, "宿"), h("h3", null, picked.name), h("p", { class: "empty" }, picked.area), h("button", { class: "link", onclick: () => { picked = null; rerender(); } }, "ほかの宿にする"))
      : h("section", { class: "card" }, h("label", { class: "field" }, "宿の名前", nameIn), list, h("label", { class: "field" }, "温泉地、または市町村", areaIn), addBtn),
    h("section", { class: "card" }, h("span", { class: "label" }, "部署"), deptPick),
    h("button", { class: "btn", id: "pgo", disabled: !(picked && dept), onclick: async (e: Event) => { (e.target as HTMLButtonElement).disabled = true; try { await choose(picked!, dept); } catch (err) { toast("保存できませんでした"); (e.target as HTMLButtonElement).disabled = false; } } }, "これで始める"),
    S.user?.workplaceId ? h("button", { class: "link", onclick: () => { S.changingPlace = false; resetPlace(); rerender(); } }, "やめる") : null);
  queueMicrotask(draw);
  return view;
}
