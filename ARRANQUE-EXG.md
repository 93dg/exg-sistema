# ARRANQUE EXG — leer antes de hacer nada (cualquier chat, cualquier modelo)

## REGLA NÚMERO UNO (Daniel 10/11/2026) — antes que todo lo demás
**La memoria está en la web, no en el chat.**
- Antes de hacer o preguntar nada, y cada vez que haya una duda, se mira en la web (hechos_daniel, sistema, casos_exg, documentos, correo_tratado, borradores de Gmail). Nunca en lo que se recuerde del chat.
- Todo lo que Daniel aprueba o dice se guarda en la web en el momento: hechos con `anotar_hecho_daniel`, tareas en `sistema`, y el texto de cualquier correo como borrador en Gmail. Un correo aprobado para más tarde se envía desde ese borrador, sin rehacerlo ni volver a preguntar.
- `preparar_tarea_exg` la devuelve la primera (clave «1») y `confirmar_guia_exg` no deja seguir si no empieza con «REGLA 1: …» diciendo qué se ha mirado en la web y dónde se guardará lo aprobado.


La memoria de EXG vive en la base de datos (Supabase sshctqnpuolawtcujxkt), no en el chat. Si el chat es nuevo, largo o resumido, da igual: se sigue esto.

1. **Abrir caso:** `select preparar_tarea_exg('orden', array['Sección'], 'ejecucion')`. Leer la salida ENTERA y llamar a `confirmar_guia_exg(caso_id, clave, reglas que aplican)`. Sin eso la base no deja escribir ni publicar. Nunca la v2.
2. **Antes de tocar una pantalla:** `select memoria_pantalla(caso_id, 'Pantalla')` (Estadísticas, Simulación, Centro de control, Proformas…). Trae lo que Daniel ha dicho de esa pantalla en sus palabras y lo último que se cambió. Leerla entera. Sin consultarla, el deploy se bloquea.
3. **Seguridad mínima 80 %:** antes de actuar, decir el nivel de seguridad de haber entendido lo que pide. Por debajo, una sola pregunta con la propuesta escrita y no tocar nada.
4. **Reportes:** solo con `select reportes_pendientes_exg()` (texto completo, nunca cortado). «Bandeja», «Reportes» = función bandeja con sus cinco partes.
5. **Lo que dice Daniel se guarda en el mismo turno:** `anotar_hecho_daniel(tema, hecho, palabras)`.
6. **Publicar:** `./deploy.sh VERSION "mensaje" CASO_ID` en el repo 93dg/exg-sistema. Bloquea si falta guía o memoria, si el código incumple la guía de diseño (`herramientas/lint_diseno.py`) o si la web real a 390 px muestra textos en minúscula al principio, partidos o que se salen (`herramientas/auditoria_pantallas.py`; necesita `herramientas/.clave_lectura` = `select valor from exg_claves where nombre='correo-adjuntos'`, que no se sube al repo).
7. **Cada respuesta termina** con la línea `VX.YY · EXG · Subir S3.31`.
