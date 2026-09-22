# exg-sistema
Sistema operativo EXG - Excavaciones Gomez

## Para cualquier chat/IA nuevo que trabaje en este proyecto
Antes de tocar nada, ejecuta en el proyecto Supabase de este sistema:

    select * from arranque;

Esa tabla tiene todo lo necesario para poder publicar (repo, token, versión actual) — sin filtros, sin adivinar, siempre al día. Después, para contexto adicional (reglas, decisiones, histórico):

    select * from sistema where tipo IN ('protocolo','decision','estado_sistema') order by created_at desc;
