import { useState } from 'react';
import {
  Radar,
  CalendarClock,
  ShieldAlert,
  Users,
  Star,
  Building2,
  ChevronLeft,
  ChevronRight,
  Zap,
  Globe,
  Inbox,
  Settings,
  Bell,
} from 'lucide-react';
import type { ModuloActivo } from '../types';
import './Sidebar.css';

interface SidebarProps {
  moduloActivo: ModuloActivo;
  onModuloChange: (modulo: ModuloActivo) => void;
  badges?: Partial<Record<ModuloActivo, number>>;
}

const menuItems: { id: ModuloActivo; label: string; icon: React.ReactNode; badge?: number }[] = [
  { id: 'radar', label: 'Radar', icon: <Radar size={20} /> },
  { id: 'historico', label: 'Histórico Predictivo', icon: <CalendarClock size={20} /> },
  { id: 'riesgos', label: 'Analista de Riesgos', icon: <ShieldAlert size={20} /> },
  { id: 'consorcios', label: 'Buscador Consorcios', icon: <Users size={20} /> },
  { id: 'favoritos', label: 'Gestor de Favoritos', icon: <Star size={20} /> },
  { id: 'entidades', label: 'Directorio Entidades', icon: <Building2 size={20} /> },
  { id: 'alertas', label: 'Centro de Alertas', icon: <Bell size={20} /> },
  { id: 'inbox', label: 'Inteligencia IA', icon: <Inbox size={20} /> },
  { id: 'admin', label: 'Admin', icon: <Settings size={20} /> },
];

export default function Sidebar({ moduloActivo, onModuloChange, badges = {} }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      {/* Logo */}
      <div className="sidebar__logo">
        <div className="sidebar__logo-icon">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="14" cy="14" r="13" stroke="var(--primary)" strokeWidth="1.5" fill="none" opacity="0.3"/>
            <circle cx="14" cy="14" r="9" stroke="var(--primary)" strokeWidth="1.5" fill="none" opacity="0.5"/>
            <circle cx="14" cy="14" r="5" stroke="var(--primary)" strokeWidth="1.5" fill="none" opacity="0.7"/>
            <circle cx="14" cy="14" r="2" fill="var(--primary)"/>
            <line x1="14" y1="14" x2="23" y2="8" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" opacity="0.8"/>
            <polygon points="22,7 24,9 23,8" fill="var(--primary)"/>
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

      {/* Collapse toggle */}
      <button
        className="sidebar__toggle"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Expandir' : 'Colapsar'}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      {/* Navigation */}
      <nav className="sidebar__nav">
        <div className="sidebar__section-label">
          {!collapsed && 'MÓDULOS'}
        </div>
        {menuItems.map((item) => {
          const badgeCount = badges[item.id] || item.badge;
          return (
          <button
            key={item.id}
            className={`sidebar__item ${moduloActivo === item.id ? 'sidebar__item--active' : ''}`}
            onClick={() => onModuloChange(item.id)}
            title={collapsed ? item.label : undefined}
          >
            <span className="sidebar__item-icon">{item.icon}</span>
            {!collapsed && (
              <>
                <span className="sidebar__item-label">{item.label}</span>
                {badgeCount ? (
                  <span className="sidebar__item-badge">{badgeCount}</span>
                ) : null}
              </>
            )}
            {collapsed && badgeCount ? (
              <span className="sidebar__item-badge sidebar__item-badge--dot" />
            ) : null}
          </button>
        )})}
      </nav>

      {/* Status */}
      <div className="sidebar__footer">
        <div className="sidebar__status">
          <Zap size={14} className="sidebar__status-icon" />
          {!collapsed && (
            <div className="sidebar__status-info">
              <span className="sidebar__status-label">Motor Activo</span>
              <span className="sidebar__status-value">11 fuentes · 24/7</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
