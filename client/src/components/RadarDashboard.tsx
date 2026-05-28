import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// ── Types ─────────────────────────────────────────────────────────────────────
export type DonorType = 'BILATERAL' | 'MULTILATERAL' | 'PRIVADO' | 'GOBIERNO';
export type TagColor  = 'default' | 'blue' | 'green' | 'orange';

export interface DonorTag {
  label: string;
  color?: TagColor;
}

export interface Donor {
  id: string;
  acronym: string;
  name: string;
  shortName: string;
  type: DonorType;
  country: string;
  activeCalls: number;
  totalAmount: string;
  tags: DonorTag[];
}

export interface SelectedFilters {
  enabled: boolean;
  sectores: string[];
  customSectores: Record<string, string>;
  poblaciones: string[];
  customPoblaciones: Record<string, string>;
}

// ── Taxonomía de sectores (04 SECTOR) ────────────────────────────────────────
const SECTORES_MACRO = [
  {
    id: 'habitat',
    titulo: 'HÁBITAT Y TERRITORIO',
    color: '#0058be',
    items: ['Construcción', 'Vivienda', 'Transporte', 'Ordenamiento Territorial', 'Agua y Saneamiento', 'Energía'],
  },
  {
    id: 'soberania',
    titulo: 'SOBERANÍA Y VIDA',
    color: '#059669',
    items: ['Soberanía Alimentaria', 'Salud Pública', 'Seguridad Alimentaria', 'Nutrición', 'Ecosistemas', 'Biodiversidad'],
  },
  {
    id: 'paz',
    titulo: 'PAZ Y SOCIEDAD',
    color: '#9333ea',
    items: ['Paz y Reconciliación', 'Derechos Humanos', 'Convivencia', 'Género e Igualdad', 'Cultura e Identidad', 'Víctimas del Conflicto'],
  },
  {
    id: 'autonomia',
    titulo: 'AUTONOMÍA ECONÓMICA',
    color: '#ca8a04',
    items: ['Emprendimiento', 'Economía Solidaria', 'Agricultura', 'Ganadería', 'Comercio Local', 'Turismo Comunitario'],
  },
  {
    id: 'futuro',
    titulo: 'FUTURO Y CONOCIMIENTO',
    color: '#0284c7',
    items: ['Educación', 'Investigación', 'Innovación', 'Tecnología', 'Ciencia', 'Formación Técnica'],
  },
] as const;

// ── Taxonomía de población objetivo (05 CATEGORÍA POBLACIÓN) ─────────────────
const POBLACION_GRUPOS = [
  {
    id: 'institucional',
    letra: 'A',
    titulo: 'FORTALECIMIENTO INSTITUCIONAL Y GUBERNAMENTAL',
    color: '#0058be',
    items: ['Alcaldías / Municipios', 'Gobernaciones', 'Cuerpos de Socorro', 'Instituciones Educativas'],
  },
  {
    id: 'comunitario',
    letra: 'B',
    titulo: 'ORGANIZACIONES COMUNITARIAS Y DE BASE',
    color: '#059669',
    items: ['Juntas de Acción Comunal (JAC)', 'Centros de Bienestar', 'Grupos de Voluntariado y Minga'],
  },
  {
    id: 'productivo',
    letra: 'C',
    titulo: 'DESARROLLO PRODUCTIVO Y RURAL',
    color: '#ca8a04',
    items: ['Campesinos', 'Asociaciones Productivas', 'Emprendedores y Microempresarios'],
  },
] as const;

// ── Datos donantes ────────────────────────────────────────────────────────────
const DONORS: Donor[] = [
  {
    id: 'giz', acronym: 'DE',
    name: 'GIZ - Agencia Alemana de Cooperación Internacional',
    shortName: 'GIZ', type: 'BILATERAL', country: 'Alemania',
    activeCalls: 3, totalAmount: '$5.0M USD',
    tags: [{ label: 'Paz' }, { label: 'Medio Ambiente' }, { label: 'Recursos Naturales' }, { label: 'Agua' }, { label: 'Ruralidad' }],
  },
  {
    id: 'unesco', acronym: 'UN',
    name: 'UNESCO - Organización de las Naciones Unidas para la Educación',
    shortName: 'UNESCO', type: 'MULTILATERAL', country: 'Francia',
    activeCalls: 3, totalAmount: '$5.0M USD',
    tags: [{ label: 'Educacion', color: 'blue' }, { label: 'Cultura' }, { label: 'Ciencia' }, { label: 'Patrimonio' }, { label: 'Comunicacion' }],
  },
  {
    id: 'jica', acronym: 'JP',
    name: 'JICA - Japan International Cooperation Agency',
    shortName: 'JICA', type: 'BILATERAL', country: 'Japón',
    activeCalls: 2, totalAmount: '$70K USD',
    tags: [{ label: 'Saneamiento' }, { label: 'Infraestructura Social' }, { label: 'Desarrollo Comunitario' }, { label: 'Cooperativismo' }],
  },
  {
    id: 'ikea', acronym: 'SE',
    name: 'IKEA Foundation',
    shortName: 'IKEA Foundation', type: 'PRIVADO', country: 'Suecia',
    activeCalls: 3, totalAmount: '$5.0M USD',
    tags: [{ label: 'Impacto Social' }, { label: 'Desarrollo Comunitario' }, { label: 'Sostenibilidad' }, { label: 'Clima' }],
  },
  {
    id: 'unwomen', acronym: 'UN',
    name: 'UN Women - ONU Mujeres',
    shortName: 'UN Women', type: 'MULTILATERAL', country: 'EE.UU.',
    activeCalls: 3, totalAmount: '$5.0M USD',
    tags: [{ label: 'Igualdad de Genero' }, { label: 'Emprendimiento', color: 'orange' }, { label: 'Paz' }, { label: 'Violencia de Genero' }, { label: 'Liderazgo' }],
  },
  {
    id: 'ue', acronym: 'EU',
    name: 'Unión Europea - European Commission',
    shortName: 'UE', type: 'MULTILATERAL', country: 'UE',
    activeCalls: 1, totalAmount: '$500K USD',
    tags: [{ label: 'Paz' }, { label: 'Clima', color: 'green' }, { label: 'Gobernanza' }, { label: 'Investigacion' }, { label: 'Desarrollo Sostenible' }],
  },
  {
    id: 'sena', acronym: 'CO',
    name: 'SENA - Fondo Emprender',
    shortName: 'SENA', type: 'GOBIERNO', country: 'Colombia',
    activeCalls: 3, totalAmount: '$5.0M USD',
    tags: [{ label: 'Emprendimiento', color: 'orange' }, { label: 'Empresarial' }, { label: 'Formacion' }, { label: 'Innovacion' }, { label: 'Jovenes' }],
  },
  {
    id: 'dap', acronym: 'AU',
    name: 'Direct Aid Program - Embajada de Australia',
    shortName: 'DAP', type: 'BILATERAL', country: 'Australia',
    activeCalls: 1, totalAmount: '$40K USD',
    tags: [{ label: 'Comunidad' }, { label: 'Educación', color: 'blue' }, { label: 'Saneamiento' }, { label: 'Desarrollo Rural' }],
  },
];

// ── SVG paths por tipo ────────────────────────────────────────────────────────
const TYPE_ICON: Record<DonorType, string> = {
  BILATERAL:    'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.102',
  MULTILATERAL: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  PRIVADO:      'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  GOBIERNO:     'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
};

const TYPE_BADGE_CLASS: Record<DonorType, string> = {
  BILATERAL:    'badge-bilateral',
  MULTILATERAL: 'badge-multilateral',
  PRIVADO:      'badge-privado',
  GOBIERNO:     'badge-gobierno',
};

const TAG_CLASS: Record<TagColor, string> = {
  default: 'tag-default',
  blue:    'tag-blue',
  green:   'tag-green',
  orange:  'tag-orange',
};

const STITCH_CSS = `
  .badge-bilateral    { color: #059669; border-color: #059669; }
  .badge-multilateral { color: #0284c7; border-color: #0284c7; }
  .badge-privado      { color: #9333ea; border-color: #9333ea; }
  .badge-gobierno     { color: #ca8a04; border-color: #ca8a04; }
  .tag-default { color: #45464d; background-color: transparent; border-color: transparent; }
  .tag-blue    { color: #0058be; background-color: rgba(0,88,190,0.10); }
  .tag-green   { color: #16a34a; background-color: rgba(22,163,74,0.10); }
  .tag-orange  { color: #ea580c; background-color: rgba(234,88,12,0.10); }
  .filter-item-btn { transition: border-color 0.15s, background 0.15s; }
  .filter-item-btn.selected { border-color: #0058be; background: rgba(0,88,190,0.06); }
  .filter-item-btn .sel-circle { border-color: #c6c6cd; }
  .filter-item-btn.selected .sel-circle { border-color: #0058be; background: #0058be; }
  @keyframes spin-once { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  .sync-spinning { animation: spin-once 1.5s linear; }
`;

// ── Sub-componentes ───────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: DonorType }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-medium text-xs ${TYPE_BADGE_CLASS[type]}`}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={TYPE_ICON[type]} />
      </svg>
      {type}
    </span>
  );
}

function DonorCard({ donor, index, onSelect }: { donor: Donor; index: number; onSelect: (d: Donor) => void }) {
  const visibleTags = donor.tags.slice(0, 3);
  const overflow    = donor.tags.length - 3;

  return (
    <article className="bg-surface-container border-l-4 border-l-outline-variant hover:border-l-primary transition-colors rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <span className="text-sm font-bold text-outline mr-1 shrink-0">#{index + 1}</span>
        <div className="w-12 h-12 rounded-lg bg-surface-container-high flex items-center justify-center text-onSurface font-bold text-lg shrink-0">
          {donor.acronym}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-onSurface truncate">
            {donor.name} <span className="text-outline font-normal">({donor.shortName})</span>
          </h2>
          <div className="flex items-center gap-4 mt-2 text-xs text-onSurface-variant flex-wrap">
            <div className="w-[140px] shrink-0"><TypeBadge type={donor.type} /></div>
            <div className="grid gap-2 items-center grid-cols-[102px_60px_120px_24px]">
              <span className="flex items-center gap-1 truncate"><span className="text-red-500 shrink-0">📍</span>{donor.country}</span>
              <span className="flex items-center gap-1 shrink-0">📄 {donor.activeCalls} conv.</span>
              <span className="flex items-center gap-1 text-yellow-600 shrink-0">💰 <span className="text-onSurface-variant">{donor.totalAmount}</span></span>
              <span className="flex items-center justify-center font-medium shrink-0">$</span>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 self-end md:self-auto w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
        {visibleTags.map(tag => (
          <span key={tag.label} className={`text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap ${TAG_CLASS[tag.color ?? 'default']}`}>
            {tag.label}
          </span>
        ))}
        {overflow > 0 && (
          <span className="text-xs font-medium text-outline bg-surface-container-high px-2 rounded-md">+{overflow}</span>
        )}
        <button
          onClick={() => { console.log('Abriendo detalles...'); onSelect(donor); }}
          aria-label={`Ver detalle de ${donor.shortName}`}
          className="text-outline hover:text-onSurface p-1 rounded-md ml-2 hidden md:block cursor-pointer"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </article>
  );
}

// ── Panel de Filtros ──────────────────────────────────────────────────────────
function FilterPanel({
  initialFilters,
  onApply,
  onClose,
}: {
  initialFilters: SelectedFilters;
  onApply: (f: SelectedFilters) => void;
  onClose: () => void;
}) {
  const [temp, setTemp] = useState<SelectedFilters>(initialFilters);

  const totalTemp = temp.sectores.length + temp.poblaciones.length;

  function toggleSector(item: string) {
    setTemp(f => ({
      ...f,
      sectores: f.sectores.includes(item)
        ? f.sectores.filter(s => s !== item)
        : [...f.sectores, item],
    }));
  }

  function setCustomSector(macroId: string, value: string) {
    setTemp(f => ({ ...f, customSectores: { ...f.customSectores, [macroId]: value } }));
  }

  function togglePoblacion(item: string) {
    setTemp(f => ({
      ...f,
      poblaciones: f.poblaciones.includes(item)
        ? f.poblaciones.filter(p => p !== item)
        : [...f.poblaciones, item],
    }));
  }

  function setCustomPoblacion(grupoId: string, value: string) {
    setTemp(f => ({ ...f, customPoblaciones: { ...f.customPoblaciones, [grupoId]: value } }));
  }

  function clearAll() {
    setTemp({ ...initialFilters, sectores: [], poblaciones: [], customSectores: {}, customPoblaciones: {} });
  }

  function handleApply() {
    const next: SelectedFilters = {
      ...temp,
      enabled: temp.sectores.length > 0 || temp.poblaciones.length > 0,
    };
    onApply(next);
  }

  return (
    <div className="bg-white border border-[#e2e8f0] rounded-xl shadow-sm overflow-hidden">

      {/* ── Cabecera ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#e2e8f0]">
        <div className="flex items-center gap-3">
          <svg width="20" height="20" className="w-5 h-5 text-[#0058be]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <span className="text-sm font-bold text-[#1e293b]">Filtros de Búsqueda Estratégica</span>
          {totalTemp > 0 && (
            <span className="text-xs font-semibold bg-[#0058be] text-white px-2 py-0.5 rounded-full">
              {totalTemp} seleccionado{totalTemp !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {totalTemp > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-[#64748b] hover:text-[#ef4444] underline underline-offset-2 transition-colors"
          >
            Limpiar todo
          </button>
        )}
      </div>

      {/* ── Cuerpo ── */}
      <div className="p-5 space-y-6">

        {/* ══ 04 SECTOR ══ */}
        <section>
          <h3 className="text-xs font-bold text-[#64748b] uppercase tracking-widest mb-4 flex items-center gap-2">
            <span className="bg-[#f1f5f9] text-[#475569] px-2 py-0.5 rounded font-mono">04</span>
            SECTOR
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {SECTORES_MACRO.map(macro => (
              <div key={macro.id} className="bg-[#f8fafc] border border-[#e2e8f0] rounded-xl p-4">
                <h4 className="text-xs font-bold mb-3 pb-2 border-b border-[#e2e8f0]" style={{ color: macro.color }}>
                  {macro.titulo}
                </h4>
                <ul className="space-y-2">
                  {macro.items.map(item => {
                    const checked = temp.sectores.includes(item);
                    return (
                      <li key={item}>
                        <label className="flex items-center gap-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSector(item)}
                            className="w-3.5 h-3.5 rounded border-[#cbd5e1] cursor-pointer accent-[#0058be] shrink-0"
                          />
                          <span className={`text-xs leading-snug transition-colors ${checked ? 'text-[#0058be] font-medium' : 'text-[#475569] group-hover:text-[#1e293b]'}`}>
                            {item}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 pt-2 border-t border-[#e2e8f0]">
                  <input
                    type="text"
                    value={temp.customSectores[macro.id] ?? ''}
                    onChange={e => setCustomSector(macro.id, e.target.value)}
                    placeholder="Otro: Especifique..."
                    className="w-full text-xs text-[#475569] placeholder-[#94a3b8] bg-transparent border-none outline-none"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ══ 05 CATEGORÍA DE LA POBLACIÓN OBJETIVO ══ */}
        <section>
          <h3 className="text-xs font-bold text-[#64748b] uppercase tracking-widest mb-4 flex items-center gap-2">
            <span className="bg-[#f1f5f9] text-[#475569] px-2 py-0.5 rounded font-mono">05</span>
            CATEGORÍA DE LA POBLACIÓN OBJETIVO
          </h3>
          <div className="space-y-4">
            {POBLACION_GRUPOS.map(grupo => (
              <div key={grupo.id} className="bg-[#f8fafc] border border-[#e2e8f0] rounded-xl p-4">
                <h4 className="text-xs font-bold mb-3 flex items-center gap-2" style={{ color: grupo.color }}>
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                    style={{ background: grupo.color }}
                  >
                    {grupo.letra}
                  </span>
                  {grupo.titulo}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {grupo.items.map(item => {
                    const selected = temp.poblaciones.includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => togglePoblacion(item)}
                        className={`filter-item-btn flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${selected ? 'selected border-[#0058be] bg-[rgba(0,88,190,0.06)] text-[#0058be]' : 'border-[#e2e8f0] bg-white text-[#475569] hover:border-[#0058be] hover:bg-[rgba(0,88,190,0.03)]'}`}
                      >
                        <span className={`sel-circle w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${selected ? 'border-[#0058be] bg-[#0058be]' : 'border-[#cbd5e1] bg-white'}`}>
                          {selected && (
                            <svg width="10" height="10" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        {item}
                      </button>
                    );
                  })}
                  <div className="filter-item-btn flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border border-dashed border-[#cbd5e1] bg-white col-span-full sm:col-span-1">
                    <span className="sel-circle w-4 h-4 rounded-full border-2 border-[#cbd5e1] bg-white shrink-0" />
                    <input
                      type="text"
                      value={temp.customPoblaciones[grupo.id] ?? ''}
                      onChange={e => setCustomPoblacion(grupo.id, e.target.value)}
                      placeholder="Otros: Escribir aquí..."
                      className="flex-1 text-xs text-[#475569] placeholder-[#94a3b8] bg-transparent border-none outline-none"
                      onClick={e => e.stopPropagation()}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Pie del panel ── */}
      <div className="flex items-center justify-between px-5 py-4 border-t border-[#e2e8f0] bg-[#f8fafc]">
        <span className="text-xs text-[#64748b]">
          {totalTemp > 0
            ? `${totalTemp} criterio${totalTemp !== 1 ? 's' : ''} seleccionado${totalTemp !== 1 ? 's' : ''}`
            : 'Sin criterios seleccionados'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[#e2e8f0] text-[#64748b] text-xs font-medium hover:bg-[#f1f5f9] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-5 py-2 rounded-lg bg-[#0058be] text-white text-xs font-semibold hover:bg-[#0044a3] transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
            Aplicar{totalTemp > 0 ? ` (${totalTemp})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
interface RadarDashboardProps {
  onDonorSelect?: (donor: Donor) => void;
  onFiltersChange?: (filters: SelectedFilters) => void;
  children?: React.ReactNode;
}

const FILTERS_INITIAL: SelectedFilters = {
  enabled: false,
  sectores: [],
  customSectores: {},
  poblaciones: [],
  customPoblaciones: {},
};

export default function RadarDashboard({ onDonorSelect, onFiltersChange, children }: RadarDashboardProps) {
  const [search, setSearch]           = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilters, setActiveFilters] = useState<SelectedFilters>(FILTERS_INITIAL);
  const [syncing, setSyncing]         = useState(false);
  const navigate = useNavigate();

  function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setTimeout(() => setSyncing(false), 1500);
  }

  function handleApply(next: SelectedFilters) {
    setActiveFilters(next);
    setShowFilters(false);
    onFiltersChange?.(next);
  }

  const filtered = DONORS.filter(d => {
    const matchSearch =
      !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.country.toLowerCase().includes(search.toLowerCase()) ||
      d.tags.some(t => t.label.toLowerCase().includes(search.toLowerCase()));

    const matchSector =
      !activeFilters.enabled ||
      activeFilters.sectores.length === 0 ||
      d.tags.some(t =>
        activeFilters.sectores.some(s => t.label.toLowerCase().includes(s.toLowerCase().split(' ')[0]))
      );

    return matchSearch && matchSector;
  });

  const activeFiltersCount = activeFilters.sectores.length + activeFilters.poblaciones.length;

  return (
    <>
      <style>{STITCH_CSS}</style>

      <div className="max-w-7xl mx-auto space-y-6 p-6 md:p-8">

        {/* ── Header ── */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-onSurface">RADAR FONDOS 360</h1>
            <p className="text-sm text-outline font-medium mt-1">
              {filtered.length} entidade{filtered.length !== 1 ? 's' : ''} encontrada{filtered.length !== 1 ? 's' : ''}
              {activeFilters.enabled && activeFiltersCount > 0 && (
                <span className="ml-2 text-[#0058be]">· {activeFiltersCount} filtro{activeFiltersCount !== 1 ? 's' : ''} activo{activeFiltersCount !== 1 ? 's' : ''}</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            {/* Búsqueda */}
            <div className="w-full md:w-80 relative">
              <svg width="20" height="20" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-outline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                className="w-full bg-surface-container border border-outline-variant text-onSurface text-sm rounded-full pl-10 p-2.5 placeholder-outline-variant focus:ring-secondary focus:border-secondary outline-none"
                placeholder="Buscar organizaciones..."
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* Botón sincronizar */}
            <button
              onClick={handleSync}
              title="Sincronizar datos oficiales"
              disabled={syncing}
              className="shrink-0 p-2.5 rounded-full bg-surface-container border border-outline-variant text-outline hover:text-onSurface hover:border-outline transition-colors disabled:opacity-60"
            >
              <svg
                className={`w-5 h-5 ${syncing ? 'sync-spinning' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            {/* Botón filtros */}
            <button
              onClick={() => setShowFilters(v => !v)}
              title="Filtros estratégicos"
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-full border text-sm font-medium transition-colors ${showFilters ? 'bg-[#0058be] text-white border-[#0058be]' : 'bg-surface-container border-outline-variant text-outline hover:text-onSurface hover:border-outline'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
              </svg>
              Filtros
              {activeFiltersCount > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${showFilters ? 'bg-white text-[#0058be]' : 'bg-[#0058be] text-white'}`}>
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {/* Engranaje → settings */}
            <button
              onClick={() => navigate('/settings')}
              title="Panel de Control"
              className="shrink-0 p-2.5 rounded-full bg-surface-container border border-outline-variant text-outline hover:text-onSurface hover:border-outline transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </header>

        {/* ── Panel de filtros (colapsable) ── */}
        {showFilters && (
          <FilterPanel
            initialFilters={activeFilters}
            onApply={handleApply}
            onClose={() => setShowFilters(false)}
          />
        )}

        {/* ── Lista de entidades ── */}
        <main className="space-y-3">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-outline">
              No se encontraron entidades{search ? ` para "${search}"` : ''}{activeFilters.enabled && activeFiltersCount > 0 ? ' con los filtros activos' : ''}
            </div>
          ) : (
            filtered.map((donor, i) => (
              <DonorCard key={donor.id} donor={donor} index={i} onSelect={d => onDonorSelect?.(d)} />
            ))
          )}
        </main>

        {children && (
          <footer className="flex justify-end pt-4 border-t border-outline-variant text-xs text-outline">
            {children}
          </footer>
        )}
      </div>
    </>
  );
}
