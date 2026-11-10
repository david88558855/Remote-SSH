#!/usr/bin/env bash
# ============================================
# Claude Remote SSH — Installer
# ============================================
# Run this script from the repo root.
#   bash install.sh                  → install to ~/.tclaude
#   bash install.sh --claude         → install to ~/.claude (vanilla Claude Code)
# ============================================
set -e

# Detect config dir
if [ "$1" = "--claude" ]; then
  CONFIG_DIR="$HOME/.claude"
  BRAND="Claude Code"
else
  CONFIG_DIR="$HOME/.tclaude"
  BRAND="tclaude"
fi

INSTALL_DIR="$( cd "$( dirname "$0" )" && pwd )"

echo "============================================"
echo " Claude Remote SSH — Installer"
echo "============================================"
echo ""
echo " Install target: $BRAND ($CONFIG_DIR)"
echo " Script dir:    $INSTALL_DIR"
echo ""

# ─── Check prerequisites ───────────────────────────────────────
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not found. Install it first."; exit 1; }
command -v ssh >/dev/null 2>&1 || { echo "❌ OpenSSH client is required but not found."; exit 1; }

# ─── Check SSH config ──────────────────────────────────────────
if [ ! -f "$HOME/.ssh/config" ]; then
  echo "⚠️  WARNING: ~/.ssh/config not found!"
  echo "   This skill requires an SSH config file to work."
  echo "   Copy the example: cp SSH_CONFIG.example ~/.ssh/config"
  echo "   Then edit it with your real server details."
  echo ""
fi

# ─── Check password file ───────────────────────────────────────
if [ ! -f "$INSTALL_DIR/password.xlsx" ]; then
  echo "⚠️  WARNING: password.xlsx not found in $INSTALL_DIR"
  echo "   If you have password-based hosts (no IdentityFile),"
  echo "   create this file with columns: host_alias | password"
  echo ""
fi

# ─── Install npm deps ──────────────────────────────────────────
echo "📦 Installing npm dependencies..."
cd "$INSTALL_DIR"
npm install --silent 2>&1 || { echo "❌ npm install failed."; exit 1; }
echo "   Done."
echo ""

# ─── Create directories ────────────────────────────────────────
mkdir -p "$CONFIG_DIR/commands"
mkdir -p "$CONFIG_DIR/skills"

# ─── Replace {{INSTALL_DIR}} placeholder ───────────────────────
# Convert Windows backslashes to forward slashes for sed compatibility
INSTALL_DIR_FIXED=$(echo "$INSTALL_DIR" | sed 's/\\/\//g')

echo "🔧 Patching files with install path: $INSTALL_DIR_FIXED"

# Create temp copies with replaced paths
sed "s|{{INSTALL_DIR}}|$INSTALL_DIR_FIXED|g" "$INSTALL_DIR/skills/remote-server/SKILL.md" \
  > "$CONFIG_DIR/skills/remote-server/SKILL.md.tmp" 2>/dev/null || {
    # sed -i might behave differently; fallback to perl or node
    node -e "
      const fs=require('fs');
      let s=fs.readFileSync('$INSTALL_DIR_FIXED/skills/remote-server/SKILL.md','utf8');
      s=s.replace(/\{\{INSTALL_DIR\}\}/g,'$INSTALL_DIR_FIXED');
      fs.writeFileSync('$CONFIG_DIR/skills/remote-server/SKILL.md.tmp',s);
    "
  }

mkdir -p "$CONFIG_DIR/skills/remote-server"
mv "$CONFIG_DIR/skills/remote-server/SKILL.md.tmp" "$CONFIG_DIR/skills/remote-server/SKILL.md"

node -e "
  const fs=require('fs');
  let s=fs.readFileSync('$INSTALL_DIR_FIXED/ssh.md','utf8');
  s=s.replace(/\{\{INSTALL_DIR\}\}/g,'$INSTALL_DIR_FIXED');
  fs.writeFileSync('$CONFIG_DIR/commands/ssh.md',s);
"

echo "   Done."
echo ""

# ─── Done ──────────────────────────────────────────────────────
echo "============================================"
echo " ✅ Installation complete!"
echo "============================================"
echo ""
echo " Files installed:"
echo "   $CONFIG_DIR/commands/ssh.md"
echo "   $CONFIG_DIR/skills/remote-server/SKILL.md"
echo ""
echo " Script location:"
echo "   $INSTALL_DIR/remote.mjs"
echo ""

if [ ! -f "$HOME/.ssh/config" ]; then
  echo " ⚠️  Next: create ~/.ssh/config with your server definitions"
fi
if [ ! -f "$INSTALL_DIR/password.xlsx" ]; then
  echo " ⚠️  Next: create $INSTALL_DIR/password.xlsx for password-based hosts"
fi

echo ""
echo " Restart $BRAND, then try: /ssh <your-host>"
echo ""
