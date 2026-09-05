/**
 * DirectoryPage — Calco estricto Stitch
 * Screen DIRECTORIO del canvas: dc6d74fb078a49f0a507878d8a822275
 * "Radar Formulador 360 - Subvenciones Favoritas" (layout tabla/lista)
 *
 * Columnas: Organización · Logo · Categoría · Información de contacto · Acciones.
 * Header: título + Eliminar(bulk)/Filtrar/Ordenar (calco) + Importar/Refrescar (función real).
 * Datos 100% reales desde GET /api/entidades (merge localStorage).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Link2, Search, Upload, Filter, ArrowUpDown, RefreshCw, X, Star, Globe, Phone, Mail, MapPin, ExternalLink, Trash2, AlertTriangle, Loader2, FileDown } from 'lucide-react';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { useAuth } from '../contexts/AuthContextNew';
import './DirectoryPage.css';

// FIX (react-doctor client-localstorage-no-version, 2026-09-05): claves
// versionadas — loadStored()/loadFavoritos() migran la clave vieja.
const STORAGE_KEY = 'radar_directory_entries:v1';
const STORAGE_KEY_LEGACY = 'radar_directory_entries';
const FAV_KEY = 'radar_directory_favoritos:v1';
const FAV_KEY_LEGACY = 'radar_directory_favoritos';

// ── Types ─────────────────────────────────────────────────────────────────────
interface DirectoryEntry {
  id: string;
  nombre: string;
  sigla: string;
  tipo: string;
  pais: string;
  sitio_web: string;
  url_convocatorias: string;
  telefono: string;
  email: string;
  alcance: string;
  validation_status: string;
  fuente: string;
  convocatorias_count?: number;
  logo_url?: string;
}

type Orden = 'az' | 'za';

// ── Icono búsqueda ────────────────────────────────────────────────────────────
const IconSearch = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IconClose = () => (
  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

// ── Persistencia ──────────────────────────────────────────────────────────────
function loadStored(): DirectoryEntry[] {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legado = localStorage.getItem(STORAGE_KEY_LEGACY);
      if (legado) { localStorage.setItem(STORAGE_KEY, legado); localStorage.removeItem(STORAGE_KEY_LEGACY); raw = legado; }
    }
    return raw ? (JSON.parse(raw) as DirectoryEntry[]) : [];
  } catch { return []; }
}
function saveStored(entries: DirectoryEntry[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* lleno */ }
}

// ── Fetch seguro ──────────────────────────────────────────────────────────────
async function safeJsonFetch(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, init);
  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json') && text.trimStart().startsWith('<')) {
    throw new Error(`Error de conexión con el repositorio (el servidor devolvió HTML en lugar de JSON — ruta ${url})`);
  }
  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error('Error de conexión con el repositorio (respuesta no es JSON válido)'); }
  return { ok: res.ok, status: res.status, data };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getInitials(sigla: string, nombre: string): string {
  if (sigla && sigla.length >= 2) return sigla.slice(0, 2).toUpperCase();
  const words = nombre.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return nombre.slice(0, 2).toUpperCase();
}
type TagColor = 'default' | 'blue' | 'green' | 'orange';
interface SectorTag { label: string; color: TagColor; }

function inferSectoresEntidad(nombre: string, tipo: string, alcance: string): SectorTag[] {
  const t = (nombre + ' ' + tipo + ' ' + alcance).toLowerCase();
  const tags: SectorTag[] = [];
  if (/clima|environment|carbon|nature|wildlife|darwin|adaptation|conservation|biodiv|fondo_clima/.test(t)) tags.push({ label: 'Medio Ambiente', color: 'green' });
  if (/educac|school|universit|training|learn|capacita|cultura|ciencia|unesco/.test(t)) tags.push({ label: 'Educación', color: 'blue' });
  if (/salud|health|medic|hospital|disease/.test(t)) tags.push({ label: 'Salud', color: 'green' });
  if (/technolog|digital|innova|software|data|ai|ict/.test(t)) tags.push({ label: 'Tecnología', color: 'blue' });
  if (/género|women|gender|mujer|igualdad/.test(t)) tags.push({ label: 'Género', color: 'orange' });
  if (/paz|peace|conflicto|democraci|human right|derechos|justicia/.test(t)) tags.push({ label: 'Paz', color: 'default' });
  if (/agr|food|rural|pesca|livestock|alimentar/.test(t)) tags.push({ label: 'Agricultura', color: 'green' });
  if (/energía|energy|solar|renewable|electric/.test(t)) tags.push({ label: 'Energía', color: 'orange' });
  if (/infraestr|construc|transport|road|urban/.test(t)) tags.push({ label: 'Infraestructura', color: 'default' });
  if (/bilateral|cooperac|cooperati|desarrollo|desarrollo intern/.test(t)) tags.push({ label: 'Cooperación', color: 'default' });
  if (/banca|financ|banco|bank|inversion|inversión|banca_desarrollo/.test(t)) tags.push({ label: 'Finanzas', color: 'blue' });
  if (/multilateral|nacion|united|onu|ue |unión europea/.test(t)) tags.push({ label: 'Multilateral', color: 'default' });
  return tags.slice(0, 3);
}

function inferSubvencionDirecta(tipo: string): string {
  const t = (tipo || '').toLowerCase();
  if (t.includes('banca') || t.includes('banco')) return 'No (Préstamos)';
  if (t.includes('gobierno')) return 'Convocatorias';
  return 'Sí';
}

function inferElegibilidad(tipo: string, alcance: string): string {
  const t = (tipo || '').toLowerCase();
  const a = (alcance || '').toLowerCase();
  if (t.includes('multilateral')) return 'ONGs, Gobierno, Sector privado';
  if (t.includes('bilateral')) return 'ONGs, Gobierno, Sociedad civil';
  if (t.includes('banca')) return 'Gobierno, Sector público';
  if (t.includes('gobierno')) return 'ONGs Colombianas, Ent. públicas';
  if (a.includes('nacional') || a.includes('colombia')) return 'Entidades colombianas';
  return 'ONGs, Sociedad civil';
}

function mergeEntries(stored: DirectoryEntry[], incoming: DirectoryEntry[]): DirectoryEntry[] {
  // API = fuente de verdad. Entidades eliminadas de la DB no se conservan en localStorage.
  const map = new Map(incoming.map(e => [e.id, e]));
  // Solo se preservan entradas locales (aún no confirmadas en la DB).
  for (const s of stored) {
    if (!map.has(s.id) && typeof s.id === 'string' && s.id.startsWith('local-')) {
      map.set(s.id, s);
    }
  }
  return Array.from(map.values());
}
function normalizeApiEntry(raw: any): DirectoryEntry {
  return {
    id:                   String(raw.id ?? Math.random()),
    nombre:               raw.nombre ?? '',
    sigla:                raw.sigla ?? '',
    tipo:                 raw.tipo ?? 'ENTIDAD',
    pais:                 raw.pais ?? '',
    sitio_web:            raw.sitio_web ?? '',
    url_convocatorias:    raw.url_convocatorias ?? '',
    telefono:             raw.telefono ?? '',
    email:                raw.email ?? '',
    alcance:              raw.alcance ?? '',
    validation_status:    raw.validation_status ?? 'IMPORTADO',
    fuente:               raw.fuente ?? '',
    convocatorias_count:  Number(raw.convocatorias_count ?? 0),
    logo_url:             raw.logo_url ?? '',
  };
}

// Normaliza una cadena: minúsculas + quita tildes/diacríticos
function norm(s: string): string {
  // NFD separa la letra base del acento; el rango ̀-ͯ cubre todos los diacríticos
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Favicon helper ────────────────────────────────────────────────────────────
function getFaviconUrl(sitio_web: string): string | null {
  if (!sitio_web) return null;
  try {
    const { hostname } = new URL(sitio_web);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch { return null; }
}

// ── LogoThumb: miniatura con fallback a iniciales ─────────────────────────────
function LogoThumb({ entry }: { entry: DirectoryEntry }) {
  const [failed, setFailed] = useState(false);
  const src = entry.logo_url || getFaviconUrl(entry.sitio_web);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className="dirx__thumb-img"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="dirx__thumb-initials">
      {getInitials(entry.sigla, entry.nombre).slice(0, 1)}
    </span>
  );
}

// ── Iconos SVG ────────────────────────────────────────────────────────────────
const IconStar = ({ filled }: { filled: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
);
const IconGlobe = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
);
const IconCall = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
);
const IconMail = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
);
const IconPin = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
);
const IconExternal = () => (
  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
);
const IconFilter = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
);
const IconSort = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><line x1="11" y1="5" x2="21" y2="5"/><line x1="11" y1="9" x2="17" y2="9"/><line x1="11" y1="13" x2="21" y2="13"/><polyline points="3 8 6 5 9 8"/><line x1="6" y1="5" x2="6" y2="19"/></svg>
);
const IconUpload = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
);
const IconRefresh = ({ spinning }: { spinning: boolean }) => (
  <svg className={spinning ? 'dirx__spin' : undefined} width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
);
const IconDelete = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
);
const IconSpinner = () => (
  <svg className="dirx__spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
);
const IconWarning = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
);

// ── Componente principal ──────────────────────────────────────────────────────
export default function DirectoryPage() {
  const { token } = useAuth();
  const navigate   = useNavigate();
  const [urlParams] = useSearchParams();
  const isDemoToken = token === 'demo-mode-token';

  const [entries, setEntries]       = useState<DirectoryEntry[]>(() => loadStored());
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [soloFav, setSoloFav]       = useState(false);
  const [orden, setOrden]           = useState<Orden>('az');
  const [searchInput,  setSearchInput]  = useState(() => urlParams.get('buscar') || '');
  const [searchQuery,  setSearchQuery]  = useState(() => urlParams.get('buscar') || '');
  const [filterTipo, setFilterTipo]   = useState('');
  const [filterPais, setFilterPais]   = useState('');
  const [filterAlcance, setFilterAlcance] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // ── Agregar por URL — estado de validación semántica ─────────────────────
  type BuscarState = 'idle' | 'loading' | 'aprobado' | 'rechazado';
  const domParam = urlParams.get('dominio') || '';
  const [linkInput, setLinkInput]         = useState(() => domParam ? `https://${domParam}` : '');
  const [urlConvInput, setUrlConvInput]   = useState('');
  const [buscarState, setBuscarState]     = useState<BuscarState>('idle');
  const [lookupData, setLookupData]       = useState<Partial<DirectoryEntry> | null>(null);
  const [lookupResumen, setLookupResumen] = useState('');
  const [lookupError, setLookupError]     = useState('');
  const [isDuplicate, setIsDuplicate]     = useState(false);
  const [duplicateEntry, setDuplicateEntry] = useState<DirectoryEntry | null>(null);
  const [updatingConv, setUpdatingConv]   = useState(false);
  const [insertBusy, setInsertBusy]       = useState(false);
  const [toast, setToast]                 = useState('');
  const [pdfGenerating, setPdfGenerating] = useState(false);

  function handleDownloadPDF() {
    if (pdfGenerating || filtradas.length === 0) return;
    setPdfGenerating(true);
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fecha = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });

      doc.setFontSize(14);
      doc.setTextColor(0, 55, 176);
      doc.text('DIRECTORIO — RadFor-360', 10, 13);
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(
        `Generado: ${fecha}  ·  ${filtradas.length} entidad${filtradas.length !== 1 ? 'es' : ''}` +
        (activeFilterCount > 0 || searchQuery ? '  ·  Vista filtrada' : '  ·  Vista completa'),
        10, 19
      );

      const headers = [
        '⭐', 'Organización', 'Categoría',
        'Sitio Web', 'Email', 'Teléfono', 'Ubicación',
        'Sub. Directas', 'Elegibilidad', 'Foco Temático',
      ];

      const body = filtradas.map(e => [
        favoritos.has(e.id) ? '⭐' : '',
        e.nombre + (e.sigla ? `\n(${e.sigla})` : ''),
        e.tipo || '—',
        (e.sitio_web || '—').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''),
        e.email || '—',
        e.telefono || '—',
        [e.pais, e.alcance].filter(Boolean).join('\n') || '—',
        inferSubvencionDirecta(e.tipo),
        inferElegibilidad(e.tipo, e.alcance),
        inferSectoresEntidad(e.nombre, e.tipo, e.alcance).map(t => t.label).join(', ') || '—',
      ]);

      autoTable(doc, {
        startY: 23,
        head: [headers],
        body,
        styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [0, 55, 176], textColor: 255, fontStyle: 'bold', fontSize: 7.5, cellPadding: 3 },
        alternateRowStyles: { fillColor: [247, 249, 251] },
        columnStyles: {
          0:  { cellWidth: 5,  halign: 'center' },  // ⭐
          1:  { cellWidth: 48 },                      // Organización
          2:  { cellWidth: 22 },                      // Categoría
          3:  { cellWidth: 37 },                      // Web
          4:  { cellWidth: 35 },                      // Email
          5:  { cellWidth: 20 },                      // Tel
          6:  { cellWidth: 24 },                      // Ubicación
          7:  { cellWidth: 17, halign: 'center' },   // Sub.Dir
          8:  { cellWidth: 33 },                      // Elegibilidad
          9:  { cellWidth: 35 },                      // Foco  → total = 276mm
        },
        tableWidth: 276,
        margin: { left: 10, right: 10 },
      });

      doc.save(`directorio_radar360_${fecha.replace(/\//g, '-')}.pdf`);
    } finally {
      setPdfGenerating(false);
    }
  }

  // Extrae hostname normalizado de una URL (para comparación de duplicados)
  function extractHost(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); }
    catch { return url.toLowerCase().replace(/^www\./i, ''); }
  }

  // ── Selección múltiple ────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bloquearDominio, setBloquearDominio] = useState(true);

  const [favoritos, setFavoritos]   = useState<Set<string>>(() => {
    try {
      let raw = localStorage.getItem(FAV_KEY);
      if (!raw) {
        const legado = localStorage.getItem(FAV_KEY_LEGACY);
        if (legado) { localStorage.setItem(FAV_KEY, legado); localStorage.removeItem(FAV_KEY_LEGACY); raw = legado; }
      }
      return new Set(JSON.parse(raw || '[]'));
    } catch { return new Set(); }
  });

  function commit(next: DirectoryEntry[]) {
    setEntries(next);
    saveStored(next);
  }

  async function handleActualizarUrlConv() {
    if (!duplicateEntry || !linkInput.trim()) return;
    const newUrl = linkInput.trim();
    if (newUrl === duplicateEntry.url_convocatorias) {
      showToast('La URL es la misma que la actual — sin cambios');
      return;
    }
    setUpdatingConv(true);
    setLookupError('');
    try {
      const { ok, data } = await safeJsonFetch(`/api/entidades/${duplicateEntry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url_convocatorias: newUrl }),
      });
      if (!ok) throw new Error(data?.message ?? 'Error al actualizar');
      const updated = entries.map(e =>
        e.id === duplicateEntry.id ? { ...e, url_convocatorias: newUrl } : e
      );
      commit(updated);
      setLinkInput('');
      setLookupData(null);
      setLookupResumen('');
      setIsDuplicate(false);
      setDuplicateEntry(null);
      setBuscarState('idle');
      showToast(`✓ URL de convocatorias actualizada para "${duplicateEntry.nombre}" — re-scraping iniciado`);
    } catch (e: any) {
      setLookupError(e.message ?? 'Error al actualizar URL');
    } finally {
      setUpdatingConv(false);
    }
  }

  async function handleBuscar() {
    const url = linkInput.trim();
    if (!url || buscarState === 'loading' || isDuplicate) return;
    setBuscarState('loading');
    setLookupError('');
    setLookupData(null);
    setLookupResumen('');
    try {
      const { ok, data } = await safeJsonFetch('/api/entidades/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url, ...(urlConvInput.trim() ? { url_convocatorias: urlConvInput.trim() } : {}) }),
      });
      if (!ok) throw new Error(data?.message ?? 'Error al analizar la URL');
      const result = data.data;
      const aprobado = result.aplica_colombia === true || result.estado === 'Aceptado';
      setBuscarState(aprobado ? 'aprobado' : 'rechazado');
      setLookupData(result);
      setLookupResumen(result.resumen ?? '');
    } catch (e: any) {
      setBuscarState('idle');
      setLookupError(e.message ?? 'No se pudo analizar la URL');
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  function insertLocal(entry: DirectoryEntry) {
    commit([...entries, entry]);
    setLinkInput('');
    setLookupData(null);
    setLookupResumen('');
    setIsDuplicate(false);
    setBuscarState('idle');
    showToast('Entidad agregada exitosamente al directorio');
  }

  async function handleInsertar() {
    if (!lookupData || buscarState !== 'aprobado' || isDuplicate) return;
    setInsertBusy(true);
    setLookupError('');

    // Modo sin sesión real → inserción local (estado + localStorage)
    if (!token || isDemoToken) {
      const localEntry = normalizeApiEntry({
        ...lookupData,
        id: `local-${Date.now()}`,
        validation_status: 'IMPORTADO',
      });
      insertLocal(localEntry);
      setInsertBusy(false);
      return;
    }

    // Sesión real → API
    try {
      const { ok, data } = await safeJsonFetch('/api/entidades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(lookupData),
      });
      if (!ok) {
        const rawMsg: string = data?.message ?? 'Error al insertar';
        const lower = rawMsg.toLowerCase();
        // Si el backend rechaza por token, insertar localmente como fallback
        if (lower.includes('token') || lower.includes('revocad')) {
          const localEntry = normalizeApiEntry({ ...lookupData, id: `local-${Date.now()}`, validation_status: 'IMPORTADO' });
          insertLocal(localEntry);
          return;
        }
        // Duplicado detectado por el backend
        if (data?.code === 'DUPLICATE' || lower.includes('inscrita') || lower.includes('unique') || lower.includes('duplicad')) {
          setIsDuplicate(true);
          throw new Error('ENTIDAD YA ESTA INSCRITA');
        }
        throw new Error(rawMsg);
      }
      insertLocal(normalizeApiEntry(data.data));
      // Notifica al Radar para que re-evalúe R1/R2 con la nueva entidad
      window.dispatchEvent(new CustomEvent('directorio:entity-added', { detail: data.data }));
    } catch (e: any) {
      setLookupError(e.message ?? 'No se pudo insertar la entidad');
    } finally {
      setInsertBusy(false);
    }
  }

  useEffect(() => {
    fetchDirectory(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detección en tiempo real de duplicados al escribir la URL
  useEffect(() => {
    const url = linkInput.trim();
    if (!url) {
      setIsDuplicate(false);
      setDuplicateEntry(null);
      return;
    }
    const inputHost = extractHost(url);
    const matched = entries.find(e =>
      (e.sitio_web && extractHost(e.sitio_web) === inputHost) ||
      (e.url_convocatorias && extractHost(e.url_convocatorias) === inputHost)
    );
    const dup = !!matched;
    setIsDuplicate(dup);
    setDuplicateEntry(matched || null);
    if (dup && matched) {
      // Mostrar la entidad existente en la preview (no bloquear — ofrecer actualizar)
      setLookupData(matched as Partial<DirectoryEntry>);
      setLookupResumen(`Entidad ya registrada. URL convocatorias actual: ${matched.url_convocatorias || 'no definida'}`);
      setBuscarState('aprobado');
      setLookupError('');
    } else if (!dup) {
      if (lookupError === 'Esta entidad ya se encuentra registrada en el directorio.') {
        setLookupError('');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkInput, entries]);

  // Debounce de búsqueda — 80ms evita recalcular en cada tecla sin perder reactividad
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(searchInput), 80);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Cerrar panel de filtros al click fuera
  useEffect(() => {
    if (!showFilterPanel) return;
    function handleClickOutside(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterPanel(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilterPanel]);

  const uniqueTipos   = useMemo(() => [...new Set(entries.map(e => e.tipo).filter(Boolean))].sort(), [entries]);
  const uniquePaises  = useMemo(() => [...new Set(entries.map(e => e.pais).filter(Boolean))].sort(), [entries]);
  const uniqueAlcances = useMemo(() => [...new Set(entries.map(e => e.alcance).filter(Boolean))].sort(), [entries]);

  const activeFilterCount = [soloFav, filterTipo, filterPais, filterAlcance].filter(Boolean).length;

  async function fetchDirectory(isRefresh = false) {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const { ok, data } = await safeJsonFetch('/api/entidades', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!ok) throw new Error(data?.message ?? 'Error al cargar directorio.');
      const incoming: DirectoryEntry[] = (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [])
        .map(normalizeApiEntry);
      setEntries(prev => {
        const merged = mergeEntries(prev, incoming);
        saveStored(merged);
        return merged;
      });
    } catch (e: any) {
      console.error('[DirectoryPage] fetch error:', e);
      setError(e.message ?? 'Error de conexión con el repositorio');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function deleteBulk() {
    setBulkDeleting(true);
    const ids = [...selectedIds];
    const suffix = bloquearDominio ? '?bloquear=true' : '';
    const results = await Promise.allSettled(
      ids.map(id =>
        safeJsonFetch(`/api/entidades/${id}${suffix}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      )
    );
    // Solo purgar del estado local las entidades que el backend confirmó eliminadas
    const succeededIds = new Set(
      ids.filter((_, i) => results[i].status === 'fulfilled' && (results[i] as PromiseFulfilledResult<any>).value?.ok !== false)
    );
    commit(entries.filter(e => !succeededIds.has(e.id)));
    setSelectedIds(new Set());
    setShowDeleteModal(false);
    setBulkDeleting(false);
    // Notifica al Radar DESPUÉS del commit para que no haya race condition
    for (const id of succeededIds) {
      window.dispatchEvent(new CustomEvent('directorio:entity-removed', { detail: { id } }));
    }
  }

  function toggleFavorito(id: string) {
    // FIX (react-doctor no-impure-state-updater, 2026-09-05): el write a
    // localStorage vivía dentro del updater de setFavoritos — un updater
    // puede reintentarse/descartarse, así que un side effect ahí no es
    // seguro. `toggleFavorito` es una función plana (se recrea cada render),
    // así que `favoritos` del closure ya es el valor actual sin riesgo de
    // stale closure.
    const next = new Set(favoritos);
    if (next.has(id)) next.delete(id); else next.add(id);
    localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
    setFavoritos(next);
  }

  // Normaliza una URL a su hostname sin protocolo, sin www., sin path ni trailing slash.
  // Cubre todos los formatos: https://www.x.co/ → x.co | www.x.co → x.co | x.co → x.co
  const bareHost = (u: string): string => {
    if (!u) return '';
    try { return new URL(u).hostname.replace(/^www\./i, ''); }
    catch { return u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0]; }
  };

  const filtradas = useMemo(() => {
    // Normalizar palabras del query: URLs → hostname bare (sin protocolo/www./path)
    const words = norm(searchQuery).split(/\s+/).filter(Boolean).map(w => {
      if (/^https?:\/\//i.test(w) || /^www\./i.test(w)) return norm(bareHost(w));
      return w;
    });
    let base = [...entries];

    if (words.length > 0) {
      base = base.filter(e => {
        // Haystack: campos de texto + hostname bare de URLs (cubre búsquedas con/sin protocolo)
        const hay = norm([
          e.nombre, e.sigla, e.tipo, e.pais, e.email,
          e.sitio_web, e.fuente, e.alcance, e.url_convocatorias,
          e.telefono,
          bareHost(e.sitio_web),
          bareHost(e.url_convocatorias),
        ].join(' '));
        return words.every(w => hay.includes(w));
      });
    }

    if (soloFav)       base = base.filter(e => favoritos.has(e.id));
    if (filterTipo)    base = base.filter(e => e.tipo === filterTipo);
    if (filterPais)    base = base.filter(e => e.pais === filterPais);
    if (filterAlcance) base = base.filter(e => e.alcance === filterAlcance);

    base.sort((a, b) => {
      const cmp = a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
      return orden === 'za' ? -cmp : cmp;
    });
    return base;
  }, [entries, searchQuery, soloFav, filterTipo, filterPais, filterAlcance, orden, favoritos]);

  return (
    <div className="dirx">

      {/* Toast de confirmación flotante */}
      {toast && (
        <div className="dirx__toast">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {toast}
        </div>
      )}

      <main className="dirx__main">

        {/* Header — Stitch: título + controles Agregar/Buscar/Insertar/Filtrar/Ordenar */}
        <div className="dirx__header">
          <div className="dirx__header-top">
            <div>
              <h1 className="dirx__title">DIRECTORIO</h1>
              <p className="dirx__subtitle">
                {loading
                  ? 'Cargando…'
                  : (searchInput || activeFilterCount > 0)
                    ? `${filtradas.length} resultado${filtradas.length !== 1 ? 's' : ''} de ${entries.length} entidades`
                    : `${entries.length} entidad${entries.length !== 1 ? 'es' : ''} encontrada${entries.length !== 1 ? 's' : ''}`
                }
              </p>
            </div>

            {/* Controles principales — Stitch: input + Buscar + Insertar + Filtrar + Ordenar */}
            <div className="dirx__header-actions">

              {/* Input "Agregar link..." — Stitch: bg-surface-container border rounded-4xl pl-10 */}
              <div className="dirx__link-wrap">
                <span className="dirx__link-icon"><Link2 size={16} /></span>
                <input
                  className="dirx__link-input"
                  type="url"
                  placeholder="Agregar link..."
                  aria-label="Agregar link"
                  value={linkInput}
                  onChange={e => {
                    setLinkInput(e.target.value);
                    if (!e.target.value.trim()) {
                      setLookupData(null);
                      setLookupResumen('');
                      setLookupError('');
                      setBuscarState('idle');
                      setIsDuplicate(false);
                      setDuplicateEntry(null);
                    } else if (!isDuplicate) {
                      setLookupData(null);
                      setLookupResumen('');
                      setLookupError('');
                      if (buscarState !== 'idle') setBuscarState('idle');
                    }
                  }}
                  onKeyDown={e => e.key === 'Enter' && handleBuscar()}
                />
                {linkInput && (
                  <button
                    className="dirx__link-clear"
                    aria-label="Limpiar link"
                    onClick={() => { setLinkInput(''); setLookupData(null); setLookupResumen(''); setLookupError(''); setBuscarState('idle'); setIsDuplicate(false); setDuplicateEntry(null); }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Buscar — 4 estados: idle / loading / aprobado / rechazado */}
              {!isDuplicate && (
                <button
                  className={`dirx__hbtn dirx__hbtn--buscar dirx__hbtn--buscar-${buscarState}`}
                  onClick={handleBuscar}
                  disabled={!linkInput.trim() || buscarState === 'loading'}
                  title="Analizar URL semánticamente"
                >
                  {buscarState === 'loading'   && <Loader2 size={16} className="dirx__spin" />}
                  {buscarState === 'idle'       && <Search size={16} />}
                  {buscarState === 'aprobado'   && <span style={{fontSize:14}}>✓</span>}
                  {buscarState === 'rechazado'  && <span style={{fontSize:14}}>✕</span>}
                  <span>
                    {buscarState === 'loading'   ? 'Analizando...'
                     : buscarState === 'aprobado'  ? 'Aprobado'
                     : buscarState === 'rechazado' ? 'Rechazado'
                     : 'Buscar'}
                  </span>
                </button>
              )}

              {/* Insertar — habilitado si aprobado y sin duplicado */}
              {!isDuplicate && buscarState !== 'rechazado' && (
                <button
                  className="dirx__hbtn dirx__hbtn--primary"
                  onClick={() => handleInsertar()}
                  disabled={buscarState !== 'aprobado' || insertBusy}
                  title={buscarState === 'aprobado' ? 'Insertar en el directorio' : 'Aprueba la URL primero'}
                >
                  {insertBusy ? <Loader2 size={16} className="dirx__spin" /> : <Upload size={16} />}
                  <span>Insertar</span>
                </button>
              )}


              {/* Cuando hay duplicado: indicador de bloqueo en header (sin botón ambiguo) */}
              {isDuplicate && (
                <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:600, color:'#b91c1c', background:'#fef2f2', border:'1px solid #ef4444', borderRadius:6, padding:'4px 10px', flexShrink:0 }}>
                  ⛔ Ya existe — no se puede duplicar
                </span>
              )}

              <div className="dirx__header-sep" />

              {/* Filtrar */}
              <div className="dirx__filter-wrap" ref={filterRef}>
                <button
                  className={activeFilterCount > 0 ? 'dirx__hbtn dirx__hbtn--active' : 'dirx__hbtn'}
                  onClick={() => setShowFilterPanel(v => !v)}
                >
                  <Filter size={16} />
                  <span>Filtrar</span>
                  {activeFilterCount > 0 && (
                    <span className="dirx__filter-badge">{activeFilterCount}</span>
                  )}
                </button>
                {showFilterPanel && (
                  <div className="dirx__filter-panel">
                    <p className="dirx__filter-panel-title">Filtros</p>
                    <label className="dirx__filter-label">
                      <input type="checkbox" checked={soloFav} onChange={() => setSoloFav(v => !v)} />
                      Solo favoritos
                    </label>
                    <div className="dirx__filter-group">
                      <span className="dirx__filter-group-label">Categoría</span>
                      <select className="dirx__filter-select" aria-label="Filtrar por categoría" value={filterTipo} onChange={e => setFilterTipo(e.target.value)}>
                        <option value="">Todas</option>
                        {uniqueTipos.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="dirx__filter-group">
                      <span className="dirx__filter-group-label">País</span>
                      <select className="dirx__filter-select" aria-label="Filtrar por país" value={filterPais} onChange={e => setFilterPais(e.target.value)}>
                        <option value="">Todos</option>
                        {uniquePaises.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    {uniqueAlcances.length > 0 && (
                      <div className="dirx__filter-group">
                        <span className="dirx__filter-group-label">Alcance</span>
                        <select className="dirx__filter-select" aria-label="Filtrar por alcance" value={filterAlcance} onChange={e => setFilterAlcance(e.target.value)}>
                          <option value="">Todos</option>
                          {uniqueAlcances.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                    )}
                    {activeFilterCount > 0 && (
                      <button className="dirx__filter-clear" onClick={() => { setSoloFav(false); setFilterTipo(''); setFilterPais(''); setFilterAlcance(''); }}>
                        Limpiar filtros
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Ordenar — alterna A-Z / Z-A */}
              <button
                className={`dirx__hbtn${orden === 'za' ? ' dirx__hbtn--active' : ''}`}
                onClick={() => setOrden(o => o === 'az' ? 'za' : 'az')}
                title={orden === 'az' ? 'Orden ascendente A-Z — clic para invertir' : 'Orden descendente Z-A — clic para revertir'}
              >
                <ArrowUpDown size={16} />
                <span>{orden === 'az' ? 'A → Z' : 'Z → A'}</span>
              </button>

              {/* Eliminar masivo (solo visible si hay selección) */}
              {selectedIds.size > 0 && (
                <button
                  className="dirx__hbtn dirx__hbtn--danger"
                  onClick={() => setShowDeleteModal(true)}
                  title={`Eliminar ${selectedIds.size} entidad(es)`}
                >
                  <Trash2 size={16} />
                  <span>Eliminar ({selectedIds.size})</span>
                </button>
              )}

              <button
                className="dirx__hbtn dirx__hbtn--icononly"
                onClick={() => fetchDirectory(true)}
                disabled={refreshing || loading}
                title="Actualizar desde API"
              >
                <RefreshCw size={16} className={refreshing ? 'dirx__spin' : undefined} />
              </button>
            </div>
          </div>

          {/* Banner de bloqueo — duplicado detectado */}
          {isDuplicate && duplicateEntry && (
            <div style={{ display:'flex', alignItems:'flex-start', gap:12, background:'#fef2f2', border:'2px solid #ef4444', borderRadius:10, padding:'12px 16px', margin:'8px 0' }}>
              <span style={{ fontSize:20, flexShrink:0 }}>⛔</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:700, color:'#b91c1c', fontSize:14 }}>ENTIDAD YA REGISTRADA — No se puede duplicar</div>
                <div style={{ color:'#7f1d1d', fontSize:12, marginTop:2 }}>
                  <strong>{duplicateEntry.nombre}</strong> ya existe en el Directorio con el mismo dominio. Solo puede haber una entrada por organización.
                </div>
                {duplicateEntry.url_convocatorias && (
                  <div style={{ fontSize:11, color:'#991b1b', marginTop:4 }}>
                    URL convocatorias actual: <em>{duplicateEntry.url_convocatorias}</em>
                  </div>
                )}
              </div>
              <button
                style={{ background:'none', border:'1px solid #ef4444', borderRadius:6, color:'#b91c1c', fontSize:11, padding:'4px 10px', cursor:'pointer', flexShrink:0, whiteSpace:'nowrap' }}
                onClick={handleActualizarUrlConv}
                disabled={updatingConv || !linkInput.trim() || linkInput.trim() === duplicateEntry.url_convocatorias}
                title="Actualizar la URL de convocatorias de la entidad existente"
              >
                {updatingConv ? 'Actualizando...' : 'Actualizar URL'}
              </button>
            </div>
          )}

          {/* Preview de entidad analizada por Gemini */}
          {lookupData && !isDuplicate && (
            <div className={`dirx__lookup-preview dirx__lookup-preview--${buscarState}`}>
              <div className="dirx__lookup-preview-left">
                <div className="dirx__logo dirx__logo--preview">{getInitials(lookupData.sigla || '', lookupData.nombre || '')}</div>
              </div>
              <div className="dirx__lookup-info">
                <div className="dirx__lookup-header-row">
                  <span className="dirx__lookup-name">{lookupData.nombre}</span>
                  <span className={`dirx__lookup-estado dirx__lookup-estado--${buscarState}`}>
                    {buscarState === 'aprobado' ? '✓ Aplica a Colombia' : '✕ No aplica'}
                  </span>
                </div>
                {/* Campos extraídos — grid de datos de contacto */}
                <div className="dirx__lookup-fields">
                  {lookupData.tipo     && <span className="dirx__lookup-field"><strong>Tipo:</strong> {lookupData.tipo}</span>}
                  {lookupData.pais     && <span className="dirx__lookup-field"><strong>País:</strong> {lookupData.pais}</span>}
                  {lookupData.alcance  && <span className="dirx__lookup-field"><strong>Alcance:</strong> {lookupData.alcance}</span>}
                  {lookupData.email    && <span className="dirx__lookup-field"><Mail size={11} /> {lookupData.email}</span>}
                  {lookupData.telefono && <span className="dirx__lookup-field"><Phone size={11} /> {lookupData.telefono}</span>}
                  {lookupData.sitio_web && <span className="dirx__lookup-field"><Globe size={11} /> {lookupData.sitio_web}</span>}
                </div>
                {lookupResumen && <span className="dirx__lookup-resumen">{lookupResumen}</span>}
                {/* Campo URL convocatorias — visible cuando rechazado para re-evaluar */}
                {buscarState === 'rechazado' && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Link2 size={13} style={{ color: '#b45309', flexShrink: 0 }} />
                    <input
                      type="url"
                      placeholder="Pega aquí la URL exacta de convocatorias/grants y vuelve a Buscar"
                      aria-label="URL exacta de convocatorias para re-evaluar"
                      value={urlConvInput}
                      onChange={e => setUrlConvInput(e.target.value)}
                      style={{ flex: 1, fontSize: 12, padding: '4px 8px', border: '1px solid #d97706', borderRadius: 6, outline: 'none', background: '#fffbeb', color: '#92400e' }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          {lookupError && (
            <div className="dirx__lookup-error">
              <AlertTriangle size={16} />
              <span>{lookupError}</span>
              <button
                className="dirx__lookup-error-close"
                onClick={() => { setLookupError(''); setIsDuplicate(false); }}
                title="Cerrar alerta"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Barra de búsqueda + botón exportar PDF */}
        <div className="dirx__search-row">
          <button
            className="dirx__pdf-btn"
            onClick={handleDownloadPDF}
            disabled={pdfGenerating || filtradas.length === 0}
            title={filtradas.length === 0 ? 'No hay entidades para exportar' : `Exportar ${filtradas.length} entidad${filtradas.length !== 1 ? 'es' : ''} a PDF`}
          >
            {pdfGenerating
              ? <Loader2 size={15} className="dirx__spin" />
              : <FileDown size={15} />}
            <span>PDF</span>
          </button>

          <div className="dirx__search-wrap">
            <span className="dirx__search-icon"><IconSearch /></span>
            <input
              className="dirx__search-input"
              type="text"
              placeholder="Buscar por nombre, sigla, categoría o país…"
              aria-label="Buscar entidades por nombre, sigla, categoría o país"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button className="dirx__search-clear" onClick={() => { setSearchInput(''); setSearchQuery(''); }} title="Limpiar búsqueda">
                <IconClose />
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="dirx__error">
            <AlertTriangle size={18} />
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => fetchDirectory(false)} className="dirx__error-retry">REINTENTAR</button>
          </div>
        )}

        {/* Table — Stitch: bg-surface-container-lowest rounded-xl border overflow-hidden */}
        <div className="dirx__table">

          {/* Table header */}
          <div className="dirx__thead">
            <div className="dirx__th--org">Organización</div>
            <div className="dirx__th--cat">Categoría</div>
            <div className="dirx__th--contact">Información de contacto</div>
            <div className="dirx__th--actions">Acciones</div>
          </div>

          {/* Skeleton */}
          {loading && entries.length === 0 && [...Array(5)].map((_, i) => (
            <div key={i} className="dirx__row">
              <div className="dirx__org">
                <div className="dirx__skel-logo" />
                <div style={{ flex: 1 }}>
                  <div className="dirx__skel-block" style={{ width: 180, marginBottom: 8 }} />
                  <div className="dirx__skel-block" style={{ width: 100 }} />
                </div>
              </div>
              <div className="dirx__cat"><div className="dirx__skel-block" style={{ width: 80 }} /></div>
              <div className="dirx__contact"><div className="dirx__skel-block" style={{ width: 120 }} /></div>
              <div className="dirx__actions"><div className="dirx__skel-block" style={{ width: 80 }} /></div>
            </div>
          ))}

          {/* Rows */}
          {filtradas.map((entry) => {
            const esFav = favoritos.has(entry.id);
            const accionUrl = entry.url_convocatorias || entry.sitio_web || '';
            const accionLabel = entry.url_convocatorias ? 'ACCEDER' : 'SITIO WEB';
            const isSelected = selectedIds.has(entry.id);
            const tipoKey = (() => {
              const t = (entry.tipo || '').toLowerCase();
              if (t === 'banca_desarrollo') return 'banca_desarrollo';
              if (t === 'fondo_clima') return 'fondo_clima';
              if (t.includes('bilateral')) return 'bilateral';
              if (t.includes('multilateral')) return 'multilateral';
              if (t.includes('privad') || t.includes('empresa')) return 'privado';
              if (t.includes('gobierno') || t.includes('estatal')) return 'gobierno';
              if (t.includes('ong') || t.includes('fundaci')) return 'ong';
              if (t.includes('academia') || t.includes('universit')) return 'academia';
              return '';
            })();

            return (
              <div
                key={entry.id}
                className={['dirx__row', isSelected ? 'dirx__row--selected' : ''].filter(Boolean).join(' ')}
              >
                {/* Col 1 — Organización (col-span-4) */}
                <div className="dirx__org">
                  <div className="dirx__logo">{getInitials(entry.sigla, entry.nombre)}</div>
                  <div className="dirx__org-info">
                    <h2 className="dirx__name">
                      {entry.nombre}
                      {entry.sigla && <span className="dirx__sigla"> ({entry.sigla})</span>}
                    </h2>
                    {/* Categoría badge visible solo en mobile */}
                    <div className="dirx__cat-mobile">
                      <span className="dirx__badge dirx__badge--sm">
                        {entry.tipo || 'Entidad'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Col 2 — Categoría (col-span-2) hidden on mobile */}
                <div className="dirx__cat">
                  <span className={`dirx__badge${tipoKey ? ` dirx__badge--${tipoKey}` : ''}`}>
                    {entry.tipo || 'Entidad'}
                  </span>
                </div>

                {/* Col 3 — Información de contacto · grid 2×2 fijo (posiciones invariables) */}
                <div className="dirx__contact">

                  {/* [0,0] Arriba-Izquierda — Página Web */}
                  <div className={`dirx__contact-item${!entry.sitio_web ? ' dirx__contact-item--empty' : ''}`}>
                    <Globe size={14} />
                    {entry.sitio_web
                      ? <a href={entry.sitio_web} target="_blank" rel="noopener noreferrer" title={entry.sitio_web}>
                          {entry.sitio_web.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      : <span className="dirx__contact-na">No registrado</span>}
                  </div>

                  {/* [0,1] Arriba-Derecha — Teléfono */}
                  <div className={`dirx__contact-item${!entry.telefono ? ' dirx__contact-item--empty' : ''}`}>
                    <Phone size={14} />
                    {entry.telefono
                      ? <span>{entry.telefono}</span>
                      : <span className="dirx__contact-na">No registrado</span>}
                  </div>

                  {/* [1,0] Abajo-Izquierda — Correo */}
                  <div className={`dirx__contact-item${!entry.email ? ' dirx__contact-item--empty' : ''}`}>
                    <Mail size={14} />
                    {entry.email
                      ? <a href={`mailto:${entry.email}`} title={entry.email}>{entry.email}</a>
                      : <span className="dirx__contact-na">No registrado</span>}
                  </div>

                  {/* [1,1] Abajo-Derecha — Ubicación */}
                  <div className={`dirx__contact-item${(!entry.pais && !entry.alcance) ? ' dirx__contact-item--empty' : ''}`}>
                    <MapPin size={14} />
                    {(entry.pais || entry.alcance)
                      ? <span>{[entry.pais, entry.alcance].filter(Boolean).join(' · ')}</span>
                      : <span className="dirx__contact-na">No registrado</span>}
                  </div>

                </div>

                {/* Col 4 — Acciones (col-span-2) */}
                <div className="dirx__actions">
                  <button
                    className="dirx__star"
                    onClick={() => toggleFavorito(entry.id)}
                    title={esFav ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  >
                    <Star size={18} fill={esFav ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className="dirx__portal dirx__portal--radar"
                    onClick={() => navigate(`/radar?entidad_id=${encodeURIComponent(entry.id)}&nombre=${encodeURIComponent(entry.nombre)}`)}
                    title={`Ver convocatorias de ${entry.nombre} en Radar`}
                  >
                    RADAR
                  </button>
                  {accionUrl && (
                    <a
                      className="dirx__portal"
                      href={accionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {accionLabel}
                    </a>
                  )}
                  <label className="dirx__checkbox-wrap" title="Seleccionar para eliminar">
                    <input
                      type="checkbox"
                      className="dirx__checkbox"
                      aria-label="Seleccionar para eliminar"
                      checked={isSelected}
                      onChange={() => toggleSelect(entry.id)}
                    />
                  </label>
                </div>
              </div>
            );
          })}

          {/* Vacío */}
          {!loading && entries.length === 0 && !error && (
            <div className="dirx__empty">
              <p className="dirx__empty-title">No hay entidades registradas</p>
              <p className="dirx__empty-sub">Importe un archivo CSV o Excel obtenido directamente de portales oficiales.</p>
              <button onClick={() => navigate('/importar')} className="dirx__empty-btn">IMPORTAR DATOS OFICIALES</button>
            </div>
          )}

          {/* Sin resultados de búsqueda/filtros */}
          {!loading && entries.length > 0 && filtradas.length === 0 && (
            <div className="dirx__empty">
              <p className="dirx__empty-title">Sin resultados</p>
              <p className="dirx__empty-sub">
                {searchInput
                  ? `No se encontraron entidades que coincidan con "${searchInput}".`
                  : soloFav
                    ? 'No tienes entidades marcadas como favoritas.'
                    : 'Ninguna entidad coincide con los filtros seleccionados.'}
              </p>
              {(searchInput || activeFilterCount > 0) && (
                <button
                  className="dirx__empty-btn"
                  onClick={() => { setSearchInput(''); setSearchQuery(''); setSoloFav(false); setFilterTipo(''); setFilterPais(''); setFilterAlcance(''); }}
                >
                  Limpiar búsqueda y filtros
                </button>
              )}
            </div>
          )}
        </div>

      </main>

      {/* Modal de confirmación de eliminación masiva */}
      {showDeleteModal && (
        <div className="dirx__modal-overlay" onClick={() => !bulkDeleting && setShowDeleteModal(false)}>
          <div className="dirx__modal" onClick={e => e.stopPropagation()}>
            <div className="dirx__modal-icon">
              <Trash2 size={24} />
            </div>
            <h3 className="dirx__modal-title">Eliminar entidades</h3>
            <p className="dirx__modal-body">
              Vas a eliminar <strong>{selectedIds.size}</strong> entidad{selectedIds.size !== 1 ? 'es' : ''} del directorio.
              Esta acción no se puede deshacer.
            </p>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#374151', margin: '12px 0', cursor: 'pointer', textAlign: 'left' }}>
              <input type="checkbox" checked={bloquearDominio} onChange={() => setBloquearDominio(v => !v)} style={{ marginTop: 2 }} />
              <span>
                Bloquear también {selectedIds.size !== 1 ? 'estos dominios' : 'este dominio'} — no volverá{selectedIds.size !== 1 ? 'n' : ''} a aprobarse automáticamente en futuras búsquedas.
              </span>
            </label>
            <div className="dirx__modal-actions">
              <button
                className="dirx__modal-cancel"
                onClick={() => setShowDeleteModal(false)}
                disabled={bulkDeleting}
              >
                Cancelar
              </button>
              <button
                className="dirx__modal-confirm"
                onClick={deleteBulk}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? <Loader2 size={16} className="dirx__spin" /> : <Trash2 size={16} />}
                <span>{bulkDeleting ? 'Eliminando…' : 'Confirmar eliminación'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
