#!/usr/bin/env python3
"""Control de diseño EXG (guía de diseño de Daniel). deploy.sh lo ejecuta antes de publicar.
Solo bloquea lo NUEVO: lo que ya existía está en herramientas/lint_baseline.json (para repasarlo y vaciarlo).
Cada reporte de diseño de Daniel añade aquí su comprobación (regla 13 de la GUÍA DE DISEÑO EXG)."""
import re, sys, json, os
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FICHEROS = ['index.html', 'rentabilidad/rent.js']
BASE = os.path.join(RAIZ, 'herramientas', 'lint_baseline.json')
EXCEPCION_VISOR = ('if(s.u) css', "x.localName === 't') h += visorEsc")
FLECHAS = '▾▴▸◂▼▲►◄▶◀⌄⌃›‹'
REGLAS = [
 ('flecha', 'Sin flechas ni triángulos en filas (guía 2)', re.compile('[' + FLECHAS + ']')),
 ('subrayado', 'NI UN subrayado en la web (guía 2, decisión de Daniel 12/10/2026)', re.compile(r'text-decoration\s*:\s*underline|text-underline|<u[ >]|border-bottom\s*:\s*[^;"}]*dotted', re.I)),
 ('emoji', 'Sin emojis en la web (Daniel 18/10/2026: «odio los emojis»)', re.compile('[\U0001F300-\U0001FAFF\u2600-\u26FF\u2700-\u2714\u2716-\u27BF]')),
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
# 16/10/2026 (reporte 906b6061, Daniel: «textos tan poco profesionales y tan chapuceros»): los textos de la web
# se escriben en registro profesional; nunca se copia literalmente cómo habla Daniel al dar instrucciones.
# Solo mira el código (se quitan los comentarios, donde sí se citan sus palabras).
COLOQUIAL = re.compile(r"\b(?:me toca|te toca|nos toca|cosas|de golpe|un montón|mogollón|follón|chapuz\w*|joder|coño|put[oa]s?|mierda|curro|pasta|guay|cutre|lo de abajo|lo de arriba|tu padre|mi padre|ya te digo|o sea|esta gente|la gente|gente pagada|lo de dos|lo de hoy|echan sus|se lleva|vs hoy|desgrav\w*|cobráis|lo que deja|que más dejan|limpio al año|se podría hacer|se trabajaría)\b", re.I)   # 20/10/2026 (Daniel: «si hay una regla que dijimos hace poco, que no más cosas coloquiales»): frases del simulador
COLOQUIAL_MAY = re.compile(r"\bVale,|\bVale con\b|\bNO con\b")
COMENT = re.compile(r'(^|[\s;{}(,])//.*$|/\*.*?\*/|<!--.*?-->')
def coloquial(txt, f):
    out = []
    for linea in txt.split('\n'):
        s = COMENT.sub(r'\1', linea)
        if 'base64,' in s: continue
        for m in list(COLOQUIAL.finditer(s)) + list(COLOQUIAL_MAY.finditer(s)):
                out.append({'f': f, 'regla': 'texto-coloquial', 'txt': s.strip()[max(0, m.start() - 60):m.end() + 60]})
    return out
def hallazgos():
    out = []
    for f in FICHEROS:
        ruta = os.path.join(RAIZ, f)
        if not os.path.exists(ruta): continue
        out += relleno_naranja(open(ruta, encoding='utf-8').read(), f)
        out += coloquial(open(ruta, encoding='utf-8').read(), f)
        for n, linea in enumerate(open(ruta, encoding='utf-8').read().split('\n'), 1):
            for clave, _, rx in REGLAS:
                if clave == 'tabla-en-rent' and not f.endswith('rent.js'): continue
                if clave == 'subrayado' and any(e in linea for e in EXCEPCION_VISOR): continue   # el visor reproduce el formato propio de un documento ajeno
                if rx.search(linea):
                    out.append({'f': f, 'regla': clave, 'txt': re.sub(r'\s+', ' ', linea.strip())[:160]})
    return out
def cuenta(h):
    c = {}
    for x in h: c[x['f'] + '|' + x['regla']] = c.get(x['f'] + '|' + x['regla'], 0) + 1
    return c
DESC = {c: d for c, d, _ in REGLAS}
DESC['texto-coloquial'] = 'Texto coloquial en la web: escríbelo en registro profesional, no copies cómo lo dice Daniel (reporte 906b6061)'
DESC['relleno-naranja-en-seleccionado'] = 'Seleccionado = SOLO borde naranja, nunca relleno naranja (guía 1)'
def nombre_fila_plegada():
    # V12.51 (reporte 0768ff66): en la fila plegada el nombre del cliente se ve entero y solo su propio texto abre la ficha
    t = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'index.html'), encoding='utf-8').read()
    m = re.search(r'\.cc-fc-bloque \.cc-fc-cli\{([^}]*)\}', t)
    ok = m and 'align-self:flex-start' in m.group(1) and 'cliAjustar' in t
    return [] if ok else [{'f': 'index.html', 'regla': 'nombre-fila-plegada', 'txt': m.group(0) if m else 'falta la regla .cc-fc-bloque .cc-fc-cli'}]
def hoja_movil():
    # V12.55: en el móvil ninguna ficha puede quedar tapada abajo: todas son hoja deslizante por encima de la barra
    t = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'index.html'), encoding='utf-8').read()
    ok = '.overlay:has(> .drawer){align-items:flex-end;padding:0;z-index:3200;}' in t and '@keyframes hoja-sube' in t
    return [] if ok else [{'f': 'index.html', 'regla': 'hoja-movil', 'txt': 'falta la hoja deslizante de las fichas en el móvil'}]
DESC['hoja-movil'] = 'Fichas en el móvil: hoja deslizante por encima de la barra de abajo, nada tapado (Daniel 25/10)'
DESC['nombre-fila-plegada'] = 'Fila plegada: el nombre del cliente en una línea con la letra ajustada para verse entero y solo su texto abre la ficha (reporte 0768ff66)'
if __name__ == '__main__':
    h = hallazgos() + nombre_fila_plegada() + hoja_movil(); c = cuenta(h)
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
