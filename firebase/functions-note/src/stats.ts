// 管理者ページ用の集計。毎晩まとめて作り、stats/ に保存する。管理者ページは、ここで作ったものだけを読む。
// 名前やメール、メモの中身は入れない（利用者は番号だけ）。
import type { Firestore } from "firebase-admin/firestore";
import { DAY, dayIndex, daysSince, jstDay, weekStart } from "./shared/dates";
import aiCfg from "./config/ai.json";

// 「N日後も使っているか」の数え方。登録した日を0日目として、この範囲の日に1回以上あれば「使っている」
export const WINDOWS: Record<string, [number, number]> = { d1: [1, 2], d3: [3, 6], d7: [7, 13], d14: [14, 20], d28: [28, 34] };
const KEYS = Object.keys(WINDOWS);

interface Ev { uid: string; type: string; ts: number; wid: string; dept: string; meta: Record<string, unknown>; }
interface U { uid: string; createdAt: number; source: string; medium: string; campaign: string; wid: string; dept: string; linked: boolean;
  wrote: Set<number>; opened: Set<number>; lastAt: number; notes: number; practices: number; days: Set<string>; types: Set<string>; }

const inc = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] || 0) + n; };

export async function buildStats(db: Firestore, now: number) {
  const since = now - 100 * DAY, today = dayIndex(now);
  const [usersS, eventsS, placesS, usageS, notesS, cardsS] = await Promise.all([
    db.collection("users").get(),
    db.collection("events").where("ts", ">=", since).get(),
    db.collection("workplaces").get(),
    db.collection("usage").where("day", ">=", jstDay(since)).get(),
    db.collectionGroup("notes").get(),
    db.collectionGroup("cards").get(),
  ]);

  // 職場（統合されたものは、統合先に寄せる）
  const places = new Map<string, { name: string; area: string; adopted: boolean; mergedInto: string }>();
  placesS.docs.forEach((d) => places.set(d.id, { name: d.get("name") || "", area: d.get("area") || "", adopted: !!d.get("adopted"), mergedInto: d.get("mergedInto") || "" }));
  const finalPlace = (id: string): string => { let cur = id; for (let i = 0; i < 5 && cur && places.get(cur)?.mergedInto; i++) cur = places.get(cur)!.mergedInto; return places.has(cur) ? cur : ""; };

  // 利用者
  const users = new Map<string, U>();
  usersS.docs.forEach((d) => {
    const utm = d.get("utm") || {};
    users.set(d.id, { uid: d.id, createdAt: d.get("createdAt") || 0, source: utm.source || "", medium: utm.medium || "", campaign: utm.campaign || "",
      wid: finalPlace(d.get("workplaceId") || ""), dept: d.get("dept") || "", linked: !!d.get("linked"),
      wrote: new Set(), opened: new Set(), lastAt: d.get("createdAt") || 0, notes: 0, practices: 0, days: new Set(), types: new Set() });
  });

  const events: Ev[] = eventsS.docs.map((d) => ({ uid: d.get("uid"), type: d.get("type"), ts: d.get("ts"), wid: finalPlace(d.get("wid") || ""), dept: d.get("dept") || "", meta: d.get("meta") || {} }));
  const daily: Record<string, Record<string, number>> = {}, dailyActive: Record<string, Set<string>> = {};
  const features: Record<string, number> = {}, hours = new Array(24).fill(0), weekdays = new Array(7).fill(0);
  const placeLimit: Record<string, number> = {}, placeLast: Record<string, number> = {}, placeWeek: Record<string, Record<string, Set<string>>> = {};
  let piiFound = 0, piiRemoved = 0;
  for (const e of events) {
    const u = users.get(e.uid); if (!u) continue;
    const day = jstDay(e.ts), di = dayIndex(e.ts), n = daysSince(u.createdAt, e.ts);
    u.opened.add(n); u.days.add(day); u.types.add(e.type); if (e.ts > u.lastAt) u.lastAt = e.ts;
    if (e.type === "note_save") u.wrote.add(n);
    if (e.type === "card_practice") u.practices++;
    (daily[day] ||= {}); (dailyActive[day] ||= new Set()).add(e.uid);
    if (["note_save", "card_practice", "pdf_export", "ai_organize", "card_make", "limit_hit"].includes(e.type)) inc(daily[day], e.type);
    if (today - di < 30) { inc(features, e.type); const h = new Date(e.ts + 9 * 3600000); hours[h.getUTCHours()]++; weekdays[h.getUTCDay()]++; }
    if (e.type === "pii_found") piiFound++;
    if (e.type === "pii_removed") piiRemoved++;
    const wid = e.wid || u.wid;
    if (wid) {
      if (e.type === "limit_hit") inc(placeLimit, wid);
      if (e.ts > (placeLast[wid] || 0)) placeLast[wid] = e.ts;
      ((placeWeek[wid] ||= {})[weekStart(e.ts)] ||= new Set()).add(e.uid);
    }
  }

  // メモ（中身は読まない。見出し、部署、写真の有無、AIを使ったか、言葉の印だけ）
  const deptNotes: Record<string, number> = {}, headNotes: Record<string, number> = {}, headUsers: Record<string, Set<string>> = {}, tags: Record<string, number> = {};
  const placeNotes: Record<string, number> = {}, placeHead: Record<string, Record<string, number>> = {};
  let notesAll = 0, withPhoto = 0, aiNotes = 0, aiEdited = 0, photoBytes = 0;
  for (const d of notesS.docs) {
    if (!d.ref.path.startsWith("users/")) continue;
    const uid = d.ref.path.split("/")[1], u = users.get(uid); if (!u) continue;
    notesAll++; u.notes++;
    const h = d.get("heading") || "", dept = d.get("dept") || "", wid = finalPlace(d.get("wid") || "");
    inc(deptNotes, dept); inc(headNotes, h); (headUsers[h] ||= new Set()).add(uid);
    if ((d.get("photos") || []).length) withPhoto++;
    photoBytes += d.get("photoBytes") || 0;
    if (d.get("ai")) { aiNotes++; if (d.get("aiEdited")) aiEdited++; }
    for (const t of (d.get("tags") || []) as string[]) inc(tags, t);
    if (wid) { inc(placeNotes, wid); inc((placeHead[wid] ||= {}), h); }
  }
  // カード（つまずいている見出し：「まだ」が多いもの）
  const stuck: Record<string, { notyet: number; total: number }> = {};
  for (const d of cardsS.docs) {
    if (!d.ref.path.startsWith("users/")) continue;
    const h = d.get("heading") || "", s = (stuck[h] ||= { notyet: 0, total: 0 });
    s.total++; if ((d.get("practiced") || 0) > 0 && d.get("known") === false) s.notyet++;
  }

  // 継続（「書いた」と「開いた」）
  const list = [...users.values()];
  const hit = (set: Set<number>, k: string) => { const [a, b] = WINDOWS[k]; for (let i = a; i <= b; i++) if (set.has(i)) return true; return false; };
  const eligible = (u: U, k: string) => daysSince(u.createdAt, now) > WINDOWS[k][1];
  const rate = (us: U[], k: string, kind: "wrote" | "opened") => { const base = us.filter((u) => eligible(u, k)); return { base: base.length, hit: base.filter((u) => hit(u[kind], k)).length }; };
  const cohortMap: Record<string, U[]> = {};
  list.forEach((u) => { (cohortMap[weekStart(u.createdAt)] ||= []).push(u); });
  const cohorts = Object.keys(cohortMap).sort().slice(-12).map((w) => ({ week: w, n: cohortMap[w].length,
    wrote: Object.fromEntries(KEYS.map((k) => [k, rate(cohortMap[w], k, "wrote")])), opened: Object.fromEntries(KEYS.map((k) => [k, rate(cohortMap[w], k, "opened")])) }));
  const srcMap: Record<string, U[]> = {};
  list.forEach((u) => { (srcMap[`${u.source || "（なし）"}|${u.medium}|${u.campaign}`] ||= []).push(u); });
  const sources = Object.entries(srcMap).map(([k, us]) => { const [source, medium, campaign] = k.split("|"); return { source, medium, campaign, n: us.length, d14: rate(us, "d14", "wrote") }; }).sort((a, b) => b.n - a.n);

  // 期間ごとの数字（今日、今週、今月と、その前の同じ長さ）
  const period = (from: number, to: number) => {
    const o = { signup: 0, active: 0, notes: 0, practice: 0, pdf: 0 }, act = new Set<string>();
    list.forEach((u) => { const d = dayIndex(u.createdAt); if (d >= from && d <= to) o.signup++; });
    for (const e of events) { const d = dayIndex(e.ts); if (d < from || d > to) continue; act.add(e.uid); if (e.type === "note_save") o.notes++; if (e.type === "card_practice") o.practice++; if (e.type === "pdf_export") o.pdf++; }
    o.active = act.size; return o;
  };
  const periods = { today: period(today, today), todayPrev: period(today - 1, today - 1), week: period(today - 6, today), weekPrev: period(today - 13, today - 7), month: period(today - 29, today), monthPrev: period(today - 59, today - 30) };

  // 需要を判断する3つの数字
  const active7 = new Set(events.filter((e) => today - dayIndex(e.ts) < 7).map((e) => e.uid));
  const active30 = new Set(events.filter((e) => today - dayIndex(e.ts) < 30).map((e) => e.uid));
  const placeUsers: Record<string, Set<string>> = {}, placeUsers30: Record<string, Set<string>> = {}, placeDept: Record<string, Record<string, number>> = {};
  list.forEach((u) => { if (!u.wid) return; (placeUsers[u.wid] ||= new Set()).add(u.uid); if (active30.has(u.uid)) (placeUsers30[u.wid] ||= new Set()).add(u.uid); inc((placeDept[u.wid] ||= {}), u.dept || "other"); });
  const ret14 = rate(list, "d14", "wrote");
  const kpi = { ret14: { ...ret14, rate: ret14.base ? ret14.hit / ret14.base : null, goal: 0.3 },
    notesPerUserWeek: { notes: periods.week.notes, users: active7.size, value: active7.size ? periods.week.notes / active7.size : null, goal: 3 },
    places3: { value: Object.values(placeUsers30).filter((s) => s.size >= 3).length, goal: 2 } };

  const days: { d: string; signup: number; active: number; notes: number; practice: number; pdf: number; ai: number; limitHit: number }[] = [];
  for (let i = 59; i >= 0; i--) { const d = jstDay(now - i * DAY), x = daily[d] || {};
    days.push({ d, signup: list.filter((u) => jstDay(u.createdAt) === d).length, active: (dailyActive[d] || new Set()).size, notes: x.note_save || 0, practice: x.card_practice || 0, pdf: x.pdf_export || 0, ai: (x.ai_organize || 0) + (x.card_make || 0), limitHit: x.limit_hit || 0 }); }

  const funnel = { signup: list.length, place: list.filter((u) => u.wid).length, note1: list.filter((u) => u.notes >= 1).length, note3: list.filter((u) => u.notes >= 3).length,
    practice: list.filter((u) => u.types.has("card_practice")).length, pdf: list.filter((u) => u.types.has("pdf_export")).length };

  // 費用の目安
  const costDay: Record<string, { ai: number; photos: number; tokIn: number; tokOut: number }> = {};
  usageS.docs.forEach((d) => { const c = (costDay[d.get("day")] ||= { ai: 0, photos: 0, tokIn: 0, tokOut: 0 }); c.ai += d.get("ai") || 0; c.photos += d.get("photos") || 0; c.tokIn += d.get("tokIn") || 0; c.tokOut += d.get("tokOut") || 0; });
  const yen = (c: { tokIn: number; tokOut: number }) => Math.round((c.tokIn / 1e6 * aiCfg.usdPerMTokIn + c.tokOut / 1e6 * aiCfg.usdPerMTokOut) * aiCfg.yenPerUsd * 10) / 10;
  const costDaily = Object.keys(costDay).sort().slice(-60).map((d) => ({ d, ...costDay[d], yen: yen(costDay[d]) }));
  const monthYen = Math.round(costDaily.filter((c) => today - dayIndex(Date.parse(c.d + "T00:00:00+09:00")) < 30).reduce((a, c) => a + c.yen, 0));
  const cost = { daily: costDaily, monthYen, perUserYen: active30.size ? Math.round(monthYen / active30.size * 10) / 10 : null, photoBytes, budgetYen: aiCfg.monthlyBudgetYen, over: monthYen > aiCfg.monthlyBudgetYen * 0.8 };

  const summary = { builtAt: now, kpi, periods, daily: days, cohorts, funnel, sources, features,
    depts: Object.keys({ ...deptNotes, ...Object.fromEntries(list.map((u) => [u.dept || "other", 0])) }).map((dept) => ({ dept, users: list.filter((u) => (u.dept || "other") === dept).length, notes: deptNotes[dept] || 0 })),
    headings: Object.keys(headNotes).map((h) => ({ heading: h, notes: headNotes[h], users: headUsers[h].size })), usersWithNotes: list.filter((u) => u.notes > 0).length,
    aiEdit: { ai: aiNotes, edited: aiEdited }, hours, weekdays, photo: { notes: notesAll, withPhoto },
    tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([tag, n]) => ({ tag, n })), pii: { found: piiFound, removed: piiRemoved },
    stuck: Object.entries(stuck).map(([heading, s]) => ({ heading, ...s })).sort((a, b) => b.notyet - a.notyet), cost, totals: { users: list.length, notes: notesAll } };

  const weeks: string[] = []; for (let i = 7; i >= 0; i--) weeks.push(weekStart(now - i * 7 * DAY));
  const placeList = [...places.entries()].filter(([, p]) => !p.mergedInto).map(([id, p]) => ({ id, name: p.name, area: p.area, adopted: p.adopted,
    users: (placeUsers[id] || new Set()).size, users30: (placeUsers30[id] || new Set()).size, notes: placeNotes[id] || 0, lastAt: placeLast[id] || 0, limitHits: placeLimit[id] || 0,
    depts: placeDept[id] || {}, headings: placeHead[id] || {}, weekly: weeks.map((w) => ({ w, users: ((placeWeek[id] || {})[w] || new Set()).size })) }))
    .sort((a, b) => b.users30 - a.users30 || b.users - a.users || b.notes - a.notes);
  const areaMap: Record<string, { area: string; places: number; users: number; notes: number }> = {};
  placeList.forEach((p) => { const a = (areaMap[p.area] ||= { area: p.area, places: 0, users: 0, notes: 0 }); a.places++; a.users += p.users; a.notes += p.notes; });

  const userList = list.sort((a, b) => b.lastAt - a.lastAt).slice(0, 3000).map((u) => ({ uid: u.uid, createdAt: u.createdAt, source: u.source, campaign: u.campaign, wid: u.wid, dept: u.dept, linked: u.linked,
    lastAt: u.lastAt, notes: u.notes, practices: u.practices, days: [...u.days].sort().slice(-40) }));

  await Promise.all([
    db.doc("stats/summary").set(summary),
    db.doc("stats/workplaces").set({ builtAt: now, list: placeList, areas: Object.values(areaMap).sort((a, b) => b.users - a.users) }),
    db.doc("stats/users").set({ builtAt: now, list: userList }),
  ]);
  return { ok: true, builtAt: now, users: list.length, events: events.length };
}
