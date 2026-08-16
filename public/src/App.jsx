import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ModulePending from './pages/ModulePending';
import InicioPage from './pages/InicioPage';
import RadarApp from './RadarApp';
import Modulo10Page from './pages/Modulo10Page';
import RequireAuth from './components/RequireAuth';
import { FileText } from 'lucide-react';

export default function App() {
  return (
    <Routes>
      <Route path="/inicio" element={<InicioPage />} />
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/radar" replace />} />

        {/* MÓDULO A — Bloque de Monitoreo y Datos */}
        <Route path="radar" element={<RadarApp />} />

        {/* MÓDULO B — Formulación AI 7.0 */}
        <Route path="modulo10"    element={<Modulo10Page />} />
        <Route path="ficha"       element={<ModulePending title="Ficha Técnica"          module="B" Icon={FileText}    />} />

        {/* Fuera de alcance v1.0 (Directiva Corte de Perímetro): panel, directorio, favoritos, calendario, anexos, logistica, dialetica */}
        <Route path="*" element={<Navigate to="/radar" replace />} />
      </Route>
    </Routes>
  );
}
