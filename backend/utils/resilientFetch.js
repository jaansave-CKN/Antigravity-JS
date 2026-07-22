import { Agent } from 'undici';

/**
 * Muchos portales gubernamentales/institucionales (p.ej. varios *.gov.co)
 * sirven una cadena TLS incompleta (falta el certificado intermedio). Los
 * navegadores la reconstruyen desde su propio almacén y cargan igual, pero
 * el fetch nativo de Node (undici) la rechaza con UNABLE_TO_VERIFY_LEAF_SIGNATURE
 * y el sitio queda invisible para el rastreo profundo del Directorio.
 *
 * fetchResiliente reintenta UNA vez, solo ante ese tipo de error de cadena de
 * certificado, sin validación estricta — aceptable aquí porque solo se lee
 * contenido público (páginas de convocatorias/grants), nunca se envían
 * credenciales ni datos sensibles a través de esta ruta.
 */
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

const CERT_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

function esErrorDeCertificado(err) {
  const code = err?.cause?.code || err?.code || '';
  const message = err?.cause?.message || err?.message || '';
  return CERT_ERROR_CODES.has(code) || /certificate|CERT_|TLS/i.test(message);
}

export async function fetchResiliente(url, opts = {}) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    if (!esErrorDeCertificado(err)) throw err;
    console.warn(`[fetchResiliente] Cadena TLS no verificable en ${url} — reintentando sin validación estricta.`);
    return await fetch(url, { ...opts, dispatcher: insecureAgent });
  }
}
