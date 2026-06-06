import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

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

  const [data, setData]     = useState<ComplianceData>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [normas, setNormas] = useState<any[]>([]);
  const [genNormas, setGenNormas] = useState(false);
  const [normasErr, setNormasErr] = useState<string | null>(null);

  const update = <K extends keyof ComplianceData>(key: K, value: ComplianceData[K]) => {
    setData(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const toggleOds = (n: number) => {
    const curr = data.odsAlineados;
    update('odsAlineados', curr.includes(n) ? curr.filter(x => x !== n) : [...curr, n]);
  };

  const handleSave = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 500));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleGenerarNormas = async () => {
    if (!token || token === 'demo-mode-token') {
      setNormasErr('Inicia sesión para generar el marco normativo automático.');
      return;
    }
    setGenNormas(true);
    setNormasErr(null);
    try {
      const r = await fetch('/api/m8/normas/generar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sector: 'General', municipio: 'Colombia' }),
      });
      const d = await r.json();
      if (d.success) setNormas(d.data?.normas_aplicables || []);
      else setNormasErr(d.message || 'Error generando normas');
    } catch { setNormasErr('Sin conexión con el servidor'); }
    finally { setGenNormas(false); }
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
              onClick={() => navigate('/formulador')}
              style={{ background: 'transparent', border: '1px solid #1a3a50', borderRadius: 6, padding: '5px 10px', color: '#557997', fontSize: 10, fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase' }}
            >
              ← Formulador
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

          {/* Sección: Sostenibilidad ambiental */}
          <Section label="Sostenibilidad Ambiental" icon="🌱" color="#22c55e">
            <textarea
              style={{ ...textareaStyle }}
              value={data.sostenibilidadAmbiental}
              onChange={e => update('sostenibilidadAmbiental', e.target.value)}
              placeholder="¿Cómo garantiza el proyecto un impacto ambiental neutro o positivo? Ej: implementación de manejo de residuos, reducción de emisiones, forestación..."
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
                {normas.map((n: any, i: number) => (
                  <div key={i} style={{ background: '#001524', border: '1px solid #0d2a3d', borderRadius: 8, padding: '10px 14px' }}>
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
