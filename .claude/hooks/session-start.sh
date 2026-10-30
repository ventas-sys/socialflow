#!/bin/bash
set -euo pipefail

# Solo corre en sesiones remotas (Claude Code en la nube).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# mcp-ml/node_modules nunca se commitea (está en mcp-ml/.gitignore), así que
# cada sesión/contenedor nuevo arranca sin las dependencias del conector MCP
# de Mercado Libre instaladas. Sin esto, el servidor "mercadolibre" definido
# en .mcp.json falla con CONNECTION_CLOSED / ERR_MODULE_NOT_FOUND hasta que
# alguien corre `npm install` a mano.
cd "$CLAUDE_PROJECT_DIR/mcp-ml"
if [ ! -d node_modules ]; then
  npm install
fi
