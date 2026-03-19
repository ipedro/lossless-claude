#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${LOSSLESS_CLAUDE_DIR:-${HOME}/.lossless-claude/plugin}"
NPM_PREFIX="${HOME}/.npm-global"

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

# Install binary to ~/.npm-global (no sudo, no Homebrew permission issues)
echo "  ▸ Installing lossless-claude binary to ${NPM_PREFIX}/bin"
mkdir -p "$NPM_PREFIX"
npm install -g . --prefix "$NPM_PREFIX" --silent

# Make binary available for the rest of this script
export PATH="${NPM_PREFIX}/bin:${PATH}"

# Persist to shell profile if not already there
for rc in "${HOME}/.zshrc" "${HOME}/.bashrc" "${HOME}/.bash_profile"; do
  if [ -f "$rc" ] && ! grep -q 'npm-global/bin' "$rc"; then
    echo "" >> "$rc"
    echo '# lossless-claude' >> "$rc"
    echo 'export PATH="${HOME}/.npm-global/bin:${PATH}"' >> "$rc"
    echo "  ▸ Added ~/.npm-global/bin to PATH in ${rc}"
    break
  fi
done

# Run the full installer (wires up hooks, daemon, Cipher, runs doctor)
lossless-claude install
