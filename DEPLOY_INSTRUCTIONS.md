# DESPLIEGUE RAILWAY - PASO A PASO

## PASO A (Empaquetar el proyecto):
```bash
# Git init y commit
git init
git add .
git commit -m "Deploy RadarFondos 360"
```

## PASO B (Subir a Railway):
```bash
# Instalar Railway CLI
npm install -g railway

# Login
railway login

# Crear proyecto
railway init

# Agregar variables de entorno
railway variable set JWT_SECRET tu_jwt_secret_super_seguro_2026
railway variable set ENVIRONMENT production

# Deploy
railway up
```

## PASO C (Obtener URL pública):
```bash
# Obtener dominio
railway domain

# La URL será: https://[nombre-proyecto].up.railway.app
```

## ALTERNATIVA RÁPIDA (sin CLI):
1. Ve a https://railway.app
2. Click "New Project" → "Deploy from Repo"
3. Conecta tu repositorio de GitHub/GitLab
4. Agrega variables: JWT_SECRET, ENVIRONMENT=production
5. Click "Deploy"
6. La URL aparecerá en el dashboard