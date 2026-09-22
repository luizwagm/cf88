#!/usr/bin/env bash
# ==========================================================================
# LA CARTA — instalar o Node 24 em /opt/node24, SEM tocar no Node do sistema
#
#   sudo ./operacao/instalar-node24.sh
#
# O /usr/bin/node do servidor é a linha 22, e os outros sites do parque têm
# módulos nativos (better-sqlite3, sharp) compilados para ela. Trocar o Node
# global quebraria os vizinhos na próxima subida. O LA Carta precisa do 24
# (TypeScript direto e node:sqlite), então ele ganha um Node só dele:
#
#   /opt/node-v24.x.y/      o tarball oficial, conferido pelo SHASUMS256
#   /opt/node24 -> …        o link que a unidade e o deploy usam
#
# Roda de novo para atualizar: baixa a última 24.x, troca o link, mantém a
# anterior no disco (voltar é refazer o link).
# ==========================================================================
set -euo pipefail

verde()   { printf "\033[1;32m%s\033[0m\n" "$1"; }
vermelho(){ printf "\033[1;31m%s\033[0m\n" "$1"; }

[ "$(id -u)" -eq 0 ] || { vermelho "Rode com sudo."; exit 1; }

case "$(uname -m)" in
  x86_64) ARQ="x64" ;;
  aarch64|arm64) ARQ="arm64" ;;
  *) vermelho "arquitetura $(uname -m) sem binário oficial"; exit 1 ;;
esac

BASE="https://nodejs.org/dist/latest-v24.x"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "  consultando $BASE"
curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
NOME="$(grep -oE "node-v24\.[0-9]+\.[0-9]+-linux-$ARQ\.tar\.xz" "$TMP/SHASUMS256.txt" | head -1)"
[ -n "$NOME" ] || { vermelho "não achei o tarball linux-$ARQ no SHASUMS256.txt"; exit 1; }
VERSAO="${NOME#node-}"; VERSAO="${VERSAO%-linux-*}"
DESTINO="/opt/node-$VERSAO"

if [ -x "$DESTINO/bin/node" ]; then
  echo "  $VERSAO já está em $DESTINO"
else
  echo "  baixando $NOME"
  curl -fsSL "$BASE/$NOME" -o "$TMP/$NOME"
  ( cd "$TMP" && grep " $NOME\$" SHASUMS256.txt | sha256sum -c - ) || { vermelho "SHA-256 não confere — download corrompido ou adulterado"; exit 1; }
  mkdir -p "$DESTINO"
  tar -xJf "$TMP/$NOME" -C "$DESTINO" --strip-components=1
  verde "  instalado em $DESTINO"
fi

ln -sfn "$DESTINO" /opt/node24
verde "  /opt/node24 -> $DESTINO ($(/opt/node24/bin/node --version))"
echo
echo "  A unidade usa /opt/node24/bin/node; o deploy.sh põe /opt/node24/bin no PATH."
