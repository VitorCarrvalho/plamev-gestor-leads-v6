module.exports = {
  apps: [{
    name: 'dashboard-v5',
    script: './dist/server/app.js',
    cwd: __dirname,
    env: { NODE_ENV: 'production' },
    env_file: '.env',
    max_memory_restart: '512M',
    log_file: './logs/combined.log',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    watch: false,
    autorestart: true,
  }],
};
