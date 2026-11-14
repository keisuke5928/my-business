#!/usr/bin/env python3
"""宿のはじめて帳 ビルド

アプリ本体（src/app.html）に、宿ごとのデータ（inns/<id>.json）を埋め込み、
1つのHTMLにまとめる。

使い方:
  python3 build.py            すべての宿を dist/<id>.html に出す
  python3 build.py entaiji    その宿だけ出す

公開用の index.html と live.html は、PUBLISH に書いた宿から同じ内容で作る。
どちらも手で直さず、src/app.html か inns/<id>.json を直してからビルドする。
"""
import json, pathlib, sys

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


def render(app, inn, title):
    data = json.dumps(inn, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    for mark in ("/*__INN_DATA__*/null", "/*__TITLE__*/"):
        if app.count(mark) != 1:
            sys.exit(f"src/app.html に {mark} がちょうど1つ必要です")
    return app.replace("/*__INN_DATA__*/null", data).replace("/*__TITLE__*/", title)


def main():
    app = APP.read_text(encoding="utf-8")
    want = sys.argv[1:]
    paths = sorted(INNS.glob("*.json"))
    inns = {}
    for p in paths:
        inn = json.loads(p.read_text(encoding="utf-8"))
        check(inn, p)
        if inn["id"] != p.stem:
            sys.exit(f"{p.name}: id は ファイル名と同じ「{p.stem}」にしてください")
        inns[inn["id"]] = inn
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
