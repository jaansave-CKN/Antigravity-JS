import { useState, useCallback, useMemo, useTransition, memo } from 'react';
import { useAIOrchestrator } from '../hooks/useAIOrchestrator';
import type { ConvocatoriaEstandarizada } from '../types';

interface ManualEntryForm {
  titulo: string;
  url: string;
  donante: string;
  descripcion: string;
}

interface DirectorioGridProps {
  initialData?: ConvocatoriaEstandarizada[];
  onAddConvocatoria?: (entry: ManualEntryForm) => void;
}

const ColumnHeader = memo(({ title, count }: { title: string; count: number }) => (
  <div className="directorio-grid__column-header">
    <h3>{title}</h3>
    <span className="directorio-grid__count">{count}</span>
  </div>
));

ColumnHeader.displayName = 'ColumnHeader';

const AddButton = memo(({ onClick }: { onClick: () => void }) => (
  <button 
    className="directorio-grid__add-btn" 
    onClick={onClick}
    aria-label="Agregar convocatoria"
  >
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
    <span>Nueva Convocatoria</span>
  </button>
));

AddButton.displayName = 'AddButton';

const ConvCard = memo(({ item, onValidate }: { 
  item: ConvocatoriaEstandarizada; 
  onValidate?: (id: string, action: 'approve' | 'reject') => void;
}) => (
  <div className="directorio-grid__card">
    <div className="directorio-grid__card-header">
      <span className="directorio-grid__badge">{item.donante}</span>
      <span className="directorio-grid__score">{item.score_compatibilidad}%</span>
    </div>
    <h4 className="directorio-grid__card-title">{item.titulo}</h4>
    <p className="directorio-grid__card-desc">{item.descripcion?.substring(0, 120)}...</p>
    <div className="directorio-grid__card-meta">
      <span>{item.fecha_cierre || 'Sin fecha'}</span>
      <span>{item.moneda} {item.monto_max?.toLocaleString()}</span>
    </div>
    {onValidate && (
      <div className="directorio-grid__card-actions">
        <button onClick={() => onValidate(item.id, 'approve')}>Aprobar</button>
        <button onClick={() => onValidate(item.id, 'reject')}>Descartar</button>
      </div>
    )}
  </div>
));

ConvCard.displayName = 'ConvCard';

const ManualEntryModal = memo(({ 
  isOpen, 
  onClose, 
  onSubmit 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onSubmit: (data: ManualEntryForm) => void;
}) => {
  const [form, setForm] = useState<ManualEntryForm>({
    titulo: '',
    url: '',
    donante: '',
    descripcion: '',
  });

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
    setForm({ titulo: '', url: '', donante: '', descripcion: '' });
    onClose();
  }, [form, onSubmit, onClose]);

  if (!isOpen) return null;

  return (
    <div className="directorio-grid__modal-overlay" onClick={onClose}>
      <div className="directorio-grid__modal" onClick={e => e.stopPropagation()}>
        <h3>Agregar Nueva Convocatoria</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Título de la convocatoria"
            value={form.titulo}
            onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
            required
          />
          <input
            type="url"
            placeholder="URL de la convocatoria"
            value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            required
          />
          <input
            type="text"
            placeholder="Donante / Organismo"
            value={form.donante}
            onChange={e => setForm(f => ({ ...f, donante: e.target.value }))}
            required
          />
          <textarea
            placeholder="Descripción breve"
            value={form.descripcion}
            onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
            rows={3}
          />
          <div className="directorio-grid__modal-actions">
            <button type="button" onClick={onClose}>Cancelar</button>
            <button type="submit">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  );
});

ManualEntryModal.displayName = 'ManualEntryModal';

export const DirectorioGrid = memo(function DirectorioGrid({ 
  initialData = [], 
  onAddConvocatoria 
}: DirectorioGridProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { processingTasks, queueStatus, stats } = useAIOrchestrator();

  const mockData = useMemo(() => initialData.length > 0 ? initialData : [
    {
      id: '1',
      org_id: 'default',
      titulo: 'PNUD - Desarrollo Rural Sostenible 2026',
      donante: 'PNUD Colombia',
      descripcion: 'Financiación para proyectos de desarrollo rural sostenible en zonas afectadas.',
      url_convocatoria: 'https://www.pnud.co',
      url_fuente: 'https://www.pnud.co',
      fecha_cierre: '2026-06-30',
      isGlobal: false,
      targetCountry: 'Colombia',
      fundingType: 'Cooperación Internacional' as const,
      sectors: ['Desarrollo Rural', 'Infraestructura'] as any[],
      targetPopulation: ['Rural'] as any[],
      monto_min: 50000,
      monto_max: 500000,
      moneda: 'USD',
      paises_elegibles: ['Colombia'],
      requisitos: [],
      tags: ['PNUD', 'Desarrollo Rural'],
      score_compatibilidad: 92,
      estado: 'activa' as const,
      sourceMiner: 'Agente Minero',
      validationStatus: 'Aprobado' as const,
      fecha_indexacion: '2026-01-20',
      actualizada_en: '2026-01-20',
    },
    {
      id: '2',
      org_id: 'default',
      titulo: 'BID - Financiación Infraestructura Verde',
      donante: 'BID',
      descripcion: 'Préstamos para proyectos de infraestructura verde en ciudades.',
      url_convocatoria: 'https://www.iadb.org',
      url_fuente: 'https://www.iadb.org',
      fecha_cierre: '2026-08-15',
      isGlobal: false,
      targetCountry: 'Colombia',
      fundingType: 'Financiación' as const,
      sectors: ['Infraestructura', 'Medio Ambiente'] as any[],
      targetPopulation: ['Urbanización'] as any[],
      monto_min: 100000,
      monto_max: 2000000,
      moneda: 'USD',
      paises_elegibles: ['Colombia'],
      requisitos: [],
      tags: ['BID', 'Infraestructura'],
      score_compatibilidad: 85,
      estado: 'activa' as const,
      sourceMiner: 'Agente Minero',
      validationStatus: 'Aprobado' as const,
      fecha_indexacion: '2026-02-05',
      actualizada_en: '2026-02-05',
    },
  ], [initialData]);

  const columns = useMemo(() => ({
    available: mockData.filter(c => c.estado === 'activa'),
    pending: mockData.filter(c => c.validationStatus === 'Pendiente'),
    approved: mockData.filter(c => c.validationStatus === 'Aprobado'),
  }), [mockData]);

  const handleAddConvocatoria = useCallback((data: ManualEntryForm) => {
    startTransition(() => {
      onAddConvocatoria?.(data);
    });
  }, [onAddConvocatoria]);

  const handleValidate = useCallback((id: string, action: 'approve' | 'reject') => {
    console.log(`[DirectorioGrid] ${action} item ${id}`);
  }, []);

  return (
    <div className="directorio-grid">
      <div className="directorio-grid__header">
        <h2>Directorio de Convocatorias</h2>
        <div className="directorio-grid__status">
          <span className={`status-indicator status-${queueStatus}`} />
          <span>Agentes: {stats.agents}</span>
          <span>|</span>
          <span>Procesando: {stats.processing}</span>
        </div>
      </div>

      <div className="directorio-grid__toolbar">
        <AddButton onClick={() => setIsModalOpen(true)} />
      </div>

      <div className="directorio-grid__container">
        <div className="directorio-grid__column">
          <ColumnHeader title="Fondos Disponibles" count={columns.available.length} />
          <div className="directorio-grid__list">
            {columns.available.map(item => (
              <ConvCard key={item.id} item={item} />
            ))}
          </div>
        </div>

        <div className="directorio-grid__column">
          <ColumnHeader title="Pendiente de Validación" count={columns.pending.length} />
          <div className="directorio-grid__list">
            {columns.pending.map(item => (
              <ConvCard key={item.id} item={item} onValidate={handleValidate} />
            ))}
            {columns.pending.length === 0 && (
              <p className="directorio-grid__empty">Sin convocatorias pendientes</p>
            )}
          </div>
        </div>

        <div className="directorio-grid__column">
          <ColumnHeader title="Validados" count={columns.approved.length} />
          <div className="directorio-grid__list">
            {columns.approved.map(item => (
              <ConvCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>

      <ManualEntryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddConvocatoria}
      />
    </div>
  );
});

export default DirectorioGrid;