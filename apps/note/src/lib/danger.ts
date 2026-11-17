// AIが手順を作らない、答えない話題。見つけたら「職場の担当者に確認してください」と出す。
// 旅館向けアプリと同じ考え方。サーバー側でも同じものを使う。
export type DangerKind = "allergy" | "body" | "money" | "guest" | "harass" | "disaster";

const RULES: [DangerKind, RegExp][] = [
  ["allergy", /アレルギー|アレルゲン|卵|そば|蕎麦|えび|エビ|海老|かに|カニ|蟹|小麦|乳製品|落花生|ピーナッツ|除去食/],
  ["harass", /セクハラ|パワハラ|ハラスメント|触られ|いじめ|暴言|暴力/],
  ["disaster", /地震|火事|火災|災害|避難|津波|停電/],
  ["body", /けが|怪我|ケガ|やけど|火傷|倒れ|救急|具合が悪|体調|熱が|めまい|出血|骨折|持病|薬を/],
  ["guest", /クレーム|苦情|怒ら|怒っ|酔っ|酔い|トラブル|弁償|盗|なくし|紛失/],
  ["money", /給料|給与|時給|手当|残業代|交通費|お金|会計|支払|返金|料金の間違|レジ/],
];

export function dangerKind(text: string): DangerKind | null {
  const t = text || "";
  for (const [k, re] of RULES) if (re.test(t)) return k;
  return null;
}
