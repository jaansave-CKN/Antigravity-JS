import { useDashboard } from '../contexts/DashboardContext';

// 1. Definición estricta de la interfaz Predio para corregir el error TS2305
export interface Predio {
  id: string;
  direccion: string;
  area_m2: number;
  valor_catastral: number;
  evaluacion?: {
    score_legal: number;
    alertas?: string[];
    recomendaciones?: string[];
  };
  [key: string]: any; // Extensibilidad segura para otras propiedades del contexto
}

// 2. Interfaz de las Props del Componente
interface OpportunitiesTableProps {
  predios: Predio[];
  onSelect: (predio: Predio) => void;
  selectedId?: string | null;
  loading: boolean;
}

// 3. Componente de la Tabla de Oportunidades
export function OpportunitiesTable({ predios, onSelect, selectedId, loading }: OpportunitiesTableProps) {
  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-2 text-gray-600">Cargando oportunidades...</p>
      </div>
    );
  }

  if (predios.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p>No se encontraron oportunidades en esta zona</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Dirección</th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Score</th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Valor</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {predios.map(predio => {
            const score = predio.evaluacion?.score_legal || 0;
            const isSelected = predio.id === selectedId;

            return (
              <tr
                key={predio.id}
                onClick={() => onSelect(predio)}
                className={`cursor-pointer hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}
              >
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
                    {predio.direccion}
                  </div>
                  <div className="text-xs text-gray-500">{predio.area_m2} m²</div>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block px-2 py-1 rounded-full text-xs font-bold ${score >= 80 ? 'bg-green-100 text-green-800' :
                      score >= 50 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                    }`}>
                    {score}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-sm text-gray-900">
                  ${predio.valor_catastral.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
