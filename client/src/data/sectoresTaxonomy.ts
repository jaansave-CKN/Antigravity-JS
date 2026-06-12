export interface SubgrupoItem {
  nombre: string;
  items: string[];
}

export interface SectorItem {
  nombre: string;
  subgrupos: SubgrupoItem[];
}

export const SECTORES_TAXONOMY: SectorItem[] = [
  {
    nombre: 'Hábitat y Territorio',
    subgrupos: [
      {
        nombre: 'Construcción',
        items: ['Infraestructura Social', 'Espacios Públicos', 'Centros de Integración Ciudadana', 'Otro'],
      },
      {
        nombre: 'Vivienda',
        items: ['Vivienda de Interés Social (VIS)', 'Vivienda de Interés Prioritario (VIP)', 'Mejoramiento de Vivienda Rural'],
      },
      {
        nombre: 'Transporte',
        items: ['Infraestructura Vial Terrestre', 'Modos de Transporte Fluvial', 'Movilidad Urbana Sostenible'],
      },
      {
        nombre: 'Ordenamiento Territorial',
        items: ['Catastro Multipropósito', 'Planes de Ordenamiento Territorial', 'Legalización de Predios'],
      },
    ],
  },
  {
    nombre: 'Soberanía y Vida',
    subgrupos: [
      {
        nombre: 'Agua',
        items: ['Acueductos Municipales', 'Sistemas de Potabilización Rural', 'Captura de Aguas Lluvias', 'Otro'],
      },
      {
        nombre: 'Saneamiento',
        items: ['Unidades Sanitarias (Baterías de Baño)', 'Alcantarillado', 'Plantas de Tratamiento de Aguas Residuales'],
      },
      {
        nombre: 'Salud',
        items: ['Infraestructura Hospitalaria', 'Puestos de Salud Rurales', 'Dotación Médica de Emergencia'],
      },
      {
        nombre: 'Medio Ambiente',
        items: ['Reforestación', 'Protección de Cuencas Hídricas', 'Economía Circular y Residuos'],
      },
      {
        nombre: 'Gestión de Riesgos',
        items: ['Mitigación de Desastres', 'Muros de Contención', 'Reubicación por Riesgo Geológico'],
      },
    ],
  },
  {
    nombre: 'Paz y Sociedad',
    subgrupos: [
      {
        nombre: 'Derechos Humanos',
        items: ['Protección a Víctimas', 'Restitución de Tierras', 'Equidad de Género', 'Otro'],
      },
      {
        nombre: 'Cultura',
        items: ['Casas de Cultura', 'Patrimonio Inmaterial', 'Escuelas de Formación Artística'],
      },
      {
        nombre: 'Deporte',
        items: ['Complejos Deportivos', 'Parques Biosaludables', 'Escuelas de Deporte Social'],
      },
      {
        nombre: 'Justicia',
        items: ['Casas de Justicia', 'Centros de Conciliación', 'Fortalecimiento Institucional'],
      },
      {
        nombre: 'Ayuda Humanitaria',
        items: ['Atención a Población Migrante', 'Albergues Temporales', 'Seguridad Alimentaria de Emergencia'],
      },
    ],
  },
  {
    nombre: 'Autonomía Económica',
    subgrupos: [
      {
        nombre: 'Agricultura',
        items: ['Distritos de Riego', 'Centros de Acopio Agropecuarios', 'Maquinaria y Equipos', 'Otro'],
      },
      {
        nombre: 'Desarrollo Rural',
        items: ['Caminos Vecinales', 'Plantas de Transformación', 'Proyectos Productivos Campesinos'],
      },
      {
        nombre: 'Turismo',
        items: ['Infraestructura Turística', 'Agroturismo', 'Turismo de Naturaleza Sostenible'],
      },
      {
        nombre: 'Emprendimiento y Cooperativismo',
        items: ['Fortalecimiento de Asociaciones (JAC/Cooperativas)', 'Capital Semilla', 'Formalización Empresarial'],
      },
    ],
  },
  {
    nombre: 'Futuro y Conocimiento',
    subgrupos: [
      {
        nombre: 'Educación',
        items: ['Infraestructura Escolar (Aulas)', 'Comedores Escolares', 'Educación Digital', 'Otro'],
      },
      {
        nombre: 'Ciencia, Tecnología e Innovación',
        items: ['Investigación Aplicada (Materiales)', 'Laboratorios de Innovación', 'Patentes y Prototipos'],
      },
      {
        nombre: 'Tecnologías',
        items: ['Conectividad Rural (Zonas Wi-Fi)', 'Software de Gestión Pública', 'Ciberseguridad'],
      },
      {
        nombre: 'Energías Renovables',
        items: ['Energía Solar Fotovoltaica', 'Microcentrales Hidroeléctricas', 'Biogás'],
      },
    ],
  },
];
