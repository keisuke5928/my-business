import { describe, expect, it } from "vitest";
import { normName, placeKey, similarNorm } from "../src/lib/normalize";
import { findPii, removePii } from "../src/lib/pii";
import { dangerKind } from "../src/lib/danger";
import { daysSince, jstDay, weekStart } from "../src/lib/dates";

describe("職場の名前をそろえる", () => {
  it("書き方がちがっても、同じ宿になる", () => {
    const a = normName("宇奈月温泉 延対寺荘"), b = normName("延対寺荘"), c = normName("ホテル　延対寺荘"), d = normName("ＥＮＴＡＩＪＩ");
    expect(similarNorm(a, b)).toBe(true);
    expect(similarNorm(b, c)).toBe(true);
    expect(b).toBe(c);
    expect(d).toBe("entaiji");
  });
  it("温泉地の名前が入っていても、同じ鍵になる", () => { expect(placeKey("宇奈月温泉 延対寺荘", "宇奈月温泉")).toBe(placeKey("延対寺荘", "宇奈月")); });
  it("カタカナとひらがなをそろえる", () => { expect(normName("みずなら亭")).toBe(normName("ミズナラ亭")); });
  it("1文字ちがいは候補に出す。別の宿は出さない", () => {
    expect(similarNorm(normName("延対寺荘"), normName("延対寺壮"))).toBe(true);
    expect(similarNorm(normName("延対寺荘"), normName("黒部観光ホテル"))).toBe(false);
  });
});

describe("書いてはいけないものを探す", () => {
  it("お客様の名前と、同じ行の部屋番号を見つける", () => {
    const hits = findPii("お客様の山田様は302号室");
    expect(hits.map((h) => h.kind)).toEqual(["name", "room"]);
    expect(removePii("お客様の山田様は302号室", hits)).toBe("お客様のお客様はお部屋");
  });
  it("「お客様」「お疲れ様」は名前にしない", () => { expect(findPii("お客様にお茶を出す。お疲れ様でした。皆様へ。")).toEqual([]); });
  it("部屋番号だけの仕事のメモは残す", () => { expect(findPii("512号室は蘭亭の5階。角部屋。")).toEqual([]); });
  it("電話番号と暗証番号を見つける", () => {
    const hits = findPii("フロントは 0765-62-1234。金庫の番号は 4821 です。");
    expect(hits.map((h) => h.kind)).toEqual(["phone", "secret"]);
    expect(removePii("金庫の番号は 4821 です。", findPii("金庫の番号は 4821 です。"))).toBe("金庫の番号は （消しました） です。");
  });
  it("時刻や数は見つけない", () => { expect(findPii("9:00 集合。シーツは20枚。3階のリネン室。")).toEqual([]); });
});

describe("AIが手順を作らない話題", () => {
  it("アレルギー、けが、お金、トラブル", () => {
    expect(dangerKind("卵アレルギーの料理の出し方")).toBe("allergy");
    expect(dangerKind("やけどをしたとき")).toBe("body");
    expect(dangerKind("時給はいつ上がる")).toBe("money");
    expect(dangerKind("お客様に怒られたとき")).toBe("guest");
  });
  it("ふつうの仕事のメモは通す", () => { expect(dangerKind("シーツの替え方。古いシーツを外す。")).toBe(null); });
});

describe("日付（日本時間）", () => {
  it("日本時間の0時で日が変わる", () => {
    expect(jstDay(Date.UTC(2026, 10, 16, 14, 59))).toBe("2026-11-16");
    expect(jstDay(Date.UTC(2026, 10, 16, 15, 0))).toBe("2026-11-17");
  });
  it("登録から何日目か", () => { expect(daysSince(Date.UTC(2026, 10, 1, 3), Date.UTC(2026, 10, 15, 16))).toBe(15); });
  it("週の始まりは月曜", () => { expect(weekStart(Date.UTC(2026, 10, 18, 3))).toBe("2026-11-16"); });
});
