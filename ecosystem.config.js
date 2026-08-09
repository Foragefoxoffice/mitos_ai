module.exports = {
  apps: [
    {
      name: "mitos-ai-service",
      script: "./server.js",

      instances: 1,
      exec_mode: "fork",

      env: {
        NODE_ENV: "production",
        PORT: 4001,
      },

      autorestart: true,
      watch: false,
      max_memory_restart: "500M",

      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 4000,

      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      kill_timeout: 5000,
      listen_timeout: 3000,

      node_args: "--max-old-space-size=512",
    },
  ],
};
