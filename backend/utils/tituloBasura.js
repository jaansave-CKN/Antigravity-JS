/**
 * tituloBasura.js — ÚNICA fuente de listas de títulos que NO son
 * convocatorias (reparación estructural 2026-09-29; dictamen architect C).
 *
 * Dos familias, con usos distintos a propósito:
 *
 * 1. esRuidoDeNavegacion() — las listas que ya existían, movidas SIN cambios
 *    (antes NOISE_TITLES/NOISE_TITLE_RE en EntityScraper.js y GARBAGE_TITLE_RE
 *    en server.js). Son agresivas ("The X", "Our X"): sirven para descartar
 *    enlaces durante la EXTRACCIÓN, nunca para borrar filas ya guardadas.
 *
 * 2. motivoBasura() — lista curada contra el catálogo real (galerías,
 *    reservas de espacios, instructivos, páginas legales, logins…). Se aplica
 *    en los 3 INSERT de la ingesta y en backend/scripts/purgarBasuraCatalogo.mjs.
 *    - FUERTES: siempre basura.
 *    - DÉBILES: basura SOLO si el título no tiene ningún término de
 *      financiación ("Green Jobs Fund", "NSF CAREER Award" o "Gallery Grant
 *      Program" se conservan). La protección es propia: FUNDING_KEYWORDS de
 *      EntityScraper no contiene "fund" y alimenta los extractores, no se toca.
 */

// ── 1. Ruido de navegación (movido tal cual) ─────────────────────────────────
const NOISE_TITLES = [
  // Navegación / footer
  'información de contacto','informacion de contacto',
  'política de privacidad','politica de privacidad',
  'aviso legal','términos y condiciones','terminos y condiciones',
  'términos de uso','terminos de uso',
  'cookie','newsletter','suscr',
  'inicio','home','about us','acerca de',
  'mapa del sitio','sitemap','accesibilidad',
  'redes sociales','síguenos','siguenos',
  'contáctenos','contactenos','contáctanos','contactanos',
  'footer','enlaces rápidos','enlaces rapidos',
  'líneas de atención','lineas de atencion',
  'líneas de crédito','lineas de credito',
  'línea de atención','linea de atencion',
  // Navegación — español (no presentes en la lista inglesa)
  'saltar al contenido','ir al contenido','pasar al contenido',
  'menú principal','menu principal','menú de navegación','menu de navegacion',
  'tabla de contenidos','volver a','regresar a','volver al inicio',
  'más información','mas informacion','ver más','ver mas',
  'leer más','leer mas','haga clic','descargue el','descargue los',
  'nuestros criterios','nuestros proyectos','nuestra misión','nuestra vision',
  // Navegación — francés
  'télécharger ','telecharger ','consulter le','consulter nos','accéder au',
  'aller au contenu','retour à','retour a','lire la suite','nos critères',
  'notre sélection','notre selection','notre mission','nos projets',
  'formulaire de contact','formulaire de candidature',
  // Portales UE — nav/breadcrumb/idioma
  'skip to main content','have your say','funding and tenders',
  'before you apply','eligibility: who can','eu open data',
  'financial instruments: equity','funding by management',
  'find calls for funding','eu funding programmes',
  'seal of excellence','in budget and funding',
  ' Nederlands',' português',' slovenčina',' slovenščina',
  ' español',' français',' italiano',' deutsch',
  ' română',' polski',' česky',' magyar',
  // Documentos / reportes institucionales — no son convocatorias abiertas
  'resolución no','resolucion no','decreto no','circular no',
  'informe de gestión','informe de actividades','informe anual','informe final',
  'nota de prensa','comunicado de prensa','boletín informativo','boletin informativo',
  'guía de uso','manual de usuario','manual de operaciones',
  'plan de acción','plan de trabajo','marco de referencia','documento de trabajo',
  'política pública','politica publica','reglamento de',
  // Ayuda y preguntas genéricas
  'the application process','what is the difference','for beginners',
  'eligibility: who','how to apply','frequently asked','faq',
  // Páginas institucionales genéricas de donantes (falsos positivos frecuentes)
  'funding faq','grants faq','grants data','grants database',
  'funding portfolio','funding opportunities overview',
  'about the iaf','about the foundation','about the program','about the grant',
  'our funding portfolio','our grants data','our global presence',
  'our focus areas','our project stories','our results in',
  'descarga ','download our','brochure',
  'learn more','read more','see more','view more','explore more',
  'sign in','log in','register','subscribe',
  'press release','media release','news release',
  // Portales gob.co colombianos — navegación estándar por ley de transparencia
  // (Ley 1712/2014), presente en prácticamente todas las entidades públicas.
  // Confirmado en vivo: FENOGE y Fondo Emprender devolvían esto como si fueran
  // convocatorias — no eran casos aislados, es el patrón de cualquier .gov.co.
  'transparencia','rendición de cuentas','rendicion de cuentas',
  'trámites y servicios','tramites y servicios',
  'quiénes somos','quienes somos','nuestra organización','nuestra organizacion',
  'sistema integrado de gestión','sistema integrado de gestion',
  'preguntas frecuentes','notificaciones anónimas','notificaciones anonimas',
  'conflicto de intereses','manuales y otros actos administrativos',
  'histórico de procesos de contratación','historico de procesos de contratacion',
  'plan anual de necesidades','actas de comité directivo','actas de comite directivo',
  'gestión del conocimiento','gestion del conocimiento',
  'urna de cristal','proyectos ejecutados',
  'observaciones acreditación','observaciones acreditacion',
  'observaciones evaluación','observaciones evaluacion',
  // Enlaces cruzados a otras entidades de gobierno (footer/menú compartido) —
  // formato abreviado de portal ("MinEducación"), no el nombre completo que
  // usaría un título real de convocatoria ("Ministerio de Educación")
  'minrelaciones','mineducación','mineducacion','mintransporte','minagricultura',
  'mincomercio','minsalud','mintrabajo','minambiente','mindefensa','minjusticia',
  'minhacienda','mintic','minvivienda','mincultura','mindeporte',
  'vicepresidencia',
];

// Patrón de frases institucionales que NO son convocatorias
const NOISE_TITLE_RE = /^(our|their|its|the)\s\w|^about\s(us|the\s|our\s)|^(who|what)\s(we|is)\s/i;
// Enlaces de navegación genéricos (antes GARBAGE_TITLE_RE en server.js)
const NAV_TITLE_RE = /^(saltar al|ir al|pasar al|menú|volver a|retour à|retour a|télécharger|telecharger|consulter le|aller au|acceder al|accéder au|skip to|go to main|learn more|read more|see more|sign in|log in|register|subscribe|click here|apply now|find out more)/i;

/** Ruido de la extracción (antes isNoisyTitle de EntityScraper). */
export function esRuidoDeNavegacion(titulo) {
  const t = String(titulo || '').toLowerCase().trim();
  if (NOISE_TITLES.some(n => t.includes(n))) return true;
  if (t.endsWith(':') && t.length < 40) return true;
  return NOISE_TITLE_RE.test(String(titulo || '').trim());
}

/** Enlace de navegación genérico (antes isGarbageTitle de server.js, sin el largo mínimo). */
export function esEnlaceDeNavegacion(titulo) {
  return NAV_TITLE_RE.test(String(titulo || '').trim());
}

// ── 2. Basura curada (catálogo real, 2026-09-29) ─────────────────────────────
const PROTECCION_FINANCIACION = /\bfunds?\b|fund(?!ament)|financ|\bgrants?\b|\bawards?\b|\bprizes?\b|premio|scholarship|\bbecas?\b|fellowship|call for|convocatoria|challenge|subvenci|\bprogramm?e?s?\b/i;

const FUERTES = [
  ['instructivo', /^instructivos?\b/i],
  ['manual', /^manual (de|del|para|of|for)\b/i],
  ['vista_de_listado', /\b(photo|table|list|grid) view\b/i],
  ['reserva_de_espacio', /\bevent space\b|^request an? (event|meeting|visit|space)\b/i],
  ['accesibilidad', /^accessibility( statement)?$/i],
  ['terminos', /^(terms of use|terms and conditions|t[ée]rminos (de uso|y condiciones))$/i],
  ['privacidad', /^(privacy (policy|notice)|pol[ií]tica de privacidad|cookies? (policy|settings))$/i],
  ['login', /^(log ?in|sign ?in|iniciar sesi[oó]n)\b/i],
  ['imagen_corporativa', /^(imatge|imagen) corporativa$/i],
  ['formulario', /^formulario de solicitud$/i],
  ['institucional', /\bnews and media\b|^(press releases?|newsletter|sitemap|contact us|about us)$/i],
  ['politicas', /^policies,? standards\b/i],
  ['empleo_institucional', /^work (for|with) us\b/i],
  ['tablero', /^dashboards?\b|\bdashboards?$/i],
  ['navegacion', /^(skip to|saltar al|ir al contenido|go to main)\b/i],
  ['medios', /^media (enquiries|center|centre|contacts?|kit)$/i],
  ['publicaciones', /^(\w+ )?publications$|^(reports|document) library$|^science stories$/i],
  ['logo_o_chat', /^(logo|chat)\b/i],
  // Páginas institucionales medidas en el catálogo (menús de Minciencias,
  // ERC, GEF, Wellcome…): nombres exactos de sección, no convocatorias.
  ['pagina_institucional', /^(research ethics|transparen(cy|cia)|visitors'? cent(re|er)|heritage cent(re|er)|grants to date|grants portal|gef agencies|red exterior|registro esal|acreditaciones|viceministerios|el ministerio|universidades|resilience index|engaging people)$/i],
];

const DEBILES = [
  ['galeria', /\bgaller(y|ies)\b|\bgaler[ií]a\b/i],
  ['carreras', /^careers?\b/i],
  ['tablero', /\bdashboards?\b/i],
  ['quejas', /\bcomplaints?\b|\bquejas?\b/i],
  // Solo "jobs" en plural: "Enterprise Development and Job Skills" (área
  // temática de financiación de la IAF) no es basura.
  ['empleos', /\bjobs\b|\bvacanc(y|ies)\b/i],
  ['informe_anual', /\bannual reports?\b|\binforme anual\b/i],
  // "2024 – AGUA-C", "2024 – Redecom-Cartagena": subvenciones YA OTORGADAS
  // (anuncios de beneficiarios de la IAF), no convocatorias abiertas.
  ['subvencion_otorgada', /^20\d{2}\s*[–-]\s+/],
];

/** Cabeza del título: sin sufijo de sitio ("Terms of use | Wellcome") ni puntuación final. */
function cabeza(titulo) {
  return titulo.split(/\s+[|–—]\s+/)[0].replace(/[\s.:;,!]+$/, '').trim();
}

/** Motivo por el que el título es basura ("fuerte:login", "debil:quejas"…), o null. */
export function motivoBasura(titulo) {
  const t = String(titulo || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (!/\p{Script=Latin}{3}/u.test(t)) return 'fuerte:sin_texto_latino';
  const c = cabeza(t);
  for (const [nombre, re] of FUERTES) if (re.test(c) || re.test(t)) return `fuerte:${nombre}`;
  if (PROTECCION_FINANCIACION.test(t)) return null;
  for (const [nombre, re] of DEBILES) if (re.test(c) || re.test(t)) return `debil:${nombre}`;
  return null;
}

export function esTituloBasura(titulo) {
  return motivoBasura(titulo) !== null;
}
