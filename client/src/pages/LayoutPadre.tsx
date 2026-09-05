/**
 * LayoutPadre — Arquitectura Radar 360
 * Header (sticky, memoizado) + ConvocatoriasList (datos puros)
 * El header NO se re-renderiza cuando cambia la lista de convocatorias.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContextNew';
import { SECTORES_TAXONOMY } from '../data/sectoresTaxonomy';
import './RadarCalcoPage.css';

// FIX (react-doctor client-localstorage-no-version, 2026-09-05): clave
// versionada — el initializer de favoritos migra la clave vieja.
const STORAGE_KEY = 'radar360_radar_favoritos:v1';
const STORAGE_KEY_LEGACY = 'radar360_radar_favoritos';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Convocatoria {
  id: string;
  titulo: string;
  donante: string;
  descripcion: string;
  monto_min: number;
  monto_max: number;
  moneda: string;
  paises_elegibles: string;
  sectores: string;
  url_convocatoria: string;
  fecha_limite: string;
  fecha_publicacion: string;
  estado: string;
  created_at: string;
  score_probabilidad: number;
  entidad_nombre: string | null;
  entidad_sigla: string | null;
  entidad_tipo: string | null;
  entidad_pais: string | null;
  root_domain: string | null;
  favorito?: boolean;
}

interface MetaFiltros {
  sectores: string[];
  paises: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSectorColor(nombre: string): string {
  for (const s of SECTORES_TAXONOMY) {
    if (s.nombre === nombre) return s.color;
    const sg = s.subgrupos.find(g => g.nombre === nombre);
    if (sg) return sg.color;
  }
  return '#0058be';
}

function parsePaises(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return raw ? [raw] : []; }
}
function parseSectores(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return raw ? [raw] : []; }
}
function fmtCOP(cop: number): string {
  const fmtInt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
  if (cop >= 1_000_000) {
    return fmtInt.format(Math.round(cop / 1_000_000)) + ' (MM)';
  }
  return fmtInt.format(Math.round(cop)) + ' (MM)';
}
function formatMonto(min: number, max: number, moneda: string): string {
  const val = max > 0 ? max : min;
  if (!val) return '';
  if (moneda === 'COP') {
    return fmtCOP(val);
  }
  const fmt = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
  return `${fmt.format(val)} ${moneda}`;
}
function formatMontoCOP(min: number, max: number, moneda: string, rates: Record<string, number>): string {
  if (moneda === 'COP') return '';
  const val = max > 0 ? max : min;
  if (!val) return '';
  const rate = rates[moneda];
  if (!rate) return '';
  const cop = val * rate;
  return fmtCOP(cop);
}

// Extrae monto y equivalente COP desde texto libre (descripcion scrapeada)
function tryExtractMonto(desc: string, rates: Record<string, number>): { monto: string; montoCop: string } | null {
  if (!desc || desc.length < 8) return null;
  const FALLBACK: Record<string, number> = { USD: 4200, EUR: 4570, GBP: 5340, CAD: 3100, COP: 1 };
  const eff = { ...FALLBACK, ...rates };
  const re = /(?:USD|EUR|GBP|COP|CAD|\$|€|£)\s*([\d.,]+)\s*(M(?:illion)?|K)?|([\d.,]+)\s*(M(?:illion)?|K)?\s+(?:USD|EUR|GBP|COP|CAD|dólares?|dollars?|euros?)/i;
  const m = desc.match(re);
  if (!m) return null;
  const raw = m[0];
  let currency = 'USD';
  if (/EUR|€/i.test(raw)) currency = 'EUR';
  else if (/GBP|£/i.test(raw)) currency = 'GBP';
  else if (/COP|pesos?/i.test(raw)) currency = 'COP';
  else if (/CAD/i.test(raw)) currency = 'CAD';
  const numStr = ((m[1] || m[3]) ?? '').replace(/\./g, '').replace(/,/g, '.');
  const base = parseFloat(numStr);
  if (!base || isNaN(base) || base <= 0) return null;
  const mult = /^M|million/i.test(m[2] || m[4] || '') ? 1_000_000 : /^K/i.test(m[2] || m[4] || '') ? 1_000 : 1;
  const value = base * mult;
  const fmt = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
  const montoStr = `${fmt.format(value)} ${currency}`;
  // COP → columna amarilla; divisa extranjera → naranja + equivalente amarillo
  if (currency === 'COP') return { monto: '', montoCop: fmtCOP(value) };
  return { monto: montoStr, montoCop: fmtCOP(value * (eff[currency] ?? 4200)) };
}
function getLogoText(conv: Convocatoria): string {
  const src = conv.entidad_sigla || conv.donante || conv.titulo;
  const words = src.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
function inferSectores(titulo: string, desc: string, donante = ''): string[] {
  const t = `${titulo} ${desc} ${donante}`.toLowerCase();
  const tags: string[] = [];
  if (/ciencia|tecnolog|innovaci|investigaci|i\+d|r&d|minciencias|colciencias|laboratorio|patente|research|science|scientific|knowledge|journal|revista cient|publindex|artificial intelligence|machine learning|ia\b/.test(t)) tags.push('Ciencia, Tecnología e Innovación');
  if (/educaci|formaci|capacitaci|escuela|colegio|universidad|sena|beca|scholarship|fellowship|fellow\b|estudiante|docente|literacy|training program|capacity.?building|fortalecimiento de capacidades/.test(t)) tags.push('Educación');
  if (/salud|médico|medicina|hospital|cl[ií]nica|enfermedad|vacuna|healthcare|health|santé|disease|maternal|nutrition|salud p[uú]blica|mental health/.test(t)) tags.push('Salud');
  if (/medio ambiente|ambiental|biodiversidad|ecosistema|reforestaci|sostenibilidad|cambio clim|climate|conservation|nature|environmental|forest|bosque|ocean|marine|emisiones|co2|net.?zero|decarboniz|green economy/.test(t)) tags.push('Medio Ambiente');
  if (/energ[ií]a renovable|solar|fotovolt|eólica|biogás|hidroeléctrica|renewable energy|clean energy|energy transition|biomasa|wind energy|hydrogen/.test(t)) tags.push('Energías Renovables');
  if (/agua|acueducto|potabiliz|cuenca|hídrica|water supply|wash\b|drinking water/.test(t)) tags.push('Agua');
  if (/saneamiento|alcantarillado|aguas residuales|wastewater|sewage/.test(t)) tags.push('Saneamiento');
  if (/agricultura|agropecuario|cosecha|semillas|cultivo|ganadero|campesino|food security|seguridad alimentaria|livestock|piscicultura|acuicultura|aquaculture|fishery|pesca|crop/.test(t)) tags.push('Agricultura');
  if (/rural|comunidad rural|proyectos productivos|territorios rurales|small farmer|smallholder|desarrollo territorial/.test(t)) tags.push('Desarrollo Rural');
  if (/vivienda|vis\b|habitacional|mejoramiento de vivienda|housing|shelter|asentamientos|hábitat/.test(t)) tags.push('Vivienda');
  if (/infraestructura|construcci|obra civil|vial|carretera|puente|transporte|mobility|road|highway/.test(t)) tags.push('Construcción');
  if (/derechos humanos|human rights|víctimas|género|gender equality|violencia de género|inclusión|paz|peacebuilding|reconciliaci|desplazados|feminist|racial justice|lgbtq|discapacidad|indigenous|indígena|minority/.test(t)) tags.push('Derechos Humanos');
  if (/humanitari|emergencia|desastre|disaster|refugiado|refugee|migrante|crisis humanitaria|idp\b|food security|relief/.test(t)) tags.push('Ayuda Humanitaria');
  if (/justicia|acceso a la justicia|legal aid|gobernanza|governance|anticorrupci|transparency|transparencia|accountability|rule of law|estado de derecho/.test(t)) tags.push('Justicia');
  if (/emprendimiento|mipyme|pyme|cooperativa|capital semilla|microempresa|startup|microfinance|microcr[eé]dito|impact invest|venture|accelerat|fintech|entrepreneurship|livelihoods|income generation|value chain/.test(t)) tags.push('Emprendimiento y Cooperativismo');
  if (/turismo|ecoturismo|destino tur[ií]stico|tourism/.test(t)) tags.push('Turismo');
  if (/gesti[oó]n de riesgos|desastres naturales|prevenci[oó]n de riesgos|mitigaci[oó]n|inundaci[oó]n|disaster risk|resilience|resiliencia|drr\b/.test(t)) tags.push('Gestión de Riesgos');
  if (/cultura|cultural heritage|patrimonio|artes|música|danza|teatro|heritage|creative|artesano|periodismo|journalism|cinema|cine/.test(t)) tags.push('Cultura');
  if (/digital transform|transformaci[oó]n digital|e-government|digitalizaci|ict4d|cybersecurity|blockchain|iot\b|cloud computing/.test(t)) tags.push('Tecnologías');
  // Catch-all: cooperación internacional — aplica si no hay otro sector más específico
  if (tags.length === 0 && /cooperaci[oó]n|international|multilateral|bilateral|grant|funding|call for project|call for proposal|appel [aà] projet|subvenci|solidarity|open call|development fund|global fund|internationale/.test(t)) tags.push('Desarrollo Internacional');
  return tags.slice(0, 3);
}
function estadoBadge(conv: Pick<Convocatoria, 'estado' | 'created_at'>): 'abierta' | 'nueva' {
  if (conv.created_at) {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (new Date(conv.created_at).getTime() >= sevenDaysAgo) return 'nueva';
  }
  return 'abierta';
}

// ── SectorDropdown — multi-selección jerárquica ───────────────────────────────
const SectorDropdown = React.memo(function SectorDropdown({
  active,
  onChange,
}: {
  active: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(active);
    if (next.has(name)) next.delete(name); else next.add(name);
    onChange([...next]);
  };

  const toggleExpand = (nombre: string) => {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(nombre)) s.delete(nombre); else s.add(nombre);
      return s;
    });
  };

  const label =
    active.length === 0 ? 'Todos los sectores'
    : active.length === 1 ? active[0]
    : `${active.length} seleccionados`;

  return (
    <div className="radx__sector-drop" ref={panelRef}>
      <button
        className={`radx__sector-btn${active.length > 0 ? ' radx__sector-btn--active' : ''}`}
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"/>
        </svg>
        <span className="radx__sector-btn__label">{label}</span>
        {active.length > 0 && <span className="radx__sector-btn__badge">{active.length}</span>}
        <svg className={`radx__sector-btn__chevron${open ? ' radx__sector-btn__chevron--open' : ''}`} width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <div className="radx__sector-panel">
          {SECTORES_TAXONOMY.map(sector => {
            const isExpanded = expanded.has(sector.nombre);
            const isSectorChecked = active.includes(sector.nombre);
            const cssColor = { '--sector-color': sector.color } as React.CSSProperties;
            return (
              <div key={sector.nombre} className="radx__sector-sect" style={cssColor}>
                <div className="radx__sector-sect-hdr" onClick={() => toggleExpand(sector.nombre)}>
                  <input
                    type="checkbox"
                    checked={isSectorChecked}
                    onChange={() => {}}
                    onClick={e => toggle(sector.nombre, e)}
                    style={{ accentColor: sector.color }}
                  />
                  <span>{sector.nombre}</span>
                  <svg className={isExpanded ? 'open' : ''} width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </div>
                {isExpanded && (
                  <div className="radx__sector-subs">
                    {sector.subgrupos.map(sg => (
                      <div
                        key={sg.nombre}
                        className="radx__sector-sub-row"
                        onClick={e => toggle(sg.nombre, e)}
                        style={{ '--sector-color': sg.color } as React.CSSProperties}
                      >
                        <input
                          type="checkbox"
                          checked={active.includes(sg.nombre)}
                          onChange={() => {}}
                          style={{ accentColor: sg.color }}
                        />
                        <span className="radx__sector-sub-dot" style={{ background: sg.color }} />
                        <span>{sg.nombre}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// ── Paginador — limita la lista a bloques de 100, ventana actual resaltada ────
const ITEMS_POR_PAGINA = 100;

interface PaginadorProps {
  pagina: number;
  totalPaginas: number;
  onChange: (p: number) => void;
}

function rangoPaginas(pagina: number, totalPaginas: number): (number | '…')[] {
  if (totalPaginas <= 7) return Array.from({ length: totalPaginas }, (_, i) => i + 1);
  const set = new Set<number>([1, totalPaginas, pagina, pagina - 1, pagina + 1]);
  const nums = [...set].filter(n => n >= 1 && n <= totalPaginas).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - (nums[i - 1] as number) > 1) out.push('…');
    out.push(n);
  });
  return out;
}

const Paginador = React.memo(function Paginador({ pagina, totalPaginas, onChange }: PaginadorProps) {
  if (totalPaginas <= 1) return null;
  return (
    <div className="radx__paginador" role="navigation" aria-label="Paginación de convocatorias">
      <button
        className="radx__pag-btn"
        onClick={() => onChange(pagina - 1)}
        disabled={pagina === 1}
        aria-label="Vista anterior"
      >‹</button>
      {rangoPaginas(pagina, totalPaginas).map((p, i) =>
        p === '…'
          ? <span key={`e${i}`} className="radx__pag-ellipsis">…</span>
          : (
            <button
              key={p}
              className={`radx__pag-btn${p === pagina ? ' radx__pag-btn--activa' : ''}`}
              onClick={() => onChange(p)}
              aria-current={p === pagina ? 'page' : undefined}
            >{p}</button>
          )
      )}
      <button
        className="radx__pag-btn"
        onClick={() => onChange(pagina + 1)}
        disabled={pagina === totalPaginas}
        aria-label="Vista siguiente"
      >›</button>
      <span className="radx__pag-total">
        Vista <strong className="radx__pag-actual">{pagina}</strong> de {totalPaginas}
      </span>
    </div>
  );
});

// ── RadarHeader props ─────────────────────────────────────────────────────────
interface RadarHeaderProps {
  entidadId: string | null;
  entidadNombre: string | null;
  activeRastreo: null | '1';
  totalCount: number | null;
  shownCount: number;
  loading: boolean;
  refreshing: boolean;
  rastreo1: boolean;
  rastreo1Msg: string;
  busqueda: string;
  filtroPais: string;
  filtroSectores: string[];
  filtroEstado: string;
  filtroAplicaColombia: boolean;
  metaPaises: string[];
  onRastreo1: () => void;
  onRefresh: () => void;
  onBusqueda: (val: string) => void;
  onPais: (val: string) => void;
  onSectores: (vals: string[]) => void;
  onEstado: (val: string) => void;
  onToggleAplicaColombia: () => void;
  sortBy: string;
  onSortBy: (val: string) => void;
  onClearFilters: () => void;
  onClearEntity: () => void;
  pagina: number;
  totalPaginas: number;
  onCambiarPagina: (p: number) => void;
}

// ── RadarHeader — memoizado: no re-renderiza cuando cambia la lista ───────────
const RadarHeader = React.memo(function RadarHeader({
  entidadId, entidadNombre, activeRastreo, totalCount, shownCount, loading,
  refreshing, rastreo1, rastreo1Msg, busqueda,
  filtroPais, filtroSectores, filtroEstado, filtroAplicaColombia, metaPaises,
  onRastreo1, onRefresh, onBusqueda, onPais,
  onSectores, onEstado, onToggleAplicaColombia, sortBy, onSortBy, onClearFilters, onClearEntity,
  pagina, totalPaginas, onCambiarPagina,
}: RadarHeaderProps) {
  const countLabel = loading ? 'Cargando...' : (() => {
    const total = totalCount;
    if (total === null || total === shownCount) return `${shownCount} convocatoria${shownCount !== 1 ? 's' : ''}`;
    return `${shownCount} de ${total} convocatoria${total !== 1 ? 's' : ''}`;
  })();

  const hasActiveFilters = filtroPais !== 'Todos' || filtroSectores.length > 0 || filtroEstado !== 'todos' || busqueda || entidadId || sortBy !== 'relevancia' || filtroAplicaColombia;

  return (
    <div className="radx__header-wrapper">

      {/* Banner de filtro por entidad */}
      {entidadId && (
        <div className="radx__entity-banner">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Convocatorias de: <strong>{entidadNombre || entidadId}</strong></span>
          <button className="radx__entity-clear" onClick={onClearEntity} title="Ver todas las convocatorias">
            × Quitar filtro
          </button>
        </div>
      )}

      {/* Header — título+conteo a la izquierda y los 3 controles (Rastreo 1 /
          Aplica Colombia / buscador) a la derecha, EXACTAMENTE en su lugar de
          siempre. El paginador se inserta en el hueco entre ambos, sin mover
          ni redimensionar ninguno de los dos costados. */}
      <header className="radx__header">
        <div>
          <h1 className="radx__title">RADAR</h1>
          <p className="radx__count">
            {countLabel}
            {activeRastreo === '1' && <span className="radx__rastreo-badge radx__rastreo-badge--r1"> · Directorio</span>}
            {filtroAplicaColombia && <span className="radx__rastreo-badge radx__rastreo-badge--col"> · 🇨🇴 Colombia</span>}
          </p>
        </div>
        <Paginador pagina={pagina} totalPaginas={totalPaginas} onChange={onCambiarPagina} />
        <div className="radx__header-right">
          <button
            className={[
              'radx__barrido-btn',
              activeRastreo === '1' ? 'radx__barrido-btn--selected' : '',
              rastreo1 ? 'radx__barrido-btn--scanning' : '',
            ].filter(Boolean).join(' ')}
            onClick={onRastreo1}
            disabled={rastreo1 || loading}
            title={activeRastreo === '1' ? 'Clic para volver a ver todas' : 'Rastreo 1 — Convocatorias del Directorio'}
          >
            {rastreo1 ? '⏳ Escaneando…' : '🏢 Rastreo 1'}
          </button>
          <button
            className={['radx__barrido-btn', filtroAplicaColombia ? 'radx__barrido-btn--col' : ''].filter(Boolean).join(' ')}
            onClick={onToggleAplicaColombia}
            title={filtroAplicaColombia ? 'Mostrando solo convocatorias elegibles para Colombia — clic para quitar' : 'Filtrar convocatorias que aplican a Colombia'}
          >
            🇨🇴 Aplica Colombia
          </button>
          <div className="radx__search-wrap">
            <svg className="radx__search-icon" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
            <input
              className="radx__search"
              placeholder="Buscar convocatorias..."
              aria-label="Buscar convocatorias"
              type="text"
              value={busqueda}
              onChange={e => onBusqueda(e.target.value)}
            />
          </div>
        </div>
      </header>

      {/* Barra de filtros */}
      <div className="radx__filters">
        <div className="radx__filter-group">
          <label className="radx__filter-label">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            País
          </label>
          <select className="radx__filter-select" value={filtroPais} onChange={e => onPais(e.target.value)}>
            <option value="Todos">Todos</option>
            <option value="Colombia">Colombia</option>
            <option value="Internacional">Internacional</option>
            {metaPaises.filter(p => p !== 'Colombia' && p !== 'Internacional').map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="radx__filter-group">
          <label className="radx__filter-label">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"/>
            </svg>
            Sector
          </label>
          <SectorDropdown active={filtroSectores} onChange={onSectores} />
        </div>

        <div className="radx__filter-group">
          <label className="radx__filter-label">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            Estado
          </label>
          <select className="radx__filter-select" value={filtroEstado} onChange={e => onEstado(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="abierta">Abierta</option>
            <option value="nueva">Nueva</option>
          </select>
        </div>

        <div className="radx__filter-group">
          <label className="radx__filter-label">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="9" y1="18" x2="15" y2="18"/>
            </svg>
            Ordenar
          </label>
          <select className="radx__filter-select" value={sortBy} onChange={e => onSortBy(e.target.value)}>
            <option value="relevancia">Relevancia</option>
            <option value="alfabetico">Alfabético</option>
            <option value="ascendente">Ascendente</option>
            <option value="descendente">Descendente</option>
            <option value="pais">País</option>
            <option value="entidad">Entidad</option>
            <option value="fecha">Fecha</option>
          </select>
        </div>

        {hasActiveFilters && (
          <button className="radx__filter-clear" onClick={onClearFilters}>
            × Limpiar filtros
          </button>
        )}

        {filtroSectores.length > 0 && (
          <div className="radx__sector-chips">
            {filtroSectores.map(s => {
              const col = getSectorColor(s);
              return (
                <span
                  key={s}
                  className="radx__sector-chip"
                  style={{ '--chip-color': col, background: `${col}14`, borderColor: `${col}40`, color: col } as React.CSSProperties}
                >
                  {s}
                  <button onClick={() => onSectores(filtroSectores.filter(x => x !== s))} title={`Quitar ${s}`} style={{ color: col }}>×</button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Status bar — altura fija, nunca mueve el layout */}
      <div className="radx__status-bar" aria-live="polite">
        {rastreo1Msg && activeRastreo === '1' && <span className="radx__barrido-msg">{rastreo1Msg}</span>}
      </div>

    </div>
  );
});

// ── ConvocatoriasList — componente hijo puro (solo renderiza datos) ────────────
interface ListProps {
  items: (Convocatoria & { favorito: boolean })[];
  offset: number;
  loading: boolean;
  error: string | null;
  busqueda: string;
  filtroPais: string;
  filtroSectores: string[];
  copRates: Record<string, number>;
  onToggleFavorito: (id: string) => void;
  onRetry: () => void;
}

const ConvocatoriasList = React.memo(function ConvocatoriasList({
  items, offset, loading, error, busqueda, filtroPais, filtroSectores, copRates,
  onToggleFavorito, onRetry,
}: ListProps) {
  if (error) {
    return (
      <div className="radx__error">
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" strokeWidth="2" />
          <line x1="12" y1="8" x2="12" y2="12" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="16" x2="12.01" y2="16" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {error}
        <button className="radx__error-retry" onClick={onRetry}>REINTENTAR</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="radx__list">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="radx__skel-card">
            <div className="radx__skel-logo" />
            <div className="radx__skel-lines">
              <div className="radx__skel-block" style={{ width: '65%' }} />
              <div className="radx__skel-block" style={{ width: '40%', marginTop: 8 }} />
            </div>
            <div className="radx__skel-badge" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <main className="radx__list">
      {items.map((c, i) => {
        const paises   = parsePaises(c.paises_elegibles);
        const rawSects = parseSectores(c.sectores);
        const sects    = rawSects.length > 0 ? rawSects : inferSectores(c.titulo, c.descripcion || '', c.donante || '');
        const monto    = formatMonto(c.monto_min, c.monto_max, c.moneda);
        const montoCop = formatMontoCOP(c.monto_min, c.monto_max, c.moneda, copRates);
        const extracted = !monto ? tryExtractMonto(c.descripcion, copRates) : null;
        // Regla de columnas:
        // - COP o pais Colombia → monto va a columna amarilla (COP), naranja vacía
        // - Divisa extranjera   → naranja = divisa original; amarilla = equivalente COP
        const isCOP = c.moneda === 'COP';
        const displayMonto    = isCOP ? '' : (monto    || extracted?.monto    || '');
        const displayMontoCop = isCOP
          ? (monto || extracted?.monto || '')   // COP directo → columna amarilla
          : (montoCop || extracted?.montoCop || '');
        const badge    = estadoBadge(c);
        const entidad  = c.entidad_nombre || c.donante;

        return (
          <article key={c.id} className="radx__card">

            {/* Col 1 — Favorito */}
            <button
              className={c.favorito ? 'radx__star radx__star--on' : 'radx__star'}
              onClick={() => onToggleFavorito(c.id)}
              title={c.favorito ? 'Quitar de favoritos' : 'Agregar a favoritos'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={c.favorito ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>

            {/* Col 2 — Rank (posición global, no reinicia en cada vista) */}
            <span className="radx__rank">#{offset + i + 1}</span>

            {/* Col 3 — Logo */}
            <div className="radx__logo radx__logo--conv">{getLogoText(c)}</div>

            {/* Col 4 — Info: título (fila alta) + meta-stats (fila baja) */}
            <div className="radx__info">
              <h2 className="radx__name" title={c.titulo}>{c.titulo}</h2>
              {/* Meta: grid de 6 columnas fijas — badge | loc | entidad | fecha | monto | COP
                  Siempre se renderizan las 6 celdas para alineación vertical entre cards */}
              <div className="radx__meta">
                {/* Celda 1 — Badge estado */}
                <div className="radx__meta-badge">
                  <span className={`radx__badge radx__badge--${badge}`}>
                    <svg width="8" height="8" fill="currentColor" viewBox="0 0 8 8">
                      <circle cx="4" cy="4" r="4" />
                    </svg>
                    {badge.toUpperCase()}
                  </span>
                </div>
                {/* Celda 2 — Fecha límite o (Permanente) */}
                <span className="radx__meta-cell radx__meta-fecha" title={c.fecha_limite ? `Cierre: ${c.fecha_limite}` : 'Sin fecha de cierre'}>
                  {c.fecha_limite ? (
                    <>
                      <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" style={{flexShrink:0}}>
                        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                      {c.fecha_limite.slice(0, 10)}
                    </>
                  ) : (
                    <span style={{color:'#9ca3af', fontStyle:'italic', fontSize:'11px'}}>(Permanente)</span>
                  )}
                </span>
                {/* Celda 3 — Localización */}
                <span className="radx__meta-cell radx__meta-pais" title={paises.join(', ')}>
                  {paises.length > 0 && (
                    <><span className="radx__pin">📍</span>{paises.slice(0, 2).join(', ')}</>
                  )}
                </span>
                {/* Celda 4 — Entidad */}
                <span className="radx__meta-cell radx__meta-entidad" title={entidad}>
                  {entidad && (
                    <>
                      <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" style={{flexShrink:0}}>
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                      </svg>
                      {(c.entidad_sigla || entidad).slice(0, 18)}
                    </>
                  )}
                </span>
                {/* Celda 5 — Monto moneda local */}
                <span className="radx__meta-cell radx__meta-monto" title={displayMonto}>
                  {displayMonto && (
                    <><span className="radx__monto-icon">💰</span><span className="radx__meta-text">{displayMonto}</span></>
                  )}
                </span>
                {/* Celda 6 — Equivalente COP */}
                <span className="radx__meta-cell radx__meta-cop" title={displayMontoCop}>
                  {displayMontoCop && (() => {
                    const hasMM = displayMontoCop.endsWith(' (MM)');
                    const num = hasMM ? displayMontoCop.slice(0, -5) : displayMontoCop;
                    return (
                      <>
                        <span className="radx__cop-val"><span className="radx__cop-sign">≈$</span><span className="radx__cop-num">{num}</span></span>
                        <span className="radx__cop-mm">{hasMM ? '(MM)' : ''}</span>
                      </>
                    );
                  })()}
                </span>
                {/* Celda 7 — Tags de sector (después de $ COP, ocupa el espacio restante) */}
                <div className="radx__tags-col">
                  {sects.slice(0, 4).map(s => {
                    const col = getSectorColor(s);
                    return (
                      <span
                        key={s}
                        className="radx__tag"
                        style={{ background: `${col}18`, borderColor: `${col}40`, color: col }}
                      >
                        {s}
                      </span>
                    );
                  })}
                  {sects.length > 4 && <span className="radx__tag-extra">+{sects.length - 4}</span>}
                </div>
              </div>
            </div>

            {/* Col 5 — Chevron */}
            <a
              href={c.url_convocatoria || undefined}
              target="_blank"
              rel="noopener noreferrer"
              className={`radx__chevron${!c.url_convocatoria ? ' radx__chevron--disabled' : ''}`}
              title={c.url_convocatoria ? 'Ver convocatoria' : 'Sin enlace disponible'}
              onClick={e => { if (!c.url_convocatoria) e.preventDefault(); }}
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </a>

          </article>
        );
      })}

      {items.length === 0 && (
        <p className="radx__empty">
          {busqueda || filtroPais !== 'Todos' || filtroSectores.length > 0
            ? 'Sin convocatorias para los filtros seleccionados.'
            : 'No hay convocatorias registradas. El ingestor automático las cargará en el próximo ciclo.'}
        </p>
      )}
    </main>
  );
});

// ── LayoutPadre — componente raíz con todo el estado ─────────────────────────
export default function LayoutPadre() {
  const { token } = useAuth();
  const tokenRef = useRef<string | null>(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  const [searchParams, setSearchParams] = useSearchParams();
  const entidadId     = searchParams.get('entidad_id');
  const entidadNombre = searchParams.get('nombre');

  // ── Estado principal ──────────────────────────────────────────────────────
  const [activeRastreo, setActiveRastreo] = useState<null | '1'>(
    (searchParams.get('rastreo') === '1' ? '1' : null)
  );
  const [convocatorias, setConvocatorias] = useState<Convocatoria[]>([]);
  const [totalCount,    setTotalCount]    = useState<number | null>(null);
  const [meta,          setMeta]          = useState<MetaFiltros>({ sectores: [], paises: [] });
  const [loading,       setLoading]       = useState(false);
  const [refreshing,    setRefreshing]    = useState(false);
  const [scanning1,     setScanning1]     = useState(false);
  const [rastreo1Msg,   setRastreo1Msg]   = useState('');
  const [filtroAplicaColombia, setFiltroAplicaColombia] = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [pagina,        setPagina]        = useState(1);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const [busqueda,       setBusqueda]       = useState('');
  const [filtroPais,     setFiltroPais]     = useState('Todos');
  const [filtroSectores, setFiltroSectores] = useState<string[]>([]);
  const [filtroEstado,   setFiltroEstado]   = useState('todos');
  const [sortBy,         setSortBy]         = useState('relevancia');

  // ── Tasas de cambio COP ───────────────────────────────────────────────────
  const [copRates, setCopRates] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch('https://api.frankfurter.app/latest?from=USD&to=COP,EUR,GBP,CAD')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.rates?.COP) return;
        const usdCop = data.rates.COP as number;
        setCopRates({
          USD: usdCop,
          EUR: usdCop / (data.rates.EUR || 0.92),
          GBP: usdCop / (data.rates.GBP || 0.79),
          CAD: usdCop / (data.rates.CAD || 1.36),
          COP: 1,
        });
      })
      .catch(() => setCopRates({ USD: 4200, EUR: 4570, GBP: 5340, CAD: 3100, COP: 1 }));
  }, []);

  // ── Favoritos ─────────────────────────────────────────────────────────────
  const [favoritos, setFavoritos] = useState<Set<string>>(() => {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const legado = localStorage.getItem(STORAGE_KEY_LEGACY);
        if (legado) { localStorage.setItem(STORAGE_KEY, legado); localStorage.removeItem(STORAGE_KEY_LEGACY); raw = legado; }
      }
      return new Set(JSON.parse(raw || '[]'));
    }
    catch { return new Set(); }
  });

  // ── Refs para closures estables ───────────────────────────────────────────
  // favoritosRef sigue el mismo patrón manual que el resto de esta sección
  // (asignación directa en cada sitio que muta el estado, no un useEffect
  // genérico) — lo necesita toggleFavorito, un useCallback([]) que no puede
  // leer `favoritos` fresco por closure.
  const favoritosRef = useRef(favoritos);
  const busquedaRef  = useRef(busqueda);
  const paisRef      = useRef(filtroPais);
  const sectoresRef  = useRef(filtroSectores);
  const estadoRef    = useRef(filtroEstado);
  const rastreoRef   = useRef(activeRastreo);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Contador de generación: solo el fetch más reciente puede escribir estado
  const fetchGenRef  = useRef(0);
  const abortRef     = useRef<AbortController | null>(null);

  const switchRastreo = useCallback((r: null | '1') => {
    setActiveRastreo(r);
    rastreoRef.current = r;
    if (r) setSearchParams(p => { p.set('rastreo', r); return p; });
    else   setSearchParams(p => { p.delete('rastreo'); return p; });
  }, [setSearchParams]);

  // ── fetchConvocatorias — lógica central ───────────────────────────────────
  const fetchConvocatorias = useCallback(async (opts: {
    q?: string; pais?: string; sectores?: string[]; estado?: string;
    rastreo?: null | '1'; isRefresh?: boolean;
  } = {}) => {
    const q        = opts.q        !== undefined ? opts.q        : busquedaRef.current;
    const pais     = opts.pais     !== undefined ? opts.pais     : paisRef.current;
    const sectores = opts.sectores !== undefined ? opts.sectores : sectoresRef.current;
    const estado   = opts.estado   !== undefined ? opts.estado   : estadoRef.current;
    const rastreoActivo = opts.rastreo !== undefined ? opts.rastreo : rastreoRef.current;
    const isRefresh = opts.isRefresh ?? false;

    // Cancelar fetch anterior y asignar nueva generación
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myGen = ++fetchGenRef.current;

    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      // 2000 en vez de 500 — el backend no tiene tope propio (ver server.js,
      // ruta GET /api/convocatorias), así que el límite real siempre fue este
      // número acá. Con 605 convocatorias hoy se quedaban 105 sin poder verse
      // nunca, ni siquiera cambiando de vista en el paginador.
      const params = new URLSearchParams({ limit: '2000' });
      if (rastreoActivo)       params.set('rastreo', rastreoActivo);
      if (q)                   params.set('q', q);
      if (entidadId)           params.set('entidad_id', entidadId);
      if (pais !== 'Todos')    params.set('pais', pais);
      if (sectores.length > 0) params.set('sector', sectores.join('|||'));
      if (estado !== 'todos')  params.set('estado', estado);
      const res = await fetch(`/api/convocatorias?${params}`, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const json = await res.json();
      // Descartar respuesta si llegó una más reciente mientras esperábamos
      if (myGen !== fetchGenRef.current) return;
      const list: Convocatoria[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      setConvocatorias(list);
      if (typeof json?.total === 'number') setTotalCount(json.total);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // cancelación esperada
      if (myGen !== fetchGenRef.current) return;
      setError(e instanceof Error ? e.message : 'Error al cargar convocatorias');
    } finally {
      // Solo el fetch más reciente apaga los spinners
      if (myGen === fetchGenRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [entidadId]);

  // ── Acciones de rastreo ───────────────────────────────────────────────────
  // Usan rastreoRef.current (no activeRastreo del closure) → callbacks 100% estables.
  // RadarHeader.onRastreo1/2 son referencias fijas; solo re-renderiza cuando
  // cambian props de display (activeRastreo, loading, scanning1, etc.).
  const triggerRastreo1 = useCallback(async () => {
    if (rastreoRef.current === '1') {
      switchRastreo(null);
      fetchConvocatorias({ isRefresh: true, rastreo: null });
      return;
    }
    switchRastreo('1');
    setRastreo1Msg('');
    fetchConvocatorias({ rastreo: '1' });
    setScanning1(true);
    try {
      const authHeader: Record<string, string> = tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {};
      const res  = await fetch('/api/radar/rastreo1', { method: 'POST', headers: authHeader });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || `Error ${res.status}`);
      setRastreo1Msg(json.message || 'Rastreo 1 iniciado');
      setTimeout(() => fetchConvocatorias({ isRefresh: true, rastreo: '1' }), 15000);
    } catch (e) {
      setRastreo1Msg(e instanceof Error ? e.message : 'Error al iniciar Rastreo 1');
    } finally {
      setTimeout(() => setScanning1(false), 8000);
    }
  }, [fetchConvocatorias, switchRastreo]); // rastreoRef siempre apunta al valor actual — sin dep de estado

  const onToggleAplicaColombia = useCallback(() => {
    setFiltroAplicaColombia(prev => !prev);
  }, []);

  // ── Callbacks de filtros (useCallback → props estables para React.memo) ───
  const onRefresh = useCallback(() => fetchConvocatorias({ isRefresh: true }), [fetchConvocatorias]);

  const onBusqueda = useCallback((val: string) => {
    setBusqueda(val);
    busquedaRef.current = val;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchConvocatorias({ q: val }), 350);
  }, [fetchConvocatorias]);

  const onPais = useCallback((val: string) => {
    setFiltroPais(val);
    paisRef.current = val;
    fetchConvocatorias({ pais: val });
  }, [fetchConvocatorias]);

  const onSectores = useCallback((vals: string[]) => {
    setFiltroSectores(vals);
    sectoresRef.current = vals;
    fetchConvocatorias({ sectores: vals });
  }, [fetchConvocatorias]);

  const onEstado = useCallback((val: string) => {
    setFiltroEstado(val);
    estadoRef.current = val;
    fetchConvocatorias({ estado: val });
  }, [fetchConvocatorias]);

  const onClearFilters = useCallback(() => {
    setBusqueda('');          busquedaRef.current = '';
    setFiltroPais('Todos');   paisRef.current = 'Todos';
    setFiltroSectores([]);    sectoresRef.current = [];
    setFiltroEstado('todos'); estadoRef.current = 'todos';
    setSortBy('relevancia');
    setFiltroAplicaColombia(false);
    setActiveRastreo(null);   rastreoRef.current = null;
    setSearchParams({});
    // Si entidadId ya era null el useEffect([entidadId]) no dispara → fetch manual.
    // Si entidadId era no-null, setSearchParams({}) lo cambia a null → el efecto dispara solo.
    if (!entidadId) {
      fetchConvocatorias({ q: '', pais: 'Todos', sectores: [], estado: 'todos', rastreo: null });
    }
  }, [fetchConvocatorias, setSearchParams, entidadId]);

  const onClearEntity = useCallback(() => setSearchParams({}), [setSearchParams]);

  const toggleFavorito = useCallback((id: string) => {
    // FIX (react-doctor no-impure-state-updater, 2026-09-05): el write a
    // localStorage vivía dentro del updater de setFavoritos. Este callback
    // es un useCallback([]) — no puede leer `favoritos` por closure sin
    // quedar obsoleto, por eso usa favoritosRef (mismo patrón manual que
    // busquedaRef/paisRef/etc. en esta sección) en vez de `prev`.
    const t = tokenRef.current;
    const next = new Set(favoritosRef.current);
    if (next.has(id)) next.delete(id); else next.add(id);
    if (!t || t === 'demo-mode-token') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    }
    favoritosRef.current = next;
    setFavoritos(next);
    if (t && t !== 'demo-mode-token') {
      fetch(`/api/convocatorias/${id}/favorito`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      }).catch(() => {
        const revertido = new Set(favoritosRef.current);
        if (revertido.has(id)) revertido.delete(id); else revertido.add(id);
        favoritosRef.current = revertido;
        setFavoritos(revertido);
      });
    }
  }, []);

  // ── Efectos ───────────────────────────────────────────────────────────────
  useEffect(() => { fetchConvocatorias(); }, [entidadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carga países y sectores dinámicos desde la BD al montar
  useEffect(() => {
    fetch('/api/convocatorias/meta')
      .then(r => r.json())
      .then(j => { if (j.success) setMeta({ sectores: j.sectores ?? [], paises: j.paises ?? [] }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => fetchConvocatorias({ isRefresh: true });
    window.addEventListener('directorio:entity-added',   handler);
    window.addEventListener('directorio:entity-removed', handler);
    return () => {
      window.removeEventListener('directorio:entity-added',   handler);
      window.removeEventListener('directorio:entity-removed', handler);
    };
  }, [fetchConvocatorias]);

  // ── Lista final con favoritos resueltos, favoritos primero, luego sort ────
  const favFirst = useMemo(() => {
    const withFav = convocatorias.map(c => ({ ...c, favorito: favoritos.has(c.id) }));
    return [...withFav].sort((a, b) => Number(b.favorito) - Number(a.favorito));
  }, [convocatorias, favoritos]);

  const sortedItems = useMemo(() => {
    if (sortBy === 'relevancia') return favFirst;
    const arr = [...favFirst];
    switch (sortBy) {
      case 'alfabetico':
        return arr.sort((a, b) => (a.titulo || '').localeCompare(b.titulo || '', 'es', { sensitivity: 'base' }));
      case 'ascendente':
        return arr.sort((a, b) => (a.score_probabilidad ?? 0) - (b.score_probabilidad ?? 0));
      case 'descendente':
        return arr.sort((a, b) => (b.score_probabilidad ?? 0) - (a.score_probabilidad ?? 0));
      case 'pais':
        return arr.sort((a, b) => {
          const pa = (() => { try { return (JSON.parse(a.paises_elegibles) as string[])[0] ?? ''; } catch { return a.paises_elegibles || ''; } })();
          const pb = (() => { try { return (JSON.parse(b.paises_elegibles) as string[])[0] ?? ''; } catch { return b.paises_elegibles || ''; } })();
          return pa.localeCompare(pb, 'es', { sensitivity: 'base' });
        });
      case 'entidad':
        return arr.sort((a, b) => (a.entidad_nombre || a.donante || '').localeCompare(b.entidad_nombre || b.donante || '', 'es', { sensitivity: 'base' }));
      case 'fecha':
        return arr.sort((a, b) => {
          if (!a.fecha_limite && !b.fecha_limite) return 0;
          if (!a.fecha_limite) return 1;
          if (!b.fecha_limite) return -1;
          return a.fecha_limite.localeCompare(b.fecha_limite);
        });
      default: return arr;
    }
  }, [favFirst, sortBy]);

  // Filtro "Aplica Colombia": muestra solo convocatorias donde paises_elegibles
  // incluye "Colombia" o "Internacional" (aplica globalmente, Colombia incluida).
  const visibleItems = useMemo(() => {
    if (!filtroAplicaColombia) return sortedItems;
    return sortedItems.filter(c => {
      const raw = (c.paises_elegibles || '').toLowerCase();
      return raw.includes('colombia') || raw.includes('internacional') || raw.includes('global') || raw.includes('mundial') || raw === '[]' || raw === '';
    });
  }, [sortedItems, filtroAplicaColombia]);

  // ── Paginación — 100 por vista, se resetea a la vista 1 cuando cambia
  // cualquier filtro/búsqueda/orden (una vista vieja ya no tendría sentido
  // sobre un resultado distinto), y se ajusta si el total encoge.
  const totalPaginas = Math.max(1, Math.ceil(visibleItems.length / ITEMS_POR_PAGINA));
  useEffect(() => {
    setPagina(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, filtroPais, filtroSectores, filtroEstado, filtroAplicaColombia, sortBy, activeRastreo, entidadId]);
  useEffect(() => {
    setPagina(p => Math.min(p, totalPaginas));
  }, [totalPaginas]);
  const pageItems = useMemo(
    () => visibleItems.slice((pagina - 1) * ITEMS_POR_PAGINA, pagina * ITEMS_POR_PAGINA),
    [visibleItems, pagina]
  );
  const cambiarPagina = useCallback((p: number) => {
    setPagina(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="radx">
      <div className="radx__container">

        <RadarHeader
          entidadId={entidadId}
          entidadNombre={entidadNombre}
          activeRastreo={activeRastreo}
          totalCount={totalCount}
          shownCount={visibleItems.length}
          loading={loading}
          refreshing={refreshing}
          rastreo1={scanning1}
          rastreo1Msg={rastreo1Msg}
          busqueda={busqueda}
          filtroPais={filtroPais}
          filtroSectores={filtroSectores}
          filtroEstado={filtroEstado}
          filtroAplicaColombia={filtroAplicaColombia}
          metaPaises={meta.paises}
          onRastreo1={triggerRastreo1}
          onRefresh={onRefresh}
          onBusqueda={onBusqueda}
          onPais={onPais}
          onSectores={onSectores}
          onEstado={onEstado}
          onToggleAplicaColombia={onToggleAplicaColombia}
          sortBy={sortBy}
          onSortBy={setSortBy}
          onClearFilters={onClearFilters}
          onClearEntity={onClearEntity}
          pagina={pagina}
          totalPaginas={totalPaginas}
          onCambiarPagina={cambiarPagina}
        />

        <div className="radx__scroll-area">
          <ConvocatoriasList
            items={pageItems}
            offset={(pagina - 1) * ITEMS_POR_PAGINA}
            loading={loading}
            error={error}
            busqueda={busqueda}
            filtroPais={filtroPais}
            filtroSectores={filtroSectores}
            copRates={copRates}
            onToggleFavorito={toggleFavorito}
            onRetry={onRefresh}
          />
        </div>

      </div>
    </div>
  );
}
