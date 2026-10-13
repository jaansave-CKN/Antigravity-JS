# SKILL: Antigravity Auto-Recovery System
## Estado: ACTIVE
## Rol: Supervisor de Resiliencia 24/7

### Descripción
Sistema de recuperación automática para Antigravity OS. Garantiza continuidad operativa ante cortes de energía, fallos del sistema o desconexiones abruptas.

### Funcionalidades

#### 1. Checkpoint Automático (cada 5 minutos)
- Guardado automático del estado completo del sistema
- Persistencia de tareas, agentes y eventos
- Copias de seguridad rotativas (12 backups máximo)

#### 2. Proceso de Recuperación
```
1. Detectar reinicio del sistema
2. Cargar último checkpoint válido
3. Restaurar estado de tareas y agentes
4. Reanudar operaciones desde punto de interrupción
5. Notificar continuidad operativa
```

#### 3. Archivos Clave
- `/data/antigravity_state.json` - Estado actual
- `/data/checkpoint.json` - Último checkpoint
- `/data/backups/checkpoint_*.json` - Copias de seguridad

#### 4. Funciones de API
- `GET /api/recovery/status` - Consultar estado de recuperación
- `POST /api/recovery/restore` - Forzar restauración desde backup
- `GET /api/recovery/backups` - Listar backups disponibles

### Uso en Código
```javascript
import { stateManager } from '../src/shared/infrastructure/StateManager.js';
import { recuperarEstado, obtenerEstado, guardarCheckpoint } from '../scripts/auto_checkpoint.js';

// Recuperar al iniciar
recuperarEstado();

// Consultar estado
const estado = obtenerEstado();
```

### Recuperación Manual
```bash
# Ver backups disponibles
node -e "console.log(require('./src/shared/infrastructure/StateManager.js').stateManager.listBackups())"

# Restaurar desde backup específico
node -e "require('./src/shared/infrastructure/StateManager.js').stateManager.restoreFromBackup('checkpoint_2026-04-24T17-00-00.000Z.json')"
```

### Métricas de Resiliencia
- RPO (Recovery Point Objective): 5 minutos
- RTO (Recovery Time Objective): < 30 segundos
- Retención de backups: 12 copias (1 hora)