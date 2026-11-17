// 職場の名前の表記をそろえる。「宇奈月温泉 延対寺荘」「延対寺荘」「ホテル延対寺荘」が、別々に登録されないようにするため。
// サーバー側（functions-note）でも同じものを使う（ビルドのときに写す）。
const GENERIC = ["株式会社", "有限会社", "(株)", "（株）", "旅館", "ホテル", "ほてる", "hotel", "ryokan", "温泉", "おんせん", "リゾート", "りぞーと", "resort", "the"];

export function normName(input: string): string {
  let s = (input || "").normalize("NFKC").toLowerCase();
  // カタカナをひらがなに
  s = s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  s = s.replace(/[\s　・･、。,.\-‐―()（）「」『』]/g, "");
  for (const g of GENERIC) s = s.split(g.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))).join("");
  return s;
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// 2つの名前（そろえたあと）が、同じ宿らしいか
export function similarNorm(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const short = a.length <= b.length ? a : b, long = a.length <= b.length ? b : a;
  if (short.length >= 2 && long.includes(short)) return true;
  return short.length >= 4 && editDistance(a, b) <= 1;
}
