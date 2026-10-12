#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# 與其他開利手專案共用部署輸出慣例。
source tools/deploy-output.sh

# ── 網站檢查：部署後執行，也可單獨跑 ./deploy.sh --check-only ──────────────────
# 伺服器是 git pull 原地更新，Nginx 沒擋 .git/ 就能被下載整份原始碼與歷史。
# 檢查網址優先序：環境變數 DEPLOY_CHECK_URL，其次 .deploy_check_url，後者用 --set-check-url 寫入。
CRIT=0
CHECK_URL_FILE=".deploy_check_url"
EXAMPLE_URL="https://example.com/project"

# 向 $1 發 GET，不跟隨轉址，8 秒逾時。
# 輸出 exposed 代表 200 且內容以 ref: 開頭，unreach 代表連不上，其他輸出 HTTP 狀態碼。
probe_git_head() {
  local tmp code
  tmp="$(mktemp)"
  code="$(curl -sS --max-time 8 --max-redirs 0 -o "$tmp" -w '%{http_code}' "$1" 2>/dev/null)" || code="000"
  if [ "$code" = "000" ]; then echo "unreach"
  elif [ "$code" = "200" ] && head -c 4 "$tmp" 2>/dev/null | grep -q '^ref:'; then echo "exposed"
  else echo "$code"; fi
  rm -f "$tmp"
}

NGINX_SNIPPET='    location ~ /\.git { deny all; return 404; }'
export NGINX_SNIPPET

configure_nginx_git() {
  local site="$1" temporary previous count
  [ "$(id -u)" = 0 ] || { fail "需要 root／sudo"; return 1; }
  [ -n "$site" ] || { fail "用法：./deploy.sh --configure-nginx <Nginx 網站設定檔>"; return 1; }
  site="$(realpath "$site" 2>/dev/null)" || { fail "找不到檔案：$1"; return 1; }
  [ -f "$site" ] || { fail "找不到檔案：$1"; return 1; }
  if grep -q 'BEGIN KoiLiSu managed' "$site"; then
    ok "已有 KoiLiSu 管理的區塊，略過"
    return 0
  fi
  count="$(grep -cE '^[[:space:]]*server[[:space:]]*\{[[:space:]]*$' "$site" || true)"
  [ "$count" = 1 ] || { fail "須有唯一的 server { 區塊（找到 ${count} 個），未變更"; return 1; }
  temporary="$(mktemp "$(dirname "$site")/.koilisu.XXXXXX")"
  previous="$(mktemp)"
  cp -p "$site" "$previous"
  [ -e "$site.koilisu-backup" ] || cp -p "$site" "$site.koilisu-backup"
  awk '
    { print }
    !done && $0 ~ /^[[:space:]]*server[[:space:]]*\{[[:space:]]*$/ { print "    # BEGIN KoiLiSu managed"; print ENVIRON["NGINX_SNIPPET"]; print "    # END KoiLiSu managed"; done=1 }
  ' "$site" > "$temporary"
  chmod --reference="$site" "$temporary"
  chown --reference="$site" "$temporary" 2>/dev/null || true
  if cmp -s "$temporary" "$site"; then rm -f "$temporary"; else mv -f "$temporary" "$site"; fi
  if ! nginx -t; then
    cp -p "$previous" "$site"
    rm -f "$previous"
    fail "Nginx 設定檢查失敗，已還原，未重載"
    return 1
  fi
  rm -f "$previous"
  systemctl reload nginx
  ok "已寫入 .git 封鎖規則並重載 Nginx"
}

# 讀檢查網址：環境變數優先，其次檔案；都沒有就輸出空字串
read_check_url() {
  local u="${DEPLOY_CHECK_URL:-}"
  if [ -z "$u" ] && [ -f "$CHECK_URL_FILE" ]; then
    u="$(head -n 1 "$CHECK_URL_FILE" | tr -d '\r')"
  fi
  printf '%s' "$u"
}

set_check_url() {
  local u="${1:-}"
  case "$u" in
    https://?*|http://?*) ;;
    *) fail "檢查網址要以 http:// 或 https:// 開頭"
       echo "  ${DIM}例如 ./deploy.sh --set-check-url ${EXAMPLE_URL}${RESET}"
       return 1 ;;
  esac
  while [ "${u%/}" != "$u" ]; do u="${u%/}"; done
  printf '%s\n' "$u" > "$CHECK_URL_FILE"
  ok "已儲存  ${DIM}${u}${RESET}"
  echo "  ${DIM}之後 ./deploy.sh 會自動使用${RESET}"
}

selfcheck_web() {
  local base url r
  base="$(read_check_url)"
  if [ -z "$base" ]; then
    warn "未設定網址，略過網站檢查"
    echo "    ${DIM}只需設一次：./deploy.sh --set-check-url ${EXAMPLE_URL}${RESET}"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    warn "缺少 curl，略過網站檢查"
    install_hint curl
    return 0
  fi
  while [ "${base%/}" != "$base" ]; do base="${base%/}"; done
  case "$base" in
    https://?*|http://?*) ;;
    *) warn "檢查網址要以 http:// 或 https:// 開頭，略過外洩檢查"
       echo "    ${DIM}${base}${RESET}"
       return 0 ;;
  esac
  url="$base/.git/HEAD"
  r="$(probe_git_head "$url")"
  case "$r" in
    exposed)
      CRIT=1
      fail "${BOLD}${RED}.git/ 可被下載${RESET}  ${DIM}回 200，${url}${RESET}"
      echo "  ${BOLD}${RED}整份原始碼與 commit 歷史都能被任何人取得${RESET}"
      echo "  ${BOLD}修法${RESET}：貼進 nginx 的 server 區塊再 reload，或用 sudo ./deploy.sh --configure-nginx <設定檔> 自動處理"
      echo "${CYAN}${NGINX_SNIPPET}${RESET}"
      echo "  ${DIM}完成後執行 ./deploy.sh --check-only 重測${RESET}" ;;
    unreach)
      warn ".git/ 連不上，略過" ;;
    200)
      warn ".git/ 回 200 但不是 git 內容"
      echo "    ${DIM}請確認檢查網址指向本站${RESET}" ;;
    3??)
      warn ".git/ 回 ${r} 轉址，不跟隨"
      echo "    ${DIM}請改用最終網址${RESET}" ;;
    *)
      ok ".git/ 已擋住  ${DIM}回 ${r}${RESET}" ;;
  esac
}

run_selfcheck() {
  step "網站檢查"
  selfcheck_web
}

CHECK_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check-only) CHECK_ONLY=1 ;;
    --set-check-url)
      set_check_url "${2:-}" || exit 2
      exit 0 ;;
    --configure-nginx)
      configure_nginx_git "${2:-}" || exit 2
      exit 0 ;;
    help|-h|--help)
      echo "用法：./deploy.sh [--check-only] [--set-check-url URL] [--configure-nginx FILE]"
      echo "  --check-only          不更新程式，只跑網站檢查"
      echo "  --set-check-url URL   儲存檢查網址，例如 ${EXAMPLE_URL}"
      echo "  --configure-nginx FILE 寫入 .git 封鎖規則並 reload Nginx（需 root）"
      echo "環境變數：DEPLOY_BRANCH、DEPLOY_RELOAD_CMD、DEPLOY_CHECK_URL"
      exit 0 ;;
    *) fail "未知參數：$1；請執行 ./deploy.sh help"; exit 2 ;;
  esac
  shift
done

if [ "$CHECK_ONLY" -eq 1 ]; then
  run_selfcheck
  [ "$CRIT" -eq 0 ]
  exit $?
fi

BRANCH="${DEPLOY_BRANCH:-main}"

# PHP 只輸出頁面，功能在瀏覽器端 JS；無資料庫、必要的 PHP extension 與 PHP 寫入目錄。

require_cmd git git

step "檢查本機變更"
# 手動改過的檔案會讓 fast-forward 失敗，先列出並中止。
DIRTY="$(git status --porcelain --untracked-files=no)"
if [ -n "$DIRTY" ]; then
  fail "有未 commit 的修改，部署已中止："
  sed 's/^/    /' <<< "$DIRTY"
  echo "  ${DIM}請先 commit 或備份上述修改，再執行 ./deploy.sh${RESET}"
  exit 1
fi
ok "沒有未 commit 的修改"

HAS_PHP=0
if command -v php >/dev/null 2>&1; then
  HAS_PHP=1
  ok "PHP CLI：$(php -r 'echo PHP_VERSION;')"
else
  warn "缺少 PHP CLI，略過 PHP 執行環境檢查"
  install_hint php-cli
fi

step "取得 remote 版本"
BEFORE=$(git rev-parse --short HEAD)
git fetch --quiet origin "$BRANCH"
AFTER=$(git rev-parse --short FETCH_HEAD)
ok "remote branch ${BRANCH}：${AFTER}"

if [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ] && ! git merge-base --is-ancestor HEAD FETCH_HEAD; then
  # 本機與 remote diverge 時無法 fast-forward，不在伺服器上產生 merge commit。
  fail "本機與 remote 版本已 diverge，無法 fast-forward 更新，部署已中止"
  echo "  ${DIM}請先保留並確認本機 commit：git log ${AFTER}..HEAD${RESET}"
  exit 1
fi

if [ "$BEFORE" = "$AFTER" ]; then
  ok "已是最新版本（${AFTER}）"
else
  step "更新程式"
  git merge --ff-only --quiet FETCH_HEAD
  ok "已更新：${DIM}${BEFORE}${RESET} → ${GREEN}${BOLD}${AFTER}${RESET}"
  echo "  ${DIM}此次更新的變更：${RESET}"
  git log --oneline "${BEFORE}..${AFTER}" | sed 's/^/    /'
fi

# 選用：opcache 不檢查檔案時間戳（validate_timestamps=0）時，更新後需重載 PHP-FPM，例如
#   DEPLOY_RELOAD_CMD="systemctl reload php8.3-fpm" ./deploy.sh
if [ -n "${DEPLOY_RELOAD_CMD:-}" ] && [ "$BEFORE" != "$AFTER" ]; then
  step "重載服務"
  if bash -c "$DEPLOY_RELOAD_CMD"; then
    ok "${DEPLOY_RELOAD_CMD}"
  else
    fail "重載失敗：${DEPLOY_RELOAD_CMD}（程式碼已更新，請手動重載 PHP-FPM）"
    exit 1
  fi
fi

run_selfcheck
VERSION=''
if [ "$HAS_PHP" -eq 1 ]; then
  VERSION="$(php -r '$c = require "config.php"; echo $c["version"] ?? "?";' 2>/dev/null || echo '?')"
fi
deployment_summary "$VERSION" "$CRIT"
[ "$CRIT" -eq 0 ] || { echo; fail "網站檢查未通過，請依上方訊息處理"; exit 1; }
