// 画面を作る小さな道具。利用者が書いた文は、必ず文字として入れる（HTMLとしては入れない）。
type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> | null;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "value") (el as unknown as HTMLInputElement).value = String(v);
    else if (k === "checked") (el as unknown as HTMLInputElement).checked = !!v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  add(el, kids);
  return el;
}
function add(el: Node, kids: Child[]): void {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

let toastTimer = 0;
export function toast(msg: string): void {
  const t = $("#toast")!; t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { t.hidden = true; }, 3200);
}
// 下から出る確認の窓
export function sheet(build: (close: () => void) => Node): void {
  const m = $("#modal")!; m.textContent = ""; m.hidden = false;
  const close = () => { m.hidden = true; m.textContent = ""; };
  const bg = h("div", { class: "sheet-bg", onclick: (e: Event) => { if (e.target === bg) close(); } }, h("div", { class: "sheet-card", role: "dialog", "aria-modal": "true" }, build(close)));
  m.appendChild(bg);
}
// 画面の下に小さく出る、閉じられるお知らせ
export function notice(msg: string, onClose: () => void): void {
  const n = $("#notice")!; n.textContent = ""; n.hidden = false;
  n.append(h("span", null, msg), h("button", { class: "nclose", "aria-label": "閉じる", onclick: () => { n.hidden = true; onClose(); } }, "×"));
}
export const fmtDate = (ms: number): string => { if (!ms) return ""; const d = new Date(ms); return `${d.getMonth() + 1}月${d.getDate()}日`; };
