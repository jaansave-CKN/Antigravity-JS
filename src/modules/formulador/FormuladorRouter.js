import { Router } from 'express';
import {
  guardarFase1, obtenerFase1, generarFichaTecnica,
  listarProyectos, guardarModulo10, obtenerModulo10,
} from './FormuladorPgController.js';
import { validateBody, schemas } from '../../shared/infrastructure/validation.js';

export function createFormuladorRouter() {
  const router = Router();

  // POST /api/formulador/fase1  — persiste módulos 7, 8, 9 en PostgreSQL
  router.post('/fase1', guardarFase1);

  // GET  /api/formulador/proyectos — lista los proyectos del tenant (Oleada 3)
  router.get('/proyectos', listarProyectos);

  // GET  /api/formulador/fase1/:id — recupera un proyecto completo
  router.get('/fase1/:id', obtenerFase1);

  // POST /api/formulador/ficha-tecnica — corre Orchestrator000 (AGT-052/053/054/056)
  // server-side. Oleada 1, Grupo Elite (2026-08-06).
  router.post('/ficha-tecnica', validateBody(schemas.fichaTecnica), generarFichaTecnica);

  // Módulo 10 — Indicadores y Seguimiento (Oleada 3, Grupo Elite, 2026-08-06)
  router.get('/:id/modulo10', obtenerModulo10);
  router.post('/:id/modulo10', validateBody(schemas.modulo10), guardarModulo10);

  return router;
}
