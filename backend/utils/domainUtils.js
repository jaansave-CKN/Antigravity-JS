/**
 * domainUtils.js — Fuente de Verdad para normalización de dominios.
 * Importado por: server.js, EntityScraper.js, DataIngestor.js
 *
 * getApexDomain garantiza que funding.wellcome.org → wellcome.org
 * y que sena.edu.co → sena.edu.co (eTLD edu.co preservado).
 */

// Second-level TLD labels de registro comunes (eTLD-aware)
const REGISTRY_LABELS = new Set([
  'edu','gov','org','net','co','ac','mil','sch','nhs','police','mod','ltd','plc','me','nom','gob','int',
]);

/**
 * Extrae el Apex Domain (dominio raíz) de una URL o hostname.
 *
 * Ejemplos:
 *   https://funding.wellcome.org/schemes  →  wellcome.org
 *   https://www.sena.edu.co/noticias      →  sena.edu.co
 *   https://grants.afd.fr                 →  afd.fr
 *   apccolombia.gov.co                    →  apccolombia.gov.co
 *
 * @param {string|null} urlOrHost
 * @returns {string|null}
 */
export function getApexDomain(urlOrHost) {
  if (!urlOrHost) return null;
  let hostname = urlOrHost;
  if (urlOrHost.includes('://')) {
    try { hostname = new URL(urlOrHost).hostname; } catch { return null; }
  }
  const h = hostname.replace(/^www\./, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h || null;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  // Si TLD es código de país (2 letras) y SLD es label de registro → conservar 3 segmentos
  if (tld.length === 2 && REGISTRY_LABELS.has(sld)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

// Alias para compatibilidad con código previo
export const extractRootDomain = getApexDomain;
