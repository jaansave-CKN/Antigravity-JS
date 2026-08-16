import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ModulePending from './pages/ModulePending';
import InicioPage from './pages/InicioPage';
import RadarApp from './RadarApp';
import Modulo10Page from './pages/Modulo10Page';
import RequireAuth from './components/RequireAuth';
import {
  BarChart3, BookOpen, Star, Calendar,
  Layers, Paperclip, Truck, MessageSquare, FileText
} from 'lucide-react';

export default function App() {
  return (
    <Routes>
      <Route path="/inicio" element={<InicioPage />} />
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/radar" replace />} />

        {/* MÓDULO A — Bloque de Monitoreo y Datos */}
        <Route path="radar" element={<RadarApp />} />
        <Route path="panel"       element={<ModulePending title="Panel"                  module="A" Icon={BarChart3}    />} />
        <Route path="directorio"  element={<ModulePending title="Directorio"             module="A" Icon={BookOpen}     />} />
        <Route path="favoritos"   element={<ModulePending title="Favoritos"              module="A" Icon={Star}         />} />
        <Route path="calendario"  element={<ModulePending title="Calendario de Favoritos" module="A" Icon={Calendar}   />} />

        {/* MÓDULO B — Formulación AI 7.0 */}
        <Route path="modulo10"    element={<Modulo10Page />} />
        <Route path="anexos"      element={<ModulePending title="Anexos"                 module="B" Icon={Paperclip}   />} />
        <Route path="logistica"   element={<ModulePending title="Logística"              module="B" Icon={Truck}       />} />
        <Route path="dialetica"   element={<ModulePending title="Dialéctica"             module="B" Icon={MessageSquare}/>} />
        <Route path="ficha"       element={<ModulePending title="Ficha Técnica"          module="B" Icon={FileText}    />} />
      </Route>
    </Routes>
  );
}
