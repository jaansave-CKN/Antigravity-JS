import { useDashboard } from '../contexts/DashboardContext';
import MapContainer from './MapContainer';
import { OpportunitiesTable } from './OpportunitiesTable';

export function Dashboard() {
  const { predios, loading, selectedPredio, selectPredio, filters, setFilters } = useDashboard();

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="flex-1 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
          <h1 className="text-xl font-bold text-gray-800">Antigravity Radar 360</h1>
        </header>
        <div className="flex-1 flex overflow-hidden">
          <main className="flex-1 p-4 overflow-auto">
            <div className="h-full w-full rounded-lg shadow-inner overflow-hidden border border-gray-200 bg-white">
              <MapContainer />
            </div>
          </main>
          <aside className="w-96 border-l border-gray-200 bg-white overflow-y-auto">
            <OpportunitiesTable
              predios={predios || []}
              onSelect={selectPredio}
              selectedId={selectedPredio?.id}
              loading={loading}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
