/**
 * APP.JS — FASE 1: dark theme
 *
 * 2026-08-06 (Oleada 1, Grupo Elite): reescrito. Antes importaba
 * Orchestrator000 directamente desde '../src/orchestrator-engine.js' — un import
 * que solo resuelve en `npm run dev` (Vite); en el build de producción (dist/,
 * servido por Express) esa ruta da 404 y el flujo entero quedaba roto en silencio.
 * Ahora este archivo no importa nada de src/ — llama al backend real
 * (POST /api/formulador/fase1 para persistir, POST /api/formulador/ficha-tecnica
 * para generar el borrador, que sí corre Orchestrator000 del lado del servidor).
 * También es, desde esta misma sesión, el único dueño del listener de
 * #btn-generar-ficha (antes había un segundo handler duplicado e inline en
 * fase1-entrada.html que solo guardaba en sessionStorage y nunca llegaba al backend).
 */

const Fase1App = {
  version: '1.0.0',
  theme: { primary: '#2D8B7A', background: '#0f1117', cardRadius: '12px' },
  modules: [
    { id: 1, title: 'Enfoque y Régimen del Proyecto', section: 'metadata', required: true, fields: ['user_type','sector','metodologia','mecanismo'], logic: "IF metodologia==='oxi' THEN show('oxi-suboptions')" },
    { id: 2, title: 'Ubicación y Contexto Geográfico', section: 'geography', required: true, fields: ['departamento','municipio','vereda','lat_lng','territorialidad'], inputs: ['dropzone_kml'] },
    { id: 3, title: 'Diagnóstico y Línea Base (Científico)', section: 'technical_core', required: true, fields: ['problem_statement','root_cause','expected_effect','smart_indicators'], visual: 'ods_selector' },
    { id: 4, title: 'Población y Actores (Stakeholders)', section: 'population', fields: ['poblacion_total','beneficiarios_directos','caracterizacion','mapeo_actores'] },
    { id: 5, title: 'Especificaciones Técnicas y Materialidad', section: 'technical_core', required: true, fields: ['intervention_nature','construction_system','bill_of_materials'], inputs: ['tabla_insumos'] },
    { id: 6, title: 'Gestión Documental (Repositorio IA)', section: 'attachments', uploads: ['tenencia','personeria','confis_certificate','cotizaciones'] }
  ],
  actions: { submit: 'Finalizar Fase 1: Generar Ficha Técnica Integral', output: 'JSON_SCHEMA_V1' }
};

const Fase1Validator = {
  validate(ficha) {
    const errors = [], warnings = [];
    if (!ficha.ficha_fase1?.nombre_proyecto) errors.push({ mod: 1, field: 'nombre_proyecto', msg: 'Nombre del proyecto requerido' });
    if (!ficha.metadata?.user_type) errors.push({ mod: 1, field: 'user_type', msg: 'Tipo de proponente requerido' });
    if (!ficha.metadata?.sector) errors.push({ mod: 1, field: 'sector', msg: 'Sector requerido' });
    if (ficha.metadata?.is_oxi) {
      if (!ficha.attachments?.confis_certificate) errors.push({ mod: 1, field: 'confis_certificate', msg: '⛔ Certificado Cupo CONFIS requerido para OxI', severity: 'BLOCKING' });
      if (!ficha.metadata?.oxi_modality) errors.push({ mod: 1, field: 'oxi_modality', msg: 'Modalidad OxI requerida' });
    }
    if (!ficha.geography?.lat_lng) errors.push({ mod: 2, field: 'lat_lng', msg: 'Coordenadas requeridas' });
    if (!ficha.technical_core?.problem_statement) errors.push({ mod: 3, field: 'problem_statement', msg: 'Declaración del problema requerida' });
    const blocking = errors.filter(e => e.severity === 'BLOCKING');
    return { valid: blocking.length === 0, errors, warnings, blocking };
  }
};

window.Fase1App = Fase1App;

// ── Auth — expuesto por fase1-entrada.html (SDK compat vía CDN, ver ese archivo) ──
async function getAuthToken() {
  if (!window.__antigravityAuth) return null;
  return window.__antigravityAuth.getIdToken();
}

async function apiPost(path, body, token, extraHeaders = {}) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

// Idempotencia (auditoría PROTOCOLO TITÁN 2026-08-12, Capa 9): un ID estable
// por intento de guardado de Fase 1, generado una sola vez por carga de página
// y persistido en sessionStorage — si el guardado se reintenta (reconexión de
// red, doble-click) el backend detecta el mismo key y devuelve el proyecto ya
// creado en vez de duplicarlo. Recargar la página = nuevo proyecto = nuevo key.
function getFase1IdempotencyKey() {
  let key = sessionStorage.getItem('fase1_idempotency_key');
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem('fase1_idempotency_key', key);
  }
  return key;
}

window.FinalizarFase1 = async function FinalizarFase1() {
  console.log('🚀 Disparador:', Fase1App.actions.submit);

  const token = await getAuthToken();
  if (!token) {
    window.__antigravityAuth?.requireLogin?.();
    showBlockingErrors([{ mod: 0, field: 'auth', msg: 'Debes iniciar sesión (botón arriba) antes de generar la Ficha Técnica.' }]);
    return;
  }

  const { ficha_fase1, modulo_7, modulo_8, modulo_9, ficha } = gatherFormData();
  const validation = Fase1Validator.validate({ ficha_fase1, ...ficha });
  console.log('📋 Ficha Fase 1:', ficha_fase1, modulo_7, modulo_8, modulo_9);
  console.log('✅ Validación:', validation);
  if (validation.blocking.length > 0) { showBlockingErrors(validation.blocking); return; }

  const btn = document.getElementById('btn-generar-ficha');
  const originalLabel = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando Fase 1…'; }

  try {
    const guardado = await apiPost(
      '/api/formulador/fase1',
      { ficha_fase1, modulo_7, modulo_8, modulo_9 },
      token,
      { 'X-Idempotency-Key': getFase1IdempotencyKey() }
    );
    console.log('💾 Fase 1 guardada en Supabase:', guardado);
    // Guardado con éxito: limpiar el key para que un futuro proyecto (misma pestaña,
    // sin recargar) reciba uno nuevo, no reutilice el de este proyecto ya creado.
    sessionStorage.removeItem('fase1_idempotency_key');

    if (btn) btn.textContent = 'Generando Ficha Técnica (IA)…';
    const result = await apiPost('/api/formulador/ficha-tecnica', { ficha }, token);
    if (result.success) renderDashboard(result, guardado);
    return result;
  } catch (err) {
    console.error('[FinalizarFase1] Error:', err);
    showBlockingErrors([{ mod: 0, field: 'backend', msg: err.message || 'No se pudo completar el guardado.' }]);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  }
};

window._fileStores = { kml: [], tenencia: [], personeria: [], confis: [], cotizaciones: [] };

function gatherFormData() {
  const val = (id) => document.getElementById(id)?.value || '';

  const selectedODS = Array.from(document.querySelectorAll('.ods-item input:checked')).map(i => parseInt(i.closest('.ods-item').dataset.ods));
  const smartRows = Array.from(document.querySelectorAll('#smart-tbody tr')).map(tr => {
    const inputs = tr.querySelectorAll('input');
    return { indicador: inputs[0]?.value || '', valor_actual: inputs[1]?.value || '', meta: inputs[2]?.value || '', unidad: inputs[3]?.value || '' };
  }).filter(r => r.indicador);
  const insumos = Array.from(document.querySelectorAll('#insumos-tbody tr')).map(tr => {
    const inputs = tr.querySelectorAll('input');
    return { item: inputs[0]?.value || '', descripcion: inputs[1]?.value || '', unidad: inputs[2]?.value || '', cantidad: parseFloat(inputs[3]?.value) || 0, precio_unitario: parseFloat(inputs[4]?.value) || 0 };
  }).filter(r => r.descripcion);
  const latLngStr = val('lat_lng').trim();
  let lat_lng = null;
  if (latLngStr) { const parts = latLngStr.split(',').map(p => p.trim()); if (parts.length === 2) lat_lng = { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) }; }
  const mecanismo = document.querySelector('input[name="mecanismo"]:checked')?.value || 'inversion_directa';
  const isOxi = mecanismo === 'oxi';

  const metadata = { user_type: val('user_type'), sector: val('sector'), metodologia: isOxi ? 'oxi' : 'inversion_directa', mecanismo, is_oxi: isOxi, oxi_modality: isOxi ? (val('oxi_modality') || null) : null };
  const geography = { departamento: val('depto'), municipio: val('municipio'), vereda: val('vereda'), lat_lng, is_zomac_pdet: document.getElementById('is_zomac')?.checked || document.getElementById('is_pdet')?.checked, territorialidad: { zomac: document.getElementById('is_zomac')?.checked || false, pdet: document.getElementById('is_pdet')?.checked || false, frontera: document.getElementById('is_frontera')?.checked || false, territorio_indigena: document.getElementById('is_territorio_indigena')?.checked || false }, kml_file: window._fileStores?.kml?.[0]?.name || null };
  const population = { total: parseInt(val('poblacion_total')) || 0, beneficiarios_directos: parseInt(val('beneficiarios_directos')) || 0, caracterizacion: Array.from(document.querySelectorAll('#modulo-4 input[type="checkbox"]:checked')).map(c => c.value) };
  const technical_core = { problem_statement: val('problem_statement'), root_cause: val('root_cause'), expected_effect: val('expected_effect'), intervention_nature: val('intervention_nature'), construction_system: val('construction_system') || 'Convencional', intervention_description: val('intervention_desc'), smart_indicators: smartRows, ods_goals: selectedODS, bill_of_materials: insumos };
  const attachments = { tenencia: window._fileStores?.tenencia?.[0]?.name || null, personeria: window._fileStores?.personeria?.[0]?.name || null, confis_certificate: window._fileStores?.confis?.[0]?.name || null, cotizaciones: (window._fileStores?.cotizaciones || []).map(f => f.name) };

  // Shape que Orchestrator000 (server-side) espera — ver src/orchestrator-engine.js.
  const ficha = { metadata, geography, population, technical_core, attachments };

  // Shape que insertar_fase1() (Supabase RPC) espera — ver migrations/005_fix_insertar_fase1.sql.
  const ficha_fase1 = {
    nombre_proyecto: val('nombre_proyecto'),
    sector_codigo:   metadata.sector,
    enfoque:         metadata.metodologia,
    regimen:         metadata.mecanismo,
    departamento:    geography.departamento,
    municipio:       geography.municipio,
    zona:            geography.vereda,
    diagnostico:     technical_core.problem_statement,
    poblacion_total: population.total,
  };

  // Módulo 7 — Objetivos
  const oeItems = Array.from(document.querySelectorAll('#oe-container .oe-item')).map((el, i) => {
    const inputs = el.querySelectorAll('.oe-sub input');
    return {
      descripcion: el.querySelector('.oe-textarea')?.value || '',
      indicador:   inputs[0]?.value || '',
      meta:        inputs[1]?.value || '',
      linea_base:  inputs[2]?.value || '',
      unidad:      '',
    };
  }).filter(oe => oe.descripcion);
  const cadena_valor = {
    insumos:     Array.from(document.querySelectorAll('#cadena-insumos .cadena-input')).map(i => i.value).filter(Boolean),
    actividades: Array.from(document.querySelectorAll('#cadena-actividades .cadena-input')).map(i => i.value).filter(Boolean),
    productos:   Array.from(document.querySelectorAll('#cadena-productos .cadena-input')).map(i => i.value).filter(Boolean),
    resultados:  Array.from(document.querySelectorAll('#cadena-resultados .cadena-input')).map(i => i.value).filter(Boolean),
    impacto:     val('cadena-impacto-text'),
  };
  const modulo_7 = {
    objetivo_general: val('objetivo_general'),
    objetivo_general_indicador: '',
    objetivo_general_meta: '',
    objetivo_general_linea_base: '',
    cadena_valor,
    objetivos_especificos: oeItems,
  };

  // Módulo 8 — Cronograma
  const fases = Array.from(document.querySelectorAll('#fases-tbody tr')).map((tr, i) => ({
    id: `F${i + 1}`,
    nombre: tr.querySelector('[data-field="nombre"]')?.value || '',
    inicio_mes: parseInt(tr.querySelector('[data-field="inicio"]')?.value) || null,
    fin_mes: parseInt(tr.querySelector('[data-field="fin"]')?.value) || null,
    responsable: tr.querySelector('[data-field="responsable"]')?.value || '',
    porcentaje: parseFloat(tr.querySelector('[data-field="pct"]')?.value) || 0,
  })).filter(f => f.nombre);
  const hitos = Array.from(document.querySelectorAll('#hitos-tbody tr')).map((tr, i) => {
    const inputs = tr.querySelectorAll('input');
    return { id: `H${i + 1}`, descripcion: inputs[0]?.value || '', mes: parseInt(inputs[1]?.value) || null, entregable: inputs[2]?.value || '' };
  }).filter(h => h.descripcion);
  const modulo_8 = { duracion_meses: parseInt(val('crono_duracion')) || null, fecha_inicio: val('crono_inicio') || null, fecha_fin: val('crono_fin') || null, fases, hitos };

  // Módulo 9 — Presupuesto (columnas: SGR/SGP/Cooperación/Contrapartida por fila)
  let totSgr = 0, totSgp = 0, totCoop = 0, totContraMon = 0, totGeneral = 0;
  Array.from(document.querySelectorAll('#presup-tbody tr')).forEach(tr => {
    const num = sel => parseFloat(tr.querySelector(sel)?.value) || 0;
    totSgr += num('.p-sgr'); totSgp += num('.p-sgp'); totCoop += num('.p-coop'); totContraMon += num('.p-contra');
  });
  totGeneral = totSgr + totSgp + totCoop + totContraMon;
  const fuentes = [];
  if (totSgr  > 0) fuentes.push({ nombre: 'SGR', tipo: 'SGR', aporte: totSgr, es_publica: true });
  if (totSgp  > 0) fuentes.push({ nombre: 'SGP', tipo: 'SGP', aporte: totSgp, es_publica: true });
  if (totCoop > 0) fuentes.push({ nombre: 'Cooperación Internacional', tipo: 'Cooperación', aporte: totCoop, es_publica: true });
  const modulo_9 = {
    presupuesto_total: totGeneral,
    moneda: 'COP',
    fuentes,
    contrapartida: { monetaria: totContraMon, especie: 0, descripcion: '' },
    resumen: { total_sgr: totSgr, total_sgp: totSgp, total_cooperacion: totCoop, total_contrapartida: totContraMon },
    viabilidad_financiera: null,
  };

  return { ficha_fase1, modulo_7, modulo_8, modulo_9, ficha };
}

// Escapa entidades HTML antes de interpolar en innerHTML — cierra el mismo
// patrón de XSS que ya se corrigió para file.name (auditoría PROTOCOLO TITÁN
// 2026-08-12), ahora en el contenido del borrador generado por IA. Ese
// borrador refleja campos que el usuario escribió en el formulario de Fase 1
// (sector, justificación, descripciones), así que un string malicioso podría
// llegar hasta aquí sin pasar por ningún control previo. Cubre tanto texto
// como valores usados dentro de un atributo class="..." (comillas dobles).
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function showBlockingErrors(blocking) {
  let overlay = document.getElementById('blocking-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'blocking-overlay'; overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;'; document.body.appendChild(overlay); }
  overlay.innerHTML = `<div style="background:#1a1d27;border:2px solid #ef4444;border-radius:16px;padding:32px;max-width:500px;text-align:center"><div style="font-size:48px;margin-bottom:16px">⛔</div><h2 style="color:#ef4444;margin-bottom:16px">Pipeline Bloqueado</h2><ul style="text-align:left;color:#f1f5f9;font-size:14px;line-height:1.8;padding-left:20px">${blocking.map(e => `<li>${escapeHtml(e.msg)}</li>`).join('')}</ul><button onclick="document.getElementById('blocking-overlay').style.display='none'" style="margin-top:24px;background:#ef4444;color:#fff;border:none;padding:12px 32px;border-radius:8px;cursor:pointer;font-weight:700">Cerrar</button></div>`;
  overlay.style.display = 'flex';
}

function formatCurrency(n) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n); }

function renderDashboard(result, guardado) {
  const b = result.borrador, e = result.evaluation;
  const area = document.getElementById('results-area');
  if (!area) return;
  const esc = escapeHtml;
  area.innerHTML = `
    ${guardado?.proyecto_id ? `<div class="result-card" style="border-color:var(--status-success)"><div class="result-card__body" style="font-size:13px;">✅ Guardado en Supabase — <strong>proyecto_id:</strong> <code>${esc(guardado.proyecto_id)}</code> · <strong>estado:</strong> ${esc(guardado.estado_validacion)}</div></div>` : ''}
    <div class="result-card"><div class="result-card__header"><span class="result-card__agent-badge badge--052">AGT-052</span><span class="result-card__title">${esc(b.componente_administrativo.titulo)}</span></div><div class="result-card__body"><p><strong>Sector:</strong> ${esc(b.componente_administrativo.sector)}</p><p><strong>Normativa:</strong> ${esc(b.componente_administrativo.normativa_aplicable)}</p><p><strong>Mecanismo:</strong> ${esc(b.componente_administrativo.mecanismo)}</p><p><strong>Territorialidad:</strong> ${esc(b.componente_administrativo.territorialidad)}</p><p style="margin-top:12px;padding:12px;background:var(--divider);border-radius:var(--radius-md);font-size:13px;line-height:1.6">${esc(b.componente_administrativo.justificacion_legal)}</p></div></div>
    <div class="result-card"><div class="result-card__header"><span class="result-card__agent-badge badge--053">AGT-053</span><span class="result-card__title">${esc(b.componente_operativo.titulo)}</span></div><div class="result-card__body"><div class="budget-grid"><div class="budget-item"><div class="budget-item__label">Costo Directo</div><div class="budget-item__value">${formatCurrency(b.componente_operativo.resumen_financiero.costo_directo)}</div></div><div class="budget-item"><div class="budget-item__label">AIU (25%)</div><div class="budget-item__value">${formatCurrency(b.componente_operativo.resumen_financiero.aiu_25)}</div></div><div class="budget-item"><div class="budget-item__label">IVA sobre AIU</div><div class="budget-item__value">${formatCurrency(b.componente_operativo.resumen_financiero.iva_sobre_aiu)}</div></div><div class="budget-item budget-item--total"><div class="budget-item__label">Presupuesto Total</div><div class="budget-item__value">${formatCurrency(b.componente_operativo.resumen_financiero.presupuesto_total)}</div></div></div></div></div>
    <div class="result-card"><div class="result-card__header"><span class="result-card__agent-badge badge--054">AGT-054</span><span class="result-card__title">${esc(b.componente_riesgos.titulo)}</span></div><div class="result-card__body"><p><strong>Riesgo Global:</strong> <span class="risk-badge risk-badge--${esc(b.componente_riesgos.riesgo_global.toLowerCase())}">${esc(b.componente_riesgos.riesgo_global)}</span></p><table class="risk-table"><thead><tr><th>Categoría</th><th>Tipo</th><th>Prob.</th><th>Impacto</th><th>Nivel</th><th>Mitigación</th></tr></thead><tbody>${b.componente_riesgos.riesgos.map(r => `<tr><td>${esc(r.categoria)}</td><td><strong>${esc(r.tipo)}</strong></td><td>${esc(r.probabilidad)}</td><td>${esc(r.impacto)}</td><td><span class="risk-badge risk-badge--${esc(r.nivel_riesgo.toLowerCase())}">${esc(r.nivel_riesgo)}</span></td><td style="font-size:12px">${esc(r.mitigacion)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="result-card" style="border-color:${e.aprobado ? 'var(--status-success)' : 'var(--status-error)'}"><div class="result-card__header" style="background:${e.aprobado ? 'var(--status-success-glow)' : 'var(--status-error-glow)'}"><span class="result-card__agent-badge badge--056">AGT-056</span><span class="result-card__title">${esc(e.titulo)}</span></div><div class="result-card__body"><div class="eval-score"><div class="eval-score__ring"><svg width="80" height="80" viewBox="0 0 80 80"><circle class="ring-bg" cx="40" cy="40" r="36"/><circle class="ring-fill" cx="40" cy="40" r="36" style="stroke-dashoffset:${(1 - e.porcentaje / 100) * 226.2};stroke:${e.aprobado ? 'var(--status-success)' : 'var(--status-error)'}"/></svg><div class="eval-score__value" style="color:${e.aprobado ? 'var(--status-success)' : 'var(--status-error)'}">${e.porcentaje}%</div></div><div class="eval-score__label">${esc(e.veredicto)}<span>${e.puntaje}/${e.puntaje_maximo} puntos</span></div></div><ul class="check-list">${e.checks.map(c => `<li class="check-item check-item--${c.pass ? 'pass' : 'fail'}">${c.pass ? '✅' : '❌'} ${esc(c.test)}${c.msg ? ` — ${esc(c.msg)}` : ''}</li>`).join('')}</ul></div></div>
  `;
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function handleFiles(files, type) { Array.from(files).forEach(file => { window._fileStores[type].push(file); renderAttachments(type); }); }
// file.name lo controla quien sube el archivo (puede contener HTML/JS) — nunca
// se interpola en innerHTML (hallazgo XSS, auditoría PROTOCOLO TITÁN 2026-08-12).
function renderAttachments(type) {
  const list = document.getElementById('list-' + type);
  if (!list) return;
  list.innerHTML = '';
  window._fileStores[type].forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'attachment-item';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'attachment-item__name';
    nameSpan.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'attachment-item__remove';
    removeBtn.textContent = '✕';
    removeBtn.onclick = () => removeFile(type, idx);
    item.appendChild(nameSpan);
    item.appendChild(removeBtn);
    list.appendChild(item);
  });
}
function removeFile(type, idx) { window._fileStores[type].splice(idx, 1); renderAttachments(type); }
window.removeFile = removeFile;

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-generar-ficha');
  if (btn) btn.addEventListener('click', () => FinalizarFase1());

  const oxiTrigger = document.getElementById('oxi-trigger');
  const oxiOptions = document.getElementById('oxi-options');
  if (oxiTrigger && oxiOptions) { oxiTrigger.addEventListener('click', () => oxiOptions.classList.add('visible')); document.querySelectorAll('input[name="mecanismo"]').forEach(r => { if (r.value !== 'oxi') r.addEventListener('click', () => oxiOptions.classList.remove('visible')); }); }

  document.querySelectorAll('.drop-zone').forEach(zone => { zone.addEventListener('click', () => zone.querySelector('input').click()); zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); }); zone.addEventListener('dragleave', () => zone.classList.remove('dragover')); zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); handleFiles(e.dataTransfer.files, zone.dataset.type); }); zone.querySelector('input').addEventListener('change', e => handleFiles(e.target.files, zone.dataset.type)); });

  document.querySelectorAll('.ods-item').forEach(el => el.addEventListener('click', () => el.classList.toggle('selected')));

  console.log('%c⚠️ Antigravity OS — Fase 1', 'background:#2D8B7A;color:#fff;padding:4px 8px;border-radius:4px;font-weight:bold');
  console.log('%cEscribe FinalizarFase1() para ejecutar el pipeline', 'color:#2D8B7A');
});
