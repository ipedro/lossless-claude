#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${LOSSLESS_CLAUDE_DIR:-${HOME}/.lossless-claude/plugin}"

echo ""
echo "  lossless-claude — installer"
echo ""

# Clone or update
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "  ▸ Updating existing clone at ${INSTALL_DIR}"
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "  ▸ Cloning to ${INSTALL_DIR}"
  git clone https://github.com/ipedro/lossless-claude.git "$INSTALL_DIR"
fi

# Build
echo "  ▸ Building"
cd "$INSTALL_DIR"
npm install --silent
npm run build --silent

# Install binary globally so hooks and the installer can find it
echo "  ▸ Installing lossless-claude binary"
npm install -g . --silent

# Run the full installer (sets up settings.json, daemon, cipher, doctor)
lossless-claude install
