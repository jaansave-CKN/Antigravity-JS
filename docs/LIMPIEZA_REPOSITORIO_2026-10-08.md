# Limpieza y reorganización del repositorio — 2026-10-08

- **Orden:** Jairo Antonio Salinas Velasco ("optimización y desfragmentación; sin información obsoleta ni fuera de lugar"), con aprobación explícita por grupo.
- **Conservado por decisión del dueño:** herramientas personales fuera de la app (`cloudflared.exe`, `ObsidianVault/`, `Repositorios/`, scripts de NotebookLM, `opencode.json`).
- **Recuperación:** todo lo versionado que se elimina sigue en el historial de git (`git checkout <commit-anterior> -- <ruta>`).

## Método de verificación (aplicado a cada archivo antes de borrarlo)

1. `git grep -F "<nombre de archivo>"` sobre todo el repositorio, excluyendo `node_modules/`, `proyectos/` (sub-proyectos con repo propio), documentación narrativa (`docs/`, `*.md`), `.gitignore`, la telemetría del PMU y el JSON generado `public/estado_antigravity.json`, y excluyendo el propio conjunto que se elimina.
2. Resultado: **cero referencias vivas**. Las dos coincidencias encontradas fueron falsos positivos por nombre, verificados uno a uno:
   - `agents/generar_reporte.cjs` ← `server.js` importa **`./scripts/generar_reporte.cjs`** (otro archivo, que se conserva).
   - `config/index.json` ← coincidencia con el nombre `municipios_index.json`. Además `config/index.json` es **copia idéntica** de `public/municipios_index.json` (33 departamentos, 1.103 municipios, JSON igual byte a byte tras parseo).
3. Después del borrado: `npm run test:gate` **255/255 (exit 0)**, `server.js` arranca y `npm run build` compila (exit 0).

## Grupo 1 — basura local no versionada (sin commit)

Carpetas vacías (`scripts/analysis`, `checks`, `cli`, `debug`, `reports`, `.claude/worktrees`), caché `.firebase/` de la raíz (14 MB, regenerable), capturas `rf_rastreo2_*.png`, nota suelta `ui-inject` y `Radar_Resultados/` (salidas JSON del radar de mayo de 2026, sin consumidor).

## Grupo 2 — restos del Proyecto 01 (Donaciones) y tooling legacy

El Proyecto 01 fue purgado del disco el 2026-08-05 (`AGENTS.md` §VI); estos archivos son sus restos o tooling sin consumidor:

| Ruta | Qué era | Por qué es obsoleto |
|---|---|---|
| `scripts/core/motor_donaciones.js` | Motor del Proyecto 01 (Donaciones) | Dominio retirado el 2026-08-05; ningún módulo de RadFor-360 lo importa |
| `scripts/core/sync_trello.js`, `scripts/trello_diagnostic.js` | Sincronización con Trello | Sin consumidor; integración no usada por la app |
| `scripts/tools/*` (16), `scripts/data/*` (7), `scripts/create-campaign*`, `scripts/get_lists.js`, `scripts/get_senders.js` | Análisis de campañas de email marketing (Brevo) | Scripts manuales de campañas del Proyecto 01; el correo transaccional vigente vive en `src/modules/communications/` y no depende de ellos |
| `scripts/maintenance/*` (5) | Arreglos puntuales de "proyecto1" (bloqueo, áreas, encoding) | Mantenimiento de un proyecto retirado |
| `scripts/sentinela/*` | Supervisor de conexiones legacy | Sin consumidor (las coincidencias de "sentinela" en el gate son el agente 004, no este script) |
| `scripts/stitch_downloader.js` | Respaldo offline de Stitch del proyecto "dotaciones" | Proyecto retirado |
| `scripts/open_browser.bat`, `open_dashboard.ps1`, `start_dashboard.bat` | Lanzadores del dashboard de proyecto01 (Internet Explorer por COM) | Navegador retirado; sin uso |
| `agents/check_image.cjs`, `clean_excel.cjs`, `extractor-pro.cjs`, `read_excel.cjs`, `read_image.cjs`, `vision-engine.cjs`, `perfil_disenador.json` | Utilidades del "Sistema A" legacy (OCR, Excel, imágenes) | Sin consumidor; estaban sueltas en la carpeta del gate |
| `agents/fetch_municipios.cjs` | Descarga de municipios | Escribía en `PROYECTOS_ACTIVOS/Proy_01_Donaciones/` (ruta inexistente); el catálogo vigente es `public/municipios_index.json` |
| `agents/generar_reporte.cjs` | Copia antigua del generador de reporte | El vigente es `scripts/generar_reporte.cjs` |
| `config/config_proy_01.json`, `global_config.json` ("Gestión de Donaciones"), `stitch-sync.json` ("dotaciones"), `auto_deploy.json` (último despliegue 2026-04-28), `agent_skills_logic.json`, `mcp_config.json`, `ag_vision_config.json` | Configuración del Proyecto 01 y del Sistema A | Sin consumidor |
| `config/index.json` | Catálogo de municipios | Duplicado exacto de `public/municipios_index.json` |
| `lib/*.traineddata` (no versionado, 8,2 MB) | Datos de OCR de `vision-engine.cjs` | Su único consumidor se elimina |

## Estado runtime del gate

- `agents/veredicto_*.json` y `agents/pmu/orquestacion_log.jsonl` pasan a `.gitignore`: el gate los regenera en cada aprobación (los veredictos ya se habían retirado del índice en el commit 89da27a y solo reaparecían como archivos sin versionar).
- **Se mantienen versionados, a propósito:** `agents/diseno_aprobado.json` (la CI ejecuta `--check-gate` sobre la firma commiteada, `.github/workflows/gate.yml`) y `agents/pmu/estado_operativo.json` + `telemetria.jsonl` (traza de auditoría del PMU, `AGENTS.md` §III-B).

## Cambios ajenos apartados (no incluidos en esta limpieza)

Modificaciones sin commitear de `projects/Radford-360/` (hoy `agents/dominio-radfor360/`, ver grupo 4) (IDENTITY/PERMISSIONS, otra sesión, 2026-09-29) apartadas en `git stash` ("EXTERNO 2026-09-29: …") para no mezclarlas: el agente 002 objetó que describen como política vigente PRs aún no fusionados. Quedan a decisión del dueño (`git stash list`).

## Grupo 3 — artefactos de build versionados por error

| Ruta | Qué era | Por qué se retira |
|---|---|---|
| `config/public/` (`index.html`, `assets/index-*.js/css`, iconos) | Copia antigua del frontend compilado | La app se construye en `dist/` (`npm run build`, ignorado por git) y se sirve desde Render; esta copia no se regeneraba y desplegarla publicaría una versión obsoleta |
| `config/.firebase/hosting.*.cache` | Caché local de Firebase Hosting | Artefacto de la CLI de Firebase, no fuente |

**No se tocan, a propósito:** `config/firebase.json`, `config/.firebaserc`, `config/firestore.rules`, `config/firestore.indexes.json` y la `firestore.rules` de la raíz. Son configuración de seguridad de Firestore: las dos copias de reglas difieren (la de `config/` aún incluye colecciones del Proyecto 01: donaciones, contadores, proyectos modulares) y no hay forma de saber desde el repositorio cuál está desplegada. Unificarlas requiere verificar las reglas activas en la consola de Firebase. Con `config/public/` retirado, un `firebase deploy` de Hosting fallará en vez de publicar el frontend viejo; `firebase deploy --only firestore` no se ve afectado.

## Grupo 4 — reorganización estructural (`git mv`, historial conservado)

| Antes | Después | Motivo |
|---|---|---|
| `projects/Radford-360/` | `agents/dominio-radfor360/` | `projects/` (inglés) convivía con `proyectos/` (sub-proyectos con repo propio, ignorados por git) y parecía un duplicado. Son las fichas de los agentes del dominio RadFor-360: pertenecen a `agents/`. El ejecutor por lotes y la firma del gate solo consideran carpetas numeradas (`listarCarpetasAgentes()`, patrón `^\d{2,3}[_-]`), así que la nueva ruta no altera ni uno ni otro. |
| `docs/RADIOGRAFIA_FORENSE_360_2026-08-06/07/08`, `docs/INFORME_RECONCILIACION_CIERRE_2026-08-07`, `docs/RADFOR360_IMPLEMENTACION_2026-08-06` (.md y .pdf), `docs/analisis_gaps_v1.md` | `docs/historico/` | Informes fechados ya superados por documentos posteriores; separados de la documentación viva. |
| `docs/separar-remote-radarfondos.sh` | `scripts/` | Es una herramienta (operación pendiente de decisión humana), no documentación. Sigue vigente: el remoto aún mezcla `master` de Antigravity con las ramas de RadarFondos. |

Referencias actualizadas en código (comentarios de `server.js`, `FormuladorPgController.js`, `session-manager.js`, `validation.js`, `scripts/generar_reporte.cjs`), gate (`rutear('formulacion')` y su prueba), registro de skills, `README` de skills rescatadas, documentos vivos y referencias cruzadas entre informes históricos. Verificación: cero referencias a las rutas antiguas fuera de `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md`.

**Nombre de la carpeta:** `dominio-radfor360` usa el nombre oficial del producto, **RadFor-360** (Radar + Formulador; `AGENTS.md` §II.2). `Radford-360` era una grafía histórica de la carpeta; los nombres de las subcarpetas (`Proy_03 GP Radford-360`) se conservan para no romper referencias.

**Gate — diff con renombrados (corregido en este commit):** `construirDiffPriorizado()` usaba `--no-renames`, así que cada `git mv` llegaba al 002 como baja más alta completa. Las altas caían al último bucket y se truncaban, y el 002 rechazó por "ruta inexistente". Ahora usa `--name-status -z -M`:
- un movimiento sin cambios se resume como "RENOMBRADO — antes: …" y se nombra siempre, aunque se agote el presupuesto;
- un renombrado con cambios envía solo el delta;
- las fichas `agents/dominio-*/` suben de prioridad.

Pruebas: `parsearNameStatus` y `bucketDe`.

**Fin de línea:** nuevo `.gitattributes` con `*.sh text eol=lf`. Con `core.autocrlf=true` un checkout podía convertir los scripts de shell (`scripts/pre-commit.sh`, `scripts/separar-remote-radarfondos.sh`, scripts de skills) a CRLF y romperlos en bash.

**Pendiente de 007:** `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` (mandato exclusivo de escritura del 007) conserva las rutas antiguas en su narrativa histórica (`projects/Radford-360`, `INFORME_RECONCILIACION_CIERRE_2026-08-07`).

**Recuperar los cambios ajenos apartados en la ruta nueva** (si el dueño decide conservarlos):

El parche del stash no se puede aplicar directo (`git stash show -p | git apply` falla: incluye borrados del grupo 2 y las rutas internas ya cambiaron). Método verificado (6/6 archivos extraídos): sacar cada archivo completo del stash y reescribir la ruta.

```bash
S='stash^{/EXTERNO 2026-09-29}'
D='agents/dominio-radfor360'
# 4 archivos versionados modificados
for f in "Proy_03 A Radar/IDENTITY.md" "Proy_03 B Formulador/IDENTITY.md" \
         "Proy_03 GP Radford-360/IDENTITY.md" "Proy_03 GP Radford-360/PERMISSIONS.json"; do
  git show "$S:projects/Radford-360/$f" > "$D/$f"
done
# 2 archivos nuevos no versionados (tercer padre del stash)
for f in "Proy_03 A Radar/PERMISSIONS.json" "Proy_03 B Formulador/PERMISSIONS.json"; do
  git show "$S^3:projects/Radford-360/$f" > "$D/$f"
done
# rutas internas a la ubicación nueva
grep -rl 'projects/Radford-360' "$D" | xargs -d '\n' sed -i 's#projects/Radford-360#agents/dominio-radfor360#g'
```

Revisar antes de commitear: tres de las fichas IDENTITY citan PRs (`PR #…`) no fusionados como política vigente (objeción del 002).
