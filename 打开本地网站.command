#!/bin/zsh

set -u

SITE_DIR="${0:A:h}"
LOCAL_PORT="4317"
LOCAL_URL="http://127.0.0.1:${LOCAL_PORT}"
BUNDLED_NODE="/Users/hy151327/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
BUNDLED_PNPM="/Users/hy151327/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm"
VITE_ENTRY="$SITE_DIR/node_modules/vite/bin/vite.js"
LOCAL_CONFIG="$SITE_DIR/vite.local.config.ts"
SAFE_WORK_DIR="${TMPDIR:-/private/tmp}"
export NODE_PATH="$SITE_DIR/node_modules${NODE_PATH:+:$NODE_PATH}"

# macOS may deny Node access to a Finder-launched terminal's current folder.
# Start from a neutral directory and pass every project path explicitly.
cd "$SAFE_WORK_DIR" 2>/dev/null || cd /private/tmp || exit 1

if [[ -x "$BUNDLED_NODE" ]]; then
  SITE_NODE="$BUNDLED_NODE"
elif command -v node >/dev/null 2>&1; then
  SITE_NODE="$(command -v node)"
else
  echo "没有找到 Node.js，无法启动本地网站。"
  echo "按任意键关闭窗口。"
  read -k 1
  exit 1
fi

if [[ ! -f "$VITE_ENTRY" ]]; then
  echo "正在准备本地网站所需文件（只会在缺少依赖时执行）……"
  if [[ -x "$BUNDLED_PNPM" ]]; then
    (cd "$SITE_DIR" && CI=true "$BUNDLED_PNPM" install --frozen-lockfile)
  elif command -v pnpm >/dev/null 2>&1; then
    (cd "$SITE_DIR" && CI=true pnpm install --frozen-lockfile)
  else
    echo "没有找到 pnpm，无法准备本地网站依赖。"
  fi

  if [[ ! -f "$VITE_ENTRY" ]]; then
    echo "网站依赖没有安装成功，请确认电脑已联网后再试。"
    echo "按任意键关闭窗口。"
    read -k 1
    exit 1
  fi
fi

if curl --silent --fail "$LOCAL_URL" >/dev/null 2>&1; then
  open "$LOCAL_URL"
  echo "网站已经在运行，已直接打开。"
  exit 0
fi

echo "正在启动「Private Media Archive」本地网站……"
echo "地址：${LOCAL_URL}"
echo

"$SITE_NODE" "$VITE_ENTRY" "$SITE_DIR" \
  --config "$LOCAL_CONFIG" \
  --host 0.0.0.0 \
  --port "$LOCAL_PORT" &

SITE_SERVER_PID=$!

stop_site_server() {
  if kill -0 "$SITE_SERVER_PID" >/dev/null 2>&1; then
    kill "$SITE_SERVER_PID" >/dev/null 2>&1
  fi
}

trap stop_site_server EXIT INT TERM

SITE_READY="false"
for _ in {1..60}; do
  if curl --silent --fail "$LOCAL_URL" >/dev/null 2>&1; then
    SITE_READY="true"
    break
  fi
  if ! kill -0 "$SITE_SERVER_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if [[ "$SITE_READY" == "true" ]]; then
  open "$LOCAL_URL"
  echo
  echo "网站已打开。请保留这个终端窗口；关闭窗口即可停止本地网站。"
else
  echo
  echo "本地网站没有成功启动，请保留此窗口中的错误信息。"
fi

wait "$SITE_SERVER_PID"
