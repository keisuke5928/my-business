// マニュアル（ノート）。部署ごとの見出しの骨組みに、メモをためていく。
// メモは文字と写真。AIで見出しに振り分け、手順の形に整える。本人は結果を直せる。
// 保存の前に、お客様の名前や番号らしきものを探し、見つけたら「消しますか」と聞く。
import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { call, db, isLimit, storage } from "../fb";
import { copy, deptName, HEADINGS, headingName, limits } from "../config";
import { dangerKind } from "../lib/danger";
import { findPii, removePii, type PiiHit } from "../lib/pii";
import { track } from "../events";
import { limitHit } from "../limit";
import { S, myNotes, rerender, type Note } from "../state";
import { fmtDate, h, sheet, toast } from "../ui";

interface Organized { refuse?: boolean; heading: string; title: string; steps: string[]; tags: string[]; pii: string[]; }
interface Draft { id: string | null; heading: string; text: string; title: string; steps: string[]; tags: string[]; photos: string[]; photoBytes: number; ai: Organized | null; aiPii: string[]; busy: boolean; refused: boolean; }

let open: string | null = null;      // 開いている見出し
let draft: Draft | null = null;      // 書いているメモ
export const editing = (): boolean => !!draft;

function newDraft(heading: string, n?: Note): Draft {
  return n ? { id: n.id, heading: n.heading, text: n.text, title: n.title, steps: [...(n.steps || [])], tags: n.tags || [], photos: [...(n.photos || [])], photoBytes: n.photoBytes || 0, ai: null, aiPii: [], busy: false, refused: false }
    : { id: null, heading, text: "", title: "", steps: [], tags: [], photos: [], photoBytes: 0, ai: null, aiPii: [], busy: false, refused: false };
}

// ---------- 写真（スマホの中で縮めてから送る） ----------
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url; });
    const k = Math.min(1, limits.photoMaxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, ng) => c.toBlob((b) => (b ? ok(b) : ng(new Error("photo"))), "image/jpeg", limits.photoQuality));
  } finally { URL.revokeObjectURL(url); }
}
async function addPhoto(file: File): Promise<void> {
  if (!draft) return;
  let slot: { id: string; path: string };
  try { slot = await call<object, { id: string; path: string }>("notePhotoSlot", {}); }
  catch (e) { if (isLimit(e)) { limitHit("photos"); return; } toast("写真を送れませんでした。電波のよい所でお試しください。"); return; }
  try {
    const blob = await shrink(file);
    if (blob.size > limits.photoMaxBytes) { toast("写真が大きすぎます"); return; }
    await uploadBytes(ref(storage, slot.path), blob, { contentType: "image/jpeg" });
    draft.photos.push(slot.path); draft.photoBytes += blob.size; rerender();
  } catch (e) { toast("写真を送れませんでした"); }
}
const urlCache = new Map<string, string>();
function photoImg(path: string): HTMLElement {
  const img = h("img", { class: "thumb", alt: "メモの写真", loading: "lazy" });
  const have = urlCache.get(path);
  if (have) img.src = have; else getDownloadURL(ref(storage, path)).then((u) => { urlCache.set(path, u); img.src = u; }).catch(() => {});
  return img;
}

// ---------- AIで整える ----------
async function organize(): Promise<void> {
  const d = draft; if (!d || !d.text.trim()) { toast("先にメモを書いてください"); return; }
  if (dangerKind(d.text)) { d.refused = true; track("ai_refuse", { where: "client" }); rerender(); return; }
  d.busy = true; rerender();
  try {
    const r = await call<{ kind: string; text: string }, Organized>("noteAi", { kind: "organize", text: d.text });
    if (r.refuse) { d.refused = true; track("ai_refuse", { where: "server" }); }
    else { d.ai = r; d.heading = r.heading; d.title = r.title; d.steps = [...r.steps]; d.tags = r.tags; d.aiPii = r.pii || []; track("ai_organize", { heading: r.heading }); }
  } catch (e) {
    if (isLimit(e)) limitHit("ai");
    else { S.aiOff = true; toast("いまAIが使えません。このまま手で保存できます。"); }
  }
  d.busy = false; rerender();
}

// ---------- 保存（書いてはいけないものを先に確かめる） ----------
function allPii(d: Draft): PiiHit[] {
  const t = [d.text, d.title, ...d.steps].join("\n"), hits = findPii(t);
  for (const s of d.aiPii) { const i = t.indexOf(s); if (s && i >= 0 && !hits.some((x) => x.match === s)) hits.push({ kind: "name", match: s, index: i }); }
  return hits;
}
function scrub(d: Draft, hits: PiiHit[]): void {
  const fix = (s: string) => { const own = findPii(s).concat(hits.filter((x) => s.includes(x.match)).map((x) => ({ ...x, index: s.indexOf(x.match) }))); const uniq = own.filter((x, i) => own.findIndex((y) => y.index === x.index) === i); return removePii(s, uniq); };
  d.text = fix(d.text); d.title = fix(d.title); d.steps = d.steps.map(fix);
}
async function save(skipCheck = false): Promise<void> {
  const d = draft; if (!d) return;
  if (!d.text.trim() && !d.steps.length && !d.photos.length) { toast("メモが空です"); return; }
  if (d.text.length > limits.noteMaxChars) { toast(`メモは${limits.noteMaxChars}字までです`); return; }
  if (!skipCheck) {
    const hits = allPii(d);
    if (hits.length) {
      track("pii_found", { n: hits.length });
      sheet((close) => h("div", { class: "stack", id: "piisheet" },
        h("h2", null, "消しますか"),
        h("p", null, "お客様の名前や番号のようなものがあります。書いてはいけないものは、消してから保存してください。"),
        h("ol", { class: "plain" }, hits.map((x) => h("li", null, h("b", null, x.match), h("span", { class: "sub" }, x.kind === "name" ? "　名前のようです" : x.kind === "room" ? "　部屋番号のようです" : x.kind === "phone" ? "　電話番号のようです" : x.kind === "email" ? "　メールアドレスのようです" : "　暗証番号のようです")))),
        h("button", { class: "btn", id: "piidel", onclick: () => { close(); scrub(d, hits); track("pii_removed", { n: hits.length }); void save(true); } }, "消して保存する"),
        h("button", { class: "btn ghost", id: "piikeep", onclick: () => { close(); void save(true); } }, "仕事のことなので、そのまま保存する")));
      return;
    }
  }
  const edited = !!d.ai && (d.ai.heading !== d.heading || d.ai.title !== d.title || d.ai.steps.join("\n") !== d.steps.join("\n"));
  const now = Date.now();
  const data = { wid: S.user?.workplaceId || "", dept: S.user?.dept || "", heading: d.heading, title: d.title.slice(0, 60), text: d.text, steps: d.steps.filter((s) => s.trim()).slice(0, 40),
    tags: d.tags, photos: d.photos, photoBytes: d.photoBytes, updatedAt: now };
  try {
    if (d.id) {
      const prev = S.notes.find((n) => n.id === d.id);
      await updateDoc(doc(db, "users", S.uid, "notes", d.id), { ...data, ai: !!(prev?.ai || d.ai), aiEdited: !!(prev?.aiEdited || edited) });
    } else {
      await addDoc(collection(db, "users", S.uid, "notes"), { ...data, ai: !!d.ai, aiEdited: edited, createdAt: now });
    }
    track("note_save", { heading: d.heading, photo: d.photos.length > 0, ai: !!d.ai, edit: !!d.id });
    if (edited) track("ai_edit", { heading: d.heading });
    open = d.heading; draft = null; toast("保存しました"); rerender();
  } catch (e) { toast("保存できませんでした"); }
}

// ---------- 画面 ----------
function forbiddenBox(): HTMLElement {
  return h("details", { class: "forbid" }, h("summary", null, copy.forbidden.title), h("ol", { class: "plain" }, copy.forbidden.items.map((x) => h("li", null, x))));
}
function editor(): HTMLElement {
  const d = draft!, hd = HEADINGS.find((x) => x.id === d.heading) || HEADINGS[1];
  const example = (hd.examples as Record<string, string>)[S.user?.dept || "other"] || (hd.examples as Record<string, string>).other;
  const ta = h("textarea", { id: "ntext", rows: 7, placeholder: `例：${example}`, maxlength: limits.noteMaxChars }) as HTMLTextAreaElement;
  ta.value = d.text; ta.addEventListener("input", () => { d.text = ta.value; d.refused = false; });
  const file = h("input", { type: "file", accept: "image/*", id: "nphoto", class: "hidden", onchange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) await addPhoto(f); } });
  const result = d.ai ? h("section", { class: "card ai" },
    h("span", { class: "label" }, "AIで整えた形（直せます）"),
    h("label", { class: "field" }, "見出し", h("select", { id: "nhead", onchange: (e: Event) => { d.heading = (e.target as HTMLSelectElement).value; } }, HEADINGS.map((x) => h("option", { value: x.id, selected: x.id === d.heading }, x.name)))),
    h("label", { class: "field" }, "題", h("input", { id: "ntitle", value: d.title, maxlength: 60, oninput: (e: Event) => { d.title = (e.target as HTMLInputElement).value; } })),
    h("label", { class: "field" }, "手順（1行に1つ）", (() => { const t = h("textarea", { id: "nsteps", rows: Math.max(4, d.steps.length + 1) }) as HTMLTextAreaElement; t.value = d.steps.join("\n"); t.addEventListener("input", () => { d.steps = t.value.split("\n"); }); return t; })())) : null;
  return h("div", { class: "view", id: "editor" },
    h("button", { class: "back", onclick: () => { draft = null; rerender(); } }, "← もどる"),
    h("section", { class: "card" },
      h("span", { class: "label" }, `${deptName(S.user?.dept || "")} ・ ${hd.name}`),
      h("h2", null, d.id ? "メモを直す" : "メモを書く"),
      h("p", { class: "empty" }, hd.hint),
      ta,
      d.photos.length ? h("div", { class: "thumbs" }, d.photos.map((p) => h("div", { class: "tw" }, photoImg(p), h("button", { class: "x", "aria-label": "写真を外す", onclick: () => { d.photos = d.photos.filter((x) => x !== p); rerender(); } }, "×")))) : null,
      h("div", { class: "row" }, h("button", { class: "btn ghost small", onclick: () => file.click() }, "写真を足す"), file),
      forbiddenBox()),
    d.refused ? h("section", { class: "card refuse", role: "status" }, h("b", null, copy.refuse), h("p", { class: "note" }, "メモは、このまま手で保存できます。")) : null,
    result,
    h("div", { class: "actions" },
      h("button", { class: "btn ghost", id: "nai", disabled: d.busy || S.aiOff, onclick: organize }, d.busy ? "整えています…" : d.ai ? "もう一度AIで整える" : "AIで整える"),
      h("button", { class: "btn", id: "nsave", disabled: d.busy, onclick: () => save() }, "保存する")),
    S.aiOff ? h("p", { class: "note" }, "いまAIが使えません。メモを書く、見る、保存する、PDFにするは、そのまま使えます。") : null,
    d.id ? h("button", { class: "link danger", onclick: () => sheet((close) => h("div", { class: "stack" }, h("h2", null, "このメモを消しますか"), h("p", null, "消すと、元に戻せません。"),
      h("button", { class: "btn", onclick: async () => { close(); try { await deleteDoc(doc(db, "users", S.uid, "notes", d.id!)); draft = null; toast("消しました"); rerender(); } catch (e) { toast("消せませんでした"); } } }, "消す"),
      h("button", { class: "btn ghost", onclick: close }, "やめる"))) }, "このメモを消す") : null);
}
function noteCard(n: Note): HTMLElement {
  return h("button", { class: "note", "data-note": n.id, onclick: () => { draft = newDraft(n.heading, n); rerender(); scrollTo(0, 0); } },
    h("b", null, n.title || n.text.split("\n")[0].slice(0, 30) || "（写真のメモ）"),
    n.steps?.length ? h("ol", { class: "steps" }, n.steps.slice(0, 4).map((s) => h("li", null, s))) : h("p", { class: "sub clamp" }, n.text),
    h("span", { class: "meta" }, fmtDate(n.updatedAt || n.createdAt), n.photos?.length ? ` ・ 写真${n.photos.length}` : "", n.ai ? " ・ AIで整えた" : ""));
}
export function notesScreen(): HTMLElement {
  if (draft) return editor();
  const notes = myNotes();
  return h("div", { class: "view" },
    h("section", { class: "card hero" },
      h("span", { class: "label" }, `${S.place?.name || ""} ・ ${deptName(S.user?.dept || "")}`),
      h("h2", null, "わたしのマニュアル"),
      h("p", null, notes.length ? `メモ ${notes.length}件` : "教わったことを、見出しごとにメモしていきます。"),
      h("button", { class: "btn light", id: "quick", onclick: () => { draft = newDraft("steps"); rerender(); scrollTo(0, 0); } }, "メモを書く")),
    h("div", { class: "heads" }, HEADINGS.map((hd) => {
      const list = notes.filter((n) => n.heading === hd.id), isOpen = open === hd.id;
      return h("section", { class: `card head${isOpen ? " open" : ""}`, "data-head": hd.id },
        h("button", { class: "headbtn", "aria-expanded": String(isOpen), onclick: () => { open = isOpen ? null : hd.id; rerender(); } },
          h("span", { class: "hn" }, hd.name), h("span", { class: "count" }, list.length ? `${list.length}件` : "まだ")),
        isOpen ? h("div", { class: "stack" },
          list.length ? list.map(noteCard) : h("p", { class: "empty" }, `${hd.hint} 例：${(hd.examples as Record<string, string>)[S.user?.dept || "other"] || ""}`),
          h("button", { class: "btn ghost small", "data-write": hd.id, onclick: () => { draft = newDraft(hd.id); rerender(); scrollTo(0, 0); } }, "この見出しに書く")) : null);
    })),
    forbiddenBox());
}
export { headingName };
