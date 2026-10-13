# Comprueba que todos los <script> de index.html (y los .js propios) se pueden leer sin errores de sintaxis. Lo llama deploy.sh.
import re, subprocess, sys, tempfile, os
raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
malos = []
for f in ['index.html', 'subir.html']:
    p = os.path.join(raiz, f)
    if not os.path.exists(p): continue
    s = open(p, encoding='utf-8').read()
    for i, m in enumerate(re.finditer(r'<script(?![^>]*src)(?![^>]*type="(?:application/ld\+json|text/template)")[^>]*>([\s\S]*?)</script>', s)):
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as t: t.write(m.group(1)); n = t.name
        r = subprocess.run(['node', '-e', "new Function(require('fs').readFileSync(process.argv[1],'utf8'))", n], capture_output=True, text=True); os.unlink(n)
        if r.returncode: malos.append(f'{f} script {i}: ' + (r.stderr.strip().splitlines() or ['?'])[-1][:200])
for d in ['rentabilidad', 'herramientas']:
    for f in os.listdir(os.path.join(raiz, d)) if os.path.isdir(os.path.join(raiz, d)) else []:
        if f.endswith('.js'):
            r = subprocess.run(['node', '-e', "new Function(require('fs').readFileSync(process.argv[1],'utf8'))", os.path.join(raiz, d, f)], capture_output=True, text=True)
            if r.returncode: malos.append(f'{d}/{f}: ' + (r.stderr.strip().splitlines() or ['?'])[-1][:200])
if malos:
    print('❌ JavaScript con errores de sintaxis:'); [print(' -', x) for x in malos]; sys.exit(1)
print('✓ JavaScript sin errores de sintaxis')
