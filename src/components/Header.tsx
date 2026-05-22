import { useState, useEffect, useRef } from 'react';
import { Bell, Search, Settings, User, RefreshCw, X, Moon, Sun, Volume2, VolumeX, Globe, LogOut, Shield, ChevronDown, Mic, MicOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSpeech } from '../contexts/SpeechContext';
import { Link } from 'react-router-dom';
import type { AlertaSenal } from '../types';
import './Header.css';

interface HeaderProps {
  busqueda: string;
  onBusquedaChange: (valor: string) => void;
  alertasCount: number;
  ultimaActualizacion: string;
  alertas: AlertaSenal[];
  onNavigateToModule: (modulo: string) => void;
}

export default function Header({ busqueda, onBusquedaChange, alertasCount, ultimaActualizacion, alertas, onNavigateToModule }: HeaderProps) {
  const { user, userProfile, signOut } = useAuth();
  const { isListening, transcript, startListening, stopListening, setTranscript } = useSpeech();
  const [showAlertas, setShowAlertas] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [notificaciones, setNotificaciones] = useState(true);
  const [alertasLeidas, setAlertasLeidas] = useState<Set<string>>(new Set());

  const alertasRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut ⌘K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setShowAlertas(false);
        setShowSettings(false);
        setShowProfile(false);
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (alertasRef.current && !alertasRef.current.contains(e.target as Node)) setShowAlertas(false);
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setShowSettings(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const marcarLeida = (id: string) => {
    setAlertasLeidas(prev => new Set([...prev, id]));
  };

  const marcarTodasLeidas = () => {
    setAlertasLeidas(new Set(alertas.map(a => a.id)));
  };

  const noLeidas = alertas.filter(a => !alertasLeidas.has(a.id)).length;

  const impactoColor = { alto: 'var(--danger)', medio: 'var(--warning)', bajo: 'var(--text-muted)' };

  return (
    <header className="header">
      <div className="header__left">
        <div className="header__search">
          <Search size={16} className="header__search-icon" />
          <input
            ref={searchRef}
            type="text"
            className="header__search-input"
            placeholder="Buscar convocatorias, donantes, sectores..."
            value={busqueda}
            onChange={(e) => onBusquedaChange(e.target.value)}
            id="search-global"
          />
          {busqueda && (
            <button className="header__search-clear" onClick={() => onBusquedaChange('')}>
              <X size={14} />
            </button>
          )}
          <button
            className={`header__mic-btn ${isListening ? 'header__mic-btn--active' : ''}`}
            title={isListening ? 'Detener dictado' : 'Iniciar dictado por voz'}
            onMouseDown={(e) => {
              e.preventDefault();
              if (isListening) {
                stopListening();
              } else {
                startListening(() => searchRef.current as HTMLInputElement | null);
              }
            }}
          >
            {isListening ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
          <kbd className="header__search-kbd">Ctrl+K</kbd>
        </div>
      </div>

      <div className="header__right">
        <div className="header__sync">
          <RefreshCw size={14} className="header__sync-icon" />
          <span className="header__sync-text">
            Últ. sync: {ultimaActualizacion}
          </span>
        </div>

        {/* ── Alertas Dropdown ── */}
        <div className="header__dropdown-wrapper" ref={alertasRef}>
          <button
            className={`header__action ${showAlertas ? 'header__action--active' : ''}`}
            title="Alertas"
            id="btn-alertas"
            onClick={() => { setShowAlertas(!showAlertas); setShowSettings(false); setShowProfile(false); }}
          >
            <Bell size={18} />
            {noLeidas > 0 && (
              <span className="header__action-badge">{noLeidas}</span>
            )}
          </button>
          {showAlertas && (
            <div className="header__dropdown header__dropdown--alertas animate-fade-in">
              <div className="header__dropdown-header">
                <h4>Alertas y Señales</h4>
                {noLeidas > 0 && (
                  <button className="header__dropdown-action" onClick={marcarTodasLeidas}>
                    Marcar todas leídas
                  </button>
                )}
              </div>
              <div className="header__dropdown-list">
                {alertas.map(alerta => (
                  <div
                    key={alerta.id}
                    className={`header__alert-item ${alertasLeidas.has(alerta.id) ? 'header__alert-item--read' : ''}`}
                    onClick={() => marcarLeida(alerta.id)}
                  >
                    <div className="header__alert-dot" style={{ background: impactoColor[alerta.impacto] }} />
                    <div className="header__alert-content">
                      <span className="header__alert-title">{alerta.titulo}</span>
                      <span className="header__alert-meta">
                        {alerta.fecha} · <span style={{ color: impactoColor[alerta.impacto] }}>●</span> {alerta.impacto}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <button className="header__dropdown-footer" onClick={() => { onNavigateToModule('radar'); setShowAlertas(false); }}>
                Ver todas las señales →
              </button>
            </div>
          )}
        </div>

        {/* ── Settings Dropdown ── */}
        <div className="header__dropdown-wrapper" ref={settingsRef}>
          <button
            className={`header__action ${showSettings ? 'header__action--active' : ''}`}
            title="Configuración"
            id="btn-settings"
            onClick={() => { setShowSettings(!showSettings); setShowAlertas(false); setShowProfile(false); }}
          >
            <Settings size={18} />
          </button>
          {showSettings && (
            <div className="header__dropdown header__dropdown--settings animate-fade-in">
              <div className="header__dropdown-header">
                <h4>Configuración</h4>
              </div>
              <div className="header__settings-list">
                <div className="header__setting">
                  <div className="header__setting-info">
                    {darkMode ? <Moon size={16} /> : <Sun size={16} />}
                    <span>Modo oscuro</span>
                  </div>
                  <label className="header__switch">
                    <input type="checkbox" checked={darkMode} onChange={() => setDarkMode(!darkMode)} />
                    <span className="header__switch-slider" />
                  </label>
                </div>
                <div className="header__setting">
                  <div className="header__setting-info">
                    {notificaciones ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    <span>Notificaciones push</span>
                  </div>
                  <label className="header__switch">
                    <input type="checkbox" checked={notificaciones} onChange={() => setNotificaciones(!notificaciones)} />
                    <span className="header__switch-slider" />
                  </label>
                </div>
                <div className="header__setting">
                  <div className="header__setting-info">
                    <Globe size={16} />
                    <span>Idioma</span>
                  </div>
                  <span className="header__setting-value">Español</span>
                </div>
                <div className="header__setting">
                  <div className="header__setting-info">
                    <RefreshCw size={16} />
                    <span>Frecuencia de sync</span>
                  </div>
                  <span className="header__setting-value">Cada 6h</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Profile Dropdown ── */}
        <div className="header__dropdown-wrapper" ref={profileRef}>
          <button
            className={`header__avatar ${showProfile ? 'header__avatar--active' : ''}`}
            title="Perfil"
            id="btn-profile"
            onClick={() => { setShowProfile(!showProfile); setShowAlertas(false); setShowSettings(false); }}
          >
            <span className="header__avatar-initials">
              {userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'}
            </span>
            <span className="header__avatar-status" />
            <ChevronDown size={10} className="header__avatar-chevron" />
          </button>
          {showProfile && (
            <div className="header__dropdown header__dropdown--profile animate-fade-in">
              <div className="header__profile-card">
                <div className="header__profile-avatar">
                  <span>{userProfile?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'}</span>
                </div>
                <div className="header__profile-info">
                  <span className="header__profile-name">{userProfile?.displayName || 'Usuario'}</span>
                  <span className="header__profile-role">{userProfile?.role === 'admin' ? 'Administrador' : 'Usuario'}</span>
                  <span className="header__profile-org">{user?.email}</span>
                </div>
              </div>
              {userProfile?.role === 'admin' && (
                <Link to="/admin/users" className="header__profile-btn" onClick={() => setShowProfile(false)}>
                  <Shield size={14} /> Gestión de Usuarios
                </Link>
              )}
              <div className="header__profile-actions">
                <button className="header__profile-btn" onClick={() => { onNavigateToModule('riesgos'); setShowProfile(false); }}>
                  Ver documentos
                </button>
                <button className="header__profile-btn" onClick={() => { onNavigateToModule('favoritos'); setShowProfile(false); }}>
                  Mis favoritos
                </button>
                <button className="header__profile-btn header__profile-btn--danger" onClick={signOut}>
                  <LogOut size={14} /> Cerrar Sesión
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
