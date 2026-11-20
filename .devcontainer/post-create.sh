#!/usr/bin/env bash
# Installs the Solana CLI and Anchor CLI at the versions pinned in devcontainer.json.
# Anchor 1.2.2's own CI tests against Solana CLI 4.1.2.
set -euo pipefail

SOLANA_VERSION="${SOLANA_VERSION:-4.1.2}"
ANCHOR_VERSION="${ANCHOR_VERSION:-1.2.2}"
SOLANA_BIN="$HOME/.local/share/solana/install/active_release/bin"
export PATH="$PATH:$SOLANA_BIN:$HOME/.local/bin"

echo "==> System packages for Solana/Anchor builds"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  build-essential pkg-config libudev-dev llvm libclang-dev protobuf-compiler libssl-dev >/dev/null

echo "==> Solana CLI v${SOLANA_VERSION}"
sh -c "$(curl -sSfL "https://release.anza.xyz/v${SOLANA_VERSION}/install")"

echo "==> Anchor CLI v${ANCHOR_VERSION} (prebuilt binary)"
mkdir -p "$HOME/.local/bin"
curl -sSfL -o "$HOME/.local/bin/anchor" \
  "https://github.com/solana-foundation/anchor/releases/download/v${ANCHOR_VERSION}/anchor-${ANCHOR_VERSION}-x86_64-unknown-linux-gnu"
chmod +x "$HOME/.local/bin/anchor"

echo "==> Devnet wallet"
solana config set --url devnet >/dev/null
if [ ! -f "$HOME/.config/solana/id.json" ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$HOME/.config/solana/id.json"
fi

echo "==> Yarn (Anchor test scripts) and backend deps"
command -v yarn >/dev/null || npm install -g yarn >/dev/null  # the node feature usually ships it
(cd backend && npm ci --no-audit --no-fund)

echo
rustc --version
solana --version
anchor --version
node --version
echo "Wallet: $(solana address)  (devnet; fund it with: solana airdrop 2, or https://faucet.solana.com)"
