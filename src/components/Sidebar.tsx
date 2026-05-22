import { useState, useEffect } from 'react';
import {
  Radar,
  MessageSquare,
  FlaskConical,
  ChevronLeft,
  ChevronRight,
  Database,
  Settings,
  Folder,
  Award,
  Inbox,
  Zap,
  AlertTriangle,
  Users,
} from 'lucide-react';
import type { ModuloActivo } from '../types';
import { useRadar } from '../contexts/RadarContext';
import './Sidebar.css';

interface SidebarProps {
  moduloActivo: ModuloActivo;
  onModuloChange: (modulo: ModuloActivo) => void;
  badges?: Partial<Record<ModuloActivo, number>>;
}

const menuItems: { id: ModuloActivo; label: string; icon: React.ReactNode }[] = [
  { id: 'radar', label: 'RadarGrid', icon: <Radar size={20} /> },
  { id: 'inbox', label: 'Bandeja de Prospectos', icon: <Inbox size={20} /> },
  { id: 'convocatorias', label: 'Convocatorias', icon: <Award size={20} /> },
  { id: 'directorio', label: 'Directorio', icon: <Folder size={20} /> },
  { id: 'realtime', label: 'Radar en Tiempo Real', icon: <Zap size={20} /> },
  { id: 'chat', label: 'Inteligencia y Chat', icon: <MessageSquare size={20} /> },
  { id: 'prueba', label: 'Laboratorio', icon: <FlaskConical size={20} /> },
  { id: 'tablero-beneficiarios', label: 'Tablero Beneficiarios', icon: <Users size={20} /> },
  { id: 'configuracion', label: 'Configuración', icon: <Settings size={20} /> },
];

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Sidebar: Error guardando en LocalStorage', e);
  }
}

export default function Sidebar({ moduloActivo, onModuloChange, badges = {} }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => loadFromStorage('sidebar_collapsed', false));
  const [error, setError] = useState<string | null>(null);
  const { pendientesCount } = useRadar();

  useEffect(() => {
    try {
      saveToStorage('sidebar_collapsed', collapsed);
    } catch (e) {
      setError('Error al persistir estado del sidebar');
      console.error('Sidebar persist error:', e);
    }
  }, [collapsed]);

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      {/* Logo original RADAR 360 preservado al 100% */}
      <div className="sidebar__logo">
        <div className="sidebar__logo-icon">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="14" cy="14" r="13" stroke="var(--primary)" strokeWidth="1.5" fill="none" opacity="0.3" />
            <circle cx="14" cy="14" r="9" stroke="var(--primary)" strokeWidth="1.5" fill="none" opacity="0.5" />
            <circle cx="14" cy="14" r="5" stroke="var(--primary)" strokeWidth="1.5" fill="none" opacity="0.7" />
            <circle cx="14" cy="14" r="2" fill="var(--primary)" />
            <line x1="14" y1="14" x2="23" y2="8" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
            <polygon points="22,7 24,9 23,8" fill="var(--primary)" />
          </svg>
          <div className="sidebar__logo-pulse" />
        </div>
        {!collapsed && (
          <div className="sidebar__logo-text">
            <span className="sidebar__logo-title">RADAR 360</span>
            <span className="sidebar__logo-subtitle">Inteligencia de Fondos</span>
          </div>
        )}
      </div>

      {/* Botón de colapso (Expandir/Contraer) integrado */}
      <button
        className="sidebar__toggle"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Expandir' : 'Colapsar'}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      {/* Menú de navegación en tiempo real */}
      <nav className="sidebar__nav">
        <div className="sidebar__section-label">
          {!collapsed && 'MÓDULOS'}
        </div>
        {menuItems.map((item) => {
          const badgeCount = item.id === 'inbox' ? pendientesCount : (badges[item.id] || 0);
          return (
            <button
              key={item.id}
              className={`sidebar `}
              id={moduloActivo === item.id ? 'sidebar__item--active' : ''}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: collapsed ? '0' : '12px',
                width: '100%',
                padding: '12px 16px',
                borderRadius: '8px',
                border: 'none',
                background: moduloActivo === item.id ? '#1e293b' : 'transparent',
                color: moduloActivo === item.id ? '#38bdf8' : '#94a3b8',
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: moduloActivo === item.id ? '600' : '400',
                transition: 'all 0.2s ease',
                position: 'relative'
              }}
              onClick={() => onModuloChange(item.id)}
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar__item-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: moduloActivo === item.id ? '#38bdf8' : '#94a3b8' }}>
                {item.icon}
              </span>
              {!collapsed && (
                <>
                  <span className="sidebar__item-label" style={{ fontSize: '14px' }}>{item.label}</span>
                  {badgeCount ? (
                    <span className="sidebar__item-badge" style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', fontSize: '11px', padding: '2px 6px', borderRadius: '10px', fontWeight: 'bold' }}>
                      {badgeCount}
                    </span>
                  ) : null}
                </>
              )}
              {collapsed && badgeCount ? (
                <span className="sidebar__item-badge sidebar__item-badge--dot" style={{ position: 'absolute', top: '8px', right: '8px', width: '8px', height: '8px', background: '#ef4444', borderRadius: '50%' }} />
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Pie de página: Estado del conector de base de datos */}
      <div className="sidebar__footer" style={{ marginTop: 'auto', paddingTop: '15px', borderTop: '1px solid #1e293b' }}>
        <div className="sidebar__status" style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#64748b' }}>
          <Database size={14} className="sidebar__status-icon" />
          {!collapsed && (
            <div className="sidebar__status-info" style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="sidebar__status-label" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rastreo Global</span>
              <span className="sidebar__status-value" style={{ fontSize: '12px', color: '#94a3b8' }}>986+ oportunidades · 80+ fuentes</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

export { SidebarConfiguracion } from './SidebarConfiguracion';
