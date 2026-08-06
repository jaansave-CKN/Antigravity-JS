import { useState, useEffect, useCallback } from 'react';
import { Layers, Plus, Trash2, Save, Loader, FolderOpen } from 'lucide-react';
import { getIdToken } from '../lib/firebase';

const TIPOS = ['producto', 'resultado', 'impacto'];

async function apiFetch(path, options = {}) {
  const token = await getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { data });
  return data;
}

const emptyRow = () => ({ indicador: '', tipo: 'producto', unidad: '', linea_base: '', meta: '', fuente_verificacion: '', responsable: '', frecuencia_medicion: '', avance_actual: '' });

export default function Modulo10Page() {
  const [proyectos, setProyectos]   = useState([]);
  const [proyectoId, setProyectoId] = useState('');
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [status, setStatus]         = useState(null); // { type: 'ok'|'error', msg }

  useEffect(() => {
    apiFetch('/api/formulador/proyectos')
      .then(data => setProyectos(data.proyectos || []))
      .catch(err => setStatus({ type: 'error', msg: `No se pudieron cargar los proyectos: ${err.message}` }))
      .finally(() => setLoading(false));
  }, []);

  const loadModulo10 = useCallback(async (id) => {
    if (!id) { setRows([]); return; }
    setLoadingRows(true);
    setStatus(null);
    try {
      const data = await apiFetch(`/api/formulador/${id}/modulo10`);
      setRows(data.indicadores?.length ? data.indicadores : [emptyRow()]);
    } catch (err) {
      setStatus({ type: 'error', msg: `No se pudo cargar Módulo 10: ${err.message}` });
      setRows([emptyRow()]);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  const onSelectProyecto = (id) => { setProyectoId(id); loadModulo10(id); };

  const updateRow = (idx, field, value) => setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  const addRow    = () => setRows(prev => [...prev, emptyRow()]);
  const removeRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx));

  const guardar = async () => {
    if (!proyectoId) { setStatus({ type: 'error', msg: 'Selecciona un proyecto primero.' }); return; }
    setSaving(true);
    setStatus(null);
    try {
      const indicadores = rows.filter(r => r.indicador.trim());
      const result = await apiFetch(`/api/formulador/${proyectoId}/modulo10`, { method: 'POST', body: JSON.stringify({ indicadores }) });
      setStatus({ type: 'ok', msg: `Guardado — ${result.indicadores_guardados} indicador(es).` });
    } catch (err) {
      setStatus({ type: 'error', msg: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Layers size={20} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-100">Módulo 10 — Indicadores y Seguimiento</h1>
            <p className="text-sm text-gray-500">Metas de producto/resultado/impacto para el proyecto formulado en Fase 1 (Módulos 1–9).</p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <FolderOpen size={16} className="text-gray-500" />
          <select
            value={proyectoId}
            onChange={e => onSelectProyecto(e.target.value)}
            disabled={loading}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 min-w-[320px]"
          >
            <option value="">{loading ? 'Cargando proyectos…' : 'Selecciona un proyecto…'}</option>
            {proyectos.map(p => (
              <option key={p.id} value={p.id}>{p.nombre || 'Sin nombre'} — {p.municipio || '—'} ({p.status})</option>
            ))}
          </select>
          {!loading && proyectos.length === 0 && (
            <span className="text-xs text-gray-500">No tienes proyectos guardados todavía — completa la Fase 1 primero ("Entrada 1–9").</span>
          )}
        </div>

        {status && (
          <div className={`mt-4 px-4 py-2.5 rounded-lg text-sm border ${status.type === 'ok' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
            {status.msg}
          </div>
        )}

        {proyectoId && (
          <div className="mt-6">
            {loadingRows ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm py-8"><Loader size={16} className="animate-spin" /> Cargando indicadores…</div>
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-gray-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-800/60 text-gray-400 text-xs uppercase tracking-wide">
                        <th className="text-left px-3 py-2">Indicador</th>
                        <th className="text-left px-3 py-2">Tipo</th>
                        <th className="text-left px-3 py-2">Unidad</th>
                        <th className="text-left px-3 py-2">Línea Base</th>
                        <th className="text-left px-3 py-2">Meta</th>
                        <th className="text-left px-3 py-2">Fuente Verif.</th>
                        <th className="text-left px-3 py-2">Responsable</th>
                        <th className="text-left px-3 py-2">Frecuencia</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, idx) => (
                        <tr key={idx} className="border-t border-gray-800">
                          <td className="px-2 py-1.5"><input value={row.indicador} onChange={e => updateRow(idx, 'indicador', e.target.value)} placeholder="Ej: N° de aulas construidas" className="w-full bg-gray-800/50 border border-gray-700 rounded px-2 py-1.5 text-gray-200 text-xs" /></td>
                          <td className="px-2 py-1.5">
                            <select value={row.tipo} onChange={e => updateRow(idx, 'tipo', e.target.value)} className="bg-gray-800/50 border border-gray-700 rounded px-2 py-1.5 text-gray-200 text-xs">
                              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5"><input value={row.unidad} onChange={e => updateRow(idx, 'unidad', e.target.value)} placeholder="Unidad" className="w-24 bg-gray-800/50 border border-gray-700 rounded px-2 py-1.5 text-gray-200 text-xs" /></td>
                          <td className="px-2 py-1.5"><input value={row.linea_base} onChange={e => updateRow(idx, 'linea_base', e.target.value)} placeholder="0" className="w-20 bg-gray-800/50 border border-gray-700 rounded px-2 py-1.5 text-gray-200 text-xs" /></td>
                          <td className="px-2 py-1.5"><input value={row.meta} onChange={e => updateRow(idx, 'meta', e.target.value)} placeholder="Meta" className="w-20 bg-gray-800/50 border border-gray-700 rounded px-2 py-1.5 text-gray-200 text-xs" /></td>
                          <td className="px-2 py-1.5"><input value={row.fuente_verificacion} onChange={e => updateRow(idx, 'fuente_verificacion', e.target.value)} placeholder="Ej: Acta de entrega" className="w-32 bg-gray-800/50 border border-gray-700 rounded px-2 py-1.5 text-gray-200 text-xs" /></td>
                          <td className="px-2 py-1.5"><input value={row.responsable} onChange={e => updateRow(idx, 'responsable', e.target.value)} placeholder="Responsable" className="w-28 bg-gray-800/50 border border-gray-700 rounded px-2 py-1.5 text-gray-200 text-xs" /></td>
                          <td className="px-2 py-1.5"><input value={row.frecuencia_medicion} onChange={e => updateRow(idx, 'frecuencia_medicion', e.target.value)} placeholder="Ej: Trimestral" className="w-24 bg-gray-800/50 border border-gray-700 rounded px-2 py-1.5 text-gray-200 text-xs" /></td>
                          <td className="px-2 py-1.5 text-center">
                            <button onClick={() => removeRow(idx)} className="text-gray-600 hover:text-red-400 transition"><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center gap-3 mt-4">
                  <button onClick={addRow} className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded-lg px-3 py-1.5">
                    <Plus size={14} /> Agregar indicador
                  </button>
                  <button onClick={guardar} disabled={saving} className="flex items-center gap-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded-lg px-4 py-1.5 ml-auto">
                    {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />} Guardar Módulo 10
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
