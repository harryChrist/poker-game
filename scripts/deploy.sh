#!/usr/bin/env bash
# Deploy automático (chamado pelo webhook do GitHub em /api/deploy/github, ou à mão: bash scripts/deploy.sh).
# Puxa o código, instala dependências, faz o build e recarrega o servidor no pm2.
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="${DEPLOY_BRANCH:-main}"
echo "=== deploy $(date -Is) ==="

# evita dois deploys ao mesmo tempo
mkdir -p data
exec 9>data/.deploy.lock
flock -n 9 || { echo "outro deploy em andamento, saindo"; exit 0; }

git fetch --quiet origin "$BRANCH"
if [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ]; then
  echo "já está na versão mais nova ($(git rev-parse --short HEAD))"
  exit 0
fi
git reset --hard "origin/$BRANCH"
echo "código em $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

npm install --no-audit --no-fund
npm run build

# reinicia o servidor com o código novo (as fichas em mesa voltam para as carteiras no shutdown)
pm2 reload ecosystem.config.cjs --update-env
echo "=== deploy ok ==="
