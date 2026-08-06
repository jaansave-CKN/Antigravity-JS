# Skill: obsidian-context

Mantiene actualizada la bóveda de contexto en `_contexto_obsidian/` (ver [[00_INDEX]] dentro de esa carpeta) para que refleje el estado real del proyecto RadFor-360, sin que un humano tenga que reescribirla a mano cada vez.

> Nota de implementación: este archivo es la especificación de comportamiento. Si el runtime que lo ejecuta es Claude Code, la forma nativa de hacerlo invocable como skill (`/obsidian-context`) es además crear `.claude/skills/obsidian-context/SKILL.md` con el frontmatter `name`/`description` que exige ese mecanismo — este archivo no sustituye eso, lo complementa como la fuente de verdad de las reglas.

## Disparadores (cuándo actuar)

Ejecutar un re-escaneo cuando ocurra cualquiera de estos eventos:

- Se crea, borra o mueve un endpoint en `backend/routes/*.js` o `server.js`.
- Se agrega una migración nueva en `backend/migrations/*.sql`.
- Se agrega, elimina o renombra una página en `client/src/pages/`.
- Se cierra un ítem marcado en [[pendientes]] (ver checklist), o se descubre uno nuevo (bug real, módulo huérfano, dependencia rota).
- Se toma una decisión de arquitectura no trivial (cambio de proveedor de despliegue, cambio de librería base, política de seguridad nueva).
- Se resuelve o descubre un hallazgo de seguridad (secretos, RLS, auth).
- El usuario pide explícitamente "actualiza el contexto de Obsidian" o equivalente.

No hace falta re-escanear en cada commit trivial (fix de typo, ajuste de estilo CSS, etc.) — el criterio es: ¿esto cambia algo que las notas afirman?

## Qué escanear

1. `package.json` — nombre, versión, dependencias nuevas/removidas relevantes (stack en [[00_INDEX]]).
2. `backend/routes/*.js`, `server.js` (rutas activas) — módulos y endpoints (mapa de archivos en [[00_INDEX]], detalle en [[requisitos]]).
3. `backend/migrations/*.sql` — nuevas tablas, políticas RLS, columnas de cumplimiento (ver [[hseq_normativa]]).
4. `client/src/pages/*.tsx` — wizards y vistas nuevas o eliminadas (ver [[requisitos]]).
5. `.github/workflows/*.yml` — cambios de pipeline/despliegue (ver [[registros_arquitectura]]).
6. Últimos commits relevantes (`git log --oneline -20`) — para detectar decisiones no documentadas todavía.

## Qué actualizar y dónde

| Cambio detectado | Nota a actualizar |
|---|---|
| Nuevo endpoint, tabla, o módulo backend | [[requisitos]] (si es funcionalidad nueva) + [[00_INDEX]] (mapa de archivos) |
| Decisión técnica tomada (por qué se hizo algo de cierta forma) | [[registros_arquitectura]] — agregar entrada nueva arriba, con fecha, nunca reescribir el historial ya asentado |
| Hallazgo o cambio de cumplimiento/seguridad/RLS/secretos | [[hseq_normativa]] |
| Algo se resuelve o se descubre como faltante | [[pendientes]] — mover a "Resuelto recientemente" o agregar fila nueva en la sección que corresponda |
| Cambio de stack/puertos/despliegue | [[00_INDEX]] tabla de pila tecnológica |

Reglas de edición:

- Nunca borrar una entrada de [[registros_arquitectura]] — es un log histórico, se agrega, no se reescribe.
- En [[pendientes]], al cerrar un ítem: marcarlo `[x]` y moverlo a "Resuelto recientemente" con fecha, no borrarlo sin dejar rastro.
- Mantener los wikilinks `[[nombre_nota]]` — si se crea una nota nueva, enlazarla desde [[00_INDEX]].
- Todo dato afirmado debe venir de verificación real (leer el archivo, correr el comando) — no inventar ni asumir desde memoria de conversaciones previas.

## Qué NO tocar (carpetas personales / fuera de alcance)

- `FOTOS PROY3/`, `data/`, `logs/`, `notifications/`, `archive/`, `stitch_export/` — contenido personal u operativo del usuario, no documentación de arquitectura.
- Cualquier archivo `.env*`, `claves_privadas.txt`, o cualquier cosa que luzca como credencial — jamás copiar valores de secretos hacia las notas, ni siquiera parcialmente.
- `node_modules/`, `dist/`, `.kilo/worktrees/` — generado/temporal, no documentar contenido de terceros.
- No modificar el código del proyecto — este skill solo lee el repo y escribe dentro de `_contexto_obsidian/`.

## Cómo invocarlo manualmente

Mientras no exista automatización de eventos, pedir explícitamente: "actualiza el contexto de Obsidian" o "/obsidian-context" (si ya está registrado como skill de Claude Code) dispara un ciclo completo de escaneo + actualización de las 4 notas según las reglas de arriba.
