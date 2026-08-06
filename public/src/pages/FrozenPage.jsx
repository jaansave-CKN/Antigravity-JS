import { Snowflake } from 'lucide-react';

export default function FrozenPage({ title, module, Icon }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-screen bg-gray-900 text-white">
      <div className="flex flex-col items-center gap-6 max-w-sm text-center px-6">
        <div className="relative">
          {Icon && (
            <div className="w-20 h-20 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center">
              <Icon size={36} className="text-gray-500" />
            </div>
          )}
          <div className="absolute -bottom-2 -right-2 w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center">
            <Snowflake size={13} className="text-blue-400" />
          </div>
        </div>

        <div>
          <h2 className="text-xl font-bold text-gray-200 mb-1">{title}</h2>
          <p className="text-sm text-gray-500">
            Módulo {module} · En espera de ensamblaje
          </p>
        </div>

        <div className="w-full py-3 px-5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold tracking-widest uppercase">
          Frozen — Próximamente
        </div>
      </div>
    </div>
  );
}
