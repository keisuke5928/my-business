// 宿のはじめて帳 本番用のつなぎの部品
// アプリ本体（src/app.html）は、Claudeのアーティファクトと同じ呼び方（window.claude.use("db" | "user" | "sample")）で
// データとAIを使う。本番では、この部品がその呼び方を Firebase（Firestore、Authentication、Cloud Functions）につなぐ。
import { initializeApp } from "firebase/app";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInAnonymously,
  isSignInWithEmailLink, sendSignInLinkToEmail, signInWithEmailLink,
} from "firebase/auth";
import {
  getFirestore, connectFirestoreEmulator, collection, doc, query, orderBy, limit, where,
  onSnapshot, getDoc, getDocs, setDoc, addDoc, deleteDoc,
} from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

const CFG = window.YADO_FIREBASE || {};
const INN = CFG.inn;
const app = initializeApp(CFG.config);
const auth = getAuth(app);
const fs = getFirestore(app);
const fn = getFunctions(app, "asia-northeast1");
if (CFG.emulator) {
  const h = CFG.emulator.host || "127.0.0.1";
  connectAuthEmulator(auth, `http://${h}:${CFG.emulator.auth || 9099}`, { disableWarnings: true });
  connectFirestoreEmulator(fs, h, CFG.emulator.firestore || 8080);
  connectFunctionsEmulator(fn, h, CFG.emulator.functions || 5001);
}
const call = (name, timeout) => httpsCallable(fn, name, timeout ? { timeout } : undefined);
const EMAIL_KEY = "yado-login-email";
const here = () => location.origin + location.pathname;

// ---------- 画面の上にかぶせる案内（ログインや招待の案内） ----------
function overlay(html) {
  let el = document.getElementById("yado-gate");
  if (!el) {
    el = document.createElement("div");
    el.id = "yado-gate";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.style.cssText = "position:fixed;inset:0;z-index:50;background:var(--bg,#f3f5f2);color:var(--ink,#1b2430);display:grid;place-items:center;padding:24px max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px));overflow:auto";
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="card" style="max-width:420px;width:100%">${html}</div>`;
  return el;
}
function closeOverlay() {
  const el = document.getElementById("yado-gate");
  if (el) el.remove();
}
const msgOf = (e, d) => String((e && e.message) || d || "").replace(/\s*\[\d+\]\s*$/, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function showLogin(note) {
  const el = overlay(`<span class="label">管理者のログイン</span><h2>${esc(CFG.name || "")}</h2>
    <p class="empty">登録されたメールアドレスを入れてください。ログインのリンクをメールで送ります。パスワードはいりません。</p>
    ${note ? `<p class="note">${esc(note)}</p>` : ""}
    <form id="yado-login" class="row" style="flex-direction:column;align-items:stretch;gap:8px">
      <label class="field">メールアドレス<input id="yado-email" type="email" autocomplete="email" required></label>
      <button class="btn" type="submit">ログインのリンクを送る</button>
    </form><p class="err" id="yado-login-msg" hidden></p>`);
  el.querySelector("#yado-login").onsubmit = async (e) => {
    e.preventDefault();
    const email = el.querySelector("#yado-email").value.trim();
    const msg = el.querySelector("#yado-login-msg");
    try {
      await sendSignInLinkToEmail(auth, email, { url: here() + "#login", handleCodeInApp: true });
      try { localStorage.setItem(EMAIL_KEY, email); } catch (e2) { /* 保存できなくても続ける */ }
      msg.hidden = false; msg.className = "note";
      msg.textContent = "メールを送りました。このスマホで、メールの中のリンクを開いてください。";
    } catch (err) {
      msg.hidden = false; msg.className = "err";
      msg.textContent = "送れませんでした。メールアドレスを確かめて、もう一度試してください。";
    }
  };
}
function showNotMember(text) {
  overlay(`<span class="label">${esc(CFG.name || "宿のはじめて帳")}</span><h2>リンクから開いてください</h2>
    <p class="empty">${esc(text || "受け入れ担当から届いたリンク（LINEなど）を開くと使えます。")}</p>
    <p class="note"><a href="#login" id="yado-to-login">管理者の方はこちら</a></p>`);
  document.getElementById("yado-to-login").onclick = (e) => { e.preventDefault(); location.hash = "login"; showLogin(); };
}

// ---------- 起動：ログイン、招待、役割 ----------
function currentUser() {
  return new Promise((res) => { const off = onAuthStateChanged(auth, (u) => { off(); res(u); }); });
}
async function boot() {
  // メールのリンクから戻ってきたとき
  if (isSignInWithEmailLink(auth, location.href)) {
    let email = null;
    try { email = localStorage.getItem(EMAIL_KEY); } catch (e) { /* なし */ }
    if (!email) {
      showLogin("このスマホでは、メールアドレスが分かりません。もう一度、メールアドレスを入れてください。");
      return { role: null };
    }
    try {
      await signInWithEmailLink(auth, email, location.href);
      try { localStorage.removeItem(EMAIL_KEY); } catch (e) { /* なし */ }
    } catch (e) {
      showLogin("ログインのリンクが古いか、使えませんでした。もう一度送ってください。");
      return { role: null };
    }
    history.replaceState(null, "", here());
  }
  let user = auth.currentUser || (await currentUser());
  if (!user) user = (await signInAnonymously(auth)).user;

  // 招待リンク（#join-合言葉）
  const m = location.hash.match(/^#join-([A-Za-z0-9_-]{8,40})$/);
  if (m) {
    try {
      const r = await call("join")({ inn: INN, code: m[1] });
      if (r.data && r.data.refresh) await user.getIdToken(true);
      history.replaceState(null, "", here());
    } catch (e) {
      showNotMember(msgOf(e, "招待リンクが使えませんでした。受け入れ担当に新しいリンクをもらってください。"));
      return { role: null };
    }
  }
  if (location.hash === "#login" && user.isAnonymous) {
    showLogin();
    return { role: null };
  }

  if (!user.isAnonymous) {
    try {
      const w = await call("whoami")({});
      if (w.data && w.data.refresh) await user.getIdToken(true);
    } catch (e) { /* 役割の確認に失敗しても、手元の情報で続ける */ }
  }
  const t = await user.getIdTokenResult();
  const role = t.claims.role || null;
  const inn = t.claims.inn || null;
  let r = null;
  if (role === "operator") r = "operator";
  else if (inn === INN && (role === "admin" || role === "staff")) r = role;
  if (!r) {
    showNotMember(user.isAnonymous ? null : "このメールアドレスは、まだこの宿の管理者として登録されていません。運営者に連絡してください。");
    return { role: null };
  }
  if (r !== "staff") {
    try {
      const v = await call("invite")({ inn: INN });
      RT.inviteUrl = here() + "#join-" + v.data.code;
    } catch (e) { /* 招待リンクは後で作り直せる */ }
  }
  if (location.hash === "#login") history.replaceState(null, "", here());
  closeOverlay();
  STATE.uid = user.uid;
  STATE.role = r;
  return { role: r, startAdmin: r !== "staff" };
}

const STATE = { uid: null, role: null };
const RT = {
  inn: INN,
  inviteUrl: null,
  ready: null,
  async grantAdmin(email) {
    try { await call("grantAdmin")({ inn: INN, email }); }
    catch (e) { throw new Error(msgOf(e, "管理者にできませんでした")); }
  },
  async rotateInvite() {
    try { const v = await call("invite")({ inn: INN, rotate: true }); RT.inviteUrl = here() + "#join-" + v.data.code; }
    catch (e) { throw new Error(msgOf(e, "作り直せませんでした")); }
  },
};
RT.ready = boot().catch((e) => {
  showNotMember("つながりませんでした。電波のよい所で、もう一度開いてください。");
  return { role: null };
});
window.YADO_RUNTIME = RT;

// ---------- データ（アーティファクトの db と同じ呼び方） ----------
const P = (p) => `inns/${INN}/${p}`;
function mapErr(err) {
  const c = (err && err.code) || "";
  if (c.includes("permission-denied")) return { code: "invalid_argument", message: "この操作はできません" };
  if (c.includes("resource-exhausted")) return { code: "resource_exhausted", message: "混み合っています" };
  if (c.includes("invalid-argument")) return { code: "invalid_argument", message: err.message };
  return { code: "unavailable", message: (err && err.message) || "つながりません" };
}
const wrap = (p) => p.catch((e) => { throw mapErr(e); });
function snapDoc(d) {
  return { id: d.id, exists: d.exists(), data: () => d.data(), metadata: { fromCache: d.metadata.fromCache, hasPendingWrites: d.metadata.hasPendingWrites } };
}
function snapQuery(s) {
  return { docs: s.docs.map(snapDoc), size: s.size, empty: s.empty,
    metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites }, docChanges: () => [] };
}
function docRef(path) {
  const r = doc(fs, P(path));
  return {
    id: r.id, path,
    get: () => wrap(getDoc(r)).then(snapDoc),
    set: (d) => wrap(setDoc(r, d)),
    // アーティファクトの update は、入れ子の項目をまとめて足す。Firestore では merge で同じ動きにする
    update: (d) => wrap(setDoc(r, d, { merge: true })),
    delete: () => wrap(deleteDoc(r)),
    onSnapshot: (next, error) => onSnapshot(r, { includeMetadataChanges: true }, (s) => next(snapDoc(s)), (e) => error && error(mapErr(e))),
    collection: (sub) => coll(`${path}/${sub}`),
  };
}
function coll(path, cons = []) {
  const base = collection(fs, P(path));
  const q = () => (cons.length ? query(base, ...cons) : base);
  return {
    path,
    where: (f, op, v) => coll(path, [...cons, where(f, op, v)]),
    orderBy: (f, dir) => coll(path, [...cons, orderBy(f, dir || "asc")]),
    limit: (n) => coll(path, [...cons, limit(n)]),
    get: () => wrap(getDocs(q())).then(snapQuery),
    onSnapshot: (next, error) => onSnapshot(q(), { includeMetadataChanges: true }, (s) => next(snapQuery(s)), (e) => error && error(mapErr(e))),
    doc: (id) => docRef(`${path}/${id || doc(base).id}`),
    add: async (d) => { const r = await wrap(addDoc(base, d)); return docRef(`${path}/${r.id}`); },
  };
}
const DB = { collection: (p) => coll(p), doc: (p) => docRef(p) };

// ---------- ログインした人 ----------
const USER = {
  id: async () => STATE.uid,
  isOwner: async () => STATE.role === "operator",
  canEdit: async () => STATE.role === "admin" || STATE.role === "operator",
  can: async () => true,
  me: async () => ({ id: STATE.uid, name: "", isOwner: STATE.role === "operator", canEdit: STATE.role !== "staff" }),
};

// ---------- AI（アーティファクトの sample と同じ呼び方） ----------
const aiCall = call("ai", 130000);
function splitAt(text) {
  // 「新人の質問：」の前までは毎回同じ（宿の資料）なので、そこまでをキャッシュする
  const all = [...text.matchAll(/\n(新人の質問|質問)：/g)];
  return all.length ? all[all.length - 1].index : 0;
}
async function runAi(input, opts, json) {
  const text = typeof input === "string" ? input : (input || []).map((m) => m.content).join("\n\n");
  if (opts && opts.signal && opts.signal.aborted) throw { code: "cancelled", message: "" };
  let r;
  try {
    r = await aiCall({ inn: INN, input: text, json, tier: opts && opts.modelTier === "quick" ? "quick" : "default", split: splitAt(text) });
  } catch (e) {
    const c = (e && e.code) || "";
    if (c.includes("resource-exhausted")) throw { code: "rate_limited", message: e.message };
    if (c.includes("failed-precondition")) throw { code: "refused", message: e.message };
    if (c.includes("permission-denied") || c.includes("unauthenticated")) throw { code: "not_granted", message: e.message };
    throw { code: "unavailable", message: (e && e.message) || "" };
  }
  if (opts && opts.signal && opts.signal.aborted) throw { code: "cancelled", message: "" };
  return r.data;
}
const SAMPLE = async (input, opts) => { const d = await runAi(input, opts, false); return { text: d.text || "", truncated: !!d.truncated }; };
SAMPLE.json = async (input, opts) => (await runAi(input, opts, true)).value;
SAMPLE.limits = async () => ({ images: false });

window.claude = {
  use: async (name) => {
    const info = await RT.ready;
    if (!info || !info.role) return null;
    if (name === "db") return DB;
    if (name === "user") return USER;
    if (name === "sample") return SAMPLE;
    return null;
  },
};
