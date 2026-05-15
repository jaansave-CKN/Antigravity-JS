import { useState } from 'react';
import {
  Lock, Unlock, Plus, Pencil, Trash2, ExternalLink, Search,
  Building2, Globe2, Handshake, GraduationCap, Heart, Briefcase,
  X, Save, AlertTriangle, ChevronDown, ChevronUp, Mail, Calendar,
  RefreshCw, Wifi, WifiOff, CheckCircle2,
} from 'lucide-react';
import type { Entidad, Sector } from '../types';
import { sectorColors } from '../data/mockData';
import { useEntidades } from '../hooks/useEntidades';
import { realEntidades } from '../data/realEntidades';
import './EntidadesView.css';

interface Props { entidadesIniciales: Entidad[]; modoSimple?: boolean; }

const tipoIcons: Record<string, React.ReactNode> = {
  gobierno: <Building2 size={14} />, multilateral: <Globe2 size={14} />,
  bilateral: <Handshake size={14} />, ong: <Heart size={14} />,
  privado: <Briefcase size={14} />, academia: <GraduationCap size={14} />,
};
const tipoLabels: Record<string, string> = {
  gobierno: 'Gobierno', multilateral: 'Multilateral', bilateral: 'Bilateral',
  ong: 'ONG', privado: 'Privado', academia: 'Academia',
};
const tipoColors: Record<string, string> = {
  gobierno: '#ffd600', multilateral: '#00e5ff', bilateral: '#69f0ae',
  ong: '#ff6e40', privado: '#b388ff', academia: '#82b1ff',
};

const emptyEntidad: Entidad = {
  id: '', nombre: '', sigla: '', tipo: 'multilateral', pais: '', bandera: '🌐',
  sectores: [], sitioWeb: '', urlConvocatorias: '', contacto: '', emailContacto: '',
  convocatoriasActivas: 0, montoTotalDisponible: 0, moneda: 'USD',
  frecuencia: 'variable', ultimaConvocatoria: '', notas: '',
  locked: false, creadoEn: new Date().toISOString().slice(0, 10),
  actualizadoEn: new Date().toISOString().slice(0, 10),
};

const allSectores: Sector[] = [
  'Infraestructura', 'Agua y Saneamiento', 'Saneamiento Basico', 'Desarrollo Social',
  'Educacion', 'Salud', 'Primera Infancia', 'Vivienda', 'Agricola', 'Agroindustria',
  'Medio Ambiente', 'Cambio Climatico', 'Energias Renovables', 'Turismo', 'Cultura',
  'Emprendimiento', 'Empresarial', 'Tecnologia e Innovacion', 'Desarrollo Economico',
  'Construccion', 'Transporte', 'Gestion de Riesgos', 'Cooperativismo',
  'Desarrollo Rural', 'Seguridad Alimentaria', 'Ayuda Humanitaria', 'Derechos Humanos',
  'Ordenamiento Territorial', 'Desarrollo Local', 'Poblacion Vulnerable', 'Empleo',
  'Productividad', 'Gestion Publica', 'Desarrollo Sostenible', 'Paz', 'Igualdad de Genero',
  'Impacto Social', 'Inclusion Financiera', 'Cambio Social', 'ODS',
];

const fmt = (n: number, m: string) => {
  if (m === 'COP') return `$${(n / 1e6).toFixed(0)}M COP`;
  return `$${(n / 1e6).toFixed(1)}M ${m}`;
};

const formatSyncTime = (iso: string | null) => {
  if (!iso) return 'Nunca sincronizado';
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 60000);
  if (diff < 1) return 'Hace menos de 1 min';
  if (diff < 60) return `Hace ${diff} min`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `Hace ${h}h`;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function EntidadesView({ entidadesIniciales, modoSimple = false }: Props) {
  const { entidades: syncEntidades, loading: syncLoading, error: syncError, lastSync, isStale, forceSync } = useEntidades();
  const entidades = syncEntidades.length > 0 ? syncEntidades : entidadesIniciales;

  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<string>('todos');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Entidad>(emptyEntidad);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState<Entidad>({ ...emptyEntidad });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [localEntidades, setLocalEntidades] = useState<Entidad[]>([]);

  const displayEntidades = localEntidades.length > 0 ? localEntidades : entidades;

  const filtradas = displayEntidades.filter((e) => {
    const q = busqueda.toLowerCase();
    const matchBusqueda = !q || e.nombre.toLowerCase().includes(q) || e.sigla.toLowerCase().includes(q) || e.pais.toLowerCase().includes(q);
    const matchTipo = filtroTipo === 'todos' || e.tipo === filtroTipo;
    return matchBusqueda && matchTipo;
  });

  const toggleLock = (id: string) => {
    const updated = displayEntidades.map((e) => e.id === id ? { ...e, locked: !e.locked } : e);
    setLocalEntidades(updated);
  };

  const startEdit = (ent: Entidad) => {
    if (ent.locked) return;
    setEditingId(ent.id);
    setEditForm({ ...ent });
    setExpandedId(ent.id);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const updated = displayEntidades.map((e) => e.id === editingId ? { ...editForm, actualizadoEn: new Date().toISOString().slice(0, 10) } : e);
    setLocalEntidades(updated);
    setEditingId(null);
  };

  const cancelEdit = () => { setEditingId(null); };

  const handleDelete = (id: string) => {
    const ent = displayEntidades.find((e) => e.id === id);
    if (ent?.locked) return;
    if (deleteConfirm === id) {
      const updated = displayEntidades.filter((e) => e.id !== id);
      setLocalEntidades(updated);
      setDeleteConfirm(null);
      setExpandedId(null);
    } else {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 4000);
    }
  };

  const addNew = () => {
    const id = `ent-${Date.now()}`;
    const now = new Date().toISOString().slice(0, 10);
    const updated = [...displayEntidades, { ...newForm, id, creadoEn: now, actualizadoEn: now }];
    setLocalEntidades(updated);
    setNewForm({ ...emptyEntidad });
    setShowNewForm(false);
  };

  const toggleSector = (sector: Sector, form: Entidad, setForm: (f: Entidad) => void) => {
    const has = form.sectores.includes(sector);
    setForm({ ...form, sectores: has ? form.sectores.filter((s) => s !== sector) : [...form.sectores, sector] });
  };

  const lockedCount = displayEntidades.filter((e) => e.locked).length;
  const totalConv = displayEntidades.reduce((s, e) => s + e.convocatoriasActivas, 0);
  const uniqueCountries = [...new Set(displayEntidades.map((e) => e.pais))].length;

  const renderForm = (form: Entidad, setForm: (f: Entidad) => void, onSave: () => void, onCancel: () => void) => (
    <div className="ent__form">
      <div className="ent__form-row">
        <label>Nombre<input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre completo" /></label>
        <label>Sigla<input value={form.sigla} onChange={(e) => setForm({ ...form, sigla: e.target.value })} placeholder="Ej: BID" /></label>
      </div>
      <div className="ent__form-row">
        <label>Tipo
          <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Entidad['tipo'] })}>
            {Object.entries(tipoLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>País<input value={form.pais} onChange={(e) => setForm({ ...form, pais: e.target.value })} /></label>
        <label>Moneda
          <select value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value })}>
            <option value="USD">USD</option><option value="EUR">EUR</option><option value="COP">COP</option><option value="CHF">CHF</option>
          </select>
        </label>
      </div>
      <div className="ent__form-row">
        <label>Sitio Web<input value={form.sitioWeb} onChange={(e) => setForm({ ...form, sitioWeb: e.target.value })} placeholder="https://..." /></label>
        <label>URL Convocatorias<input value={form.urlConvocatorias || ''} onChange={(e) => setForm({ ...form, urlConvocatorias: e.target.value })} placeholder="https://.../convocatorias" /></label>
      </div>
      <div className="ent__form-row">
        <label>Contacto<input value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} /></label>
        <label>Email<input value={form.emailContacto} onChange={(e) => setForm({ ...form, emailContacto: e.target.value })} type="email" /></label>
      </div>
      <div className="ent__form-row">
        <label>Conv. Activas<input type="number" value={form.convocatoriasActivas} onChange={(e) => setForm({ ...form, convocatoriasActivas: +e.target.value })} /></label>
        <label>Monto Total<input type="number" value={form.montoTotalDisponible} onChange={(e) => setForm({ ...form, montoTotalDisponible: +e.target.value })} /></label>
        <label>Frecuencia
          <select value={form.frecuencia} onChange={(e) => setForm({ ...form, frecuencia: e.target.value as Entidad['frecuencia'] })}>
            <option value="mensual">Mensual</option><option value="trimestral">Trimestral</option>
            <option value="semestral">Semestral</option><option value="anual">Anual</option>
            <option value="variable">Variable</option><option value="continua">Continua</option><option value="continua">Continua</option>
          </select>
        </label>
      </div>
      <label className="ent__form-full">Sectores</label>
      <div className="ent__form-sectors">
        {allSectores.map((s) => (
          <button key={s} className={`ent__sector-btn ${form.sectores.includes(s) ? 'active' : ''}`}
            style={form.sectores.includes(s) ? { background: sectorColors[s] + '33', borderColor: sectorColors[s], color: sectorColors[s] } : {}}
            onClick={() => toggleSector(s, form, setForm)}>{s}</button>
        ))}
      </div>
      <label className="ent__form-full">Notas<textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} rows={2} /></label>
      <div className="ent__form-actions">
        <button className="ent__btn ent__btn--save" onClick={onSave} disabled={!form.nombre || !form.sigla}><Save size={14} /> Guardar</button>
        <button className="ent__btn ent__btn--cancel" onClick={onCancel}><X size={14} /> Cancelar</button>
      </div>
    </div>
  );

  return (
    <div className="ent animate-fade-in">
      {/* Sync Status Bar */}
      <div className="ent__sync-bar">
        <div className="ent__sync-left">
          {syncLoading ? (
            <span className="ent__sync-status ent__sync-status--loading">
              <RefreshCw size={12} className="spin" /> Sincronizando...
            </span>
          ) : syncError ? (
            <span className="ent__sync-status ent__sync-status--offline">
              <WifiOff size={12} /> Offline — usando cache local
            </span>
          ) : isStale ? (
            <span className="ent__sync-status ent__sync-status--stale">
              <Wifi size={12} /> Sync: {formatSyncTime(lastSync)}
            </span>
          ) : (
            <span className="ent__sync-status ent__sync-status--live">
              <CheckCircle2 size={12} /> 24/7 — {formatSyncTime(lastSync)}
            </span>
          )}
          <span className="ent__sync-source">
            Fuente: NotebookLM + Scrapers | {displayEntidades.length} entidades verificadas
          </span>
        </div>
        <button
          className={`ent__sync-btn ${syncLoading ? 'ent__sync-btn--loading' : ''}`}
          onClick={forceSync}
          disabled={syncLoading}
          title="Sincronizar ahora"
        >
          <RefreshCw size={14} className={syncLoading ? 'spin' : ''} />
          Sincronizar
        </button>
      </div>

      {/* KPIs */}
      <div className="ent__kpis">
        <div className="ent__kpi"><Building2 size={20} /><div><span className="ent__kpi-val">{displayEntidades.length}</span><span className="ent__kpi-label">Entidades</span></div></div>
        <div className="ent__kpi"><Lock size={20} /><div><span className="ent__kpi-val">{lockedCount}</span><span className="ent__kpi-label">Protegidas</span></div></div>
        <div className="ent__kpi"><Calendar size={20} /><div><span className="ent__kpi-val">{totalConv}</span><span className="ent__kpi-label">Conv. Activas</span></div></div>
        <div className="ent__kpi"><Globe2 size={20} /><div><span className="ent__kpi-val">{uniqueCountries}</span><span className="ent__kpi-label">Países</span></div></div>
      </div>

      {/* Toolbar */}
      <div className="ent__toolbar">
        <div className="ent__search">
          <Search size={16} />
          <input placeholder="Buscar entidad por nombre, sigla o país..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="ent__filters">
          {['todos', ...Object.keys(tipoLabels)].map((t) => (
            <button key={t} className={`ent__filter-btn ${filtroTipo === t ? 'active' : ''}`} onClick={() => setFiltroTipo(t)}>
              {t === 'todos' ? 'Todos' : tipoLabels[t]}
            </button>
          ))}
        </div>
        <button className="ent__btn ent__btn--add" onClick={() => setShowNewForm(!showNewForm)}>
          {showNewForm ? <><X size={14} /> Cerrar</> : <><Plus size={14} /> Nueva Entidad</>}
        </button>
      </div>

      {/* New form */}
      {showNewForm && (
        <div className="ent__card ent__card--new">
          <h3 className="ent__card-title"><Plus size={16} /> Registrar Nueva Entidad</h3>
          {renderForm(newForm, setNewForm, addNew, () => { setShowNewForm(false); setNewForm({ ...emptyEntidad }); })}
        </div>
      )}

      {/* List */}
      <div className="ent__count">{filtradas.length} entidades encontradas</div>
      <div className="ent__list">
        {filtradas.map((ent) => {
          const isExpanded = expandedId === ent.id;
          const isEditing = editingId === ent.id;
          const urlConv = ent.urlConvocatorias || ent.sitioWeb;
          return (
            <div key={ent.id} className={`ent__card ${ent.locked ? 'ent__card--locked' : ''} ${isEditing ? 'ent__card--editing' : ''}`}>
              <div className="ent__card-header" onClick={() => !isEditing && setExpandedId(isExpanded ? null : ent.id)}>
                <div className="ent__card-left">
                  <span className="ent__card-flag">{ent.bandera}</span>
                  <div>
                    <div className="ent__card-name">{ent.nombre} <span className="ent__card-sigla">({ent.sigla})</span></div>
                    <div className="ent__card-meta">
                      <span className="ent__tipo-badge" style={{ background: tipoColors[ent.tipo] + '22', color: tipoColors[ent.tipo], borderColor: tipoColors[ent.tipo] }}>
                        {tipoIcons[ent.tipo]} {tipoLabels[ent.tipo]}
                      </span>
                      <span>📍 {ent.pais}</span>
                      <span>📋 {ent.convocatoriasActivas} conv.</span>
                      <span>💰 {fmt(ent.montoTotalDisponible, ent.moneda)}</span>
                    </div>
                  </div>
                </div>
                <div className="ent__card-right">
                  <div className="ent__card-sectors">
                    {ent.sectores.slice(0, 3).map((s) => (
                      <span key={s} className="ent__sector-tag" style={{ background: sectorColors[s] + '22', color: sectorColors[s] }}>{s}</span>
                    ))}
                    {ent.sectores.length > 3 && <span className="ent__sector-tag ent__sector-more">+{ent.sectores.length - 3}</span>}
                  </div>
                  {!modoSimple && (
                    <div className="ent__card-actions" onClick={(e) => e.stopPropagation()}>
                      {urlConv && (
                        <a href={urlConv} target="_blank" rel="noopener noreferrer" className="ent__icon-btn" title="Ver Convocatorias">
                          <ExternalLink size={16} />
                        </a>
                      )}
                      <button className={`ent__icon-btn ${ent.locked ? 'ent__icon-btn--locked' : 'ent__icon-btn--unlocked'}`}
                        onClick={() => toggleLock(ent.id)} title={ent.locked ? 'Desbloquear' : 'Bloquear'}>
                        {ent.locked ? <Lock size={16} /> : <Unlock size={16} />}
                      </button>
                      <button className="ent__icon-btn" onClick={() => startEdit(ent)} disabled={ent.locked} title={ent.locked ? 'Desbloqueé primero' : 'Editar'}>
                        <Pencil size={16} />
                      </button>
                      <button className={`ent__icon-btn ent__icon-btn--danger ${deleteConfirm === ent.id ? 'ent__icon-btn--confirming' : ''}`}
                        onClick={() => handleDelete(ent.id)} disabled={ent.locked} title={ent.locked ? 'Desbloqueé primero' : deleteConfirm === ent.id ? '¿Confirmar?' : 'Eliminar'}>
                        {deleteConfirm === ent.id ? <AlertTriangle size={16} /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  )}
                  {isExpanded ? <ChevronUp size={16} className="ent__chevron" /> : <ChevronDown size={16} className="ent__chevron" />}
                </div>
              </div>

              {isExpanded && (
                <div className="ent__card-body">
                  {isEditing ? (
                    renderForm(editForm, setEditForm, saveEdit, cancelEdit)
                  ) : (
                    <div className="ent__detail">
                      <div className="ent__detail-grid">
                        <div><span className="ent__detail-label">Contacto</span><span>{ent.contacto}</span></div>
                        <div><span className="ent__detail-label">Email</span><a href={`mailto:${ent.emailContacto}`}><Mail size={12} /> {ent.emailContacto}</a></div>
                        <div><span className="ent__detail-label">Frecuencia</span><span className="capitalize">{ent.frecuencia}</span></div>
                        <div><span className="ent__detail-label">Última Conv.</span><span>{ent.ultimaConvocatoria}</span></div>
                        <div><span className="ent__detail-label">Creado</span><span>{ent.creadoEn}</span></div>
                        <div><span className="ent__detail-label">Actualizado</span><span>{ent.actualizadoEn}</span></div>
                      </div>
                      {ent.notas && <div className="ent__detail-notes"><strong>Notas:</strong> {ent.notas}</div>}
                      <div className="ent__detail-actions">
                        <a href={ent.sitioWeb} target="_blank" rel="noopener noreferrer" className="ent__btn ent__btn--link"><ExternalLink size={14} /> Sitio Web</a>
                        {ent.urlConvocatorias && (
                          <a href={ent.urlConvocatorias} target="_blank" rel="noopener noreferrer" className="ent__btn ent__btn--link ent__btn--primary"><ExternalLink size={14} /> Ver Convocatorias</a>
                        )}
                        <a href={`mailto:${ent.emailContacto}`} className="ent__btn ent__btn--link"><Mail size={14} /> Contactar</a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}