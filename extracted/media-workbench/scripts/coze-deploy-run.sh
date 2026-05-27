#!/usr/bin/env bash
set -euo pipefail

# 基于脚本位置定位项目根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# 显式声明端口
export PORT=5000

# 清理端口残留进程
fuser -k 5000/tcp 2>/dev/null || true
sleep 1

# 启动 Python 静态服务器
exec python3 -m http.server 5000 --bind 0.0.0.0
