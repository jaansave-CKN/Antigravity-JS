import { useState, useEffect, useCallback, useRef } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { 
  Link, 
  Cloud, 
  FileText, 
  ChevronDown, 
  ChevronUp,
  Plus,
  Trash2,
  Upload,
  Bot
} from 'lucide-react';
import { useAnexosAgentIntegration, AnexoItem } from '../hooks/useAnexosAgentIntegration';
import './AnexosView.css';

const STORAGE_KEY = 'radar360_anexos_data';
const DEBOUNCE_MS = 500;

const fuentesIcons: Record<string, React.ReactNode> = {
  link: <Link size={16} className="fuente-icon fuente-icon--link" />,
  cloud: <Cloud size={16} className="fuente-icon fuente-icon--cloud" />,
  local: <FileText size={16} className="fuente-icon fuente-icon--local" />
};

interface AnexosViewProps {
  className?: string;
}

export default function AnexosView({ className }: AnexosViewProps) {
  const [anexos, setAnexos] = useState<AnexoItem[]>([]);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  
  const { 
    injectToAllAgents, 
    buildContextPayload,
    agentActivity,
    isAgentActive,
    getAgentScanningNote
  } = useAnexosAgentIntegration();

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setAnexos(parsed);
      } catch {
        setAnexos(getInitialAnexos());
      }
    } else {
      setAnexos(getInitialAnexos());
    }
  }, []);

  const getInitialAnexos = (): AnexoItem[] => [
    {
      id: '1',
      entidad: 'BID - Banco Interamericano de Desarrollo',
      referencia: 'CONV-2026-001',
      fuente: 'link',
      notas: '',
      activo: false,
      actualizadoEn: new Date().toISOString()
    },
    {
      id: '2',
      entidad: 'Unión Europea - Horizon Europe',
      referencia: 'HE-2026-045',
      fuente: 'cloud',
      notas: '',
      activo: false,
      actualizadoEn: new Date().toISOString()
    },
    {
      id: '3',
      entidad: 'PNUD Colombia',
      referencia: 'PNUD-COL-2026-12',
      fuente: 'link',
      notas: '',
      activo: false,
      actualizadoEn: new Date().toISOString()
    },
    {
      id: '4',
      entidad: 'SENA - Fondo Emprender',
      referencia: 'FE-2026-Q1',
      fuente: 'local',
      notas: '',
      activo: false,
      actualizadoEn: new Date().toISOString()
    }
  ];

  const saveToStorage = useCallback((anexosToSave: AnexoItem[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(anexosToSave));
    const payload = buildContextPayload(anexosToSave, '002_estratega');
    localStorage.setItem('radar360_anexos_context', JSON.stringify(payload));
  }, [buildContextPayload]);

  const handleNotaChange = useCallback((id: string, nota: string) => {
    setAnexos(prev => prev.map(a => 
      a.id === id ? { ...a, notas: nota, actualizadoEn: new Date().toISOString() } : a
    ));

    if (debounceTimers.current.has(id)) {
      clearTimeout(debounceTimers.current.get(id));
    }

    const timer = setTimeout(() => {
      setAnexos(currentAnexos => {
        const updated = currentAnexos.map(a => 
          a.id === id ? { ...a, actualizadoEn: new Date().toISOString() } : a
        );
        saveToStorage(updated);
        
        const activos = updated.filter(a => a.activo);
        if (activos.length > 0) {
          injectToAllAgents(activos);
        }
        
        return updated;
      });
      debounceTimers.current.delete(id);
    }, DEBOUNCE_MS);

    debounceTimers.current.set(id, timer);
  }, [saveToStorage, injectToAllAgents]);

  const handleToggleActivo = useCallback((id: string) => {
    setAnexos(prev => {
      const updated = prev.map(a => 
        a.id === id ? { ...a, activo: !a.activo, actualizadoEn: new Date().toISOString() } : a
      );
      saveToStorage(updated);
      
      const activos = updated.filter(a => a.activo);
      if (activos.length > 0) {
        injectToAllAgents(activos);
      }
      
      return updated;
    });
  }, [saveToStorage, injectToAllAgents]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedNotes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const addNewAnexo = useCallback(() => {
    const newAnexo: AnexoItem = {
      id: Date.now().toString(),
      entidad: 'Nueva Entidad',
      referencia: `REF-${Date.now()}`,
      fuente: 'link',
      notas: '',
      activo: false,
      actualizadoEn: new Date().toISOString()
    };
    setAnexos(prev => {
      const updated = [...prev, newAnexo];
      saveToStorage(updated);
      return updated;
    });
  }, [saveToStorage]);

  const deleteAnexo = useCallback((id: string) => {
    setAnexos(prev => {
      const updated = prev.filter(a => a.id !== id);
      saveToStorage(updated);
      return updated;
    });
  }, [saveToStorage]);

  const isNoteBeingScanned = useCallback((noteId: string) => {
    const minerScanning = getAgentScanningNote('001_minero') === noteId;
    const estrategaScanning = getAgentScanningNote('002_estratega') === noteId;
    return { miner: minerScanning, estratega: estrategaScanning };
  }, [getAgentScanningNote]);

  return (
    <div className={`anexos-view ${className || ''}`}>
      <div className="anexos-view__header">
        <h2 className="anexos-view__title">Anexos y Soportes</h2>
        <div className="anexos-view__actions">
          <button className="anexos-view__btn anexos-view__btn--upload">
            <Upload size={16} />
            <span>Importar</span>
          </button>
          <button className="anexos-view__btn anexos-view__btn--add" onClick={addNewAnexo}>
            <Plus size={16} />
            <span>Nuevo</span>
          </button>
        </div>
      </div>

      <div className="anexos-view__agents-status">
        <div className={`anexos-view__agent-indicator ${isAgentActive('001_minero') ? 'anexos-view__agent-indicator--active' : ''}`}>
          <Bot size={14} />
          <span>001 Minero</span>
          <span className="anexos-view__led" />
        </div>
        <div className={`anexos-view__agent-indicator ${isAgentActive('002_estratega') ? 'anexos-view__agent-indicator--active' : ''}`}>
          <Bot size={14} />
          <span>002 Estratega</span>
          <span className="anexos-view__led" />
        </div>
      </div>

      <div className="anexos-view__table-container">
        <table className="anexos-view__table">
          <thead>
            <tr>
              <th className="anexos-view__th anexos-view__th--estado">Estado</th>
              <th className="anexos-view__th anexos-view__th--entidad">Entidad</th>
              <th className="anexos-view__th anexos-view__th--referencia">Referencia</th>
              <th className="anexos-view__th anexos-view__th--fuente">Fuente</th>
              <th className="anexos-view__th anexos-view__th--documento">Documento</th>
              <th className="anexos-view__th anexos-view__th--notas">Notas Personales</th>
              <th className="anexos-view__th anexos-view__th--actions"></th>
            </tr>
          </thead>
          <tbody>
            {anexos.map((anexo) => {
              const scanning = isNoteBeingScanned(anexo.id);
              return (
                <tr key={anexo.id} className={`anexos-view__row ${scanning.miner || scanning.estratega ? 'anexos-view__row--scanning' : ''}`}>
                  <td className="anexos-view__td anexos-view__td--estado">
                    <label className="anexos-view__toggle">
                      <input
                        type="checkbox"
                        checked={anexo.activo}
                        onChange={() => handleToggleActivo(anexo.id)}
                        className="anexos-view__toggle-input"
                      />
                      <span className={`anexos-view__toggle-switch ${anexo.activo ? 'anexos-view__toggle-switch--active' : ''}`}>
                        <span className="anexos-view__toggle-knob" />
                      </span>
                    </label>
                  </td>
                  <td className="anexos-view__td anexos-view__td--entidad">{anexo.entidad}</td>
                  <td className="anexos-view__td anexos-view__td--referencia">{anexo.referencia}</td>
                  <td className="anexos-view__td anexos-view__td--fuente">
                    <span className="anexos-view__fuente-badge" data-fuente={anexo.fuente}>
                      {fuentesIcons[anexo.fuente] || <FileText size={16} />}
                    </span>
                  </td>
                  <td className="anexos-view__td anexos-view__td--documento">
                    {anexo.documento ? (
                      <span className="anexos-view__doc-preview">{anexo.documento}</span>
                    ) : (
                      <span className="anexos-view__doc-empty">-</span>
                    )}
                  </td>
                  <td className="anexos-view__td anexos-view__td--notas">
                    <div className="anexos-view__notas-container">
                      <div className={`anexos-view__notas-toggle ${expandedNotes.has(anexo.id) ? 'anexos-view__notas-toggle--expanded' : ''}`} onClick={() => toggleExpanded(anexo.id)}>
                        {expandedNotes.has(anexo.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        <span className="anexos-view__notas-label">Notas</span>
                        {(scanning.miner || scanning.estratega) && (
                          <span className="anexos-view__scanning-indicator">
                            {scanning.miner && <span className="anexos-view__led anexos-view__led--small" />}
                            {scanning.estratega && <span className="anexos-view__led anexos-view__led--small" />}
                          </span>
                        )}
                      </div>
                      <TextareaAutosize
                        value={anexo.notas}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleNotaChange(anexo.id, e.target.value)}
                        placeholder="Escribe tus notas personales..."
                        className="anexos-view__notas-input"
                        minRows={expandedNotes.has(anexo.id) ? 3 : 1}
                        maxRows={8}
                      />
                    </div>
                  </td>
                  <td className="anexos-view__td anexos-view__td--actions">
                    <button className="anexos-view__btn-delete" onClick={() => deleteAnexo(anexo.id)} title="Eliminar">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="anexos-view__footer">
        <span className="anexos-view__count">
          {anexos.filter(a => a.activo).length} de {anexos.length} activos para agentes
        </span>
      </div>
    </div>
  );
}