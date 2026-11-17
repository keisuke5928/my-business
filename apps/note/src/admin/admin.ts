// 管理者ページ（運営者だけ）。夜に作った集計（stats/）だけを読む。名前とメールは出さない。
// メモの中身は、サーバーの関数を通して見る。見た記録が必ず残る。
import "uplot/dist/uPlot.min.css";
import uPlot from "uplot";
import { isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink, signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "firebase/firestore";
import { auth, call, db } from "../fb";
import { deptName, headingName } from "../config";
import { fmtDate, h, toast } from "../ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
let role: string | null = null, checking = false, sec = "top", summary: Any = null, places: Any = null, users: Any = null, loadedAt = 0, busy = false;
let placeOpen: string | null = null, userOpen: string | null = null, userNotes: Any[] | null = null, audits: Any[] | null = null, mergeFrom = "";
let host: HTMLElement, navEl: HTMLElement, lastKey = "";
const SECS: [string, string][] = [["top", "まとめ"], ["keep", "続けているか"], ["use", "使い方"], ["places", "職場"], ["users", "新人"], ["content", "中身"], ["cost", "費用"], ["csv", "書き出し"]];
const MAIL = "note-admin-mail";
const pct = (a: number, b: number) => (b ? Math.round(a / b * 100) + "%" : "－");
const num = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "－" : (Math.round(v * 10 ** d) / 10 ** d).toLocaleString("ja-JP"));
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

async function checkRole(): Promise<void> {
  const u = auth.currentUser; if (!u || u.isAnonymous) { role = null; return; }
  checking = true;
  try { await call("whoami", {}); await u.getIdToken(true); } catch (e) { /* 役割の確認に失敗しても、手元の情報で続ける */ }
  role = ((await u.getIdTokenResult()).claims.role as string) || null; checking = false;
}
async function load(force = false): Promise<void> {
  if (busy) return; busy = true; draw();
  try {
    if (force) { await call("noteAdminStats", {}); toast("集計を作り直しました"); }
    const [s, p, u] = await Promise.all([getDoc(doc(db, "stats", "summary")), getDoc(doc(db, "stats", "workplaces")), getDoc(doc(db, "stats", "users"))]);
    summary = s.exists() ? s.data() : null; places = p.exists() ? p.data() : null; users = u.exists() ? u.data() : null; loadedAt = Date.now();
  } catch (e) { toast("集計を読めませんでした"); }
  busy = false; draw();
}

// ---------- 部品 ----------
const card = (title: string, ...kids: Any[]) => h("section", { class: "card" }, h("h3", null, title), ...kids);
function bars(rows: [string, number][], max?: number): HTMLElement {
  const m = max ?? Math.max(1, ...rows.map((r) => r[1]));
  return h("div", { class: "bars" }, rows.map(([t, v]) => h("div", { class: "bar" }, h("span", null, t), h("span", { class: "t" }, h("i", { style: `width:${Math.round(v / m * 100)}%` })), h("span", { class: "v" }, num(v, 0)))));
}
function table(head: string[], rows: (string | number | Node)[][]): HTMLElement {
  return h("div", { class: "tbl" }, h("table", null, h("thead", null, h("tr", null, head.map((x) => h("th", null, x)))), h("tbody", null, rows.map((r) => h("tr", null, r.map((c) => h("td", null, c)))))));
}
function lineChart(labels: string[], series: [string, number[], string][], height = 180): HTMLElement {
  const el = h("div", { class: "chart" });
  requestAnimationFrame(() => {
    const w = el.clientWidth || 340, css = getComputedStyle(document.documentElement), ink = css.getPropertyValue("--muted").trim(), line = css.getPropertyValue("--line").trim();
    const xs = labels.map((_, i) => i);
    // eslint-disable-next-line no-new
    new uPlot({ width: w, height, legend: { show: true }, cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false } },
      axes: [{ stroke: ink, grid: { stroke: line, width: 1 }, values: (_u: uPlot, v: number[]) => v.map((i) => (labels[i] || "").slice(5)) }, { stroke: ink, grid: { stroke: line, width: 1 } }],
      series: [{}, ...series.map(([label, , color]) => ({ label, stroke: css.getPropertyValue(color).trim() || color, width: 2, points: { show: false } }))] }, [xs, ...series.map((s) => s[1])] as uPlot.AlignedData, el);
  });
  return el;
}
const pName = (id: string) => (places?.list || []).find((p: Any) => p.id === id)?.name || (id ? "（不明）" : "未選択");

// ---------- 各ページ ----------
function kpiCard(label: string, value: string, ok: boolean | null, goal: string, sub: string): HTMLElement {
  return h("div", { class: `kpi ${ok === null ? "na" : ok ? "ok" : "ng"}` }, h("span", { class: "label" }, label), h("span", { class: "v" }, value), h("span", { class: "note" }, `目標 ${goal}${ok === null ? "（まだ数えられません）" : ok ? "　届いています" : "　まだ届いていません"}`), h("span", { class: "note" }, sub));
}
function top(): HTMLElement[] {
  const k = summary.kpi, p = summary.periods;
  const cmp = (a: number, b: number) => { const d = a - b; return h("span", { class: `d ${d > 0 ? "up" : d < 0 ? "down" : ""}` }, d === 0 ? "前と同じ" : `前より${d > 0 ? "+" : ""}${d}`); };
  const block = (name: string, cur: Any, prev: Any) => card(name, h("div", { class: "grid3" }, [["新規登録", "signup"], ["利用した人", "active"], ["メモ", "notes"], ["カード練習", "practice"], ["PDF", "pdf"]]
    .map(([t, f]) => h("div", { class: "stat" }, h("span", { class: "note" }, t), h("b", null, num(cur[f], 0)), cmp(cur[f], prev[f])))));
  return [
    h("div", { class: "kpis" },
      kpiCard("2週間後も書いている人", k.ret14.rate === null ? "－" : pct(k.ret14.hit, k.ret14.base), k.ret14.rate === null ? null : k.ret14.rate >= k.ret14.goal, "3割以上", `登録から14〜20日目にメモを書いた人。数えられる人 ${k.ret14.base}人中 ${k.ret14.hit}人`),
      kpiCard("1人あたりの週のメモ", num(k.notesPerUserWeek.value), k.notesPerUserWeek.value === null ? null : k.notesPerUserWeek.value >= k.notesPerUserWeek.goal, "3件以上", `直近7日に開いた ${k.notesPerUserWeek.users}人で、メモ ${k.notesPerUserWeek.notes}件`),
      kpiCard("利用者が3人以上の職場", `${k.places3.value}か所`, k.places3.value >= k.places3.goal, "2か所以上", "直近30日に開いた人で数えています")),
    block("今日", p.today, p.todayPrev), block("今週（直近7日）", p.week, p.weekPrev), block("今月（直近30日）", p.month, p.monthPrev),
    card("日ごとの動き（60日）", lineChart(summary.daily.map((d: Any) => d.d), [["利用した人", summary.daily.map((d: Any) => d.active), "--ai"], ["メモ", summary.daily.map((d: Any) => d.notes), "--moss"], ["新規登録", summary.daily.map((d: Any) => d.signup), "--warn"]])),
  ];
}
function keep(): HTMLElement[] {
  const ks = ["d1", "d3", "d7", "d14", "d28"], kn = ["1日後", "3日後", "1週間後", "2週間後", "4週間後"];
  const cell = (r: Any) => (r.base ? `${pct(r.hit, r.base)}` : "－");
  const f = summary.funnel, steps: [string, number][] = [["登録", f.signup], ["職場を選ぶ", f.place], ["最初のメモ", f.note1], ["3件目のメモ", f.note3], ["カードの練習", f.practice], ["PDF出力", f.pdf]];
  return [
    card("登録した週ごとの継続（メモを書いた人）", table(["登録した週", "人数", ...kn], summary.cohorts.slice().reverse().map((c: Any) => [c.week.slice(5), c.n, ...ks.map((k) => cell(c.wrote[k]))])),
      h("p", { class: "note" }, "1日後は登録の翌日と翌々日、3日後は3〜6日目、1週間後は7〜13日目、2週間後は14〜20日目、4週間後は28〜34日目に、メモを1件以上書いた人の割合です。まだその日数がたっていない人は数えません。")),
    card("参考：開いただけの人も入れた継続", table(["登録した週", "人数", ...kn], summary.cohorts.slice().reverse().map((c: Any) => [c.week.slice(5), c.n, ...ks.map((k) => cell(c.opened[k]))])),
      h("p", { class: "note" }, "書き終えて、カードやPDFで見返している人も入ります。")),
    card("どこで使わなくなるか", table(["段階", "人数", "登録に対して"], steps.map(([t, n]) => [t, n, pct(n, f.signup)]))),
    card("来た場所ごと", table(["来た場所", "媒体", "投稿", "登録", "2週間後も書いている"], summary.sources.map((s: Any) => [s.source, s.medium || "－", s.campaign || "－", s.n, s.d14.base ? `${pct(s.d14.hit, s.d14.base)}（${s.d14.base}人中）` : "－"]))),
  ];
}
const FEAT: Record<string, string> = { open: "アプリを開く", note_save: "メモの保存", ai_organize: "AIで整える", ai_edit: "AIの結果を直した", card_make: "カードの作成", card_practice: "カードの練習", pdf_export: "PDF出力", limit_hit: "上限に達した", limit_dismiss: "お知らせを閉じた", place_select: "職場の選択", dept_select: "部署の選択", signup: "登録", consent: "同意", account_link: "アカウントの紐づけ", intro_link: "紹介ページ", pii_found: "名前などを見つけた", pii_removed: "名前などを消した", ai_refuse: "AIが答えない話題" };
function use(): HTMLElement[] {
  const f = summary.features || {};
  return [
    card("機能ごとの利用（直近30日）", bars(Object.entries(f).sort((a: Any, b: Any) => b[1] - a[1]).map(([k, v]) => [FEAT[k] || k, v as number]))),
    card("部署ごと", table(["部署", "利用者", "メモ"], summary.depts.map((d: Any) => [deptName(d.dept), d.users, d.notes]))),
    card("見出しごとの書かれ方", table(["見出し", "メモ", "書いた人", "書いた人の割合"], ["flow", "steps", "dont", "here", "words", "places"].map((id) => { const x = summary.headings.find((y: Any) => y.heading === id) || { notes: 0, users: 0 }; return [headingName(id), x.notes, x.users, pct(x.users, summary.usersWithNotes)]; })),
      h("p", { class: "note" }, "割合は、メモを1件以上書いた人のうち、その見出しに書いた人です。低い見出しは、空のままになりやすい見出しです。")),
    card("AIで整えた結果を、本人が直した割合", h("p", null, h("b", null, pct(summary.aiEdit.edited, summary.aiEdit.ai)), `　AIで整えたメモ ${summary.aiEdit.ai}件のうち ${summary.aiEdit.edited}件`)),
    card("使われる時間帯（直近30日）", bars(summary.hours.map((v: number, i: number) => [`${i}時`, v] as [string, number]))),
    card("使われる曜日（直近30日）", bars(summary.weekdays.map((v: number, i: number) => [DOW[i], v] as [string, number]))),
    card("写真付きのメモ", h("p", null, h("b", null, pct(summary.photo.withPhoto, summary.photo.notes)), `　メモ ${summary.photo.notes}件のうち ${summary.photo.withPhoto}件`)),
  ];
}
function placeList(): HTMLElement[] {
  if (!places) return [card("職場", h("p", { class: "empty" }, "まだ集計がありません。"))];
  if (placeOpen) {
    const p = places.list.find((x: Any) => x.id === placeOpen);
    if (!p) { placeOpen = null; return placeList(); }
    return [h("button", { class: "back", onclick: () => { placeOpen = null; draw(); } }, "← 職場の一覧へ"),
      card(p.name, h("p", { class: "empty" }, `${p.area} ・ 利用者 ${p.users}人（直近30日 ${p.users30}人） ・ メモ ${p.notes}件`), p.adopted ? h("span", { class: "tag adopt" }, "導入済み") : null,
        h("div", { class: "row" }, h("button", { class: "btn ghost small", onclick: async () => { try { await call("noteAdminAdopt", { id: p.id, adopted: !p.adopted }); p.adopted = !p.adopted; toast(p.adopted ? "導入済みにしました" : "導入済みを外しました"); draw(); } catch (e) { toast("変えられませんでした"); } } }, p.adopted ? "導入済みを外す" : "導入済みにする"))),
      card("部署ごとの利用者", bars(Object.entries(p.depts).map(([d, n]) => [deptName(d), n as number]))),
      card("見出しごとのメモ", bars(["flow", "steps", "dont", "here", "words", "places"].map((id) => [headingName(id), p.headings[id] || 0]))),
      card("利用の推移（週ごとの利用者）", bars(p.weekly.map((w: Any) => [w.w.slice(5), w.users]))),
      card("ほかの職場とまとめる", h("p", { class: "empty" }, "同じ宿が別々に登録されているとき、この職場を、下で選んだ職場にまとめます。利用者とメモは、まとめた先に移ります。"),
        h("select", { id: "mergeTo" }, h("option", { value: "" }, "まとめる先を選ぶ"), places.list.filter((x: Any) => x.id !== p.id).map((x: Any) => h("option", { value: x.id }, `${x.name}（${x.area}）`))),
        h("button", { class: "btn ghost small", onclick: async () => { const to = (document.getElementById("mergeTo") as HTMLSelectElement).value; if (!to) { toast("まとめる先を選んでください"); return; }
          if (mergeFrom !== p.id) { mergeFrom = p.id; toast("もう一度押すと、まとめます"); return; }
          try { const r = await call<object, Any>("noteAdminMerge", { from: p.id, to }); toast(`まとめました（利用者 ${r.users}人、メモ ${r.notes}件）`); placeOpen = null; await load(true); } catch (e) { toast("まとめられませんでした"); } } }, "この職場をまとめる"))];
  }
  return [card("職場ごと", h("p", { class: "note" }, "直近30日の利用者が3人以上の職場を上に並べ、「提案候補」としています。"),
      table(["職場", "利用者", "メモ", "最後に使われた日", "上限", "印"], places.list.map((p: Any) => [h("button", { class: "link", "data-place": p.id, onclick: () => { placeOpen = p.id; draw(); scrollTo(0, 0); } }, p.name), p.users, p.notes, fmtDate(p.lastAt), p.limitHits,
        h("span", null, p.users30 >= 3 ? h("span", { class: "tag cand" }, "提案候補") : null, p.adopted ? h("span", { class: "tag adopt" }, "導入済み") : null)]))),
    card("温泉地・市町村ごと", table(["温泉地・市町村", "職場", "利用者", "メモ"], places.areas.map((a: Any) => [a.area, a.places, a.users, a.notes])))];
}
async function openUser(uid: string): Promise<void> {
  userOpen = uid; userNotes = null; draw();
}
function userList(): HTMLElement[] {
  if (!users) return [card("新人", h("p", { class: "empty" }, "まだ集計がありません。"))];
  if (userOpen) {
    const u = users.list.find((x: Any) => x.uid === userOpen);
    if (!u) { userOpen = null; return userList(); }
    const days = new Set(u.days), cal: HTMLElement[] = [];
    for (let i = 41; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000 + 9 * 3600000).toISOString().slice(0, 10); cal.push(h("span", { class: `dot${days.has(d) ? " on" : ""}`, title: d })); }
    return [h("button", { class: "back", onclick: () => { userOpen = null; userNotes = null; draw(); } }, "← 新人の一覧へ"),
      card(`利用者 ${u.uid.slice(0, 8)}`, h("p", { class: "empty" }, `登録 ${fmtDate(u.createdAt)} ・ ${u.source || "来た場所なし"}${u.campaign ? "（" + u.campaign + "）" : ""} ・ ${pName(u.wid)} ・ ${deptName(u.dept)}`),
        h("p", { class: "note" }, `メモ ${u.notes}件 ・ カード練習 ${u.practices}回 ・ 最後に使った日 ${fmtDate(u.lastAt)}${u.linked ? " ・ アカウント紐づけ済み" : ""}`)),
      card("使った日（直近6週）", h("div", { class: "cal" }, cal)),
      card("メモの中身", userNotes === null
        ? [h("p", { class: "empty" }, "中身を開くと、だれがいつ見たかが記録されます。"), h("button", { class: "btn ghost small", id: "openNotes", onclick: async () => {
            try { const r = await call<object, Any>("noteAdminNotes", { uid: u.uid }); userNotes = r.notes; audits = null; draw(); } catch (e) { toast("開けませんでした"); } } }, "メモの中身を開く（記録が残ります）")]
        : userNotes.length ? userNotes.map((n: Any) => h("div", { class: "rowbtn" }, h("b", null, `${headingName(n.heading)}：${n.title || "（題なし）"}`), h("span", { class: "sub" }, `${fmtDate(n.createdAt)} ・ ${deptName(n.dept)}${n.photos ? ` ・ 写真${n.photos}` : ""}`),
            n.steps.length ? h("ol", { class: "steps" }, n.steps.map((s: string) => h("li", null, s))) : h("p", { class: "pre" }, n.text))) : h("p", { class: "empty" }, "メモはありません。"))];
  }
  return [card("新人ごと", h("p", { class: "note" }, "名前とメールは出しません。利用者は番号の頭8けたで表します。"),
      table(["利用者", "登録日", "来た場所", "職場", "部署", "最後", "メモ", "練習"], users.list.slice(0, 300).map((u: Any) => [h("button", { class: "link", "data-user": u.uid, onclick: () => { void openUser(u.uid); scrollTo(0, 0); } }, u.uid.slice(0, 8)), fmtDate(u.createdAt), u.source || "－", pName(u.wid), deptName(u.dept), fmtDate(u.lastAt), u.notes, u.practices]))),
    card("メモの中身を見た記録", audits === null ? h("button", { class: "btn ghost small", onclick: async () => { try { const s = await getDocs(query(collection(db, "auditLogs"), orderBy("at", "desc"), limit(100))); audits = s.docs.map((d) => d.data()); draw(); } catch (e) { toast("読めませんでした"); } } }, "記録を見る")
      : table(["日時", "見た人", "見た相手", "件数"], audits.map((a: Any) => [new Date(a.at).toLocaleString("ja-JP"), String(a.by).slice(0, 8), String(a.target).slice(0, 8), a.count])))];
}
function content(): HTMLElement[] {
  return [card("よく出てくる言葉（上位30）", h("p", { class: "note" }, "AIが付けた、どの宿でも通じる仕事の言葉です。職場名や人の名前は入れていません。"), bars(summary.tags.map((t: Any) => [t.tag, t.n]))),
    card("お客様の名前や番号らしきもの", h("p", null, `見つけた ${summary.pii.found}回 ・ 消された ${summary.pii.removed}回（${pct(summary.pii.removed, summary.pii.found)}）`)),
    card("つまずいている見出し（カードで「まだ」が多い）", table(["見出し", "まだ", "カード", "割合"], summary.stuck.map((s: Any) => [headingName(s.heading), s.notyet, s.total, pct(s.notyet, s.total)])))];
}
function cost(): HTMLElement[] {
  const c = summary.cost;
  return [c.over ? h("p", { class: "alert" }, `直近30日のAIの費用が、月の目安 ${c.budgetYen.toLocaleString()}円の8割を超えています。`) : null,
    card("AIの費用の目安", h("div", { class: "grid3" }, h("div", { class: "stat" }, h("span", { class: "note" }, "直近30日"), h("b", null, `${num(c.monthYen, 0)}円`)), h("div", { class: "stat" }, h("span", { class: "note" }, "1人あたり"), h("b", null, `${num(c.perUserYen)}円`)), h("div", { class: "stat" }, h("span", { class: "note" }, "写真の容量"), h("b", null, `${num(c.photoBytes / 1e6)}MB`))),
      lineChart(c.daily.map((d: Any) => d.d), [["AIの呼び出し", c.daily.map((d: Any) => d.ai), "--ai"], ["写真", c.daily.map((d: Any) => d.photos), "--moss"]]),
      table(["日", "AI", "写真", "入力トークン", "出力トークン", "費用の目安"], c.daily.slice().reverse().slice(0, 14).map((d: Any) => [d.d.slice(5), d.ai, d.photos, d.tokIn, d.tokOut, `${d.yen}円`])),
      h("p", { class: "note" }, "トークン数と、設定ファイル（config/ai.json）の単価から出した目安です。"))].filter(Boolean) as HTMLElement[];
}
function csvOf(rows: (string | number)[][]): string { return rows.map((r) => r.map((c) => { const s = String(c ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n"); }
function download(name: string, rows: (string | number)[][]): void {
  const blob = new Blob(["﻿" + csvOf(rows)], { type: "text/csv" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function csv(): HTMLElement[] {
  const day = new Date().toISOString().slice(0, 10);
  const items: [string, () => (string | number)[][]][] = [
    ["日ごとの数字", () => [["日", "新規登録", "利用した人", "メモ", "カード練習", "PDF", "AI", "上限"], ...summary.daily.map((d: Any) => [d.d, d.signup, d.active, d.notes, d.practice, d.pdf, d.ai, d.limitHit])]],
    ["登録した週ごとの継続", () => [["週", "人数", "1日後", "3日後", "1週間後", "2週間後", "4週間後"], ...summary.cohorts.map((c: Any) => [c.week, c.n, ...["d1", "d3", "d7", "d14", "d28"].map((k) => (c.wrote[k].base ? (c.wrote[k].hit / c.wrote[k].base).toFixed(3) : ""))])]],
    ["来た場所ごと", () => [["来た場所", "媒体", "投稿", "登録", "2週間後の対象", "2週間後も書いている"], ...summary.sources.map((s: Any) => [s.source, s.medium, s.campaign, s.n, s.d14.base, s.d14.hit])]],
    ["職場ごと", () => [["職場", "温泉地・市町村", "利用者", "直近30日", "メモ", "上限", "導入済み"], ...(places?.list || []).map((p: Any) => [p.name, p.area, p.users, p.users30, p.notes, p.limitHits, p.adopted ? "はい" : ""])]],
    ["費用", () => [["日", "AI", "写真", "入力トークン", "出力トークン", "費用の目安（円）"], ...summary.cost.daily.map((d: Any) => [d.d, d.ai, d.photos, d.tokIn, d.tokOut, d.yen])]],
  ];
  return [card("集計の書き出し（CSV）", h("p", { class: "note" }, "数字だけを書き出します。メモの中身は書き出しません。"),
    h("div", { class: "stack" }, items.map(([name, rows]) => h("button", { class: "btn ghost small", onclick: () => download(`${name}_${day}.csv`, rows()) }, name))))];
}

// ---------- 入口 ----------
function loginView(): HTMLElement {
  const m = h("input", { type: "email", id: "amail", autocomplete: "email", placeholder: "運営者のメールアドレス" }) as HTMLInputElement;
  return h("div", { class: "view" }, h("section", { class: "card" }, h("span", { class: "label" }, "運営者だけ"), h("h2", null, "管理者ページ"),
    h("p", { class: "empty" }, "運営者のメールアドレスに、ログインのリンクを送ります。"), m,
    h("button", { class: "btn", id: "asend", onclick: async () => { try { await sendSignInLinkToEmail(auth, m.value.trim(), { url: location.origin + location.pathname + "#admin", handleCodeInApp: true }); localStorage.setItem(MAIL, m.value.trim()); toast("メールを送りました"); } catch (e) { toast("送れませんでした"); } } }, "リンクを送る")));
}
function draw(): void {
  if (!host) return;
  navEl.hidden = true; host.textContent = "";
  if (checking) { host.appendChild(h("p", { class: "empty center" }, "確かめています…")); return; }
  if (role !== "operator") { host.appendChild(auth.currentUser && !auth.currentUser.isAnonymous ? h("div", { class: "view" }, h("section", { class: "card" }, h("h2", null, "運営者だけが使えます"), h("button", { class: "btn ghost", onclick: () => signOut(auth) }, "ログアウト"))) : loginView()); return; }
  const head = h("div", { class: "stack" }, h("div", { class: "row", style: "justify-content:space-between" }, h("h2", null, "管理者ページ"), h("button", { class: "btn ghost small", id: "rebuild", disabled: busy, onclick: () => load(true) }, busy ? "集計中…" : "今すぐ集計")),
    h("p", { class: "note" }, summary ? `集計 ${new Date(summary.builtAt).toLocaleString("ja-JP")}（毎晩3時に作り直します）` : "まだ集計がありません。「今すぐ集計」を押してください。"),
    h("div", { class: "anav", role: "group", "aria-label": "ページ" }, SECS.map(([id, t]) => h("button", { "data-sec": id, "aria-pressed": String(sec === id), onclick: () => { sec = id; placeOpen = null; userOpen = null; draw(); scrollTo(0, 0); } }, t))));
  const parts = !summary ? [] : sec === "keep" ? keep() : sec === "use" ? use() : sec === "places" ? placeList() : sec === "users" ? userList() : sec === "content" ? content() : sec === "cost" ? cost() : sec === "csv" ? csv() : top();
  const key = [sec, placeOpen || "", userOpen || "", summary ? 1 : 0].join("/"), v = h("div", { class: `view admin${key !== lastKey ? " enter" : ""}` }, head, ...parts);
  lastKey = key; host.appendChild(v);
}
let started = false;
export async function renderAdmin(main: HTMLElement, nav: HTMLElement): Promise<void> {
  host = main; navEl = nav;
  if (!started) {
    started = true;
    if (isSignInWithEmailLink(auth, location.href)) {
      const mail = localStorage.getItem(MAIL) || "";
      try { await signInWithEmailLink(auth, mail, location.href); } catch (e) { toast("ログインのリンクが古いか、使えませんでした"); }
      history.replaceState(null, "", location.origin + location.pathname + "#admin");
    }
    auth.onAuthStateChanged(async () => { await checkRole(); draw(); if (role === "operator" && !loadedAt) await load(); });
  }
  draw();
}
