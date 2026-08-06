let stateManager;
try {
  ({ stateManager } = await import('../src/shared/infrastructure/StateManager.js'));
} catch (err) {
  console.error('[AutoCheckpoint] StateManager no disponible, usando fallback en memoria (no persiste entre reinicios):', err.message);
  let _mem = null;
  stateManager = {
    saveCheckpoint(estado) { _mem = { ...estado, checkpointTime: new Date().toISOString() }; return _mem; },
    loadCheckpoint()       { return _mem; },
    listBackups()          { return []; },
  };
}

const INTERVALO = 300000;

let sistemaActivo = true;
let tareasPendientes = [];
let agentesActivos = [];
let historialEventos = [];

function capturarEstado() {
  return {
    sistema: {
      activo: sistemaActivo,
      ultimaActividad: new Date().toISOString()
    },
    tareas: tareasPendientes,
    agentes: agentesActivos,
    eventos: historialEventos.slice(-50),
    estado: 'checkpoint'
  };
}

function guardarCheckpoint() {
  try {
    const estado = capturarEstado();
    stateManager.saveCheckpoint(estado);
    
    console.log(`[Checkpoint] Guardado automático - ${new Date().toISOString()}`);
    console.log(`[Checkpoint] Tareas: ${tareasPendientes.length} | Agentes: ${agentesActivos.length}`);
  } catch (e) {
    console.error('[Checkpoint] Error:', e.message);
  }
}

function iniciarMonitor() {
  console.log(`[AutoCheckpoint] Iniciando guardado automático cada 5 minutos...`);
  
  guardarCheckpoint();
  
  setInterval(() => {
    guardarCheckpoint();
  }, INTERVALO);
}

function agregarTarea(tarea) {
  tareasPendientes.push({
    ...tarea,
    id: Date.now(),
    timestamp: new Date().toISOString()
  });
}

function completarTarea(id) {
  tareasPendientes = tareasPendientes.filter(t => t.id !== id);
}

function registrarAgente(agente) {
  const idx = agentesActivos.findIndex(a => a.id === agente.id);
  if (idx >= 0) {
    agentesActivos[idx] = { ...agente, ultimaActualizacion: new Date().toISOString() };
  } else {
    agentesActivos.push({ ...agente, ultimaActualizacion: new Date().toISOString() });
  }
}

function adicionarEvento(evento) {
  historialEventos.push({
    ...evento,
    timestamp: new Date().toISOString()
  });
  if (historialEventos.length > 100) {
    historialEventos = historialEventos.slice(-100);
  }
}

function recuperarEstado() {
  const checkpoint = stateManager.loadCheckpoint();
  if (checkpoint) {
    console.log('[Recuperacion] Estado encontrado, restaurando...');
    if (checkpoint.tareas) tareasPendientes = checkpoint.tareas;
    if (checkpoint.agentes) agentesActivos = checkpoint.agentes;
    if (checkpoint.eventos) historialEventos = checkpoint.eventos;
    console.log(`[Recuperacion] Restaurado: ${tareasPendientes.length} tareas, ${agentesActivos.length} agentes`);
    return checkpoint;
  }
  console.log('[Recuperacion] No hay checkpoint previo');
  return null;
}

function obtenerEstado() {
  return {
    tareas: tareasPendientes,
    agentes: agentesActivos,
    ultimoCheckpoint: stateManager.loadCheckpoint()?.checkpointTime,
    backupsDisponibles: stateManager.listBackups()
  };
}

iniciarMonitor();

export {
  agregarTarea,
  completarTarea,
  registrarAgente,
  adicionarEvento,
  recuperarEstado,
  obtenerEstado,
  guardarCheckpoint
};