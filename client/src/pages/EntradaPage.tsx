/**
 * EntradaPage — Calco estricto Stitch screen "Pestaña #1: Datos de Entrada (Fondo Blanco)"
 * Screen ID: projects/3791086755596777919/screens/5142894009029579964
 * Tokens: bg #f7f9fb · card #ffffff · border #e0e3e5 · text #191c1e · primary #0058be
 *
 * Refactor 2026-09-28 (sin cambio visual ni de comportamiento; dictamen
 * architect APROBADO CON CAMBIOS; verificado con capturas píxel a píxel):
 * - Lógica: hooks/entrada/useEntradaFormLogic.ts (a→h, el ORDEN de los
 *   efectos es parte del contrato — ver ese archivo).
 * - Datos y funciones puras: components/entrada/entradaModelo.ts.
 * - JSX: components/entrada/* (sin estado ni efectos propios).
 */
import { useEntradaFormLogic } from '../hooks/entrada/useEntradaFormLogic';
import EntradaTopbar from '../components/entrada/EntradaTopbar';
import { SeccionNombre, SeccionPitch } from '../components/entrada/SeccionesIdentidad';
import { SeccionEnfoque, SeccionTipoConvocatoria, SeccionNivelMetodologiaFormato } from '../components/entrada/SeccionesPerfil';
import { SeccionSector, SeccionCategoriaPoblacion, SeccionDetallePoblacion, SeccionUbicacion } from '../components/entrada/SeccionesPoblacion';
import SeccionContexto from '../components/entrada/SeccionContexto';
import SeccionSoluciones from '../components/entrada/SeccionSoluciones';
import './EntradaPage.css';

export default function EntradaPage() {
  const L = useEntradaFormLogic();
  const { st, setSt } = L;

  return (
    <div className="entr">
      <EntradaTopbar
        limpiado={L.limpiado} sinGuardar={L.sinGuardar} guardando={L.guardando}
        errorEntradaCompleta={L.errorEntradaCompleta} onLimpiar={L.limpiar} onGuardar={L.guardar}
      />

      {/* ── Layout ── */}
      <div className="entr__layout">

        {/* ── Main ── */}
        <main className="entr__main" ref={L.mainRef}>
          <div className="entr__form">

            <SeccionNombre
              st={st} setSt={setSt} bloqueado={L.campoBloqueado('nombre')} cuotaAgotada={L.cuotaAgotada}
              generandoNombre={L.generandoNombre} sincronizandoProyecto={L.sincronizandoProyecto} errorProyecto={L.errorProyecto}
              aviso={L.aviso} onBlur={L.sincronizarProyectoActivo} onToggleBloqueo={() => L.toggleBloqueo('nombre')} onGenerar={L.generarNombreConIA}
            />
            <SeccionPitch
              st={st} setSt={setSt} bloqueado={L.campoBloqueado('pitch')} cuotaAgotada={L.cuotaAgotada}
              generandoPitch={L.generandoPitch} onToggleBloqueo={() => L.toggleBloqueo('pitch')} onGenerar={L.generarPitchConIA}
            />
            <SeccionEnfoque st={st} setSt={setSt} />
            <SeccionTipoConvocatoria st={st} setSt={setSt} />
            <SeccionNivelMetodologiaFormato st={st} setSt={setSt} toggleMetodologia={L.toggleMetodologia} />

            {/* AJUSTE (2026-08-23): el módulo 06 "Población Objetivo" se eliminó
                de la UI — Beneficiarios se escribe en C3 y Cobertura sale de
                Municipio/Vereda (ver E5/E9 en useEntradaReglasCampoC). */}
            <SeccionSector st={st} setSt={setSt} sectoresSet={L.sectoresSet} toggleSector={L.toggleSector} />
            <SeccionCategoriaPoblacion st={st} setSt={setSt} />
            <SeccionDetallePoblacion detallePoblacionSet={L.detallePoblacionSet} toggleDetalle={L.toggleDetalle} />
            <SeccionUbicacion st={st} setSt={setSt} />

            <SeccionContexto
              st={st} setSt={setSt} aviso={L.aviso} cuotaAgotada={L.cuotaAgotada} generandoCampo={L.generandoCampo}
              voiceField={L.voiceField} campoBloqueado={L.campoBloqueado} onToggleBloqueo={L.toggleBloqueo}
              onGenerar={L.generarCampoConIA} onToggleVoz={L.toggleVoice} onRecargarProblematicas={L.cargarProblematicas}
            />
            <SeccionSoluciones
              st={st} setSt={setSt} aviso={L.aviso} cuotaAgotada={L.cuotaAgotada}
              generandoCampo={L.generandoCampo} onGenerar={L.generarSoluciones}
            />

          </div>
        </main>
      </div>
    </div>
  );
}
