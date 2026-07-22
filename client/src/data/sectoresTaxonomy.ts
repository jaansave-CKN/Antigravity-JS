export interface SubgrupoItem {
  nombre: string;
  color: string;
  items: string[];
}

export interface SectorItem {
  nombre: string;
  color: string;
  subgrupos: SubgrupoItem[];
}

export const SECTORES_TAXONOMY: SectorItem[] = [
  {
    nombre: 'Hábitat y Territorio',
    color: '#EA580C',
    subgrupos: [
      { nombre: 'Construcción',           color: '#D97706', items: ['Infraestructura Social', 'Espacios Públicos', 'Centros de Integración Ciudadana', 'Otro'] },
      { nombre: 'Vivienda',               color: '#B45309', items: ['Vivienda de Interés Social (VIS)', 'Vivienda de Interés Prioritario (VIP)', 'Mejoramiento de Vivienda Rural'] },
      { nombre: 'Transporte',             color: '#92400E', items: ['Infraestructura Vial Terrestre', 'Modos de Transporte Fluvial', 'Movilidad Urbana Sostenible'] },
      { nombre: 'Ordenamiento Territorial', color: '#78350F', items: ['Catastro Multipropósito', 'Planes de Ordenamiento Territorial', 'Legalización de Predios'] },
    ],
  },
  {
    nombre: 'Soberanía y Vida',
    color: '#0891B2',
    subgrupos: [
      { nombre: 'Agua',               color: '#06B6D4', items: ['Acueductos Municipales', 'Sistemas de Potabilización Rural', 'Captura de Aguas Lluvias', 'Otro'] },
      { nombre: 'Saneamiento',        color: '#0E7490', items: ['Unidades Sanitarias (Baterías de Baño)', 'Alcantarillado', 'Plantas de Tratamiento de Aguas Residuales'] },
      { nombre: 'Salud',              color: '#10B981', items: ['Infraestructura Hospitalaria', 'Puestos de Salud Rurales', 'Dotación Médica de Emergencia'] },
      { nombre: 'Medio Ambiente',     color: '#059669', items: ['Reforestación', 'Protección de Cuencas Hídricas', 'Economía Circular y Residuos'] },
      { nombre: 'Gestión de Riesgos', color: '#DC2626', items: ['Mitigación de Desastres', 'Muros de Contención', 'Reubicación por Riesgo Geológico'] },
    ],
  },
  {
    nombre: 'Paz y Sociedad',
    color: '#7C3AED',
    subgrupos: [
      { nombre: 'Derechos Humanos',    color: '#8B5CF6', items: ['Protección a Víctimas', 'Restitución de Tierras', 'Equidad de Género', 'Otro'] },
      { nombre: 'Cultura',             color: '#A21CAF', items: ['Casas de Cultura', 'Patrimonio Inmaterial', 'Escuelas de Formación Artística'] },
      { nombre: 'Deporte',             color: '#C026D3', items: ['Complejos Deportivos', 'Parques Biosaludables', 'Escuelas de Deporte Social'] },
      { nombre: 'Justicia',            color: '#BE185D', items: ['Casas de Justicia', 'Centros de Conciliación', 'Fortalecimiento Institucional'] },
      { nombre: 'Ayuda Humanitaria',   color: '#F43F5E', items: ['Atención a Población Migrante', 'Albergues Temporales', 'Seguridad Alimentaria de Emergencia'] },
    ],
  },
  {
    nombre: 'Autonomía Económica',
    color: '#16A34A',
    subgrupos: [
      { nombre: 'Agricultura',                      color: '#22C55E', items: ['Distritos de Riego', 'Centros de Acopio Agropecuarios', 'Maquinaria y Equipos', 'Otro'] },
      { nombre: 'Desarrollo Rural',                 color: '#84CC16', items: ['Caminos Vecinales', 'Plantas de Transformación', 'Proyectos Productivos Campesinos'] },
      { nombre: 'Turismo',                          color: '#14B8A6', items: ['Infraestructura Turística', 'Agroturismo', 'Turismo de Naturaleza Sostenible'] },
      { nombre: 'Emprendimiento y Cooperativismo',  color: '#6366F1', items: ['Fortalecimiento de Asociaciones (JAC/Cooperativas)', 'Capital Semilla', 'Formalización Empresarial'] },
    ],
  },
  {
    nombre: 'Cooperación Internacional',
    color: '#2563EB',
    subgrupos: [
      { nombre: 'Desarrollo Internacional',           color: '#1E40AF', items: ['Cooperación Bilateral', 'Fondos Multilaterales', 'Ayuda Oficial al Desarrollo'] },
      { nombre: 'Derechos Humanos Internacionales',   color: '#4C1D95', items: ['Paz y Reconciliación', 'Género e Inclusión', 'Migraciones y Refugio'] },
      { nombre: 'Medio Ambiente Global',              color: '#064E3B', items: ['Cambio Climático', 'Biodiversidad', 'Agua y Saneamiento Global'] },
    ],
  },
  {
    nombre: 'Futuro y Conocimiento',
    color: '#DB2777',
    subgrupos: [
      { nombre: 'Educación',                       color: '#9D174D', items: ['Infraestructura Escolar (Aulas)', 'Comedores Escolares', 'Educación Digital', 'Otro'] },
      { nombre: 'Ciencia, Tecnología e Innovación', color: '#5B21B6', items: ['Investigación Aplicada (Materiales)', 'Laboratorios de Innovación', 'Patentes y Prototipos'] },
      { nombre: 'Tecnologías',                     color: '#1E3A8A', items: ['Conectividad Rural (Zonas Wi-Fi)', 'Software de Gestión Pública', 'Ciberseguridad'] },
      { nombre: 'Energías Renovables',             color: '#713F12', items: ['Energía Solar Fotovoltaica', 'Microcentrales Hidroeléctricas', 'Biogás'] },
    ],
  },
];
