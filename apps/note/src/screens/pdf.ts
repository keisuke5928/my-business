// 自分のマニュアルをPDFにする。スマホの中で作る（サーバーには送らない）。
// 文字はスマホの字で絵として描き、ページに並べる。A4とポケットサイズ（A6）。各ページの下に「個人の学習用」。
import { copy, DEPTS, deptName, HEADINGS, headingName } from "../config";
import { track } from "../events";
import { S, rerender, type Note } from "../state";
import { h, toast } from "../ui";

const SIZES = { a4: { w: 210, h: 297, name: "A4", base: 4.2 }, a6: { w: 105, h: 148, name: "ポケット（A6）", base: 3.1 } } as const;
type Size = keyof typeof SIZES;
let pdept = "", size: Size = "a6", heads = new Set<string>(HEADINGS.map((x) => x.id)), busy = false;
const FONT = '"Zen Kaku Gothic New","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",sans-serif';

// 今の職場のメモのうち、選んだ部署のもの
const deptNotes = (): Note[] => S.notes.filter((n) => n.wid === (S.user?.workplaceId || "") && n.dept === (pdept || S.user?.dept || ""));
const deptsWithNotes = (): string[] => DEPTS.map((d) => d.id).filter((id) => id === S.user?.dept || S.notes.some((n) => n.wid === (S.user?.workplaceId || "") && n.dept === id));
interface Line { text: string; size: number; bold?: boolean; gap?: number; color?: string; }
function linesFor(notes: Note[]): Line[] {
  const out: Line[] = [{ text: "わたしのマニュアル", size: 1.9, bold: true }, { text: `${S.place?.name || ""}　${deptName(pdept || S.user?.dept || "")}`, size: 1.05, color: "#5c5f5a", gap: 1.2 }];
  for (const hd of HEADINGS) {
    if (!heads.has(hd.id)) continue;
    const list = notes.filter((n) => n.heading === hd.id); if (!list.length) continue;
    out.push({ text: `■ ${hd.name}`, size: 1.35, bold: true, gap: 1, color: "#24426a" });
    for (const n of list) {
      if (n.title) out.push({ text: n.title, size: 1.1, bold: true, gap: 0.5 });
      if (n.steps?.length) n.steps.forEach((s, i) => out.push({ text: `${i + 1}. ${s}`, size: 1 }));
      else n.text.split("\n").forEach((t) => out.push({ text: t, size: 1 }));
    }
  }
  return out;
}
// 1行を、幅に収まるように折り返す（日本語は1文字ずつ見る）
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = []; let cur = "";
  for (const ch of text) { if (ctx.measureText(cur + ch).width > width && cur) { out.push(cur); cur = ch.trim() ? ch : ""; } else cur += ch; }
  out.push(cur); return out;
}
async function build(): Promise<void> {
  const notes = deptNotes().filter((n) => heads.has(n.heading));
  if (!notes.length) { toast("選んだ見出しに、メモがありません"); return; }
  busy = true; rerender();
  try {
    await document.fonts?.ready;
    const { jsPDF } = await import("jspdf");
    const sz = SIZES[size], dpm = 7.5;                    // 1mmあたりの点の数（約190dpi）
    const W = Math.round(sz.w * dpm), H = Math.round(sz.h * dpm), M = Math.round((size === "a4" ? 14 : 8) * dpm), base = sz.base * dpm;
    const pdf = new jsPDF({ unit: "mm", format: [sz.w, sz.h], orientation: "portrait", compress: true });
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    let page = 0, y = M;
    const footer = () => { ctx.font = `${base * 0.75}px ${FONT}`; ctx.fillStyle = "#7a7f86"; ctx.textAlign = "center"; ctx.fillText(`${copy.pdfFooter}　${page + 1}`, W / 2, H - M * 0.45); ctx.textAlign = "left"; };
    const start = () => { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); y = M; };
    const flush = () => { footer(); if (page) pdf.addPage([sz.w, sz.h], "portrait"); pdf.addImage(canvas.toDataURL("image/jpeg", 0.86), "JPEG", 0, 0, sz.w, sz.h); page++; start(); };
    start();
    for (const l of linesFor(notes)) {
      const fs = base * l.size; ctx.font = `${l.bold ? "700 " : ""}${fs}px ${FONT}`; ctx.fillStyle = l.color || "#1b2430";
      y += (l.gap || 0) * base;
      for (const part of wrap(ctx, l.text, W - M * 2)) {
        if (y + fs * 1.5 > H - M) { flush(); ctx.font = `${l.bold ? "700 " : ""}${fs}px ${FONT}`; ctx.fillStyle = l.color || "#1b2430"; }
        ctx.fillText(part, M, y + fs); y += fs * 1.55;
      }
    }
    flush();
    const fname = `わたしのマニュアル_${deptName(pdept || S.user?.dept || "")}_${sz.name.replace(/[^\wぁ-んァ-ヶ一-龥]/g, "")}.pdf`;
    // Claudeのアプリで開いているときは、アプリの「保存」を使う（ページから直接は保存できないため）
    const w = window as unknown as { claude?: { use?: (n: string) => Promise<{ save: (r: { filename: string; data: Blob }) => Promise<unknown> } | null> } };
    const dl = w.claude?.use ? await w.claude.use("downloads").catch(() => null) : null;
    if (dl) { try { await dl.save({ filename: fname, data: pdf.output("blob") }); } catch (e) { const c = (e as { code?: string }).code; if (c !== "declined") toast("保存できませんでした"); } }
    else pdf.save(fname);
    track("pdf_export", { size, pages: page, heads: heads.size, dept: pdept });
    toast(`${page}ページのPDFを作りました`);
  } catch (e) { toast("PDFを作れませんでした"); }
  busy = false; rerender();
}
export function pdfScreen(): HTMLElement {
  if (!pdept || !deptsWithNotes().includes(pdept)) pdept = S.user?.dept || "";
  const notes = deptNotes(), ds = deptsWithNotes();
  return h("div", { class: "view" },
    h("section", { class: "card" }, h("span", { class: "label" }, "印刷して持ち歩く"), h("h2", null, "PDFにする"),
      h("p", { class: "empty" }, "自分のマニュアルをPDFにします。スマホの中で作るので、どこにも送られません。")),
    h("section", { class: "card" }, h("span", { class: "label" }, "大きさ"),
      h("div", { class: "seg", role: "group", "aria-label": "大きさ" }, (Object.keys(SIZES) as Size[]).map((k) => h("button", { "data-size": k, "aria-pressed": String(size === k), onclick: () => { size = k; rerender(); } }, SIZES[k].name)))),
    ds.length > 1 ? h("section", { class: "card" }, h("span", { class: "label" }, "部署"),
      h("div", { class: "chips", role: "group", "aria-label": "部署" }, ds.map((id) => h("button", { "data-pdept": id, "aria-pressed": String(pdept === id), onclick: () => { pdept = id; rerender(); } }, deptName(id))))) : null,
    h("section", { class: "card" }, h("span", { class: "label" }, "入れる見出し"),
      h("div", { class: "checks" }, HEADINGS.map((hd) => { const n = notes.filter((x) => x.heading === hd.id).length;
        return h("label", { class: "checkrow" }, h("input", { type: "checkbox", "data-ph": hd.id, checked: heads.has(hd.id), onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) heads.add(hd.id); else heads.delete(hd.id); rerender(); } }), h("span", null, `${headingName(hd.id)}（${n}件）`)); }))),
    h("button", { class: "btn", id: "pdfgo", disabled: busy, onclick: build }, busy ? "作っています…" : "PDFを作る"),
    h("p", { class: "note" }, `各ページの下に「${copy.pdfFooter}」と入ります。`));
}
