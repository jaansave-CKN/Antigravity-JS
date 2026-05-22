1: """
2: SIA_Radar — database.py
3: ========================
4: Rutas ABSOLUTAS garantizadas con pathlib.Path(__file__).
5: Elimina el error "[Errno 2] No such file or directory" sin importar
6: desde qué consola, directorio de trabajo o subproceso se ejecute.
7: """
8: from __future__ import annotations
9: 
10: import os
11: import sys
12: import sqlite3
13: import uuid
14: import logging
15: from datetime import datetime
16: from pathlib import Path
17: from typing import Any, Optional
18: 
19: # ---------------------------------------------------------------------------
20: # 1. RESOLUCIÓN DE RUTAS (blindada contra CWD changes)
21: # ---------------------------------------------------------------------------
22: # TODO: La variable _THIS_FILE apunta SIEMPRE a este archivo, no importa
23: #       desde qué directorio se haya invocado python.
24: _THIS_FILE: Path  = Path(__file__).resolve()
25: BACKEND_DIR: Path = _THIS_FILE.parent          # .../backend
26: PROJECT_ROOT: Path = _THIS_FILE.parent.parent  # raíz del repo
27: DATA_DIR: Path     = PROJECT_ROOT / "data"
28: LOGS_DIR: Path     = PROJECT_ROOT / "logs"
29: DB_PATH: Path      = BACKEND_DIR / "radar.db"  # Ruta real con 292 registros
30: 
31: # Crear directorios si no existen
32: DATA_DIR.mkdir(parents=True, exist_ok=True)
33: LOGS_DIR.mkdir(parents=True, exist_ok=True)
34: 
35: # Añadir backend al sys.path para imports absolutos desde este paquete
36: sys.path.insert(0, str(BACKEND_DIR))
37: # Añadir carpeta de agentes al sys.path
38: sys.path.insert(0, str(PROJECT_ROOT / "agentes" / "04_arquitecto"))
39: 
40: # ---------------------------------------------------------------------------
41: # 2. LOGGING
42: # ---------------------------------------------------------------------------
43: logger = logging.getLogger("radar.db")
44: logger.setLevel(logging.INFO)
45: if not logger.handlers:
46:     _handler = logging.FileHandler(LOGS_DIR / "database.log", encoding="utf-8")
47:     _handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
48:     logger.addHandler(_handler)
49: 
50: # Alias en formato string (compatible con SQLAlchemy / subprocess)
51: DB_URL: str      = f"sqlite:///{DB_PATH}"
52: DB_PATH_STR: str = str(DB_PATH)
53: 
54: # ---------------------------------------------------------------------------
55: # 3. IMPORTACIÓN DE CONFIGURACIÓN Y MODELOS
56: # ---------------------------------------------------------------------------
57: # Modelos SQLAlchemy - definidos localmente para evitar dependencias rotas
58: 
59: from sqlalchemy import create_engine
60: from sqlalchemy.orm import sessionmaker, declarative_base
61: 
62: Base = declarative_base()
63: 
64: engine = create_engine(
65:     DB_URL,
66:     connect_args={"check_same_thread": False} if "sqlite" in DB_URL else {}
67: )
68: 
69: SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
70: 
71: # Crear tablas si no existen (SQLAlchemy models)
72: 
73: 
74: class Entidad:
75:     pass
76: 
77: 
78: class Convocatoria:
79:     pass
80: 
81: # ---------------------------------------------------------------------------
82: # 4. FUNCIONES AUXILIARES DE CREACIÓN DE TABLAS SQLITE
83: # (Definidas ANTES de las funciones principales que las llaman)
84: # ---------------------------------------------------------------------------
85: 
86: def _ensure_table_organizaciones(cur: sqlite3.Cursor) -> None:
87:     cur.execute("""
88:         CREATE TABLE IF NOT EXISTS organizaciones (
89:             id               TEXT PRIMARY KEY,
90:             nombre           TEXT,
91:             pais             TEXT,
92:             email_admin      TEXT,
93:             api_key_google   TEXT,
94:             notebook_google  TEXT,
95:             limite_prospectos INTEGER DEFAULT 300,
96:             activa           INTEGER DEFAULT 1,
97:             plan             TEXT DEFAULT 'basico',
98:             created_at       TEXT,
99:             updated_at       TEXT
100:         )
101:     """)
102: 
103: def _ensure_table_proyectos(cur: sqlite3.Cursor) -> None:
104:     cur.execute("""
105:         CREATE TABLE IF NOT EXISTS proyectos (
106:             id           TEXT PRIMARY KEY,
107:             org_id       TEXT,
108:             nombre       TEXT,
109:             descripcion  TEXT,
110:             palabras_clave TEXT,
111:             estado       TEXT DEFAULT 'activo',
112:             creado_en    TEXT,
113:             actualizado_en TEXT
114:         )
115:     """)
116: 
117: def _ensure_table_documentos_contexto(cur: sqlite3.Cursor) -> None:
118:     cur.execute("""
119:         CREATE TABLE IF NOT EXISTS documentos_contexto (
120:             id               TEXT PRIMARY KEY,
121:             proyecto_id      TEXT,
122:             nombre           TEXT,
123:             tipo             TEXT,
124:             contenido        TEXT,
125:             embedding_vector TEXT,
126:             uploaded_en      TEXT
127:         )
128:     """)
129: 
130: def _ensure_table_cola_validacion(cur: sqlite3.Cursor) -> None:
131:     cur.execute("""
132:         CREATE TABLE IF NOT EXISTS cola_validacion (
133:             id              TEXT PRIMARY KEY,
134:             org_id          TEXT,
135:             titulo          TEXT,
136:             donante         TEXT,
137:             url_fuente      TEXT,
138:             descripcion     TEXT,
139:             monto_estimado  REAL,
140:             fecha_cierre    TEXT,
141:             paises_elegibles TEXT,
142:             sectores        TEXT,
143:             score_encontrado INTEGER DEFAULT 50,
144:             fuente          TEXT,
145:             estado          TEXT DEFAULT 'pendiente',
146:             fecha_ingreso   TEXT,
147:             revisado_por    TEXT,
148:             decision        TEXT,
149:             decision_notas  TEXT
150:         )
151:     """)
152: 
153: def _ensure_table_entidades_indexadas(cur: sqlite3.Cursor) -> None:
154:     cur.execute("""
155:         CREATE TABLE IF NOT EXISTS entidades_indexadas (
156:             id                    TEXT PRIMARY KEY,
157:             org_id                TEXT,
158:             titulo                TEXT,
159:             donante               TEXT,
160:             descripcion           TEXT,
161:             monto_min             REAL,
162:             monto_max             REAL,
163:             moneda                TEXT DEFAULT 'USD',
164:             url_convocatoria      TEXT,
165:             url_fuente            TEXT,
166:             fecha_cierre          TEXT,
167:             fecha_publicacion     TEXT,
168:             paises_elegibles      TEXT,
169:             sectores              TEXT,
170:             poblacion_objetivo    TEXT,
171:             tipo_fondo            TEXT,
172:             requisitos            TEXT,
173:             tags                  TEXT,
174:             score_compatibilidad  INTEGER DEFAULT 50,
175:             estado                TEXT DEFAULT 'activa',
176:             origen                TEXT,
177:             proyecto_id           TEXT,
178:             fecha_indexacion      TEXT
179:         )
180:     """)
181: 
182: def _ensure_table_scraping_log(cur: sqlite3.Cursor) -> None:
183:     cur.execute("""
184:         CREATE TABLE IF NOT EXISTS scraping_log (
185:             id               INTEGER PRIMARY KEY AUTOINCREMENT,
186:             entidad          TEXT,
187:             url              TEXT,
188:             status           TEXT,
189:             mensaje          TEXT,
190:             scraped_en       TEXT
191:         )
192:     """)
193: 
194: def _ensure_table_scraped_results(cur: sqlite3.Cursor) -> None:
195:     cur.execute(f"""
196:         CREATE TABLE IF NOT EXISTS scraped_results (
197:             id               TEXT PRIMARY KEY,
198:             entidad_id       TEXT,
199:             url              TEXT,
200:             titulo           TEXT,
201:             monto            TEXT,
202:             fecha_cierre     TEXT,
203:             estado           TEXT,
204:             estado_detectado TEXT,
205:             contenido_html   TEXT,
206:             scraped_en       TEXT,
207:             success          INTEGER,
208:             error            TEXT
209:         )
210:     """)
211: 
212: # ---------------------------------------------------------------------------
213: # 5. HELPERS DE CONVENIENCIA (Ejecución, Logging, CRUDs)
214: # ---------------------------------------------------------------------------
215: 
216: # ── Inicialización ──────────────────────────────────────────────────────────
217: 
218: def ensure_db() -> bool:
219:     """Verifica que el archivo .db exista en disco."""
220:     if not DB_PATH.exists():
221:         raise FileNotFoundError(f"Database not found: {DB_PATH}")
222:     return True
223: 
224: 
225: def init_db() -> str:
226:     """Inicializa la BD: crea tablas y directorios faltantes."""
227:     ensure_db()
228:     conn = sqlite3.connect(DB_PATH_STR)
229:     cur = conn.cursor()
230:     # Llamar a todas las funciones de creación de tablas SQLite y SQLAlchemy
231:     Base.metadata.create_all(engine) # Crea tablas de SQLAlchemy
232:     _ensure_table_documentos_contexto(cur)
233:     _ensure_table_cola_validacion(cur)
234:     _ensure_table_entidades_indexadas(cur)
235:     _ensure_table_scraped_results(cur)
236:     _ensure_table_scraping_log(cur)
237:     conn.commit()
238:     conn.close()
239:     logger.info(f"BD inicializada en {DB_PATH}")
240:     return str(DB_PATH)
241: 
242: 
243: # ── Logging ────────────────────────────────────────────────────────────────
244: 
245: def log_ejecucion(modulo: str, evento: str, detalle: str = "") -> None:
246:     logger.info(f"[{modulo}] {evento}: {detalle}")
247: 
248: 
249: # ── Estadísticas ───────────────────────────────────────────────────────────
250: 
251: def get_estadisticas() -> dict:
252:     conn            = sqlite3.connect(DB_PATH_STR)
253:     conn.row_factory = sqlite3.Row
254:     cur             = conn.cursor()
255:     return {
256:         "totalEntidades":  cur.execute("SELECT COUNT(*) FROM entidades").fetchone()[0],
257:         "resultadosFound": cur.execute("SELECT COUNT(*) FROM convocatorias").fetchone()[0],
258:         "pendientesValid": cur.execute(
259:             "SELECT COUNT(*) FROM cola_validacion WHERE estado='pendiente'"
260:         ).fetchone()[0],
261:         "aprobados":       cur.execute("SELECT COUNT(*) FROM entidades_indexadas").fetchone()[0],
262:     }
263: 
264: 
265: # ── CRUD entidades ─────────────────────────────────────────────────────────
266: 
267: def guardar_entidad(entidad_data: dict) -> str:
268:     ent_id = str(uuid.uuid4())
269:     session = SessionLocal()
270:     try:
271:         ent = Entidad(
272:             id=ent_id,
273:             nombre=entidad_data.get("nombre", ""),
274:             pais=entidad_data.get("pais", ""),
275:             tipo_entidad=entidad_data.get("tipo_entidad", ""),
276:             url=entidad_data.get("url", ""),
277:         )
278:         session.add(ent)
279:         session.commit()
280:         logger.info(f"Entidad guardada: {ent.nombre}")
281:         return ent_id
282:     except Exception as exc:
283:         session.rollback()
284:         logger.error(f"Error guardando entidad: {exc}")
285:         raise
286:     finally:
287:         session.close()
288: 
289: 
290: # ── CRUD convocatorias ─────────────────────────────────────────────────────
291: 
292: def guardar_convocatoria(data: dict) -> int:
293:     conn            = sqlite3.connect(DB_PATH_STR)
294:     cur             = conn.cursor()
295:     cur.execute(
296:         """INSERT INTO convocatorias
297:            (titulo, sector, tipo_financiamiento, formato_formulacion,
298:             monto, url, fecha_cierre, score, estado, entidad_id, es_favorito)
299:            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
300:         (
301:             data.get("titulo"),
302:             data.get("sector"),
303:             data.get("tipo_financiamiento"),
304:             data.get("formato_formulacion"),
305:             data.get("monto"),
306:             data.get("url"),
307:             data.get("fecha_cierre"),
308:             data.get("score", 50.0),
309:             data.get("estado", "pendiente"),
310:             data.get("entidad_id"),
311:             data.get("es_favorito", False),
312:         ),
313:     )
314:     conn.commit()
315:     row_id = cur.lastrowid
316:     conn.close()
317:     logger.info(f"Convocatoria guardada id={row_id}")
318:     return row_id
319: 
320: 
321: def get_convocatorias(filtros: Optional[dict] = None,
322:                       page: int = 1,
323:                       limit: int = 50) -> dict:
324:     conn            = sqlite3.connect(DB_PATH_STR)
325:     conn.row_factory = sqlite3.Row
326:     cur             = conn.cursor()
327:     where_clauses: list[str] = ["1=1"]
328:     params: list             = []
329: 
330:     if filtros:
331:         if filtros.get("solo_favoritos"):
332:             where_clauses.append("es_favorito = 1")
333:         if filtros.get("estado"):
334:             where_clauses.append("estado = ?")
335:             params.append(filtros["estado"])
336: 
337:     where_sql = " AND ".join(where_clauses)
338:     offset    = (page - 1) * limit
339: 
340:     cur.execute(
341:         f"SELECT * FROM convocatorias WHERE {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
342:         (*params, limit, offset),
343:     )
344:     rows  = [dict(r) for r in cur.fetchall()]
345:     cur.execute(
346:         f"SELECT COUNT(*) FROM convocatorias WHERE {where_sql}", params
347:     )
348:     total = cur.fetchone()[0]
349:     conn.close()
350:     return {"data": rows, "total": total, "page": page, "limit": limit}
351: 
352: 
353: def toggle_favorito(convocatoria_id: int) -> bool:
354:     conn = sqlite3.connect(DB_PATH_STR)
355:     cur  = conn.cursor()
356:     cur.execute(
357:         "UPDATE convocatorias SET es_favorito = NOT es_favorito WHERE id = ?",
358:         (convocatoria_id,),
359:     )
360:     conn.commit()
361:     cur.execute("SELECT es_favorito FROM convocatorias WHERE id = ?", (convocatoria_id,))
362:     row = cur.fetchone()
363:     conn.close()
364:     return bool(row[0]) if row else False
365: 
366: 
367: def actualizar_estado(convocatoria_id: int, estado: str) -> None:
368:     conn = sqlite3.connect(DB_PATH_STR)
369:     cur  = conn.cursor()
370:     cur.execute("UPDATE convocatorias SET estado = ? WHERE id = ?", (estado, convocatoria_id))
371:     conn.commit()
372:     conn.close()
373: 
374: 
375: # ── Cola de validación ─────────────────────────────────────────────────────
376: 
377: def _ensure_table_cola_validacion(cur: sqlite3.Cursor) -> None:
378:     cur.execute("""
379:         CREATE TABLE IF NOT EXISTS cola_validacion (
380:             id              TEXT PRIMARY KEY,
381:             org_id          TEXT,
382:             titulo          TEXT,
383:             donante         TEXT,
384:             url_fuente      TEXT,
385:             descripcion     TEXT,
386:             monto_estimado  REAL,
387:             fecha_cierre    TEXT,
388:             paises_elegibles TEXT,
389:             sectores        TEXT,
390:             score_encontrado INTEGER DEFAULT 50,
391:             fuente          TEXT,
392:             estado          TEXT DEFAULT 'pendiente',
393:             fecha_ingreso   TEXT,
394:             revisado_por    TEXT,
395:             decision        TEXT,
396:             decision_notas  TEXT
397:         )
398:     """)
399: 
400: 
401: def agregar_a_cola_validacion(item: dict) -> str:
402:     item_id = str(uuid.uuid4())
403:     conn    = sqlite3.connect(DB_PATH_STR)
404:     cur     = conn.cursor()
405:     _ensure_table_cola_validacion(cur)
406:     conn.commit()   # crea tabla antes del INSERT
407:     cur.execute(
408:         """INSERT INTO cola_validacion
409:            (id,org_id,titulo,donante,url_fuente,descripcion,monto_estimado,
410:             fecha_cierre,paises_elegibles,sectores,score_encontrado,fuente,
411:             estado,fecha_ingreso)
412:            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
413:         (
414:             item_id,
415:             item.get("org_id", "default"),
416:             item.get("titulo", ""),
417:             item.get("donante", ""),
418:             item.get("url_fuente", ""),
419:             item.get("descripcion", ""),
420:             item.get("monto_estimado"),
421:             item.get("fecha_cierre", ""),
422:             str(item.get("paises_elegibles", [])),
423:             str(item.get("sectores", [])),
424:             item.get("score_encontrado", 50),
425:             item.get("fuente", ""),
426:             item.get("estado", "pendiente"),
427:             item.get("fecha_ingreso", datetime.utcnow().isoformat()),
428:         ),
429:     )
430:     conn.commit()
431:     conn.close()
432:     logger.info(f"Item agregado a cola: {item_id}")
433:     return item_id
434: 
435: 
436: def get_cola_validacion(org_id: str, estado: Optional[str] = None) -> list:
437:     conn            = sqlite3.connect(DB_PATH_STR)
438:     conn.row_factory = sqlite3.Row
439:     cur             = conn.cursor()
440:     _ensure_table_cola_validacion(cur)
441:     sql:     str   = "SELECT * FROM cola_validacion WHERE org_id = ?"
442:     params:  list  = [org_id]
443:     if estado:
444:         sql       += " AND estado = ?"
445:         params.append(estado)
446:     cur.execute(sql + " ORDER BY fecha_ingreso DESC", params)
447:     rows = [dict(r) for r in cur.fetchall()]
448:     conn.close()
449:     return rows
450: 
451: 
452: def resolver_cola_validacion(
453:     item_id:     str,
454:     decision:    str,
455:     notas:       str  = "",
456:     revisado_por: str = "sistema",
457: ) -> None:
458:     conn = sqlite3.connect(DB_PATH_STR)
459:     cur  = conn.cursor()
460:     _ensure_table_cola_validacion(cur)
461:     cur.execute(
462:         """UPDATE cola_validacion
463:            SET estado=?, decision=?, decision_notas=?, revisado_por=?
464:            WHERE id=?""",
465:         (decision, decision, notas, revisado_por, item_id),
466:     )
467:     conn.commit()
468:     conn.close()
469:     logger.info(f"Item {item_id} resuelto: {decision}")
470: 
471: 
472: # ── Entidades indexadas ─────────────────────────────────────────────────────
473: 
474: def _ensure_table_entidades_indexadas(cur: sqlite3.Cursor) -> None:
475:     cur.execute("""
476:         CREATE TABLE IF NOT EXISTS entidades_indexadas (
477:             id                    TEXT PRIMARY KEY,
478:             org_id                TEXT,
479:             titulo                TEXT,
480:             donante               TEXT,
481:             descripcion           TEXT,
482:             monto_min             REAL,
483:             monto_max             REAL,
484:             moneda                TEXT DEFAULT 'USD',
485:             url_convocatoria      TEXT,
486:             url_fuente            TEXT,
487:             fecha_cierre          TEXT,
488:             fecha_publicacion     TEXT,
489:             paises_elegibles      TEXT,
490:             sectores              TEXT,
491:             poblacion_objetivo    TEXT,
492:             tipo_fondo            TEXT,
493:             requisitos            TEXT,
494:             tags                  TEXT,
495:             score_compatibilidad  INTEGER DEFAULT 50,
496:             estado                TEXT DEFAULT 'activa',
497:             origen                TEXT,
498:             proyecto_id           TEXT,
499:             fecha_indexacion      TEXT
500:         )
501:     """)
502: 
503: def indexar_entidad(data: dict) -> str:
504:     ent_id = str(data.get("id", uuid.uuid4()))
505:     conn   = sqlite3.connect(DB_PATH_STR)
506:     cur    = conn.cursor()
507:     _ensure_table_entidades_indexadas(cur)
508:     conn.commit()
509:     cur.execute(
510:         """INSERT OR REPLACE INTO entidades_indexadas
511:            (id,org_id,titulo,donante,descripcion,monto_min,monto_max,moneda,
512:             url_convocatoria,url_fuente,fecha_cierre,fecha_publicacion,
513:             paises_elegibles,sectores,poblacion_objetivo,tipo_fondo,requisitos,
514:             tags,score_compatibilidad,estado,origen,proyecto_id,fecha_indexacion)
515:            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
516:         (
517:             ent_id,
518:             data.get("org_id", "default"),
519:             data.get("titulo", ""),
520:             data.get("donante", ""),
521:             data.get("descripcion", ""),
522:             data.get("monto_min", 0),
523:             data.get("monto_max", 0),
524:             data.get("moneda", "USD"),
525:             data.get("url_convocatoria", ""),
526:             data.get("url_fuente", ""),
527:             data.get("fecha_cierre", ""),
528:             data.get("fecha_publicacion", ""),
529:             str(data.get("paises_elegibles", [])),
530:             str(data.get("sectores", [])),
531:             str(data.get("poblacion_objetivo", [])),
532:             data.get("tipo_fondo", ""),
533:             str(data.get("requisitos", [])),
534:             str(data.get("tags", [])),
535:             data.get("score_compatibilidad", 50),
536:             data.get("estado", "activa"),
537:             data.get("origen", ""),
538:             data.get("proyecto_id"),
539:             data.get("fecha_indexacion", datetime.utcnow().isoformat()),
540:         ),
541:     )
542:     conn.commit()
543:     conn.close()
544:     logger.info(f"Entidad indexada: {ent_id}")
545:     return ent_id
546: 
547: def buscar_entidades_indexadas(org_id: str, filtros: Optional[dict] = None) -> list:
548:     conn            = sqlite3.connect(DB_PATH_STR)
549:     conn.row_factory = sqlite3.Row
550:     cur             = conn.cursor()
551:     _ensure_table_entidades_indexadas(cur)
552:     sql    = "SELECT * FROM entidades_indexadas WHERE org_id = ?"
553:     params = [org_id]
554: 
555:     if filtros:
556:         if filtros.get("sectores"):
557:             sql    += " AND sectores LIKE ?"
558:             params.append(f"%{filtros['sectores'][0]}%")
559:         if filtros.get("pais"):
560:             sql    += " AND paises_elegibles LIKE ?"
561:             params.append(f"%{filtros['pais']}%")
562:         if filtros.get("monto_min"):
563:             sql    += " AND monto_max >= ?"
564:             params.append(filtros["monto_min"])
565:         if filtros.get("monto_max"):
566:             sql    += " AND monto_min <= ?"
567:             params.append(filtros["monto_max"])
568: 
569:     cur.execute(sql + " ORDER BY fecha_indexacion DESC", params)
570:     rows = [dict(r) for r in cur.fetchall()]
571:     conn.close()
572:     return rows
573: 
574: 
575: # ── Multi-tenant / organizaciones ──────────────────────────────────────────
576: 
577: def _ensure_table_organizaciones(cur: sqlite3.Cursor) -> None:
578:     cur.execute("""
579:         CREATE TABLE IF NOT EXISTS organizaciones (
580:             id               TEXT PRIMARY KEY,
581:             nombre           TEXT,
582:             pais             TEXT,
583:             email_admin      TEXT,
584:             api_key_google   TEXT,
585:             notebook_google  TEXT,
586:             limite_prospectos INTEGER DEFAULT 300,
587:             activa           INTEGER DEFAULT 1,
588:             plan             TEXT DEFAULT 'basico',
589:             created_at       TEXT,
590:             updated_at       TEXT
591:         )
592:     """)
593: 
594: def crear_organizacion(data: dict) -> str:
595:     org_id = str(uuid.uuid4())
596:     conn   = sqlite3.connect(DB_PATH_STR)
597:     cur    = conn.cursor()
598:     _ensure_table_organizaciones(cur)
599:     conn.commit()
600:     cur.execute(
601:         """INSERT INTO organizaciones
602:            (id,nombre,pais,email_admin,api_key_google,notebook_google,
603:             limite_prospectos,activa,plan,created_at,updated_at)
604:            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
605:         (
606:             org_id,
607:             data.get("nombre"),
608:             data.get("pais"),
609:             data.get("email_admin"),
610:             data.get("api_key_google", ""),
611:             data.get("notebook_google", ""),
612:             data.get("limite_prospectos", 300),
613:             1,
614:             data.get("plan", "basico"),
615:             datetime.utcnow().isoformat(),
616:             datetime.utcnow().isoformat(),
617:         ),
618:     )
619:     conn.commit()
620:     conn.close()
621:     logger.info(f"Organización creada: {org_id}")
622:     return org_id
623: 
624: def get_organizaciones() -> list:
625:     conn  = sqlite3.connect(DB_PATH_STR)
626:     conn.row_factory = sqlite3.Row
627:     cur   = conn.cursor()
628:     _ensure_table_organizaciones(cur)
629:     cur.execute("SELECT * FROM organizaciones")
630:     rows = [dict(r) for r in cur.fetchall()]
631:     conn.close()
632:     return rows
633: 
634: def get_organizacion_por_api_key(api_key: str) -> Optional[dict]:
635:     conn  = sqlite3.connect(DB_PATH_STR)
636:     conn.row_factory = sqlite3.Row
637:     cur   = conn.cursor()
638:     _ensure_table_organizaciones(cur)
639:     cur.execute("SELECT * FROM organizaciones WHERE api_key_google = ?", (api_key,))
640:     row = cur.fetchone()
641:     conn.close()
642:     return dict(row) if row else None
643: 
644: # ── Proyectos ──────────────────────────────────────────────────────────────
645: 
646: def _ensure_table_proyectos(cur: sqlite3.Cursor) -> None:
647:     cur.execute("""
648:         CREATE TABLE IF NOT EXISTS proyectos (
649:             id           TEXT PRIMARY KEY,
650:             org_id       TEXT,
651:             nombre       TEXT,
652:             descripcion  TEXT,
653:             palabras_clave TEXT,
654:             estado       TEXT DEFAULT 'activo',
655:             creado_en    TEXT,
656:             actualizado_en TEXT
657:         )
658:     """)
659: 
660: def crear_proyecto(data: dict) -> str:
661:     proyecto_id = str(uuid.uuid4())
662:     conn        = sqlite3.connect(DB_PATH_STR)
663:     cur         = conn.cursor()
664:     _ensure_table_proyectos(cur)
665:     conn.commit()
666:     cur.execute(
667:         """INSERT INTO proyectos
668:            (id,org_id,nombre,descripcion,palabras_clave,estado,creado_en,actualizado_en)
669:            VALUES (?,?,?,?,?,?,?,?)""",
670:         (
671:             proyecto_id,
672:             data.get("org_id", "default"),
673:             data.get("nombre", ""),
674:             data.get("descripcion", ""),
675:             str(data.get("palabras_clave", [])),
676:             data.get("estado", "activo"),
677:             datetime.utcnow().isoformat(),
678:             datetime.utcnow().isoformat(),
679:         ),
680:     )
681:     conn.commit()
682:     conn.close()
683:     logger.info(f"Proyecto creado: {proyecto_id}")
684:     return proyecto_id
685: 
686: def get_proyectos(org_id: str) -> list:
687:     conn  = sqlite3.connect(DB_PATH_STR)
688:     conn.row_factory = sqlite3.Row
689:     cur   = conn.cursor()
690:     _ensure_table_proyectos(cur)
691:     cur.execute("SELECT * FROM proyectos WHERE org_id = ? ORDER BY creado_en DESC", (org_id,))
692:     rows = [dict(r) for r in cur.fetchall()]
693:     conn.close()
694:     for p in rows:
695:         try:
696:             p["palabras_clave"] = eval(p.get("palabras_clave", "[]"))
697:         except Exception:
698:             p["palabras_clave"] = []
699:     return rows
700: 
701: # ── Documentos de contexto ──────────────────────────────────────────────────
702: 
703: # ── Utilidades varias ──────────────────────────────────────────────────────
704: 
705: def validar_fuente_donante(fuente: str, donante: str) -> str:
706:     if not fuente or fuente.lower() in ("google", "radar", ""):
707:         return donante or fuente or "Desconocido"
708:     return fuente
709: 
710: def guardar_scraped_result(data: dict) -> str:
711:     """Guarda resultado de scraping en tabla scraped_results."""
712:     result_id = str(uuid.uuid4())
713:     conn = sqlite3.connect(DB_PATH_STR)
714:     cur = conn.cursor()
715:     cur.execute("""
716:         INSERT INTO scraped_results
717:         (id, entidad_id, url, titulo, monto, fecha_cierre, estado, estado_detectado,
718:          contenido_html, scraped_en, success, error)
719:         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
720:     """, (
721:         result_id,
722:         data.get("entidad_id", ""),
723:         data.get("url", ""),
724:         data.get("titulo", ""),
725:         data.get("monto", ""),
726:         data.get("fecha_cierre", ""),
727:         data.get("estado", "pendiente"),
728:         data.get("estado_detectado", ""),
729:         data.get("contenido_html", ""),
730:         datetime.utcnow().isoformat(),
731:         data.get("success", 1),
732:         data.get("error", "")
733:     ))
734:     conn.commit()
735:     conn.close()
736:     return result_id
737: 
738: def log_scraping(entidad: str, url: str, status: str, mensaje: str = "") -> None:
739:     """Registra scraping en tabla scraping_log."""
740:     conn = sqlite3.connect(DB_PATH_STR)
741:     cur = conn.cursor()
742:     cur.execute("""
743:         INSERT INTO scraping_log (entidad, url, status, mensaje, scraped_en)
744:         VALUES (?,?,?,?,?)
745:     """, (entidad, url, status, mensaje, datetime.utcnow().isoformat()))
746:     conn.commit()
747:     conn.close()
748: 
749: # Export público
750: __all__ = [
751:     "PROJECT_ROOT", "BACKEND_DIR", "DATA_DIR", "LOGS_DIR",
752:     "DB_PATH", "DB_PATH_STR", "DB_URL",
753:     "Base", "engine", "SessionLocal", "Entidad", "Convocatoria",
754:     "init_db", "ensure_db", "log_ejecucion",
755:     "get_estadisticas",
756:     "guardar_entidad",        "guardar_convocatoria",
757:     "get_convocatorias",      "toggle_favorito",    "actualizar_estado",
758:     "agregar_a_cola_validacion", "get_cola_validacion", "resolver_cola_validacion",
759:     "indexar_entidad",        "buscar_entidades_indexadas",
760:     "crear_organizacion",     "get_organizaciones", "get_organizacion_por_api_key", "get_all_entidades",
761:     "crear_proyecto",         "get_proyectos",
762:     "guardar_documento_contexto", "get_documentos_contexto",
763:     "get_estadisticas_org",   "validar_fuente_donante",
764:     "guardar_scraped_result", "log_scraping",
765: ]