#!/usr/bin/env bash
set -euo pipefail

# 基于脚本位置定位项目根目录（scripts/ 的上一级）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# 静态项目无构建步骤，仅验证入口文件存在
if [ ! -f "index.html" ]; then
  echo "Error: index.html not found"
  exit 1
fi

echo "Static project - no build required"
