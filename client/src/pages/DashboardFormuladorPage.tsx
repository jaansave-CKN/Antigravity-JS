import { useState } from 'react';
import {
  LayoutDashboard, FileText, Target, Paperclip, ShieldAlert,
  Lightbulb, Wallet, BarChart2, ArrowLeftRight, Settings,
  List, Grid, CheckSquare, Download, ChevronDown,
  Bell, ChevronRight, ChevronUp, Leaf, Users, TrendingUp,
  TrendingDown, Scale, Cog, Droplets, RefreshCw, TreePine,
  DollarSign, Percent, Cpu, HelpCircle, User, AlertTriangle,
  Clock, Activity, Zap, CheckCircle2, Heart, Globe, Network,
} from 'lucide-react';

// ── Paleta light mode — fondo blanco, texto oscuro ───────────────────────────
const C = {
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
  color: string;
  icon: React.ReactNode;
  indicators: Indicator[];
}
interface Risk    { level: RiskLevel; title: string; description: string; section: string }
interface Action  { title: string; section: string; priority: 'Alta'|'Media'|'Baja'; progress: number; due: string }
interface LogEntry{ date: string; time: string; user: string; action: string }

// ── Datos estáticos ───────────────────────────────────────────────────────────
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

const RISKS: Risk[] = [
  { level:'CRÍTICO', title:'Sensibilidad (Esc. Pesimista)',    description:'El VAN cae -12.4% en escenario pesimista. Verificar supuestos.',                section:'III. Impacto Económico' },
  { level:'ALTO',    title:'Impacto Ecosistémico (72)',         description:'Índice bajo. Requiere medidas adicionales de mitigación.',                      section:'I. Impacto Ambiental' },
  { level:'ALTO',    title:'Autonomía Tecnológica (65%)',       description:'Evaluar dependencia tecnológica y planes de contingencia.',                     section:'V. Impacto Operativo' },
  { level:'MEDIO',   title:'Cumplimiento Regulatorio (88%)',    description:'Falta cargar 2 documentos clave para validación completa.',                    section:'IV. Impacto Normativo' },
];

const ACTIONS: Action[] = [
  { title:'Revisar y ajustar supuestos financieros del proyecto', section:'III. Económico', priority:'Alta',  progress:60, due:'25/05/2024' },
  { title:'Incorporar medidas de compensación ambiental',         section:'I. Ambiental',   priority:'Alta',  progress:30, due:'22/05/2024' },
  { title:'Actualizar plan de transferencia tecnológica',         section:'V. Operativo',   priority:'Alta',  progress:45, due:'28/05/2024' },
  { title:'Cargar normativas sectoriales faltantes',             section:'IV. Normativo',  priority:'Media', progress:70, due:'20/05/2024' },
  { title:'Validar fuentes de datos de línea base social',       section:'II. Social',     priority:'Baja',  progress:80, due:'27/05/2024' },
];

const LOG: LogEntry[] = [
  { date:'23/06', time:'09:42', user:'Ana L.',     action:'Actualizó Huella de Carbono' },
  { date:'22/06', time:'16:15', user:'Juliana R.', action:'Actualizó VAN y TIR' },
  { date:'21/06', time:'11:30', user:'Carlos M.',  action:'Validó Estabilidad Territorial' },
  { date:'20/06', time:'14:05', user:'Andrés G.',  action:'Cargó documento regulatorio' },
];

const ODS = [
  { num:3,  bg:'#4C9F38', icon:<Heart size={17}/>,      name:'Salud y Bienestar' },
  { num:6,  bg:'#26BDE2', icon:<Droplets size={17}/>,   name:'Agua Limpia y Saneamiento' },
  { num:7,  bg:'#FCC30B', icon:<Zap size={17}/>,        name:'Energía Asequible y No Contaminante' },
  { num:8,  bg:'#A21942', icon:<TrendingUp size={17}/>,  name:'Trabajo Decente y Crecimiento Económico' },
  { num:9,  bg:'#FD6925', icon:<Cpu size={17}/>,        name:'Industria, Innovación e Infraestructura' },
  { num:12, bg:'#BF8B2E', icon:<RefreshCw size={17}/>,  name:'Producción y Consumo Responsables' },
  { num:13, bg:'#3F7E44', icon:<Globe size={17}/>,      name:'Acción por el Clima' },
  { num:17, bg:'#19486A', icon:<Network size={17}/>,    name:'Alianzas para Lograr los Objetivos' },
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
function IndicatorCard({ ind, sectionColor }: { ind:Indicator; sectionColor:string }) {
  const dotColor = ind.status === 'Validado' ? '#22c55e' : '#f59e0b';
  return (
    <div style={{
      background:C.bgCard, borderRadius:10, padding:'14px 16px',
      border:`1px solid ${C.border}`,
      boxShadow:'0 1px 4px rgba(0,0,0,0.07)',
      display:'flex', flexDirection:'column', gap:0,
    }}>
      {/* Fila principal: icono circular + contenido */}
      <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
        {/* Icono circular */}
        <div style={{
          width:46, height:46, borderRadius:'50%', flexShrink:0,
          background:`${sectionColor}18`,
          border:`1.5px solid ${sectionColor}55`,
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <span style={{ color:sectionColor }}>{ind.icon}</span>
        </div>

        {/* Contenido derecho */}
        <div style={{ flex:1, minWidth:0 }}>
          {/* Nombre + badge + dot */}
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:6 }}>
            <span style={{ fontSize:11, color:C.textMuted, fontWeight:500, lineHeight:1.3, flex:1 }}>{ind.name}</span>
            <div style={{ display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
              <StatusBadge status={ind.status}/>
              <div style={{ width:7, height:7, borderRadius:'50%', background:dotColor, flexShrink:0 }}/>
            </div>
          </div>

          {/* Valor grande + unidad */}
          <div style={{ marginTop:6 }}>
            <span style={{ fontSize:26, fontWeight:700, color:ind.valueColor ?? C.text, lineHeight:1 }}>
              {ind.value}
            </span>
          </div>
          <span style={{ fontSize:10, color:C.textMuted, display:'block', marginTop:3 }}>{ind.unit}</span>
        </div>
      </div>

      {/* Separador */}
      <div style={{ borderTop:`1px solid ${C.border}`, margin:'10px 0 8px' }}/>

      {/* Footer: fecha + usuario + iconos */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:10, color:C.textDim }}>
          Últ. Act: {ind.date} · <User size={9} style={{ display:'inline', verticalAlign:'middle' }}/> {ind.user}
        </span>
        <div style={{ display:'flex', gap:8, color:C.textDim }}>
          <Paperclip size={11} style={{ cursor:'pointer' }}/>
          <ChevronRight size={11} style={{ cursor:'pointer' }}/>
        </div>
      </div>
    </div>
  );
}

// ── Sección de impacto ────────────────────────────────────────────────────────
function ImpactBlock({ section }: { section:ImpactSection }) {
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
        padding:'11px 16px', display:'flex', alignItems:'center', gap:10,
      }}>
        <div style={{
          width:32, height:32, borderRadius:'50%', flexShrink:0,
          background:`${section.color}18`, border:`1.5px solid ${section.color}55`,
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <span style={{ color:section.color }}>{section.icon}</span>
        </div>
        <span style={{ fontSize:13, fontWeight:700, color:C.text, flex:1, textAlign:'left' }}>
          {section.roman}. {section.title}
        </span>
        <span style={{
          fontSize:10, fontWeight:600, padding:'3px 10px', borderRadius:12, flexShrink:0,
          background:`${section.color}18`, color:section.color,
          border:`1px solid ${section.color}50`,
        }}>
          Peso: {section.weight}%
        </span>
        <span style={{ fontSize:11, color:C.textMuted, whiteSpace:'nowrap', flexShrink:0 }}>
          4 / 4 indicadores completados
        </span>
        <span style={{ fontSize:22, fontWeight:700, color:C.text, whiteSpace:'nowrap', flexShrink:0 }}>
          {section.score} <span style={{ fontSize:13, fontWeight:400, color:C.textMuted }}>/100</span>
        </span>
        <span style={{ color:C.textDim, flexShrink:0 }}>
          {open ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
        </span>
      </button>

      {/* Grid 2×2 */}
      {open && (
        <div style={{
          display:'grid', gridTemplateColumns:'1fr 1fr', gap:10,
          padding:'12px 16px 16px', background:C.bgSection,
          borderTop:`1px solid ${C.border}`,
        }}>
          {section.indicators.map((ind, i) => (
            <IndicatorCard key={i} ind={ind} sectionColor={section.color}/>
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
function RightPanel() {
  const actionColor = (p:string) => p==='Alta' ? '#dc2626' : p==='Media' ? '#d97706' : '#16a34a';
  const priorityColor = (p:string) => p==='Alta' ? '#dc2626' : p==='Media' ? '#d97706' : '#16a34a';

  return (
    <aside style={{
      width:300, flexShrink:0, background:C.bgSidebar,
      borderLeft:`1px solid ${C.border}`,
      display:'flex', flexDirection:'column', overflow:'hidden', height:'100%',
    }}>

      {/* ESTADO DE SALUD DEL PROYECTO — fijo, sin scroll */}
      <section style={{ padding:'14px 14px 12px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
        <p style={{ fontSize:10, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.07em', textAlign:'center', margin:'0 0 12px' }}>
          Estado de Salud del Proyecto
        </p>
        <div style={{ display:'flex', justifyContent:'center', marginBottom:10 }}>
          <DonutChart value={72} color="#f59e0b" size={110}/>
        </div>
        <p style={{ fontSize:11, fontWeight:600, color:'#f59e0b', textAlign:'center', margin:'0 0 10px' }}>
          En Riesgo Moderado
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'5px 8px' }}>
          {[
            { color:'#22c55e', label:'Óptimo (80-100)'   },
            { color:'#3b82f6', label:'Aceptable (60-79)' },
            { color:'#f59e0b', label:'En Riesgo (40-59)' },
            { color:'#ef4444', label:'Crítico (0-39)'    },
          ].map(l => (
            <div key={l.label} style={{ display:'flex', alignItems:'center', gap:5 }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:l.color, flexShrink:0 }}/>
              <span style={{ fontSize:10, color:C.textMuted }}>{l.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Contenido scrollable — todo lo de abajo de Estado de Salud */}
      <div style={{ flex:1, overflowY:'auto' }}>

      {/* RESUMEN GENERAL */}
      <section style={{ padding:'14px 14px 12px', borderBottom:`1px solid ${C.border}` }}>
        <h3 style={{ fontSize:11, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.07em', margin:'0 0 10px' }}>
          Resumen General
        </h3>
        <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <CheckCircle2 size={13} color="#22c55e"/>
            <span style={{ fontSize:11, color:C.textMuted, flex:1 }}>Indicadores totales</span>
            <span style={{ fontSize:11, fontWeight:700, color:C.text }}>20 / 20</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Paperclip size={13} color={C.textDim}/>
            <span style={{ fontSize:11, color:C.textMuted, flex:1 }}>Evidencias cargadas</span>
            <span style={{ fontSize:11, fontWeight:700, color:C.text }}>18 / 20</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Clock size={13} color="#f59e0b"/>
            <span style={{ fontSize:11, color:C.textMuted, flex:1 }}>Pendientes de validación</span>
            <span style={{ fontSize:11, fontWeight:700, color:'#f59e0b' }}>6</span>
          </div>
          <div style={{ marginTop:4 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
              <span style={{ fontSize:11, color:C.textMuted }}>Índice Global de Viabilidad</span>
              <span style={{ fontSize:11, fontWeight:700, color:C.text }}>72 / 100</span>
            </div>
            <Bar value={72} color="#22c55e"/>
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
            {RISKS.length}
          </span>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
          {RISKS.map((r, i) => (
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
        <button style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:C.cyan, marginTop:9, padding:0 }}>
          Ver todos los riesgos →
        </button>
      </section>

      {/* ACCIONES DE MITIGACIÓN */}
      <section style={{ padding:'12px 14px 10px', borderBottom:`1px solid ${C.border}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
          <h3 style={{ fontSize:11, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.07em', margin:0 }}>
            Acciones de Mitigación
          </h3>
          <span style={{ background:'#f59e0b', color:'#ffffff', fontSize:9, fontWeight:800, borderRadius:'50%', width:17, height:17, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            {ACTIONS.length}
          </span>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
          {ACTIONS.map((a, i) => (
            <div key={i} style={{ display:'flex', gap:8 }}>
              <input type="checkbox" readOnly style={{ marginTop:3, flexShrink:0, accentColor:C.cyan }}/>
              <div style={{ flex:1, display:'flex', flexDirection:'column', gap:4 }}>
                <span style={{ fontSize:11, color:C.text, lineHeight:1.4 }}>{a.title}</span>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ fontSize:10, color:C.textDim }}>{a.section}</span>
                  <span style={{ fontSize:10, color:priorityColor(a.priority), fontWeight:600 }}>· {a.priority}</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <Bar value={a.progress} color={actionColor(a.priority)}/>
                  <span style={{ fontSize:10, color:C.textDim, whiteSpace:'nowrap' }}>{a.progress}%</span>
                </div>
                <span style={{ fontSize:10, color:C.textDim }}>Vence: {a.due}</span>
              </div>
            </div>
          ))}
        </div>
        <button style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:C.cyan, marginTop:9, padding:0 }}>
          Ver todas las acciones →
        </button>
      </section>

      {/* BITÁCORA */}
      <section style={{ padding:'12px 14px 16px' }}>
        <h3 style={{ fontSize:11, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.07em', margin:'0 0 10px' }}>
          Bitácora Reciente
        </h3>
        <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
          {LOG.map((l, i) => (
            <div key={i} style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:C.cyan, marginTop:4, flexShrink:0 }}/>
              <div style={{ flex:1 }}>
                <span style={{ fontSize:10, color:C.textDim, fontFamily:'monospace' }}>{l.date} {l.time}</span>
                <span style={{ fontSize:10, fontWeight:600, color:C.cyan, margin:'0 4px' }}>{l.user}</span>
                <span style={{ fontSize:10, color:C.textMuted }}>— {l.action}</span>
              </div>
            </div>
          ))}
        </div>
        <button style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:C.cyan, marginTop:9, padding:0 }}>
          Ver bitácora completa →
        </button>
      </section>

      </div>{/* fin scroll */}
    </aside>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function DashboardFormuladorPage() {
  return (
    <div style={{
      display:'flex', height:'calc(100vh - 48px)', overflow:'hidden',
      background:C.bgMain, fontFamily:"'Hanken Grotesk', sans-serif",
    }}>
      {/* Columna central + derecha */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>

        {/* Barra de proyecto */}
        <header style={{
          display:'flex', alignItems:'center', gap:14, padding:'0 20px',
          height:52, flexShrink:0,
          background:C.bgHeader, borderBottom:`1px solid ${C.border}`,
        }}>
          <span style={{ fontSize:12, color:C.textMuted, flexShrink:0 }}>Proyecto:</span>
          <button style={{
            display:'flex', alignItems:'center', gap:7,
            background:C.bgSection, border:`1px solid ${C.border}`,
            borderRadius:7, padding:'5px 12px', cursor:'pointer',
            color:C.text, fontSize:12, fontWeight:500,
          }}>
            Desarrollo Productivo Sostenible en la Amazonía
            <ChevronDown size={12} color={C.textMuted}/>
          </button>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginLeft:'auto' }}>
            <div style={{ width:7, height:7, borderRadius:'50%', background:'#22c55e' }}/>
            <span style={{ fontSize:11, color:C.textMuted }}>Última actualización: Hoy, 09:42 AM</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <div style={{ position:'relative' }}>
              <Bell size={16} color={C.textMuted} style={{ cursor:'pointer', display:'block' }}/>
              <span style={{
                position:'absolute', top:-5, right:-5,
                background:'#ef4444', color:'#fff', fontSize:8, fontWeight:800,
                borderRadius:'50%', width:14, height:14, display:'flex', alignItems:'center', justifyContent:'center',
              }}>3</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <div style={{ width:26, height:26, borderRadius:'50%', background:'#111827', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <User size={13} color="#ffffff"/>
              </div>
              <span style={{ fontSize:12, color:C.text, fontWeight:500 }}>Formulador</span>
            </div>
          </div>
        </header>

        {/* Cuerpo */}
        <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

          {/* Contenido central desplazable */}
          <main style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
            <div style={{ flex:1, overflowY:'auto', padding:'16px 18px', display:'flex', flexDirection:'column', gap:12 }}>

              {/* ODS */}
              <div style={{ background:C.bgSection, borderRadius:10, padding:'12px 16px', border:`1px solid ${C.border}`, flexShrink:0 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    ODS Focalizado en el Proyecto
                  </span>
                  <button style={{ background:'none', border:'none', cursor:'pointer', fontSize:11, color:C.cyan, display:'flex', alignItems:'center', gap:3 }}>
                    Ver Alineación <ChevronRight size={11}/>
                  </button>
                </div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {ODS.map(o => (
                    <div key={o.num} style={{
                      width:72, minHeight:66, borderRadius:8, background:o.bg,
                      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                      cursor:'pointer', flexShrink:0, padding:'6px 4px 5px',
                    }}>
                      <span style={{ color:'rgba(255,255,255,0.92)', marginBottom:2 }}>{o.icon}</span>
                      <span style={{ fontSize:14, fontWeight:800, color:'#fff', lineHeight:1 }}>{o.num}</span>
                      <span style={{ fontSize:7, color:'rgba(255,255,255,0.88)', textAlign:'center', marginTop:2, lineHeight:1.2, maxWidth:66 }}>{o.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Secciones de impacto */}
              {SECTIONS.map(s => <ImpactBlock key={s.id} section={s}/>)}
            </div>

            {/* Barra inferior fija */}
            <footer style={{
              flexShrink:0, background:C.bgSection,
              borderTop:`1px solid ${C.border}`, padding:'10px 18px',
              display:'flex', alignItems:'center', gap:18,
            }}>
              <span style={{ fontSize:10, fontWeight:700, color:C.text, textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>
                Resumen de Avance del Proyecto
              </span>
              <div style={{ display:'flex', gap:16, flex:1, flexWrap:'wrap' }}>
                {[
                  { icon:<span style={{ fontSize:14 }}>◎</span>, label:'Cumplimiento Global', value:'72%',         color:'#22c55e' },
                  { icon:<CheckSquare size={13} color={C.cyan}/>,  label:'Indicadores',        value:'20 / 20',    color:C.cyan    },
                  { icon:<Paperclip size={13} color={C.textDim}/>, label:'Evidencias',         value:'18 / 20',    color:C.text    },
                  { icon:<Clock size={13} color="#f59e0b"/>,        label:'Pendientes',         value:'6',          color:'#f59e0b' },
                  { icon:<FileText size={13} color={C.textDim}/>,   label:'Última Modif.',      value:'Hoy, 09:42', color:C.textMuted },
                ].map((item, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:5 }}>
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
            </footer>
          </main>

          <RightPanel/>
        </div>
      </div>
    </div>
  );
}
