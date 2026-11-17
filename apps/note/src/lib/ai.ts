// AIへの指示と、答えの整え方。サーバー（functions-note）と、見本版（apps/note/demo）で同じものを使う。
// 直すのはここ。サーバー側には npm run build のときに写る。
import { findPii } from "./pii";
import { dangerKind } from "./danger";

export const HEADING_IDS = ["flow", "steps", "dont", "here", "words", "places"];
export interface Organized { refuse: boolean; heading: string; title: string; steps: string[]; tags: string[]; pii: string[]; }
export interface AiCard { front: string; back: string; kind: string; }

export const SYSTEM_ORGANIZE = `あなたは、旅館やホテルで働きはじめた新人が書いた仕事のメモを、あとで見返しやすい形に整える係です。
決まり：
1. メモに書かれていないことは、足さない。推測で手順を作らない。
2. やさしい日本語で、短い文にする。
3. 見出しは次のどれか1つを選ぶ。flow（1日の流れ）、steps（手順）、dont（やってはいけないこと）、here（この職場だけのこと）、words（用語・お品書き）、places（館内の場所）。
4. アレルギー、けが、体調、お金（給料、手当）、お客様とのトラブル、ハラスメント、災害についてのメモなら、手順を作らず refuse を true にする。
5. お客様の名前、電話番号、暗証番号や金庫の番号らしきものがあれば、その文字列をそのまま pii に入れる。
6. tags には、どの宿でも通じる仕事の言葉を2〜3個入れる（例：シーツ、配膳、チェックイン）。宿の名前や人の名前は入れない。
答えは、次の形のJSONだけを返す。ほかの文は書かない。
{"refuse":false,"heading":"steps","title":"20字以内の題","steps":["1つ目","2つ目"],"tags":["言葉"],"pii":[]}`;

export const SYSTEM_CARDS = `あなたは、旅館やホテルで働きはじめた新人のメモから、覚えるためのカードを作る係です。
決まり：
1. メモに書かれていることだけを使う。足さない。
2. 表は短い問い、裏は短い答え。やさしい日本語。
3. kind は word（用語）、menu（お品書き）、place（館内の場所）、order（手順の順番）のどれか。
4. アレルギー、けが、体調、お金、お客様とのトラブル、ハラスメント、災害についてのカードは作らない。
5. お客様の名前や番号は入れない。多くても12枚。
答えは、次の形のJSONだけを返す。
{"cards":[{"front":"リネンとは？","back":"シーツやタオルのこと","kind":"word"}]}`;

export function parseJsonText(text: string): unknown {
  const t = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch (e) {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw e;
  }
}
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, n: number, max: number): string[] => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);

// AIの答えを、決まった形にそろえる（足りない所、長すぎる所、決まりの外の見出しを直す）
export function cleanOrganized(raw: unknown): Organized | { refuse: true } {
  const r = (raw || {}) as Record<string, unknown>;
  if (r.refuse === true) return { refuse: true };
  const hd = str(r.heading, 20);
  return { refuse: false, heading: HEADING_IDS.includes(hd) ? hd : "steps", title: str(r.title, 40), steps: strs(r.steps, 30, 300), tags: strs(r.tags, 3, 20), pii: strs(r.pii, 10, 60) };
}
export function cleanCards(raw: unknown): AiCard[] {
  const list = ((raw || {}) as { cards?: unknown }).cards;
  return (Array.isArray(list) ? list : []).map((c: Record<string, unknown>) => ({ front: str(c.front, 80), back: str(c.back, 200), kind: ["word", "menu", "place", "order"].includes(str(c.kind, 10)) ? str(c.kind, 10) : "word" }))
    .filter((c) => c.front && c.back && !dangerKind(c.front + c.back)).slice(0, 12);
}

// AIを使わない代わり（テストのとき、見本版でAIが使えないとき）。決まった形で整える
export function fakeOrganize(text: string): Organized {
  const lines = text.split(/[\n。]/).map((x) => x.replace(/^\s*\d+[.)、 ]\s*/, "").trim()).filter(Boolean);
  const heading = /してはいけない|しない|だめ|禁止/.test(text) ? "dont" : /とは|：|:/.test(text) ? "words" : /階|奥|となり|場所/.test(text) ? "places" : /\d{1,2}[:時]/.test(text) ? "flow" : "steps";
  return { refuse: false, heading, title: (lines[0] || "メモ").slice(0, 20), steps: lines.slice(0, 12), tags: ["テスト"], pii: findPii(text).map((h) => h.match) };
}
export function fakeCards(notes: string): AiCard[] {
  const out: AiCard[] = [];
  for (const line of notes.split(/\n/)) { const m = /^(.{1,20})[：:](.{1,60})$/.exec(line.trim()); if (m) out.push({ front: m[1] + "とは？", back: m[2].trim(), kind: "word" }); }
  if (!out.length) out.push({ front: "最初にすることは？", back: (notes.split(/[\n。]/).find((x) => x.trim()) || "").trim().slice(0, 60), kind: "order" });
  return out.slice(0, 12);
}
