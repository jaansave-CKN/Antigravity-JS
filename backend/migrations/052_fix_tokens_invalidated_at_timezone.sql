-- =============================================================================
-- 052_fix_tokens_invalidated_at_timezone.sql
--
-- Bug real encontrado en vivo el 2026-08-25 mientras un usuario real
-- (jaansave@hotmail.com) quedó bloqueado sin poder iniciar sesión, ni
-- siquiera con credenciales correctas:
--
-- `usuarios.tokens_invalidated_at` quedó creada como TIMESTAMP WITHOUT TIME
-- ZONE (no TIMESTAMPTZ, pese a que la migración 007 sí especifica TIMESTAMPTZ
-- — esta columna ya existía con el tipo equivocado antes de que 007 corriera,
-- así que su ADD COLUMN IF NOT EXISTS fue un no-op silencioso sobre el tipo).
--
-- Valor real almacenado (verificado con ::text): '2026-08-25 05:29:44.449481'
-- — un timestamp UTC genuino y reciente. Pero el driver `pg` de Node, al leer
-- una columna sin zona horaria, la reinterpreta como si ya estuviera en la
-- hora LOCAL de la máquina (Bogotá, UTC-5) y le resta el offset al convertir
-- a UTC — produciendo el valor fantasma '2026-08-25T10:29:44.449Z' (+5h) que
-- checkSessionValid() (tokenBlacklist.js) usaba para comparar contra el `iat`
-- de cada token. Resultado: CUALQUIER token — incluido uno recién emitido por
-- un login exitoso en este mismo instante — queda por debajo de ese umbral
-- fantasma durante ~5 horas, bloqueando el reingreso sin importar cuántas
-- veces el usuario inicie sesión de nuevo con la contraseña correcta.
--
-- Mismo patrón de bug ya diagnosticado independientemente por otra sesión
-- para proyectos.updated_at/created_at (también TIMESTAMP WITHOUT TIME ZONE)
-- — aquí se corrige en la columna que sí afecta el login en producción.
-- =============================================================================

ALTER TABLE usuarios
  ALTER COLUMN tokens_invalidated_at TYPE TIMESTAMPTZ
  USING tokens_invalidated_at AT TIME ZONE 'UTC';

-- Igual en 'users' si llegara a existir (guardado, ver migración 007).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='tokens_invalidated_at') THEN
    ALTER TABLE users
      ALTER COLUMN tokens_invalidated_at TYPE TIMESTAMPTZ
      USING tokens_invalidated_at AT TIME ZONE 'UTC';
  END IF;
END $$;

-- Verificación post-migración
DO $$
DECLARE tipo TEXT;
BEGIN
  SELECT data_type INTO tipo FROM information_schema.columns
  WHERE table_name = 'usuarios' AND column_name = 'tokens_invalidated_at';
  RAISE NOTICE '[usuarios.tokens_invalidated_at] tipo ahora: %', tipo;
END;
$$;
