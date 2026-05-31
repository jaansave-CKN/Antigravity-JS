# ── Imagen base ──────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# ── Dependencias (cacheadas si package.json no cambia) ───────────────────────
COPY package*.json ./
RUN npm install

# ── Código fuente completo ────────────────────────────────────────────────────
COPY . .

# ── Compilar frontend React → /app/dist/ ─────────────────────────────────────
# vite.config.ts ya apunta outDir a la raíz /app/dist, que es donde server.js
# busca los estáticos en producción.
RUN npm run build

# ── Directorio de base de datos ───────────────────────────────────────────────
# En Railway/Render/Fly.io se monta un volumen persistente aquí.
# Sin volumen, la DB se reinicia en cada deploy (solo para testing).
RUN mkdir -p /app/backend

# ── Puerto y modo ─────────────────────────────────────────────────────────────
EXPOSE 3000
ENV NODE_ENV=production

# ── Arranque ──────────────────────────────────────────────────────────────────
CMD ["node", "server.js"]
