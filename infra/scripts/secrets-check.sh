#!/bin/bash
echo "Verificando se há secrets (.env) commitados acidentalmente..."

if git ls-files | grep "\.env" | grep -v "\.env\.example"; then
  echo "❌ ERRO: Arquivos .env encontrados no versionamento. Remova-os imediatamente."
  exit 1
fi

echo "✅ Nenhum .env exposto encontrado no versionamento."
exit 0
