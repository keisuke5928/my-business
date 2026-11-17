#!/usr/bin/env bash
# 宿のはじめて帳を、本番（Firebase）に公開する。
# 使い方: bash scripts/deploy.sh <FirebaseのプロジェクトID>
# 先に docs/deploy.md の「1. 吉田さんが用意するもの」を済ませておく。
# 何度動かしても大丈夫（2回目からは、変わった所だけが公開される）。
set -euo pipefail

PROJECT="${1:-}"
if [ -z "$PROJECT" ]; then
  echo "使い方: bash scripts/deploy.sh <FirebaseのプロジェクトID>"
  exit 1
fi
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
FB=(npx --yes firebase-tools@15.36.0)

# 1. 設定ファイル
CFG="firebase/config.json"
if [ ! -f "$CFG" ]; then
  echo "firebase/config.json がありません。docs/deploy.md の手順4を見て作ってください。"
  exit 1
fi
CFG_PROJECT="$(python3 -c "import json;print(json.load(open('$CFG'))['config'].get('projectId',''))")"
if [ "$CFG_PROJECT" != "$PROJECT" ]; then
  echo "firebase/config.json の projectId（$CFG_PROJECT）と、指定したプロジェクトID（$PROJECT）が違います。"
  exit 1
fi

# 2. ログイン（はじめての時だけ、ブラウザでGoogleにログインする）
if ! "${FB[@]}" projects:list >/dev/null 2>&1; then
  echo "Firebase にログインします。表示されるURLを開いて、Googleのアカウントでログインしてください。"
  "${FB[@]}" login --no-localhost
fi

# 3. 運営者のメールアドレス（サーバーの設定。はじめての時だけ聞く）
ENVF="firebase/functions/.env.$PROJECT"
if [ ! -f "$ENVF" ]; then
  read -r -p "運営者（吉田さん）のメールアドレス: " OP
  {
    echo "OPERATOR_EMAIL=$OP"
    echo "AI_DAILY_LIMIT=300"
    echo "AI_MODEL=claude-opus-5-5"
  } > "$ENVF"
  echo "$ENVF に保存しました（GitHub には入りません）。"
fi

# 4. AnthropicのAPIキー（サーバーの秘密の置き場所に入れる。はじめての時だけ聞く）
if ! "${FB[@]}" functions:secrets:access ANTHROPIC_API_KEY --project "$PROJECT" >/dev/null 2>&1; then
  echo "AnthropicのAPIキーを登録します。次に聞かれたら、キーを貼りつけてEnterを押してください（画面には出ません）。"
  "${FB[@]}" functions:secrets:set ANTHROPIC_API_KEY --project "$PROJECT"
fi

# 5. 本番用のページを作る（旅館向けアプリとホームページ、そのあと新人向けアプリ）
python3 build.py --firebase "$CFG"
(cd firebase/functions && npm ci --omit=dev --no-audit --no-fund)
(cd firebase/functions-note && npm ci --no-audit --no-fund && npm run build)
(cd apps/note && npm ci --no-audit --no-fund && NOTE_CONFIG="$ROOT/$CFG" npm run build)

# 6. 公開する（読み書きの決まり、サーバー側の処理、ページ）
cd firebase
"${FB[@]}" deploy --project "$PROJECT" --only firestore,functions,hosting,storage --non-interactive

echo
echo "公開しました。"
echo "  ホームページ        https://$PROJECT.web.app/"
echo "  新人向けアプリ      https://$PROJECT.web.app/note/"
echo "  管理者ページ        https://$PROJECT.web.app/note/#admin"
for INN in $(python3 -c "import json;print(' '.join(json.load(open('$ROOT/$CFG'))['inns']))"); do
  echo "  運営者のログイン    https://$PROJECT.web.app/$INN/#login"
done
