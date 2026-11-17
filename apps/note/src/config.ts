// 設定ファイル。骨組み、上限、文言、イベントの種類。コードを触らずに、config/ のファイルだけ直せば変わる。
import skeleton from "../config/skeleton.json";
import limits from "../config/limits.json";
import copy from "../config/copy.json";
import events from "../config/events.json";
export { skeleton, limits, copy, events };
export const DEPTS = skeleton.depts;
export const HEADINGS = skeleton.headings;
export const deptName = (id: string): string => DEPTS.find((d) => d.id === id)?.name || "その他";
export const headingName = (id: string): string => HEADINGS.find((h) => h.id === id)?.name || "メモ";
