const fs = require('fs');
const path = require('path');

const filesToUpdate = [
  'client/src/pages/LoginPage.tsx',
  'client/src/pages/PanelPage.tsx',
  'client/src/pages/DirectoryPage.tsx',
  'client/src/pages/FavoritosPage.tsx',
  'client/src/components/FavoritosView.tsx',
  'client/src/components/DirectoryView.tsx',
  'client/src/components/DashboardView.tsx',
  'client/src/components/ModuloProximamente.tsx'
];

const colorMap = {
  'bg-[#f7f9fb]': 'bg-[#0b1326]',
  'bg-white': 'bg-[#0a1426]',
  'border-[#e2e8f0]': 'border-[#1a3a50]',
  'text-[#191c1e]': 'text-[#c8d8e8]',
  'text-[#45464d]': 'text-[#557997]',
  'text-[#76777d]': 'text-[#557997]',
  'text-[#94a3b8]': 'text-[#3a5e7a]',
  'bg-[#191c1e]': 'bg-[#001c2e]',
  'bg-[#0058be]': 'bg-gradient-to-r from-[#38bdf8] to-[#0284c7]',
  'hover:bg-[#0044a3]': 'hover:from-[#38bdf8] hover:to-[#0284c7]',
  'text-white': 'text-[#e0e0ff]',
  'bg-blue-50': 'bg-[rgba(56,189,248,0.1)]',
  'border-blue-200': 'border-[rgba(56,189,248,0.3)]',
  'text-blue-800': 'text-[#38bdf8]',
  'bg-red-50': 'bg-[rgba(248,113,113,0.1)]',
  'border-red-200': 'border-[rgba(248,113,113,0.3)]',
  'text-red-700': 'text-[#f87171]',
  'bg-[#f0fdf4]': 'bg-[rgba(34,197,94,0.1)]',
  'border-[#86efac]': 'border-[rgba(34,197,94,0.3)]',
  'text-[#166534]': 'text-[#22c55e]',
  'hover:bg-[#f2f4f6]': 'hover:bg-[#1a3a50]',
  'bg-[#f0f6ff]': 'bg-[#001c2e]',
  'border-[#dce9ff]': 'border-[#1a3a50]',
  'text-[#0058be]': 'text-[#38bdf8]',
  'text-[#8a9bb0]': 'text-[#557997]',
  'bg-[#0f172a]': 'bg-[#00101c]', // Tailwind slate-900 to dark
  'text-slate-800': 'text-[#c8d8e8]',
  'text-slate-600': 'text-[#557997]',
  'text-slate-500': 'text-[#3a5e7a]',
  'text-slate-400': 'text-[#3a5e7a]',
  'bg-slate-50': 'bg-[#0b1326]',
  'bg-slate-100': 'bg-[#0a1426]',
  'border-slate-200': 'border-[#1a3a50]',
  'border-slate-300': 'border-[#1a3a50]',
  'hover:bg-slate-50': 'hover:bg-[#1a3a50]',
  'hover:bg-slate-100': 'hover:bg-[#1a3a50]',
  'text-blue-600': 'text-[#38bdf8]',
  'hover:text-blue-700': 'hover:text-[#0284c7]',
  'bg-blue-600': 'bg-[#38bdf8]',
  'hover:bg-blue-700': 'hover:bg-[#0284c7]',
};

for (const relPath of filesToUpdate) {
  const fullPath = path.join('C:\\2026 AI EGIOC5\\Antigravity JS\\proyectos\\Proy_03_RadarFondos', relPath);
  if (fs.existsSync(fullPath)) {
    let content = fs.readFileSync(fullPath, 'utf8');
    for (const [oldClass, newClass] of Object.entries(colorMap)) {
      content = content.split(oldClass).join(newClass);
    }
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`Updated ${relPath}`);
  } else {
    console.log(`File not found: ${relPath}`);
  }
}
