---
name: humanizer-es
description: Adaptación institucional en español del protocolo humanizer-zh. Ajusta tono, registro y densidad narrativa según interlocutor y contexto. 4 niveles de humanización. Asignado exclusivamente a 306_FORM_DIALECTICO. ADVERTENCIA: no usar humanizer-zh original — está optimizado para Mandarín y rompe la sintaxis española.
allowed-tools: Read, Write, Edit
version: 1.0
---

# HUMANIZER-ES — ADAPTADOR INSTITUCIONAL ESPAÑOL

## ADVERTENCIA TÉCNICA

`humanizer-zh` está optimizado para sintaxis Mandarin (SVO estricto, partículas aspectuales, ausencia de artículos). Aplicado directamente al español produce:
- Frases planas sin concordancia de género/número
- Ausencia de subjuntivo institucional
- Conectores calcados del inglés ("En orden de...", "Con el propósito de...")

`humanizer-es` reemplaza esa lógica con las convenciones del español institucional colombiano e internacional.

---

## MATRIZ DE CONFIGURACIÓN

### Dimensión 1: Interlocutor

| Código | Perfil | Registro base |
|--------|--------|---------------|
| `MUN` | Municipal / Alcaldía / Secretaría | Formal normativo (Decreto, Resolución) |
| `EMB` | Embajada / Consulado / Cancillería | Diplomático protocolario |
| `ONG` | ONG / Fundación / Cooperación | Impacto social, beneficiarios |
| `COR` | Corporativo / Empresa privada | Ejecutivo, ROI-centrado |
| `MUL` | Multilateral (BID, PNUD, BM, USAID) | Técnico-diplomático, marcos ODS |
| `CUR` | Curaduría Urbana / Planeación | Técnico normativo, NSR, POT |

### Dimensión 2: Tono

| Código | Descripción |
|--------|-------------|
| `DIP` | Diplomático — fórmulas de cortesía protocolaria |
| `INS` | Institucional — lenguaje de acto administrativo |
| `TEC` | Técnico — terminología especializada, sin prosa |
| `INS` | Inspirador — visión, propósito, transformación |
| `EJE` | Ejecutivo — brevedad, decisión, ROI |
| `EXC` | Exclusivo — premium, diferenciación, alto impacto |

### Dimensión 3: Enfoque Temático

| Código | Prioridad discursiva |
|--------|---------------------|
| `SOS` | Sostenibilidad — ODS, huella, resiliencia |
| `SOC` | Social — beneficiarios, equidad, inclusión |
| `EST` | Estructural — ingeniería, normativa técnica |
| `ANA` | Analítico — datos, métricas, evidencia |
| `FIN` | Financiero — costos, retorno, eficiencia fiscal |

### Dimensión 4: Nivel de Humanización

| Nivel | Nombre | Características |
|-------|--------|-----------------|
| `0` | Código Puro | JSON/esquema sin prosa. Solo para transferencia interna entre agentes. |
| `1` | Técnico Directo | Frases cortas (≤15 palabras). Datos primero, contexto al final. Sin subordinadas complejas. |
| `2` | Fluido Institucional | Párrafos formales (3-5 oraciones). Conectores institucionales. Concordancia de género. Subjuntivo cuando corresponda. |
| `3` | Persuasivo de Alto Valor | Narrativa de impacto + datos. Apertura con gancho, cuerpo con evidencia, cierre con llamado a acción. Registro premium. |

---

## PLANTILLAS POR PERFIL

### MUN + INS + Nivel 2 (Alcaldía colombiana)
```
"En cumplimiento del artículo [X] del Plan de Ordenamiento Territorial del
Municipio de [X] y en concordancia con el Decreto [X] de [año], la presente
propuesta técnica se enmarca en los lineamientos de [programa]. El proyecto
contempla [descripción técnica concisa] con una inversión estimada de
[valor en pesos] proveniente de [fuente de financiación]."
```

### EMB + DIP + Nivel 2 (Comunicación diplomática)
```
"La presente propuesta tiene el honor de ser sometida a consideración de
[nombre de embajada/agencia], en el marco del [programa o convocatoria].
El proyecto [nombre] representa una oportunidad concreta de cooperación
técnica que contribuye a los objetivos de [ODS o programa bilateral],
con un impacto directo sobre [X] beneficiarios en [municipio/región]."
```

### ONG + SOC + Nivel 3 (Carta de intención social)
```
"[Nombre del proyecto] nace de una realidad inocultable: [descripción del
problema en 1 frase]. Durante [X años], [número] familias de [zona] han
enfrentado [consecuencia concreta]. Esta propuesta no es solo infraestructura
— es la respuesta técnica a una deuda social acumulada. Con una inversión
de [valor], se garantizará [resultado cuantificado] en los próximos [plazo],
bajo la supervisión de [entidad] y con indicadores SROI verificables."
```

### MUL + ANA + Nivel 2 (Banco Mundial / BID / USAID)
```
"The proposed intervention aligns with [SDG X] and [SDG Y], targeting
[X] direct beneficiaries in [region]. Technical feasibility has been
validated against [standard/methodology]. Financial sustainability is
supported by [mechanism]. Expected SROI ratio: [X]:1 over [timeframe].
Full MGA matrix and logical framework available upon request."
```

### COR + EJE + Nivel 1 (Brief ejecutivo corporativo)
```
Proyecto: [nombre]
Inversión: $[valor COP/USD]
Plazo: [meses]
ROI estimado: [%] en [meses]
Riesgo: [Bajo/Medio/Alto] — mitigación: [1 línea]
Próximo paso: [acción concreta]
```

### CUR + TEC + Nivel 1 (Radicación ante curaduría)
```
Norma aplicable: POT Art. [X] / Decreto [X]
Uso del suelo: [clasificación]
Índice ocupación: [%] / Índice construcción: [X]
Retiros: Frontal [m] | Lateral [m] | Posterior [m]
Altura máxima: [pisos/m]
Observaciones NSR-10: [nota técnica]
```

---

## PROTOCOLO DE EJECUCIÓN (306_FORM_DIALECTICO)

```
INPUT: {texto_técnico_bruto} + {vector_configuracion}

PASO 1: Leer vector
  interlocutor: [MUN|EMB|ONG|COR|MUL|CUR]
  tono: [DIP|INS|TEC|INS|EJE|EXC]
  enfoque: [SOS|SOC|EST|ANA|FIN]
  nivel: [0|1|2|3]

PASO 2: Seleccionar plantilla base

PASO 3: Sustituir variables técnicas del texto bruto

PASO 4: Aplicar ajustes de nivel
  Nivel 0 → no transformar (pasar directo)
  Nivel 1 → frases ≤15 palabras, datos primero
  Nivel 2 → párrafos formales, concordancia, subjuntivo
  Nivel 3 → gancho + cuerpo + llamado a acción

PASO 5: Verificar
  ✅ ¿Concordancia género/número correcta?
  ✅ ¿Sin anglicismos de estructura?
  ✅ ¿Registro apropiado para interlocutor?
  ✅ ¿Datos técnicos preservados íntegros?

OUTPUT: {texto_humanizado}
```

---

## ERRORES A EVITAR

| Error | Causa | Corrección |
|-------|-------|------------|
| "En orden de lograr..." | Calco del inglés "In order to" | "Con el fin de lograr..." |
| "El proyecto es sujeto a..." | Calco de pasiva inglesa | "El proyecto está sujeto a..." |
| "Hacer una decisión" | Calco "make a decision" | "Tomar una decisión" |
| Ausencia de concordancia | Influencia zh | Verificar adj/sust género |
| Subjuntivo omitido | Influencia zh | "Para que sea viable..." no "Para que es viable..." |
