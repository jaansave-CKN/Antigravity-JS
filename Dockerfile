FROM nikolaik/python-nodejs:python3.12-nodejs22
WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build && pip install --no-cache-dir -r requirements.txt

EXPOSE 10000
CMD python -m uvicorn backend.server_fastapi:app --host 0.0.0.0 --port ${PORT:-10000}
