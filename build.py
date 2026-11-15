#!/usr/bin/env python3
"""宿のはじめて帳 ビルド

アプリ本体（src/app.html）に、宿ごとのデータ（inns/<id>.json）を埋め込み、
1つのHTMLにまとめる。

使い方:
  python3 build.py            すべての宿を dist/<id>.html に出す（デモ用。Claudeのアーティファクトやファイルで開く）
  python3 build.py entaiji    その宿だけ出す
  python3 build.py --firebase firebase/config.json
                              本番用。firebase/public/<id>/index.html とつなぎの部品（runtime.js）を作る

公開用の index.html と live.html は、PUBLISH に書いた宿から同じ内容で作る。
どちらも手で直さず、src/app.html か inns/<id>.json を直してからビルドする。
"""
import json, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT / "src" / "app.html"
INNS = ROOT / "inns"
DIST = ROOT / "dist"

# 公開しているページ（Claudeのアーティファクト）のもとになるファイル。{出力ファイル: (宿のid, 題名)}
PUBLISH = {
    "index.html": ("entaiji", "宿のはじめて帳 延対寺荘"),
    "live.html": ("entaiji", "宿のはじめて帳 共有版"),
}

REQUIRED = ["id", "name", "host", "note", "profile", "meetStep", "defaultSchedule", "bring",
            "staff", "terms", "lessons", "kb", "jobs", "suggest", "placeholders", "mapNote"]


def check(inn, path):
    missing = [k for k in REQUIRED if k not in inn]
    if missing:
        sys.exit(f"{path.name}: 足りない項目があります: {', '.join(missing)}")
    ids = [l["id"] for l in inn["lessons"]]
    if len(ids) != len(set(ids)):
        sys.exit(f"{path.name}: 教材の id が重なっています")
    titles = {l["title"] for l in inn["lessons"]}
    for job, j in inn["jobs"].items():
        for t in j.get("lessons", []):
            if t not in titles:
                sys.exit(f"{path.name}: 職種「{job}」の教材「{t}」が lessons にありません")
    for l in inn["lessons"]:
        for q in l.get("quiz", []):
            if not (0 <= q["a"] < len(q["o"])):
                sys.exit(f"{path.name}: 教材「{l['title']}」のテストの正解番号が範囲の外です")
    for key in ("fallbackLesson", "tourLesson"):
        if inn.get(key) and inn[key] not in ids:
            sys.exit(f"{path.name}: {key} の教材 id「{inn[key]}」が lessons にありません")


def render(app, inn, title, runtime=""):
    data = json.dumps(inn, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    if app.count("<!--__RUNTIME__-->") != 1:
        sys.exit("src/app.html に <!--__RUNTIME__--> がちょうど1つ必要です")
    app = app.replace("<!--__RUNTIME__-->", runtime)
    for mark in ("/*__INN_DATA__*/null", "/*__TITLE__*/"):
        if app.count(mark) != 1:
            sys.exit(f"src/app.html に {mark} がちょうど1つ必要です")
    return app.replace("/*__INN_DATA__*/null", data).replace("/*__TITLE__*/", title)


FIREBASE = ROOT / "firebase"


def build_firebase(cfg_path, inns, app):
    cfg = json.loads(pathlib.Path(cfg_path).read_text(encoding="utf-8"))
    for k in ("config", "inns"):
        if k not in cfg:
            sys.exit(f"{cfg_path}: 「{k}」がありません（firebase/config.example.json を見てください）")
    rt = FIREBASE / "runtime"
    if not (rt / "node_modules").exists():
        subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=rt, check=True)
    subprocess.run(["npm", "run", "build", "--silent"], cwd=rt, check=True)
    pub = FIREBASE / "public"
    pub.mkdir(exist_ok=True)
    for iid in cfg["inns"]:
        if iid not in inns:
            sys.exit(f"inns/{iid}.json がありません")
        inn = dict(inns[iid])
        inn.pop("appUrl", None)
        boot = {"config": cfg["config"], "inn": iid, "name": inn["name"]}
        if cfg.get("emulator"):
            boot["emulator"] = cfg["emulator"]
        runtime = ("<script>window.YADO_FIREBASE=" + json.dumps(boot, ensure_ascii=False).replace("</", "<\\/")
                   + ";</script>\n<script src=\"../runtime.js\"></script>")
        out = pub / iid
        out.mkdir(exist_ok=True)
        (out / "index.html").write_text(render(app, inn, f"宿のはじめて帳 {inn['name']}", runtime), encoding="utf-8")
        print(f"firebase/public/{iid}/index.html を作りました（{inn['name']}）")
    (pub / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\">"
        "<title>宿のはじめて帳</title><body style=\"font-family:system-ui,sans-serif;padding:24px;line-height:1.7\">"
        "<h1 style=\"font-size:1.3rem\">宿のはじめて帳</h1><p>旅館から届いたリンクを開いてください。</p></body>",
        encoding="utf-8")


def main():
    app = APP.read_text(encoding="utf-8")
    args = sys.argv[1:]
    fb = None
    if args and args[0] == "--firebase":
        if len(args) < 2:
            sys.exit("使い方: python3 build.py --firebase firebase/config.json")
        fb, args = args[1], []
    want = args
    paths = sorted(INNS.glob("*.json"))
    inns = {}
    for p in paths:
        inn = json.loads(p.read_text(encoding="utf-8"))
        check(inn, p)
        if inn["id"] != p.stem:
            sys.exit(f"{p.name}: id は ファイル名と同じ「{p.stem}」にしてください")
        inns[inn["id"]] = inn
    if fb:
        build_firebase(fb, inns, app)
        return
    for w in want:
        if w not in inns:
            sys.exit(f"inns/{w}.json がありません")
    DIST.mkdir(exist_ok=True)
    for iid, inn in inns.items():
        if want and iid not in want:
            continue
        out = DIST / f"{iid}.html"
        out.write_text(render(app, inn, f"宿のはじめて帳 {inn['name']}"), encoding="utf-8")
        print(f"dist/{iid}.html を作りました（{inn['name']}）")
    for name, (iid, title) in PUBLISH.items():
        if want and iid not in want:
            continue
        (ROOT / name).write_text(render(app, inns[iid], title), encoding="utf-8")
        print(f"{name} を作りました（{title}）")


if __name__ == "__main__":
    main()
