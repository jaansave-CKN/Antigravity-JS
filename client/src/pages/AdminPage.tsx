import { useEffect, useState } from 'react';
import { http, ApiError } from '../lib/apiClient';
import { POSTHOG_HOST } from '../lib/posthog';
import AdminPermisosPage from './AdminPermisosPage';

// Pura, sin estado del componente — a nivel de módulo
// (react-doctor/prefer-module-scope-pure-function).
const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')} COP`;

type Tab = 'usuarios' | 'finops' | 'telemetria' | 'wompi';

interface SystemStatus {
  sentry: 'ACTIVO' | 'STANDBY';
  posthog: 'ACTIVO' | 'STANDBY';
  stripe: 'ACTIVO' | 'STANDBY';
  wompi: 'ACTIVO' | 'STANDBY';
  resend: 'ACTIVO' | 'STANDBY';
  brevo: 'ACTIVO' | 'STANDBY';
  google_gemini: 'ACTIVO' | 'STANDBY';
  google_oauth: 'ACTIVO' | 'STANDBY';
  payment_provider_activo: string;
}

interface FinOpsData {
  totales: { tokens_input: number; tokens_output: number; costo_total_cop: number; total_requests: number };
  porAgente: { agent_name: string; requests: number; tokens_input: number; tokens_output: number; costo_cop: number }[];
  topUsuarios: { user_id: string; email: string; requests: number; tokens_input: number; tokens_output: number; costo_cop: number }[];
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'usuarios',   label: 'Usuarios y Suscripciones' },
  { id: 'finops',     label: 'FinOps & Consumo IA' },
  { id: 'telemetria', label: 'Telemetría y Control' },
  { id: 'wompi',      label: 'Pasarela Wompi (COP)' },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('usuarios');

  return (
    <div style={{ minHeight: '100%', background: '#f7f9fb' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px 0', fontFamily: "'Public Sans', sans-serif", color: '#191c1e' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Panel de Administración</h1>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
          Acceso exclusivo para administradores.
        </p>

        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', flexWrap: 'wrap' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 16px',
                border: 'none',
                borderBottom: tab === t.id ? '2px solid #0058be' : '2px solid transparent',
                background: 'none',
                color: tab === t.id ? '#0058be' : '#6b7280',
                fontSize: 13,
                fontWeight: tab === t.id ? 700 : 500,
                cursor: 'pointer',
                marginBottom: -1,
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'usuarios'   && <AdminPermisosPage />}
      {tab === 'finops'     && <FinOpsTab />}
      {tab === 'telemetria' && <TelemetriaTab />}
      {tab === 'wompi'      && <WompiTab />}
    </div>
  );
}

// ── Hook compartido: GET /api/admin/system-status ────────────────────────────
function useSystemStatus() {
  const [status, setStatus]   = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await http.get<{ success: boolean; data: SystemStatus }>('/api/admin/system-status');
        setStatus(resp.data);
      } catch (e) {
        setError(e instanceof ApiError && e.status === 403
          ? 'Esta sección requiere una cuenta administradora.'
          : 'No se pudo verificar el estado de las integraciones.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { status, loading, error };
}

function EstadoBadge({ estado }: { estado: 'ACTIVO' | 'STANDBY' }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 9999,
      background: estado === 'ACTIVO' ? '#dcfce7' : '#f3f4f6',
      color: estado === 'ACTIVO' ? '#15803d' : '#6b7280',
      border: `1px solid ${estado === 'ACTIVO' ? '#86efac' : '#d1d5db'}`,
      whiteSpace: 'nowrap',
    }}>
      {estado === 'ACTIVO' ? '● ACTIVO' : '○ STANDBY (esperando credencial)'}
    </span>
  );
}

// ── Tab: Telemetría y Control ─────────────────────────────────────────────────
function TelemetriaTab() {
  const { status, loading, error } = useSystemStatus();
  const posthogConfigurado = !!import.meta.env.VITE_POSTHOG_KEY;

  const filas: { label: string; estado: 'ACTIVO' | 'STANDBY' | undefined }[] = status ? [
    { label: 'Sentry (errores backend + frontend)', estado: status.sentry },
    { label: 'PostHog (telemetría + Session Replay)', estado: status.posthog },
    { label: 'Stripe (pasarela de pago)', estado: status.stripe },
    { label: 'Wompi (pasarela PSE/Nequi)', estado: status.wompi },
    { label: 'Resend (email alterno)', estado: status.resend },
    { label: 'Brevo (email transaccional)', estado: status.brevo },
    { label: 'Google Gemini (IA)', estado: status.google_gemini },
    { label: 'Google OAuth (login social)', estado: status.google_oauth },
  ] : [];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px', fontFamily: "'Public Sans', sans-serif", color: '#191c1e' }}>
      {error && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}
      {loading ? (
        <p style={{ color: '#6b7280', fontSize: 13 }}>Verificando estado de integraciones…</p>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 24 }}>
          {filas.map((f, i) => (
            <div key={f.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < filas.length - 1 ? '1px solid #f1f3f5' : 'none' }}>
              <span style={{ fontSize: 13 }}>{f.label}</span>
              {f.estado && <EstadoBadge estado={f.estado} />}
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Dashboard de PostHog</h2>
      {!posthogConfigurado ? (
        <div style={{ padding: '16px 20px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, color: '#92400e', fontSize: 13 }}>
          PostHog no está configurado en este entorno — falta <code>VITE_POSTHOG_KEY</code> (y opcionalmente <code>VITE_POSTHOG_HOST</code>) en el <code>.env</code> del frontend.
          Una vez agregadas las credenciales reales, esta sección carga automáticamente el dashboard de tu proyecto de PostHog.
        </div>
      ) : (
        // react-doctor/iframe-missing-sandbox: sigue marcando esta línea a
        // propósito — allow-scripts + allow-same-origin juntos son el par
        // que, en teoría, le devuelve a un iframe casi toda la capacidad que
        // el sandbox existe para quitarle (con ambos, el contenido conserva
        // su origen real y puede ejecutar JS con él). Es el mismo trade-off
        // que exige cualquier dashboard SaaS embebido que necesite su propia
        // sesión/cookies (PostHog, Grafana, Metabase) — sin allow-same-origin
        // el login de PostHog no persiste; sin allow-scripts no renderiza. Se
        // confía en el origen de PostHog, no en el sandbox, para este caso;
        // allow-forms/allow-popups sí se quitan por no ser necesarios.
        <iframe
          title="PostHog — Análisis y Grabaciones"
          src={POSTHOG_HOST}
          style={{ width: '100%', height: 'calc(100vh - 420px)', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </div>
  );
}

// ── Tab: FinOps & Consumo IA — GET /api/admin/finops (ai_token_logs) ─────────
function FinOpsTab() {
  const [data, setData]       = useState<FinOpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await http.get<{ success: boolean; data: FinOpsData }>('/api/admin/finops');
        setData(resp.data);
      } catch (e) {
        setError(e instanceof ApiError
          ? (e.status === 403 ? 'Esta sección requiere una cuenta administradora.' : e.message)
          : 'No se pudo cargar el consumo de IA.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px', fontFamily: "'Public Sans', sans-serif", color: '#191c1e' }}>
      {error && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}
      {loading ? (
        <p style={{ color: '#6b7280', fontSize: 13 }}>Cargando…</p>
      ) : !data ? null : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
            <StatCard label="Costo total estimado" value={fmtCOP(data.totales.costo_total_cop)} />
            <StatCard label="Requests de IA" value={String(data.totales.total_requests)} />
            <StatCard label="Tokens de entrada" value={data.totales.tokens_input.toLocaleString('es-CO')} />
            <StatCard label="Tokens de salida" value={data.totales.tokens_output.toLocaleString('es-CO')} />
          </div>

          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Consumo por agente</h2>
          <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                  <th style={{ padding: '10px 14px' }}>Agente</th>
                  <th style={{ padding: '10px 14px' }}>Requests</th>
                  <th style={{ padding: '10px 14px' }}>Tokens in/out</th>
                  <th style={{ padding: '10px 14px' }}>Costo</th>
                </tr>
              </thead>
              <tbody>
                {data.porAgente.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: '14px', color: '#9ca3af', fontStyle: 'italic' }}>Sin consumo registrado todavía.</td></tr>
                ) : data.porAgente.map(a => (
                  <tr key={a.agent_name} style={{ borderBottom: '1px solid #f1f3f5' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{a.agent_name}</td>
                    <td style={{ padding: '10px 14px' }}>{a.requests}</td>
                    <td style={{ padding: '10px 14px', color: '#6b7280' }}>{a.tokens_input.toLocaleString('es-CO')} / {a.tokens_output.toLocaleString('es-CO')}</td>
                    <td style={{ padding: '10px 14px' }}>{fmtCOP(a.costo_cop)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Top usuarios por consumo</h2>
          <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                  <th style={{ padding: '10px 14px' }}>Usuario</th>
                  <th style={{ padding: '10px 14px' }}>Requests</th>
                  <th style={{ padding: '10px 14px' }}>Costo</th>
                </tr>
              </thead>
              <tbody>
                {data.topUsuarios.length === 0 ? (
                  <tr><td colSpan={3} style={{ padding: '14px', color: '#9ca3af', fontStyle: 'italic' }}>Sin consumo registrado todavía.</td></tr>
                ) : data.topUsuarios.map(u => (
                  <tr key={u.user_id} style={{ borderBottom: '1px solid #f1f3f5' }}>
                    <td style={{ padding: '10px 14px' }}>{u.email}</td>
                    <td style={{ padding: '10px 14px' }}>{u.requests}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{fmtCOP(u.costo_cop)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

// ── Tab: Pasarela Wompi (COP) ──────────────────────────────────────────────────
function WompiTab() {
  const { status, loading, error } = useSystemStatus();

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px', fontFamily: "'Public Sans', sans-serif", color: '#191c1e' }}>
      {error && (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}
      {loading ? (
        <p style={{ color: '#6b7280', fontSize: 13 }}>Cargando…</p>
      ) : status && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Conector Wompi</span>
            <EstadoBadge estado={status.wompi} />
            <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>
              Pasarela activa: <strong>{status.payment_provider_activo}</strong>
            </span>
          </div>

          <div style={{ padding: '16px 20px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, color: '#92400e', fontSize: 13, marginBottom: 20 }}>
            {status.wompi === 'STANDBY'
              ? <>Wompi no tiene credenciales configuradas (<code>WOMPI_PUBLIC_KEY</code>/<code>WOMPI_PRIVATE_KEY</code>). Aunque se configuren, <code>backend/payments/wompiProvider.js</code> todavía tiene los 3 métodos de integración marcados como pendientes — completar contra la documentación real de Wompi antes de activar transacciones reales (ver comentario de cabecera del archivo).</>
              : <>Credenciales presentes, pero la lógica de integración en <code>wompiProvider.js</code> sigue pendiente de completar contra la API real de Wompi.</>
            }
          </div>

          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 10px' }}>Transacciones y suscripciones</h2>
          <p style={{ fontSize: 12.5, color: '#6b7280', fontStyle: 'italic' }}>
            Sin datos — Wompi todavía no procesa transacciones reales en este entorno (ver aviso arriba). Esta sección se poblará automáticamente en cuanto <code>wompiProvider.js</code> quede implementado y se reciban los primeros webhooks reales.
          </p>
        </>
      )}
    </div>
  );
}
