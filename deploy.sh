#!/bin/bash
# Uso: ./deploy.sh V3.49 "mensaje del commit"
VERSION=$1
MSG=$2
if [ -z "$VERSION" ] || [ -z "$MSG" ]; then
  echo "Uso: ./deploy.sh V3.XX 'mensaje'"
  exit 1
fi
# Actualizar versión en HTML
python3 -c "
import re, sys
with open('index.html','r',encoding='utf-8') as f: c=f.read()
c=re.sub(r'(<div class=\"sub\" id=\"version-badge\">)(V[\d.]+)(</div>)', r'\g<1>${VERSION}\3', c)
with open('index.html','w',encoding='utf-8') as f: f.write(c)
print('HTML actualizado a ${VERSION}')
"
# Commit y push
git add -A
git commit -m "${VERSION} — ${MSG}"
git push origin main
# Actualizar BD
echo "Actualiza la BD manualmente: UPDATE arranque SET valor='${VERSION}' WHERE clave='web_version_actual';"
