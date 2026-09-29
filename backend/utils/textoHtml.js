/**
 * textoHtml.js — decodificador ÚNICO de entidades HTML para la ingesta del
 * catálogo (higiene de datos, 2026-09-29; dictamen architect condición A).
 *
 * Por qué existe: los scrapers quitaban etiquetas pero nunca decodificaban
 * entidades, y después sanitizeInput() borra todos los ';' — en producción
 * quedaron 39 títulos y 17 descripciones con restos como "d&#039Ivoire",
 * "2024 &#8211 Alianza" o "Complaints &amp Reports". Por eso las entidades se
 * reconocen CON o SIN ';'.
 *
 * Reglas de seguridad:
 * - UNA sola pasada (nunca "hasta que se estabilice"): "&amp;lt;" → "&lt;".
 * - Una nombrada sin ';' solo se decodifica si NO la sigue una letra o dígito
 *   ("&amplt" queda igual): la captura es codiciosa, así que un nombre que no
 *   está en la tabla nunca se decodifica a medias.
 * - Numéricas: se rechazan controles (salvo \t y \n), C1, surrogates,
 *   marcas bidi (U+202A–202E, U+2066–2069) y valores > U+10FFFF; la entidad
 *   rechazada queda como texto (fromCodePoint nunca lanza RangeError).
 * - La salida SIEMPRE debe pasar después por sanitizeInput() (un "&lt;script&gt;"
 *   decodificado es texto "<script>" que sanitizeInput elimina).
 */

const NOMBRADAS = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  hellip: '…', laquo: '«', raquo: '»', middot: '·', bull: '•', deg: '°', ordm: 'º', ordf: 'ª',
  iexcl: '¡', iquest: '¿', euro: '€', pound: '£', cent: '¢', copy: '©', reg: '®', trade: '™',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', ccedil: 'ç', Ccedil: 'Ç', atilde: 'ã', otilde: 'õ',
};

function codigoPermitido(cp) {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return false;
  if (cp < 0x20) return cp === 0x09 || cp === 0x0a;
  if (cp >= 0x7f && cp <= 0x9f) return false;
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return false;
  return true;
}

const ENTIDAD_RE = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});?/g;

export function decodificarEntidades(texto) {
  if (typeof texto !== 'string' || !texto.includes('&')) return texto;
  return texto.replace(ENTIDAD_RE, (completa, cuerpo) => {
    if (cuerpo[0] === '#') {
      const cp = cuerpo[1] === 'x' || cuerpo[1] === 'X' ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10);
      return codigoPermitido(cp) ? String.fromCodePoint(cp) : completa;
    }
    if (Object.hasOwn(NOMBRADAS, cuerpo)) return NOMBRADAS[cuerpo];
    // "&quotMUJERES" (el ';' lo borró sanitizeInput): quot/apos se decodifican
    // aunque las siga una letra, porque " y ' no pueden formar otra entidad —
    // sigue siendo una sola pasada idempotente. Las demás ("&amplt") quedan igual.
    const prefijo = /^(quot|apos)(?=[A-Za-z0-9])/.exec(cuerpo);
    if (prefijo && !completa.endsWith(';')) return NOMBRADAS[prefijo[1]] + cuerpo.slice(prefijo[1].length);
    return completa;
  });
}
