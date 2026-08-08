const path = require('path');

module.exports = {
  plugins: {
    // FIX (2026-08-08): sin ruta explícita, Tailwind resuelve su config
    // relativo a process.cwd() — para el proceso PM2 (cwd = raíz del repo,
    // ver ecosystem.config.cjs) eso NO es donde vive este archivo (client/),
    // así que caía en un config vacío ("content option is missing or empty")
    // y no generaba ninguna clase de utilidad, solo el preflight/reset.
    tailwindcss: { config: path.resolve(__dirname, 'tailwind.config.cjs') },
    autoprefixer: {},
  },
};
