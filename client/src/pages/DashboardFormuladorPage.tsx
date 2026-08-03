import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getAuthHeaders } from '../lib/apiClient';
import ProyectoSelectorModal from '../components/ProyectoSelectorModal';
import CoPilotoSidebarChat from '../components/copiloto/CoPilotoSidebarChat';
import {
  LayoutDashboard, FileText, Target, Paperclip, ShieldAlert,
  Lightbulb, Wallet, BarChart2, ArrowLeftRight, Settings,
  List, Grid, CheckSquare, Download, ChevronDown,
  ChevronRight, ChevronUp, Leaf, Users, TrendingUp,
  TrendingDown, Scale, Cog, Droplets, RefreshCw, TreePine,
  DollarSign, Percent, Cpu, HelpCircle, User, AlertTriangle,
  Clock, Activity, Zap, CheckCircle2, Heart, Globe, Network,
  BookOpen, Building2, Waves, Equal, Utensils,
} from 'lucide-react';

// ── Paleta light mode — fondo blanco, texto oscuro ───────────────────────────
export const C = {
  bgMain:        '#f0f2f5',   // fondo general gris muy claro
  bgSidebar:     '#ffffff',   // sidebar izquierda y panel derecho blancos
  bgHeader:      '#ffffff',   // encabezado blanco
  bgSection:     '#f3f6f9',   // fondo del grid de indicadores (gris claro)
  bgCard:        '#ffffff',   // tarjetas blancas puras
  bgCardHover:   '#f9fafb',   // hover muy sutil
  bgRightRow:    '#f8f9fa',   // filas panel derecho
  border:        '#d0d9e4',   // bordes visibles azulados
  borderStrong:  '#b0bec9',   // bordes más visibles
  text:          '#111827',   // texto principal oscuro
  textMuted:     '#6b7280',   // texto secundario gris
  textDim:       '#9ca3af',   // texto terciario
  cyan:          '#2563eb',   // azul primario
  cyanSoft:      '#93c5fd',   // azul suave
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────
type BadgeStatus = 'Validado' | 'En Borrador' | 'Pendiente';
type RiskLevel   = 'CRÍTICO' | 'ALTO' | 'MEDIO' | 'BAJO';

interface Indicator {
  name: string;
  value: string;
  unit: string;
  status: BadgeStatus;
  date: string;
  user: string;
  icon: React.ReactNode;
  valueColor?: string;
}
interface ImpactSection {
  id: string;
  roman: string;
  title: string;
  weight: number;
  score: number;
  pendiente?: boolean;
  fuente?: string | null;
  color: string;
  icon: React.ReactNode;
  indicators: Indicator[];
}

// ── Scoring dinámico — GET /api/proyectos/:id/scoring-dinamico ──────────────
interface DimensionScore { score: number | null; pendiente: boolean; fuente: string | null }
interface ScoringDinamico {
  proyectoId: string;
  calculadoEn: string;
  dimensiones: {
    ambiental: DimensionScore;
    social: DimensionScore;
    economico: DimensionScore;
    normativo: DimensionScore;
    operativo: DimensionScore;
  };
}
interface Risk    { level: RiskLevel; title: string; description: string; section: string }
interface Action  { title: string; section: string; priority?: 'Alta'|'Media'|'Baja'; progress?: number; due?: string }
interface LogEntry{ date: string; time: string; user: string; action: string }

// ── Datos estáticos — pesos e indicadores ilustrativos de UI por dimensión.
// Los SCORES vienen siempre del backend real (mergeScoring); estos indicadores
// individuales (nombre/valor/usuario) son marcadores de layout, no datos reales
// — no existe todavía una fuente de verdad backend por indicador atómico.
const SECTIONS: ImpactSection[] = [
  {
    id: 'ambiental', roman: 'I', title: 'IMPACTO AMBIENTAL',
    weight: 25, score: 78, color: '#22c55e', icon: <Leaf size={15}/>,
    indicators: [
      { name:'Huella de Carbono',                    value:'2.45',    unit:'tCO₂e / año',        status:'Validado',    date:'23/06', user:'Ana L.',    icon:<Activity size={20}/> },
      { name:'Eficiencia de Recursos (Agua / Energía)',value:'82%',   unit:'Índice de eficiencia',status:'Validado',    date:'21/06', user:'Ana L.',    icon:<Droplets size={20}/> },
      { name:'Economía Circular',                    value:'65%',     unit:'Materiales valorizados',status:'En Borrador',date:'20/06', user:'Ana L.',    icon:<RefreshCw size={20}/> },
      { name:'Impacto Ecosistémico',                 value:'72',      unit:'Índice (0-100)',      status:'Pendiente',   date:'19/06', user:'Ana L.',    icon:<TreePine size={20}/> },
    ],
  },
  {
    id: 'social', roman: 'II', title: 'IMPACTO SOCIAL',
    weight: 20, score: 74, color: '#3b82f6', icon: <Users size={15}/>,
    indicators: [
      { name:'Generación de Valor Social', value:'68',  unit:'Índice (0-100)',      status:'En Borrador', date:'22/06', user:'Carlos M.', icon:<Zap size={20}/> },
      { name:'Estabilidad Territorial',    value:'71%', unit:'Índice de estabilidad',status:'Validado',    date:'23/06', user:'Carlos M.', icon:<Target size={20}/> },
      { name:'Equidad e Inclusión',        value:'63%', unit:'Índice de inclusión',  status:'En Borrador', date:'18/06', user:'Carlos M.', icon:<Users size={20}/> },
      { name:'Gobernanza y Licencia Social',value:'80%',unit:'Índice de confianza',  status:'Validado',    date:'21/06', user:'Carlos M.', icon:<Grid size={20}/> },
    ],
  },
  {
    id: 'economico', roman: 'III', title: 'IMPACTO ECONÓMICO',
    weight: 25, score: 76, color: '#f59e0b', icon: <BarChart2 size={15}/>,
    indicators: [
      { name:'VAN (Valor Actual Neto)',      value:'$ 2.45 M', unit:'COP',             status:'Validado',    date:'23/06', user:'Juliana R.', icon:<TrendingUp size={20}/> },
      { name:'TIR (Tasa Interna de Retorno)',value:'18.6%',    unit:'Porcentaje',       status:'Validado',    date:'22/06', user:'Juliana R.', icon:<Percent size={20}/> },
      { name:'Punto de Equilibrio',          value:'3.2',      unit:'Año',              status:'En Borrador', date:'19/06', user:'Juliana R.', icon:<Scale size={20}/> },
      { name:'Sensibilidad (Esc. Pesimista)',value:'-12.4%',   unit:'Variación VAN',    status:'Pendiente',   date:'18/06', user:'Juliana R.', icon:<TrendingDown size={20}/>, valueColor:'#ef4444' },
    ],
  },
  {
    id: 'normativo', roman: 'IV', title: 'IMPACTO NORMATIVO',
    weight: 15, score: 81, color: '#a855f7', icon: <Scale size={15}/>,
    indicators: [
      { name:'Cumplimiento Regulatorio',      value:'88%', unit:'Índice de cumplimiento', status:'Validado',    date:'20/06', user:'Andrés G.', icon:<CheckSquare size={20}/> },
      { name:'Alineación Políticas Públicas', value:'76%', unit:'Índice de alineación',   status:'En Borrador', date:'20/06', user:'Andrés G.', icon:<ArrowLeftRight size={20}/> },
      { name:'Gestión Riesgo Jurídico',       value:'70%', unit:'Índice de gestión',      status:'En Borrador', date:'17/06', user:'Andrés G.', icon:<ShieldAlert size={20}/> },
      { name:'Propiedad Intelectual',         value:'85%', unit:'Índice de protección',   status:'Validado',    date:'21/06', user:'Andrés G.', icon:<FileText size={20}/> },
    ],
  },
  {
    id: 'operativo', roman: 'V', title: 'IMPACTO OPERATIVO',
    weight: 15, score: 73, color: '#ef4444', icon: <Cog size={15}/>,
    indicators: [
      { name:'Sostenibilidad Operativa',       value:'72%', unit:'Índice operativo',    status:'En Borrador', date:'19/06', user:'Laura P.', icon:<Cog size={20}/> },
      { name:'Autonomía Tecnológica',          value:'65%', unit:'Índice de autonomía', status:'Pendiente',   date:'18/06', user:'Laura P.', icon:<Cpu size={20}/> },
      { name:'Capacidad de Absorción',         value:'70%', unit:'Índice de absorción', status:'En Borrador', date:'18/06', user:'Laura P.', icon:<Activity size={20}/> },
      { name:'Eficiencia del Gasto Operativo', value:'75%', unit:'Índice de eficiencia',status:'Validado',    date:'23/06', user:'Laura P.', icon:<DollarSign size={20}/> },
    ],
  },
];

// ── ODS — íconos oficiales recortados de FOTOS PROY3/arq radar formulador 360/ODS.webp
type OdsEntry = { num: number; name: string };
const ODS_ALL: OdsEntry[] = [
  { num:1,  name:'Fin de la Pobreza' },
  { num:2,  name:'Hambre Cero' },
  { num:3,  name:'Salud y Bienestar' },
  { num:4,  name:'Educación de Calidad' },
  { num:5,  name:'Igualdad de Género' },
  { num:6,  name:'Agua Limpia y Saneamiento' },
  { num:7,  name:'Energía Asequible y No Contaminante' },
  { num:8,  name:'Trabajo Decente y Crecimiento Económico' },
  { num:9,  name:'Industria, Innovación e Infraestructura' },
  { num:10, name:'Reducción de las Desigualdades' },
  { num:11, name:'Ciudades y Comunidades Sostenibles' },
  { num:12, name:'Producción y Consumo Responsables' },
  { num:13, name:'Acción por el Clima' },
  { num:14, name:'Vida Submarina' },
  { num:15, name:'Vida de Ecosistemas Terrestres' },
  { num:16, name:'Paz, Justicia e Instituciones Sólidas' },
  { num:17, name:'Alianzas para Lograr los Objetivos' },
];

const NAV_ITEMS = [
  { icon:<LayoutDashboard size={14}/>, label:'Dashboard',     active:true  },
  { icon:<FileText size={14}/>,        label:'Ficha Técnica', active:false },
  { icon:<Target size={14}/>,          label:'Indicadores',   active:false },
  { icon:<Paperclip size={14}/>,       label:'Evidencias',    active:false },
  { icon:<ShieldAlert size={14}/>,     label:'Riesgos',       active:false },
  { icon:<Lightbulb size={14}/>,       label:'Supuestos',     active:false },
  { icon:<Wallet size={14}/>,          label:'Presupuesto',   active:false },
  { icon:<BarChart2 size={14}/>,       label:'Reportes',      active:false },
  { icon:<ArrowLeftRight size={14}/>,  label:'Comparativos',  active:false },
  { icon:<Settings size={14}/>,        label:'Configuración', active:false },
];

const QUICK_ACCESS = [
  { icon:<List size={13}/>,        label:'Ver Bitácora'       },
  { icon:<Grid size={13}/>,        label:'Matriz de Riesgos'  },
  { icon:<CheckSquare size={13}/>, label:'Plan de Mitigación' },
  { icon:<Download size={13}/>,    label:'Exportar Reporte'   },
];

// ── Sub-componentes ───────────────────────────────────────────────────────────
const BADGE_STYLE: Record<BadgeStatus, { bg:string; color:string; border:string }> = {
  'Validado':    { bg:'#dcfce7', color:'#15803d', border:'#86efac'  },
  'En Borrador': { bg:'#fef3c7', color:'#b45309', border:'#fcd34d'  },
  'Pendiente':   { bg:'#f3f4f6', color:'#6b7280', border:'#d1d5db'  },
};

function StatusBadge({ status }: { status: BadgeStatus }) {
  const s = BADGE_STYLE[status];
  return (
    <span style={{
      padding:'3px 10px', borderRadius:12, fontSize:10, fontWeight:600,
      background:s.bg, color:s.color, border:`1px solid ${s.border}`,
      whiteSpace:'nowrap', flexShrink:0, lineHeight:'14px',
    }}>
      {status}
    </span>
  );
}

const RISK_COLOR: Record<RiskLevel, string> = {
  CRÍTICO:'#dc2626', ALTO:'#d97706', MEDIO:'#ca8a04', BAJO:'#16a34a',
};

const RISK_BG: Record<RiskLevel, string> = {
  CRÍTICO:'#fee2e2', ALTO:'#fef3c7', MEDIO:'#fefce8', BAJO:'#dcfce7',
};
function RiskBadge({ level }: { level: RiskLevel }) {
  const color = RISK_COLOR[level];
  return (
    <span style={{
      padding:'2px 7px', borderRadius:4, fontSize:9, fontWeight:700,
      background:RISK_BG[level], color, letterSpacing:'0.04em', flexShrink:0,
    }}>
      {level}
    </span>
  );
}

function Bar({ value, color }: { value:number; color:string }) {
  return (
    <div style={{ height:5, background:'#e5e7eb', borderRadius:3, overflow:'hidden', flex:1 }}>
      <div style={{ height:'100%', width:`${value}%`, background:color, borderRadius:3 }}/>
    </div>
  );
}

function DonutChart({ value, color, size=110 }: { value:number; color:string; size?:number }) {
  const sw = 10;
  const r  = (size - sw * 2) / 2;
  const cx = size / 2, cy = size / 2;
  const circ  = 2 * Math.PI * r;
  const offset = circ * (1 - value / 100);
  return (
    <div style={{ position:'relative', width:size, height:size }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)', display:'block' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth={sw}/>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color}
          strokeWidth={sw} strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"/>
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
        <span style={{ fontSize:24, fontWeight:700, color:'#111827', lineHeight:1 }}>{value}</span>
        <span style={{ fontSize:10, color:'#6b7280' }}>/100</span>
      </div>
    </div>
  );
}

// ── Tarjeta de indicador ──────────────────────────────────────────────────────
function IndicatorCard({ ind, sectionColor, compact = false, mini = false }: {
  ind:Indicator; sectionColor:string; compact?: boolean; mini?: boolean
}) {
  const dotColor = ind.status === 'Validado' ? '#22c55e' : ind.status === 'Pendiente' ? '#f59e0b' : '#94a3b8';

  /* ── Modo MINI: layout vertical para 4 columnas en panel compact ── */
  if (mini) {
    return (
      <div style={{
        background:C.bgCard, borderRadius:8,
        padding:'7px 8px',
        border:`1px solid ${C.border}`,
        boxShadow:'0 1px 2px rgba(0,0,0,0.05)',
        display:'flex', flexDirection:'column', minWidth:0,
      }}>
        {/* Fila 1: icono + dot estado */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5 }}>
          <div style={{
            width:20, height:20, borderRadius:'50%', flexShrink:0,
            background:`${sectionColor}18`, border:`1.5px solid ${sectionColor}55`,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <span style={{ color:sectionColor, fontSize:10, display:'flex' }}>{ind.icon}</span>
          </div>
          <div style={{ width:6, height:6, borderRadius:'50%', background:dotColor, flexShrink:0 }}/>
        </div>
        {/* Nombre: altura fija 2 líneas → valor siempre en la misma posición */}
        <div style={{
          fontSize:9, color:C.textMuted, fontWeight:500, lineHeight:1.3,
          overflow:'hidden', height:24, marginBottom:4,
        }}>{ind.name}</div>
        {/* Valor */}
        <div style={{ fontSize:14, fontWeight:700, color:ind.valueColor ?? C.text, lineHeight:1, marginBottom:2 }}>
          {ind.value}
        </div>
        {/* Unidad */}
        <div style={{ fontSize:8, color:C.textDim, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {ind.unit}
        </div>
        {/* Separador — anclado al fondo con marginTop:auto */}
        <div style={{ borderTop:`1px solid ${C.border}`, marginTop:'auto', paddingTop:5, marginBottom:5 }}/>
        {/* Footer minimalista */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:8, color:C.textDim }}>{ind.date}</span>
          <ChevronRight size={8} color={C.textDim} style={{ cursor:'pointer', flexShrink:0 }}/>
        </div>
      </div>
    );
  }

  /* ── Modo normal / compact ── */
  return (
    <div style={{
      background:C.bgCard, borderRadius:8,
      padding: compact ? '9px 11px' : '14px 16px',
      border:`1px solid ${C.border}`,
      boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
      display:'flex', flexDirection:'column', gap:0,
    }}>
      {/* Fila principal: icono circular + contenido */}
      <div style={{ display:'flex', gap: compact ? 8 : 12, alignItems:'flex-start' }}>
        {/* Icono circular */}
        <div style={{
          width: compact ? 30 : 46, height: compact ? 30 : 46,
          borderRadius:'50%', flexShrink:0,
          background:`${sectionColor}18`,
          border:`1.5px solid ${sectionColor}55`,
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <span style={{ color:sectionColor, fontSize: compact ? 13 : 16, display:'flex' }}>{ind.icon}</span>
        </div>

        {/* Contenido derecho */}
        <div style={{ flex:1, minWidth:0 }}>
          {/* Nombre + badge + dot */}
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:4 }}>
            <span style={{ fontSize: compact ? 10 : 11, color:C.textMuted, fontWeight:500, lineHeight:1.3, flex:1, overflow:'hidden', height: compact ? 26 : 'auto' }}>{ind.name}</span>
            <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
              <StatusBadge status={ind.status}/>
              <div style={{ width:6, height:6, borderRadius:'50%', background:dotColor, flexShrink:0 }}/>
            </div>
          </div>

          {/* Valor + unidad */}
          <div style={{ marginTop: compact ? 4 : 6 }}>
            <span style={{ fontSize: compact ? 18 : 26, fontWeight:700, color:ind.valueColor ?? C.text, lineHeight:1 }}>
              {ind.value}
            </span>
          </div>
          <span style={{ fontSize:10, color:C.textMuted, display:'block', marginTop:2 }}>{ind.unit}</span>
        </div>
      </div>

      {/* Separador — anclado al fondo para alinear todos los cards */}
      <div style={{ borderTop:`1px solid ${C.border}`, marginTop:'auto', marginBottom: compact ? 6 : 8, paddingTop: compact ? 7 : 10 }}/>

      {/* Footer */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:10, color:C.textDim }}>
          {ind.date} · <User size={9} style={{ display:'inline', verticalAlign:'middle' }}/> {ind.user}
        </span>
        <div style={{ display:'flex', gap:6, color:C.textDim }}>
          <Paperclip size={10} style={{ cursor:'pointer' }}/>
          <ChevronRight size={10} style={{ cursor:'pointer' }}/>
        </div>
      </div>
    </div>
  );
}

// ── Sección de impacto ────────────────────────────────────────────────────────
function ImpactBlock({ section, compact = false }: { section:ImpactSection; compact?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{
      borderRadius:10, border:`1px solid ${C.border}`,
      borderLeftColor:section.color, borderLeftWidth:4, overflow:'hidden',
      flexShrink:0,
    }}>
      {/* Header acordeón */}
      <button onClick={() => setOpen(o => !o)} style={{
        width:'100%', background:'#ffffff', border:'none', cursor:'pointer',
        padding: compact ? '8px 12px' : '11px 16px',
        display:'flex', alignItems:'center', gap:8,
      }}>
        <div style={{
          width: compact ? 26 : 32, height: compact ? 26 : 32,
          borderRadius:'50%', flexShrink:0,
          background:`${section.color}18`, border:`1.5px solid ${section.color}55`,
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <span style={{ color:section.color }}>{section.icon}</span>
        </div>
        <span style={{ fontSize: compact ? 11 : 12, fontWeight:700, color:C.text, flex:1, textAlign:'left', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', minWidth:0 }}>
          {section.roman}. {section.title}
        </span>
        <span style={{
          fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:12, flexShrink:0,
          background:`${section.color}18`, color:section.color,
          border:`1px solid ${section.color}50`,
        }}>
          {section.weight}%
        </span>
        <span style={{ fontSize:10, color:C.textMuted, whiteSpace:'nowrap', flexShrink:0 }}>
          {section.indicators.length}/{section.indicators.length} ✓
        </span>
        {section.pendiente ? (
          <span style={{ fontSize:10, fontWeight:600, color:C.textDim, whiteSpace:'nowrap', flexShrink:0, fontStyle:'italic' }}>
            Pendiente de cálculo
          </span>
        ) : (
          <span style={{ fontSize: compact ? 14 : 17, fontWeight:700, color:C.text, whiteSpace:'nowrap', flexShrink:0 }}>
            {section.score} <span style={{ fontSize:10, fontWeight:400, color:C.textMuted }}>/100</span>
          </span>
        )}
        <span style={{ color:C.textDim, flexShrink:0 }}>
          {open ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
        </span>
      </button>

      {/* Grid: tantas columnas como indicadores tiene el pilar */}
      {open && (
        <div style={{
          display:'grid',
          gridTemplateColumns: `repeat(${section.indicators.length}, 1fr)`,
          gap: compact ? 8 : 10,
          padding: compact ? '10px 12px 12px' : '12px 16px 16px',
          background:C.bgSection,
          borderTop:`1px solid ${C.border}`,
        }}>
          {section.indicators.map((ind, i) => (
            <IndicatorCard
              key={i} ind={ind} sectionColor={section.color} compact={compact}
              mini={compact && section.indicators.length >= 4}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sidebar izquierda ─────────────────────────────────────────────────────────
function LeftSidebar() {
  return (
    <aside style={{
      width:220, flexShrink:0, background:C.bgSidebar,
      borderRight:`1px solid ${C.border}`,
      display:'flex', flexDirection:'column', height:'100%', overflowY:'auto',
    }}>
      {/* Logo */}
      <div style={{ padding:'16px 14px 14px', display:'flex', alignItems:'center', gap:9, borderBottom:`1px solid ${C.border}` }}>
        <div style={{ width:28, height:28, background:'#22c55e', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <Leaf size={14} color="#fff"/>
        </div>
        <span style={{ fontSize:14, fontWeight:700, color:C.text, letterSpacing:'-0.01em' }}>RadFor 360</span>
      </div>

      {/* Navegación */}
      <nav style={{ padding:'6px 0' }}>
        {NAV_ITEMS.map((item, i) => (
          <div key={i} style={{
            display:'flex', alignItems:'center', gap:9, padding:'8px 14px',
            cursor:'pointer',
            borderLeft: item.active ? `3px solid ${C.cyan}` : '3px solid transparent',
            background: item.active ? `${C.cyan}10` : 'transparent',
            color: item.active ? C.cyan : C.textDim,
            fontSize:12, fontWeight: item.active ? 600 : 400,
          }}>
            {item.icon}
            {item.label}
          </div>
        ))}

        <div style={{ padding:'10px 14px 4px', fontSize:9, fontWeight:700, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.09em' }}>
          Accesos Rápidos
        </div>
        {QUICK_ACCESS.map((item, i) => (
          <div key={i} style={{
            display:'flex', alignItems:'center', gap:8, padding:'6px 14px',
            cursor:'pointer', color:C.textDim, fontSize:11,
          }}>
            {item.icon}
            {item.label}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding:'10px 12px', borderTop:`1px solid ${C.border}` }}>
        <p style={{ fontSize:10, color:C.textDim, textAlign:'center', margin:'0 0 6px' }}>v2.4.1</p>
        <button style={{
          width:'100%', background:'transparent', border:`1px solid ${C.border}`,
          borderRadius:6, padding:'6px 0', display:'flex', alignItems:'center', justifyContent:'center',
          gap:6, cursor:'pointer', color:C.textMuted, fontSize:11,
        }}>
          <HelpCircle size={12}/> Ayuda / Soporte
        </button>
      </div>
    </aside>
  );
}

// ── Panel derecho ─────────────────────────────────────────────────────────────
interface ResumenProyecto { indicadores: number; anexos: number; pendientes: number; totalDimensiones: number; viabilidadGlobal: number | null }

function RightPanel({ compact = false, riesgos, acciones, bitacora, resumen, proyectoId }: {
  compact?: boolean; riesgos: Risk[]; acciones: Action[]; bitacora: LogEntry[]; resumen: ResumenProyecto; proyectoId?: string;
}) {
  const actionColor = (p?:string) => p==='Alta' ? '#dc2626' : p==='Media' ? '#d97706' : '#16a34a';
  const priorityColor = (p?:string) => p==='Alta' ? '#dc2626' : p==='Media' ? '#d97706' : '#16a34a';
  const w = compact ? 220 : 300;
  const salud = resumen.viabilidadGlobal;
  const saludColor = salud === null ? '#94a3b8' : salud >= 80 ? '#22c55e' : salud >= 60 ? '#3b82f6' : salud >= 40 ? '#f59e0b' : '#ef4444';
  const saludLabel = salud === null ? 'Aún sin datos suficientes' : salud >= 80 ? 'Óptimo' : salud >= 60 ? 'Aceptable' : salud >= 40 ? 'En Riesgo Moderado' : 'Crítico';

  return (
    <aside style={{
      width:w, flexShrink:0, background:C.bgSidebar,
      borderLeft:`1px solid ${C.border}`,
      display:'flex', flexDirection:'column', overflow:'hidden',
      alignSelf:'stretch', minHeight:0,
    }}>

      {/* ESTADO DE SALUD DEL PROYECTO — fijo, sin scroll */}
      <section style={{ padding: compact ? '10px 10px 8px' : '14px 14px 12px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <p style={{ fontSize:10, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.07em', textAlign:'center', margin: compact ? '0 0 8px' : '0 0 12px' }}>
          Estado de Salud del Proyecto
        </p>
        <div style={{ display:'flex', justifyContent:'center', marginBottom: compact ? 6 : 10 }}>
          <DonutChart value={salud ?? 0} color={saludColor} size={compact ? 80 : 110}/>
        </div>
        <p style={{ fontSize:10, fontWeight:600, color:saludColor, textAlign:'center', margin: compact ? '0 0 6px' : '0 0 10px', fontStyle: salud === null ? 'italic' : 'normal' }}>
          {saludLabel}
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 6px' }}>
          {[
            { color:'#22c55e', label:'Óptimo (80-100)'   },
            { color:'#3b82f6', label:'Aceptable (60-79)' },
            { color:'#f59e0b', label:'En Riesgo (40-59)' },
            { color:'#ef4444', label:'Crítico (0-39)'    },
          ].map(l => (
            <div key={l.label} style={{ display:'flex', alignItems:'center', gap:4 }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:l.color, flexShrink:0 }}/>
              <span style={{ fontSize:9, color:C.textMuted }}>{l.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Contenido scrollable — todo lo de abajo de Estado de Salud */}
      <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>

      {/* RESUMEN GENERAL */}
      <section style={{ padding:'14px 14px 12px', borderBottom:`1px solid ${C.border}` }}>
        <h3 style={{ fontSize:11, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.07em', margin:'0 0 10px' }}>
          Resumen General
        </h3>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <CheckCircle2 size={11} color="#22c55e" style={{ flexShrink:0 }}/>
            <span style={{ fontSize:10, color:C.textMuted, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>Indicadores</span>
            <span style={{ fontSize:10, fontWeight:700, color:C.text, flexShrink:0 }}>{resumen.indicadores}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <Paperclip size={11} color={C.textDim} style={{ flexShrink:0 }}/>
            <span style={{ fontSize:10, color:C.textMuted, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>Evidencias</span>
            <span style={{ fontSize:10, fontWeight:700, color:C.text, flexShrink:0 }}>{resumen.anexos}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <Clock size={11} color="#f59e0b" style={{ flexShrink:0 }}/>
            <span style={{ fontSize:10, color:C.textMuted, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>Pendientes</span>
            <span style={{ fontSize:10, fontWeight:700, color:'#f59e0b', flexShrink:0 }}>{resumen.pendientes}/{resumen.totalDimensiones}</span>
          </div>
          <div style={{ marginTop:3 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <span style={{ fontSize:10, color:C.textMuted }}>Viabilidad Global</span>
              <span style={{ fontSize:10, fontWeight:700, color:C.text }}>{resumen.viabilidadGlobal ?? '—'}/100</span>
            </div>
            <Bar value={resumen.viabilidadGlobal ?? 0} color={saludColor}/>
          </div>
        </div>
      </section>

      {/* RIESGOS CRÍTICOS */}
      <section style={{ padding:'12px 14px 10px', borderBottom:`1px solid ${C.border}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
          <h3 style={{ fontSize:11, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.07em', margin:0 }}>
            Riesgos Críticos
          </h3>
          <span style={{ background:'#ef4444', color:'#fff', fontSize:9, fontWeight:800, borderRadius:'50%', width:17, height:17, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            {riesgos.length}
          </span>
        </div>
        {riesgos.length === 0 ? (
          <p style={{ fontSize:10, color:C.textDim, fontStyle:'italic', margin:0 }}>Sin riesgos identificados por ahora.</p>
        ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
          {riesgos.map((r, i) => (
            <div key={i} style={{
              borderLeft:`3px solid ${RISK_COLOR[r.level]}`,
              paddingLeft:9, display:'flex', flexDirection:'column', gap:3,
              background:C.bgRightRow, borderRadius:'0 6px 6px 0', padding:'7px 8px 7px 9px',
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <RiskBadge level={r.level}/>
                <span style={{ fontSize:11, fontWeight:600, color:C.text, flex:1 }}>{r.title}</span>
                <ChevronRight size={11} color={C.textDim}/>
              </div>
              <p style={{ fontSize:10, color:C.textMuted, margin:0, lineHeight:1.4 }}>{r.description}</p>
              <span style={{ fontSize:10, color:C.textDim }}>{r.section}</span>
            </div>
          ))}
        </div>
        )}
      </section>

      {/* ACCIONES DE MITIGACIÓN */}
      <section style={{ padding:'12px 14px 10px', borderBottom:`1px solid ${C.border}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
          <h3 style={{ fontSize:11, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.07em', margin:0 }}>
            Acciones de Mitigación
          </h3>
          <span style={{ background:'#f59e0b', color:'#ffffff', fontSize:9, fontWeight:800, borderRadius:'50%', width:17, height:17, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            {acciones.length}
          </span>
        </div>
        {acciones.length === 0 ? (
          <p style={{ fontSize:10, color:C.textDim, fontStyle:'italic', margin:0 }}>Registra riesgos y medidas de mitigación en el módulo M10 — Compliance.</p>
        ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
          {acciones.map((a, i) => (
            <div key={i} style={{ display:'flex', gap:8 }}>
              <input type="checkbox" readOnly style={{ marginTop:3, flexShrink:0, accentColor:C.cyan }}/>
              <div style={{ flex:1, display:'flex', flexDirection:'column', gap:4 }}>
                <span style={{ fontSize:11, color:C.text, lineHeight:1.4 }}>{a.title}</span>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ fontSize:10, color:C.textDim }}>{a.section}</span>
                  {a.priority && <span style={{ fontSize:10, color:priorityColor(a.priority), fontWeight:600 }}>· {a.priority}</span>}
                </div>
                {a.progress !== undefined && (
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <Bar value={a.progress} color={actionColor(a.priority)}/>
                    <span style={{ fontSize:10, color:C.textDim, whiteSpace:'nowrap' }}>{a.progress}%</span>
                  </div>
                )}
                {a.due && <span style={{ fontSize:10, color:C.textDim }}>Vence: {a.due}</span>}
              </div>
            </div>
          ))}
        </div>
        )}
      </section>

      {/* BITÁCORA */}
      <section style={{ padding:'12px 14px 16px' }}>
        <h3 style={{ fontSize:11, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.07em', margin:'0 0 10px' }}>
          Bitácora Reciente
        </h3>
        {bitacora.length === 0 ? (
          <p style={{ fontSize:10, color:C.textDim, fontStyle:'italic', margin:0 }}>Aún no hay actividad registrada para este proyecto.</p>
        ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
          {bitacora.map((l, i) => (
            <div key={i} style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:C.cyan, marginTop:4, flexShrink:0 }}/>
              <div style={{ flex:1 }}>
                <span style={{ fontSize:10, color:C.textDim, fontFamily:'monospace' }}>{l.date} {l.time}</span>
                {l.user && <span style={{ fontSize:10, fontWeight:600, color:C.cyan, margin:'0 4px' }}>{l.user}</span>}
                <span style={{ fontSize:10, color:C.textMuted }}>— {l.action}</span>
              </div>
            </div>
          ))}
        </div>
        )}
        <button style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:C.cyan, marginTop:9, padding:0 }}>
          Ver bitácora completa →
        </button>
      </section>

      </div>{/* fin scroll */}

      {/* CO-PILOTO — fijo e inamovible, fuera de la zona scrolleable */}
      <div style={{ padding: compact ? '8px 10px 10px' : '10px 14px 14px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
        <CoPilotoSidebarChat proyectoId={proyectoId} />
      </div>
    </aside>
  );
}

// ── Scoring dinámico: hook de datos ──────────────────────────────────────────
// No existe todavía un enrutamiento por proyecto en el módulo Formulador
// (ninguna ruta bajo FormuladorLayout lleva :proyectoId), así que el id se
// resuelve en este orden: prop explícita → param de ruta (por si en el futuro
// se agrega) → última clave usada por el selector de proyectos del Panel.
// Si ninguno resuelve, todas las dimensiones quedan en "Pendiente de cálculo"
// — refleja la realidad (no hay proyecto activo conocido) en vez de inventar datos.
const ACTIVE_PROJECT_KEY      = 'rf360_proyecto_activo';
const ACTIVE_PROJECT_NAME_KEY = 'rf360_proyecto_nombre';

/** Lee el proyecto activo (id + nombre) y se mantiene sincronizado con
 * cambios hechos por componentes hermanos (ej. EntradaPage) en la misma
 * pestaña — EntradaPage despacha un StorageEvent manual al guardar. */
function useProyectoActivo(proyectoIdProp?: string) {
  const params = useParams<{ proyectoId?: string }>();
  const readIds = () => ({
    id: proyectoIdProp ?? params.proyectoId ?? localStorage.getItem(ACTIVE_PROJECT_KEY) ?? undefined,
    nombre: localStorage.getItem(ACTIVE_PROJECT_NAME_KEY) ?? undefined,
  });

  const [state, setState] = useState(readIds);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (!e.key || e.key === ACTIVE_PROJECT_KEY || e.key === ACTIVE_PROJECT_NAME_KEY) {
        setState(readIds());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoIdProp, params.proyectoId]);

  return state;
}

function useScoringDinamico(proyectoId: string | undefined) {
  const [data, setData]       = useState<ScoringDinamico | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!proyectoId) { setData(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/proyectos/${proyectoId}/scoring-dinamico`, {
      headers: { ...getAuthHeaders() },
      credentials: 'include',
    })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.success) throw new Error(body?.message ?? 'No se pudo calcular el scoring dinámico.');
        return body.data as ScoringDinamico;
      })
      .then(result => { if (!cancelled) setData(result); })
      .catch(err => { if (!cancelled) setError(err.message ?? 'Error desconocido'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [proyectoId]);

  return { data, loading, error };
}

/** Combina SECTIONS (pesos + indicadores de UI) con los puntajes reales del backend. */
function mergeScoring(sections: ImpactSection[], scoring: ScoringDinamico | null): ImpactSection[] {
  if (!scoring) {
    return sections.map(s => ({ ...s, pendiente: true, score: 0, fuente: null }));
  }
  return sections.map(s => {
    const dim = (scoring.dimensiones as Record<string, DimensionScore>)[s.id];
    if (!dim || dim.pendiente || dim.score === null) {
      return { ...s, pendiente: true, score: 0, fuente: dim?.fuente ?? null };
    }
    return { ...s, pendiente: false, score: dim.score, fuente: dim.fuente };
  });
}

/** Promedio ponderado real de las dimensiones ya calculadas (ignora las pendientes). */
function calcularSaludGlobal(sections: ImpactSection[]): { global: number | null; pendientes: number } {
  const activas = sections.filter(s => !s.pendiente);
  if (activas.length === 0) return { global: null, pendientes: sections.length };
  const pesoTotal = activas.reduce((acc, s) => acc + s.weight, 0);
  const global = pesoTotal > 0
    ? Math.round(activas.reduce((acc, s) => acc + s.score * s.weight, 0) / pesoTotal)
    : null;
  return { global, pendientes: sections.length - activas.length };
}

/** Riesgos derivados de dimensiones con score real bajo (<60) — sin datos inventados. */
function derivarRiesgos(sections: ImpactSection[]): Risk[] {
  return sections
    .filter(s => !s.pendiente && s.score < 60)
    .map(s => ({
      level: s.score < 40 ? 'CRÍTICO' : 'ALTO',
      title: `${s.title} (${s.score}/100)`,
      description: s.fuente ? `Puntaje bajo calculado a partir de ${s.fuente}.` : 'Puntaje bajo detectado en el cálculo real de scoring.',
      section: `${s.roman}. ${s.title}`,
    }));
}

// ── Compliance M10 (riesgos/mitigación reales + estado legal predial) ───────
type EstadoLegal = 'sin_evaluar' | 'condicionado' | 'despejado';

function useComplianceRiesgo(proyectoId: string | undefined) {
  const [riesgo, setRiesgo]           = useState<{ identificados: string; mitigacion: string } | null>(null);
  const [estadoLegal, setEstadoLegal] = useState<EstadoLegal>('sin_evaluar');
  const [tick, setTick]               = useState(0);

  useEffect(() => {
    if (!proyectoId) { setRiesgo(null); setEstadoLegal('sin_evaluar'); return; }
    let cancelled = false;
    // cache: 'no-store' — sin esto, el navegador puede servir una respuesta
    // vieja tras "Saneamiento Aprobado" (mismo GET, mismo momento) y el badge
    // no se actualizaría hasta un refresh completo. Confirmado reproducible.
    fetch(`/api/m10/compliance/${proyectoId}`, { headers: { ...getAuthHeaders() }, credentials: 'include', cache: 'no-store' })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        return res.ok && body?.success ? body.data : null;
      })
      .then(data => {
        if (cancelled) return;
        setEstadoLegal((data?.estado_legal as EstadoLegal) || 'sin_evaluar');
        if (!data?.riesgos) { setRiesgo(null); return; }
        try {
          const arr = JSON.parse(data.riesgos);
          const first = arr?.[0];
          setRiesgo(first && (first.identificados || first.mitigacion)
            ? { identificados: first.identificados || '', mitigacion: first.mitigacion || '' }
            : null);
        } catch { setRiesgo(null); }
      })
      .catch(() => { if (!cancelled) { setRiesgo(null); setEstadoLegal('sin_evaluar'); } });
    return () => { cancelled = true; };
  }, [proyectoId, tick]);

  return { riesgo, estadoLegal, refetch: () => setTick(t => t + 1) };
}

// ── Conteos reales de indicadores/anexos + bitácora derivada de cargas de anexos ─
interface AnexoRow { nombre_archivo: string; created_at: string }
function useConteosProyecto(proyectoId: string | undefined) {
  const [indicadores, setIndicadores] = useState(0);
  const [anexos, setAnexos]           = useState<AnexoRow[]>([]);

  useEffect(() => {
    if (!proyectoId) { setIndicadores(0); setAnexos([]); return; }
    let cancelled = false;
    Promise.all([
      fetch(`/api/proyectos/${proyectoId}/indicadores`, { headers: { ...getAuthHeaders() }, credentials: 'include' })
        .then(r => r.json()).catch(() => null),
      fetch(`/api/proyectos/${proyectoId}/anexos`, { headers: { ...getAuthHeaders() }, credentials: 'include' })
        .then(r => r.json()).catch(() => null),
    ]).then(([indBody, anexBody]) => {
      if (cancelled) return;
      setIndicadores(Array.isArray(indBody?.data) ? indBody.data.length : 0);
      setAnexos(Array.isArray(anexBody?.data) ? anexBody.data : []);
    }).catch(() => { if (!cancelled) { setIndicadores(0); setAnexos([]); } });
    return () => { cancelled = true; };
  }, [proyectoId]);

  return { indicadores, anexos };
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function DashboardFormuladorPage({ embedded = false, proyectoId: proyectoIdProp }: { embedded?: boolean; proyectoId?: string }) {
  const { id: proyectoId, nombre: proyectoNombre } = useProyectoActivo(proyectoIdProp);
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const { data: scoring } = useScoringDinamico(proyectoId);
  const sections = mergeScoring(SECTIONS, scoring);
  const { global: viabilidadGlobal, pendientes: pendientesCount } = calcularSaludGlobal(sections);
  const { riesgo: riesgoCompliance, estadoLegal, refetch: refetchEstadoLegal } = useComplianceRiesgo(proyectoId);
  const [saneando, setSaneando] = useState(false);

  async function saneamientoAprobado() {
    if (!proyectoId || saneando) return;
    setSaneando(true);
    try {
      const res = await fetch(`/api/proyectos/${proyectoId}/estado-legal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ estado_legal: 'despejado' }),
      });
      if (res.ok) refetchEstadoLegal();
    } finally {
      setSaneando(false);
    }
  }
  const { indicadores: indicadoresCount, anexos } = useConteosProyecto(proyectoId);

  const riesgos: Risk[] = [
    ...derivarRiesgos(sections),
    ...(riesgoCompliance?.identificados ? [{
      level: 'MEDIO' as RiskLevel,
      title: 'Riesgo registrado en Compliance (M10)',
      description: riesgoCompliance.identificados,
      section: 'M10 — Compliance',
    }] : []),
  ];
  const acciones: Action[] = riesgoCompliance?.mitigacion
    ? [{ title: riesgoCompliance.mitigacion, section: 'M10 — Compliance' }]
    : [];
  const bitacora: LogEntry[] = anexos
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 6)
    .map(a => {
      const d = new Date(a.created_at);
      const fecha = isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-CO', { day:'2-digit', month:'2-digit' });
      const hora  = isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
      return { date: fecha, time: hora, user: '', action: `Cargó anexo: ${a.nombre_archivo}` };
    });
  const resumen: ResumenProyecto = {
    indicadores: indicadoresCount,
    anexos: anexos.length,
    pendientes: pendientesCount,
    totalDimensiones: sections.length,
    viabilidadGlobal,
  };
  const colorSalud = (v: number | null) => v === null ? '#94a3b8' : v >= 80 ? '#22c55e' : v >= 60 ? '#3b82f6' : v >= 40 ? '#f59e0b' : '#ef4444';
  const ultimaModifLabel = bitacora[0] ? `${bitacora[0].date} ${bitacora[0].time}` : 'Sin actividad';

  return (
    <div style={{
      display:'flex', height:'100%', overflow:'hidden',
      background:C.bgMain, fontFamily:"'Hanken Grotesk', sans-serif",
    }}>
      {/* Columna central + derecha */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden', minHeight:0, height:'100%' }}>

        {/* Barra de proyecto */}
        <header style={{
          display:'flex', alignItems:'center', gap:10, padding:'0 14px',
          height:46, flexShrink:0,
          background:C.bgHeader, borderBottom:`1px solid ${C.border}`,
        }}>
          <span style={{ fontSize:11, color:C.textMuted, flexShrink:0 }}>Proyecto:</span>
          <button onClick={() => setSelectorAbierto(true)} style={{
            display:'flex', alignItems:'center', gap:5, minWidth:0, flex:1,
            background:C.bgSection, border:`1px solid ${C.border}`,
            borderRadius:6, padding:'4px 10px', cursor:'pointer',
            color:C.text, fontSize:11, fontWeight:500,
            overflow:'hidden',
          }}>
            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, textAlign:'left', fontStyle: proyectoNombre ? 'normal' : 'italic', color: proyectoNombre ? C.text : C.textDim }}>
              {proyectoNombre || 'Sin proyecto activo — completa "Entrada" (M1)'}
            </span>
            <ChevronDown size={11} color={C.textMuted} style={{ flexShrink:0 }}/>
          </button>

          {/* Soft-Lock predial (F-Legal-01) — informativo, nunca deshabilita el
              formulario técnico. Solo 'condicionado' muestra el badge; el
              Hard-Lock real vive en el servidor (POST /api/m12/ficha/:id). */}
          {estadoLegal === 'condicionado' && (
            <div style={{
              display:'flex', alignItems:'center', gap:6, flexShrink:0,
              padding:'4px 10px', borderRadius:999,
              background:'rgba(217,119,6,0.1)', border:'1px solid rgba(217,119,6,0.35)',
            }}>
              <ShieldAlert size={12} color="#b45309" />
              <span style={{ fontSize:10, fontWeight:700, color:'#b45309', textTransform:'uppercase', letterSpacing:'0.03em', whiteSpace:'nowrap' }}>
                Bajo Riesgo Jurídico
              </span>
              <button
                onClick={saneamientoAprobado}
                disabled={saneando}
                title="Marcar el predio como despejado — habilita la certificación final"
                style={{
                  marginLeft:4, padding:'2px 8px', borderRadius:999,
                  border:'1px solid #b45309', background:'#fff',
                  color:'#b45309', fontSize:9, fontWeight:700, textTransform:'uppercase',
                  cursor: saneando ? 'not-allowed' : 'pointer', opacity: saneando ? 0.5 : 1,
                  whiteSpace:'nowrap',
                }}
              >
                {saneando ? '...' : 'Saneamiento Aprobado'}
              </button>
            </div>
          )}
        </header>

        {/* Cuerpo */}
        <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

          {/* Contenido central desplazable */}
          <main style={{ flex:1, display:'grid', gridTemplateRows:'1fr auto', overflow:'hidden', minWidth:0, minHeight:0 }}>
            <div style={{ overflowY:'auto', padding:'16px 18px', display:'flex', flexDirection:'column', gap:12, minHeight:0 }}>

              {/* ODS */}
              <div style={{ background:C.bgSection, borderRadius:10, padding: embedded ? '8px 10px' : '12px 16px', border:`1px solid ${C.border}`, flexShrink:0 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: embedded ? 6 : 10 }}>
                  <span style={{ fontSize: embedded ? 10 : 11, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    {embedded ? 'ODS' : 'ODS Focalizado en el Proyecto'}
                  </span>
                  <button style={{ background:'none', border:'none', cursor:'pointer', fontSize:10, color:C.cyan, display:'flex', alignItems:'center', gap:3 }}>
                    Ver Alineación <ChevronRight size={10}/>
                  </button>
                </div>
                {/* Grid 6 columnas — íconos oficiales ODS recortados 1:1 de
                    FOTOS PROY3/arq radar formulador 360/ODS.webp (fidelidad
                    exacta exigida por el usuario — no SVGs redibujados). */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap: embedded ? 4 : 6 }}>
                  {ODS_ALL.map(o => (
                    <img
                      key={o.num}
                      src={`/ods/ods-${o.num}.webp`}
                      alt={`ODS ${o.num} — ${o.name}`}
                      title={`ODS ${o.num} — ${o.name}`}
                      style={{
                        width: '100%', aspectRatio: '1 / 1', objectFit: 'cover',
                        borderRadius: embedded ? 3 : 5, cursor: 'pointer', display: 'block',
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Secciones de impacto — pesos/indicadores de UI + score real del backend */}
              {sections.map(s => <ImpactBlock key={s.id} section={s} compact={embedded}/>)}
            </div>

            {/* Barra inferior fija */}
            <footer style={{
              background:C.bgSection,
              borderTop:`1px solid ${C.border}`,
              padding: embedded ? '6px 10px' : '10px 18px',
              display:'flex',
              flexDirection: embedded ? 'column' : 'row',
              alignItems: embedded ? 'stretch' : 'center',
              gap: embedded ? 4 : 18,
            }}>
              {embedded ? (
                <>
                  {/* Fila 1: título + botón */}
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
                    <span style={{ fontSize:9, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.06em', whiteSpace:'nowrap' }}>
                      Resumen de Avance del Proyecto
                    </span>
                    <button style={{
                      flexShrink:0, background:'#111827', color:'#ffffff',
                      border:'none', borderRadius:4, padding:'2px 7px',
                      fontSize:9, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap',
                    }}>
                      Reporte
                    </button>
                  </div>
                  {/* Fila 2: métricas sin solapamiento */}
                  <div style={{ display:'flex', gap:8, flexWrap:'nowrap', overflow:'hidden' }}>
                    {[
                      { icon:<span style={{ fontSize:10 }}>◎</span>, label:'Cumpl.',  value: resumen.viabilidadGlobal !== null ? `${resumen.viabilidadGlobal}%` : '—', color: colorSalud(resumen.viabilidadGlobal) },
                      { icon:<CheckSquare size={10} color={C.cyan}/>,  label:'Indic.',  value: String(resumen.indicadores), color:C.cyan    },
                      { icon:<Paperclip size={10} color={C.textDim}/>, label:'Evid.',   value: String(resumen.anexos), color:C.text    },
                      { icon:<Clock size={10} color="#f59e0b"/>,        label:'Pend.',   value: String(resumen.pendientes),     color:'#f59e0b' },
                    ].map((item, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:2, flexShrink:0 }}>
                        {item.icon}
                        <span style={{ fontSize:9, color:C.textMuted, whiteSpace:'nowrap' }}>{item.label}</span>
                        <span style={{ fontSize:10, fontWeight:700, color:item.color }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <span style={{ fontSize:10, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>
                    Resumen de Avance del Proyecto
                  </span>
                  <div style={{ display:'flex', gap:16, flex:1, flexWrap:'nowrap', overflow:'hidden' }}>
                    {[
                      { icon:<span style={{ fontSize:14 }}>◎</span>,  label:'Cumplimiento Global', value: resumen.viabilidadGlobal !== null ? `${resumen.viabilidadGlobal}%` : '—', color: colorSalud(resumen.viabilidadGlobal) },
                      { icon:<CheckSquare size={13} color={C.cyan}/>,  label:'Indicadores',         value: String(resumen.indicadores),   color:C.cyan      },
                      { icon:<Paperclip size={13} color={C.textDim}/>, label:'Evidencias',          value: String(resumen.anexos),   color:C.text      },
                      { icon:<Clock size={13} color="#f59e0b"/>,        label:'Pendientes',          value: String(resumen.pendientes),         color:'#f59e0b'   },
                      { icon:<FileText size={13} color={C.textDim}/>,  label:'Última Modif.',       value: ultimaModifLabel,color:C.textMuted },
                    ].map((item, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                        {item.icon}
                        <span style={{ fontSize:11, color:C.textMuted }}>{item.label}</span>
                        <span style={{ fontSize:11, fontWeight:700, color:item.color }}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                  <button style={{
                    flexShrink:0, background:'#111827', color:'#ffffff',
                    border:'none', borderRadius:7, padding:'7px 14px',
                    fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap',
                  }}>
                    Generar Reporte Ejecutivo
                  </button>
                </>
              )}
            </footer>
          </main>

          <RightPanel compact={embedded} riesgos={riesgos} acciones={acciones} bitacora={bitacora} resumen={resumen} proyectoId={proyectoId}/>
        </div>
      </div>

      {selectorAbierto && <ProyectoSelectorModal onClose={() => setSelectorAbierto(false)}/>}
    </div>
  );
}
