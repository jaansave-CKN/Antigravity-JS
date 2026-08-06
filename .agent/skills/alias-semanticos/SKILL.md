---
name: alias-semanticos
description: Protocolo de compresión por alias para unidades funcionales repetitivas en formulación de proyectos de infraestructura. Instancia variables indexadas al inicio del ciclo y las expande solo en el entregable final. Asignado al 300_FORMULADOR_PROY. Elimina la descripción redundante de módulos repetitivos en documentos extensos.
allowed-tools: Read, Write, Edit
version: 1.0
---

# ALIAS SEMÁNTICOS — PROTOCOLO DE COMPRESIÓN MODULAR

## PROBLEMA QUE RESUELVE

En formulación de proyectos de infraestructura, los mismos componentes se describen decenas de veces:
- "Aula teórica de 48m² con capacidad para 32 estudiantes, dotada de tablero acrílico y sillas universitarias" → aparece 12 veces en un pliego
- "Batería sanitaria de 4 módulos (2 hombres / 2 mujeres), con aparatos sanitarios de bajo consumo" → aparece 8 veces

Sin alias: **20 repeticiones × 35 tokens = 700 tokens de relleno**
Con alias: **20 referencias × 3 tokens = 60 tokens activos**

**Ahorro: 91% en componentes repetitivos**

---

## CICLO DE VIDA DEL ALIAS

```
FASE 1: INSTANCIACIÓN (inicio de sesión/proyecto)
  → Crear diccionario de alias
  → Asignar código único a cada unidad funcional
  → Registrar en contexto del 000_ORQUESTADOR

FASE 2: PROCESAMIENTO (durante análisis y cálculo)
  → Usar SOLO el código alias en razonamientos internos
  → Ejemplo: "UF_AULA × 12 = área total X"
  → NUNCA expandir durante procesamiento interno

FASE 3: RENDERIZADO (entregable final)
  → Expandir alias en texto de salida cuando el destino es un humano
  → Mantener alias colapsados en transferencias entre agentes
```

---

## DICCIONARIO BASE — INFRAESTRUCTURA EDUCATIVA

```json
{
  "UF_AULA_T": {
    "alias": "UF_AULA_T",
    "descripcion": "Aula teórica 48m² / cap. 32 est. / tablero acrílico / sillas universitarias",
    "area_m2": 48,
    "capacidad": 32
  },
  "UF_AULA_S": {
    "alias": "UF_AULA_S",
    "descripcion": "Aula de sistemas 60m² / 30 puestos / red datos CAT6 / A/C inverter",
    "area_m2": 60,
    "capacidad": 30
  },
  "UF_SS_B": {
    "alias": "UF_SS_B",
    "descripcion": "Batería sanitaria 4 módulos (2H/2M) / aparatos bajo consumo / ventilación forzada",
    "area_m2": 24,
    "modulos": 4
  },
  "UF_CORR": {
    "alias": "UF_CORR",
    "descripcion": "Corredor cubierto 3m ancho / piso baldosa ref. exterior / cubierta teja termoacústica",
    "ancho_m": 3
  },
  "UF_ADMIN": {
    "alias": "UF_ADMIN",
    "descripcion": "Bloque administrativo 72m² / recepción + 3 oficinas + sala juntas",
    "area_m2": 72
  },
  "UF_BIB": {
    "alias": "UF_BIB",
    "descripcion": "Biblioteca / sala estudio 96m² / cap. 48 usuarios / dotación básica",
    "area_m2": 96,
    "capacidad": 48
  },
  "UF_LAB": {
    "alias": "UF_LAB",
    "descripcion": "Laboratorio / taller técnico 80m² / mesones de trabajo / extractores",
    "area_m2": 80
  },
  "UF_CAFE": {
    "alias": "UF_CAFE",
    "descripcion": "Cafetería / comedor 120m² / cap. 80 comensales / cocina equipada",
    "area_m2": 120,
    "capacidad": 80
  }
}
```

## DICCIONARIO BASE — INFRAESTRUCTURA SANITARIA / PTAR

```json
{
  "UN_CRIB": {
    "alias": "UN_CRIB",
    "descripcion": "Unidad de cribado grueso / reja manual acero inox AISI-304 / separación 20mm",
    "material": "AISI-304"
  },
  "UN_DESA": {
    "alias": "UN_DESA",
    "descripcion": "Desengrasador-desarenador canal 0.6m ancho / tiempo retención 2min",
    "canal_ancho_m": 0.6
  },
  "UN_REAC": {
    "alias": "UN_REAC",
    "descripcion": "Reactor UASB prefabricado / cap. según caudal diseño / cubierta HDPE",
    "tipo": "UASB"
  },
  "UN_FILT": {
    "alias": "UN_FILT",
    "descripcion": "Filtro percolador plástico aleatorio / altura 2.5m / recirculación automática",
    "altura_m": 2.5
  },
  "UN_CLAR": {
    "alias": "UN_CLAR",
    "descripcion": "Clarificador secundario circular / raspador mecánico / vertedero periférico",
    "tipo": "circular"
  },
  "UN_LECHO": {
    "alias": "UN_LECHO",
    "descripcion": "Lecho de secado de lodos / área según producción / drenaje PVC",
    "drenaje": "PVC"
  }
}
```

---

## PROTOCOLO DE USO EN SESIÓN

### Paso 1 — Declarar alias al inicio

```
ALIAS_DICT = {
  "UF_AULA_T": "Aula teórica 48m²...",
  "UF_SS_B": "Batería sanitaria 4 módulos...",
  ...
}
ALIAS_DICT definido. Procesando en modo comprimido.
```

### Paso 2 — Procesar con alias

```
Programa arquitectónico:
- UF_AULA_T × 8
- UF_AULA_S × 2
- UF_SS_B × 4 (distribuidas por bloques)
- UF_CORR × 320 ml
- UF_ADMIN × 1
Área construida total: (8×48) + (2×60) + (4×24) + 72 = 672m²
```

### Paso 3 — Expandir en entregable final

```markdown
## Programa de Espacios

**Aulas Teóricas (8 unidades)**
Cada aula cuenta con 48m² de área útil, capacidad para 32 estudiantes,
tablero acrílico y mobiliario universitario estándar.

**Aulas de Sistemas (2 unidades)**
...
```

---

## INSTRUCCIÓN PARA EL AGENTE 300_FORMULADOR_PROY

1. Al recibir una solicitud de formulación, detectar componentes repetitivos
2. Instanciar alias antes de procesar cualquier cálculo
3. Transferir el diccionario al `002_GESTOR_DATOS` para persistencia
4. Usar solo códigos alias en comunicación con agentes 303, 305, 307
5. Invocar expansión completa solo cuando `306_FORM_DIALECTICO` prepara el entregable final
