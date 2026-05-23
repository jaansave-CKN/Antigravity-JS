import { useEffect, useRef } from 'react';
import { useDashboard } from '../contexts/DashboardContext';

export default function MapContainer() {
  const { predios, mapCenter, selectedPredio, selectPredio, setBounds } = useDashboard();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const initMap = async () => {
      const L = await import('leaflet');
      
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
      });

      const map = L.map(mapRef.current!).setView([mapCenter.lat, mapCenter.lng], 13);
      
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(map);

      map.on('moveend', () => {
        const b = map.getBounds();
        setBounds({
          south: b.getSouth(),
          north: b.getNorth(),
          west: b.getWest(),
          east: b.getEast()
        });
      });

      mapInstanceRef.current = map;
    };

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

useEffect(() => {
     if (!mapInstanceRef.current) return;

     markersRef.current.forEach(m => m.remove());
     markersRef.current = [];

     const L = require('leaflet');
     
     predios.forEach(predio => {
       const lat = predio.lat ?? mapCenter.lat;
       const lng = predio.lng ?? mapCenter.lng;
       const score = predio.evaluacion?.score_legal ?? 50;
       const color = score >= 80 ? 'green' : score >= 50 ? 'orange' : 'red';
       
       const marker = L.circleMarker([lat, lng], {
         radius: 8,
         fillColor: color,
         color: '#fff',
         weight: 2,
         opacity: 1,
         fillOpacity: 0.9
       }).addTo(mapInstanceRef.current);

       marker.bindPopup(`
         <b>${predio.direccion || predio.id}</b><br/>
         Score: ${score}<br/>
         <button onclick="window.selectPredio('${predio.id}')">Ver detalle</button>
       `);

       marker.on('click', () => selectPredio(predio));
       markersRef.current.push(marker);
     });

     (window as any).selectPredio = selectPredio;
   }, [predios, mapCenter, selectPredio]);

  return (
    <div className="h-full w-full rounded-lg overflow-hidden border border-gray-200">
      <style>{`
        .leaflet-container { height: 100%; width: 100%; }
      `}</style>
      <div ref={mapRef} className="h-full w-full" />
    </div>
  );
}