// 書いてはいけないもの（お客様の名前、電話番号、暗証番号らしきもの）を、保存の前にスマホの中で探す。
// AIが使えないときも動くように、ここは決まった形だけで探す。見つけたら「消しますか」と聞く。
export type PiiKind = "name" | "phone" | "secret" | "email" | "room";
export interface PiiHit { kind: PiiKind; match: string; index: number; }

// 「〇〇様」でも、人の名前ではない言い方
const NOT_NAME = ["お客", "お客さ", "皆", "みな", "お連れ", "お子", "奥", "神", "どちら", "お疲れ", "おつかれ", "ご苦労", "お世話", "お互い", "お陰", "おかげ", "ご愁傷", "お待ち遠"];

export function findPii(text: string): PiiHit[] {
  const t = text || "", hits: PiiHit[] = [];
  const push = (kind: PiiKind, match: string, index: number) => { if (!hits.some((h) => h.index === index && h.match === match)) hits.push({ kind, match, index }); };
  // 電話番号（10〜11けた。区切りがあってもなくても）
  for (const m of t.matchAll(/0\d{1,4}[-‐ー−\s]?\d{1,4}[-‐ー−\s]?\d{3,4}/g)) { if (m[0].replace(/\D/g, "").length >= 10) push("phone", m[0], m.index!); }
  for (const m of t.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) push("email", m[0], m.index!);
  // 暗証番号、金庫の番号など
  for (const m of t.matchAll(/(暗証番号|暗証|金庫|パスワード|パスコード|キーボックス|解錠|開錠|ロック番号|番号錠)[^。\n\d]{0,12}(\d{3,8})/g)) push("secret", m[2], m.index! + m[0].length - m[2].length);
  // お客様の名前（〇〇様、〇〇さま）
  for (const m of t.matchAll(/([一-龥々ァ-ヶーA-Za-z]{1,6}|[ぁ-ん]{2,5})(様|さま)/g)) {
    // 「お客様」の「お」のように、前のひらがなも合わせて見る
    const who = t.slice(Math.max(0, m.index! - 3), m.index! + m[1].length);
    if (NOT_NAME.some((w) => who.endsWith(w))) continue;
    push("name", m[0], m.index!);
  }
  // 部屋番号は、名前と同じ行にあるときだけ（「302号室は角部屋」のような仕事のメモは残す）
  const nameLines = new Set(hits.filter((h) => h.kind === "name").map((h) => t.lastIndexOf("\n", h.index)));
  for (const m of t.matchAll(/\d{3,4}\s?号室/g)) { if (nameLines.has(t.lastIndexOf("\n", m.index!))) push("room", m[0], m.index!); }
  return hits.sort((a, b) => a.index - b.index);
}

// 見つけたものを、分からない形に置きかえる
export function removePii(text: string, hits: PiiHit[]): string {
  let out = text;
  for (const h of [...hits].sort((a, b) => b.index - a.index)) {
    const rep = h.kind === "name" ? "お客様" : h.kind === "room" ? "お部屋" : "（消しました）";
    out = out.slice(0, h.index) + rep + out.slice(h.index + h.match.length);
  }
  return out;
}
