/**
 * M8 — Agente de Marco Normativo
 * Reescritura Node.js del normative_engine.py (eliminado).
 * Genera normas aplicables y citas bibliográficas obligatorias
 * según sector y municipio del proyecto.
 */

// Base de conocimiento normativo colombiano por sector
const NORMAS_POR_SECTOR = {
  'Salud': [
    { codigo: 'Ley 100/1993',       nombre: 'Sistema General de Seguridad Social en Salud',             articulos: 'Art. 1-4, 152-168', relevancia: 'Alta' },
    { codigo: 'Ley 1438/2011',      nombre: 'Reforma Sistema de Salud',                                  articulos: 'Art. 1-10',         relevancia: 'Alta' },
    { codigo: 'Resolución 1536/2015', nombre: 'Proceso de Planeación en Salud Pública',                 articulos: 'Completa',          relevancia: 'Media' },
    { codigo: 'Ley 1751/2015',      nombre: 'Estatutaria de Salud — Derecho fundamental',               articulos: 'Art. 1-26',         relevancia: 'Alta' },
  ],
  'Educación': [
    { codigo: 'Ley 115/1994',       nombre: 'Ley General de Educación',                                  articulos: 'Art. 1-5, 64-68',   relevancia: 'Alta' },
    { codigo: 'Ley 30/1992',        nombre: 'Educación Superior',                                        articulos: 'Art. 1-10',         relevancia: 'Media' },
    { codigo: 'Decreto 1075/2015',  nombre: 'Decreto Único Reglamentario del Sector Educativo',          articulos: 'Título 3',          relevancia: 'Alta' },
    { codigo: 'Ley 1753/2015',      nombre: 'Plan Nacional de Desarrollo — Componente Educativo',        articulos: 'Art. 66-80',        relevancia: 'Media' },
  ],
  'Infraestructura': [
    { codigo: 'Ley 1682/2013',      nombre: 'Ley de Infraestructura de Transporte',                     articulos: 'Art. 1-12',         relevancia: 'Alta' },
    { codigo: 'Ley 400/1997',       nombre: 'Construcciones Sismo Resistentes (NSR-10)',                 articulos: 'Completa',          relevancia: 'Alta' },
    { codigo: 'Decreto 926/2010',   nombre: 'Reglamento NSR-10',                                        articulos: 'Título A-G',        relevancia: 'Alta' },
    { codigo: 'Ley 388/1997',       nombre: 'Ordenamiento Territorial Municipal',                        articulos: 'Art. 1-10, 58-75',  relevancia: 'Alta' },
    { codigo: 'Ley 1508/2012',      nombre: 'Esquema de Asociaciones Público-Privadas',                 articulos: 'Art. 1-16',         relevancia: 'Media' },
  ],
  'Medio Ambiente': [
    { codigo: 'Ley 99/1993',        nombre: 'Sistema Nacional Ambiental (SINA)',                         articulos: 'Art. 1-18, 65-71',  relevancia: 'Alta' },
    { codigo: 'Decreto 2811/1974',  nombre: 'Código de Recursos Naturales',                              articulos: 'Art. 1-30',         relevancia: 'Alta' },
    { codigo: 'Ley 165/1994',       nombre: 'Convenio sobre Diversidad Biológica',                       articulos: 'Completa',          relevancia: 'Media' },
    { codigo: 'Resolución 1128/2017', nombre: 'Manual de Seguimiento y Evaluación Ambiental',           articulos: 'Completa',          relevancia: 'Media' },
    { codigo: 'Ley 1844/2017',      nombre: 'Acuerdo de París — Cambio Climático',                      articulos: 'Completa',          relevancia: 'Alta' },
  ],
  'Desarrollo Rural': [
    { codigo: 'Ley 160/1994',       nombre: 'Reforma Agraria y Desarrollo Rural',                       articulos: 'Art. 1-25',         relevancia: 'Alta' },
    { codigo: 'Ley 811/2003',       nombre: 'Organizaciones de Cadenas Agroindustriales',               articulos: 'Art. 1-10',         relevancia: 'Media' },
    { codigo: 'Decreto 893/2017',   nombre: 'Programas de Desarrollo con Enfoque Territorial (PDET)',   articulos: 'Art. 1-20',         relevancia: 'Alta' },
    { codigo: 'Ley 2056/2020',      nombre: 'Sistema General de Regalías — inversión rural',            articulos: 'Art. 30-45',        relevancia: 'Media' },
  ],
  'Tecnología': [
    { codigo: 'Ley 1341/2009',      nombre: 'Tecnologías de la Información y Comunicaciones (TIC)',      articulos: 'Art. 1-16',         relevancia: 'Alta' },
    { codigo: 'Ley 1978/2019',      nombre: 'Modernización del Sector TIC',                             articulos: 'Art. 1-10',         relevancia: 'Alta' },
    { codigo: 'CONPES 3975/2019',   nombre: 'Política Nacional para Transformación Digital',            articulos: 'Completa',          relevancia: 'Alta' },
    { codigo: 'Ley 1581/2012',      nombre: 'Protección de Datos Personales (Habeas Data)',             articulos: 'Art. 1-26',         relevancia: 'Media' },
  ],
  'Cultura': [
    { codigo: 'Ley 397/1997',       nombre: 'Ley General de Cultura',                                   articulos: 'Art. 1-14',         relevancia: 'Alta' },
    { codigo: 'Ley 1493/2011',      nombre: 'Espectáculos Públicos de las Artes Escénicas',             articulos: 'Art. 1-18',         relevancia: 'Media' },
    { codigo: 'Decreto 1080/2015',  nombre: 'Decreto Único Reglamentario del Sector Cultura',           articulos: 'Títulos 1-3',       relevancia: 'Alta' },
  ],
  'Otro': [
    { codigo: 'Ley 152/1994',       nombre: 'Ley Orgánica del Plan de Desarrollo',                      articulos: 'Art. 1-10',         relevancia: 'Alta' },
    { codigo: 'CONPES 3918/2018',   nombre: 'Estrategia para los ODS en Colombia',                      articulos: 'Completa',          relevancia: 'Media' },
    { codigo: 'Ley 1530/2012',      nombre: 'Sistema General de Regalías',                              articulos: 'Art. 1-30',         relevancia: 'Media' },
  ],
};

// Normas transversales que aplican a todos los proyectos
const NORMAS_TRANSVERSALES = [
  { codigo: 'Constitución Política de Colombia/1991', nombre: 'Constitución Política',                 articulos: 'Art. 1-2, 25, 79, 366', relevancia: 'Alta' },
  { codigo: 'Ley 80/1993',       nombre: 'Estatuto General de Contratación del Estado',                 articulos: 'Art. 1-28',         relevancia: 'Alta' },
  { codigo: 'Ley 1474/2011',     nombre: 'Estatuto Anticorrupción',                                    articulos: 'Art. 1-10, 82-84',  relevancia: 'Alta' },
  { codigo: 'Decreto 111/1996',  nombre: 'Estatuto Orgánico del Presupuesto Nacional',                  articulos: 'Art. 1-15',         relevancia: 'Media' },
  { codigo: 'Ley 1712/2014',     nombre: 'Transparencia y Acceso a la Información Pública',            articulos: 'Art. 1-22',         relevancia: 'Media' },
];

/**
 * Genera las normas aplicables para un proyecto.
 * @param {string} sector - Sector del proyecto
 * @param {string} municipio - Municipio de ejecución
 * @returns {{ normas: object[], citas: string[] }}
 */
export function generarNormasAplicables(sector, municipio) {
  const normaSector     = NORMAS_POR_SECTOR[sector] || NORMAS_POR_SECTOR['Otro'];
  const normasAplicables = [...NORMAS_TRANSVERSALES, ...normaSector];

  // Citas bibliográficas en formato APA
  const citas = normasAplicables.map(n =>
    `${n.codigo}. ${n.nombre}. República de Colombia. Artículos aplicables: ${n.articulos}.`
  );

  // Si es municipio pequeño, agregar marco regalías
  const municipioLower = (municipio || '').toLowerCase();
  const esRural = municipioLower.includes('vered') || municipioLower.includes('rural') ||
                  municipioLower.includes('corregim');
  if (esRural) {
    normasAplicables.push({
      codigo: 'Decreto 893/2017',
      nombre: 'PDET — Municipios PDET (Paz con Legalidad)',
      articulos: 'Art. 1-15',
      relevancia: 'Alta',
    });
    citas.push('Decreto 893/2017. Programas de Desarrollo con Enfoque Territorial. Municipios priorizados. Art. 1-15.');
  }

  return {
    sector,
    municipio: municipio || 'No especificado',
    normas_aplicables: normasAplicables,
    citas_bibliograficas: citas,
    generado_en: new Date().toISOString(),
  };
}
