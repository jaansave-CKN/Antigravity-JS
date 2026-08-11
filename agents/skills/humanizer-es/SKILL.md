---
name: humanizer-es
version: 1.0
description: |
  Adaptación institucional en español del protocolo humanizer. Ajusta tono,
  registro y densidad narrativa según interlocutor y contexto colombiano/internacional.
  DIFERENCIA CRÍTICA con humanizer base: ese skill está optimizado para eliminar
  patrones de IA en inglés. Este skill adapta la salida al registro institucional
  correcto en español (embajadas, alcaldías, ONGs, multilaterales, curadurías).
  Sin agente asignado (056_Form_Evaluador, su único consumidor, fue eliminado 2026-08-11).
allowed-tools:
  - Read
  - Write
  - Edit
---

# HUMANIZER-ES — Adaptador Institucional Español

## ADVERTENCIA TÉCNICA

El skill `humanizer` base (v2.1.1) detecta y elimina patrones de escritura IA en inglés. Si se aplica al español produce:
- Frases con calcos del inglés ("En orden de...", "Hacer una decisión")
- Pérdida de concordancia de género y número
- Ausencia de subjuntivo institucional obligatorio en español formal
- Conectores extraños para lectores hispanohablantes

`humanizer-es` resuelve esto con plantillas nativas del español institucional colombiano.

---

## CONFIGURACIÓN DE VECTOR

Antes de procesar cualquier texto, recibir o inferir estos 4 parámetros:

```json
{
  "interlocutor": "MUN|EMB|ONG|COR|MUL|CUR",
  "tono": "DIP|INS|TEC|INS|EJE|EXC",
  "enfoque": "SOS|SOC|EST|ANA|FIN",
  "nivel": 0
}
```

| Código | Interlocutor |
|--------|-------------|
| MUN | Municipal / Alcaldía / Secretaría / Gobernación |
| EMB | Embajada / Agencia de cooperación bilateral |
| ONG | ONG / Fundación / Cooperación descentralizada |
| COR | Corporativo / Empresa privada |
| MUL | Multilateral: BID, PNUD, BM, USAID, GIZ |
| CUR | Curaduría Urbana / Planeación Municipal |

| Nivel | Nombre | Uso |
|-------|--------|-----|
| 0 | Código Puro | Solo entre agentes. JSON sin prosa. |
| 1 | Técnico Directo | Frases ≤15 palabras. Datos primero. |
| 2 | Fluido Institucional | Párrafos formales. Para radicaciones y memorandos. |
| 3 | Persuasivo de Alto Valor | Narrativa + datos. Para cartas de intención y propuestas de valor. |

---

## PLANTILLAS POR PERFIL (NIVEL 2)

### MUN — Entidad municipal colombiana
```
En cumplimiento del artículo [X] del Plan de Ordenamiento Territorial
y en concordancia con [norma], la presente propuesta se enmarca en
[programa]. El proyecto contempla [descripción] con una inversión de
[valor] COP, financiada con recursos de [fuente].
```

### EMB — Embajada o agencia bilateral
```
La presente propuesta tiene el honor de ser sometida a consideración de
[entidad], en el marco del [programa o convocatoria]. El proyecto
contribuye a los Objetivos de Desarrollo Sostenible [X, Y], con impacto
directo sobre [N] beneficiarios en [municipio].
```

### ONG — Organización no gubernamental / cooperación
```
[Nombre del proyecto] responde a [problema concreto] que afecta a
[N familias/personas] en [zona]. La propuesta garantiza [resultado
cuantificado] en [plazo], con indicadores SROI verificables y
supervisión de [entidad responsable].
```

### MUL — Banco / agencia multilateral
```
The proposed intervention targets [SDG X and Y], reaching [N] direct
beneficiaries in [region]. Technical feasibility has been validated
against [standard]. SROI ratio: [X]:1 over [timeframe].
MGA/logical framework matrix available upon request.
[Nota: Multilaterales suelen requerir inglés — usar según instrucción]
```

### COR — Empresa privada / RSE
```
PROYECTO: [nombre]
INVERSIÓN: $[valor] COP
PLAZO: [meses]
ROI ESTIMADO: [%] en [meses]
RIESGO: [Bajo/Medio/Alto]
IMPACTO RSE: [N] beneficiarios directos
SIGUIENTE PASO: [acción concreta]
```

### CUR — Curaduría Urbana
```
Norma aplicable: POT Art. [X] / Decreto [X] de [año]
Uso del suelo: [clasificación] — Zona [X]
Índice de ocupación: [%] / Índice de construcción: [X]
Retiros: Frontal [m] / Lateral [m] / Posterior [m]
Altura máxima permitida: [pisos] / [m]
Observaciones NSR-10: [nota]
```

---

## FILTROS DE CALIDAD (verificar antes de emitir)

1. ¿Concordancia de género y número correcta en todo el texto?
2. ¿Sin anglicismos de estructura ("En orden de...", "Hacer una decisión")?
3. ¿Subjuntivo aplicado donde corresponde? ("para que sea viable" NO "para que es viable")
4. ¿Datos técnicos del 055_Form_Financiero preservados exactamente?
5. ¿Alias Semánticos del 050 expandidos completamente?
6. ¿Tono consistente de principio a fin?

---

## ERRORES COMUNES A EVITAR

| Incorrecto | Correcto |
|---|---|
| "En orden de lograr..." | "Con el fin de lograr..." |
| "El proyecto es sujeto a..." | "El proyecto está sujeto a..." |
| "Hacer una decisión" | "Tomar una decisión" |
| "Bajo este contexto..." | "En este contexto..." |
| "Impactar positivamente" | "Beneficiar a" / "mejorar las condiciones de" |
| "Stakeholders" | "Partes interesadas" / "actores" |
| "Framework" | "Marco metodológico" / "enfoque" |

---

## PROCESO DE EJECUCIÓN

```
INPUT: texto_técnico_bruto (de 055 o 057) + vector_configuracion

1. Leer vector → seleccionar plantilla base
2. Sustituir variables técnicas preservando exactitud numérica
3. Aplicar nivel de humanización (0→1→2→3)
4. Verificar lista de calidad (6 puntos)
5. Emitir texto_humanizado

OUTPUT: documento_final listo para firma/radicación
```

---

## ⚠️ Nota de armonización (2026-08-04)

Existe otro skill con el mismo nombre de carpeta en `.agent/skills/humanizer-es/` (usado por otra herramienta de IA vía `.agent/workflows/`, ver `.agent/rules/GEMINI.md`). **No son la misma skill ni intercambiables**: esa versión está asignada a `306_FORM_DIALECTICO` (agente que no existe en el árbol `agents/` actual — posible referencia obsoleta) y advierte contra confundirse con `humanizer-zh`; esta versión advertía contra confundirse con un `humanizer` genérico en inglés y estaba asignada a `056_Form_Evaluador` (eliminado 2026-08-11 — este skill queda sin consumidor). Coinciden en nombre de carpeta por compartir origen de plantilla, pero el contenido diverge de forma real — no fusionar ni borrar ninguna de las dos sin revisión de negocio explícita.
