# 🎯 Configuración de Automation 24/7

## Opción 1: GitHub Actions (GRATIS)

### Pasos para activar:

1. **Subir proyecto a GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/TU_USUARIO/radar-fondos.git
   git push -u origin main
   ```

2. **Agregar secrets en GitHub**
   - Ir a Settings → Secrets and variables → Actions
   - Agregar:
     - `SERPAPI_KEY` (obtener en serpapi.com, $5/mes)
     - `OPENAI_API_KEY` (opcional)

3. **El workflow correrá automáticamente cada 6 horas**

### Estado actual:
- ✅ Workflow creado: `.github/workflows/radar.yml`
- ⚠️ Requiere configurar SerpAPI para búsquedas reales

---

## Opción 2: Tu PC con Cron (GRATIS)

### Windows (Tarea Programada):
1. Crear script batch:
   ```batch
   @echo off
   python scripts\radar_search.py
   git add .
   git commit -m "Actualización %date% %time%"
   git push
   ```
2. Programar en Tarea Programada cada 6 horas

### Linux/Mac (Cron):
```bash
crontab -e
# Agregar línea:
0 */6 * * * cd /ruta/proyecto && python scripts/radar_search.py && git push
```

---

## Opción 3: Firebase Blaze (~$0/mes)

### Costo real:
- **Gratis** si usás < 2M invocaciones/mes
- **$300 crédito** al hacer upgrade
- Solo pagás si excedés los límites

### Para activar:
1. Ir a https://console.firebase.google.com/project/antigravity-jairo-2026/usage/details
2. Click "Upgrade to Blaze"
3. Añadir tarjeta (no cobra si no usás)

---

## Recomendación

**Si tenés poco uso:** Firebase Blaze (gratis con límites)

**Si querés control total:** GitHub Actions + SerpAPI ($5/mes)

**Lo más fácil ahora:** Dejá que siga buscando yo manualmente cuando me necesites - es gratis y funciona bien.

---

## Estado del Proyecto

| Componente | Estado |
|------------|--------|
| App web | ✅ Desplegada |
| Convocatorias | ✅ 45 oportunidades |
| Búsqueda manual | ✅ Funciona |
| GitHub Actions | ⚠️ Requiere config |
| Firebase Functions | ⚠️ Requiere Blaze |
| Cron en PC | ✅ manual |