-- 047_proyectos_nombre_archivo.sql
-- Mandato del usuario (2026-08-24): diferenciar "Nombre del Proyecto" (texto
-- largo/descriptivo, se tipea en Entrada M1, columna `nombre` existente) de
-- "Nombre del Archivo" (identificador corto, se edita desde el selector de
-- proyectos — ProyectoSelectorModal.tsx — y es lo único que debe mostrarse
-- en listas/dropdowns como el header "Archivo:" del Dashboard Formulador).
--
-- Aplicado realmente vía addColumnSafe() en server.js:initDb() — este archivo
-- es documentación/historial, no hay runner que ejecute los .sql de esta
-- carpeta automáticamente (mismo patrón que 032_proyectos_deleted_at.sql).

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS nombre_archivo TEXT DEFAULT NULL;

-- Backfill: proyectos anteriores a esta columna heredan un nombre_archivo
-- truncado de `nombre` (60 chars) — nunca pisa un valor que el usuario ya
-- haya puesto, solo llena NULLs.
UPDATE proyectos SET nombre_archivo = LEFT(nombre, 60) WHERE nombre_archivo IS NULL;
