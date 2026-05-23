FROM node:22-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY src/ src/
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY --from=frontend /app/dist ./dist
COPY backend/ ./backend/
COPY requirements.txt startup.sh ./
RUN pip install --no-cache-dir -r requirements.txt
EXPOSE 10000
CMD ["bash", "startup.sh"]
