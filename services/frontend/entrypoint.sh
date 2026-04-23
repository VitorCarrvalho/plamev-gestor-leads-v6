#!/bin/sh
# entrypoint.sh — gerado em runtime, injeta variáveis de ambiente no bundle React
# Cria um arquivo /app/dist/env-config.js que o index.html carrega antes do bundle

cat <<EOF > /app/dist/env-config.js
window.__ENV__ = {
  VITE_API_URL: "${VITE_API_URL:-}",
  VITE_SOCKET_URL: "${VITE_SOCKET_URL:-}"
};
EOF

echo "[FRONTEND] env-config.js gerado:"
cat /app/dist/env-config.js

# Iniciar o servidor de arquivos estáticos
exec serve -s /app/dist -l tcp://0.0.0.0:${PORT:-3000}
