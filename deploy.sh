#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# 有顏色的終端機才上色，避免 log 檔案裡混進一堆 ANSI 逃脫碼
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'
  RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; CYAN=''; RESET=''
fi

step() { echo "${BOLD}${CYAN}==>${RESET} ${BOLD}$1${RESET}"; }
ok()   { echo "  ${GREEN}✓${RESET} $1"; }
warn() { echo "  ${YELLOW}!${RESET} $1"; }
fail() { echo "  ${RED}✗${RESET} $1"; }

# ── 網站自我檢查（部署後執行；也可單獨跑：./deploy.sh --check-only）──────────────────
# 這個專案在伺服器上是 git pull 原地更新：Nginx 沒擋 .git/ 的話，
# 任何人都能下載 $DEPLOY_CHECK_URL/.git/HEAD 乃至整份原始碼與歷史紀錄。
# 用環境變數指定網站對外網址，例：DEPLOY_CHECK_URL=https://example.com/project ./deploy.sh
CRIT=0

# 向 $1 發 GET（不跟隨轉址、8 秒逾時），輸出：
#   exposed＝200 且內容以 ref: 開頭（真的是 git HEAD）；unreach＝連不上；其他為 HTTP 狀態碼
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

selfcheck_web() {
  local base url r
  if [ -z "${DEPLOY_CHECK_URL:-}" ]; then
    warn "略過「.git/ 可否被網頁下載」檢查：未設定檢查網址，可用 DEPLOY_CHECK_URL=https://example.com/project ./deploy.sh"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    warn "略過「.git/ 可否被網頁下載」檢查：找不到 curl"
    return 0
  fi
  base="${DEPLOY_CHECK_URL%/}"
  case "$base" in
    https://*|http://*) ;;
    *) warn "檢查網址要以 https:// 或 http:// 開頭：$base"; return 0 ;;
  esac
  url="$base/.git/HEAD"
  r="$(probe_git_head "$url")"
  case "$r" in
    exposed)
      CRIT=1
      fail "${BOLD}${RED}嚴重：.git/ 可被網頁直接下載${RESET}（$url 回 200 並送出 git 內容）"
      echo "  ${BOLD}${RED}!!! 整份原始碼與歷史紀錄都能被任何人下載 !!!${RESET}"
      echo "  ${BOLD}修法：${RESET}把下面這條貼進 Nginx 的 server { } 區塊（與 listen／root 同一層），再執行 sudo nginx -t && sudo systemctl reload nginx："
      echo "${YELLOW}${NGINX_SNIPPET}${RESET}"
      echo "  ${DIM}完成後重跑 ./deploy.sh --check-only 確認；歷史紀錄裡若曾有機密，請一併更換${RESET}" ;;
    unreach)
      warn "連不上 $url（逾時或網路不通），略過這一項" ;;
    3??)
      warn "$url 回 $r 轉址，腳本不跟隨；請把檢查網址改成最終網址（例如直接用 https://）再測" ;;
    *)
      ok ".git/ 無法被網頁下載（回 $r）" ;;
  esac
}

run_selfcheck() {
  step "網站自我檢查"
  selfcheck_web
}

CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=1 ;;
    -h|--help)
      echo "用法：./deploy.sh [--check-only]"
      echo "  --check-only  不更新程式碼，只跑「網站自我檢查」"
      echo "環境變數：DEPLOY_BRANCH、DEPLOY_RELOAD_CMD、DEPLOY_CHECK_URL（網站對外網址，例：https://example.com/project）"
      exit 0 ;;
    *) fail "未知參數：$arg"; exit 2 ;;
  esac
done

if [ "$CHECK_ONLY" -eq 1 ]; then
  run_selfcheck
  [ "$CRIT" -eq 0 ]
  exit $?
fi

BRANCH="${DEPLOY_BRANCH:-main}"

# printan 是純 PHP 頁面殼＋瀏覽器端 JS：沒有資料庫、沒有必要的 PHP 擴充套件、
# 也沒有需要 PHP 寫入的目錄，所以不需要檢查擴充套件或修正目錄權限。

step "檢查 working tree"
# 伺服器上的檔案被手動改過時，git fast-forward merge 會中途失敗；先擋下來，講清楚是哪些檔案。
DIRTY="$(git status --porcelain --untracked-files=no)"
if [ -n "$DIRTY" ]; then
  fail "有尚未 commit 的修改，部署已中止（怕蓋掉伺服器上的手動修改）："
  sed 's/^/    /' <<< "$DIRTY"
  echo "  ${DIM}確認不需要之後，用 git checkout -- <檔案> 還原，再重新執行 ./deploy.sh${RESET}"
  exit 1
fi
ok "沒有未 commit 的修改"

HAS_PHP=0
if command -v php >/dev/null 2>&1; then
  HAS_PHP=1
  ok "PHP CLI：$(php -r 'echo PHP_VERSION;')"
else
  warn "找不到 php 指令，會略過語法檢查：有語法錯誤的 PHP 檔不會被擋在部署之前（網頁的 PHP-FPM 不受影響）"
fi

echo
step "Fetch 最新程式碼"
BEFORE=$(git rev-parse --short HEAD)
git fetch --quiet origin "$BRANCH"
AFTER=$(git rev-parse --short FETCH_HEAD)
ok "remote ${BRANCH}：${AFTER}"

if [ "$(git rev-parse HEAD)" != "$(git rev-parse FETCH_HEAD)" ] && ! git merge-base --is-ancestor HEAD FETCH_HEAD; then
  # local 有 remote 沒有的 commit（或兩邊 diverge）：fast-forward 做不到，硬 merge 會在伺服器上產生 merge commit，都不是預期的部署結果
  fail "local（${BEFORE}）不是 remote（${AFTER}）的 ancestor，無法 fast-forward，部署已中止"
  echo "  ${DIM}伺服器上不該有 remote 沒有的 commit；請確認後再處理（例如 git log ${AFTER}..HEAD 看多出什麼）${RESET}"
  exit 1
fi

if [ "$BEFORE" = "$AFTER" ]; then
  echo
  warn "已經是最新版本（${AFTER}），沒有新的變更"
else
  echo
  step "部署前先檢查新增／修改的 PHP 語法"
  # 在 merge「之前」就檢查：直接用 git show 把 remote 版本餵給 php -l，有錯就中止，
  # 線上的檔案完全沒動。merge 之後才發現，網站已經是壞的了。
  if [ "$HAS_PHP" -eq 1 ]; then
    BAD=()
    COUNT=0
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      COUNT=$((COUNT + 1))
      if ! git show "FETCH_HEAD:${file}" | php -l >/dev/null 2>&1; then
        BAD+=("$file")
      fi
    done < <(git diff --name-only --diff-filter=AM HEAD FETCH_HEAD -- '*.php')
    if [ ${#BAD[@]} -gt 0 ]; then
      for file in "${BAD[@]}"; do
        fail "$file（語法錯誤）"
        git show "FETCH_HEAD:${file}" | php -l 2>&1 | sed -n '1p' | sed 's/^/      /' || true
      done
      echo
      fail "${#BAD[@]} 個 PHP 檔有語法錯誤，部署已中止，線上檔案沒有變動"
      exit 1
    fi
    ok "檢查了 ${COUNT} 個 PHP 檔，語法都正確"
  else
    warn "略過（沒有 php 指令）"
  fi

  echo
  step "更新程式碼"
  git merge --ff-only --quiet FETCH_HEAD
  ok "已更新：${DIM}${BEFORE}${RESET} → ${GREEN}${BOLD}${AFTER}${RESET}"
  echo "  ${DIM}此次更新的變更：${RESET}"
  git log --oneline "${BEFORE}..${AFTER}" | sed 's/^/    /'
fi

# 選用：PHP 開了 opcache 且不檢查檔案時間戳（validate_timestamps=0）的伺服器，
# 換了檔案要重載 PHP-FPM 才會生效；用環境變數帶進來，例如
#   DEPLOY_RELOAD_CMD="systemctl reload php8.3-fpm" ./deploy.sh
if [ -n "${DEPLOY_RELOAD_CMD:-}" ] && [ "$BEFORE" != "$AFTER" ]; then
  echo
  step "重載 PHP"
  if bash -c "$DEPLOY_RELOAD_CMD"; then
    ok "${DEPLOY_RELOAD_CMD}"
  else
    fail "重載失敗：${DEPLOY_RELOAD_CMD}（程式碼已更新，請手動重載 PHP-FPM）"
    exit 1
  fi
fi

echo
run_selfcheck
echo
step "部署完成"
if [ "$HAS_PHP" -eq 1 ]; then
  VERSION="$(php -r '$c = require "config.php"; echo $c["version"] ?? "?";' 2>/dev/null || echo '?')"
  echo "  應用版本：${BOLD}v${VERSION}${RESET}"
fi
echo "  目前 commit：${BOLD}$(git rev-parse --short HEAD)${RESET}"
echo "  完成時間：${DIM}$(date '+%Y-%m-%d %H:%M:%S')${RESET}"
[ "$CRIT" -eq 0 ] || { echo; fail "自我檢查有嚴重問題（見上方 ✗），請先處理"; exit 1; }
