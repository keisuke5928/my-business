// 日付は日本時間でそろえる（上限のリセット、継続の数え方）。
export const DAY = 86400000;
export function jstDay(ms: number): string { return new Date(ms + 9 * 3600000).toISOString().slice(0, 10); }
export function dayIndex(ms: number): number { return Math.floor((ms + 9 * 3600000) / DAY); }
// 登録から何日目か（登録した日が0）
export function daysSince(fromMs: number, toMs: number): number { return dayIndex(toMs) - dayIndex(fromMs); }
// その週の月曜（日本時間）。登録した週ごとの表に使う
export function weekStart(ms: number): string { const d = dayIndex(ms); const dow = (d + 3) % 7; return jstDay((d - dow) * DAY - 9 * 3600000 + 9 * 3600000); }
