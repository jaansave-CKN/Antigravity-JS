import { useState, useRef, useEffect, useCallback } from 'react';
import './ContextoPage.css';
import {
  type ContextoProblema,
  type AuditAlerta,
  type ResultadoAuditoria,
  auditarContexto,
  pulidorVoz,
  CAMPO_LABELS,
} from '../agents/Radford360_Agent';
import { http } from '../lib/apiClient';

const STORAGE_KEY = 'radar360_contexto_problema';
const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

const CAMPOS_CONFIG: Array<{
  key: keyof ContextoProblema;
  letra: string;
  nombre: string;
  placeholder: string;
  full?: boolean;
}> = [
  {
    key: 'A_diagnostico', letra: 'A', nombre: 'Diagnóstico del Problema',
    placeholder: 'Describa con precisión el problema central, sus causas raíz (estructurales, institucionales, culturales) y los efectos observables sobre la población objetivo. Evite descripciones vagas: incluya contexto geográfico, magnitud estimada y evidencia disponible.',
  },
  {
    key: 'B_kpis', letra: 'B', nombre: 'Indicadores Clave de Desempeño (KPIs)',
    placeholder: 'Liste los indicadores cuantificables que permitirán medir el avance y el resultado. Cada KPI debe incluir: nombre del indicador, unidad de medida, línea base y meta. Ejemplo: "Tasa de cobertura de agua potable (%): LB=42%, meta=75%".',
  },
  {
    key: 'C_meta', letra: 'C', nombre: 'Objetivo de Resultados · Meta SMART',
    placeholder: 'Formule el objetivo de resultado como una meta SMART: Específica, Medible, Alcanzable, Relevante y con plazo Temporal. Ejemplo: "Al 31 de diciembre de 2027, el 80% de los hogares rurales del municipio X contarán con acceso certificado a agua potable".',
  },
  {
    key: 'D_alineacion', letra: 'D', nombre: 'Alineación Estratégica y Teoría del Cambio',
    placeholder: 'Justifique la prioridad de esta intervención con base en: ODS aplicables, marco normativo nacional/sectorial, planes de desarrollo vigentes y cadena lógica de cambio (inputs → outputs → outcomes → impacto). Evite justificaciones basadas en opinión.',
  },
  {
    key: 'E_pertinencia', letra: 'E', nombre: 'Pertinencia y Gobernanza Local',
    placeholder: 'Evalúe la viabilidad cultural, la legitimidad social y la aceptación institucional de la intervención. Identifique actores clave, nivel de organización comunitaria, antecedentes de intervenciones similares y mecanismos de participación previstos.',
  },
  {
    key: 'F_priorizacion', letra: 'F', nombre: 'Priorización Crítica · Análisis de Sensibilidad',
    placeholder: 'Diferencie entre lo urgente (condición de emergencia que exige respuesta inmediata) y lo estratégico (inversión con retorno de largo plazo). Incluya análisis de sensibilidad: ¿qué variables críticas, si cambian, modifican sustancialmente el resultado esperado?',
  },
  {
    key: 'G_logistica', letra: 'G', nombre: 'Viabilidad Logística y Restricciones Operativas',
    placeholder: 'Identifique los cuellos de botella que podrían comprometer la ejecución: limitaciones de capacidad institucional, acceso geográfico, cadena de suministro, recursos humanos especializados, restricciones normativas o ambientales. Para cada restricción, indique la estrategia de mitigación.',
    full: true,
  },
];

// ── Hook de voz por campo ──────────────────────────────────────────────────────
function useVoiceField(onAppend: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const recRef = useRef<any>(null);

  const toggle = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Tu navegador no soporta reconocimiento de voz. Usa Chrome.'); return; }

    if (recording) {
      recRef.current?.stop();
      setRecording(false);
      return;
    }

    const rec = new SR();
    rec.lang = 'es-CO';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
      }
      if (finalText.trim()) {
        const pulido = pulidorVoz(finalText.trim());
        onAppend(pulido);
      }
    };
    rec.onerror = () => setRecording(false);
    rec.onend   = () => setRecording(false);
    rec.start();
    recRef.current = rec;
    setRecording(true);
  }, [recording, onAppend]);

  useEffect(() => () => { recRef.current?.stop(); }, []);

  return { recording, toggle };
}

// ── Sub-componente: Tarjeta de Campo ─────────────────────────────────────────
interface FieldCardProps {
  cfg: typeof CAMPOS_CONFIG[0];
  value: string;
  onChange: (v: string) => void;
  alertas: AuditAlerta[];
  auditado: boolean;
}

function FieldCard({ cfg, value, onChange, alertas, auditado }: FieldCardProps) {
  const fieldAlertas = alertas.filter(a => a.campo === cfg.key);
  const tieneBloqueo  = fieldAlertas.some(a => a.nivel === 'bloqueo');
  const tieneWarning  = fieldAlertas.some(a => a.nivel === 'advertencia');

  const cardClass = [
    'ctx__field-card',
    cfg.full ? 'ctx__field--full' : '',
    auditado && value.length >= 40 && !tieneBloqueo && !tieneWarning ? 'ctx__field-card--ok'  : '',
    auditado && tieneWarning && !tieneBloqueo                         ? 'ctx__field-card--warn': '',
    auditado && tieneBloqueo                                          ? 'ctx__field-card--error': '',
  ].filter(Boolean).join(' ');

  const handleAppend = useCallback((text: string) => {
    onChange(value ? value + ' ' + text : text);
  }, [value, onChange]);

  const { recording, toggle } = useVoiceField(handleAppend);

  const badgeLabel = auditado
    ? tieneBloqueo  ? 'ERROR'
    : tieneWarning ? 'REVISAR'
    : value.length >= 40 ? 'OK' : 'INCOMPLETO'
    : '';
  const badgeCls = tieneBloqueo ? 'ctx__field-badge--err' : tieneWarning ? 'ctx__field-badge--warn' : 'ctx__field-badge--ok';

  return (
    <div className={cardClass}>
      <div className="ctx__field-header">
        <div className="ctx__field-letra">{cfg.letra}</div>
        <div className="ctx__field-name">{cfg.nombre}</div>
        {auditado && badgeLabel && (
          <span className={`ctx__field-badge ${badgeCls}`}>{badgeLabel}</span>
        )}
      </div>

      <div className="ctx__field-body">
        <textarea
          className="ctx__textarea"
          placeholder={cfg.placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={5}
        />
        <button
          className={`ctx__mic-btn ${recording ? 'ctx__mic-btn--active' : ''}`}
          onClick={toggle}
          title={recording ? 'Detener grabación' : 'Dictar con micrófono'}
          type="button"
        >
          <span className="material-symbols-outlined">
            {recording ? 'mic_off' : 'mic'}
          </span>
        </button>
      </div>

      {recording && (
        <div className="ctx__field-hint">
          Escuchando… hable con claridad. Radford360 pulirá el lenguaje al finalizar.
        </div>
      )}
    </div>
  );
}

// ── Sub-componente: Panel de Auditoría ───────────────────────────────────────
interface AuditPanelProps { resultado: ResultadoAuditoria | null; auditado: boolean; }

function ConsistRow({ codigo, label, alertas }: { codigo: string; label: string; alertas: AuditAlerta[] }) {
  const rel = alertas.filter(a => a.codigo === codigo || a.codigo === `${codigo}-ADV`);
  const estado = rel.length === 0 ? 'ok' : rel.some(a => a.nivel === 'bloqueo') ? 'err' : 'warn';
  const chip = estado === 'ok' ? 'OK' : estado === 'err' ? 'INCONSISTENTE' : 'DÉBIL';
  return (
    <div className="ctx__consistencia-row">
      <span className="ctx__consist-label">{label}</span>
      <span className="ctx__consist-desc">
        {estado === 'ok' ? 'Coherencia temática verificada' : rel[0]?.mensaje?.slice(0, 80) + '…'}
      </span>
      <span className={`ctx__consist-chip ctx__consist-chip--${estado}`}>{chip}</span>
    </div>
  );
}

function AuditPanel({ resultado, auditado }: AuditPanelProps) {
  if (!auditado || !resultado) {
    return (
      <div className="ctx__audit">
        <div className="ctx__audit-header">
          <span className="material-symbols-outlined">policy</span>
          <span className="ctx__audit-title">Auditoría Radford360 · Nivel ONU</span>
          <span style={{ fontSize: 11, color: 'rgba(0,232,255,0.5)', fontStyle: 'italic' }}>
            Complete los campos para activar la auditoría de consistencia
          </span>
        </div>
      </div>
    );
  }

  const estado = resultado.aprobado ? 'aprobado'
    : resultado.alertas.some(a => a.nivel === 'bloqueo') ? 'bloqueado'
    : 'advertencia';

  const iconoEstado = estado === 'aprobado' ? 'verified' : estado === 'bloqueado' ? 'gpp_bad' : 'warning';

  return (
    <div className={`ctx__audit ctx__audit--${estado}`}>
      <div className="ctx__audit-header">
        <span className="material-symbols-outlined">{iconoEstado}</span>
        <span className="ctx__audit-title">Auditoría Radford360 · Nivel ONU</span>
        <span className="ctx__audit-score">{resultado.puntaje}<span>/100</span></span>
      </div>

      <div className="ctx__audit-body">
        {/* Resumen */}
        <div className={`ctx__audit-resumen ctx__audit-resumen--${estado}`}>
          {resultado.resumen}
        </div>

        {/* Consistencia entre pilares */}
        <ConsistRow codigo="A-B" label="A ↔ B" alertas={resultado.alertas} />
        <ConsistRow codigo="A-C" label="A ↔ C" alertas={resultado.alertas} />
        <ConsistRow codigo="B-C" label="B ↔ C" alertas={resultado.alertas} />

        {/* Alertas detalladas */}
        {resultado.alertas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {resultado.alertas.map((alerta, i) => (
              <div key={i} className={`ctx__alerta ctx__alerta--${alerta.nivel}`}>
                <span className="material-symbols-outlined ctx__alerta-icon">
                  {alerta.nivel === 'bloqueo' ? 'block' : alerta.nivel === 'advertencia' ? 'warning' : 'info'}
                </span>
                <div className="ctx__alerta-content">
                  <strong>[{alerta.codigo}] {CAMPO_LABELS[alerta.campo as keyof ContextoProblema] ?? alerta.campo}</strong>
                  <p>{alerta.mensaje}</p>
                  <p className="ctx__alerta-accion">Acción requerida: {alerta.accion}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────
const VACIO: ContextoProblema = {
  A_diagnostico: '', B_kpis: '', C_meta: '',
  D_alineacion: '', E_pertinencia: '', F_priorizacion: '', G_logistica: '',
};

export default function ContextoPage() {
  const [campos, setCampos] = useState<ContextoProblema>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : VACIO;
    } catch { return VACIO; }
  });

  const [resultado, setResultado]   = useState<ResultadoAuditoria | null>(null);
  const [auditado,  setAuditado]    = useState(false);
  const [guardado,  setGuardado]    = useState(false);
  const [auditando, setAuditando]   = useState(false);
  const [guardando, setGuardando]   = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [limpiadoFlash, setLimpiadoFlash] = useState(false);

  // MANDATO (2026-08-24, "indicador de cambios sin guardar", todas las
  // ventanas del Formulador) — dirty-tracking real por comparación de
  // snapshot, mismo patrón que EntradaPage.tsx: evita el falso positivo de
  // pintar el botón en rojo apenas carga la página (antes `guardado` sólo
  // arrancaba en `false` sin saber si `campos` YA era lo último guardado).
  const ultimoGuardadoRef = useRef<string | null>(null);
  if (ultimoGuardadoRef.current === null) ultimoGuardadoRef.current = JSON.stringify(campos);
  const sinGuardar = JSON.stringify(campos) !== ultimoGuardadoRef.current;

  const setCampo = useCallback((key: keyof ContextoProblema, val: string) => {
    setCampos(prev => ({ ...prev, [key]: val }));
    setAuditado(false);
  }, []);

  const handleAudit = useCallback(() => {
    setAuditando(true);
    setTimeout(() => {
      const res = auditarContexto(campos);
      setResultado(res);
      setAuditado(true);
      setAuditando(false);
    }, 400);
  }, [campos]);

  const handleGuardar = useCallback(async () => {
    if (!resultado?.aprobado) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(campos));

    const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (!proyectoId) { ultimoGuardadoRef.current = JSON.stringify(campos); setGuardado(true); return; } // sin proyecto activo — solo cache local

    setGuardando(true);
    setErrorGuardar(null);
    try {
      // Merge atómico en el servidor (lee ficha_tecnica y escribe la clave
      // contexto_narrativo en una sola petición) — reemplaza el GET+PATCH en
      // dos pasos que mantenía una copia de ficha_tecnica en el navegador
      // durante toda la sesión de edición, acortando la ventana de carrera
      // si el mismo proyecto se edita desde dos pestañas a la vez.
      await http.patch(`/api/proyectos/${proyectoId}/ficha-tecnica-merge`, { key: 'contexto_narrativo', value: campos });
      ultimoGuardadoRef.current = JSON.stringify(campos);
      setGuardado(true);
    } catch {
      setErrorGuardar('No se pudo guardar el contexto en el servidor — se guardó localmente.');
    } finally {
      setGuardando(false);
    }
  }, [campos, resultado]);

  const handleLimpiar = useCallback(() => {
    if (!confirm('¿Desea borrar todos los campos? Esta acción no se puede deshacer.')) return;
    setCampos(VACIO);
    setResultado(null);
    setAuditado(false);
    setGuardado(false);
    localStorage.removeItem(STORAGE_KEY);
    setLimpiadoFlash(true);
    setTimeout(() => setLimpiadoFlash(false), 2000);
  }, []);

  // Auto-auditar cuando todos los campos A-C tienen contenido suficiente
  useEffect(() => {
    const { A_diagnostico, B_kpis, C_meta } = campos;
    if (A_diagnostico.length > 60 && B_kpis.length > 60 && C_meta.length > 60) {
      const res = auditarContexto(campos);
      setResultado(res);
      setAuditado(true);
    }
  }, [campos]);

  const totalChars = Object.values(campos).join('').length;
  const camposCompletos = Object.values(campos).filter(v => v.length >= 40).length;

  return (
    <div className="ctx__wrap">
      {/* Header */}
      <div className="ctx__header">
        <div className="ctx__header-left">
          <h1 className="ctx__title">
            <span className="material-symbols-outlined">manage_search</span>
            Módulo — Contexto del Problema
          </h1>
          <p className="ctx__subtitle">
            {camposCompletos}/7 campos completados · {totalChars} caracteres · Auditoría de doble entrada A↔B↔C
          </p>
        </div>
        <div className="ctx__header-right">
          <div className="ctx__topbar-right">
            <button
              className={`ctx__clear${limpiadoFlash ? ' ctx__clear--done' : ''}`}
              onClick={handleLimpiar}
              type="button"
            >
              {limpiadoFlash ? '✓ LIMPIADO' : 'LIMPIAR'}
            </button>
            <button
              className={`ctx__save${sinGuardar ? ' ctx__save--dirty' : ' ctx__save--saved'}`}
              onClick={handleGuardar}
              disabled={!resultado?.aprobado || guardando}
              title={!resultado?.aprobado ? 'Audita y aprueba el contexto (botón "Auditar consistencia" más abajo) antes de guardar' : sinGuardar ? 'Hay cambios sin guardar' : undefined}
              type="button"
            >
              {guardando ? 'Guardando…' : sinGuardar ? 'SAVE' : '✓ GUARDADO'}
            </button>
          </div>
          <div className="ctx__radford-badge">
            <div className="ctx__radford-dot" />
            Radford360 · Auditor ONU
          </div>
        </div>
      </div>

      <div className="ctx__content">
      {/* Grid de campos */}
      <div className="ctx__grid">
        {CAMPOS_CONFIG.map(cfg => (
          <FieldCard
            key={cfg.key}
            cfg={cfg}
            value={campos[cfg.key]}
            onChange={v => setCampo(cfg.key, v)}
            alertas={resultado?.alertas ?? []}
            auditado={auditado}
          />
        ))}
      </div>

      {/* Panel de auditoría */}
      <AuditPanel resultado={resultado} auditado={auditado} />

      {/* Acciones */}
      <div className="ctx__actions">
        {guardado && (
          <span className="ctx__saved-msg">
            <span className="material-symbols-outlined">check_circle</span>
            Contexto guardado correctamente
          </span>
        )}
        {errorGuardar && (
          <span className="ctx__saved-msg" style={{ color: '#ba1a1a' }} role="alert">
            {errorGuardar}
          </span>
        )}
        <button className="ctx__btn ctx__btn--ghost" onClick={handleLimpiar} type="button">
          <span className="material-symbols-outlined">delete_sweep</span>
          Limpiar
        </button>
        {!auditado && (
          <button
            className="ctx__btn ctx__btn--primary"
            onClick={handleAudit}
            disabled={auditando || totalChars < 100}
            type="button"
          >
            <span className="material-symbols-outlined">policy</span>
            {auditando ? 'Auditando…' : 'Auditar consistencia'}
          </button>
        )}
        {auditado && resultado && (
          <button
            className={`ctx__btn ${resultado.aprobado ? 'ctx__btn--success' : 'ctx__btn--primary'}`}
            onClick={resultado.aprobado ? handleGuardar : handleAudit}
            disabled={guardando}
            type="button"
          >
            <span className="material-symbols-outlined">
              {resultado.aprobado ? 'save' : 'refresh'}
            </span>
            {resultado.aprobado ? (guardando ? 'Guardando…' : 'Guardar Contexto') : 'Re-auditar'}
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
