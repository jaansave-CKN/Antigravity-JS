# RADFORD 360 — Estándares de Arquitectura (La Tríada)

## 1. Jerarquía de Módulos

```
localStorage  (fuente de verdad)
      │
      ▼
000_formulador.ts  ← ÚNICO punto de entrada al localStorage
      │
      ▼
NN_Viability_Agent.ts  ← motor de cálculo (rúbrica + pipeline)
      │
      ▼
ViabilidadPage.tsx  ← display (no lee localStorage directamente)
```

## 2. Reglas de Integración

| Regla | Descripción |
|-------|-------------|
| **R-01** | Solo `000_formulador` puede llamar a `localStorage.getItem(DIALECTICA_KEY)` |
| **R-02** | `ViabilidadPage` no importa `NN_Viability_Agent` directamente |
| **R-03** | `DialecticaPage` es el único módulo que escribe en `localStorage` |
| **R-04** | Ningún módulo imprime ni propaga credenciales privadas |
| **R-05** | El tipo `AnalisisViabilidad` es el contrato de datos entre el orquestador y la UI |

## 3. Archivos de La Tríada

| Archivo | Rol | Puede leer localStorage |
|---------|-----|------------------------|
| `client/src/pages/DialecticaPage.tsx` | Módulo de Dialéctica — escribe config | Solo escritura |
| `client/src/agents/000_formulador.ts` | Orquestador Maestro — única lectura | **SÍ** |
| `client/src/agents/NN_Viability_Agent.ts` | Motor de Viabilidad — cálculo puro | No |
| `client/src/pages/ViabilidadPage.tsx` | Display — consume `EstadoFormulador` | No |

## 4. Tipos de Contrato

```typescript
// 000_formulador exporta:
ejecutarFormulador() → EstadoFormulador
estadoVacio()        → AnalisisViabilidad

// NN_Viability_Agent exporta:
runNN_ViabilityAgent(cfg: ConfigViabilidad) → ResultadoAgente
```

## 5. Flujo de Datos (nominal)

1. Usuario configura dimensiones en `DialecticaPage` → guarda en `localStorage`
2. `ViabilidadPage` monta → llama `ejecutarFormulador()`
3. `000_formulador` lee `localStorage`, llama `runNN_ViabilityAgent`
4. `NN_Viability_Agent` evalúa 5 dimensiones con rúbrica 1-5 y pipeline de 5 etapas
5. `000_formulador` adapta resultado → `AnalisisViabilidad`
6. `ViabilidadPage` renderiza score, riesgos, acciones y canvas de agentes

## 6. Extensión Futura

Para agregar un nuevo módulo de cálculo, debe:
- Ser importado por `000_formulador` (nunca directamente por la UI)
- Exportar una función pura que reciba `ConfigViabilidad`
- No acceder a `localStorage`, `fetch`, ni APIs externas directamente

---

*Versión 1.0 — Integración La Tríada completada el 2026-06-30*
