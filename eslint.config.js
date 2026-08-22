// eslint.config.js — instalado 2026-08-22 (auditoría PROTOCOLO 5x5, Vector 1:
// "prohibido `any`" no tenía ningún mecanismo técnico que lo hiciera cumplir
// — 78 usos explícitos ya existían en client/src sin que nada los marcara).
// Alcance deliberadamente mínimo: solo frena `any` explícito nuevo. No se
// tocaron las 78 instancias existentes (alto riesgo de regresión arreglarlas
// a ciegas) ni se agregó un ruleset completo de estilo/react — eso es una
// decisión aparte, no pedida en esta pasada.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Deliberadamente NO se extiende tseslint.configs.recommended completo —
// ese ruleset trae ~60 reglas más en "error" (no-unused-vars, etc.) que
// nadie pidió y que sí romperían el build. Solo se registra el plugin y se
// activa exactamente la regla pedida.
//
// eslint-plugin-react-hooks se registra (sin activar sus reglas) solo para
// que los ~13 comentarios `// eslint-disable-next-line react-hooks/...` ya
// existentes en el código dejen de reportar "Definition for rule ... was
// not found" — no es una regla nueva que se esté aplicando.
//
// NOTA: `eslint-plugin-react` (para el único `react/no-danger` disable en
// DiagramaMermaid.tsx:98) NO se instaló — su peerDependency tope hoy en
// eslint@9.7, no soporta aún la v10 instalada aquí. Queda como el único
// residual conocido de "Definition for rule ... was not found" hasta que
// esa librería publique soporte para ESLint 10.
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'backend/uploads'] },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    languageOptions: { parser: tseslint.parser },
    rules: {
      // 'warn', no 'error': las 78 instancias existentes no rompen el build,
      // pero quedan visibles para una limpieza gradual aparte.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
