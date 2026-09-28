import { useNavigate } from 'react-router-dom';
import { T } from '../components/checklist/checklistModulos';
import { useChecklistLogic } from '../hooks/useChecklistLogic';
import ChecklistTopbar from '../components/checklist/ChecklistTopbar';
import FormatoFinanciadorCard from '../components/checklist/FormatoFinanciadorCard';
import FormulacionIntegralCard from '../components/checklist/FormulacionIntegralCard';
import ModulosLista from '../components/checklist/ModulosLista';
import { RadicarPanel, RadicadoSello } from '../components/checklist/RadicacionPaneles';

/**
 * ChecklistPage — alineado a la paleta calco Light Mode del resto del área
 * de trabajo (Entrada, Contexto, Dialéctica, Logística, Anexos).
 * Tokens fuente: EntradaPage.css — bg #f7f9fb · card #ffffff · border #e0e3e5
 * · text #191c1e · primary #0058be · Manrope.
 *
 * Refactor 2026-09-28 (sin cambio visual ni de comportamiento, verificado con
 * capturas píxel a píxel): lógica en hooks/useChecklistLogic.ts (+
 * useFormulacionIntegral, useRadicacion), datos en
 * components/checklist/checklistModulos.ts y JSX en components/checklist/.
 */
export default function ChecklistPage() {
  const navigate = useNavigate();
  const { formato, estados, doneCount, progress, proyectoId, radicacion, formulacion } = useChecklistLogic();

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: T.font, minHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>

      <ChecklistTopbar progress={progress} doneCount={doneCount} total={estados.length} />

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

        <FormatoFinanciadorCard formato={formato} />

        {proyectoId && <FormulacionIntegralCard {...formulacion} />}

        <ModulosLista estados={estados} onNavigate={navigate} />

        {progress === 100 && !radicacion.radicarOk && (
          <RadicarPanel
            proyectoId={proyectoId}
            radicando={radicacion.radicando}
            radicarError={radicacion.radicarError}
            onRadicar={radicacion.radicarProyecto}
          />
        )}

        {radicacion.radicarOk && <RadicadoSello radicarOk={radicacion.radicarOk} />}
      </div>
    </div>
  );
}
