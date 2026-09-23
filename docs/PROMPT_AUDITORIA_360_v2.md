# ⚡ PROTOCOLO DE AUDITORÍA INTEGRAL 360º — v2 (EJECUCIÓN REAL)
**Prompt maestro para agentes con acceso real a shell, archivos, BD y red. Reemplaza a la v1 (2026-09-23).**

> Principio rector: **una auditoría que no ejecuta el sistema no audita el sistema, audita el texto.** La v1 era de lectura de código; la mayoría de los defectos reales (producción sirviendo otra app, gráficos que no se dibujan, bucles que agotan cuotas, CSP que solo rompe en producción, reinicios en bucle por health check) solo aparecen **ejecutando**.

---

## BLOQUE 0 — DESCUBRIMIENTO (NADA DE ESTO SE ASUME)

Los datos de abajo son **hipótesis a verificar**, no hechos. Confírmalos o corrígelos con evidencia antes de la Fase 1, y anota cada corrección en `audit/00_INVENTARIO.md`.

```
PROYECTO:         <nombre>                     → verificar: package.json, README
STACK:            <declarado>                  → verificar: dependencias reales y versiones instaladas
PRODUCCIÓN:       <URL declarada>              → verificar: ¿qué código sirve REALMENTE esa URL? (firma de /api/health vs repo)
DESPLIEGUE:       <plataforma>                 → verificar vía API: servicio, RAMA, root dir, comandos, env vars (solo nombres)
BD:               <motor/host>                 → verificar: host real que usa cada entorno (local vs prod); ¿es la misma BD?
REPO REMOTO:      <url>                        → verificar: ¿público o privado? (define qué se puede commitear)
MULTI-TENANT / DINERO / PII / LLM: <sí/no>     → verificar en código Y en BD viva
MONEDA_REPORTE:   COP
EXCLUIDO:         node_modules, .git, valores de .env (solo se reportan NOMBRES de variables)
```

---

## BLOQUE 1 — REGLAS DE VERACIDAD (INNEGOCIABLES)

1. **Evidencia o no existe.** Todo hallazgo lleva: comando exacto + salida real, o `archivo:línea` leído. "Debería fallar" no es hallazgo.
2. **Ejecutar mata leer.** Si algo se puede ejecutar (arrancar, llamar, renderizar, consultar), se ejecuta. Leer código solo sirve para explicar lo que la ejecución mostró o para lo que no se puede ejecutar.
3. **Grep solo propone candidatos.** Cada candidato se confirma abriendo el archivo y trazando el flujo, o ejecutándolo. Y se confirma el **negativo**: "0 referencias" exige buscar también URLs armadas por partes, alias de import y rutas relativas.
4. **Tres estados, nunca dos:** `CONFIRMADO` (con evidencia), `NO CONFIRMADO` (hipótesis sin prueba dura, se declara como tal) y `DESCARTADO` (se probó y no es). Prohibido presentar un NO CONFIRMADO como hallazgo.
5. **Ni inflar ni desinflar.** La cantidad de hallazgos es la que es. Prohibido forzar veredictos binarios o cifras de "cobertura" inventadas. Impacto en dinero solo en COP y con fórmula; sin datos se escribe `SIN DATOS`.
6. **Nada heredado.** Auditorías previas, CLAUDE.md, memoria y documentación son hipótesis: se re-verifica cada afirmación antes de usarla.
7. **La frase de cierre solo si es verdad.** Si algo quedó abierto, se dice qué y por qué. Declarar "todo OK" sin evidencia es un fallo de la auditoría.

---

## BLOQUE 2 — REGLAS DE SEGURIDAD PARA AUDITAR SIN ROMPER

1. **BD de producción:** solo lectura con `BEGIN READ ONLY … COMMIT` (alcance de una transacción). **Nunca `SET` de sesión**: tras un pooler en modo transacción (p. ej. Supabase :6543) el `SET` se pega a la conexión compartida y contamina a la app.
2. **Datos de prueba:** si hace falta un usuario o proyecto temporal, créalo por SQL (el registro por API puede disparar correos reales al admin), márcalo (`auditoria_<ts>@example.com`, "AUDITORIA TEMPORAL") y bórralo al terminar **por todas las columnas `user_id`/`org_id`/`proyecto_id`**. Verifica "restos: 0".
3. **Navegador:** solo Chromium headless aislado (Playwright). **Nunca** el navegador real del usuario (inyectar tokens rompe su sesión). Nada de ráfagas contra producción: espacia las peticiones o se activa el anti-bots del CDN.
4. **Secretos:** nunca se imprimen. Se reportan presencia, longitud o hash corto para comparar entornos.
5. **Procesos:** todo proceso temporal que lances (servidor de prueba, backend aislado) se detiene y se verifica que se detuvo.
6. **Repositorio público:** no se commitea detalle de vulnerabilidades abiertas, IPs, nombres de red ni hosts; se versiona una versión redactada y el detalle queda en `audit/privado/` (en .gitignore).
7. **Cambios:** solo si son seguros y reversibles. Auth, esquema de BD, pagos o infraestructura de producción pasan antes por revisión de arquitectura. Diseño visual aprobado: prohibido tocarlo. Borrar datos, rotar credenciales o decisiones de negocio: se presentan y se pide confirmación.

---

## BLOQUE 3 — FASES (EN ORDEN; CADA UNA DEJA EVIDENCIA)

### F0 · Estado vivo (antes de leer una línea de código)
- Procesos (PM2 o equivalente) con reinicios **inestables**, puertos escuchando (dirección incluida: ¿0.0.0.0 o 127.0.0.1?), health local y de producción.
- Últimas líneas de **todos** los logs (backend, frontend, errores, plataforma de despliegue), no solo el "principal". Busca firmas: excepciones no capturadas, `EADDRINUSE`, columnas o tablas inexistentes, 429 o cuota, DNS.

### F1 · Qué corre dónde (la fase que la v1 no tenía)
- `git status`/`diff` completo (lo no commiteado **no está en producción**), ramas locales y remotas, a qué rama empuja cada repo.
- **Plataforma de despliegue vía API:** servicio real, rama, root dir, build/start, auto-deploy, health path, **nombres** de env vars; historial de deploys y **qué commit está live**.
- ¿La URL de producción sirve este código? Compara la firma de `/api/health` (versión) con el repo.
- **CI/CD:** estado y **logs** de los últimos runs de cada workflow (un job rojo desde hace semanas es un hallazgo). ¿Qué secretos referencia el workflow y cuáles existen?
- **Paridad dev↔prod:** qué cambia con `NODE_ENV=production` (CSP, host de escucha, validadores de arranque, variables `VITE_*` incrustadas en build). Construye el build de producción y **sírvelo con los mismos headers de producción** antes de dar la UI por buena.

### F2 · Inventario (`audit/00_INVENTARIO.md`)
- Topología, runtimes, versiones (¿el `engines` coincide con lo que exigen las dependencias?).
- Endpoints (método, ruta, archivo:línea, auth, rol/plan, limitador), generados del código.
- Tablas, RLS, políticas y grants, **consultados en vivo** (nunca desde archivos de migración).
- Variables de entorno: nombres y presencia por entorno; cuáles aborta el arranque si faltan.
- Jobs: cron **y tareas que se disparan al arrancar** (`setTimeout`/`setImmediate` en el bootstrap).

### F3 · Integridad estructural (cables sueltos)
- **Contrato frontend→backend:** cada `/api/...` que llama el frontend (literales, `${BASE}/…`, clientes HTTP) existe en el backend. 0 tolerancia.
- **Backend→frontend:** rutas sin ningún llamador = módulos **construidos sin interfaz**. Clasifícalos (legítimos: webhooks, links de correo, health, cron) vs. trabajo inalcanzable.
- **Código muerto:** grafo de imports desde los puntos de entrada (verificando alias); lo no alcanzable se lista con su tamaño.
- **Basura del repo:** lanzadores o scripts que apuntan a archivos inexistentes, carpetas vacías, binarios o capturas rastreados, `__pycache__`, scripts sueltos con dependencias muertas.

### F4 · Arranque aislado del backend
- `node` directo, sin orquestador, en un puerto libre. Se captura la salida completa de arranque; **cualquier línea de error es hallazgo** aunque no tumbe el proceso (migraciones no idempotentes, reintentos, fallback degradado).

### F5 · Barrido vivo de la API
- Con un usuario temporal con plan completo y un proyecto: **todas** las rutas GET (y admin con sesión admin). Clasifica 2xx/4xx/5xx/timeout y las lentas (>3 s). Todo 5xx se investiga hasta la línea.
- Detecta los **GET con efectos** (filas creadas solo por leer).

### F6 · Barrido vivo de la UI
- Chromium headless con sesión real y proyecto activo: **todas** las rutas del router. Por página: errores JS y de consola, respuestas `/api` ≥400, pantalla de error o en blanco, redirecciones, llamadas de escritura al cargar (PUT/POST en el mount). Captura por página.
- Compara dev vs build de producción servido con headers de producción.

### F7 · Base de datos viva e higiene de datos
- Columnas y tablas referenciadas por el código que no existen (confirma con logs y `information_schema`). Constraints, RLS y grants.
- **Higiene:** filas que un proceso reintenta para siempre sin progresar, datos de prueba acumulados, tablas que el código cree que existen y no existen.

### F8 · Dependencias externas en vivo
- Cada llave de API: **llamada mínima real** y respuesta cruda (cuota, `RESOURCE_EXHAUSTED`, límite exacto). Modelos que el código usa vs. modelos que la API lista hoy.
- Estado de circuit breakers y **si se comparten entre entornos** (misma BD o misma llave para local y prod).
- Pagos, correo, storage y OAuth: configurado / standby / roto. Alcance de red desde la plataforma de despliegue (p. ej. hosts solo IPv6).

### F9 · Bucles, jobs y concurrencia
- Para cada job de arranque o cron: qué filas procesa, **si progresa** (¿las mismas N filas cada vez con 0 resultados?), cuánto consume (cuota IA, peticiones externas) y cuántas veces corre (reinicios locales + deploys + entornos que comparten recursos).
- Health checks frente a rate limiters o slowdowns: ¿el sondeo de la plataforma puede degradarse y provocar reinicios?
- Timers duplicados, reintentos sin límite, procesos huérfanos.

### F10 · Seguridad (ampliada)
- Bypass de desarrollo (tokens mágicos, endpoints dev) **y si el entorno local es alcanzable desde la red** (host 0.0.0.0, perfil de firewall).
- Tokens de propósito especial (MFA, reset, activación) aceptados como sesión.
- Enumeración por mensaje **y por tiempo**; parámetros de hash; CSRF/CORS; IDOR; SQLi (cada `${}` en SQL); XSS; secretos o cookies en logs; catálogo pagado expuesto sin plan; caché compartida (`Cache-Control: public`) de respuestas que dependen de la sesión.

### F11 · Cachés
- Claves de caché del servidor (¿incluyen el nivel o sesión?), `Cache-Control`/`Vary`, CDN, `localStorage`/`sessionStorage` que pisan datos del servidor, builds viejos servidos.

---

## BLOQUE 4 — FORMATO DE HALLAZGO (`audit/01_HALLAZGOS.jsonl`, una línea JSON válida por hallazgo)

```json
{"ID":"<DOMINIO>-<###>","TITULO":"…","SEVERIDAD":"S0|S1|S2|S3|S4","ESTADO":"CONFIRMADO|NO CONFIRMADO|CORREGIDO|STANDBY",
 "EVIDENCIA":["archivo:línea","comando → salida"],"REPRODUCCION":"pasos exactos","IMPACTO":"… (COP con fórmula o SIN DATOS)",
 "CORRECCION":"solución técnica","VERIFICACION":"cómo se comprobó el fix (si aplica)"}
```

Dominios: `AUTH`, `AUTHZ`, `TENANT`, `INJ`, `BIZ`, `PAY`, `LLM`, `FINOPS`, `OPS`, `CI`, `DEPLOY`, `UI`, `FUNC` (funcional), `DATA` (higiene), `LOOP` (jobs/bucles), `DEAD` (código muerto/basura), `DEP` (dependencias), `LOG`.
Severidad funcional: un módulo que no se renderiza o una función que nunca funciona es **S1/S2**, no "informativo".

---

## BLOQUE 5 — VEREDICTO POR MÓDULO (`audit/03_VEREDICTO_MODULOS.md`)

Cada pantalla y cada módulo backend, con uno de estos estados y su evidencia:

| Estado | Significado |
|---|---|
| 🟢 FUNCIONA | Ejecutado y verificado con datos reales |
| 🟡 FUNCIONA CON DEFECTOS | Opera pero con fallos confirmados (listar) |
| 🔴 NO FUNCIONA | Ejecutado y falla |
| 🔵 CONSTRUIDO SIN UI | Backend operativo sin ningún llamador en el frontend |
| ⚪ STANDBY | Código completo, apagado por configuración o credenciales |
| ⚫ MUERTO | Código inalcanzable o basura |

---

## BLOQUE 6 — ENTREGABLES (`audit/`)

1. `00_INVENTARIO.md`: inventario con las correcciones al Bloque 0.
2. `01_HALLAZGOS.jsonl`: JSON válido, validado con un parser antes de entregar.
3. `02_INFORME.md`: resumen ejecutivo por severidad y qué se corrigió.
4. `03_VEREDICTO_MODULOS.md`: tabla del Bloque 5.
5. `04_NO_VERIFICADO.md`: lo que no se pudo verificar y **por qué** (permiso denegado, sin credencial, sin acceso).
6. `05_BITACORA.md`: comandos ejecutados, en orden, con su resultado resumido.
Si el repo es público: `audit/privado/` (ignorado) para el detalle y una versión redactada versionada.

---

## BLOQUE 7 — CIERRE

Imprime la matriz del Bloque 5 y el conteo real por severidad y estado. Cierra con:
- **Si todo lo pedido quedó verificado:** "Auditoría integral 360 v2 ejecutada con evidencia de ejecución real. Misión Cumplida."
- **Si algo quedó abierto:** la lista de lo abierto con su razón, y la frase anterior **no** se imprime.
