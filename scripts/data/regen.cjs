const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./proyectos/Proy_01/01_Documentos_Originales/municipios.json', 'utf8'));

const index = {};
data.forEach(item => {
  const d = item.Departamento;
  if (!index[d]) index[d] = [];
  index[d].push(item.Municipio);
});

Object.keys(index).forEach(k => index[k].sort());
fs.writeFileSync('./index.json', JSON.stringify(index, null, 2));
console.log('Listo');