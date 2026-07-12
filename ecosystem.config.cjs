const common = {
  autorestart: true,
  env: { NODE_ENV: 'production' },
  exec_mode: 'fork',
  instances: 1,
  max_restarts: 5,
  min_uptime: '10s',
  restart_delay: 2_000,
  watch: false,
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'rivet-api',
      cwd: `${__dirname}/apps/api`,
      script: 'dist/main.js',
      wait_ready: true,
      listen_timeout: 30_000,
      kill_timeout: 30_000,
      out_file: '/var/log/rivet/api.log',
      error_file: '/var/log/rivet/api-error.log',
    },
    {
      ...common,
      name: 'rivet-worker',
      cwd: `${__dirname}/apps/worker`,
      script: 'dist/main.js',
      wait_ready: true,
      listen_timeout: 30_000,
      kill_timeout: 30_000,
      out_file: '/var/log/rivet/worker.log',
      error_file: '/var/log/rivet/worker-error.log',
    },
    {
      ...common,
      name: 'rivet-web',
      cwd: `${__dirname}/apps/web`,
      script: 'pnpm',
      args: 'start',
      interpreter: 'none',
      kill_timeout: 10_000,
      out_file: '/var/log/rivet/web.log',
      error_file: '/var/log/rivet/web-error.log',
    },
  ],
};
