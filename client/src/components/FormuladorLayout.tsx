import { Outlet } from 'react-router-dom';
import DashboardFormuladorPage from '../pages/DashboardFormuladorPage';

export default function FormuladorLayout() {
  return (
    /* Contenedor fijo al viewport (menos 48px de TopNavBar) — sin scroll de página */
    <div style={{ display: 'flex', height: 'calc(100vh - 48px)', width: '100%', overflow: 'hidden' }}>

      {/* C2 — contenido principal, scroll independiente dentro de su columna.
          overflowY:'scroll' (no 'auto') a propósito: la barra queda siempre
          reservada/visible sin importar cuánto contenido tenga cada página —
          con 'auto' aparecía/desaparecía según la altura de cada ventana,
          reportado por el usuario como parte del "salto" visual entre ellas. */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'scroll', overflowX: 'auto' }}>
        <Outlet />
      </div>

      {/* C3+C4 — dashboard embedded, altura fija 100%, scroll independiente interno */}
      <aside style={{
        width: '40vw',
        maxWidth: '40vw',
        minWidth: 360,
        flexShrink: 0,
        borderLeft: '1px solid #d0d9e4',
        overflow: 'hidden',
        height: '100%',
      }}>
        <DashboardFormuladorPage embedded />
      </aside>
    </div>
  );
}
