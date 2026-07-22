// pm2 ecosystem — RadarFondos 360
// Dev local:  pm2 start ecosystem.config.cjs --env development
// Producción: pm2 start ecosystem.config.cjs --env production
// Ver estado: pm2 status | pm2 logs
// Detener:    pm2 stop all  |  Reiniciar: pm2 restart all

module.exports = {
  apps: [
    {
      name: 'radar-backend',
      script: 'server.js',
      interpreter: 'node',
      node_args: '--env-file=.env',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 3000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'development',
        PORT: 8000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: 'logs/backend.err.log',
      out_file: 'logs/backend.out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    {
      name: 'radar-frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: '--port 5173 --host',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        NODE_ENV: 'development',
      },
      error_file: 'logs/frontend.err.log',
      out_file: 'logs/frontend.out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
