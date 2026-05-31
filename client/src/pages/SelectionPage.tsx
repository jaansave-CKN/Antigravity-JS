import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';

// ── Verificación de estado del sistema ────────────────────────────────────────
function useSystemStatus() {
  const [status, setStatus] = useState<'checking' | 'online' | 'degraded'>('checking');

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
        setStatus(r.ok ? 'online' : 'degraded');
      } catch {
        setStatus('degraded');
      }
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  return status;
}

// ── Módulos disponibles ───────────────────────────────────────────────────────
const MODULES = [
  {
    id: 'radar',
    icon: '◎',
    tag: 'MÓDULO A',
    title: 'Radar 360',
    subtitle: 'Inteligencia de fondos',
    description:
      'Monitoreo en tiempo real de convocatorias, entidades financiadoras y señales de oportunidad. Búsqueda avanzada asistida por IA con alertas automáticas y análisis predictivo.',
    badge: 'EN LÍNEA',
    badgeColor: '#16a34a',
    badgeBg: '#dcfce7',
    route: '/radar',
    features: ['Convocatorias activas', 'Mapa de entidades', 'Alertas automáticas', 'Chat IA integrado'],
    accent: '#0058be',
    accentBg: '#f0f4ff',
  },
  {
    id: 'formulador',
    icon: '◧',
    tag: 'MÓDULO B',
    title: 'Formulador',
    subtitle: 'Estructuración de proyectos',
    description:
      'Redacción asistida de propuestas técnicas, marcos lógicos y presupuestos de inversión. Integra directamente las señales del Radar en tus documentos de proyecto.',
    badge: 'DESARROLLO',
    badgeColor: '#92400e',
    badgeBg: '#fef3c7',
    route: '/formulador',
    features: ['Asistente IA de redacción', 'Plantillas por fondo', 'Marco lógico automático', 'Exportación PDF/Word'],
    accent: '#7c3aed',
    accentBg: '#f5f3ff',
  },
] as const;

// ── Componente principal ──────────────────────────────────────────────────────
export default function SelectionPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const sysStatus = useSystemStatus();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ minHeight: 'calc(100vh - 48px)', background: '#f7f9fb', display: 'flex', flexDirection: 'column' }}>

      {/* ── Hero header ─────────────────────────────────────────────────────── */}
      <div style={{
        background: '#191c1e',
        padding: '2.5rem 2rem 2rem',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Grid pattern background */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: 860, margin: '0 auto', position: 'relative' }}>
          {/* Top row: eyebrow + system status */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.75rem', flexWrap: 'wrap', gap: 12 }}>
            <p style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: '#6b7280', letterSpacing: '0.2em', textTransform: 'uppercase', margin: 0 }}>
              Plataforma EGIOC5 · GGIE
            </p>
            <SystemStatusPill status={sysStatus} />
          </div>

          {/* Main heading */}
          <h1 style={{
            fontSize: 'clamp(22px, 4vw, 32px)',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.025em',
            margin: '0 0 10px',
            lineHeight: 1.15,
          }}>
            RadarFondos 360
          </h1>
          <p style={{ fontSize: 14, color: '#9ca3af', margin: '0 0 1.5rem', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
            {user?.nombre
              ? `Bienvenido, ${user.nombre.split(' ')[0]}. Selecciona el espacio de trabajo.`
              : 'Sistema institucional de inteligencia de fondos y formulación. Selecciona tu módulo.'}
          </p>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            {[
              { label: 'MÓDULOS', value: '2' },
              { label: 'DATOS COMPARTIDOS', value: '✓' },
              { label: 'SESIÓN ACTIVA', value: user ? '✓' : 'DEMO' },
            ].map(s => (
              <div key={s.label}>
                <p style={{ fontSize: 9, fontFamily: 'monospace', color: '#6b7280', letterSpacing: '0.15em', textTransform: 'uppercase', margin: '0 0 2px' }}>{s.label}</p>
                <p style={{ fontSize: 13, fontFamily: 'monospace', color: '#e5e7eb', fontWeight: 700, margin: 0 }}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Cards grid ──────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        maxWidth: 860,
        width: '100%',
        margin: '0 auto',
        padding: '2rem 1.5rem',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1.5rem',
        alignContent: 'start',
      }}>
        {MODULES.map((mod, i) => (
          <ModuleCard
            key={mod.id}
            mod={mod}
            delay={i * 80}
            visible={mounted}
            onSelect={() => navigate(mod.route)}
          />
        ))}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div style={{ padding: '1rem 2rem 1.5rem', textAlign: 'center' }}>
        <p style={{ fontSize: 10, fontFamily: 'monospace', color: '#c6c6cd', letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          RadarFondos · EGIOC5 Platform · {new Date().getFullYear()} · Todos los módulos comparten credenciales y datos de sesión
        </p>
      </div>
    </div>
  );
}

// ── Pill de estado del sistema ────────────────────────────────────────────────
function SystemStatusPill({ status }: { status: 'checking' | 'online' | 'degraded' }) {
  const cfg = {
    checking: { dot: '#6b7280', text: 'Verificando sistema...', bg: '#374151' },
    online:   { dot: '#22c55e', text: 'Sistema activo',        bg: '#14532d33' },
    degraded: { dot: '#f59e0b', text: 'Modo offline',          bg: '#78350f33' },
  }[status];

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      background: cfg.bg, border: `1px solid ${cfg.dot}33`,
      borderRadius: 20, padding: '5px 12px',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: cfg.dot,
        boxShadow: status === 'online' ? `0 0 6px ${cfg.dot}` : 'none',
        animation: status === 'online' ? 'pulse 2s ease-in-out infinite' : 'none',
      }} />
      <span style={{ fontSize: 10, fontFamily: 'monospace', color: cfg.dot, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {cfg.text}
      </span>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
    </div>
  );
}

// ── Tarjeta de módulo ─────────────────────────────────────────────────────────
function ModuleCard({
  mod, delay, visible, onSelect,
}: {
  mod: typeof MODULES[number];
  delay: number;
  visible: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#fff',
        border: `1.5px solid ${hovered ? mod.accent : '#e2e4e7'}`,
        borderRadius: 18,
        padding: '1.75rem',
        textAlign: 'left',
        cursor: 'pointer',
        outline: 'none',
        width: '100%',
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        opacity: visible ? 1 : 0,
        transition: `transform 0.4s ease ${delay}ms, opacity 0.4s ease ${delay}ms, border-color 0.15s, box-shadow 0.15s`,
        boxShadow: hovered ? `0 8px 32px ${mod.accent}22` : '0 1px 4px rgba(0,0,0,0.05)',
      }}
    >
      {/* Tag + Badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          {mod.tag}
        </span>
        <span style={{
          fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          color: mod.badgeColor, background: mod.badgeBg,
          padding: '3px 9px', borderRadius: 4,
        }}>
          {mod.badge}
        </span>
      </div>

      {/* Icon */}
      <div style={{
        width: 56, height: 56,
        background: mod.accentBg, borderRadius: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, color: mod.accent, fontFamily: 'monospace',
        marginBottom: '1.25rem',
        transition: 'transform 0.2s',
        transform: hovered ? 'scale(1.08)' : 'scale(1)',
      }}>
        {mod.icon}
      </div>

      {/* Text */}
      <p style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.15em', textTransform: 'uppercase', margin: '0 0 4px' }}>
        {mod.subtitle}
      </p>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: '#191c1e', margin: '0 0 10px', letterSpacing: '-0.02em' }}>
        {mod.title}
      </h2>
      <p style={{ fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.65, fontFamily: 'system-ui, sans-serif' }}>
        {mod.description}
      </p>

      {/* Features */}
      <ul style={{ listStyle: 'none', margin: '1.25rem 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {mod.features.map(f => (
          <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, background: mod.accentBg, color: mod.accent, fontSize: 10, fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>○</span>
            <span style={{ fontSize: 12, color: '#45464d', fontFamily: 'system-ui, sans-serif' }}>{f}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div style={{ marginTop: '1.75rem', display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid #f2f4f6', paddingTop: '1.25rem' }}>
        <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: mod.accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Ingresar al módulo
        </span>
        <span style={{ fontSize: 14, color: mod.accent, transition: 'transform 0.15s', transform: hovered ? 'translateX(4px)' : 'none', display: 'inline-block' }}>→</span>
      </div>
    </button>
  );
}
