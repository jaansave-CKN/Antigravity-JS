import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';
import { http } from '../lib/apiClient';

const ACTIVE_PROJECT_KEY = 'rf360_proyecto_activo';

interface ComplianceApi {
  riesgos?: string; sostenibilidad_ambiental?: string; sostenibilidad_social?: string;
  ods_alineados?: string; enfoque_genero?: number; enfoque_genero_texto?: string;
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Hanken+Grotesk:wght@400;600;700&display=swap');
  @keyframes m10-in { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
`;

const ODS_LIST = [
  { n: 1,  label: 'Fin de la pobreza',          color: '#e5243b' },
  { n: 2,  label: 'Hambre cero',                color: '#dda63a' },
  { n: 3,  label: 'Salud y bienestar',          color: '#4c9f38' },
  { n: 4,  label: 'Educación de calidad',       color: '#c5192d' },
  { n: 5,  label: 'Igualdad de género',         color: '#ff3a21' },
  { n: 6,  label: 'Agua limpia',                color: '#26bde2' },
  { n: 7,  label: 'Energía asequible',          color: '#fcc30b' },
  { n: 8,  label: 'Trabajo decente',            color: '#a21942' },
  { n: 9,  label: 'Industria e innovación',     color: '#fd6925' },
  { n: 10, label: 'Reducción desigualdades',    color: '#dd1367' },
  { n: 11, label: 'Ciudades sostenibles',       color: '#fd9d24' },
  { n: 12, label: 'Producción responsable',     color: '#bf8b2e' },
  { n: 13, label: 'Acción por el clima',        color: '#3f7e44' },
  { n: 14, label: 'Vida submarina',             color: '#0a97d9' },
  { n: 15, label: 'Vida de ecosistemas',        color: '#56c02b' },
  { n: 16, label: 'Paz y justicia',             color: '#00689d' },
  { n: 17, label: 'Alianzas para los ODS',      color: '#19486a' },
];

interface ComplianceData {
  sostenibilidadAmbiental: string;
  sostenibilidadSocial: string;
  odsAlineados: number[];
  enfoqueGenero: boolean;
  enfoqueGeneroTexto: string;
  riesgosIdentificados: string;
  medidasMitigacion: string;
}

const INITIAL: ComplianceData = {
  sostenibilidadAmbiental: '',
  sostenibilidadSocial: '',
  odsAlineados: [],
  enfoqueGenero: false,
  enfoqueGeneroTexto: '',
  riesgosIdentificados: '',
  medidasMitigacion: '',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px',
  background: '#001524', border: '1.5px solid #0d2a3d', borderRadius: 8,
  fontSize: 13, color: '#d1e8ff', fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
  outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
};
const textareaStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical', minHeight: 100, lineHeight: 1.6 };

export default function Modulo10Page() {
  const navigate  = useNavigate();
  const { token } = useAuth();
  const proyectoId = localStorage.getItem(ACTIVE_PROJECT_KEY);

  const [data, setData]     = useState<ComplianceData>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [cargando, setCargando] = useState(!!proyectoId);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [normas, setNormas] = useState<any[]>([]);
  const [citas, setCitas] = useState<any[]>([]);
  const [notasAdicionales, setNotasAdicionales] = useState('');
  const [genNormas, setGenNormas] = useState(false);
  const [guardandoNormas, setGuardandoNormas] = useState(false);
  // FIX (react-doctor no-async-event-handler-without-reentry-guard,
  // 2026-09-05): ninguno de los 3 handlers de guardado revisaba su propio
  // flag de estado antes de proceder.
  const savingRef = useRef(false);
  const guardandoNormasRef = useRef(false);
  const genNormasRef = useRef(false);
  const [normasGuardadas, setNormasGuardadas] = useState(false);
  const [normasErr, setNormasErr] = useState<string | null>(null);

  // Hidrata desde el servidor real — antes esta pantalla no tenía ningún
  // fetch: "Guardar M10" solo simulaba un delay de 500ms y no persistía nada,
  // pese a que GET/POST /api/m10/compliance/:proyectoId ya existían.
  useEffect(() => {
    if (!proyectoId) return;
    let cancelled = false;
    (async () => {
      try {
        const body = await http.get<{ success: boolean; data?: ComplianceApi }>(`/api/m10/compliance/${proyectoId}`);
        const row = body.data;
        if (!cancelled && row) {
          let riesgosArr: Array<{ identificados?: string; mitigacion?: string }> = [];
          try { riesgosArr = JSON.parse(row.riesgos || '[]'); } catch { /* noop */ }
          let ods: number[] = [];
          try { ods = JSON.parse(row.ods_alineados || '[]'); } catch { /* noop */ }
          setData({
            sostenibilidadAmbiental: row.sostenibilidad_ambiental || '',
            sostenibilidadSocial: row.sostenibilidad_social || '',
            odsAlineados: ods,
            enfoqueGenero: !!row.enfoque_genero,
            enfoqueGeneroTexto: row.enfoque_genero_texto || '',
            riesgosIdentificados: riesgosArr[0]?.identificados || '',
            medidasMitigacion: riesgosArr[0]?.mitigacion || '',
          });
        }
      } catch { /* sin datos previos — se queda en INITIAL */ }
      finally { if (!cancelled) setCargando(false); }
    })();
    return () => { cancelled = true; };
  }, [proyectoId]);

  // Hidrata el Marco Normativo (M8) ya guardado — antes GET /api/m8/normas/:proyectoId
  // existía en el backend pero nadie lo llamaba: cada recarga de página perdía las
  // normas generadas/editadas porque solo vivían en el estado `normas` en memoria.
  interface MarcoNormativoRow { normas_aplicables?: string; citas_bibliograficas?: string; notas_adicionales?: string }
  useEffect(() => {
    if (!proyectoId) return;
    let cancelled = false;
    (async () => {
      try {
        const body = await http.get<{ success: boolean; data?: MarcoNormativoRow }>(`/api/m8/normas/${proyectoId}`);
        if (cancelled || !body.data) return;
        try { setNormas(JSON.parse(body.data.normas_aplicables || '[]')); } catch { /* noop */ }
        try { setCitas(JSON.parse(body.data.citas_bibliograficas || '[]')); } catch { /* noop */ }
        setNotasAdicionales(body.data.notas_adicionales || '');
      } catch { /* sin marco normativo guardado aún */ }
    })();
    return () => { cancelled = true; };
  }, [proyectoId]);

  const handleGuardarNormas = async () => {
    if (!proyectoId) { setNormasErr('No hay proyecto activo — completa Entrada primero.'); return; }
    if (guardandoNormasRef.current) return;
    guardandoNormasRef.current = true;
    setGuardandoNormas(true);
    setNormasErr(null);
    try {
      await http.post(`/api/m8/normas/${proyectoId}`, {
        normas_aplicables: normas, citas_bibliograficas: citas, notas_adicionales: notasAdicionales,
      });
      setNormasGuardadas(true);
      setTimeout(() => setNormasGuardadas(false), 2200);
    } catch {
      setNormasErr('No se pudo guardar el marco normativo.');
    } finally {
      guardandoNormasRef.current = false;
      setGuardandoNormas(false);
    }
  };

  const update = <K extends keyof ComplianceData>(key: K, value: ComplianceData[K]) => {
    setData(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const toggleOds = (n: number) => {
    const curr = data.odsAlineados;
    update('odsAlineados', curr.includes(n) ? curr.filter(x => x !== n) : [...curr, n]);
  };

  const handleSave = async () => {
    if (!proyectoId) { setSaveErr('No hay proyecto activo — completa Entrada primero.'); return; }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveErr(null);
    try {
      await http.post(`/api/m10/compliance/${proyectoId}`, {
        sostenibilidad_ambiental: data.sostenibilidadAmbiental,
        sostenibilidad_social: data.sostenibilidadSocial,
        ods_alineados: data.odsAlineados,
        enfoque_genero: data.enfoqueGenero,
        enfoque_genero_texto: data.enfoqueGeneroTexto,
        riesgos: [{ identificados: data.riesgosIdentificados, mitigacion: data.medidasMitigacion }],
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setSaveErr('No se pudo guardar en el servidor — inténtalo de nuevo.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleGenerarNormas = async () => {
    if (!token || token === 'demo-mode-token') {
      setNormasErr('Inicia sesión para generar el marco normativo automático.');
      return;
    }
    if (!proyectoId) {
      setNormasErr('No hay proyecto activo — completa Entrada primero.');
      return;
    }
    if (genNormasRef.current) return;
    genNormasRef.current = true;
    setGenNormas(true);
    setNormasErr(null);
    try {
      // El backend exige proyecto_id (server.js: "proyecto_id y sector son
      // requeridos") — esta llamada nunca lo enviaba y por lo tanto SIEMPRE
      // fallaba con 400, sin importar quién estuviera logueado.
      const r = await fetch('/api/m8/normas/generar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ proyecto_id: proyectoId, sector: 'General', municipio: 'Colombia' }),
      });
      const d = await r.json();
      if (d.success) {
        setNormas(d.data?.normas_aplicables || []);
        setCitas(d.data?.citas_bibliograficas || []); // antes se descartaban silenciosamente
      } else setNormasErr(d.message || 'Error generando normas');
    } catch { setNormasErr('Sin conexión con el servidor'); }
    finally { genNormasRef.current = false; setGenNormas(false); }
  };

  const progress = [
    !!data.sostenibilidadAmbiental,
    !!data.sostenibilidadSocial,
    data.odsAlineados.length > 0,
    !!data.riesgosIdentificados,
  ].filter(Boolean).length;

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: 'calc(100vh - 48px)', background: '#00101c', display: 'flex', flexDirection: 'column' }}>

        {/* ── Header ── */}
        <div style={{
          background: '#001524', borderBottom: '1px solid #0d2a3d',
          padding: '16px 2rem', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
          animation: 'm10-in .4s ease both',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={() => navigate('/checklist')}
              style={{ background: 'transparent', border: '1px solid #1a3a50', borderRadius: 6, padding: '5px 10px', color: '#557997', fontSize: 10, fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase' }}
            >
              ← Check-List
            </button>
            <div>
              <p style={{ fontSize: 7, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#254b67', letterSpacing: '0.14em', textTransform: 'uppercase', margin: '0 0 3px' }}>
                MÓDULO B · M10
              </p>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#bdc2ff', margin: 0, letterSpacing: '-0.01em' }}>
                Compliance & Sostenibilidad
              </h1>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Barra de progreso */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 100, height: 4, background: '#0d2a3d', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(progress / 4) * 100}%`, height: '100%', background: '#bdc2ff', borderRadius: 2, transition: 'width .3s' }} />
              </div>
              <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace", color: '#557997' }}>{progress}/4</span>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: saved ? '#14532d' : saving ? '#0d2a3d' : '#2f3aa3',
                color: saved ? '#86efac' : '#e0e0ff',
                fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase', transition: 'background .2s',
              }}
            >
              {saved ? '✓ Guardado' : saving ? 'Guardando…' : '✦ Guardar M10'}
            </button>
          </div>
        </div>

        {/* ── Contenido ── */}
        <div style={{ flex: 1, padding: '2rem', maxWidth: 900, width: '100%', margin: '0 auto', animation: 'm10-in .5s ease .1s both' }}>

          {/* Bloque intro */}
          <div style={{
            background: 'rgba(189,194,255,0.05)', border: '1px solid rgba(189,194,255,0.15)',
            borderRadius: 12, padding: '14px 18px', marginBottom: '2rem',
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>⑦</span>
            <p style={{ fontSize: 13, color: '#8bafcf', fontFamily: "'Hanken Grotesk', system-ui", margin: 0, lineHeight: 1.6 }}>
              <strong style={{ color: '#bdc2ff' }}>M10 — Compliance</strong> valida la sostenibilidad del proyecto, alinea los ODS de la ONU, identifica riesgos y genera el Marco Normativo aplicable según sector y territorio.
            </p>
          </div>

          {(cargando || saveErr) && (
            <p style={{ fontSize: 11, color: saveErr ? '#f87171' : '#557997', fontFamily: "'JetBrains Mono', monospace", marginBottom: '1rem' }}>
              {saveErr || 'Cargando compliance guardado…'}
            </p>
          )}

          {/* Sección: Sostenibilidad ambiental */}
          <Section label="Sostenibilidad Ambiental" icon="🌱" color="#22c55e">
            <textarea
              style={{ ...textareaStyle }}
              value={data.sostenibilidadAmbiental}
              onChange={e => update('sostenibilidadAmbiental', e.target.value)}
              placeholder="¿Cómo garantiza el proyecto un impacto ambiental neutro o positivo? Ej: implementación de manejo de residuos, reducción de emisiones, forestación..."
              aria-label="Sostenibilidad ambiental"
              onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#22c55e44'}
              onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0d2a3d'}
            />
          </Section>

          {/* Sección: Sostenibilidad social */}
          <Section label="Sostenibilidad Social" icon="🤝" color="#38bdf8">
            <textarea
              style={textareaStyle}
              value={data.sostenibilidadSocial}
              onChange={e => update('sostenibilidadSocial', e.target.value)}
              placeholder="¿Cómo asegura el proyecto continuidad e impacto social más allá del período de financiación? Ej: comités comunitarios, transferencia de capacidades..."
              aria-label="Sostenibilidad social"
              onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#38bdf844'}
              onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0d2a3d'}
            />
          </Section>

          {/* Sección: ODS */}
          <Section label="ODS Alineados" icon="🌐" color="#bdc2ff">
            <p style={{ fontSize: 11, color: '#557997', fontFamily: "'Hanken Grotesk', system-ui", marginBottom: 14 }}>
              Selecciona los Objetivos de Desarrollo Sostenible con los que se alinea este proyecto.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ODS_LIST.map(ods => {
                const active = data.odsAlineados.includes(ods.n);
                return (
                  <button
                    key={ods.n}
                    onClick={() => toggleOds(ods.n)}
                    title={ods.label}
                    style={{
                      padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
                      fontSize: 11, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
                      border: `2px solid ${active ? ods.color : '#0d2a3d'}`,
                      background: active ? ods.color + '22' : '#001524',
                      color: active ? ods.color : '#3a5e7a',
                      transition: 'all .15s',
                    }}
                  >
                    ODS {ods.n}
                  </button>
                );
              })}
            </div>
            {data.odsAlineados.length > 0 && (
              <p style={{ fontSize: 11, color: '#bdc2ff', marginTop: 12, fontFamily: "'Hanken Grotesk', system-ui", lineHeight: 1.7 }}>
                {data.odsAlineados.sort((a, b) => a - b).map(n => ODS_LIST.find(o => o.n === n)?.label).join(' · ')}
              </p>
            )}
          </Section>

          {/* Sección: Enfoque de género */}
          <Section label="Enfoque Diferencial de Género" icon="♀" color="#f472b6">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: data.enfoqueGenero ? 14 : 0 }}>
              <button
                onClick={() => update('enfoqueGenero', !data.enfoqueGenero)}
                style={{
                  width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
                  background: data.enfoqueGenero ? '#f472b6' : '#0d2a3d', position: 'relative',
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 3, transition: 'left .2s',
                  left: data.enfoqueGenero ? 23 : 3,
                }} />
              </button>
              <span style={{ fontSize: 13, color: '#8bafcf', fontFamily: "'Hanken Grotesk', system-ui" }}>
                Este proyecto incorpora enfoque de género
              </span>
            </div>
            {data.enfoqueGenero && (
              <textarea
                style={{ ...textareaStyle, minHeight: 80, borderColor: '#f472b644' }}
                value={data.enfoqueGeneroTexto}
                onChange={e => update('enfoqueGeneroTexto', e.target.value)}
                placeholder="Describe cómo se incorpora la perspectiva de género en el diseño, ejecución y evaluación..."
                aria-label="Enfoque diferencial de género"
                onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#f472b666'}
                onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#f472b644'}
              />
            )}
          </Section>

          {/* Sección: Riesgos */}
          <Section label="Riesgos e Impactos Identificados" icon="⚠" color="#f59e0b">
            <textarea
              style={textareaStyle}
              value={data.riesgosIdentificados}
              onChange={e => update('riesgosIdentificados', e.target.value)}
              placeholder="Identifica los principales riesgos del proyecto: ambientales, sociales, financieros, institucionales..."
              aria-label="Riesgos e impactos identificados"
              onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#f59e0b44'}
              onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0d2a3d'}
            />
          </Section>

          <Section label="Medidas de Mitigación" icon="🛡" color="#22c55e">
            <textarea
              style={textareaStyle}
              value={data.medidasMitigacion}
              onChange={e => update('medidasMitigacion', e.target.value)}
              placeholder="Describe las acciones preventivas y de mitigación para cada riesgo identificado..."
              aria-label="Medidas de mitigación"
              onFocus={e => (e.target as HTMLTextAreaElement).style.borderColor = '#22c55e44'}
              onBlur={e => (e.target as HTMLTextAreaElement).style.borderColor = '#0d2a3d'}
            />
          </Section>

          {/* Sección: Marco normativo M8 */}
          <Section label="M8 — Marco Normativo Aplicable" icon="⚖" color="#60c9ff">
            <p style={{ fontSize: 11, color: '#557997', fontFamily: "'Hanken Grotesk', system-ui", marginBottom: 14 }}>
              Genera automáticamente las normas y citas bibliográficas obligatorias según sector y territorio.
            </p>
            <button
              onClick={handleGenerarNormas}
              disabled={genNormas}
              style={{
                padding: '9px 20px', background: genNormas ? '#0d2a3d' : '#001c2e',
                border: '1px solid #1a3a50', borderRadius: 8, color: genNormas ? '#557997' : '#60c9ff',
                fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
                cursor: genNormas ? 'not-allowed' : 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase',
                marginBottom: 12,
              }}
            >
              {genNormas ? 'Generando normas…' : '⚖ Generar Marco Normativo'}
            </button>
            {normasErr && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 10, fontFamily: "'Hanken Grotesk', system-ui" }}>{normasErr}</p>}
            {normas.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {normas.map((n: any) => (
                  <div key={n.codigo || JSON.stringify(n)} style={{ background: '#001524', border: '1px solid #0d2a3d', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#60c9ff', margin: '0 0 2px', fontFamily: "'JetBrains Mono', monospace" }}>{n.codigo}</p>
                      <span style={{ fontSize: 8, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, padding: '2px 8px', borderRadius: 20, textTransform: 'uppercase', background: n.relevancia === 'Alta' ? '#7f1d1d' : '#001c2e', color: n.relevancia === 'Alta' ? '#fca5a5' : '#38bdf8', border: `1px solid ${n.relevancia === 'Alta' ? '#fca5a5' : '#38bdf8'}44` }}>
                        {n.relevancia}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: '#8bafcf', margin: '0 0 2px', fontFamily: "'Hanken Grotesk', system-ui" }}>{n.nombre}</p>
                    <p style={{ fontSize: 10, color: '#3a5e7a', margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>Arts: {n.articulos}</p>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <label htmlFor="m10-notas-adicionales" style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#60c9ff', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
                Notas adicionales (edición manual)
              </label>
              <textarea
                id="m10-notas-adicionales"
                style={{ ...textareaStyle, minHeight: 70, borderColor: '#60c9ff33' }}
                value={notasAdicionales}
                onChange={e => setNotasAdicionales(e.target.value)}
                placeholder="Precisiones sobre el marco normativo aplicable no cubiertas por la generación automática..."
              />
              <button
                onClick={handleGuardarNormas}
                disabled={guardandoNormas}
                style={{
                  marginTop: 10, padding: '8px 18px',
                  background: normasGuardadas ? '#14532d' : '#001c2e', border: '1px solid #1a3a50',
                  borderRadius: 8, color: normasGuardadas ? '#86efac' : '#60c9ff',
                  fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
                  cursor: guardandoNormas ? 'not-allowed' : 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase',
                }}
              >
                {guardandoNormas ? 'Guardando…' : normasGuardadas ? '✓ Marco Normativo Guardado' : 'Guardar Marco Normativo'}
              </button>
            </div>
          </Section>

          <p style={{ textAlign: 'center', fontSize: 7, color: '#1a3a50', letterSpacing: '0.14em', textTransform: 'uppercase', paddingBottom: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            M10 Compliance · RadarFondos 360 · EGIOC5
          </p>
        </div>
      </div>
    </>
  );
}

function Section({ label, icon, color, children }: { label: string; icon: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <label style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          {label}
        </label>
      </div>
      {children}
    </div>
  );
}
