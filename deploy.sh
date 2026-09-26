#!/bin/bash
# Uso: ./deploy.sh V3.49 "mensaje del commit" CASO_ID
# CASO_ID = el caso_exg abierto por preparar_tarea_exg, con version_objetivo=VERSION.
set -e
VERSION=$1
MSG=$2
CASO_ID=$3
SUPABASE_URL="https://sshctqnpuolawtcujxkt.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzaGN0cW5wdW9sYXd0Y3VqeGt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDMxNDQsImV4cCI6MjEwNDUxOTE0NH0.NgqSwwtdQjKot2kiCabmF6f_kvl-27QU1kWgfzYPFsQ"

if [ -z "$VERSION" ] || [ -z "$MSG" ] || [ -z "$CASO_ID" ]; then
  echo "Uso: ./deploy.sh V3.XX 'mensaje' CASO_ID"
  echo "CASO_ID viene de preparar_tarea_exg — el caso debe estar abierto y su version_objetivo debe ser V3.XX"
  exit 1
fi

# EXG — FASE 3: no se toca ni un byte de index.html sin que el caso lo respalde
CHECK=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/exg_verificar_deploy" \
  -H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"p_caso_id\":\"${CASO_ID}\",\"p_version\":\"${VERSION}\"}")
OK=$(echo "$CHECK" | grep -o '"ok":true' || true)
if [ -z "$OK" ]; then
  echo "❌ EXG bloqueó el deploy: $CHECK"
  exit 1
fi
echo "✓ EXG: caso ${CASO_ID} abierto, version_objetivo coincide con ${VERSION} — publicando"

# Actualizar versión en HTML
python3 -c "
import re, sys
with open('index.html','r',encoding='utf-8') as f: c=f.read()
c=re.sub(r'(<div class=\"sub\" id=\"version-badge\">)(V[\d.]+)(</div>)', r'\g<1>${VERSION}\3', c)
with open('index.html','w',encoding='utf-8') as f: f.write(c)
print('HTML actualizado a ${VERSION}')
"
# Commit y push — si algo falla aquí, 'set -e' corta el script y version_final NUNCA se marca
git add -A
git commit -m "${VERSION} — ${MSG}"
git push origin main

# Solo si el push anterior terminó con éxito llegamos aquí: marcar version_final
MARCADO=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/exg_marcar_version_publicada" \
  -H "apikey: ${SUPABASE_ANON_KEY}" -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"p_caso_id\":\"${CASO_ID}\",\"p_version\":\"${VERSION}\"}")
echo "EXG version_final: $MARCADO"
echo "Ahora se puede cerrar el caso ${CASO_ID} con cerrar_tarea_exg."
