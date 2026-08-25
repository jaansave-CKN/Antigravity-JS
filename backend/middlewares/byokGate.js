/**
 * byokGate.js — middleware de intercepción BYOK para las 7 rutas
 * interactivas de IA (migración 045). Verificado con `architect` antes de
 * construirse: exento (usuarios.byok_exento) → sigue con la llave del
 * servidor sin ningún cambio; no exento sin llave propia válida → 428
 * antes de tocar Gemini para nada.
 *
 * 428 (Precondition Required), no 403: este repo ya usa 403+code para
 * "tu plan no alcanza" (NO_ACCESS_RADAR, SUBSCRIPTION_EXPIRED, con
 * redirect_to:'/planes') — reusar 403 aquí arriesgaba que un interceptor
 * futuro de "403 → /planes" atrapara este caso por error. 428 no colisiona
 * con nada existente.
 */
import { esExento, resolverContextoBYOK } from '../services/byokService.js';
import { geminiCB } from '../services/geminiCircuitBreaker.js';

export function requireByokOrExento({ getRow, getRows }) {
  return async (req, res, next) => {
    try {
      const { exento, llaves } = await resolverContextoBYOK(req.userId, { getRow, getRows });
      if (exento) {
        // Válvula de escape (mandato 2026-08-24, "ModalBYOK — degradación
        // elegante"): un exento sigue usando el pool del servidor por
        // defecto, sin ningún cambio — SALVO que ese pool esté agotado AHORA
        // MISMO (geminiCB.getEarliestRetryAt() no-null) y el usuario ya haya
        // guardado voluntariamente su propia llave (vía el modal de rescate,
        // no un requisito). En ese caso, y solo en ese caso, se usa su llave
        // propia en vez de dejarlo esperando el cronómetro del pool
        // compartido. Un exento con pool sano, o sin llave propia, nunca
        // toca esta rama — comportamiento idéntico al de antes.
        if (llaves.length && geminiCB.getEarliestRetryAt()) {
          req.userGeminiKeys = llaves;
          return next();
        }
        req.userGeminiKeys = null; // null = usar el pool del servidor, comportamiento intacto
        return next();
      }
      if (!llaves.length) {
        // FIX: '/panel' es PanelPage.tsx (keywords del Radar) — la página real
        // de gestión de credenciales es '/apis' (CredentialsPage.tsx). El
        // frontend nunca navega automáticamente con esto (ver ByokRequiredModal
        // — modal, no redirect); redirect_to solo sirve como referencia para
        // el botón explícito "Gestionar mis llaves" dentro del modal.
        return res.status(428).json({
          success: false,
          code: 'BYOK_REQUIRED',
          message: 'Configura tu propia llave de Gemini en el Panel de Control antes de usar esta función.',
          redirect_to: '/apis',
        });
      }
      req.userGeminiKeys = llaves; // array de llaves propias ya desencriptadas
      next();
    } catch (err) {
      next(err);
    }
  };
}

export { esExento };
