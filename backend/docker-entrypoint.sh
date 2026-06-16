#!/bin/sh
set -e

# ─────────────────────────────────────────────────────────────────────────────
# Resolve o descasamento de UID dos volumes Docker: o volume montado pode
# pertencer ao root do host, mas o app roda como 'node' (uid 1000). Aqui, ainda
# como root, garantimos a existência e o dono da pasta de dados; em seguida
# LARGAMOS o privilégio e executamos o app como 'node'. Não há root em runtime.
# ─────────────────────────────────────────────────────────────────────────────

DATA_DIR="${DATA_DIR:-/app/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  # passa a execução para o usuário 'node', sem privilégio
  exec su-exec node:node "$@"
fi

# Se já não for root (ex.: 'user:' definido no compose), apenas executa
exec "$@"
