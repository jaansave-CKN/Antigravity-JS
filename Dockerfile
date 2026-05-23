FROM python:3.12-slim
WORKDIR /app

# Install Node.js for frontend build
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy and build frontend
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Install Python deps
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 10000
CMD ["python", "-m", "uvicorn", "backend.server_fastapi:app", "--host", "0.0.0.0", "--port", "10000"]
