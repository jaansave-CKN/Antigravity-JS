---
tipo: indice
proyecto: RadFor-360 / RadarFondos 360
actualizado: 2026-08-03
---

# RadFor-360 — Índice de contexto

Bóveda de contexto para navegar el proyecto sin releer el código completo cada vez. Cuatro notas satélite, todas enlazadas desde aquí:

- [[requisitos]] — qué debe hacer el producto, para quién, y los módulos del Formulador
- [[registros_arquitectura]] — decisiones técnicas ya tomadas y por qué (estilo ADR)
- [[hseq_normativa]] — cumplimiento normativo, contratación pública, soft-lock/hard-lock legal
- [[pendientes]] — lo que falta, priorizado, con estado real verificado

## Objetivo del proyecto

SaaS para **formular, radicar y monitorear proyectos de inversión pública/cooperación** en Colombia:

1. **Radar de convocatorias** — rastrea fuentes de financiación (entidades del Directorio + fuentes generales tipo Minciencias/World Bank) y las cruza contra el perfil del proyecto.
2. **Formulador** — wizards guiados (Contexto → Ficha Técnica → Logística → Anexos → Árbol de Objetivos → Presupuesto → Viabilidad) que producen un proyecto radicable.
3. **Motor dialéctico / coherencia lógica** — valida que problema → objetivos → indicadores → teoría de cambio sean consistentes antes de certificar.
4. **Cumplimiento HSEQ / legal** — ver [[hseq_normativa]].
5. **Exportación** — genera documentos según la estructura oficial de MGA (DNP), BID (marco lógico) y OXI (Obras por Impuestos).

## Pila tecnológica

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | React + TypeScript + Vite 8 (Rolldown) | puerto 5173, PM2 `radar-frontend` |
| Backend | Node.js + Express (`server.js` monolito + `backend/routes/*`) | puerto `process.env.PORT \|\| 3000`, PM2 `radar-backend` |
| Base de datos | PostgreSQL (Supabase) + pgvector | RLS activo (multitenancy), 30+ migraciones en `backend/migrations/` |
| Auth | Supabase Auth (`backend/config/supabase.config.js`) | + MFA/TOTP (migración 030) |
| Pagos | Stripe (`backend/config/stripe.config.js`) | configurado, condicionalmente activo — ver [[pendientes]] |
| Errores | Sentry (`client/src/lib/sentry.ts`, `backend/config/sentry.config.js`) | presente, alcance real sin auditar a fondo |
| CI/CD | GitHub Actions (`.github/workflows/radar.yml`) — "Radar Fondos 360 — CI/CD Pipeline V9.0" | CI → Deploy a Render → Smoke Test |
| Despliegue | Render (confirmado en el workflow real) | CLAUDE.md también menciona Railway para backend — **discrepancia sin resolver**, ver [[pendientes]] |
| Diseño | Stitch MCP (Google) — dark mode, token base `#001c2e` | fidelidad CSS absoluta, ver `.stitch_snapshot.json` en `client/` |

## Mapa de archivos (nivel raíz)

```
backend/          — rutas Express modulares (proyectos, anexos, presupuesto, compliance, exportación, stripe...)
client/           — app React (src/pages, src/components, src/services, src/contexts)
server.js         — monolito histórico: auth, radar, convocatorias, endpoints legacy no migrados a backend/routes
backend/migrations/ — 30 migraciones SQL numeradas, RLS + multitenancy + hardening progresivo
.github/workflows/radar.yml — pipeline CI/CD V9.0
_contexto_obsidian/ — esta bóveda
.agents/skills/    — definiciones de skills de automatización del proyecto
docs/, agents/, ai_service/, tools/, scripts/, archive/ — soporte, IA auxiliar, y código archivado
```

## Cómo se mantiene esta bóveda

Definido en `.agents/skills/obsidian-context.md`, **fuera de esta carpeta** (Obsidian no resuelve wikilinks fuera del vault, por eso es una referencia de texto plano y no `[[...]]`) — ahí están las reglas de cuándo re-escanear el proyecto y qué nota actualizar en cada caso.
