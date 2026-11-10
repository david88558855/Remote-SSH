#!/usr/bin/env bash
# ============================================
# Remote-SSH — 通用安装脚本
# ============================================
# 在仓库根目录运行：
#   bash install.sh <目标目录>    → 安装到指定 AI 技能目录
#   bash install.sh               → 默认安装到 ~/.ai-skills
#
# 安装产物：
#   <目标目录>/commands/ssh.md              ← /ssh 触发指令定义
#   <目标目录>/skills/remote-server/SKILL.md ← 技能文档
# ============================================
set -e

CONFIG_DIR="${1:-$HOME/.ai-skills}"

INSTALL_DIR="$( cd "$( dirname "$0" )" && pwd )"

echo "============================================"
echo " Remote-SSH — 安装程序"
echo "============================================"
echo ""
echo " 安装目标：$CONFIG_DIR"
echo " 脚本目录：$INSTALL_DIR"
echo ""

# ─── 检查前置依赖 ───────────────────────────────────────────────
command -v node >/dev/null 2>&1 || { echo "❌ 未找到 Node.js，请先安装。"; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "❌ 未找到 OpenSSH 客户端，请先安装。"; exit 1; }

# ─── 检查 SSH 配置 ──────────────────────────────────────────────
if [ ! -f "$HOME/.ssh/config" ]; then
  echo "⚠️  警告：未找到 ~/.ssh/config！"
  echo "   本技能需要 SSH 配置文件才能工作。"
  echo "   可先复制示例：cp SSH_CONFIG.example ~/.ssh/config"
  echo "   然后填入你真实的服务器信息。"
  echo ""
fi

# ─── 检查密码文件 ───────────────────────────────────────────────
if [ ! -f "$INSTALL_DIR/password.xlsx" ]; then
  echo "⚠️  提示：$INSTALL_DIR 下未找到 password.xlsx"
  echo "   若有密码认证的主机（无 IdentityFile），"
  echo "   请创建该文件，两列分别为：主机别名 | 密码"
  echo "   （免密主机无需配置，自动走 none 认证）"
  echo ""
fi

# ─── 安装 npm 依赖 ──────────────────────────────────────────────
echo "📦 正在安装 npm 依赖..."
cd "$INSTALL_DIR"
npm install --silent 2>&1 || { echo "❌ npm install 失败。"; exit 1; }
echo "   完成。"
echo ""

# ─── 创建目录 ────────────────────────────────────────────────────
mkdir -p "$CONFIG_DIR/commands"
mkdir -p "$CONFIG_DIR/skills/remote-server"

# ─── 替换 {{INSTALL_DIR}} 占位符 ────────────────────────────────
# 反斜杠转正斜杠，保证 sed 兼容
INSTALL_DIR_FIXED=$(echo "$INSTALL_DIR" | sed 's/\\/\//g')

echo "🔧 正在写入安装路径：$INSTALL_DIR_FIXED"

sed "s|{{INSTALL_DIR}}|$INSTALL_DIR_FIXED|g" "$INSTALL_DIR/skills/remote-server/SKILL.md" \
  > "$CONFIG_DIR/skills/remote-server/SKILL.md.tmp" 2>/dev/null || {
    # sed 行为不一致时回退到 node
    node -e "
      const fs=require('fs');
      let s=fs.readFileSync('$INSTALL_DIR_FIXED/skills/remote-server/SKILL.md','utf8');
      s=s.replace(/\{\{INSTALL_DIR\}\}/g,'$INSTALL_DIR_FIXED');
      fs.writeFileSync('$CONFIG_DIR/skills/remote-server/SKILL.md.tmp',s);
    "
  }
mv "$CONFIG_DIR/skills/remote-server/SKILL.md.tmp" "$CONFIG_DIR/skills/remote-server/SKILL.md"

node -e "
  const fs=require('fs');
  let s=fs.readFileSync('$INSTALL_DIR_FIXED/ssh.md','utf8');
  s=s.replace(/\{\{INSTALL_DIR\}\}/g,'$INSTALL_DIR_FIXED');
  fs.writeFileSync('$CONFIG_DIR/commands/ssh.md',s);
"

echo "   完成。"
echo ""

# ─── 完成 ────────────────────────────────────────────────────────
echo "============================================"
echo " ✅ 安装完成！"
echo "============================================"
echo ""
echo " 已安装文件："
echo "   $CONFIG_DIR/commands/ssh.md"
echo "   $CONFIG_DIR/skills/remote-server/SKILL.md"
echo ""
echo " 脚本位置："
echo "   $INSTALL_DIR/remote.mjs"
echo ""

if [ ! -f "$HOME/.ssh/config" ]; then
  echo " ⚠️  下一步：创建 ~/.ssh/config，填入你的服务器定义"
fi
if [ ! -f "$INSTALL_DIR/password.xlsx" ]; then
  echo " ⚠️  下一步：密码认证主机（无 IdentityFile）需要密码文件——"
  echo "     复制 PASSWORD_FILE.example.xlsx → 改名为同目录 password.xlsx，"
  echo "     A 列填主机别名（~/.ssh/config 里的 Host 名称），B 列填密码"
fi

echo ""
echo " 重启你的 AI 助手，然后试试：/ssh <主机名>"
echo ""
