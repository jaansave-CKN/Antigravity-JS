import React, { Suspense } from 'react';
import { useDashboard } from '../contexts/DashboardContext';
const MapContainer = React.lazy(() => import('./MapContainer'));
import { OpportunitiesTable } from './OpportunitiesTable';


interface PredioData {
  id: string;
  direccion: string;
  area_m2: number;
  valor_catastral: number;
  propietario: string;
  matricula: string;
  evaluacion?: {
    score_legal: number;
    alertas: string[];
    recomendaciones: string[];
  };
  [key: string]: any;
}

export function Dashboard() {
  const { predios, loading, selectedPredio, selectPredio, filters, setFilters } = useDashboard();

  return (
    <div className="flex h-screen bg-gray-50">
      <div className="flex-1 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-800">RadarFondos 360 - Oportunidades Inmobiliarias</h1>
            <div className="flex gap-4 items-center">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.viableOnly}
                  onChange={(e) => setFilters({ viableOnly: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-600">Solo viables</span>
              </label>
              <select
                value={filters.minScore}
                onChange={(e) => setFilters({ minScore: parseInt(e.target.value) })}
                className="border border-gray-300 rounded px-2 py-1 text-sm"
              >
                <option value={30}>Score ≥ 30</option>
                <option value={50}>Score ≥ 50</option>
                <option value={70}>Score ≥ 70</option>
                <option value={80}>Score ≥ 80</option>
              </select>
            </div>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <main className="flex-1 p-4 overflow-auto">
            <Suspense fallback={<div className='h-full flex items-center justify-center'>Cargando mapa...</div>}>
  <MapContainer />
</Suspense>
          </main>

          <aside className="w-96 border-l border-gray-200 bg-white overflow-y-auto">
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">
                Oportunidades Encontradas ({predios.length})
              </h2>
            </div>
            <OpportunitiesTable
              predios={predios}
              onSelect={selectPredio}
              selectedId={selectedPredio?.id}
              loading={loading}
            />
          </aside>
        </div>
      </div>

      {selectedPredio && <PropertyDetail predio={selectedPredio as PredioData} onClose={() => selectPredio(null)} />}
    </div>
  );
}

function PropertyDetail({ predio, onClose }: { predio: PredioData; onClose: () => void }) {
  if (!predio) return null;

  const { evaluacion } = predio;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">{predio.direccion}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm text-gray-500">Área</span>
              <p className="font-medium">{predio.area_m2} m²</p>
            </div>
            <div>
              <span className="text-sm text-gray-500">Valor Catastral</span>
              <p className="font-medium">${predio.valor_catastral.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-sm text-gray-500">Propietario</span>
              <p className="font-medium">{predio.propietario}</p>
            </div>
            <div>
              <span className="text-sm text-gray-500">Matrícula</span>
              <p className="font-medium">{predio.matricula}</p>
            </div>
          </div>

          {evaluacion && (
            <div className="border-t pt-4">
              <h3 className="font-semibold text-gray-800 mb-2">Evaluación Legal</h3>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-3xl font-bold">{evaluacion.score_legal}</span>
                <span className={`px-2 py-1 rounded text-sm font-medium ${evaluacion.score_legal >= 80 ? 'bg-green-100 text-green-800' :
                    evaluacion.score_legal >= 50 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                  }`}>
                  {evaluacion.score_legal >= 80 ? 'ÓPTIMO' : evaluacion.score_legal >= 50 ? 'MODERADO' : 'RIESGO ALTO'}
                </span>
              </div>

              {evaluacion.alertas && evaluacion.alertas.length > 0 && (
                <div className="mb-3">
                  <h4 className="font-medium text-gray-700 mb-1">Alertas</h4>
                  <ul className="list-disc list-inside text-sm text-gray-600">
                    {evaluacion.alertas.map((a: string, i: number) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {evaluacion.recomendaciones && evaluacion.recomendaciones.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-700 mb-1">Recomendaciones</h4>
                  <ul className="list-disc list-inside text-sm text-gray-600">
                    {evaluacion.recomendaciones.map((r: string, i: number) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
