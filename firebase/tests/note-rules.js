// 新人向けアプリの読み書きの決まり（firestore.rules、storage.rules）を、エミュレーターで確かめる。
// 本物のログインの代わりに、エミュレーターが受け付ける「署名なしの印」を使う。
// 使い方: エミュレーターを動かしてから node tests/note-rules.js
const P = "demo-yado", H = "http://127.0.0.1";
const FS = `${H}:8080/v1/projects/${P}/databases/(default)/documents`;
const ST = `${H}:9199/v0/b/${P}.appspot.com/o`;
const results = [];
const ok = (name, cond, extra) => results.push([cond ? "OK" : "NG", name, extra || ""]);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(uid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ iss: `https://securetoken.google.com/${P}`, aud: P, auth_time: now, user_id: uid, sub: uid, iat: now, exp: now + 3600,
    firebase: { sign_in_provider: "anonymous", identities: {} }, ...claims })}.`;
}
const T = { a: token("userA"), b: token("userB"), op: token("opUser", { role: "operator" }), owner: "owner" };
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? { integerValue: String(v) } : typeof v === "boolean" ? { booleanValue: v } : typeof v === "object" ? { mapValue: { fields: fields(v) } } : { stringValue: String(v) }]));
async function req(method, path, who, body) {
  const r = await fetch(`${FS}/${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${T[who] || who}` }, body: body ? JSON.stringify({ fields: fields(body) }) : undefined });
  return r.status;
}
const get = (path, who) => req("GET", path, who);
const put = (path, who, body) => req("PATCH", path, who, body);
const del = (path, who) => req("DELETE", path, who);
async function list(parent, coll, who, collectionGroup = false) {
  const r = await fetch(`${FS}${parent ? "/" + parent : ""}:runQuery`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${T[who] || who}` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: coll, allDescendants: collectionGroup }], limit: 5 } }) });
  return r.status;
}
const allowed = (s) => s === 200, denied = (s) => s === 403;

(async () => {
  await fetch(`${H}:8080/emulator/v1/projects/${P}/databases/(default)/documents`, { method: "DELETE" });
  const now = Date.now();
  // 準備：本人Aの登録、メモ、カード。職場1つ
  ok("本人は自分の登録を作れる", allowed(await put("users/userA", "a", { createdAt: now, lastAt: now, consent: { version: "v", termsVersion: "t", at: now, text: "x" } })));
  ok("登録に、決まっていない項目は足せない", denied(await put("users/userA", "a", { createdAt: now, name: "山田" })));
  ok("登録した日は、あとから変えられない", denied(await put("users/userA", "a", { createdAt: now - 99999, lastAt: now })));
  ok("ほかの人の登録は作れない", denied(await put("users/userA2", "b", { createdAt: now })));
  ok("本人はメモを書ける", allowed(await put("users/userA/notes/n1", "a", { text: "シーツの替え方", heading: "steps", createdAt: now })));
  ok("本人はメモを読める", allowed(await get("users/userA/notes/n1", "a")));
  ok("ほかの新人は、メモを読めない", denied(await get("users/userA/notes/n1", "b")));
  ok("ほかの新人は、メモの一覧も読めない", denied(await list("users/userA", "notes", "b")));
  ok("ほかの新人は、メモを書きかえられない", denied(await put("users/userA/notes/n1", "b", { text: "x" })));
  ok("ほかの新人は、メモを消せない", denied(await del("users/userA/notes/n1", "b")));
  ok("運営者も、メモを直接は読めない（関数を通して記録を残す）", denied(await get("users/userA/notes/n1", "op")));
  ok("運営者も、全員のメモをまとめて読めない", denied(await list("", "notes", "op", true)));
  ok("ほかの新人は、カードを読めない", allowed(await put("users/userA/cards/c1", "a", { front: "リネン", back: "シーツ" })) && denied(await get("users/userA/cards/c1", "b")));
  ok("運営者は、登録の情報を読める", allowed(await get("users/userA", "op")));
  ok("ほかの新人は、登録の情報を読めない", denied(await get("users/userA", "b")));
  ok("写真の枠は、本人も作れない", denied(await put("users/userA/slots/s1", "a", { at: now })));
  // 職場
  await put("workplaces/w1", "owner", { name: "みずなら亭", area: "山の温泉", norm: "みずなら亭", mergedInto: "", adopted: false });
  ok("職場の一覧は、ログインした人なら読める", allowed(await get("workplaces/w1", "b")));
  ok("職場を、画面から直接は足せない（表記をそろえるため関数を通す）", denied(await put("workplaces/w2", "a", { name: "x", area: "y", norm: "x", mergedInto: "", adopted: false })));
  ok("職場の「導入済み」を、新人は変えられない", denied(await put("workplaces/w1", "a", { name: "みずなら亭", area: "山の温泉", norm: "みずなら亭", mergedInto: "", adopted: true })));
  // 計測のイベント
  ok("本人は、自分のイベントを足せる", allowed(await put("events/e1", "a", { uid: "userA", type: "note_save", ts: now, wid: "w1", dept: "clean", device: "ios", meta: {} })));
  ok("ほかの人の名前でイベントは足せない", denied(await put("events/e2", "a", { uid: "userB", type: "open", ts: now, wid: "", dept: "", device: "ios", meta: {} })));
  ok("決まっていない種類のイベントは足せない", denied(await put("events/e3", "a", { uid: "userA", type: "hack", ts: now, wid: "", dept: "", device: "ios", meta: {} })));
  ok("イベントに、名前などの項目は足せない", denied(await put("events/e4", "a", { uid: "userA", type: "open", ts: now, wid: "", dept: "", device: "ios", meta: {}, email: "a@example.com" })));
  ok("新人は、イベントを読めない", denied(await get("events/e1", "a")));
  ok("運営者は、イベントを読める", allowed(await get("events/e1", "op")));
  // 集計と、見た記録
  await put("stats/summary", "owner", { builtAt: now }); await put("auditLogs/x1", "owner", { by: "opUser", target: "userA", at: now });
  ok("新人は、集計を読めない", denied(await get("stats/summary", "a")));
  ok("運営者は、集計を読める", allowed(await get("stats/summary", "op")));
  ok("運営者も、集計や見た記録を書きかえられない", denied(await put("stats/summary", "op", { builtAt: 1 })) && denied(await put("auditLogs/x1", "op", { by: "x" })));
  ok("新人は、見た記録を読めない", denied(await get("auditLogs/x1", "a")));
  ok("上限の記録は、本人も読み書きできない", denied(await get("usage/userA_2026-11-17", "a")) && denied(await put("usage/userA_2026-11-17", "a", { ai: 0 })));
  // 旅館向けアプリのデータには、新人向けアプリの人は入れない
  ok("新人向けアプリの人は、旅館向けアプリのデータを読めない", denied(await list("inns/entaiji", "questions", "a")));

  // 写真（storage.rules）
  const up = async (who, path) => (await fetch(`${ST}?name=${encodeURIComponent(path)}`, { method: "POST", headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${T[who]}` }, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) })).status;
  ok("枠のない写真は送れない", (await up("a", "users/userA/photos/nos.jpg")) === 403);
  await put("users/userA/slots/s2", "owner", { at: now });
  ok("枠のある写真は送れる", (await up("a", "users/userA/photos/s2")) === 200);
  ok("ほかの人の場所には送れない", (await up("b", "users/userA/photos/s2")) === 403);
  const rd = async (who, path) => (await fetch(`${ST}/${encodeURIComponent(path)}?alt=media`, { headers: { Authorization: `Bearer ${T[who]}` } })).status;
  ok("本人は写真を見られる", (await rd("a", "users/userA/photos/s2")) === 200);
  ok("ほかの新人は写真を見られない", (await rd("b", "users/userA/photos/s2")) === 403);

  for (const [r, n, x] of results) console.log(`${r}  ${n}${x ? "  （" + x + "）" : ""}`);
  process.exit(results.some((r) => r[0] === "NG") ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
