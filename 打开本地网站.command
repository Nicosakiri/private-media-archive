#!/bin/zsh

set -u

SITE_DIR="${0:A:h}"
LOCAL_PORT="4317"
LOCAL_URL="http://127.0.0.1:${LOCAL_PORT}"
BUNDLED_NODE="/Users/hy151327/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

cd "$SITE_DIR" || exit 1

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

if [[ ! -f "node_modules/vinext/dist/cli.js" ]]; then
  echo "网站依赖尚未安装，无法启动。"
  echo "按任意键关闭窗口。"
  read -k 1
  exit 1
fi

echo "正在启动「Private Media Archive」本地网站……"
echo "地址：${LOCAL_URL}"
echo

"$SITE_NODE" node_modules/vinext/dist/cli.js dev \
  --host 127.0.0.1 \
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
