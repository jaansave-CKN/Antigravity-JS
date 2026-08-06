/**
 * APP.JS — FASE 1: dark theme
 */

import { Orchestrator000 } from '../src/orchestrator-engine.js';

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

window.FinalizarFase1 = async function FinalizarFase1() {
  console.log('🚀 Disparador:', Fase1App.actions.submit);
  const ficha = gatherFormData();
  const validation = Fase1Validator.validate(ficha);
  console.log('📋 Ficha:', ficha);
  console.log('✅ Validación:', validation);
  if (validation.blocking.length > 0) { showBlockingErrors(validation.blocking); return; }

  const orchestrator = new Orchestrator000();

  // GATE DE ARQUITECTURA — validar el diseño de la ficha antes de generar nada.
  const disenoAprobado = await orchestrator.validarDiseno(ficha);
  console.log('🏛️ Gate de arquitectura:', disenoAprobado);
  if (!disenoAprobado.aprobado) {
    showBlockingErrors(disenoAprobado.checks.filter(c => !c.pass).map(c => ({ mod: 0, field: c.test, msg: c.msg || c.test })));
    return;
  }

  const result = await orchestrator.run(ficha, disenoAprobado);
  if (result.success) renderDashboard(result);
  return result;
};

window._fileStores = { kml: [], tenencia: [], personeria: [], confis: [], cotizaciones: [] };

function gatherFormData() {
  const selectedODS = Array.from(document.querySelectorAll('.ods-item input:checked')).map(i => parseInt(i.closest('.ods-item').dataset.ods));
  const smartRows = Array.from(document.querySelectorAll('#smart-tbody tr')).map(tr => {
    const inputs = tr.querySelectorAll('input');
    return { indicador: inputs[0]?.value || '', valor_actual: inputs[1]?.value || '', meta: inputs[2]?.value || '', unidad: inputs[3]?.value || '' };
  }).filter(r => r.indicador);
  const insumos = Array.from(document.querySelectorAll('#insumos-tbody tr')).map(tr => {
    const inputs = tr.querySelectorAll('input');
    return { item: inputs[0]?.value || '', descripcion: inputs[1]?.value || '', unidad: inputs[2]?.value || '', cantidad: parseFloat(inputs[3]?.value) || 0, precio_unitario: parseFloat(inputs[4]?.value) || 0 };
  }).filter(r => r.descripcion);
  const latLngStr = document.getElementById('lat_lng')?.value?.trim() || '';
  let lat_lng = null;
  if (latLngStr) { const parts = latLngStr.split(',').map(p => p.trim()); if (parts.length === 2) lat_lng = { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) }; }
  const mecanismo = document.querySelector('input[name="mecanismo"]:checked')?.value || 'inversion_directa';
  const isOxi = mecanismo === 'oxi';
  return {
    metadata: { user_type: document.getElementById('user_type')?.value || '', sector: document.getElementById('sector')?.value || '', metodologia: isOxi ? 'oxi' : 'inversion_directa', mecanismo, is_oxi: isOxi, oxi_modality: isOxi ? document.getElementById('oxi_modality')?.value || null : null },
    geography: { departamento: document.getElementById('depto')?.value || '', municipio: document.getElementById('municipio')?.value || '', vereda: document.getElementById('vereda')?.value || '', lat_lng, is_zomac_pdet: document.getElementById('is_zomac')?.checked || document.getElementById('is_pdet')?.checked, territorialidad: { zomac: document.getElementById('is_zomac')?.checked || false, pdet: document.getElementById('is_pdet')?.checked || false, frontera: document.getElementById('is_frontera')?.checked || false, territorio_indigena: document.getElementById('is_territorio_indigena')?.checked || false }, kml_file: window._fileStores?.kml?.[0]?.name || null },
    population: { total: parseInt(document.getElementById('poblacion_total')?.value) || 0, beneficiarios_directos: parseInt(document.getElementById('beneficiarios_directos')?.value) || 0, caracterizacion: Array.from(document.querySelectorAll('#modulo-4 input[type="checkbox"]:checked')).map(c => c.value) },
    technical_core: { problem_statement: document.getElementById('problem_statement')?.value || '', root_cause: document.getElementById('root_cause')?.value || '', expected_effect: document.getElementById('expected_effect')?.value || '', intervention_nature: document.getElementById('intervention_nature')?.value || '', construction_system: document.getElementById('construction_system')?.value || 'Convencional', intervention_description: document.getElementById('intervention_desc')?.value || '', smart_indicators: smartRows, ods_goals: selectedODS, bill_of_materials: insumos },
    attachments: { tenencia: window._fileStores?.tenencia?.[0]?.name || null, personeria: window._fileStores?.personeria?.[0]?.name || null, confis_certificate: window._fileStores?.confis?.[0]?.name || null, cotizaciones: (window._fileStores?.cotizaciones || []).map(f => f.name) }
  };
}

function showBlockingErrors(blocking) {
  let overlay = document.getElementById('blocking-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'blocking-overlay'; overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;'; document.body.appendChild(overlay); }
  overlay.innerHTML = `<div style="background:#1a1d27;border:2px solid #ef4444;border-radius:16px;padding:32px;max-width:500px;text-align:center"><div style="font-size:48px;margin-bottom:16px">⛔</div><h2 style="color:#ef4444;margin-bottom:16px">Pipeline Bloqueado</h2><ul style="text-align:left;color:#f1f5f9;font-size:14px;line-height:1.8;padding-left:20px">${blocking.map(e => `<li>${e.msg}</li>`).join('')}</ul><button onclick="document.getElementById('blocking-overlay').style.display='none'" style="margin-top:24px;background:#ef4444;color:#fff;border:none;padding:12px 32px;border-radius:8px;cursor:pointer;font-weight:700">Cerrar</button></div>`;
  overlay.style.display = 'flex';
}

function formatCurrency(n) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n); }

function renderDashboard(result) {
  const b = result.borrador, e = result.evaluation;
  const area = document.getElementById('results-area');
  if (!area) return;
  area.innerHTML = `
    <div class="result-card"><div class="result-card__header"><span class="result-card__agent-badge badge--052">AGT-052</span><span class="result-card__title">${b.componente_administrativo.titulo}</span></div><div class="result-card__body"><p><strong>Sector:</strong> ${b.componente_administrativo.sector}</p><p><strong>Normativa:</strong> ${b.componente_administrativo.normativa_aplicable}</p><p><strong>Mecanismo:</strong> ${b.componente_administrativo.mecanismo}</p><p><strong>Territorialidad:</strong> ${b.componente_administrativo.territorialidad}</p><p style="margin-top:12px;padding:12px;background:var(--divider);border-radius:var(--radius-md);font-size:13px;line-height:1.6">${b.componente_administrativo.justificacion_legal}</p></div></div>
    <div class="result-card"><div class="result-card__header"><span class="result-card__agent-badge badge--053">AGT-053</span><span class="result-card__title">${b.componente_operativo.titulo}</span></div><div class="result-card__body"><div class="budget-grid"><div class="budget-item"><div class="budget-item__label">Costo Directo</div><div class="budget-item__value">${formatCurrency(b.componente_operativo.resumen_financiero.costo_directo)}</div></div><div class="budget-item"><div class="budget-item__label">AIU (25%)</div><div class="budget-item__value">${formatCurrency(b.componente_operativo.resumen_financiero.aiu_25)}</div></div><div class="budget-item"><div class="budget-item__label">IVA sobre AIU</div><div class="budget-item__value">${formatCurrency(b.componente_operativo.resumen_financiero.iva_sobre_aiu)}</div></div><div class="budget-item budget-item--total"><div class="budget-item__label">Presupuesto Total</div><div class="budget-item__value">${formatCurrency(b.componente_operativo.resumen_financiero.presupuesto_total)}</div></div></div></div></div>
    <div class="result-card"><div class="result-card__header"><span class="result-card__agent-badge badge--054">AGT-054</span><span class="result-card__title">${b.componente_riesgos.titulo}</span></div><div class="result-card__body"><p><strong>Riesgo Global:</strong> <span class="risk-badge risk-badge--${b.componente_riesgos.riesgo_global.toLowerCase()}">${b.componente_riesgos.riesgo_global}</span></p><table class="risk-table"><thead><tr><th>Categoría</th><th>Tipo</th><th>Prob.</th><th>Impacto</th><th>Nivel</th><th>Mitigación</th></tr></thead><tbody>${b.componente_riesgos.riesgos.map(r => `<tr><td>${r.categoria}</td><td><strong>${r.tipo}</strong></td><td>${r.probabilidad}</td><td>${r.impacto}</td><td><span class="risk-badge risk-badge--${r.nivel_riesgo.toLowerCase()}">${r.nivel_riesgo}</span></td><td style="font-size:12px">${r.mitigacion}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="result-card" style="border-color:${e.aprobado ? 'var(--status-success)' : 'var(--status-error)'}"><div class="result-card__header" style="background:${e.aprobado ? 'var(--status-success-glow)' : 'var(--status-error-glow)'}"><span class="result-card__agent-badge badge--056">AGT-056</span><span class="result-card__title">${e.titulo}</span></div><div class="result-card__body"><div class="eval-score"><div class="eval-score__ring"><svg width="80" height="80" viewBox="0 0 80 80"><circle class="ring-bg" cx="40" cy="40" r="36"/><circle class="ring-fill" cx="40" cy="40" r="36" style="stroke-dashoffset:${(1 - e.porcentaje / 100) * 226.2};stroke:${e.aprobado ? 'var(--status-success)' : 'var(--status-error)'}"/></svg><div class="eval-score__value" style="color:${e.aprobado ? 'var(--status-success)' : 'var(--status-error)'}">${e.porcentaje}%</div></div><div class="eval-score__label">${e.veredicto}<span>${e.puntaje}/${e.puntaje_maximo} puntos</span></div></div><ul class="check-list">${e.checks.map(c => `<li class="check-item check-item--${c.pass ? 'pass' : 'fail'}">${c.pass ? '✅' : '❌'} ${c.test}${c.msg ? ` — ${c.msg}` : ''}</li>`).join('')}</ul></div></div>
  `;
}

function handleFiles(files, type) { Array.from(files).forEach(file => { window._fileStores[type].push(file); renderAttachments(type); }); }
function renderAttachments(type) { const list = document.getElementById('list-' + type); if (!list) return; list.innerHTML = ''; window._fileStores[type].forEach((file, idx) => { const item = document.createElement('div'); item.className = 'attachment-item'; item.innerHTML = `<span class="attachment-item__name">${file.name} (${(file.size / 1024).toFixed(1)} KB)</span><button class="attachment-item__remove" onclick="removeFile('${type}',${idx})">✕</button>`; list.appendChild(item); }); }
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
