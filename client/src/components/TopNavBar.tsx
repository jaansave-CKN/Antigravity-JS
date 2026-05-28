import { NavLink } from 'react-router-dom';

const NAV_LINKS = [
  { to: '/',           label: 'Inicio',           end: true  },
  { to: '/radar',      label: 'Radar',            end: false },
  { to: '/directorio', label: 'Directorio',       end: false },
  { to: '/settings',   label: 'Panel de control', end: false },
] as const;

export default function TopNavBar() {
  return (
    <nav className="bg-white border-b border-[#e2e8f0] px-6 h-12 flex items-center gap-8 shrink-0">
      <span className="text-[#191c1e] font-semibold text-sm tracking-tight mr-2">
        GGIE <span className="text-[#76777d] font-normal">Radar de Fondos</span>
      </span>
      <div className="flex items-center gap-1">
        {NAV_LINKS.map(({ to, label, end }) => (
          <NavLink
            key={label}
            to={to}
            end={end}
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-[rgba(0,88,190,0.08)] text-[#0058be]'
                  : 'text-[#45464d] hover:text-[#191c1e] hover:bg-[#f2f4f6]'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
