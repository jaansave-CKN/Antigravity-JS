import { useAlertas } from '../hooks/useAlertas';
import { Bell, CheckCircle, AlertTriangle, XCircle, Clock, RefreshCw, Zap, Send, ChevronDown, ChevronUp, Link, Cloud, FileText, Plus, Trash2 } from 'lucide-react';
import { useState, useCallback, useRef, useMemo } from 'react';
import './AlertsView.css';

interface SoporteDoc {
  id: string;
  entidad: string;
  referencia: string;
  fuente: 'link' | 'cloud' | 'local';
  notas: string;
  isActive: boolean;
  nivel: string;
  archivo?: { nombre: string; tipo: string; data?: string };
}

const STORAGE_KEY = 'radar360_soportes_alertas';
const DEBOUNCE_MS = 500;

const priorityColors = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a'
};

const priorityIcons = {
  critical: <XCircle size={18} />,
  high: <AlertTriangle size={18} />,
  medium: <Bell size={18} />,
  low: <CheckCircle size={18} />
};

export default function AlertsView() {
  const { alerts, stats, loading, error, acknowledgeAlert, runTriggers, testNotification, fetchAlerts } = useAlertas();
  const [filterPriority, setFilterPriority] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [soportesExpanded, setSoportesExpanded] = useState(true);
  const [soportes, setSoportes] = useState<SoporteDoc[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [
      { id: '1', entidad: 'BID - Banco Interamericano', referencia: 'BID-2026-001', fuente: 'link', notas: '', isActive: true, nivel: '1' },
      { id: '2', entidad: 'PNUD Colombia', referencia: 'PNUD-COL-12', fuente: 'cloud', notas: '', isActive: true, nivel: '1' },
      { id: '3', entidad: 'SENA - Fondo Emprender', referencia: 'FE-Q1-2026', fuente: 'local', notas: '', isActive: false, nivel: '1' }
    ];
  });
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const getNivelNum = (nivelStr: string): number => {
    const match = nivelStr.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  const saveSoportes = useCallback((data: SoporteDoc[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent('soportes_context_update', { detail: { soportes: data } }));
  }, []);

  const handleNotaChange = useCallback((id: string, nota: string) => {
    setSoportes(prev => prev.map(s => s.id === id ? { ...s, notas: nota } : s));
    if (debounceTimers.current.has(id)) clearTimeout(debounceTimers.current.get(id));
    const timer = setTimeout(() => {
      setSoportes(current => { saveSoportes(current); return current; });
      debounceTimers.current.delete(id);
    }, DEBOUNCE_MS);
    debounceTimers.current.set(id, timer);
  }, [saveSoportes]);

  const addSoporte = useCallback(() => {
    const newSoporte: SoporteDoc = { id: Date.now().toString(), entidad: 'Nueva Entidad', referencia: `REF-${Date.now()}`, fuente: 'link', notas: '', isActive: true, nivel: '1' };
    setSoportes(prev => { const updated = [...prev, newSoporte]; saveSoportes(updated); return updated; });
  }, [saveSoportes]);

  const deleteSoporte = useCallback((id: string) => {
    setSoportes(prev => { const updated = prev.filter(s => s.id !== id); saveSoportes(updated); return updated; });
  }, [saveSoportes]);

  const getChildIds = (items: SoporteDoc[], parentId: string): string[] => {
    const parentIndex = items.findIndex(s => s.id === parentId);
    if (parentIndex === -1) return [];
    const children: string[] = [];
    const parentNivel = items[parentIndex].nivel;
    for (let i = parentIndex + 1; i < items.length; i++) {
      if (items[i].nivel > parentNivel) children.push(items[i].id);
      else break;
    }
    return children;
  };

  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverId(id);
  };

  const onDragLeave = () => setDragOverId(null);

  const onDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === targetId) { setDragOverId(null); return; }
    
    setSoportes(prev => {
      const draggedIndex = prev.findIndex(s => s.id === draggedId);
      const targetIndex = prev.findIndex(s => s.id === targetId);
      if (draggedIndex === -1 || targetIndex === -1) return prev;
      
      const childIds = getChildIds(prev, draggedId);
      const itemsToMove = [draggedId, ...childIds];
      const newItems = prev.filter(s => !itemsToMove.includes(s.id));
      const insertIndex = targetIndex > draggedIndex ? targetIndex - itemsToMove.length : targetIndex;
      newItems.splice(insertIndex, 0, ...prev.filter(s => itemsToMove.includes(s.id)));
      saveSoportes(newItems);
      setDragOverId(null);
      return newItems;
    });
  };

  const toggleActive = useCallback((id: string) => {
    setSoportes(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, isActive: !s.isActive } : s);
      saveSoportes(updated);
      return updated;
    });
  }, [saveSoportes]);

  const handleFuenteChange = useCallback((id: string, fuente: 'link' | 'cloud' | 'local') => {
    setSoportes(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, fuente } : s);
      saveSoportes(updated);
      return updated;
    });
  }, [saveSoportes]);

  const handleReferenciaChange = useCallback((id: string, referencia: string) => {
    setSoportes(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, referencia } : s);
      saveSoportes(updated);
      return updated;
    });
  }, [saveSoportes]);

  const handleEntidadChange = useCallback((id: string, entidad: string) => {
    setSoportes(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, entidad } : s);
      saveSoportes(updated);
      return updated;
    });
  }, [saveSoportes]);

  const handleFileUpload = useCallback((id: string, file: File) => {
    const validTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (!validTypes.includes(file.type)) { alert('Solo PDF, Word o Excel'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setSoportes(prev => {
        const updated = prev.map(s => s.id === id ? { ...s, archivo: { nombre: file.name, tipo: file.type, data: reader.result as string } } : s);
        saveSoportes(updated);
        return updated;
      });
    };
    reader.readAsDataURL(file);
  }, [saveSoportes]);

  const getNextNivel = (currentNivel: string): string => {
    if (!currentNivel.includes('.')) {
      return `${currentNivel}.1`;
    }
    const parts = currentNivel.split('.');
    const lastPart = parseInt(parts[parts.length - 1], 10);
    parts[parts.length - 1] = String(lastPart + 1);
    return parts.join('.');
  };

  const getPrevNivel = (currentNivel: string): string => {
    if (!currentNivel.includes('.')) {
      return '1';
    }
    const parts = currentNivel.split('.');
    if (parts.length === 2 && parseInt(parts[1], 10) === 1) {
      return parts[0];
    }
    if (parts.length > 1) {
      parts[parts.length - 1] = String(parseInt(parts[parts.length - 1], 10) - 1);
      return parts.join('.');
    }
    return '1';
  };

  const indentRight = useCallback((id: string) => {
    setSoportes(prev => {
      const updated = prev.map(s => {
        if (s.id === id) {
          const nuevoNivel = getNextNivel(s.nivel);
          return { ...s, nivel: nuevoNivel };
        }
        return s;
      });
      saveSoportes(updated);
      return updated;
    });
  }, [saveSoportes]);

  const indentLeft = useCallback((id: string) => {
    setSoportes(prev => {
      const updated = prev.map(s => {
        if (s.id === id) {
          const nuevoNivel = getPrevNivel(s.nivel);
          return { ...s, nivel: nuevoNivel };
        }
        return s;
      });
      saveSoportes(updated);
      return updated;
    });
  }, [saveSoportes]);

  const generarResumenBlindaje = useCallback(() => {
    const activos = soportes.filter(s => s.isActive);
    const getNivelNum = (nivelStr: string): number => {
      const match = nivelStr.match(/^(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };
    const getChildren = (parentIdx: number, nivel: number) => {
      const children: SoporteDoc[] = [];
      for (let i = parentIdx + 1; i < activos.length; i++) {
        const lvl = getNivelNum(activos[i].nivel);
        if (lvl > nivel) children.push(activos[i]);
        else if (lvl <= nivel && i > parentIdx + 1) break;
        else if (lvl < nivel) break;
      }
      return children;
    };
    
    let contenido = '══════════════════════════════════════════════════════════\n';
    contenido += '           RESUMEN DE BLINDAJE TÉCNICO\n';
    contenido += '           ════════════════════════════════\n\n';
    contenido += `Fecha: ${new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })}\n`;
    contenido += `Documentos Orientados: ${activos.length}\n\n`;
    contenido += '──────────────────────────────────────────────────────────\n';
    contenido += '                    ESTRUCTURA JERÁRQUICA\n';
    contenido += '──────────────────────────────────────────────────────────\n\n';
    
    activos.filter(s => getNivelNum(s.nivel) === 0).forEach((doc, i) => {
      const docIdx = activos.indexOf(doc);
      contenido += `► PND (#${i + 1}) ${doc.entidad}\n`;
      contenido += `    Referencia: ${doc.referencia}\n`;
      if (doc.notas) contenido += `    Notas: ${doc.notas}\n`;
      
      const hijos1 = getChildren(docIdx, 0).filter(s => getNivelNum(s.nivel) === 1);
      hijos1.forEach((hijo, j) => {
        const hijoIdx = activos.indexOf(hijo);
        contenido += `    └─ PDD (#${i + 1}.${j + 1}) ${hijo.entidad}\n`;
        contenido += `        Referencia: ${hijo.referencia}\n`;
        
        const hijos2 = getChildren(hijoIdx, 1).filter(s => getNivelNum(s.nivel) === 2);
        hijos2.forEach((nieto, k) => {
          contenido += `            └─ PDM (#${i + 1}.${j + 1}.${k + 1}) ${nieto.entidad}\n`;
          contenido += `                Referencia: ${nieto.referencia}\n`;
        });
      });
      contenido += '\n';
    });
    
    contenido += '──────────────────────────────────────────────────────────\n';
    contenido += '                     RESUMEN EJECUTIVO\n';
    contenido += '──────────────────────────────────────────────────────────\n\n';
    contenido += 'Proyecto orientado bajo:\n';
    activos.filter(s => getNivelNum(s.nivel) === 0).forEach((doc, i) => {
      const hijos = getChildren(activos.indexOf(doc), 0);
      contenido += `  ► PND (#${i + 1}): ${doc.entidad}\n`;
      if (hijos.length > 0) contenido += `    → Alineado con ${hijos.length} documento(s) de soporte técnico\n`;
    });
    
    contenido += '\n══════════════════════════════════════════════════════════\n';
    contenido += '     ESTE DOCUMENTO SIRVE COMO PORTADA TÉCNICA\n';
    contenido += '     PARA CUALQUIER PROPUESTA A PRESENTAR\n';
    contenido += '══════════════════════════════════════════════════════════\n';
    
    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Resumen_Blindaje_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [soportes]);

  const filteredAlerts = filterPriority
    ? alerts.filter(a => a.priority === filterPriority)
    : alerts;

  const handleTestNotification = async () => {
    setTesting(true);
    await testNotification('system_health', 'high');
    setTesting(false);
  };

  const handleRunTriggers = async () => {
    try {
      await runTriggers();
      const response = await fetch('/api/triggers/run-with-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertas: alerts, soportes: filtrosContextuales })
      });
      if (response.ok) console.log('Contexto de alertas enviado correctamente');
    } catch (err) {
      console.error('Error al enviar contexto:', err);
    }
  };

const filtrosContextuales = useMemo(() => {
    const activos = soportes.filter((s: SoporteDoc) => s.isActive !== false);
    return {
      documentos: activos.map((s: SoporteDoc) => {
        const safeNivel = s.nivel || '1';
        const isChild = String(safeNivel).includes('.');
        return {
          entidad: isChild ? `Soporte de ${s.entidad || 'documento'}` : (s.entidad || ''),
          referencia: s.referencia || '',
          fuente: s.fuente || 'link',
          url: s.fuente === 'link' ? s.referencia : null,
          nivel: safeNivel,
          esDependenciaDirecta: isChild,
          notas: s.notas || '',
          archivo: s.fuente === 'local' && s.archivo ? { nombre: s.archivo.nombre, tipo: s.archivo.tipo } : null
        };
      }),
      urlsParaLeer: activos.filter((s: SoporteDoc) => s.fuente === 'link' && s.referencia && s.referencia.startsWith('http')).map(s => s.referencia)
    };
  }, [soportes]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor(diff / 60000);

    if (hours > 24) return date.toLocaleDateString('es-CO');
    if (hours > 0) return `hace ${hours}h`;
    if (minutes > 0) return `hace ${minutes}m`;
    return 'ahora';
  };

  if (loading && !alerts.length) {
    return (
      <div className="alerts-view">
        <div className="alerts-loading">
          <RefreshCw className="animate-spin" size={32} />
          <p>Cargando alertas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="alerts-view">
      <div className="alerts-header">
        <div className="alerts-stats">
          <div className="stat-card stat-critical">
            <XCircle size={24} />
            <div className="stat-info">
              <span className="stat-value">{stats?.critical || 0}</span>
              <span className="stat-label">Críticas</span>
            </div>
          </div>
          <div className="stat-card stat-high">
            <AlertTriangle size={24} />
            <div className="stat-info">
              <span className="stat-value">{stats?.high || 0}</span>
              <span className="stat-label">Altas</span>
            </div>
          </div>
          <div className="stat-card stat-active">
            <Bell size={24} />
            <div className="stat-info">
              <span className="stat-value">{stats?.active || 0}</span>
              <span className="stat-label">Activas</span>
            </div>
          </div>
          <div className="stat-card stat-resolved">
            <CheckCircle size={24} />
            <div className="stat-info">
              <span className="stat-value">{stats?.resolved || 0}</span>
              <span className="stat-label">Resueltas</span>
            </div>
          </div>
          <div className="stat-card stat-24h">
            <Clock size={24} />
            <div className="stat-info">
              <span className="stat-value">{stats?.last_24h || 0}</span>
              <span className="stat-label">Últimas 24h</span>
            </div>
          </div>
        </div>

        <div className="alerts-actions">
          <button className="btn-action" onClick={handleRunTriggers} title="Ejecutar triggers">
            <Zap size={18} />
            <span>Ejecutar Triggers</span>
          </button>
          <button className="btn-action btn-secondary" onClick={handleTestNotification} disabled={testing} title="Enviar alerta de prueba">
            <Send size={18} />
            <span>{testing ? 'Enviando...' : 'Test Notif'}</span>
          </button>
          <button className="btn-action" onClick={() => fetchAlerts()} title="Actualizar">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="soportes-section">
        <button className="soportes-toggle" onClick={() => setSoportesExpanded(!soportesExpanded)}>
          {soportesExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          <span>Configuración de Contexto de Alerta</span>
          <span className="soportes-count">{soportes.length} documentos</span>
        </button>
        
        {soportesExpanded && (
          <div className="soportes-table-container">
            <table className="soportes-table">
              <thead>
                <tr>
                  <th style={{ width: '30px' }}></th>
                  <th style={{ width: '50px' }}>Estado</th>
                  <th>Entidad</th>
                  <th>Referencia</th>
                  <th style={{ width: '60px' }}>Doc</th>
                  <th>Fuente</th>
                  <th>Notas</th>
                  <th style={{ width: '80px' }}>Nivel</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {soportes.map((soporte, idx) => {
                  const safeNivel = soporte.nivel || '1';
                  const nivelNum = isNaN(parseFloat(safeNivel)) ? 1 : parseFloat(safeNivel);
                  const isChild = safeNivel.includes('.');
                  const isActive = soporte.isActive !== undefined ? soporte.isActive : true;
                  const safeEntidad = soporte.entidad || '';
                  
                  return (
                  <tr 
                    key={soporte.id} 
                    style={{ opacity: isActive ? 1 : 0.5 }}
                    draggable
                    onDragStart={(e) => onDragStart(e, soporte.id)}
                    onDragOver={(e) => onDragOver(e, soporte.id)}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, soporte.id)}
                    className={`${dragOverId === soporte.id ? 'soporte-row--drag-over' : ''} ${isChild ? 'soporte-row--child' : 'soporte-row--parent'}`}
                  >
                    {!isChild ? (
                      <>
                        <td>
                          <span className="soporte-drag-handle" title="Arrastrar">⋮⋮</span>
                        </td>
                        <td>
                          <button 
                            className={`soporte-toggle ${isActive ? 'soporte-toggle--active' : ''}`}
                            onClick={() => toggleActive(soporte.id)}
                            title={isActive ? 'Activo - Controla todo el grupo' : 'Inactivo - Grupo ignorado'}
                          >
                            <div className="soporte-toggle-circle" />
                          </button>
                        </td>
                        <td><input type="text" value={safeEntidad} onChange={(e) => handleEntidadChange(soporte.id, e.target.value)} className="soporte-input" /></td>
                      </>
                    ) : (
                      <td colSpan={3} className="soporte-child-cell">
                        <div className="soporte-child-indicator" style={{ marginLeft: (getNivelNum(soporte.nivel)) * 20 }}>
                          <span className="soporte-child-badge">{safeNivel}</span>
                        </div>
                      </td>
                    )}
                    <td>
                      {soporte.fuente === 'link' ? (
                        <div className="soporte-link-input">
                          <span className="soporte-link-icon">🔗</span>
                          <input 
                            type="url" 
                            value={soporte.referencia} 
                            onChange={(e) => handleReferenciaChange(soporte.id, e.target.value)} 
                            className="soporte-input" 
                            placeholder="https://ejemplo.com/documento"
                          />
                        </div>
                      ) : (
                        <input 
                          type="text" 
                          value={soporte.referencia} 
                          onChange={(e) => handleReferenciaChange(soporte.id, e.target.value)} 
                          className="soporte-input" 
                          placeholder={soporte.fuente === 'local' ? 'Archivo local' : 'REF-001'}
                        />
                      )}
                    </td>
                    <td>
                      {soporte.fuente === 'local' ? (
                        <label className="soporte-file-btn" title={soporte.archivo?.nombre || 'Subir archivo (PDF, Word, Excel)'}>
                          <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" onChange={(e) => e.target.files?.[0] && handleFileUpload(soporte.id, e.target.files[0])} style={{ display: 'none' }} />
                          <span className={`soporte-clip ${soporte.archivo ? 'soporte-clip--loaded' : ''}`}>📎</span>
                          {soporte.archivo && <span className="soporte-file-name">{soporte.archivo.nombre.substring(0, 12)}</span>}
                        </label>
                      ) : (
                        <div className="soporte-fuente-select">
                          <select value={soporte.fuente} onChange={(e) => handleFuenteChange(soporte.id, e.target.value as 'link' | 'cloud' | 'local')} className="soporte-select">
                            <option value="link">🔗 Link</option>
                            <option value="cloud">☁️ Cloud</option>
                            <option value="local">📄 Local</option>
                          </select>
                        </div>
                      )}
                    </td>
                    <td><textarea value={soporte.notas} onChange={(e) => handleNotaChange(soporte.id, e.target.value)} placeholder="Notas..." className="soporte-textarea" rows={1} /></td>
                    <td>
                      <div className="soporte-indent-btns">
                        <button className="soporte-indent-btn" onClick={() => indentLeft(soporte.id)} disabled={!String(soporte.nivel || '1').includes('.')} title="Reducir nivel">←</button>
                        <span className="soporte-nivel-num">{String(soporte.nivel || '1')}</span>
                        <button className="soporte-indent-btn" onClick={() => indentRight(soporte.id)} disabled={String(soporte.nivel || '1').split('.').length >= 3} title="Identar (Dependencia Directa)">→</button>
                      </div>
                    </td>
                    <td><button className="soporte-delete" onClick={() => deleteSoporte(soporte.id)}>🗑️</button></td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="soportes-actions">
              <button className="soporte-add-btn" onClick={addSoporte}><Plus size={14} /> Agregar documento</button>
              <button className="soporte-generate-btn" onClick={generarResumenBlindaje} title="Generar Resumen de Blindaje">
                <FileText size={14} /> Generar Resumen de Blindaje
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="alerts-filters">
        <button
          className={`filter-btn ${!filterPriority ? 'active' : ''}`}
          onClick={() => setFilterPriority(null)}
        >
          Todas
        </button>
        <button
          className={`filter-btn filter-critical ${filterPriority === 'critical' ? 'active' : ''}`}
          onClick={() => setFilterPriority('critical')}
        >
          Críticas
        </button>
        <button
          className={`filter-btn filter-high ${filterPriority === 'high' ? 'active' : ''}`}
          onClick={() => setFilterPriority('high')}
        >
          Altas
        </button>
        <button
          className={`filter-btn filter-medium ${filterPriority === 'medium' ? 'active' : ''}`}
          onClick={() => setFilterPriority('medium')}
        >
          Medias
        </button>
        <button
          className={`filter-btn filter-low ${filterPriority === 'low' ? 'active' : ''}`}
          onClick={() => setFilterPriority('low')}
        >
          Bajas
        </button>
      </div>

      {error && (
        <div className="alerts-error">
          <XCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div className="alerts-list">
        {filteredAlerts.length === 0 ? (
          <div className="alerts-empty">
            <Bell size={48} />
            <h3>No hay alertas</h3>
            <p>El sistema está operando sin problemas</p>
          </div>
        ) : (
          filteredAlerts.map(alert => (
            <div
              key={alert.id}
              className={`alert-card alert-${alert.priority}`}
              style={{ '--priority-color': priorityColors[alert.priority] } as React.CSSProperties}
            >
              <div className="alert-card-header">
                <div className="alert-priority-icon" style={{ color: priorityColors[alert.priority] }}>
                  {priorityIcons[alert.priority]}
                </div>
                <div className="alert-info">
                  <h3 className="alert-title">{alert.title}</h3>
                  <div className="alert-meta">
                    <span className="alert-type">{alert.type}</span>
                    {alert.escalation_level > 0 && (
                      <span className="alert-escalation">↗️ Nivel {alert.escalation_level}</span>
                    )}
                    <span className="alert-time">
                      <Clock size={14} />
                      {formatTimestamp(alert.timestamp)}
                    </span>
                  </div>
                </div>
              </div>

              <p className="alert-message">{alert.message}</p>

              {Object.keys(alert.data).length > 0 && (
                <div className="alert-data">
                  {Object.entries(alert.data).map(([key, value]) => (
                    <span key={key} className="alert-data-item">
                      <strong>{key}:</strong> {String(value)}
                    </span>
                  ))}
                </div>
              )}

              {!alert.acknowledged && (
                <div className="alert-actions">
                  <button
                    className="btn-acknowledge"
                    onClick={() => acknowledgeAlert(alert.id, 'admin')}
                  >
                    <CheckCircle size={16} />
                    Marcar como resuelta
                  </button>
                </div>
              )}

              {alert.acknowledged && (
                <div className="alert-acknowledged">
                  <CheckCircle size={14} />
                  <span>Resuelta por {alert.acknowledged_by || 'sistema'}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}