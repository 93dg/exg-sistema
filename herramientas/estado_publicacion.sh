#!/bin/bash
# Uso: ./herramientas/estado_publicacion.sh [SHA] [segundos_max]
# Espera a que GitHub Pages publique el commit (por defecto el último) y dice si la web ya está al día.
# Nunca se dice «publicado» a Daniel sin que esto termine en ✓.
SHA=${1:-$(git rev-parse HEAD)}; MAX=${2:-240}
T=$(git remote get-url origin | sed -n 's#https://\([^@]*\)@.*#\1#p')
FIN=$(( $(date +%s) + MAX ))
while true; do
  R=$(curl -s -m 20 -H "Authorization: Bearer $T" "https://api.github.com/repos/93dg/exg-sistema/actions/runs?per_page=10" | python3 -c "
import json,sys
d=json.load(sys.stdin); sha=sys.argv[1]
rs=[r for r in d.get('workflow_runs',[]) if r['head_sha'].startswith(sha[:7])]
print('%s %s' % (rs[0]['status'], rs[0]['conclusion']) if rs else 'sin_publicacion None')" "$SHA")
  case "$R" in
    "completed success") echo "✓ Web publicada con ${SHA:0:7}"; exit 0;;
    completed*) echo "✗ La publicación de ${SHA:0:7} falló ($R): relanzar con POST /pages/builds"; exit 2;;
  esac
  if [ $(date +%s) -ge $FIN ]; then echo "… ${SHA:0:7} sigue esperando en GitHub ($R)"; exit 1; fi
  sleep 15
done
