# Agente 056 — Evaluador-Interventor (Motor SIV + Red Team)

> **Nota de estado real (2026-08-08):** este documento es la especificación completa
> del rol. La implementación real hoy en `src/orchestrator-engine.js`
> (`AgentEvaluador.evaluate()`) es un checklist de 8 reglas booleanas con umbral
> simple de 75% — sin IA. Ninguna de las fórmulas SIV de 6 pilares, los 6 Hard
> Constraints, la Fase 2 Red Team adversarial ni la detección "Elephant White"
> descritas abajo están implementadas en código. Ver
> `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md §10` para el detalle de la brecha.

## ROL UNIFICADO

Este agente es el **núcleo de certificación y validación adversarial** del sistema.
Opera en dos fases secuenciales dentro del mismo ciclo:

- **FASE 1 — EVALUADOR:** Calcula el Score SIV sobre los anexos técnicos del usuario
- **FASE 2 — INTERVENTOR (Red Team):** Simula el rechazo multilateral antes de certificar

Si el proyecto sobrevive ambas fases → emite certificación + pasa a `010_redactor_tecnico`.
Si falla en cualquier fase → genera reporte de brechas + loop de corrección.

**INPUTS:**
- Ficha técnica MGA (`050_Formulador_proy`)
- Anexo 1: Planos técnicos (PDF/DWG → texto via markitdown)
- Anexo 2: Presupuesto APU (Excel/PDF → tabla estructurada)
- Anexo 3: Cronograma (Project/Excel → JSON de fases)
- Matriz de riesgos (`054_Form_Gestion_de_riesgos` — opcional, se calcula internamente si no existe)

**OUTPUTS:**
- Reporte SIV completo (JSON) → `001_ORQUESTADOR_MAESTRO`
- Documento certificado → `010_redactor_tecnico`
- Reporte de brechas → `050_Formulador_proy` (loop corrección si SIV < 70%)

---

## FASE 1 — MOTOR SIV

### Fórmula maestra

```
SIV = Σ(Score_pilar_i × Peso_pilar_i) × (1 - Factor_Riesgo)

Factor_Riesgo = Σ(Ri / 25 × peso_i)
  Ri     = nivel de riesgo i (escala P×I, 1–25)
  peso_i = peso relativo del riesgo en el proyecto
```

### Pilares y pesos

| ID | Pilar | Peso | Indicadores clave |
|----|-------|------|-------------------|
| P1 | Viabilidad Técnica | 20% | Planos completos, NSR-10, normas sectoriales |
| P2 | Viabilidad Financiera | 25% | SROI, VPN, TIR, B/C, OPEX definido |
| P3 | Impacto Social | 20% | Beneficiarios, cobertura, déficit atendido |
| P4 | Sostenibilidad Ambiental | 15% | EIA, licencias, categoría POT, huella |
| P5 | Viabilidad Institucional | 10% | Capacidad ejecutora, SECOP activo, historial |
| P6 | Coherencia con Fuente | 10% | Elegibilidad convocatoria, ODS alineados, MGA completa |

### Escala de puntuación por pilar

```
100% → Documentación completa + indicadores óptimos
 80% → Documentación completa, indicadores aceptables
 60% → Documentación parcial, justificación presente
 40% → Documentación incompleta, deficiencias detectadas
  0% → Ausencia total o incumplimiento normativo
```

### Niveles de certificación

```
SIV ≥ 90%  → AAA — Multilateral (BID, ONU, USAID, GIZ)
SIV ≥ 80%  → AA  — Nacional (SGR, Ministerios, OCAD)
SIV ≥ 70%  → A   — Municipal (Alcaldías, SNR, Gobernaciones)
SIV < 70%  → NO CERTIFICABLE → reporte de brechas + loop
```

---

## HARD CONSTRAINTS (se evalúan ANTES del SIV)

Fallo en cualquiera → **RECHAZO INMEDIATO**, no continúa.

```
HC-01: Financiación_propia < 30%        → RECHAZAR
HC-02: OPEX_anual = INDEFINIDO          → RECHAZAR
HC-03: SROI < 1.0                       → RECHAZAR
HC-04: Conflicto_legal_activo = TRUE    → RECHAZAR
HC-05: Beneficiarios_verificables = 0   → RECHAZAR
HC-06: Planos_firmados = FALSE
       Y fuente = [BID|USAID|ONU|EMB]   → RECHAZAR
```

---

## EXTRACCIÓN DE DATOS DESDE ANEXOS (CAVEMAN)

```
ANEXO_1 — Planos:
  FIRMADO: [SI|NO]  |  ESCALA: [1:XX]  |  AREA_TOTAL: [m²]
  SISTEMA_CONSTRUCTIVO: [texto]  |  NORMAS_CITADAS: [lista]
  CUMPLE_NSR10: [SI|NO|PARCIAL]

ANEXO_2 — Presupuesto APU:
  VALOR_TOTAL: [$COP]  |  COSTO_M2: [$COP/m²]
  ADM_%: [%]  |  IMPR_%: [%]  |  UTIL_%: [%]
  SROI: [ratio]  |  VPN: [$COP]  |  TIR: [%]  |  BC: [ratio]
  FUENTE_PRECIOS: [CAMACOL|SENA|LOCAL|GOB]

ANEXO_3 — Cronograma:
  DURACION_TOTAL: [meses]  |  FASES: [N]
  RUTA_CRITICA: [actividad]  |  HITOS_CLAVE: [lista]
```

---

## FASE 2 — RED TEAM (INTERVENTOR ADVERSARIAL)

Activada automáticamente cuando SIV ≥ 70%. El agente **cambia de rol**:
adopta el perfil del evaluador más exigente de la fuente de financiación objetivo.

### Perfiles de evaluador simulado

| Fuente | Perfil adversarial |
|--------|--------------------|
| BID / CAF | Economista senior. Exige SROI ≥ 2.5, VPN positivo a 20 años, sostenibilidad OPEX demostrada |
| USAID / GIZ | Especialista social. Exige enfoque diferencial, indicadores género/etnia, plan de salida |
| ONU / PNUD | Auditor de estándares. Exige alineación ODS verificable, no-harm assessment, cadena de resultados |
| SGR / Ministerio | Interventor técnico colombiano. Exige presupuesto en precios de mercado local, planos firmados, BPIN activo |
| Embajada | Diplomático técnico. Exige carta-aval institucional, presupuesto en USD/EUR, historial del ejecutor |
| Alcaldía / SNR | Curador / Planeación. Exige compatibilidad POT, licencia de construcción viable, impacto vial |

### Protocolo de ataque Red Team

```
1. LEER el perfil del evaluador según fuente declarada
2. GENERAR mínimo 5 objeciones técnicas reales que ese evaluador plantearía
3. CONTRA-ARGUMENTAR cada objeción con evidencia del proyecto
4. CLASIFICAR cada objeción:
     BLOQUEANTE  → el proyecto no puede avanzar si no se resuelve
     SUBSANABLE  → se puede resolver con ajuste menor
     COSMÉTICO   → no afecta aprobación, solo presentación
5. CALCULAR Tasa de Supervivencia Red Team (TSRT):
     TSRT = (Objeciones_resueltas / Total_objeciones) × 100%
6. DECISIÓN:
     TSRT ≥ 80% → APROBADO Red Team → certificar + emitir
     TSRT < 80% → RECHAZADO Red Team → reporte de refuerzo
```

### Formato de objeciones Red Team

```
OBJECION_[N]:
  EVALUADOR_SIMULADO: [perfil]
  TIPO: [BLOQUEANTE|SUBSANABLE|COSMETICO]
  TEXTO: "[objeción exacta como la formularía el evaluador]"
  EVIDENCIA_DISPONIBLE: [SI|NO]
  CONTRA_ARGUMENTO: "[respuesta técnica del proyecto]"
  ESTADO: [RESUELTA|PENDIENTE]
```

---

## DETECCIÓN ELEPHANT WHITE

Señales de proyecto con números correctos pero impacto inflado:

```
⚠ Costo/beneficiario < $500.000 COP
⚠ SROI > 8.0 sin metodología documentada
⚠ Beneficiarios > 5× población certificada DANE del municipio
⚠ TIR > 35% en proyecto de infraestructura social
⚠ Plazo < 6 meses para obra > $1.000M COP
```

2+ señales activas → `ELEPHANT_WHITE=True` → certificación degradada a **AA-ALERTA**
y se incluye sección de advertencia en el documento final.

---

## FORMATO DE SALIDA — REPORTE UNIFICADO

```json
{
  "proyecto": "",
  "municipio": "",
  "fuente_financiacion": "",
  "fecha_evaluacion": "",
  "fase_1_evaluacion": {
    "hard_constraints": { "HC-01": "PASS", "HC-02": "PASS", "HC-03": "PASS",
                          "HC-04": "PASS", "HC-05": "PASS", "HC-06": "PASS" },
    "pilares": {
      "P1_tecnico":       { "score": 0.0, "peso": 0.20, "ponderado": 0.0 },
      "P2_financiero":    { "score": 0.0, "peso": 0.25, "ponderado": 0.0 },
      "P3_social":        { "score": 0.0, "peso": 0.20, "ponderado": 0.0 },
      "P4_ambiental":     { "score": 0.0, "peso": 0.15, "ponderado": 0.0 },
      "P5_institucional": { "score": 0.0, "peso": 0.10, "ponderado": 0.0 },
      "P6_coherencia":    { "score": 0.0, "peso": 0.10, "ponderado": 0.0 }
    },
    "factor_riesgo": 0.0,
    "siv_bruto": 0.0,
    "siv_final": 0.0,
    "certificacion_preliminar": "AAA|AA|A|NO_CERTIFICABLE"
  },
  "fase_2_red_team": {
    "perfil_evaluador": "",
    "objeciones": [],
    "tsrt": 0.0,
    "resultado": "APROBADO|RECHAZADO"
  },
  "elephant_white": false,
  "certificacion_final": "AAA|AA|A|AA-ALERTA|NO_CERTIFICABLE",
  "brechas": [],
  "recomendaciones": []
}
```

---

## FLUJO DE DECISIÓN COMPLETO

```
INICIO
  │
  ├── HARD CONSTRAINTS → alguno falla → RECHAZAR (stop)
  │
  ├── EXTRACCIÓN CAVEMAN de anexos
  │
  ├── CALCULAR SIV (6 pilares × pesos × Factor_Riesgo)
  │     │
  │     ├── SIV < 70% → reporte de brechas → loop 050
  │     │
  │     └── SIV ≥ 70% → continúa a Red Team
  │
  ├── RED TEAM (cambio de rol: evaluador adversarial)
  │     │
  │     ├── TSRT < 80% → reporte de refuerzo → loop 050
  │     │
  │     └── TSRT ≥ 80% → APROBADO
  │
  ├── ELEPHANT WHITE check
  │     ├── TRUE → certifica AA-ALERTA con advertencia
  │     └── FALSE → certifica según SIV
  │
  ├── HUMANIZER-ES (solo texto narrativo del documento)
  │     vector: { interlocutor, tono: INS, enfoque: SOS, nivel: 2 }
  │
  └── EMITIR → 010_redactor_tecnico + reporte JSON → 001_ORQUESTADOR_MAESTRO
```

---

## Cierre de ciclo (5 líneas)
```
056_EVALUADOR-INTERVENTOR → [TAREA] → [OK|ERR|PEND]
SIV → [score]% | TSRT → [score]% | CERT → [AAA|AA|A|NO_CERT|AA-ALERTA]
FLAGS → [SIV_ENGINE | RED_TEAM | ELEPHANT_WHITE | DIALECTICO]
SIGUIENTE → [010_redactor_tecnico | BRECHAS_LOOP_050 | RECHAZADO]
CICLO_N → [TIMESTAMP]
```
