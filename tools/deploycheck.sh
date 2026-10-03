#!/usr/bin/env bash
# 測試 deploy.sh --check-only 的「.git/ 可否被網頁下載」檢查：
# 用 PHP 內建伺服器模擬「沒擋」（照常送出 .git/HEAD）、「擋住」（403／404）與轉址，
# 並驗證未設網址、連不上時只提醒不失敗。全程只連 127.0.0.1，不連外網。
# 這支只給開發者手動跑，不屬於正式部署流程。
# 用法：bash tools/deploycheck.sh　　全部符合預期結束碼 0
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v php >/dev/null 2>&1 || { echo "找不到 php"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "找不到 curl"; exit 1; }

TMP="$(mktemp -d)"
PIDFILE="$TMP/server.pid"
stop_server() { [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null; rm -f "$PIDFILE"; }
trap 'stop_server; rm -rf "$TMP"' EXIT

# 假站台：只放 deploy.sh 與一份假的 .git/HEAD，不碰真正的 .git
SITE="$TMP/site"
mkdir -p "$SITE/.git"
cp "$ROOT/deploy.sh" "$SITE/"
printf 'ref: refs/heads/main\n' > "$SITE/.git/HEAD"
cat > "$TMP/router_block.php" <<'P'
<?php
if (preg_match('#/\.git#', $_SERVER['REQUEST_URI'])) { http_response_code(403); echo 'Forbidden'; return true; }
return false;
P
cat > "$TMP/router_404.php" <<'P'
<?php
if (preg_match('#/\.git#', $_SERVER['REQUEST_URI'])) { http_response_code(404); echo 'Not Found'; return true; }
return false;
P
cat > "$TMP/router_open.php" <<'P'
<?php return false;
P
cat > "$TMP/router_redirect.php" <<'P'
<?php
if (preg_match('#/\.git#', $_SERVER['REQUEST_URI'])) { header('Location: /elsewhere', true, 301); return true; }
return false;
P
cat > "$TMP/router_spa.php" <<'P'
<?php
echo '<!doctype html><title>app</title>'; return true;
P

FAILED=0
expect() { # 名稱 條件結果
  if [ "$2" -eq 0 ]; then echo "通過  $1"; else echo "失敗  $1"; FAILED=$((FAILED + 1)); fi
}

run_case() { # 名稱 router 預期結束碼 預期輸出片段 不應出現的片段
  local name="$1" router="$2" want_code="$3" want_text="$4" deny_text="$5" port out code i
  port=$((20000 + RANDOM % 20000))
  PHP_CLI_SERVER_WORKERS=4 php -S "127.0.0.1:$port" -t "$SITE" "$TMP/$router" >/dev/null 2>&1 &
  echo $! > "$PIDFILE"
  for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$port/" && break; sleep 0.3; done
  out="$(cd "$SITE" && DEPLOY_CHECK_URL="http://127.0.0.1:$port" bash ./deploy.sh --check-only 2>&1)"; code=$?
  stop_server
  [ "$code" -eq "$want_code" ]; expect "$name：結束碼 $want_code（實際 $code）" $?
  grep -qF "$want_text" <<< "$out"; expect "$name：輸出含「$want_text」" $?
  if [ -n "$deny_text" ]; then ! grep -qF "$deny_text" <<< "$out"; expect "$name：輸出不含「$deny_text」" $?; fi
  [ "${SHOW:-0}" = 1 ] && echo "$out"
}

run_case "沒擋（應嚴重警告）" router_open.php 1 "嚴重：.git/ 可被網頁直接下載" "無法被網頁下載"
run_case "沒擋（應印出 nginx 片段）" router_open.php 1 'location ~ /\.git { deny all; return 404; }' ""
run_case "已擋 403（應通過）" router_block.php 0 ".git/ 無法被網頁下載（回 403）" "嚴重"
run_case "已擋 404（應通過）" router_404.php 0 ".git/ 無法被網頁下載（回 404）" "嚴重"
run_case "轉址（只警告）" router_redirect.php 0 "轉址" "嚴重"
run_case "回 200 但不是 git 內容（不誤報）" router_spa.php 0 ".git/ 無法被網頁下載（回 200）" "嚴重"

# 沒設 DEPLOY_CHECK_URL：略過並提醒，不失敗
out="$(cd "$SITE" && env -u DEPLOY_CHECK_URL bash ./deploy.sh --check-only 2>&1)"; code=$?
[ "$code" -eq 0 ]; expect "未設檢查網址：不失敗" $?
grep -qF "未設定檢查網址" <<< "$out"; expect "未設定檢查網址：有提醒" $?
grep -qF "DEPLOY_CHECK_URL=https://example.com/project ./deploy.sh" <<< "$out"; expect "未設檢查網址：提醒含範例用法" $?

# 連不上：略過，不讓整體失敗
out="$(cd "$SITE" && DEPLOY_CHECK_URL="http://127.0.0.1:9" bash ./deploy.sh --check-only 2>&1)"; code=$?
[ "$code" -eq 0 ]; expect "連不上：不失敗" $?
grep -qF "連不上" <<< "$out"; expect "連不上：有提醒" $?

echo
if [ "$FAILED" -eq 0 ]; then echo "deploycheck 全部通過"; exit 0; fi
echo "deploycheck $FAILED 項失敗"; exit 1
