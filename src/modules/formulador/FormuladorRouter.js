import { Router } from 'express';
import { guardarFase1, obtenerFase1 } from './FormuladorPgController.js';

export function createFormuladorRouter() {
  const router = Router();

  // POST /api/formulador/fase1  — persiste módulos 7, 8, 9 en PostgreSQL
  router.post('/fase1', guardarFase1);

  // GET  /api/formulador/fase1/:id — recupera un proyecto completo
  router.get('/fase1/:id', obtenerFase1);

  return router;
}
