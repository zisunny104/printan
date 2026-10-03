#!/usr/bin/env bash
# 測試 deploy.sh 的外洩檢查與 --set-check-url。
# 用 PHP 內建伺服器模擬沒擋、擋住 403／404、轉址與非 git 的 200，全程只連 127.0.0.1。
# 這支只給開發者手動跑，不屬於正式部署流程。
# 用法：bash tools/deploycheck.sh　　全部符合預期結束碼 0
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
command -v php >/dev/null 2>&1 || { echo "找不到 php"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "找不到 curl"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "找不到 python3"; exit 1; }

TMP="$(mktemp -d)"
PIDFILE="$TMP/server.pid"
stop_server() { [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null; rm -f "$PIDFILE"; }
trap 'stop_server; rm -rf "$TMP"' EXIT

# 假站台：只放 deploy.sh，不碰真正的 .git
SITE="$TMP/site"
mkdir -p "$SITE"
cp "$ROOT/deploy.sh" "$SITE/"
cat > "$TMP/router_block.php" <<'P'
<?php
if (preg_match('#/\.git#', $_SERVER['REQUEST_URI'])) { http_response_code(403); echo 'Forbidden'; return true; }
return true;
P
cat > "$TMP/router_404.php" <<'P'
<?php
if (preg_match('#/\.git#', $_SERVER['REQUEST_URI'])) { http_response_code(404); echo 'Not Found'; return true; }
return true;
P
cat > "$TMP/router_open.php" <<'P'
<?php
if (preg_match('#/\.git/HEAD$#', $_SERVER['REQUEST_URI'])) { echo "ref: refs/heads/main\n"; return true; }
return true;
P
cat > "$TMP/router_redirect.php" <<'P'
<?php
if (preg_match('#/\.git#', $_SERVER['REQUEST_URI'])) { header('Location: /elsewhere', true, 302); return true; }
return true;
P
cat > "$TMP/router_spa.php" <<'P'
<?php
echo '<!doctype html><title>app</title>'; return true;
P
# /ok 底下擋住，/leak 底下外洩，用來驗證環境變數與檔案的優先序
cat > "$TMP/router_split.php" <<'P'
<?php
$u = $_SERVER['REQUEST_URI'];
if (preg_match('#^/leak/\.git/HEAD$#', $u)) { echo "ref: refs/heads/main\n"; return true; }
if (preg_match('#/\.git#', $u)) { http_response_code(404); return true; }
return true;
P

FAILED=0
expect() { # 名稱 條件結果
  if [ "$2" -eq 0 ]; then echo "通過  $1"; else echo "失敗  $1"; FAILED=$((FAILED + 1)); fi
}

# 向系統要一個空閒埠：綁 port 0 取得後關閉
free_port() {
  python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

# 啟動伺服器，埠號放在 PORT；PID 記在檔案裡，收尾只殺自己啟動的程序
start_server() { # router
  local i
  PORT="$(free_port)"
  PHP_CLI_SERVER_WORKERS=4 php -S "127.0.0.1:$PORT" -t "$SITE" "$TMP/$1" >/dev/null 2>&1 &
  echo $! > "$PIDFILE"
  for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/" && break; sleep 0.3; done
}

# 在假站台跑 deploy.sh，輸出放 OUT，結束碼放 CODE
run_deploy() {
  OUT="$(cd "$SITE" && env -u DEPLOY_CHECK_URL "$@" 2>&1)"; CODE=$?
}

check() { # 名稱 預期結束碼 預期輸出片段 不應出現的片段
  [ "$CODE" -eq "$2" ]; expect "$1：結束碼 $2，實際 $CODE" $?
  grep -qF -- "$3" <<< "$OUT"; expect "$1：輸出含「$3」" $?
  if [ -n "${4:-}" ]; then ! grep -qF -- "$4" <<< "$OUT"; expect "$1：輸出不含「$4」" $?; fi
  [ "${SHOW:-0}" = 1 ] && echo "$OUT"
  return 0
}

run_case() { # 名稱 router 預期結束碼 預期輸出片段 不應出現的片段
  start_server "$2"
  run_deploy env DEPLOY_CHECK_URL="http://127.0.0.1:$PORT" bash ./deploy.sh --check-only
  stop_server
  check "$1" "$3" "$4" "${5:-}"
}

rm -f "$SITE/.deploy_check_url"

run_case "外洩" router_open.php 1 ".git/ 可被下載" ".git/ 已擋住"
check "外洩提示修法" 1 "修法" ""
check "外洩印出 nginx 設定" 1 'location ~ /\.git { deny all; return 404; }' ""
check "外洩提示重測" 1 "./deploy.sh --check-only 重測" ""
run_case "擋住 403" router_block.php 0 ".git/ 已擋住" ".git/ 可被下載"
check "擋住 403 顯示回應碼" 0 "回 403" ""
run_case "擋住 404" router_404.php 0 ".git/ 已擋住" ".git/ 可被下載"
check "擋住 404 顯示回應碼" 0 "回 404" ""
run_case "200 非 git" router_spa.php 0 ".git/ 回 200 但不是 git 內容" ".git/ 可被下載"
check "200 非 git 提示" 0 "請確認檢查網址指向本站" ".git/ 已擋住"
run_case "3xx" router_redirect.php 0 ".git/ 回 302 轉址，不跟隨" ".git/ 可被下載"
check "3xx 提示" 0 "請改用最終網址" ""

# 連不上：用剛釋放的空閒埠，沒有程序在聽
PORT="$(free_port)"
run_deploy env DEPLOY_CHECK_URL="http://127.0.0.1:$PORT" bash ./deploy.sh --check-only
check "連不上" 0 ".git/ 連不上，略過" ".git/ 可被下載"

# 沒設網址
rm -f "$SITE/.deploy_check_url"
run_deploy bash ./deploy.sh --check-only
check "沒設網址" 0 "沒設檢查網址，略過外洩檢查" ""
check "沒設網址提示用法" 0 "./deploy.sh --set-check-url https://example.com/project" ""

# --set-check-url 存取
run_deploy bash ./deploy.sh --set-check-url "https://example.com/project///"
check "存網址" 0 "已儲存" ""
check "存網址提示" 0 "之後 ./deploy.sh 會自動使用" ""
[ "$(cat "$SITE/.deploy_check_url")" = "https://example.com/project" ]; expect "存網址：去掉結尾斜線" $?
run_deploy bash ./deploy.sh --set-check-url "ftp://example.com"
check "存網址：開頭錯誤" 2 "要以 http:// 或 https:// 開頭" "已儲存"
run_deploy bash ./deploy.sh --set-check-url
check "存網址：沒給網址" 2 "要以 http:// 或 https:// 開頭" "已儲存"
[ "$(cat "$SITE/.deploy_check_url")" = "https://example.com/project" ]; expect "存網址：錯誤輸入不覆蓋原檔" $?
run_deploy bash ./deploy.sh --help
check "help 列出新參數" 0 "--set-check-url" ""
check "help 列出 --check-only" 0 "--check-only" ""

# 檔案生效：存好後不帶環境變數直接檢查
start_server router_open.php
run_deploy bash ./deploy.sh --set-check-url "http://127.0.0.1:$PORT/"
run_deploy bash ./deploy.sh --check-only
stop_server
check "讀檔案" 1 ".git/ 可被下載" ""

# 環境變數優先於檔案：檔案指向外洩路徑，環境變數指向擋住路徑
start_server router_split.php
run_deploy bash ./deploy.sh --set-check-url "http://127.0.0.1:$PORT/leak"
run_deploy bash ./deploy.sh --check-only
check "只有檔案：外洩" 1 ".git/ 可被下載" ""
run_deploy env DEPLOY_CHECK_URL="http://127.0.0.1:$PORT/ok" bash ./deploy.sh --check-only
stop_server
check "環境變數優先於檔案" 0 ".git/ 已擋住" ".git/ 可被下載"
rm -f "$SITE/.deploy_check_url"

echo
if [ "$FAILED" -eq 0 ]; then echo "deploycheck 全部通過"; exit 0; fi
echo "deploycheck $FAILED 項失敗"; exit 1
