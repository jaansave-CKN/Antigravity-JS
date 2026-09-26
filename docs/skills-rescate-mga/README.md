# Rescate de skills MGA — legacy 010 "Redactor Técnico"

Rescatadas 2026-09-25 de `agents/010-ingeniero-qa-automatizacion/` (Sistema A legacy, antes `010_redactor_tecnico`) antes de moverlo a `_legacy_backup/` (directorio eliminado 2026-09-26; original recuperable con `git checkout ac1721c -- agents/010-ingeniero-qa-automatizacion`). Copia byte a byte (SHA-256 verificado). Destino previsto: base documental del Agente Formulador (`projects/Radford-360/Proy_03 B Formulador/`).

| Archivo | Qué hace realmente | Estado |
|---|---|---|
| `Skill_002_Redactor_Propuestas.cjs` | Genera un `.docx` (lib `docx`) con encabezado de propuesta técnica: nombre, ubicación, naturaleza/población, inversión en COP y 2 viñetas de estrategia fija. | Borrador. Escribe en `./skills/BORRADOR_TECNICO.docx` relativo al cwd (ruta rota fuera de su carpeta original). |
| `Skill_002_Generador_Anexos.cjs` | Escribe `MEMORIA_TECNICA.txt` con una memoria justificativa de cantidades de texto fijo. El argumento `presupuestoReal` se recibe pero no se usa. | Plantilla estática. |
| `IDENTITY_redactor_tecnico_legacy.md` | Rol y reglas del agente legacy (NSR-10/NTC, DOCX, tono humanizado, estructura encabezado/cuerpo/pie). | Referencia. |

**Alcance honesto:** no son metodología MGA completa (no hay árbol de problemas, cadena de valor, indicadores ni estructura de ficha MGA del DNP). Sirven como semilla de estructura narrativa y de formato DOCX; el contenido metodológico MGA debe construirse en el Formulador.

Ningún código de `src/`, `server.js` ni `package.json` importa estos archivos.
