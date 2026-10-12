#!/usr/bin/env python3
"""Control de diseño EXG (guía de diseño de Daniel). deploy.sh lo ejecuta antes de publicar.
Solo bloquea lo NUEVO: lo que ya existía está en herramientas/lint_baseline.json (para repasarlo y vaciarlo).
Cada reporte de diseño de Daniel añade aquí su comprobación (regla 13 de la GUÍA DE DISEÑO EXG)."""
import re, sys, json, os
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FICHEROS = ['index.html', 'rentabilidad/rent.js']
BASE = os.path.join(RAIZ, 'herramientas', 'lint_baseline.json')
FLECHAS = '▾▴▸◂▼▲►◄▶◀⌄⌃›‹'
REGLAS = [
 ('flecha', 'Sin flechas ni triángulos en filas (guía 2)', re.compile('[' + FLECHAS + ']')),
 ('subrayado', 'Sin subrayados ni punteados que no sean enlaces (guía 2)', re.compile(r'text-decoration\s*:\s*underline|border-bottom\s*:\s*[^;"}]*dotted', re.I)),
 ('tabla-en-rent', 'Sin <table> en las vistas móviles de rentabilidad (guía 3)', re.compile(r'<table', re.I)),
]
CSS_BLOQUE = re.compile(r'([^{};<>]{1,200})\{([^{}]{1,500})\}')
SEL = re.compile(r'(?<![\w-])(?:on|active|sel|selected|checked|activo|marcado)(?![\w-])|:checked', re.I)
FONDO_NARANJA = re.compile(r'(?<![\w-])background(?:-color)?\s*:\s*(?:var\(--orange\)|#e[0-9a-f]{5}|orange)(?![\w-])', re.I)
def relleno_naranja(txt, f):
    out = []
    for m in CSS_BLOQUE.finditer(txt):
        sel, cuerpo = m.group(1).strip(), m.group(2)
        if SEL.search(sel) and FONDO_NARANJA.search(cuerpo):
            out.append({'f': f, 'regla': 'relleno-naranja-en-seleccionado', 'txt': re.sub(r'\s+', ' ', sel)[-120:]})
    return out
def hallazgos():
    out = []
    for f in FICHEROS:
        ruta = os.path.join(RAIZ, f)
        if not os.path.exists(ruta): continue
        out += relleno_naranja(open(ruta, encoding='utf-8').read(), f)
        for n, linea in enumerate(open(ruta, encoding='utf-8').read().split('\n'), 1):
            for clave, _, rx in REGLAS:
                if clave == 'tabla-en-rent' and not f.endswith('rent.js'): continue
                if rx.search(linea):
                    out.append({'f': f, 'regla': clave, 'txt': re.sub(r'\s+', ' ', linea.strip())[:160]})
    return out
def cuenta(h):
    c = {}
    for x in h: c[x['f'] + '|' + x['regla']] = c.get(x['f'] + '|' + x['regla'], 0) + 1
    return c
DESC = {c: d for c, d, _ in REGLAS}
DESC['relleno-naranja-en-seleccionado'] = 'Seleccionado = SOLO borde naranja, nunca relleno naranja (guía 1)'
if __name__ == '__main__':
    h = hallazgos(); c = cuenta(h)
    if '--baseline' in sys.argv:
        json.dump(c, open(BASE, 'w'), indent=0); print('baseline guardada:', len(h)); sys.exit(0)
    if '--todo' in sys.argv:
        for x in h: print(x['regla'], x['f'], x['txt'])
    base = json.load(open(BASE)) if os.path.exists(BASE) else {}
    malos = [k for k, v in c.items() if v > base.get(k, 0)]
    if malos:
        print('❌ DISEÑO: se ha AÑADIDO algo que incumple la GUÍA DE DISEÑO EXG de Daniel (herramientas/lint_diseno.py --todo para ver dónde):')
        for k in malos:
            f, r = k.split('|'); print(' -', DESC[r], '| %s | antes %d, ahora %d' % (f, base.get(k, 0), c[k]))
        sys.exit(1)
    print('✓ Diseño: nada nuevo que incumpla la guía (por repasar de antes:', len(h), ')')
