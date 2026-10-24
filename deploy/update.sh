#!/usr/bin/env bash
# 尘起时刻 · 源码模式一键更新
#
# 用法：
#   bash deploy/update.sh                 # 跟随 master 更新
#   bash deploy/update.sh v0.34.3         # 切到指定 tag（也可用于回滚）
#
# 可用环境变量：
#   APP_DIR=/opt/dust/app   源码目录（默认 /opt/dust/app）
#   SERVICE=dust-relay      中继服务名（默认 dust-relay）
#   SKIP_RESTART=1          只拉取/构建，不重启中继
#   CHECK_LINK=1            构建后顺带跑一次中继链路自检
#
# 说明：本脚本**不做**任何源码修改；失败即停（set -euo pipefail）。

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/dust/app}"
SERVICE="${SERVICE:-dust-relay}"
TARGET="${1:-}"

cd "$APP_DIR"
echo "[update] 目录：$APP_DIR"

if [ -n "$TARGET" ]; then
  echo "[update] 切换到指定版本：$TARGET"
  git fetch --tags --prune
  git checkout "$TARGET"
else
  echo "[update] 跟随 master 更新"
  git fetch --tags --prune
  git checkout master
  git pull --ff-only
fi

VER="$(node -p "require('./package.json').version")"
echo "[update] package.json 版本：v$VER"

echo "[update] 安装依赖（npm ci）……"
npm ci

echo "[update] 构建（npm run build）……"
npm run build

# 版本校验：构建产物里必须出现 package.json 的版本串，否则说明构建没生效/产物是旧的。
if ! grep -rq --include='*.js' "\"$VER\"" dist/assets; then
  echo "[update] ✗ dist/assets 里找不到版本 \"$VER\"（构建产物与 package.json 不一致）" >&2
  exit 1
fi
echo "[update] ✓ 构建产物版本：v$VER"

if [ "${SKIP_RESTART:-0}" = "1" ]; then
  echo "[update] 已跳过重启（SKIP_RESTART=1）"
else
  echo "[update] 重启中继：$SERVICE"
  sudo systemctl restart "$SERVICE"
  echo "[update] ✓ 中继已重启"
fi

if [ "${CHECK_LINK:-0}" = "1" ] && [ -f deploy/check.mjs ]; then
  echo "[update] 自检中继链路……"
  node deploy/check.mjs ws://127.0.0.1:8787
fi

echo "[update] 完成：v$VER"
echo "[update] 请让玩家 Ctrl+F5 硬刷新；若 nginx 未指向 $APP_DIR/dist，请先修正 root。"
