import { useState } from 'react';
import type { ModuloActivo } from '../types';
import SystemMonitor from './SystemMonitor';
import SystemHealth from './SystemHealth';

interface SidebarRightProps {
  moduloActivo: ModuloActivo;
  onModuloChange: (modulo: ModuloActivo) => void;
}

export default function SidebarRight({ moduloActivo, onModuloChange }: SidebarRightProps) {
  const [showMonitor, setShowMonitor] = useState(true);

  return (
    <aside className="sidebar-right">
      <div className="sidebar-right__content">
        {showMonitor ? (
          <>
            <SystemMonitor />
            <SystemHealth />
          </>
        ) : (
          <div className="sidebar-right__placeholder">
            <span>Espacio publicitario</span>
          </div>
        )}
      </div>
    </aside>
  );
}