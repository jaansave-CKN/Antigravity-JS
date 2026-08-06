---
name: caveman
description: Protocolo de salida de datos puros. Elimina todo relleno lingüístico y produce únicamente el núcleo duro: JSON, matrices, APU, tablas, números. Ahorro objetivo 75% de tokens de salida. Activación obligatoria en 303_FORM_OPERATIVO y 305_FORM_FINANCIERO.
allowed-tools: Read, Write, Edit
version: 1.0
priority: CRITICAL
---

# CAVEMAN PROTOCOL — PURE DATA OUTPUT

## MANDATO

Cuando este skill está activo, el agente opera en modo de datos puros. Toda salida es procesada por el filtro Caveman antes de ser emitida.

## REGLAS DE FILTRADO (aplicar en orden)

### ELIMINAR — Lista negra absoluta

**Artículos y determinantes:**
> el, la, los, las, un, una, unos, unas, del, al

**Conectores de relleno:**
> es importante mencionar, cabe destacar, es decir, en otras palabras, por lo tanto, debido a que, teniendo en cuenta que, en el marco de, a través de, con el fin de, en virtud de

**Cortesías y marcadores conversacionales:**
> claro, por supuesto, perfecto, entendido, con gusto, por favor, gracias, de acuerdo, sin problema, desde luego

**Confirmaciones innecesarias:**
> "Como puedes ver...", "Como mencioné anteriormente...", "En resumen...", "Para concluir...", "A modo de cierre..."

**Introductorios vacíos:**
> "A continuación, se presenta...", "El siguiente análisis muestra...", "Este documento detalla..."

### MANTENER — Lista blanca obligatoria

```
✅ JSON limpio
✅ Tablas markdown | col1 | col2 |
✅ Matrices numéricas
✅ APU estructurados
✅ Listas de items con valores
✅ Fórmulas y cálculos
✅ Códigos de referencia
✅ Etiquetas de campo: valor
```

## FORMATOS DE SALIDA AUTORIZADOS

### Formato APU (Análisis de Precios Unitarios)
```
ITEM | DESCRIPCION | UND | CANT | VR_UNIT | VR_TOTAL
001  | Concreto fc=21MPa | m³ | 45.2 | 485000 | 21902000
002  | Acero refuerzo | kg | 2840 | 6200 | 17608000
```

### Formato JSON de datos
```json
{
  "codigo": "APU-001",
  "descripcion": "Excavacion mecanica",
  "unidad": "m3",
  "rendimiento": 120,
  "costo_directo": 48500,
  "administracion": 0.18,
  "imprevistos": 0.03,
  "utilidad": 0.05,
  "total": 60690
}
```

### Formato matriz
```
RUBRO          | CANT  | VR_UNIT   | SUBTOTAL
Obra civil     | 1 gl  | 850000000 | 850000000
Instalaciones  | 1 gl  | 120000000 | 120000000
TOTAL DIRECTO  |       |           | 970000000
```

## EJEMPLO DE TRANSFORMACIÓN

### ANTES (modo normal — 87 tokens)
> "A continuación, le presento el análisis detallado de los costos de la unidad funcional. Es importante mencionar que los precios unitarios han sido calculados de acuerdo con los valores del mercado local para el año en curso."

### DESPUÉS (modo Caveman — 22 tokens)
```
UF_COSTO:
base_mercado: 2026-local
precios: ver tabla APU-001
```

**Compresión lograda: 75%**

## ACTIVACIÓN

Este skill se activa cuando el agente incluye `caveman` en su frontmatter `skills:` o cuando el flag `FORCE_CAVEMAN=True` es heredado del `000_ORQUESTADOR`.

Agentes con activación permanente:
- `303_FORM_OPERATIVO` — suministros, logística, despiece
- `305_FORM_FINANCIERO` — presupuestos, APU, modelado económico
